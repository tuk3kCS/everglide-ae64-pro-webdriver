"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const M = require("../../js/gamepad/model.js");
let checks = 0;
function check(value, message) { checks += 1; assert.ok(value, message); }
const original = fs.readFileSync(path.join(__dirname, "../../js/app/foundation.js"), "utf8");
const layoutLiteral = original.match(/const layout = (\[[\s\S]+?\n\]);/)[1];
const layout = vm.runInNewContext(`(${layoutLiteral})`, Object.create(null), { timeout: 100 });
const actual = layout.flatMap((row, uiRow) => row.map((key, col) => ({ label: key.n, width: key.u || 1, row: uiRow + 1, col })));
assert.deepEqual(M.KEYS.map(({ label, width, row, col }) => ({ label, width, row, col })), JSON.parse(JSON.stringify(actual))); checks += 1;
check(M.KEYS.length === 64 && M.CONTROLS.length === 24, "Exact physical layout and controller slots");
const d = M.validate(M.defaults());
check(M.CURVE_PRESETS.length === 7, "Seven Wootility presets");
assert.deepEqual(M.CURVE_PRESETS.map((preset) => preset.label), ["Linear", "Aggro", "Slow", "Smooth", "Steep", "Instant", "Turbo"]); checks++;
const custom = structuredClone(d);
custom.bindings[0].curve = [[25, 75], [100, 200], [150, 10], [200, 120]];
const shape = { ...M.validate(custom).bindings[0], startMm: 1, endMm: 3.55 };
check(M.level(shape, 1.20) === 0, "Initial travel stays neutral");
check(M.level(shape, 2.00) > M.level(shape, 2.50), "Output can decrease between ordered anchors");
check(M.level(shape, 3.00) === M.level(shape, 4.00), "The last anchor is held through bottom-out");
const legacy = { ...d, version: 1, bindings: d.bindings.map((binding) => ({ ...binding, curve: "linear" })) };
check(M.validate(legacy).bindings[0].curve[0][1] === 0, "Version 1 exports keep their original response when imported");
check(d.bindings.find((b) => b.control === "LT").key === 15, "Q is LT");
check(d.bindings.find((b) => b.control === "RT").key === 17, "E is RT");
for (const [start, end] of [[1, 3], [0.5, 3.5], [0.01, 4]]) {
  const b = { key: 15, startMm: start, endMm: end, curve: "linear" };
  check(M.level(b, start - 0.01) === 0 && M.level(b, start) === 0, "Zero before start");
  check(M.level(b, end) === 10000 && M.level(b, end + 1) === 10000, "Clamped maximum");
  check(M.level(b, (start + end) / 2) === 5000, "Range midpoint");
}
for (const curve of ["linear", "smooth"]) {
  const b = { key: 15, startMm: 0.5, endMm: 3.5, curve }; let previous = 0;
  for (let n = 0; n <= 4000; n += 1) { const value = M.level(b, n / 1000); check(value >= previous && value >= 0 && value <= 10000, `${curve}: monotonic bounded output`); previous = value; }
}
assert.throws(() => M.validate({ ...d, bindings: d.bindings.map((b) => ({ ...b, key: 1 })) }), /One physical key/); checks += 1;
for (const value of [NaN, Infinity, -1]) { const bad = structuredClone(d); bad.bindings[0].startMm = value; assert.throws(() => M.validate(bad)); checks += 1; }
for (const [start, end, max] of [[3, 1, 4], [1, 5, 4], [1, 1, 4], [0, 4, 0.001]]) { const bad = structuredClone(d); Object.assign(bad.bindings[0], { startMm: start, endMm: end, maxTravelMm: max }); assert.throws(() => M.validate(bad)); checks += 1; }
const travel = Array(64).fill(0), pressed = Array(64).fill(false);
travel[15] = travel[17] = 4;
check(M.evaluate(d, travel, pressed).lt === 255 && M.evaluate(d, travel, pressed).rt === 255, "Independent triggers can both be full");
const digital = structuredClone(d); digital.bindings.find((b) => b.control === "A").key = 58;
travel[58] = 4;
check(!M.evaluate(digital, travel, pressed).buttons.includes("A"), "Travel does not synthesize digital keyboard state");
pressed[58] = true; travel[58] = 0;
check(M.evaluate(digital, travel, pressed).buttons.includes("A"), "Existing keyboard pressed state controls A");
for (const mode of ["off", "controller", "mixed"]) { const c = { ...digital, mode }, out = M.evaluate(c, travel, pressed); check(mode === "off" ? out.lt === 0 && out.buttons.length === 0 : out.lt === 255 && out.buttons.includes("A"), `${mode}: output policy`); }
const c = structuredClone(d); c.sticks[0].deadzone = 0; travel.fill(0); travel[16] = travel[31] = 4;
let out = M.evaluate(c, travel, pressed); check(Math.hypot(out.lx, out.ly) <= 1.0001 && out.lx > 0 && out.ly > 0, "Circular diagonals stay bounded");
travel.fill(0); travel[29] = travel[31] = 4;
for (const opposition of ["difference", "neutral", "deeper"]) { c.sticks[0].opposition = opposition; check(M.evaluate(c, travel).lx === 0, "Equal opposing directions are neutral"); }
// The editor is mounted inside the main tab, not as a separate page.
const { fixture } = require("./fixture.cjs");
const f = fixture();
check(f.nodes.get("keyboard").innerHTML.match(/data-key=/g).length === 64, "Integrated hardware editor renders all 64 keys");
check(!f.nodes.get("keyboard").innerHTML.includes(" bound"), "Fresh previews have no controller assignments");
check(f.nodes.get("mappedCount").textContent === "0 assigned", "Fresh previews report zero assignments");
check(!f.nodes.get("controlPicker").innerHTML.includes('aria-pressed="true"'), "Opening the editor selects no controller action");
check(f.nodes.get("analogEditor").hidden && f.nodes.get("digitalEditor").hidden, "Tuning waits for a controller selection");
const empty = M.validate(M.emptyProfile());
check(empty.bindings.every((binding) => binding.key === null), "All 24 fresh controller slots are unassigned");
check(M.evaluate(empty, Array(64).fill(4), Array(64).fill(true)).lt === 0, "Unassigned keys cannot drive the controller");
check(f.nodes.get("apply").disabled === true, "No custom capability means no Apply");
check(!f.html.includes("https://"), "Hardware controls have no factory dependency");
f.component.dispose();
check(f.intervals.size === 0, "Leaving the tab stops its watchdog");
check([...f.events.hid.values()].every((set) => set.size === 0), "Leaving the tab removes HID listeners");
const fresh = fixture();
(async () => {
  await fresh.component.ready;
  check(fresh.saved().bindings.every((binding) => binding.key === null), "Initial draft persists empty assignments");
  fresh.nodes.get("controlPicker").listeners.click({ target: { closest: () => ({ dataset: { control: "LT" } }) } });
  check(fresh.saved().bindings.find((binding) => binding.control === "LT").key === 15, "A fresh profile still accepts manual assignments");
  check(fresh.nodes.get("tuningControl").textContent === "LT", "An explicit controller choice opens its tuning");
  check(fresh.nodes.get("curveSelector").innerHTML.match(/data-curve=/g).length === 7, "Editor renders seven presets");
  fresh.nodes.get("curveSelector").listeners.click({ target: { closest: () => ({ dataset: { curve: "steep" } }) } });
  assert.deepEqual(fresh.saved().bindings[0].curve, M.CURVE_PRESETS[4].points); checks++;
  fresh.nodes.get("curvePoint").listeners.change({ target: { value: "2" } });
  assert.equal(fresh.nodes.get("curvePointTravel").value, "2.759"); checks++;
  assert.equal(fresh.nodes.get("curvePointOutput").value, "135"); checks++;
  fresh.nodes.get("curvePointTravel").listeners.change({ target: { valueAsNumber: 2 } });
  assert.deepEqual(fresh.saved().bindings[0].curve[2], [128, 135]); checks++;
  assert.equal(fresh.nodes.get("curvePointTravel").value, "2.006"); checks++;
  fresh.nodes.get("curvePointTravel").listeners.keydown({ key: "ArrowUp", preventDefault() {} });
  assert.deepEqual(fresh.saved().bindings[0].curve[2], [129, 135]); checks++;
  fresh.nodes.get("curvePointTravel").listeners.change({ target: { valueAsNumber: 4 } });
  assert.deepEqual(fresh.saved().bindings[0].curve[2], [252, 135]); checks++;
  fresh.nodes.get("curvePointOutput").listeners.change({ target: { valueAsNumber: 200 } });
  check(fresh.saved().bindings[0].curve[2][1] === 200, "Integer output updates the selected anchor");
  check(fresh.saved().bindings[1].curve[2][1] !== 200, "Curves are independent per analog binding");
  fresh.selectKey(40);
  check(!fresh.nodes.get("controlPicker").innerHTML.includes('aria-pressed="true"'), "An unassigned key clears the previous controller selection");
  fresh.selectKey(15);
  check(fresh.nodes.get("tuningControl").textContent === "LT", "An assigned key opens its saved action");
  fresh.nodes.get("clearBinding").listeners.click();
  check(fresh.nodes.get("tuningControl").textContent === "—" && fresh.saved().bindings.every((b) => b.key === null), "Removing an assignment clears tuning and selection");
  for (const id of ["matchTravel", "restoreDefaults", "import", "export", "importFile"])
    check(!fresh.nodes.has(id), `Removed Gamepad action ${id} stays absent`);
  fresh.component.dispose();
  const shortProfile = M.defaults();
  shortProfile.bindings[0].endMm = 0.510;
  const short = fixture({ savedProfile: shortProfile });
  await short.component.ready;
  short.selectKey(15);
  short.nodes.get("curvePoint").listeners.change({ target: { value: "1" } });
  assert.equal(short.nodes.get("curvePointTravel").value, "0.502"); checks++;
  short.nodes.get("curvePointTravel").listeners.change({ target: { valueAsNumber: 0.502 } });
  assert.deepEqual(short.saved().bindings[0].curve[1], [60, 60]); checks++;
  short.component.dispose();
  console.log(`PASS: ${checks} model and integrated-UI checks.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
