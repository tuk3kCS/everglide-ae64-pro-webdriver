"""Reproduce the static AE64 Pro inventory; never opens a device.

Optional Capstone disassembly is linear and includes code/data mixtures.
It is evidence for instructions, not a complete decompilation or execution trace.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import zlib


def hid_descriptor(data: bytes, offset: int, collections: int) -> dict:
    cursor = offset
    depth = closed = 0
    state = {"size": 0, "count": 0, "id": 0, "page": 0}
    local = {}
    fields = []
    bits = {}
    while cursor < len(data):
        item_offset = cursor
        prefix = data[cursor]
        cursor += 1
        if prefix == 0xFE:
            raise ValueError("Long HID items are outside this parser's supported subset")
        size = (0, 1, 2, 4)[prefix & 3]
        item_type, tag = (prefix >> 2) & 3, prefix >> 4
        if cursor + size > len(data):
            raise ValueError("Truncated HID item")
        value = int.from_bytes(data[cursor:cursor + size], "little")
        cursor += size
        if item_type == 1:
            name = {0: "page", 7: "size", 8: "id", 9: "count"}.get(tag)
            if name:
                state[name] = value
        elif item_type == 2:
            local[{0: "usage", 1: "minimum", 2: "maximum"}.get(tag, str(tag))] = value
        elif item_type == 0:
            if tag == 10:
                depth += 1
            elif tag == 12:
                depth -= 1
                if depth < 0:
                    raise ValueError("Unbalanced HID collection")
                if depth == 0:
                    closed += 1
            elif tag in (8, 9, 11):
                direction = {8: "input", 9: "output", 11: "feature"}[tag]
                key = f"{state['id']}-{direction}"
                bit_offset = bits.get(key, 0)
                bits[key] = bit_offset + state["size"] * state["count"]
                fields.append({**state, **local, "direction": direction,
                               "bit_offset": bit_offset, "flags": value,
                               "constant": bool(value & 1),
                               "item_payload_offset": item_offset})
            local = {}
        if closed == collections and depth == 0:
            return {"payload_offset": offset, "bytes": cursor - offset,
                    "hex": data[offset:cursor].hex(), "fields": fields,
                    "report_bits": bits}
    raise ValueError("HID collections did not terminate")


def inspect(path: Path, out: Path, disassemble: bool) -> dict:
    image = path.read_bytes()
    if len(image) < 4096:
        raise ValueError(f"{path}: short container")
    magic, board, boundary, length, crc = struct.unpack_from("<5I", image)
    payload = image[4096:]
    if (magic, board, boundary) != (0xBEAF5AA5, 0x0030000A, 4096):
        raise ValueError(f"{path}: unexpected AE64 Pro header")
    if length != len(payload) or zlib.crc32(payload) != crc:
        raise ValueError(f"{path}: length/CRC failure")
    match = re.search(r"_v([\d.]+)_", path.name)
    version = match.group(1) if match else path.stem
    destination = out / version
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "application.payload").write_bytes(payload)
    strings = [{"payload_offset": m.start(), "container_offset": m.start() + 4096,
                "text": m.group().decode("ascii")}
               for m in re.finditer(rb"[ -~]{6,}", payload)]
    (destination / "strings.json").write_text(json.dumps(strings, indent=2), encoding="utf8")
    keyboard = [m.start() for m in re.finditer(
        re.escape(bytes.fromhex("05010906a101")), payload)]
    if len(keyboard) != 2:
        raise ValueError(f"{path}: expected two keyboard descriptor candidates")
    vendor_offset = payload.find(bytes.fromhex("06b0ff0901a101"))
    if vendor_offset < 0:
        raise ValueError("Vendor report descriptor not found")
    descriptors = {"shared": hid_descriptor(payload, keyboard[0], 4),
                   "boot": hid_descriptor(payload, keyboard[1], 1),
                   "vendor": hid_descriptor(payload, vendor_offset, 1)}
    (destination / "hid-descriptors.json").write_text(
        json.dumps(descriptors, indent=2), encoding="utf8")
    record = {"version": version, "file": path.name, "container_bytes": len(image),
              "payload_bytes": len(payload), "sha256": hashlib.sha256(image).hexdigest(),
              "crc32": f"{crc:08X}", "reserved_header_nonzero_bytes":
              sum(b != 0 for b in image[20:4096]),
              "shared_report_bits": descriptors["shared"]["report_bits"],
              "linear_disassembly": disassemble}
    if disassemble:
        import capstone
        decoder = capstone.Cs(capstone.CS_ARCH_RISCV,
                             capstone.CS_MODE_RISCV32 | capstone.CS_MODE_RISCVC)
        decoder.skipdata = True
        with (destination / "linear-disassembly.txt").open("w", encoding="utf8") as stream:
            stream.write("RV32+C, payload-relative coordinates. Data may decode as code.\n")
            stream.write("Low payload sections are copied to ILM; file offsets are not VMAs.\n")
            for ins in decoder.disasm(payload, 0):
                stream.write(f"{ins.address:06x} {ins.bytes.hex():12} "
                             f"{ins.mnemonic:14} {ins.op_str}\n")
        record["capstone_version"] = capstone.__version__
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Directory containing original firmware containers")
    parser.add_argument("output", type=Path)
    parser.add_argument("--disassemble", action="store_true")
    args = parser.parse_args()
    files = sorted(args.input.glob("XS117_C048P010_AE64Pro_App_v*.bin"))
    if not files:
        parser.error("No original AE64 Pro firmware files found")
    records = [inspect(f, args.output, args.disassemble) for f in files]
    (args.output / "inventory.json").write_text(json.dumps(records, indent=2), encoding="utf8")
    print(json.dumps(records, indent=2))


if __name__ == "__main__":
    main()
