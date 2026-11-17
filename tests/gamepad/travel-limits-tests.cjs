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
    if (request[1] === P.CMD.INFO) { r[9] = 20;r.set([10, 0, 48, 0, 34, 24, 1, 0], 10);data.setUint32(18, 0, true);data.setUint16(24, 208, true);data.setUint32(26, P.crc32(wire), true); }
    else { assert.equal(request[1], P.CMD.READ);const offset = data.getUint16(14, true), length = request[16];r[9] = length + 6;r.set(wire.slice(offset, offset + length), 16); }
    return r;
  },
  close: async () => { closes++; },
};
async function main() {
  let refreshedTravel = 3310;
  const f = fixture({ connectTarget: transport, getKeyTravel: (key) => ({ key: key.id, maxTravelUm: refreshedTravel }) });
  const { nodes } = f; await f.component.ready;
  assert.equal(nodes.get("connect").hidden, false);
  await nodes.get("connect").listeners.click();
  f.selectKey(15);
  assert.equal(nodes.get("connect").hidden, true);
  assert.equal(nodes.get("endMm").value, "3.310");
  assert.equal(nodes.get("maxTravelMm").value, "3.310");
  assert.equal(reads.length, 64, "Default ranges adapt automatically on connect.");
  refreshedTravel = 3150;
  f.component.acceptSettingsRefresh(null, null, transport);
  assert.equal(reads.length, 64, "Reuse the settings refresh's travel data without sending duplicate reads.");
  assert.equal(nodes.get("endMm").value, "3.310");
  assert.equal(nodes.get("maxTravelMm").value, "3.310");
  assert.equal(nodes.get("startMm").value, "0.500");
  assert.match(nodes.get("deviceTravel").textContent, /3\.15 mm for Q/);
  assert.equal(nodes.get("endMm").max, "3.15");
  assert.match(nodes.get("editorError").textContent, /3\.150 mm/);
  assert.match(nodes.get("travelSyncStatus").textContent, /read automatically.*64 keys/);
  assert.ok(f.saved().bindings.filter((b) => b.key !== null).every((b) => b.endMm === 3.31));
  assert.equal(rawCommands.filter((command) => command === P.CMD.READ).length, 5);
  assert.ok(rawCommands.every((command) => [P.CMD.INFO, P.CMD.READ].includes(command)), "Automatic load is read-only.");
  f.component.dispose(); assert.equal(closes, 0); assert.equal(f.intervals.size, 0);
  console.log("PASS: connect-time travel fitting and shared refresh bounds without extra reads or writes.");
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
