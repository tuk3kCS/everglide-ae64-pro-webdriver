"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { KEYS } = require("../../js/gamepad/model.js");
const listeners = {}, keys = KEYS.map((key) => ({ ...key, n: key.label }));
let reads = 0, pickerOpens = 0, renders = 0, overviewBinds = 0;
const board = { addEventListener: (name, fn) => { listeners[name] = fn; } };
const context = {
  state: { page: "overview", profile: { selected: 15 }, selectedKeys: new Set([15]) }, keys,
  document: { querySelector: (selector) => selector === ".layout-board" ? board : null, querySelectorAll: () => [] },
  bindGamepadOverview: () => { overviewBinds++; }, connected: () => true,
  render: () => { renders++; }, readSelectedKey: async () => { reads++; },
  openMappingPicker: () => { pickerOpens++; }, showToast: (message) => { throw new Error(message); },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../../js/app/interactions.js"), "utf8"), context);
async function main() {
  context.bindPage();assert.equal(overviewBinds, 1);assert.equal(typeof listeners.click, "function");
  for (const id of [0, 16, 29, 40, 60, 63]) {
    listeners.click({ target: { closest: () => ({ dataset: { key: String(id) } }) } });
    await Promise.resolve();
    assert.equal(context.state.profile.selected, id);assert.deepEqual([...context.state.selectedKeys], [id]);
  }
  for (const key of [null, { dataset: { key: "NaN" } }, { dataset: { key: "999" } }])
    listeners.click({ target: { closest: () => key } });
  assert.equal(context.state.profile.selected, 63);assert.equal(reads, 6);assert.equal(pickerOpens, 0);assert.equal(renders, 12);
  console.log("PASS: Overview binds key clicks, selects all keyboard rows including Enter/Fn/arrows, reads selected settings, ignores background/invalid clicks and keeps the mapping picker closed.");
}
main().catch((error) => { console.error(error);process.exitCode = 1; });
