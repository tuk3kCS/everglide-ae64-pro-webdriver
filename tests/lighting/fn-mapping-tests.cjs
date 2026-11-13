"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.resolve(__dirname, "../..");
function fixture() {
  const keys = [0, 1, 2].map((id) => ({ id, n: String.fromCharCode(65 + id) }));
  const profile = () => ({ schema: 4, selected: 0, layer: 0, profileIndex: 0,
    performance: {}, settings: {}, combinationBases: {}, macroBases: {},
    keycodes: Object.fromEntries([0,1,2,3].map((layer) => [layer, { 0: 4 + layer, 1: 10 + layer, 2: 20 + layer }])),
    lighting: { base: {}, palette: [], perKey: {}, customEnabled: {}, decorative: { base: {}, palette: [], perLed: [], customEnabled: [] } } });
  const state = { profile: profile(), timers: {}, page: "overview", hardware: { keycodes: new Map() },
    switchAssignmentKeys: new Set(), dirty: { performance: new Set(), mapping: new Set(), customLighting: new Set(), decorativeLighting: new Set(), advancedRemovals: new Set(), settings: new Set() } },
    writes = [], stored = new Map(), nodes = new Map(), notices = [];
  let isConnected = false;
  const context = { state, keys, KEYCODE_GROUPS: { keyboard: [{ code: 4, label: "A" }] },
    driverStorage: { getItem: () => null, setItem: (...args) => stored.set(...args) },
    document: { querySelector: (selector) => { if (!nodes.has(selector)) nodes.set(selector, { innerHTML: "", textContent: "", showModal() {}, close() {} }); return nodes.get(selector); } },
    defaultProfile: profile, clone: (value) => JSON.parse(JSON.stringify(value)), mergeDecorative: (base, saved) => ({ ...base, ...saved }),
    connected: () => isConnected, toolOperationBusy: () => false, render() {}, renderStatus() {}, stopPolling() {}, showProgress() {}, hideProgress() {}, log() {},
    startProfilePolling() {}, stopProfilePolling() {},
    showToast: (message) => notices.push(message), position: (key) => ({ row: 1, col: key.id }),
    STORAGE_KEY: "test-profile", SAVE_GROUP: { LAYOUT: 4 }, DECORATIVE_COLS: 0,
    dirtyCount: () => state.dirty.mapping.size + state.dirty.performance.size,
    clearDirty() { for (const [key, value] of Object.entries(state.dirty)) { if (value instanceof Set) value.clear(); else state.dirty[key] = false; } },
    setTimeout, clearTimeout, console };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "js/app/mapping.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "js/app/profiles.js"), "utf8"), context);
  state.transport = { async getCurrentConfig() { return 0; }, async setKeyCode(address, keycode, layer) { writes.push({ ...address, layer, keycode }); },
    async getKeyCode(address, layer) { return { keycode: writes.findLast((item) => item.col === address.col && item.layer === layer).keycode }; }, async saveParameters() {} };
  return { state, writes, stored, notices, context, run: (code) => vm.runInContext(code, context), connect: () => { isConnected = true; } };
}
(async () => {
  for (const code of [0xf101, 0xf102, 0xf103]) {
    const f = fixture(), untouched = [0,1,2,3].map((layer) => f.state.profile.keycodes[layer][1]);
    f.run("state.selectedKeys = new Set([0,2])");f.run(`applyMappingPickerKeycode(${code})`);
    for (const id of [0,2]) { assert.equal(f.state.profile.keycodes[0][id], code);for (const layer of [1,2,3])assert.equal(f.state.profile.keycodes[layer][id], 1); }
    assert.deepEqual([0,1,2,3].map((layer) => f.state.profile.keycodes[layer][1]), untouched);
    assert.equal(f.state.dirty.mapping.size, 8, "All selected trigger and release-inheritance mappings are staged");
    assert.equal(f.run("stageFnReleaseMappings()"), 0, "The guard is idempotent");
    f.connect();assert.equal(await f.run("applyChanges()"), true, f.notices.at(-1));
    assert.equal(f.writes.length, 8);assert.equal(f.writes.filter((item) => item.layer > 0 && item.keycode === 1).length, 6);
    assert(f.stored.has("test-profile"));
  }
  const nested = fixture();nested.state.profile.layer = 1;nested.run("applyMappingPickerKeycode(0xf103)");
  assert.equal(nested.state.profile.keycodes[0][0], 4);assert.equal(nested.state.profile.keycodes[1][0], 0xf103);
  assert.equal(nested.state.profile.keycodes[2][0], 1);assert.equal(nested.state.profile.keycodes[3][0], 1);
  const ordinary = fixture();ordinary.run("applyMappingPickerKeycode(44)");assert.equal(ordinary.state.dirty.mapping.size, 1);assert.equal(ordinary.state.profile.keycodes[1][0], 5);
  const metadata = fixture();metadata.state.profile.combinationBases = { "0:1:0": 4, "0:1:1": 10 };metadata.state.profile.macroBases = { "0:2:0": 5, "0:2:1": 11 };
  metadata.run("applyMappingPickerKeycode(0xf102)");
  assert.deepEqual(metadata.state.profile.combinationBases, { "0:1:1": 10 });assert.deepEqual(metadata.state.profile.macroBases, { "0:2:1": 11 });
  const boundaries = fixture();boundaries.state.profile.keycodes[0][0] = 0xf102;boundaries.state.dirty.mapping.add("0:0");
  boundaries.run("requestApplyChanges()");assert.equal(boundaries.state.dirty.mapping.size, 4);
  boundaries.state.profile.keycodes[2][0] = 18;boundaries.state.dirty.mapping.delete("2:0");
  assert.equal(await boundaries.run("applyChanges()"), false);assert.equal(boundaries.state.profile.keycodes[2][0], 1, "Apply rechecks release inheritance even outside the picker");assert.equal(boundaries.writes.length, 0, "Offline edits never write");
  const imported = fixture(), incoming = JSON.parse(JSON.stringify(imported.state.profile));incoming.keycodes[0][2] = 0xf103;
  imported.context.file = { text: async () => JSON.stringify({ profile: incoming }) };
  await imported.run("importProfile(file)");
  assert.equal(imported.state.profile.keycodes[0][2], 0xf103);for (const layer of [1,2,3])assert.equal(imported.state.profile.keycodes[layer][2], 1);
  assert.deepEqual([0,1,2,3].map((layer) => imported.state.profile.keycodes[layer][1]), [10,11,12,13]);
  const existing = fixture();existing.state.profile.keycodes[0][0] = 0xf102;existing.state.profile.keycodes[0][1] = 22;existing.state.dirty.mapping.add("0:1");
  existing.run("stageFnReleaseMappings()");assert.equal(existing.state.profile.keycodes[1][0], 5, "Unstaged onboard mappings are untouched");
  console.log("PASS: Fn1/2/3 release inheritance, multi-key/nested assignment, import, apply review/write verification, idempotence and unrelated-key preservation. No hardware.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
