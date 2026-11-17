"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { AE64HidTransport } = require("../../protocol.js");

const sent = [], logs = [], preferences = new Map(), listeners = new Map();
let time = 2000, focused = true, visible = "visible", pending = false, busy = false, blurAfterSend = false, finalized = null;
class ReaderTransport {
  raw(packet, options) { return this.transact(packet, options); }
  getCurrentConfig() { return this.raw([2, 3, 1]); }
  getReportRate() { return this.raw([2, 5, 1]); }
  getLightingSleepTime() { return this.raw([2, 13, 1]); }
  getShakeOptimization() { return this.raw([2, 16, 1]); }
  getConfigName() { return this.raw([2, 3, 3]); }
}

const context = {
  AE64HidTransport: ReaderTransport, performance: { now: () => time },
  setTimeout(fn) { queueMicrotask(fn); },
  document: {
    get visibilityState() { return visible; },
    hasFocus: () => focused, querySelector: () => null,
    addEventListener: (name, callback) => listeners.set(name, callback),
  },
  window: { addEventListener: (name, callback) => listeners.set(name, callback) },
  localStorage: { getItem: (key) => preferences.get(key) ?? null, setItem: (key, value) => preferences.set(key, value) },
  connected: () => true, toolOperationBusy: () => busy, pendingChangeCount: () => Number(pending),
  showToast() {}, log(...args) { logs.push(args); },
  state: {
    page: "lighting", profile: { profileIndex: 1 }, timers: { profileGeneration: 0 },
    hardware: { configNames: [], configIndexes: [0, 1] },
    transport: {
      device: {},
      async transact(packet, { beforeSend }) {
        beforeSend();
        sent.push(packet);
        if (blurAfterSend) { focused = false; listeners.get("blur")(); }
        return packet[1] === 3 && packet[2] === 1 ? 1 : "Read OK";
      },
    },
  },
  async readOnboardProfileBundle(transport, slot, { includeShared, reader }) {
    assert.equal(transport, context.state.transport);
    assert.equal(slot, 1);
    assert.equal(includeShared, true);
    for (const request of [[3, 1], [4, 1], [6, 1], [7, 1], [7, 3], [5, 1], [5, 3], [0x10, 0x30], [0x10, 0x35], [0x10, 0x20], [0x10, 0x25], [0x10, 0x26]])
      await reader.raw(request);
    return { bundle: { name: "Observed slot" } };
  },
  async assertProfileTransferTarget(transport, slot, reader) {
    assert.equal(await reader.getCurrentConfig(), slot);
  },
};
vm.createContext(context);
const run = (source) => vm.runInContext(source, context);
run(fs.readFileSync(path.join(__dirname, "../../js/app/profile-refresh.js"), "utf8"));
context.record = (...args) => { finalized = args; };
run("applySettingsRefresh = record;");

(async () => {
  assert.match(run("settingsRefreshControl()"), /value="30" selected/);
  await run("maybeRefreshOnboardSettings()");
  assert.equal(sent.length, 0);

  time += 30001;
  focused = false;
  await run("maybeRefreshOnboardSettings()");
  focused = true;
  visible = "hidden";
  await run("maybeRefreshOnboardSettings()");
  visible = "visible";
  pending = true;
  await run("maybeRefreshOnboardSettings()");
  pending = false;
  busy = true;
  await run("maybeRefreshOnboardSettings()");
  busy = false;
  assert.equal(sent.length, 0, "Hidden, unfocused, busy and dirty sessions send no requests");

  blurAfterSend = true;
  await run("maybeRefreshOnboardSettings()");
  assert.equal(sent.length, 1, "Losing focus stops after the current USB request");
  assert.equal(finalized, null, "Partial reads do not change the editor");
  assert.equal(logs.length, 0);

  sent.length = 0;
  focused = true;
  blurAfterSend = false;
  run("setSettingsRefreshInterval(15)");
  assert.equal(preferences.get("settings-refresh-seconds"), "15");
  time += 15001;
  await run("maybeRefreshOnboardSettings()");
  assert.equal(sent.length, 17);
  assert.equal(finalized[2][1], "Observed slot");
  assert.equal(finalized[4], 1);

  for (const packet of [[2, 3, 2], [2, 5, 2], [2, 6, 0], [5, 4, 0], [8, 1], [0x10, 0x27], [0x10, 0x33]]) {
    context.packet = packet;
    await assert.rejects(run("settingsRefreshReader(state.transport, () => {}).raw(packet)"), /only read/);
  }
  run("setSettingsRefreshInterval(0)");
  time += 120000;
  await run("maybeRefreshOnboardSettings()");
  assert.equal(sent.length, 17, "Off disables full refreshes");

  let releaseQueue, queuedReports = 0;
  const actualTransport = new AE64HidTransport({ opened: true, async sendReport() { queuedReports++; } });
  actualTransport.queue = new Promise((resolve) => { releaseQueue = resolve; });
  const queued = actualTransport.transact([2, 3, 1], { beforeSend() { throw new Error("Focus lost while queued"); } });
  releaseQueue();
  await assert.rejects(queued, /Focus lost while queued/);
  assert.equal(queuedReports, 0);
  console.log("PASS: settings refresh interval, focus and draft guards, cancellation, complete snapshots and read-only packets.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
