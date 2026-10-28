"""Check offline tooling against the five original images; no hardware access."""
from pathlib import Path
import struct
import sys
import unittest

import ae64_container as tool


class ContainerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        bundled = Path(__file__).resolve().parents[1] / "originals"
        fallback = Path(__file__).resolve().parents[2] / "AE64-Pro-firmware"
        root = Path(sys.argv[1]) if len(sys.argv) > 1 else (bundled if bundled.exists() else fallback)
        cls.images = sorted(root.glob("*.bin"))
        if len(cls.images) != 5:
            raise RuntimeError(f"Expected five originals in {root}, got {len(cls.images)}")

    def test_originals_and_exact_roundtrip(self):
        for path in self.images:
            with self.subTest(image=path.name):
                data = path.read_bytes()
                self.assertTrue(tool.inspect(data)["format_valid"])
                self.assertEqual(data, tool.repackage(data, data[4096:]))

    def test_reject_corruption_and_wrong_board(self):
        data = bytearray(self.images[0].read_bytes())
        data[-1] ^= 1
        with self.assertRaisesRegex(ValueError, "CRC"):
            tool.inspect(data)
        data = bytearray(self.images[0].read_bytes())
        struct.pack_into("<I", data, 4, 0x0030000B)
        with self.assertRaisesRegex(ValueError, "Board"):
            tool.inspect(data)

    def test_packets_reconstruct_entire_container(self):
        for path in self.images:
            with self.subTest(image=path.name):
                data = path.read_bytes()
                assembled = bytearray()
                for packet in tool.flash_packets(data):
                    self.assertEqual(len(packet), 64)
                    self.assertEqual(packet[:2], b"\x08\x02")
                    offset, length = struct.unpack_from("<IH", packet, 2)
                    self.assertEqual(offset, len(assembled))
                    self.assertLessEqual(length, 56)
                    assembled.extend(packet[8:8+length])
                    self.assertFalse(any(packet[8+length:]))
                self.assertEqual(data, assembled)


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]])
