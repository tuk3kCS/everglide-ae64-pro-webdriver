"""Offline AE64 Pro container checks, payload extraction, packaging and packet plans.

This module has no USB/HID/network code and never communicates with a keyboard.
Matching this observed container format does not establish bootloader acceptance.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import struct
import zlib

MAGIC = 0xBEAF5AA5
BOARD = 0x0030000A
HEADER_BYTES = 0x1000
CHUNK_BYTES = 56


def inspect(data: bytes) -> dict:
    if len(data) < HEADER_BYTES:
        raise ValueError("Image is shorter than the observed 4096-byte header")
    magic, board, boundary, length, stored_crc = struct.unpack_from("<5I", data)
    if magic != MAGIC:
        raise ValueError("Unexpected magic")
    if board != BOARD:
        raise ValueError("Board differs from AE64 Pro 0030000A")
    if boundary != HEADER_BYTES:
        raise ValueError("Unexpected header word at 0x08; only 0x1000 supported")
    payload = data[HEADER_BYTES:]
    if not payload or length != len(payload):
        raise ValueError("Declared payload length does not match file")
    computed_crc = zlib.crc32(payload)
    if stored_crc != computed_crc:
        raise ValueError("Payload CRC-32 mismatch")
    return {
        "magic": f"{magic:08X}",
        "board_id": f"{board:08X}",
        "header_word_08": f"{boundary:08X}",
        "header_bytes": HEADER_BYTES,
        "payload_bytes": length,
        "container_bytes": len(data),
        "crc32": f"{computed_crc:08X}",
        "sha256": hashlib.sha256(data).hexdigest(),
        "nonzero_reserved_header_bytes": sum(x != 0 for x in data[20:HEADER_BYTES]),
        "format_valid": True,
        "bootloader_acceptance": "not established by offline format validation",
    }


def repackage(template: bytes, payload: bytes) -> bytes:
    """Preserve header bytes, replacing only length and CRC fields."""
    inspect(template)
    if not payload:
        raise ValueError("Payload is empty")
    if len(payload) > 0xFFFFFFFF:
        raise ValueError("Payload exceeds 32-bit length field")
    header = bytearray(template[:HEADER_BYTES])
    struct.pack_into("<II", header, 12, len(payload), zlib.crc32(payload))
    result = bytes(header) + payload
    inspect(result)
    return result


def flash_packets(container: bytes):
    """Yield 64-byte HID payloads; addresses are file offsets, not MCU addresses."""
    inspect(container)
    for offset in range(0, len(container), CHUNK_BYTES):
        chunk = container[offset:offset + CHUNK_BYTES]
        yield (bytes((8, 2)) + struct.pack("<IH", offset, len(chunk))
               + chunk).ljust(64, b"\0")


def packet_plan(data: bytes, include_packets: bool = False) -> dict:
    metadata = inspect(data)
    packets = list(flash_packets(data))
    result = {
        "offline_only": True,
        "image": metadata,
        "transport": {"report_id": 0, "payload_bytes": 64,
                      "windows_report_buffer_bytes": 65},
        "commands": {"app_to_boot_hex": "0801" + "00" * 62,
                     "validate_hex": "0803" + "00" * 62,
                     "boot_to_app_hex": "0804" + "00" * 62},
        "flash_packet_count": len(packets),
        "flash_address_meaning": "container-relative byte offset; not physical MCU flash address",
        "first_flash_packet_hex": packets[0].hex(),
        "last_flash_packet_hex": packets[-1].hex(),
        "ack_status_meaning": "unknown; vendor per-packet check is not reliable",
        "final_validate_success": "response payload byte 2 == 1 in vendor driver",
    }
    if include_packets:
        result["flash_packets_hex"] = [p.hex() for p in packets]
    return result


def write_new(path: Path, data: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as out:
        out.write(data)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="command", required=True)
    for command in ("inspect", "extract", "plan"):
        parser = sub.add_parser(command)
        parser.add_argument("image", type=Path)
        if command == "extract":
            parser.add_argument("output", type=Path)
        if command == "plan":
            parser.add_argument("--output", type=Path)
            parser.add_argument("--include-packets", action="store_true")
    pack = sub.add_parser("pack")
    pack.add_argument("template", type=Path)
    pack.add_argument("payload", type=Path)
    pack.add_argument("output", type=Path)
    args = ap.parse_args()
    try:
        if args.command == "pack":
            result = repackage(args.template.read_bytes(), args.payload.read_bytes())
            write_new(args.output, result)
            print(json.dumps(inspect(result), indent=2))
        else:
            data = args.image.read_bytes()
            info = inspect(data)
            if args.command == "extract":
                write_new(args.output, data[HEADER_BYTES:])
                print(json.dumps(info, indent=2))
            elif args.command == "plan":
                result = json.dumps(packet_plan(data, args.include_packets), indent=2) + "\n"
                if args.output:
                    write_new(args.output, result.encode())
                else:
                    print(result, end="")
            else:
                print(json.dumps(info, indent=2))
    except (ValueError, OSError) as exc:
        ap.exit(2, f"Error: {exc}\n")


if __name__ == "__main__":
    main()
