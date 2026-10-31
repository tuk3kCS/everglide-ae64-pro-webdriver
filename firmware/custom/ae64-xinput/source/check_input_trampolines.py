"""Interpret linked RV32 input trampolines offline; never opens a device.

This deliberately small, fail-closed RV32I/C interpreter executes the actual
linked instruction bytes. Calls into the two C helpers are replaced by an ABI
model that records arguments and destroys every caller-saved register. It checks
the assembly boundary, not the helpers' behavior or execution on the keyboard.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path


MASK = 0xFFFFFFFF
VOLATILE = (1, 5, 6, 7, *range(10, 18), 28, 29, 30, 31)
SAVE_ORDER = (1, 5, 6, 7, 28, 29, 30, 31, *range(10, 18))
TRAMPOLINES = {
    "board_key_context_trampoline": "board_key_context",
    "board_timed_context_trampoline": "board_key_context",
    "board_key_action_trampoline": "board_key_action",
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def signed(value, bits):
    return value - (1 << bits) if value & (1 << (bits - 1)) else value


class Elf32:
    def __init__(self, path):
        self.data = Path(path).read_bytes()
        require(self.data[:6] == bytes.fromhex("7f454c460101"), "Expected little-endian ELF32")
        require(struct.unpack_from("<H", self.data, 18)[0] == 243, "Expected RISC-V ELF")
        header = struct.unpack_from("<16sHHIIIIIHHHHHH", self.data)
        offset, size, count = header[6], header[11], header[12]
        require(size >= 40 and count > 0, "Missing ELF section table")
        self.sections = [struct.unpack_from("<10I", self.data, offset + i * size) for i in range(count)]
        self.symbols = {}
        for section in self.sections:
            if section[1] != 2:
                continue
            table = self.sections[section[6]]
            names = self.data[table[4]:table[4] + table[5]]
            require(section[9] == 16, "Unexpected ELF symbol size")
            for position in range(section[4], section[4] + section[5], 16):
                name, address, length, info, other, index = struct.unpack_from("<IIIBBH", self.data, position)
                if name and index:
                    label = names[name:names.index(0, name)].decode("ascii")
                    self.symbols[label] = (address, length)

    def symbol(self, name):
        require(name in self.symbols, "Missing ELF symbol: " + name)
        return self.symbols[name]

    def read(self, address, length):
        for section in self.sections:
            if section[1] != 8 and section[2] & 2 and section[3] <= address and address + length <= section[3] + section[5]:
                start = section[4] + address - section[3]
                return self.data[start:start + length]
        raise ValueError("Instruction address outside backed ELF section: " + hex(address))


class Machine:
    def __init__(self, elf, registers, memory, helper, helper_arguments, helper_result):
        self.elf = elf
        self.reg = registers[:]
        self.memory = memory.copy()
        self.initial_sp = self.reg[2]
        self.helper = elf.symbol(helper)[0]
        self.helper_arguments = helper_arguments
        self.helper_result = helper_result
        self.calls = []
        self.writes = []
        self.steps = 0
        self.encodings = set()

    def get(self, address, length):
        require(all(address + i in self.memory for i in range(length)), "Uninitialized memory read: " + hex(address))
        return sum(self.memory[address + i] << (8 * i) for i in range(length))

    def put(self, address, value):
        require(address % 4 == 0, "Unaligned stack word")
        require(self.initial_sp - 64 <= address <= self.initial_sp - 4, "Store outside 64-byte caller save frame")
        self.writes.append(address)
        for i in range(4):
            self.memory[address + i] = (value >> (8 * i)) & 255

    def set(self, register, value):
        if register:
            self.reg[register] = value & MASK

    def call_helper(self):
        require(self.reg[2] == self.initial_sp - 64 and self.reg[2] % 16 == 0, "C call stack alignment/save size")
        arguments = tuple(self.reg[10:10 + len(self.helper_arguments)])
        require(arguments == self.helper_arguments, "Wrong C helper arguments: " + repr(arguments))
        self.calls.append(arguments)
        continuation = self.reg[1]
        # Model even RA as destroyed: only the return destination is retained.
        for register in VOLATILE:
            self.reg[register] = (0xC10B0000 ^ register * 0x01010101) & MASK
        self.reg[10] = self.helper_result
        self.pc = continuation

    @staticmethod
    def compressed_jump(word):
        value = (((word >> 12) & 1) << 11 | ((word >> 11) & 1) << 4 |
                 ((word >> 9) & 3) << 8 | ((word >> 8) & 1) << 10 |
                 ((word >> 7) & 1) << 6 | ((word >> 6) & 1) << 7 |
                 ((word >> 3) & 7) << 1 | ((word >> 2) & 1) << 5)
        return signed(value, 12)

    def compressed(self, word, pc):
        quadrant, funct = word & 3, word >> 13
        rd, rs2 = (word >> 7) & 31, (word >> 2) & 31
        if quadrant == 1 and funct == 0:  # C.ADDI / C.NOP
            immediate = signed(((word >> 12) & 1) << 5 | ((word >> 2) & 31), 6)
            self.set(rd, self.reg[rd] + immediate)
        elif quadrant == 1 and funct == 2:  # C.LI
            self.set(rd, signed(((word >> 12) & 1) << 5 | ((word >> 2) & 31), 6))
        elif quadrant == 1 and funct == 3 and rd == 2:  # C.ADDI16SP
            immediate = (((word >> 12) & 1) << 9 | ((word >> 6) & 1) << 4 |
                         ((word >> 5) & 1) << 6 | ((word >> 3) & 3) << 7 |
                         ((word >> 2) & 1) << 5)
            self.set(2, self.reg[2] + signed(immediate, 10))
        elif quadrant == 1 and funct in (1, 5):  # C.JAL / C.J
            if funct == 1:
                self.set(1, pc + 2)
            self.pc = (pc + self.compressed_jump(word)) & MASK
        elif quadrant == 1 and funct in (6, 7):  # C.BEQZ / C.BNEZ
            register = 8 + ((word >> 7) & 7)
            delta = (((word >> 12) & 1) << 8 | ((word >> 10) & 3) << 3 |
                     ((word >> 5) & 3) << 6 | ((word >> 3) & 3) << 1 |
                     ((word >> 2) & 1) << 5)
            if (self.reg[register] == 0) == (funct == 6):
                self.pc = (pc + signed(delta, 9)) & MASK
        elif quadrant == 1 and funct == 4 and ((word >> 10) & 3) == 2:  # C.ANDI
            register = 8 + ((word >> 7) & 7)
            immediate = signed(((word >> 12) & 1) << 5 | ((word >> 2) & 31), 6)
            self.set(register, self.reg[register] & immediate)
        elif quadrant == 2 and funct == 6:  # C.SWSP
            offset = ((word >> 9) & 15) << 2 | ((word >> 7) & 3) << 6
            self.put((self.reg[2] + offset) & MASK, self.reg[rs2])
        elif quadrant == 2 and funct == 2:  # C.LWSP
            require(rd != 0, "Reserved C.LWSP")
            offset = ((word >> 12) & 1) << 5 | ((word >> 4) & 7) << 2 | ((word >> 2) & 3) << 6
            self.set(rd, self.get((self.reg[2] + offset) & MASK, 4))
        elif quadrant == 2 and funct == 4 and rd:
            if not ((word >> 12) & 1):
                if rs2:  # C.MV
                    self.set(rd, self.reg[rs2])
                else:  # C.JR / RET
                    self.pc = self.reg[rd] & ~1
            elif rs2:  # C.ADD
                self.set(rd, self.reg[rd] + self.reg[rs2])
            else:  # C.JALR
                target = self.reg[rd] & ~1
                self.set(1, pc + 2)
                self.pc = target
        else:
            raise ValueError(f"Unsupported compressed instruction {word:04x} at {pc:08x}")

    def ordinary(self, word, pc):
        opcode, rd, funct, rs1, rs2 = word & 127, (word >> 7) & 31, (word >> 12) & 7, (word >> 15) & 31, (word >> 20) & 31
        immediate = signed(word >> 20, 12)
        if opcode == 0x13 and funct == 0:  # ADDI / MV
            self.set(rd, self.reg[rs1] + immediate)
        elif opcode == 0x13 and funct == 7:  # ANDI
            self.set(rd, self.reg[rs1] & immediate)
        elif opcode == 0x17:  # AUIPC
            self.set(rd, pc + (word & 0xFFFFF000))
        elif opcode == 0x67 and funct == 0:  # JALR / RET
            target = (self.reg[rs1] + immediate) & MASK & ~1
            self.set(rd, pc + 4)
            self.pc = target
        elif opcode == 0x6F:  # JAL
            delta = (((word >> 31) & 1) << 20 | ((word >> 21) & 1023) << 1 |
                     ((word >> 20) & 1) << 11 | ((word >> 12) & 255) << 12)
            self.set(rd, pc + 4)
            self.pc = (pc + signed(delta, 21)) & MASK
        elif opcode == 0x63 and funct in (0, 1, 4, 5, 6, 7):  # Conditional branches
            delta = (((word >> 31) & 1) << 12 | ((word >> 7) & 1) << 11 |
                     ((word >> 25) & 63) << 5 | ((word >> 8) & 15) << 1)
            a, b = self.reg[rs1], self.reg[rs2]
            taken = {0: a == b, 1: a != b, 4: signed(a, 32) < signed(b, 32),
                     5: signed(a, 32) >= signed(b, 32), 6: a < b, 7: a >= b}[funct]
            if taken:
                self.pc = (pc + signed(delta, 13)) & MASK
        elif opcode == 0x03 and funct in (2, 4, 5):  # LW / LBU / LHU
            self.set(rd, self.get((self.reg[rs1] + immediate) & MASK, {2: 4, 4: 1, 5: 2}[funct]))
        elif opcode == 0x23 and funct == 2:  # SW
            delta = signed(((word >> 25) << 5) | ((word >> 7) & 31), 12)
            self.put((self.reg[rs1] + delta) & MASK, self.reg[rs2])
        elif opcode == 0x33 and funct == 0 and word >> 25 == 0:  # ADD
            self.set(rd, self.reg[rs1] + self.reg[rs2])
        else:
            raise ValueError(f"Unsupported instruction {word:08x} at {pc:08x}")

    def run(self, start, stop, size):
        self.pc = start
        while self.pc != stop:
            require(self.steps < 256, "Trampoline did not return")
            if self.pc == self.helper:
                self.call_helper()
                continue
            require(start <= self.pc < start + size, "Control escaped trampoline: " + hex(self.pc))
            pc = self.pc
            half = int.from_bytes(self.elf.read(pc, 2), "little")
            length = 4 if half & 3 == 3 else 2
            word = int.from_bytes(self.elf.read(pc, length), "little")
            self.encodings.add((length, word))
            self.pc = (pc + length) & MASK
            (self.ordinary if length == 4 else self.compressed)(word, pc)
            self.reg[0] = 0
            self.steps += 1


def check_trampolines(elf_path):
    elf = Elf32(elf_path)
    results = []
    for name, helper in TRAMPOLINES.items():
        address, size = elf.symbol(name)
        require(size > 0, "Missing trampoline extent: " + name)
        step_counts, encodings = [], set()
        calls, skipped, skipped_steps = 0, 0, []
        for variant in range(32):
            registers = [0] + [((0x13579BDF * i) ^ (variant * 0x1020304)) & MASK for i in range(1, 32)]
            registers[1] = 0xABCDEE00
            registers[2] = 0x94000 + variant * 0x100
            registers[8] = 0x82BB8 + 2 * 0x5E8 + 3 * 0x48  # s0: exact physical record
            registers[27] = 0x82BB8 + 4 * 0x5E8 + 7 * 0x48  # s11: timed sweep record
            registers[25] = 0x97000 + variant * 0x20  # s9: timed settings record
            memory = {registers[2] + i: ((i + 96) * 37 + variant) & 255 for i in range(-96, 32)}
            timed_byte = (0, 1, 2, 3, 4, 0x7F, 0x80, 0xFF)[variant % 8]
            memory[registers[25] + 0x11] = timed_byte
            halfword = (0, 1, 0x7FFF, 0x8000, 0xF101, 0xFFFF)[variant % 6]
            expected = registers[:]
            saved = registers[:]
            helper_needed = True
            if name == "board_key_context_trampoline":
                registers[15] = (0, 0x80, 0x82, 2, 4, 0xFFFFFF7D, MASK, 0x80000000)[variant % 8]
                arguments = (registers[8],)
                expected[15] = registers[15] & 0x82
                saved[15] = expected[15]
                helper_needed = expected[15] != 0
                returned = 0xDEAD7654
            elif name == "board_timed_context_trampoline":
                arguments = (registers[27],)
                expected[10] = timed_byte
                saved[10] = timed_byte
                helper_needed = timed_byte == 3
                returned = 0xDEAD7654
            else:
                registers[15] = 0x98000 + variant * 4
                expected[15] = registers[15]
                saved[15] = registers[15]
                memory[registers[15]] = halfword & 255
                memory[registers[15] + 1] = halfword >> 8
                arguments = (registers[8], halfword)
                returned = halfword if variant % 2 else (0, 0xF101, 0xF103, 0xFFFF)[variant % 4]
                expected[19] = returned  # s3 replaces the displaced LHU result
            machine = Machine(elf, registers, memory, helper, arguments, returned)
            machine.run(address, registers[1], size)
            require(machine.calls == ([arguments] if helper_needed else []), name + ": wrong helper/fast-path decision")
            require(machine.reg == expected, name + ": register preservation/result mismatch: " +
                    repr([(i, hex(a), hex(b)) for i, (a, b) in enumerate(zip(machine.reg, expected)) if a != b]))
            require(sorted(machine.writes) == (list(range(registers[2] - 64, registers[2], 4)) if helper_needed else []), name + ": save frame stores")
            if helper_needed:
                calls += 1
                for offset, register in enumerate(SAVE_ORDER):
                    require(machine.get(registers[2] - 64 + offset * 4, 4) == saved[register], name + ": saved register slot")
            else:
                skipped += 1
                skipped_steps.append(machine.steps)
                # This guards the reason for the optimization: idle records
                # must not pay for caller spills, C dispatch, or stack traffic.
                require(machine.steps <= (3 if name == "board_key_context_trampoline" else 5), name + ": idle path too expensive")
            require(all(machine.memory[position] == value for position, value in memory.items()
                        if not registers[2] - 64 <= position < registers[2]), name + ": stack/input guard changed")
            step_counts.append(machine.steps)
            encodings.update(machine.encodings)
        results.append({"trampoline": name, "helper": helper, "variants": 32,
                        "helper_calls": calls, "skipped_helper_calls": skipped,
                        "fast_path_steps": sorted(set(skipped_steps)),
                        "steps": [min(step_counts), max(step_counts)], "distinct_encodings": len(encodings)})
    return {"offline_only": True, "elf_sha256": hashlib.sha256(elf.data).hexdigest(),
            "executed_linked_trampoline_variants": 96,
            "helper_calls": sum(result["helper_calls"] for result in results),
            "skipped_helper_calls": sum(result["skipped_helper_calls"] for result in results),
            "results": results,
            "scope": "RV32I/C assembly boundary with ABI-clobbering C helper model; no hardware or C helper execution"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--elf", required=True, type=Path)
    parser.add_argument("--json", type=Path, help="Optional output evidence path")
    args = parser.parse_args()
    result = check_trampolines(args.elf)
    if args.json:
        args.json.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"PASS: 96 linked RV32 input-trampoline variants; {result['helper_calls']} ABI-clobbering helper calls, {result['skipped_helper_calls']} verified zero-stack fast paths; exact displaced results, arguments, stack guards, SP/RA preservation. Offline only.")


if __name__ == "__main__":
    main()
