"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
function fixture({ supported = true } = {}) {
  const calls = [], color = { r: 18, g: 52, b: 86, custom: true }, keys = [{ id: 0, n: "A" }, { id: 1, n: "Space" }];
  const lighting = { base: { mode: 0 }, palette: ["#000000"], perKey: { 0: "#ffffff", 1: "#ffffff" }, customEnabled: { 0: false, 1: false }, decorative: { base: { mode: 0 }, palette: ["#000000"], perLed: Array(38).fill("#ffffff"), customEnabled: Array(38).fill(false) } };
  const transport = { connected: true, getLightingBase: async (area) => ({ mode: 4 + area }), getLightingPalette: async () => [color], readCustomLighting: async (rows, cols, area) => { calls.push(`matrix:${area}`);return Array(area ? 38 : 126).fill(color); } };
  const state = { transport, page: "lighting", profile: { profileIndex: 0, lighting }, original: { lighting: JSON.parse(JSON.stringify(lighting)) }, hardware: { keycodes: new Map() }, timers: {}, dirty: { customLighting: new Set([0]), decorativeLighting: new Set([1]), lightingBase: false, lightingPalette: false, decorativeBase: false, decorativePalette: false } };
  let read = async (profile, layer) => ({ enabled: layer === 2, colors: Array(126).fill(`#00000${layer}`), revision: profile + 7 });
  const client = { async capabilities() { return { verified: supported, profiles: 4, layers: 3, rows: 6, cols: 21 }; }, async read(profile, layer) { calls.push(`fn:${profile}:${layer}`);return read(profile, layer); }, write() { throw Error("Automatic lighting reads must not write"); } };
  const c = { state, keys, console, clearTimeout, Map, Set, window: { AE64FnRgb: { Client: class { constructor() { return client; } } } },
    connected: () => Boolean(state.transport?.connected), esc: String,
    normalizeHex: (s) => /^#[\da-f]{6}$/i.test(s) ? s.toLowerCase() : null,
    lightingMatrixIndexes: (key) => key.id === 1 ? [6, 7, 8, 9, 10] : [0],
    rgbToHex: (record) => `#${[record.r, record.g, record.b].map((n) => n.toString(16).padStart(2, "0")).join("")}`,
    hardwareLayerReady: () => false, readKeymapLayer: async (layer) => { calls.push(`keymap:${layer}`); },
    stopPolling() {}, stopProfilePolling() {}, startProfilePolling() {}, renderStatus() {}, render() {},
    document: { querySelector: () => null, querySelectorAll: () => [] }, MATRIX_ROWS: 6, MATRIX_COLS: 21, DECORATIVE_ROWS: 1, DECORATIVE_COLS: 38,
  };
  vm.createContext(c);
  for (const file of ["fn-lighting.js", "live.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../../js/app", file), "utf8"), c);
  return { c, state, transport, calls, setRead: (fn) => { read = fn; }, run: (code) => vm.runInContext(code, c) };
}
async function main() {
  const f = fixture();await f.run("probeFnLighting(state.transport)");await f.run("readLightingProfiles()");
  assert.deepEqual(f.calls.filter((s) => s.startsWith("fn:")), ["fn:0:1", "fn:0:2", "fn:0:3"]);
  assert.deepEqual(f.calls.filter((s) => s.startsWith("keymap:")), ["keymap:0", "keymap:1", "keymap:2", "keymap:3"]);
  assert.equal(f.state.profile.lighting.base.mode, 4);assert.equal(f.state.profile.lighting.decorative.base.mode, 5);
  assert.equal(f.state.profile.lighting.perKey[0], "#ffffff");assert.equal(f.state.profile.lighting.perKey[1], "#123456");
  assert.equal(f.state.original.lighting.perKey[1], "#123456");assert.equal(f.state.original.lighting.perKey[0], "#ffffff");
  assert.equal(f.state.profile.lighting.decorative.perLed[1], "#ffffff");assert.equal(f.state.profile.lighting.decorative.perLed[0], "#123456");
  assert.equal(f.run("fnLightingView.drafts.size"), 3);assert.equal(f.run("fnLightingView.drafts.get('0:2').enabled"), true);
  assert.match(f.run("lightingReadStatus()"), /Fn 1, Fn 2 and Fn 3 ready/);assert.equal(f.state.fnLightingBusy, false);
  const count = f.calls.length;await f.run("readLightingProfiles()");assert.equal(f.calls.length, count, "Rerenders and Fn tabs reuse the automatic snapshot");
  f.run("fnLightingView.drafts.get('0:1').dirty=true;fnLightingView.drafts.get('0:1').colors[0]='#abcdef'");
  f.state.dirty.lightingBase = true;f.state.profile.lighting.base.mode = 18;
  await f.run("readLightingProfiles({force:true})");assert.equal(f.run("fnLightingView.drafts.get('0:1').colors[0]"), "#abcdef");assert.equal(f.state.profile.lighting.base.mode, 18);
  assert.equal(f.calls.filter((s) => s === "fn:0:1").length, 1, "Refresh preserves dirty Fn layers");
  f.state.profile.profileIndex = 1;let fail = true;
  f.setRead(async (profile, layer) => { if (layer === 2 && fail) throw Error("Fn 2 timeout");return { enabled: true, colors: Array(126).fill("#654321"), revision: 9 }; });
  await f.run("readLightingProfiles()");assert.ok(f.run("fnLightingView.drafts.has('1:3')"));assert.match(f.run("lightingReadStatus()"), /Fn 2 timeout/);
  const failedCount = f.calls.length;await f.run("readLightingProfiles()");assert.equal(f.calls.length, failedCount, "Errors do not create retry loops");
  fail = false;await f.run("readLightingProfiles({force:true})");assert.equal(f.run("fnLightingView.errors.has('1:2')"), false);
  let finish;f.state.profile.profileIndex = 2;
  f.setRead((profile, layer) => layer === 1 ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve({ enabled: false, colors: Array(126).fill("#000000"), revision: 10 }));
  const pending = f.run("readLightingProfiles()");for (let i = 0; i < 80 && !finish; i++) await Promise.resolve();assert.ok(finish);
  let secondFinished = false;const same = f.run("readLightingProfiles()").then(() => { secondFinished = true; });await Promise.resolve();assert.equal(secondFinished, false);
  f.state.profile.profileIndex = 3;finish({ enabled: false, colors: Array(126).fill("#ffffff"), revision: 10 });await Promise.all([pending, same]);
  assert.equal(f.run("fnLightingView.drafts.has('2:1')"), false, "Discard stale profile replies");assert.equal(f.state.fnLightingBusy, false);
  const stock = fixture({ supported: false });await stock.run("probeFnLighting(state.transport)");await stock.run("readLightingProfiles()");assert.equal(stock.calls.filter((s) => s.startsWith("fn:")).length, 0);
  assert.equal(stock.calls.filter((s) => s.startsWith("matrix:")).length, 2);
  console.log("PASS: automatic keyboard/strip settings and matrices, all three Fn layers and keymaps, dirty-draft protection, original-state baseline, profile isolation, retry/deduplication/stale guards and stock-firmware gating. Reads only.");
}
main().catch((error) => { console.error(error);process.exitCode = 1; });
