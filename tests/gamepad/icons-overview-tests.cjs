"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const M = require("../../js/gamepad/model.js"), Icons = require("../../js/gamepad/icons.js"), { fixture } = require("./fixture.cjs");
const root = path.resolve(__dirname, "../..");
for (const control of M.CONTROLS) {
  const filename = Icons.files[control.id];assert.ok(filename, `${control.id} has artwork`);assert.ok(fs.existsSync(path.join(root, "assets/controller_icons", filename)));
  assert.match(Icons.html(control.id), /aria-hidden="true"/);assert.match(Icons.html(control.id), /controller_icons\//);
}
assert.equal(new Set(Object.values(Icons.files)).size, 24);
assert.equal(Icons.files["LY+"], "12_left_stick_up.png");assert.equal(Icons.files["LY-"], "13_left_stick_down.png");
assert.equal(Icons.files["RY+"], "17_right_stick_up.png");assert.equal(Icons.files["RX-"], "19_right_stick_left.png");
const navigation = fs.readFileSync(path.join(root, "index.html"), "utf8").match(/<nav id="sideNav"[\s\S]*?<\/nav>/)[0];
assert.ok(navigation.indexOf('data-page="advanced"') < navigation.indexOf('data-page="gamepad"'));
assert.ok(navigation.indexOf('data-page="gamepad"') < navigation.indexOf('data-page="lighting"'));
assert.match(fs.readFileSync(path.join(root, ".github/workflows/pages.yml"), "utf8"), /cp assets\/controller_icons\/\*\.png _site\/assets\/controller_icons\//);
const transport = { connected: true };let saved = M.defaults(), resolveRead;
const c = { window: null, state: { transport, page: "overview" }, connected: () => c.state.transport?.connected,
  localStorage: { getItem: () => saved ? JSON.stringify(saved) : null }, esc: (value) => String(value).replace(/[&<>"]/g, ""),
  AE64GamepadModel: M, AE64ControllerIcons: Icons, AE64GamepadProtocol: { read: async () => new Promise((resolve) => { resolveRead = resolve; }) }, render() {} };
c.window = c;vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root, "js/app/gamepad-overview.js"), "utf8"), c);
const run = (code) => vm.runInContext(code, c);
async function main() {
  assert.equal(run("gamepadOverviewSnapshot().source"), "draft");
  assert.match(run("gamepadOverviewPanel()"), /LOCAL DRAFT/);
  c.physicalQ = { uiRow: 1, col: 1 };assert.match(run("overviewGamepadKeyBadge(physicalQ)"), /23_left_trigger/);
  run("rememberGamepadProfile(gamepadDraft(),state.transport)");assert.equal(run("gamepadOverviewSnapshot().source"), "active");
  saved.name = "Local name only";assert.equal(run("gamepadOverviewSnapshot().source"), "active");
  saved.mode = "off";assert.equal(run("gamepadOverviewSnapshot().source"), "draft");assert.match(run("gamepadOverviewPanel()"), /output disabled/);assert.match(run("overviewGamepadKeyBadge(physicalQ)"), /inactive/);
  const read = run("refreshGamepadOverview(true)");c.state.transport = { connected: true };resolveRead({ config: M.defaults() });await read;
  assert.notEqual(run("gamepadOverviewSnapshot().source"), "active", "Old session replies cannot mark the new connection active");
  saved = null;c.state.transport = null;assert.equal(run("gamepadOverviewSnapshot().source"), "none");
  const f = fixture();await f.component.ready;
  assert.equal((f.nodes.get("controlPicker").innerHTML.match(/class="controller-icon"/g) || []).length, 24);
  assert.equal((f.nodes.get("keyboard").innerHTML.match(/class="controller-icon"/g) || []).length, 6);
  assert.equal((f.nodes.get("previewButtons").innerHTML.match(/class="controller-icon"/g) || []).length, 14);f.component.dispose();
  console.log("PASS: all 24 icon files/directions, picker/key/preview artwork, Overview draft/active/off states, stale connections and sidebar order.");
}
main().catch((error) => { console.error(error);process.exitCode = 1; });
