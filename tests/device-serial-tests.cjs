"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { AE64HidTransport } = require("../protocol.js");

// The retained manufacturer decoder is the evidence for the display format.
const factory = fs.readFileSync(path.join(__dirname, "../docs/firmware-research/protocol/evidence/P12.js.txt"), "utf8");
assert.match(factory, /sn:t\.slice\(17,29\)\.join\(""\)/);

async function decode(serial, { marker = [], board = 0x0a, runMode = 0 } = {}) {
  const packet = new Uint8Array(64);
  packet.set([1, 2, 0, 0, 0, 0x30, 0, 0x0a, 0, 1, 0, 0]);
  packet.set(serial, 17);
  packet[7] = board;
  packet[16] = runMode;
  packet.set(marker, 48);
  const transport = new AE64HidTransport(null);
  transport.transact = async (request) => {
    assert.deepEqual(request, [1, 2]);
    return packet;
  };
  return transport.getDeviceInfo();
}

(async () => {
  const mixed = Uint8Array.from([80, 54, 55, 66, 52, 53, 0, 128, 0, 0, 255, 7]);
  const info = await decode(mixed);
  assert.equal(info.serial, Array.from(mixed).join(""));
  assert.equal(info.serial, "8054556652530128002557");
  assert.match(info.serial, /^\d+$/);
  assert.equal(info.boardIdHex, "0030000a");
  assert.equal(info.firmware, "0.1.0.0");
  assert.equal(info.firmwareDisplay, "0.1.0.0");
  assert.equal(info.customFirmware, null);
  const marker = [0x41, 0x45, 0x36, 0x34, 1, 0, 8, 1, 1];
  const custom = await decode(mixed, { marker });
  assert.equal(custom.firmware, "0.1.0.0");
  assert.equal(custom.serial, info.serial);
  assert.equal(custom.customFirmware, "0.8.1.1");
  assert.equal(custom.firmwareDisplay, "v0.8.1.1 custom based on v0.1.0.0");
  assert.equal((await decode(mixed, { marker, runMode: 255 })).customFirmware, null);
  assert.equal((await decode(mixed, { marker, board: 0x0b })).customFirmware, null);
  marker[4] = 2;
  assert.equal((await decode(mixed, { marker })).customFirmware, null);
  assert.equal((await decode([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1])).serial, "012345678901");
  assert.equal((await decode(Array(12).fill(0))).serial, "000000000000");
  assert.equal((await decode(Array(12).fill(255))).serial, "255".repeat(12));
  console.log("PASS: DeviceInfo serial, native version, custom build marker, stock fallback and recovery/unknown marker handling. No hardware accessed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
