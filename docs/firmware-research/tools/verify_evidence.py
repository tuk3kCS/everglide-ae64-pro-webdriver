"""Verify retained bytes, HID fields and packet-stream hashes without a device."""
from pathlib import Path
import hashlib
import json
import re
import sys
import tempfile
import unittest

import analyze_firmware

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "protocol"))
import ae64_container


class EvidenceChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.files = sorted((ROOT / "originals").glob("XS117_*.bin"))
        cls.payloads = {re.search(r"_v([\d.]+)_", p.name).group(1): p.read_bytes()[4096:]
                        for p in cls.files}
        if len(cls.files) != 5:
            raise RuntimeError("Expected five original containers")

    def test_original_hashes_and_packet_streams(self):
        manifest = json.loads((ROOT / "originals/manifest.json").read_text())
        hashes = {f["firmware_name"]: f["sha256"] for f in manifest["firmwares"]}
        references = json.loads((ROOT / "protocol/vendor-packet-reference.json").read_text())
        references = {f["filename"]: f for f in references["results"]}
        for path in self.files:
            with self.subTest(file=path.name):
                raw = path.read_bytes()
                self.assertEqual(hashlib.sha256(raw).hexdigest(), hashes[path.name])
                packets = list(ae64_container.flash_packets(raw))
                self.assertEqual(len(packets), references[path.name]["packet_count"])
                self.assertEqual(hashlib.sha256(b"".join(packets)).hexdigest(),
                                 references[path.name]["packets_sha256"])

    def test_hid_protocol_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            records = [analyze_firmware.inspect(p, Path(directory), False) for p in self.files]
            self.assertEqual([x["shared_report_bits"]["1-input"] for x in records],
                             [120, 120, 120, 120, 128])
            self.assertEqual(["1-output" in x["shared_report_bits"] for x in records],
                             [False, False, False, True, True])
        decoded = json.loads((ROOT / "analysis/usb-descriptors-decoded.json").read_text())
        for record in decoded:
            raw = self.payloads[record["version"]]
            for name in ("multi_report", "boot_keyboard", "vendor"):
                item = record[name]
                self.assertEqual(raw[item["offset"]:item["offset"] + item["bytes"]].hex(), item["hex"])
        self.assertEqual(len({d["boot_keyboard"]["hex"] for d in decoded}), 1)
        self.assertEqual(len({d["vendor"]["hex"] for d in decoded}), 1)
        self.assertEqual(len({d["device_descriptor"]["hex"] for d in decoded}), 1)

    def test_exception_evidence_and_native_excerpts(self):
        evidence = json.loads((ROOT / "symbols/confirmed-deltas.json").read_text())
        for item in evidence:
            raw = self.payloads[item["version"]]
            stop = item["exception_stop_routine"]
            offset = int(stop["payload_start"], 16)
            expected = bytes.fromhex(stop["bytes"])
            self.assertEqual(raw[offset:offset + len(expected)], expected)
        checked = 0
        pattern = re.compile(r"payload\+0x([0-9a-f]+)\s+container\+0x[0-9a-f]+\s+VMA0x[0-9a-f]+\s+([0-9a-f]+)\s")
        for path in (ROOT / "protocol/native-handler-excerpts").glob("*.txt"):
            version = path.name.split("-family")[0]
            if path.name.startswith("latest-"):
                version = "0.1.0.0"
            if version not in self.payloads:
                continue
            raw = self.payloads[version]
            for match in pattern.finditer(path.read_text(encoding="utf8")):
                offset = int(match.group(1), 16)
                expected = bytes.fromhex(match.group(2))
                self.assertEqual(raw[offset:offset + len(expected)], expected,
                                 f"{path.name}: payload {offset:x}")
                checked += 1
        self.assertGreater(checked, 1000)

    def test_retained_vendor_source_snippets(self):
        index = json.loads((ROOT / "protocol/evidence/index.json").read_text())
        for item in index:
            raw = (ROOT / "protocol/evidence" / item["snippet_file"]).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(), item["snippet_sha256"])


if __name__ == "__main__":
    unittest.main()
