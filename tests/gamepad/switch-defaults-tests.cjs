"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { fixture, Model: M } = require("./fixture.cjs");
const root = path.resolve(__dirname, "../..");
const ur = JSON.parse(fs.readFileSync(path.join(root, "assets/hall-effect-switches/supported-switches.json"))).find((x) => Number(x.detail_axis_id) === 12432);
assert.equal(Number(ur.axis_range_max), 3310);
assert.deepEqual(M.defaultTravel(3.31), { startMm: 0.5, endMm: 3.31, maxTravelMm: 3.31 });
assert.deepEqual(M.defaultTravel(0.01), { startMm: 0, endMm: 0.01, maxTravelMm: 0.01 });
assert.throws(() => M.defaultTravel(0.005));
const provider = (key) => ({ key: key.id, maxTravelUm: key.id === 17 ? 3600 : Number(ur.axis_range_max), switchName: key.id === 17 ? "Other switch" : "UR Ice Magnetic" });
async function main() {
  const f = fixture({ getKeyTravel: provider });await f.component.ready;
  assert.equal(f.nodes.get("maxTravelMm").value, "3.31");assert.equal(f.nodes.get("endMm").value, "3.31");assert.match(f.nodes.get("deviceTravel").textContent, /UR Ice Magnetic/);
  const rt = f.saved().bindings.find((b) => b.control === "RT");assert.equal(rt.maxTravelMm, 3.6);assert.equal(rt.endMm, 3.5);
  // Newly assigned controls use the physical key's switch, not an unassigned 4mm default.
  f.nodes.get("controlPicker").listeners.click({ target: { closest: () => ({ dataset: { control: "RX+" } }) } });
  assert.equal(f.saved().bindings.find((b) => b.control === "RX+").maxTravelMm, 3.31);
  // A deliberately tuned window survives reloads and automatic default refreshes.
  for (const [field, value] of Object.entries({ startMm: "1", endMm: "3", maxTravelMm: "3.31" })) f.nodes.get(field).value = value;
  f.nodes.get("startMm").listeners.change();const manual = f.saved();f.component.dispose();
  const reload = fixture({ savedProfile: manual, getKeyTravel: (key) => ({ key: key.id, maxTravelUm: 3600, switchName: "New switch" }) });await reload.component.ready;
  const custom = reload.saved().bindings.find((b) => b.control === "RX+");assert.deepEqual([custom.startMm, custom.endMm, custom.maxTravelMm], [1, 3, 3.6]);
  assert.equal(reload.saved().bindings.find((b) => b.control === "RT").maxTravelMm, 3.6);
  await reload.nodes.get("restoreDefaults").listeners.click();assert.equal(reload.nodes.get("maxTravelMm").value, "3.60");reload.component.dispose();
  const legacy = fixture({ savedProfile: M.defaults(), getKeyTravel: provider });await legacy.component.ready;assert.equal(legacy.nodes.get("maxTravelMm").value, "3.31");legacy.component.dispose();
  const oldWindow = M.defaults();Object.assign(oldWindow.bindings[0], { startMm: 1, endMm: 3 });
  const upgraded = fixture({ savedProfile: oldWindow, getKeyTravel: provider });await upgraded.component.ready;assert.deepEqual([upgraded.saved().bindings[0].startMm, upgraded.saved().bindings[0].endMm, upgraded.saved().bindings[0].maxTravelMm], [1, 3, 3.31]);
  upgraded.nodes.get("maxTravelMm").value = "3.20";upgraded.nodes.get("maxTravelMm").listeners.change();const explicit = upgraded.saved();upgraded.component.dispose();
  const overridden = fixture({ savedProfile: explicit, getKeyTravel: provider });await overridden.component.ready;assert.equal(overridden.saved().bindings[0].maxTravelMm, 3.2);overridden.component.dispose();
  const caps = { verified: true, protocolVersion: 1, boardId: 0x0030000a, transports: { xinput: true } };
  const readDefault = fixture({ transport: { connected: true }, getKeyTravel: provider, protocol: { probe: async () => caps, read: async () => ({ ...caps, config: M.defaults() }) } });
  await readDefault.component.ready;await readDefault.nodes.get("connect").listeners.click();assert.equal(readDefault.nodes.get("maxTravelMm").value, "3.31");assert.match(readDefault.notices.at(-1).text, /Apply to activate/);readDefault.component.dispose();
  // Integration resolves each visual key to its selector record and caps against actual firmware.
  const physical = { id: 99, uiRow: 1, col: 1 }, context = { keys: [physical], state: { profile: { performance: { 99: { axisV2Id: 12432, axisRangeMax: 4000 } } }, hardware: { performance: new Map([[99, { axisRangeMax: 3200 }]]) }, switchCatalog: [{ axisV2Id: 12432, axisRangeMax: 3310, name: "UR Ice Magnetic" }] } };
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root, "js/app/gamepad-page.js"), "utf8"), context);context.key = M.KEYS[15];
  assert.equal(vm.runInContext("gamepadSwitchTravel(key).maxTravelUm", context), 3200);
  context.state.hardware.performance.clear();assert.equal(vm.runInContext("gamepadSwitchTravel(key).maxTravelUm", context), 3310);
  console.log("PASS: UR Ice database defaults, mixed switches, new assignments, legacy migration, manual windows, reload/restore and actual keyboard limits. No hardware writes.");
}
main().catch((error) => { console.error(error);process.exitCode = 1; });
