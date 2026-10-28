"use strict";
// Exercise the visible connect / fit-draft flow with the measured 3310um fixture.
// No device or browser access; transport requests are recorded in memory.
const assert = require("node:assert/strict");
const { fixture, Protocol: P } = require("./fixture.cjs");
const rawCommands = [], reads = []; let closes = 0;
const transport = {
  connected: true,
  getPerformance: async (physical) => { reads.push([physical.row, physical.col]); return { axisRangeMax: 3310, calibrate: 1 }; },
  raw: async (request) => { rawCommands.push(request[1]); assert.equal(request[1], P.CMD.INFO); const r = request.slice(); r[9] = 20; r.set([10, 0, 48, 0, 2, 24, 1, 0], 10); new DataView(r.buffer).setUint16(24, 208, true); return r; },
  close: async () => { closes++; },
};
async function main() {
  const f = fixture({ connectTarget: transport }); const { nodes } = f; await f.component.ready;
  assert.equal(nodes.get("matchTravel").disabled, true);
  await nodes.get("connect").listeners.click();
  assert.equal(nodes.get("matchTravel").disabled, false);
  assert.equal(nodes.get("endMm").value, "3.50");
  await nodes.get("matchTravel").listeners.click();
  assert.equal(reads.length, 6);
  assert.equal(nodes.get("endMm").value, "3.31");
  assert.equal(nodes.get("maxTravelMm").value, "3.31");
  assert.equal(nodes.get("startMm").value, "0.50");
  assert.match(nodes.get("deviceTravel").textContent, /3\.31 mm for Q/);
  assert.match(f.notices.at(-1).text, /Nothing was written/);
  assert.ok(f.saved().bindings.filter((b) => b.key !== null).every((b) => b.endMm === 3.31));
  assert.deepEqual(rawCommands, [P.CMD.INFO]);
  f.component.dispose(); assert.equal(closes, 0); assert.equal(f.intervals.size, 0);
  console.log("PASS: connected UI reads 3.31mm limits and fixes all six draft ranges without writing a configuration.");
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
