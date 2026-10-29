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
  console.log("PASS: automatic profile loading on mount/connect, capability-gated setup-panel hiding, stock firmware, disconnect, retry and disposal. Read-only.");
}
main().catch((error) => { console.error(error);process.exitCode = 1; });
