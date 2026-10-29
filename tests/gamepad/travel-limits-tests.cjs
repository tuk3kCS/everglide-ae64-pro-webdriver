"use strict";
// Exercise the visible connect / fit-draft flow with the measured 3310um fixture.
// No device or browser access; transport requests are recorded in memory.
const assert = require("node:assert/strict");
const { fixture, Model: M, Protocol: P } = require("./fixture.cjs");
const wire = P.encode(M.defaults());
const rawCommands = [], reads = []; let closes = 0;
const transport = {
  connected: true,
  getPerformance: async (physical) => { reads.push([physical.row, physical.col]); return { axisRangeMax: 3310, calibrate: 1 }; },
  raw: async (request) => {
    rawCommands.push(request[1]);const r = request.slice(), data = new DataView(r.buffer);
    if (request[1] === P.CMD.INFO) { r[9] = 20;r.set([10, 0, 48, 0, 2, 24, 1, 0], 10);data.setUint32(18, 0, true);data.setUint16(24, 208, true);data.setUint32(26, P.crc32(wire), true); }
    else { assert.equal(request[1], P.CMD.READ);const offset = data.getUint16(14, true), length = request[16];r[9] = length + 6;r.set(wire.slice(offset, offset + length), 16); }
    return r;
  },
  close: async () => { closes++; },
};
async function main() {
  const f = fixture({ connectTarget: transport }); const { nodes } = f; await f.component.ready;
  assert.equal(nodes.get("matchTravel").disabled, true);
  await nodes.get("connect").listeners.click();
  assert.equal(nodes.get("matchTravel").disabled, false);
  assert.equal(nodes.get("endMm").value, "3.31");
  assert.equal(nodes.get("maxTravelMm").value, "3.31");
  assert.equal(reads.length, 6, "Default ranges adapt automatically on connect.");
  await nodes.get("matchTravel").listeners.click();
  assert.equal(reads.length, 12);
  assert.equal(nodes.get("endMm").value, "3.31");
  assert.equal(nodes.get("maxTravelMm").value, "3.31");
  assert.equal(nodes.get("startMm").value, "0.50");
  assert.match(nodes.get("deviceTravel").textContent, /3\.31 mm for Q/);
  assert.match(f.notices.at(-1).text, /Nothing was written/);
  assert.ok(f.saved().bindings.filter((b) => b.key !== null).every((b) => b.endMm === 3.31));
  assert.equal(rawCommands.filter((command) => command === P.CMD.READ).length, 5);
  assert.ok(rawCommands.every((command) => [P.CMD.INFO, P.CMD.READ].includes(command)), "Automatic load is read-only.");
  f.component.dispose(); assert.equal(closes, 0); assert.equal(f.intervals.size, 0);
  console.log("PASS: connected UI automatically uses 3.31mm limits and supports manual refresh without writing a configuration.");
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
