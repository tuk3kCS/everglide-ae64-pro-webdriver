"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { fixture, Model: M } = require("./fixture.cjs");
const caps = { verified: true, protocolVersion: 1, boardId: 0x0030000a, transports: { xinput: true }, persistent: false };
const profile = M.defaults();profile.name = "Onboard gamepad";profile.mode = "mixed";
for (const b of profile.bindings) if (b.key !== null) Object.assign(b, { startMm: 1, endMm: 2.75, maxTravelMm: 3.31 });
const limits = (key) => ({ key: key.id, maxTravelUm: 3310 });
async function main() {
  const transport = { connected: true, device: {} }, detected = [], loaded = [];let reads = 0;
  const api = { probe: async () => caps, read: async () => { reads++;return { ...caps, config: profile }; }, upload: async () => { throw new Error("Automatic loading must not write"); } };
  const f = fixture({ transport, protocol: api, getKeyTravel: limits, onCapabilities: (value) => detected.push(value), onRead: (config) => loaded.push(config) });
  await f.component.ready;assert.equal(reads, 1);assert.equal(loaded.length, 1);assert.equal(detected[0].transports.xinput, true);
  assert.equal(f.nodes.get("profileName").value, profile.name);assert.equal(f.nodes.get("outputMode").value, "mixed");assert.equal(f.nodes.get("endMm").value, "2.75");assert.equal(f.busy(), false);
  for (const listener of f.events.hid.get("disconnect")) listener({ device: transport.device });assert.equal(detected.at(-1), null);f.component.dispose();
  reads = 0;const later = fixture({ connectTarget: transport, protocol: api, getKeyTravel: limits });await later.component.ready;assert.equal(reads, 0);
  await later.nodes.get("connect").listeners.click();assert.equal(reads, 1);assert.equal(later.nodes.get("profileName").value, profile.name);later.component.dispose();
  let unsupportedReads = 0;const stock = fixture({ transport, getKeyTravel: limits, protocol: { probe: async () => { throw new Error("Stock firmware"); }, read: async () => { unsupportedReads++; } } });
  await stock.component.ready;assert.equal(unsupportedReads, 0);assert.equal(stock.nodes.get("apply").disabled, true);stock.component.dispose();
  const draft = M.defaults();draft.name = "Keep my draft";let fail = true;
  const retry = fixture({ transport, savedProfile: draft, getKeyTravel: limits, protocol: { probe: async () => caps, read: async () => { if (fail) throw new Error("Read timeout");return { ...caps, config: profile }; } } });
  await retry.component.ready;assert.equal(retry.nodes.get("profileName").value, draft.name);assert.match(retry.notices.at(-1).text, /automatically.*retry/i);
  fail = false;await retry.nodes.get("connect").listeners.click();assert.equal(retry.nodes.get("profileName").value, profile.name);retry.component.dispose();
  // Automatic discovery observes the keyboard without replacing a saved draft.
  // v0.3's session profile can reset after power loss while this local draft is
  // still the user's only copy of their intended controller assignments.
  const local = M.defaults(); local.name = "My custom controller"; local.mode = "controller";
  local.bindings[0].key = 1; Object.assign(local.bindings[0], { startMm: 0.7, endMm: 2.8, maxTravelMm: 3.31 });
  const resetHardware = M.emptyProfile(); resetHardware.name = "Reset onboard profile"; resetHardware.mode = "off";
  for (const persistent of [false, true]) {
    let uploads = 0;const observed = [], capabilities = [];
    const preserved = fixture({ transport, savedProfile: local, getKeyTravel: limits, onRead: (config) => observed.push(config), onCapabilities: (value) => capabilities.push(value),
      protocol: { probe: async () => ({ ...caps, persistent }), read: async () => ({ ...caps, persistent, config: resetHardware }), upload: async () => { uploads++; return { verified: true, persistent }; } } });
    await preserved.component.ready;
    assert.equal(preserved.nodes.get("profileName").value, local.name);assert.equal(preserved.nodes.get("outputMode").value, local.mode);
    assert.equal(preserved.saved().bindings[0].key, 1);assert.equal(preserved.saved().bindings[0].startMm, 0.7);assert.equal(preserved.saved().bindings[0].endMm, 2.8);
    assert.equal(observed.length, 1);assert.equal(observed[0].mode, "off");assert.ok(observed[0].bindings.every((b) => b.key === null));
    assert.equal(capabilities.at(-1).persistent, persistent);assert.equal(uploads, 0, "Automatic reads never upload the preserved draft");
    assert.match(preserved.nodes.get("deviceStatus").textContent, /local draft preserved/);
    assert.equal(preserved.nodes.get("compatibility").querySelector("strong").textContent, "Local draft differs from keyboard");
    assert.match(preserved.nodes.get("compatibility").querySelector("p").textContent, /Apply to keyboard.*Read keyboard profile/);
    // Only the user's explicit Apply or Read resolves the draft/hardware split.
    await preserved.nodes.get("apply").listeners.click();assert.equal(uploads, 1);
    assert.equal(preserved.nodes.get("compatibility").querySelector("strong").textContent, "Compatible custom gamepad firmware detected");
    await preserved.nodes.get("connect").listeners.click();assert.equal(preserved.nodes.get("profileName").value, resetHardware.name);
    assert.equal(preserved.nodes.get("outputMode").value, "off");assert.ok(preserved.saved().bindings.every((b) => b.key === null));assert.equal(uploads, 1);
    preserved.component.dispose();
  }
  const sameMappings = M.validate(profile);sameMappings.name = "Local name is retained";
  const matching = fixture({ transport, savedProfile: sameMappings, getKeyTravel: limits, protocol: api });await matching.component.ready;
  assert.equal(matching.nodes.get("profileName").value, sameMappings.name);
  assert.equal(matching.nodes.get("compatibility").querySelector("strong").textContent, "Compatible custom gamepad firmware detected");matching.component.dispose();
  const invalidSaved = fixture({ transport, savedProfile: { schema: "old-invalid-format" }, getKeyTravel: limits, protocol: api });await invalidSaved.component.ready;
  assert.equal(invalidSaved.nodes.get("profileName").value, profile.name, "An invalid saved profile cannot block discovery");invalidSaved.component.dispose();
  const offline = fixture({ connectTarget: transport, getKeyTravel: limits, protocol: api });await offline.component.ready;
  offline.nodes.get("profileName").value = "Draft made before connecting";offline.nodes.get("profileName").listeners.change();
  offline.nodes.get("outputMode").value = "off";offline.nodes.get("outputMode").listeners.change();
  offline.nodes.get("controlPicker").listeners.click({ target: { closest: () => ({ dataset: { control: "A" } }) } });
  await offline.nodes.get("connect").listeners.click();assert.equal(offline.nodes.get("profileName").value, "Draft made before connecting");
  assert.equal(offline.saved().mode, "off");assert.equal(offline.saved().bindings.find((b) => b.control === "A").key, 15);offline.component.dispose();
  let finishDiscovery, discovered = 0;const concurrentObserved = [];
  const concurrent = fixture({ transport, getKeyTravel: limits, onRead: (config) => concurrentObserved.push(config), protocol: { ...api, read: () => { discovered++;return new Promise((resolve) => { finishDiscovery = resolve; }); } } });
  for (let i = 0; i < 10 && !discovered; i++) await Promise.resolve();
  concurrent.nodes.get("profileName").value = "Edited during discovery";concurrent.nodes.get("profileName").listeners.change();
  concurrent.nodes.get("outputMode").value = "off";concurrent.nodes.get("outputMode").listeners.change();
  finishDiscovery({ ...caps, config: profile });await concurrent.component.ready;
  assert.equal(concurrent.nodes.get("profileName").value, "Edited during discovery");assert.equal(concurrent.saved().mode, "off");
  assert.equal(concurrentObserved.length, 1, "Hardware is still remembered when the draft changes during an automatic read");concurrent.component.dispose();
  let release, pendingReads = 0, lateCallbacks = 0;
  const pending = fixture({ transport, getKeyTravel: limits, onRead: () => { lateCallbacks++; }, protocol: { probe: async () => caps, read: () => { pendingReads++;return new Promise((resolve) => { release = resolve; }); } } });
  for (let i = 0; i < 10 && !pendingReads; i++) await Promise.resolve();assert.equal(pending.busy(), true);
  pending.component.dispose();assert.equal(pending.busy(), false);release({ ...caps, config: profile });await pending.component.ready;assert.equal(lateCallbacks, 0);
  const panel = { hidden: false, classList: { toggle(name, value) { panel.classHidden = value; } } }, context = { state: { transport }, document: { querySelector: () => panel } };
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname, "../../js/app/gamepad-page.js"), "utf8"), context);
  context.caps = caps;vm.runInContext("updateHardwareSolutionInfo(caps)", context);assert.equal(panel.hidden, true);assert.equal(panel.classHidden, true);
  for (const value of [null, { ...caps, verified: false }, { ...caps, boardId: 123 }, { ...caps, transports: { hid: true } }]) {
    context.caps = value;vm.runInContext("updateHardwareSolutionInfo(caps)", context);assert.equal(panel.hidden, false);
  }
  console.log("PASS: read-only discovery preserves valid saved/concurrent local drafts, remembers hardware separately, supports explicit Read/Apply, handles session/persistent firmware, and retains capability/disconnect/retry/disposal guards.");
}
main().catch((error) => { console.error(error);process.exitCode = 1; });
