"use strict";
// Offline tests only: fake transports and, optionally, a compiled stdin C harness.
const assert = require("node:assert/strict"), cp = require("node:child_process");
const Model = require("../../js/gamepad/model.js"), Protocol = require("../../js/gamepad/protocol.js");
let checks = 0;
const equal = (a, b) => { assert.deepEqual(a, b); checks++; };
const makeView = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);

async function main() {
  equal(Protocol.crc32(Buffer.from("123456789")), 0xcbf43926);
  const config = Model.defaults(), wire = Protocol.encode(config);
  equal(wire.length, 208); equal(Protocol.encode(Protocol.decode(wire)), wire);
  equal(Array.from(wire.slice(0, 16)), [65, 71, 67, 49, 1, 1, 2, 1, 1, 0, 244, 1, 244, 1, 24, 0]);
  const reordered = { ...config, bindings: [...config.bindings].reverse() };
  equal(Protocol.encode(reordered), wire);
  const corrupt = wire.slice(); corrupt[9] = 1; assert.throws(() => Protocol.decode(corrupt)); checks++;
  const unsupported = { raw: async () => { const r = new Uint8Array(64); r.set([16, 255]); return r; } };
  await assert.rejects(Protocol.probe(unsupported), Protocol.UnsupportedFirmwareError); checks++;
  let writes = 0;
  const wrongBoard = { raw: async (request) => { const reply = request.slice(); reply[9] = 20; reply.set([1, 2, 3, 4, 2, 24, 1, 0], 10); return reply; } };
  await assert.rejects(Protocol.upload(wrongBoard, config), Protocol.UnsupportedFirmwareError); equal(writes, 0);
  // The connected AE64 reports 3310um, while the original example asks for 3500um.
  // Verify the mismatch is caught before BEGIN/WRITE, and fitting changes only the draft.
  const queried = [], limitedTransport = {
    raw: async (request) => { if (request[1] !== Protocol.CMD.INFO) { writes++; throw new Error("Unexpected configuration write"); } const r = request.slice(); r[9] = 20; r.set([10, 0, 48, 0, 2, 24, 1, 0], 10); makeView(r).setUint16(24, 208, true); return r; },
    getPerformance: async (position) => { queried.push([position.row, position.col]); return { axisRangeMax: 3310, calibrate: 1 }; },
  };
  const limits = await Protocol.readTravelLimits(limitedTransport, config);
  equal(limits.length, 6); equal(queried.slice(0, 2), [[2, 1], [2, 3]]);
  assert.throws(() => Protocol.validateTravelLimits(config, limits), /Q \(LT\).*3\.50.*3\.31/); checks++;
  await assert.rejects(Protocol.upload(limitedTransport, config), /3\.31 mm/); equal(writes, 0);
  const fitted = Protocol.fitTravelLimits(config, limits);
  equal(config.bindings[0].endMm, 3.5); equal(fitted.bindings[0].endMm, 3.31); equal(fitted.bindings[0].maxTravelMm, 3.31);
  equal(fitted.bindings[0].startMm, 0.5); Protocol.validateTravelLimits(fitted, limits); checks++;
  const alreadyShort = Model.defaults(); alreadyShort.bindings[0].startMm = 1; alreadyShort.bindings[0].endMm = 3;
  equal(Protocol.fitTravelLimits(alreadyShort, limits).bindings[0].endMm, 3);
  const tooDeep = Model.defaults(); tooDeep.bindings[0].startMm = 3.4;
  assert.throws(() => Protocol.fitTravelLimits(tooDeep, limits), /lower Start/); checks++;
  await assert.rejects(Protocol.readTravelLimits({ getPerformance: async () => ({ axisRangeMax: 0 }) }, config), /usable switch travel/); checks++;
  let aborts = 0;
  const rejectedCommit = { raw: async (request) => {
    if (request[1] === Protocol.CMD.INFO) return limitedTransport.raw(request);
    const r = request.slice(); r[9] = 0;
    if (request[1] === Protocol.CMD.COMMIT) r[8] = 4;
    if (request[1] === Protocol.CMD.ABORT) aborts++;
    return r;
  } };
  await assert.rejects(Protocol.upload(rejectedCommit, config), (e) => e instanceof Protocol.KeyboardRejectedError && e.status === 4 && !e.message.includes("could not be confirmed"));
  checks++; equal(aborts, 1);
  for (const [start, end] of [[1, 3], [0.5, 3.5]]) {
    const c = Model.defaults(); c.bindings[0].startMm = start; c.bindings[0].endMm = end;
    const b = Protocol.encode(c); equal(makeView(b).getUint16(18, true), start * 1000); equal(makeView(b).getUint16(20, true), end * 1000);
  }
  if (process.argv[2]) {
    const processC = cp.spawn(process.argv[2], [], { stdio: ["pipe", "pipe", "pipe"] });
    let received = Buffer.alloc(0), pending = null, stderr = "";
    processC.stderr.on("data", (x) => { stderr += x; });
    processC.stdout.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);
      if (pending && received.length >= 64) { const p = pending; pending = null; clearTimeout(p.timer); const bytes = received.subarray(0, 64); received = received.subarray(64); p.resolve(new Uint8Array(bytes)); }
    });
    processC.on("error", (error) => pending?.reject(error));
    const exit = new Promise((resolve) => processC.on("exit", resolve));
    processC.stdin.write(Buffer.from(wire));
    const transport = { raw: (request) => new Promise((resolve, reject) => {
      if (pending) return reject(new Error("Overlapping raw transactions"));
      const timer = setTimeout(() => { pending = null; reject(new Error(`C harness timeout: ${stderr}`)); }, 3000);
      pending = { resolve, reject, timer }; processC.stdin.write(Buffer.from(request));
    }) };
    try {
      const info = await Protocol.probe(transport); equal(info.revision, 7); equal(info.transports.xinput, true); equal(info.persistent, false);
      const initial = await Protocol.read(transport); equal(initial.bytes, wire);
      config.bindings[0].startMm = 1; config.bindings[0].endMm = 3; config.bindings[1].curve = "smooth";
      const result = await Protocol.upload(transport, config); equal(result, { revision: 8, persistent: false, verified: true });
      const actual = await Protocol.read(transport); equal(actual.bytes, Protocol.encode(config));
      // Native C handler rejects malformed geometry before installing any mapping.
      const invalid = Protocol.encode(config); invalid[18] = 0xff; invalid[19] = 0xff;
      const token = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
      const begin = new Uint8Array(18); makeView(begin).setUint32(0, 8, true); makeView(begin).setUint32(4, Protocol.crc32(invalid), true); makeView(begin).setUint16(8, 208, true); begin.set(token, 10);
      const commit = new Uint8Array(16); commit.set(token); makeView(commit).setUint32(8, Protocol.crc32(invalid), true); makeView(commit).setUint32(12, 8, true);
      let r = await transport.raw(Protocol.packet(Protocol.CMD.BEGIN, begin)); equal(r[8], 0);
      for (let o = 0; o < 208; o += 40) { const p = new Uint8Array(10 + Math.min(40, 208 - o)); p.set(token); makeView(p).setUint16(8, o, true); p.set(invalid.slice(o, o + 40), 10); r = await transport.raw(Protocol.packet(Protocol.CMD.WRITE, p)); equal(r[8], 0); }
      r = await transport.raw(Protocol.packet(Protocol.CMD.COMMIT, commit)); equal(r[8], 4);
      equal((await Protocol.read(transport)).bytes, Protocol.encode(config)); equal((await Protocol.probe(transport)).revision, 8);
      // Missing data, malformed lengths, stale revision and CRC mismatch are bounded.
      makeView(begin).setUint32(0, 7, true); r = await transport.raw(Protocol.packet(Protocol.CMD.BEGIN, begin)); equal(r[8], 3);
      r = await transport.raw(Protocol.packet(Protocol.CMD.ABORT, token)); equal(r[8], 0);
      makeView(begin).setUint32(0, 8, true); r = await transport.raw(Protocol.packet(Protocol.CMD.BEGIN, begin)); equal(r[8], 0);
      r = await transport.raw(Protocol.packet(Protocol.CMD.COMMIT, commit)); equal(r[8], 5);
      const malformed = Protocol.packet(Protocol.CMD.WRITE); malformed[9] = 55; r = await transport.raw(malformed); equal(r[8], 2);
      r = await transport.raw(Protocol.packet(Protocol.CMD.ABORT, token)); equal(r[8], 0);
      r = await transport.raw(Protocol.packet(Protocol.CMD.COMMIT, commit)); equal(r[8], 3);
      const after = await Protocol.read(transport); equal(after.revision, 8);
      processC.stdin.end(); equal(await exit, 0);
    } finally { processC.kill(); }
  }
  console.log(`PASS: ${checks} codec/identity/atomic-transfer checks${process.argv[2] ? " against compiled C staging engine" : " (C harness not selected)"}.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
