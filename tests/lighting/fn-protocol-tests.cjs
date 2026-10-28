"use strict";
const assert = require("node:assert/strict"), { spawn } = require("node:child_process");
const F = require("../../js/lighting/fn-rgb.js");
async function main() {
  assert.equal(F.crc32(Buffer.from("123456789")), 0xcbf43926);
  const colors = Array.from({ length: 126 }, (_, i) => "#" + [i, 255 - i, i ^ 0x73].map((v) => v.toString(16).padStart(2, "0")).join(""));
  assert.deepEqual(F.decode(F.encode(colors)), colors);
  assert.throws(() => F.encode(Array(64).fill("#ff0000")), /126/);
  assert.throws(() => F.encode(Array(126).fill("#12345z")), /126/);
  await assert.rejects(new F.Client({ raw: async (q) => Uint8Array.from([16, 255, ...Array(62).fill(0)]) }).capabilities(), F.UnsupportedFirmwareError);
  const forged = { raw: async (q) => { const b = q.slice();b[9] = 20;new DataView(b.buffer).setUint32(10, 123, true);return b; } };
  await assert.rejects(new F.Client(forged).capabilities(), F.UnsupportedFirmwareError);
  let sends = 0;
  const wrongProfile = new F.Client({ getCurrentConfig: async () => 2, raw: async () => { sends++;throw new Error("Must not send"); } });
  await assert.rejects(wrongProfile.write(0, 1, { enabled: true, colors, revision: 0 }), /Switch the onboard/);assert.equal(sends, 0);
  const harness = process.argv[process.argv.indexOf("--harness") + 1];
  if (!process.argv.includes("--harness")) { console.log("PASS: Fn RGB client validation and factory/forged capability rejection. C cross-protocol harness runs in firmware verify.py.");return; }
  const child = spawn(harness, [], { stdio: ["pipe", "pipe", "pipe"] });let pending, buffer = Buffer.alloc(0), activeProfile = 0, sent = [];
  child.stderr.on("data", (b) => process.stderr.write(b));
  child.on("error", (error) => pending?.reject(error));
  child.on("exit", (code) => { if (pending) pending.reject(new Error(`Firmware harness exited ${code}`)); });
  child.stdout.on("data", (b) => {
    buffer = Buffer.concat([buffer, b]);
    if (buffer.length >= 64 && pending) { const p = pending;pending = null;const result = Uint8Array.from(buffer.subarray(0, 64));buffer = buffer.subarray(64);p.resolve(result); }
  });
  const transport = { getCurrentConfig: async () => activeProfile, raw: async (q) => {
    if (pending) throw new Error("Concurrent harness request");sent.push(q.slice());
    return new Promise((resolve, reject) => { pending = { resolve, reject };child.stdin.write(q); });
  } };
  try {
    const client = new F.Client(transport), caps = await client.capabilities();assert.equal(caps.verified, true);assert.equal(caps.persistent, true);
    for (let profile = 0; profile < 4; profile++) for (let layer = 1; layer <= 3; layer++) {
      activeProfile = profile;const before = await client.read(profile, layer);assert.equal(before.enabled, false);assert.deepEqual(before.colors, Array(126).fill("#000000"));
      const nextColors = colors.map((c, i) => i === profile * 3 + layer ? "#a1b2c3" : c);
      const next = await client.write(profile, layer, { ...before, enabled: true, colors: nextColors });assert.equal(next.enabled, true);assert.deepEqual(next.colors, nextColors);
      const stale = sent.length;await assert.rejects(client.write(profile, layer, { ...before, enabled: true, colors }), /configuration changed/);
      assert.deepEqual(sent.slice(stale).map((q) => q[1]), [0x31]);
    }
    activeProfile = 0;const original = await client.read(0, 1), off = await client.write(0, 1, { ...original, enabled: false });assert.equal(off.enabled, false);assert.deepEqual(off.colors, original.colors);
    assert.ok(sent.every((q) => q.length === 64 && q[0] === 0x10 && q[1] >= 0x30 && q[1] <= 0x35));
    console.log(`PASS: browser client ↔ compiled C firmware, ${sent.length} real packets; 4×3 isolation, read-back, stale revisions and disable.`);
  } finally { child.stdin.end();child.kill(); }
}
main().catch((error) => { console.error(error);process.exitCode = 1; });
