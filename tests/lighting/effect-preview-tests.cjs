"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const Model = require("../../js/app/lighting-preview.js");
const setting = { open: true, brightness: 80, speed: 50, direction: 0, paletteIndex: 0, palette: ["#ff0000", "#ff8000"] };
const points = [{ x: .05, y: .1 }, { x: .4, y: .5 }, { x: .9, y: .8 }], phases = [0, .125, .25, .5, .75];
const fingerprints = Array.from({ length: 20 }, (_, mode) => points.flatMap((point) => phases.map((phase) => Model.sample({ ...setting, mode }, point, phase))).join("/"));
assert.equal(new Set(fingerprints).size, 20, "All 20 illustrative modes have distinct spatial/time patterns");
assert.equal(new Set(Array.from({ length: 20 }, (_, mode) => points.flatMap((point) => phases.map((phase) => Model.sample({ ...setting, mode, paletteIndex: 1 }, point, phase))).join("/"))).size, 20, "A single-color palette retains distinct motion/intensity patterns");
for (let mode = 0; mode < 20; mode++) for (const point of points) for (const phase of phases) {
  const current = { ...setting, mode };
  assert.match(Model.sample(current, point, phase), /^#[a-f\d]{6}$/);
  assert.equal(Model.sample({ ...current, brightness: 0 }, point, phase), "#000000");
  assert.equal(Model.sample({ ...current, open: false }, point, phase), "#000000");
  assert.equal(Model.sample(current, point, phase), Model.sample(current, point, phase), "Preview is deterministic");
}
assert.notEqual(Model.sample({ ...setting, mode: 3 }, points[0], .125), Model.sample({ ...setting, mode: 3, direction: 1 }, points[0], .125));
assert.notEqual(Model.style({ ...setting, mode: 3, speed: 0 }, points[0]).style, Model.style({ ...setting, mode: 3, speed: 100 }, points[0]).style);
assert.equal(Model.sample({ ...setting, mode: 0, paletteIndex: 1, brightness: 100 }, points[0]), "#ff8000");
assert.equal(Model.sample({ ...setting, mode: 20 }, points[0]), "#000000");
assert.equal(Model.source({ live: true, connected: true, hasFrame: true }).kind, "live");
assert.equal(Model.source({ live: true, connected: true, hasFrame: true, draft: true }).kind, "effect");
assert.equal(Model.source({ live: false, connected: true, hasFrame: true }).kind, "effect");
assert.equal(Model.source({ live: true, connected: false, hasFrame: true }).kind, "effect");
assert.equal(Model.source({ live: true, connected: true, hasFrame: false }).kind, "effect");
assert.equal(Model.source({ fn: true, draft: true }).kind, "fn");
assert.equal(Model.source({ mode: 22, draft: true }).kind, "unlisted");

// Exercise the actual live painter: a received frame must not erase a draft.
const root = path.resolve(__dirname, "../.."), nodes = [], painted = [], labels = new Map();
const state = { dirty: { lightingBase: true, lightingPalette: false, customLighting: new Set() },
  liveLighting: true, profile: { lighting: { base: { ...setting, mode: 3 }, palette: setting.palette, customEnabled: {} } }, hardware: {} };
const context = { window: { AE64LightingPreview: Model }, state, connected: () => true, isFnLightingTab: () => false,
  Date, keys: [{ id: 0, uiRow: 0, col: 0 }], lightingMatrixIndex: () => 0, rgbToHex: () => "#123456",
  document: { querySelector: (selector) => labels.get(selector) || null, querySelectorAll: () => nodes } };
vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root, "js/app/lighting-preview.js"), "utf8"), context);
vm.runInContext(fs.readFileSync(path.join(root, "js/app/live.js"), "utf8"), context);
let animated = true;
nodes.push({ dataset: { key: "0" }, style: { setProperty: (...args) => painted.push(args) }, removeAttribute: () => { animated = false; }, querySelectorAll: () => [] });
vm.runInContext("updateLiveKeyboard([{r:18,g:52,b:86}])", context);
assert.equal(painted.length, 0);assert.equal(animated, true);
state.dirty.lightingBase = false;
vm.runInContext("updateLiveKeyboard([{r:18,g:52,b:86}])", context);
assert.equal(animated, false);assert.deepEqual(painted.at(-1), ["--key-color", "#123456"]);
state.dirty.lightingBase = true;
assert.equal(vm.runInContext("lightingEffectKeyPreview(keys[0], true)", context), null, "Per-key overrides do not animate");
assert.match(vm.runInContext("lightingEffectPreviewLabel()", context), /Draft effect preview.*approximate/);
console.log("PASS: all 20 distinct browser effects, brightness/palette/direction/speed, live-vs-draft priority, overrides, unsupported modes and live-painter isolation. No hardware.");
