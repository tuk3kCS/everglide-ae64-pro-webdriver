"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.resolve(__dirname, "../.."), listeners = new Map(), transport = {},
  state = { transport, page: "lighting", lightingTab: "fn1", profile: { profileIndex: 2 }, hardware: { configNames: [] }, timers: {}, selectedKeys: new Set([0]), lightingSelectedKeys: new Set([0]), stripSelection: new Set(), selectionDrag: null };
const keys = [{ id: 0, n: "A", uiRow: 0, col: 0, u: 1 }, { id: 1, n: "B", uiRow: 0, col: 1, u: 1 }, { id: 2, n: "Space", uiRow: 1, col: 0, u: 6 }];
const node = (id, fn, rect) => ({ dataset: fn ? { fnLightingKey: String(id) } : { key: String(id) }, getBoundingClientRect: () => rect,
  closest: (selector) => selector === (fn ? "[data-fn-lighting-key]" : "[data-key]") ? { dataset: fn ? { fnLightingKey: String(id) } : { key: String(id) } } : null,
  classList: { toggle() {} }, setAttribute() {} });
const rects = [{ left: 10, top: 10, width: 20, height: 20 }, { left: 40, top: 10, width: 20, height: 20 }, { left: 10, top: 40, width: 70, height: 20 }],
  fnNodes = keys.map((k, i) => node(k.id, true, rects[i])), normalNodes = keys.map((k, i) => node(k.id, false, rects[i]));
const summary = { innerHTML: "" }, marquee = { style: {}, classList: { add() {}, remove() {} } }, surface = {
  scrollLeft: 0, scrollTop: 0, getBoundingClientRect: () => ({ left: 0, top: 0 }),
  querySelector: () => marquee, querySelectorAll: (selector) => selector === "[data-fn-lighting-key]" ? fnNodes : normalNodes,
};
const c = { state, keys, layout: [[{}, {}], [{}]], console, clearTimeout, esc: String, displayedKeycode: () => 1, keycodeLabel: () => "Transparent",
  connected: () => Boolean(state.transport), normalizeHex: (s) => /^#[\da-f]{6}$/i.test(s) ? s.toLowerCase() : null,
  lightingMatrixIndexes: (key) => key.id === 2 ? [109, 110, 111, 112, 113] : [key.id],
  document: { querySelectorAll: (selector) => selector.includes("unified-lighting-preview") ? selector.includes("strip-led") ? [] : state.lightingTab.startsWith("fn") ? fnNodes : normalNodes : [],
    querySelector: (selector) => selector === "#lightingSelectionSummary" ? summary : null,
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) },
  render() {}, renderStatus() {}, stopPolling() {}, stopProfilePolling() {}, startProfilePolling() {}, showToast() {},
  lightingKeyIds: () => [...state.lightingSelectedKeys], stripLedIds: () => [],
  stripHtml: (keyboard) => keyboard,
  lightingTabs: () => "",
  window: { AE64FnRgb: { Client: class { async capabilities() { return { verified: true, profiles: 4, layers: 3, rows: 6, cols: 21, persistent: true }; } } } },
};
vm.createContext(c);
for (const file of ["js/app/fn-lighting.js", "js/app/interactions.js"]) vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), c);
const run = (code) => vm.runInContext(code, c), selection = () => [...run("fnLightingView.selected")];
function down(index, options = {}) { c.event = { button: 0, clientX: 15, clientY: 15, currentTarget: surface, target: (state.lightingTab.startsWith("fn") ? fnNodes : normalNodes)[index], preventDefault() {}, ...options };run("beginLightingSelection(event)"); }
async function main() {
  await run("probeFnLighting(state.transport)");
  state.lightingTab = "fn1";
  run("fnLightingView.drafts.set('2:1',fnLightingNormalizeProfile({enabled:true,colors:Array(126).fill('#000000'),revision:8}));fnLightingView.selected=new Set()");
  down(0);c.event = { clientX: 70, clientY: 35 };run("updateLightingMarquee(event)");assert.deepEqual(selection(), [0, 1]);
  assert.deepEqual([...state.lightingSelectedKeys], [0]);assert.match(summary.innerHTML, /2<\/b> keys/);assert.equal(run("fnLightingDraft().dirty"), false);
  run("stopLightingSelection()");assert.equal(listeners.size, 0);assert.equal(state.selectionDrag, null);
  down(0, { ctrlKey: true });run("stopLightingSelection()");assert.deepEqual(selection(), [1]);
  down(0, { metaKey: true });run("stopLightingSelection()");assert.deepEqual(selection(), [1, 0]);
  down(2);c.event = { clientX: 85, clientY: 65 };run("updateLightingMarquee(event);stopLightingSelection({type:'pointercancel'})");assert.deepEqual(selection(), [1, 0]);
  run("commitFnLightingSelection(new Set([2]),2);fnLightingStageColor('#123456')");
  for (const cell of [109, 110, 111, 112, 113]) assert.equal(run(`fnLightingDraft().colors[${cell}]`), "#123456");
  assert.equal(run("fnLightingDraft().colors[0]"), "#000000");
  const markup = run("fnLightingUnifiedPreview()");
  assert.equal((markup.match(/class="keyboard fn-lighting-keyboard"/g) || []).length, 1);assert.match(markup, /Fn 1 lighting preview/);
  down(0);state.lightingTab = "fn2";c.event = { clientX: 70, clientY: 35 };run("updateLightingMarquee(event)");assert.equal(state.selectionDrag, null);assert.equal(listeners.size, 0);
  run("fnLightingView.drafts.set('2:2',fnLightingNormalizeProfile({enabled:true,colors:Array(126).fill('#ffffff'),revision:8}))");
  state.profile.profileIndex = 1;assert.equal(run("fnLightingDraft()"), undefined);state.profile.profileIndex = 2;
  run("fnLightingView.busy=true");down(0);assert.equal(state.selectionDrag, null);run("fnLightingView.busy=false");
  // A successful own save advances the shared profile revision without discarding other layer drafts.
  c.savedValue = { enabled: true, colors: Array(126).fill("#ffffff"), revision: 9 };
  run("fnLightingView.drafts.set('2:3',fnLightingNormalizeProfile({enabled:true,colors:Array(126).fill('#000000'),revision:7}))");
  await run("fnLightingOperation(async()=>savedValue,true)");assert.equal(run("fnLightingView.drafts.get('2:1').revision"), 9);assert.equal(run("fnLightingView.drafts.get('2:1').colors[109]"), "#123456");
  assert.equal(run("fnLightingView.drafts.get('2:3').revision"), 7, "A stale layer must still conflict after an external change");
  run("fnLightingLayout()");assert.equal(run("fnLightingView.color"), "#ffffff");state.lightingTab = "fn1";run("fnLightingLayout()");assert.equal(run("fnLightingView.color"), "#123456");
  state.lightingTab = "perKey";down(1);run("stopLightingSelection()");assert.deepEqual([...state.lightingSelectedKeys], [1]);
  console.log("PASS: Fn drag/click/Ctrl/Meta selection, cancel/cleanup, single preview, Space LEDs, active profile isolation and cross-layer save revisions; normal per-key selection retained.");
}
main().catch((error) => { console.error(error);process.exitCode = 1; });
