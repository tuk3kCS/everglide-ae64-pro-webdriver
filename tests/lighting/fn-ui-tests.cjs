"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../../js/app/fn-lighting.js"), "utf8");
const transport = {}, state = { transport, hardware: { configNames: [] }, profile: { profileIndex: 2 }, lightingTab: "main" },
  keys = [{ id: 0, n: "A", uiRow: 0, col: 0, u: 1 }, { id: 1, n: "Space", uiRow: 0, col: 1, u: 6 }];
let caps = { verified: true, profiles: 4, layers: 3, rows: 6, cols: 21, persistent: true }, pending;
const context = vm.createContext({
  state, keys, layout: [[{}, {}]], Set, Map, Number, Boolean, String, Array, Error,
  displayedKeycode: () => 1, keycodeLabel: () => "Transparent",
  connected: () => Boolean(state.transport),
  normalizeHex: (value) => /^#[a-f\d]{6}$/i.test(value || "") ? value.toLowerCase() : null,
  lightingMatrixIndexes: (key) => key.id === 1 ? [109, 110, 111, 112, 113] : [42],
  window: { AE64FnRgb: { Client: class { capabilities() { return pending || Promise.resolve(caps); } } } },
});
vm.runInContext(source, context);
const run = (code) => vm.runInContext(code, context);
(async () => {
  assert.equal(run("fnLightingAvailable()"), false);
  assert.equal(run("fnLightingTabButton()"), "");
  assert.equal(await run("probeFnLighting(state.transport)"), true);
  assert.equal(run("fnLightingAvailable()"), true);
  assert.equal(run("fnLightingProfile()"), 2);
  context.esc = String;
  assert.match(run("fnLightingTabButton()"), /Fn 1/);
  assert.equal((run("fnLightingTabButton()").match(/data-lighting-tab=/g)||[]).length,3);
  caps = { ...caps, verified: false };
  assert.equal(await run("probeFnLighting(state.transport)"), false);
  assert.equal(run("fnLightingAvailable()"), false);
  caps = { ...caps, verified: true, rows: 5 };
  assert.equal(await run("probeFnLighting(state.transport)"), false);
  caps = { ...caps, rows: 6 };
  let resolve;
  pending = new Promise((r) => { resolve = r; });
  const stale = run("probeFnLighting(state.transport)");
  run("resetFnLightingCapability()"); resolve(caps);
  assert.equal(await stale, false);
  pending = null;
  await run("probeFnLighting(state.transport)");
  state.lightingTab="fn1";
  run("fnLightingView.drafts.set('2:1',fnLightingNormalizeProfile({enabled:true,colors:Array(126).fill('#ffffff'),revision:8})); fnLightingView.selected = new Set([1]);");
  assert.equal(run("fnLightingStageColor('#12AB34')"), true);
  assert.equal(run("fnLightingDraft().colors[42]"), "#ffffff");
  for (const index of [109, 110, 111, 112, 113]) assert.equal(run(`fnLightingDraft().colors[${index}]`), "#12ab34");
  assert.equal(run("fnLightingDraft().dirty"), true);
  assert.equal(run("fnLightingDraft().revision"), 8);
  assert.match(run("fnLightingPage()"), /id="fnLightingApply" >Apply Fn 1 colors/);
  state.profile.profileIndex = 1;
  assert.match(run("fnLightingPage()"), /id="fnLightingApply" disabled/);
  assert.ok(!run("fnLightingPage()").includes('id="fnLightingProfile"'));
  assert.ok(!run("fnLightingPage()").includes('id="fnLightingLayer"'));
  assert.ok(!run("fnLightingPage()").includes("data-fn-lighting-key"));
  state.profile.profileIndex = 2;
  assert.equal(run("fnLightingStageColor('not a color')"), false);
  run("state.lightingTab='fn2'; fnLightingView.drafts.set('2:2',fnLightingNormalizeProfile({enabled:false,colors:Array(126).fill('#000000')}))");
  assert.equal(run("fnLightingDraft().colors[109]"), "#000000");
  run("state.profile.profileIndex=1");
  assert.equal(run("fnLightingDraft()"), undefined);
  assert.throws(() => run("fnLightingNormalizeProfile({enabled:true,colors:Array(64).fill('#ffffff')})"), /126/);
  assert.throws(() => run("fnLightingNormalizeProfile({enabled:true,colors:Array(126).fill('#xyzxyz')})"), /HEX/);
  run("state.lightingTab='fn3'; resetFnLightingCapability()");
  assert.equal(state.lightingTab, "main");
  assert.equal(run("fnLightingView.drafts.size"), 0);
  console.log("Fn lighting UI: capability gating, stale probes, per-profile/layer isolation and five Space LEDs passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
