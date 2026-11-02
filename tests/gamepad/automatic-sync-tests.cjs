"use strict";
const assert = require("node:assert/strict");
const { fixture, Model: M } = require("./fixture.cjs");
const caps = { verified: true, protocolVersion: 1, boardId: 0x0030000a, transports: { xinput: true } };
const fingerprint = (value) => JSON.stringify([value.mode, value.transport, value.bindings, value.sticks]);
async function main() {
  const previous = M.emptyProfile(), onboard = M.defaults();onboard.name = "Current keyboard profile";
  let reads = 0, uploads = 0;
  const protocol = { probe: async () => caps, read: async () => ({ ...caps, config: onboard }), upload: async () => { uploads++;throw Error("No automatic writes"); } };
  const transport = { connected: true, getPerformance: async () => { reads++;return { axisRangeMax: 3310 }; } };
  const clean = fixture({ transport, savedProfile: { ...previous, keyboardFingerprint: fingerprint(previous) }, getKeyTravel: (key) => ({ key: key.id, maxTravelUm: 4000 }), protocol });
  await clean.component.ready;
  assert.equal(clean.nodes.get("profileName").value, onboard.name, "A previously confirmed local copy cannot hide a different active keyboard profile");
  assert.equal(reads, 64, "Read every key even when selected-switch values are cached");
  assert.equal(clean.nodes.get("maxTravelMm").value, "3.31");assert.equal(clean.nodes.get("endMm").value, "3.31");
  assert.match(clean.nodes.get("travelSyncStatus").textContent, /automatically.*64 keys/);
  assert.ok(!clean.nodes.has("previewButtons") && !clean.nodes.has("simulateTravel") && !clean.nodes.has("liveTravel"));
  const saved = clean.saved();clean.component.dispose();
  const edited = { ...saved, name: "Unsaved local work", mode: "off" };
  const draft = fixture({ transport, savedProfile: edited, protocol });await draft.component.ready;
  assert.equal(draft.nodes.get("profileName").value, edited.name);assert.equal(draft.saved().mode, "off");draft.component.dispose();
  let failed = true;
  const retry = fixture({ transport, protocol, readKeyTravel: async (key) => {
    if (failed && key.id === 40) throw Error("Enter read timed out");
    return { key: key.id, maxTravelUm: 3310 };
  } });
  await retry.component.ready;assert.match(retry.nodes.get("travelSyncStatus").textContent, /Enter read timed out/);
  failed = false;await retry.nodes.get("matchTravel").listeners.click();assert.match(retry.nodes.get("travelSyncStatus").textContent, /automatically.*64 keys/);retry.component.dispose();
  let release, pendingReads = 0;
  const pending = fixture({ transport, protocol, readKeyTravel: (key) => key.id === 40 ? new Promise((resolve) => { release = resolve; }) : Promise.resolve({ key: key.id, maxTravelUm: 3310 }) });
  for (let i = 0; i < 30 && !release; i++) await Promise.resolve();
  assert.ok(release);pending.component.dispose();release({ key: 40, maxTravelUm: 3310 });await pending.component.ready;
  assert.equal(pending.busy(), false);assert.equal(uploads, 0);
  const duringRead = fixture({ transport, protocol, readKeyTravel: (key) => {
    pendingReads++;
    return key.id === 40 ? new Promise((resolve) => { release = resolve; }) : Promise.resolve({ key: key.id, maxTravelUm: 3310 });
  } });
  for (let i = 0; i < 40 && !pendingReads; i++) await Promise.resolve();
  duringRead.nodes.get("controlPicker").listeners.click({ target: { closest: () => ({ dataset: { control: "A" } }) } });
  release({ key: 40, maxTravelUm: 3310 });await duringRead.component.ready;
  assert.equal(pendingReads, 64, "Edits during discovery share the existing travel read");
  assert.equal(duringRead.saved().bindings.find((b) => b.control === "A").key, 15);duringRead.component.dispose();
  console.log("PASS: automatic profile adoption, unsaved-draft preservation, 64 fresh travel reads despite caches, range fitting, retry/disposal guards, no preview controls and no automatic writes.");
}
main().catch((error) => { console.error(error);process.exitCode = 1; });
