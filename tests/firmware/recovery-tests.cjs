"use strict";
// Actual connection/bootstrap code against simulated HID only.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.resolve(__dirname, "../..");
class Device {
  constructor({ mode = 255, bootCollection = true, board = 0x0030000a } = {}) {
    this.vendorId = 0x1ca6;this.productId = 0x300a;this.board = board;this.mode = mode;this.opened = false;this.sent = [];
    this.collections = [{ usagePage: bootCollection ? 0xff80 : 0xffb0, usage: 1 }];this.listeners = new Set();
  }
  async open() { this.opened = true; }
  async close() { this.opened = false; }
  addEventListener(type, fn) { if (type === "inputreport") this.listeners.add(fn); }
  removeEventListener(type, fn) { if (type === "inputreport") this.listeners.delete(fn); }
  async sendReport(id, bytes) {
    assert.equal(id, 0);this.sent.push(Array.from(bytes));assert.notEqual(bytes[0], 8, "Connecting must never send firmware commands.");
    if (this.dropReply) return;
    if (this.mode === 255) assert.deepEqual(Array.from(bytes.slice(0, 2)), [1, 2], "Recovery only reads identity, never app settings or handshake.");
    const response = new Uint8Array(64);response.set(bytes.slice(0, 2));
    if (bytes[0] === 1 && bytes[1] === 2) { new DataView(response.buffer).setUint32(4, this.board, false);response.set([0, 1, 0, 0], 8);response[16] = this.mode;response[17] = 47; }
    queueMicrotask(() => this.listeners.forEach((fn) => fn({ data: new DataView(response.buffer) })));
  }
}
function fixture() {
  const nodes = new Map(), hidListeners = new Map(), logs = [];let selected, authorized = [], requests = [], renders = 0, pendingTimers = new Set();
  function node(selector) {
    if (!nodes.has(selector)) {
      const classes = new Set();nodes.set(selector, { dataset: {}, textContent: "", value: 0, disabled: false, innerHTML: "", listeners: {},
        classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c), toggle: (c, on) => on ? classes.add(c) : classes.delete(c) },
        addEventListener(type, fn) { this.listeners[type] = fn; }, querySelectorAll: () => [], focus() {} });
    }
    return nodes.get(selector);
  }
  const no = () => {}, state = { transport: null, knownDevice: null, page: "overview", timers: {}, hardware: { info: null }, profile: {} };
  const c = { state, console, URL, TextDecoder, Uint8Array, ArrayBuffer, DataView, queueMicrotask, clearTimeout,
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms);timer.unref?.();pendingTimers.add(timer);return timer; },
    document: { baseURI: "https://example.test/driver/", querySelector: node, querySelectorAll: () => [], addEventListener: no },
    navigator: { hid: { getDevices: async () => authorized, requestDevice: async (options) => { requests.push(options);return selected ? [selected] : []; }, addEventListener: (type, fn) => hidListeners.set(type, fn) } },
    window: null, stopPolling: no, stopTravelPolling: no, stopLightingPolling: no, resetCalibrationSession: no, resetFnLightingCapability: no,
    render: () => { renders++; }, renderStatus: no, log: (...args) => logs.push(args), dirtyCount: () => 0, esc: String,
    connected: () => Boolean(state.transport?.connected && !state.bootloaderConnected),
    requestApplyChanges: no, revertChanges: no, setAutoApply: no, switchProfile: no, openProfileRename: no, closeDialog: no, applyChanges: no,
    setLanguage: no, setTheme: no, importProfile: no, stopCalibration: no, renameProfile: no, keyboardHtml: () => "",
    loadLanguages: () => new Promise(no), loadSwitchCatalog: () => Promise.resolve(),
    scrollTo: no, addEventListener: no,
  };
  c.window = c;vm.createContext(c);
  for (const file of ["protocol.js", "js/firmware/flasher.js", "js/firmware/reconnect.js", "js/app/gamepad-page.js", "js/app/firmware-page.js", "js/app/device.js", "app.js"]) vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), c);
  return { c, state, node, logs, run: (code) => vm.runInContext(code, c), choose: (d) => { selected = d; }, authorize: (d) => { authorized = d; }, requests,
    event: (type, device) => hidListeners.get(type)({ device }), dispose: () => pendingTimers.forEach(clearTimeout), renders: () => renders };
}
async function main() {
  const f = fixture();
  try {
    const boot = new Device();f.choose(boot);
    f.run("firmwareView.prepared={name:'old image'};firmwareView.selectedId='old.bin'");
    assert.equal(await f.run("connectKeyboard()"), true);
    assert.equal(f.state.page, "firmware");assert.equal(f.state.bootloaderConnected, true);assert.equal(f.state.transport.connected, true);
    assert.equal(f.run("firmwareView.prepared"), null);assert.equal(f.run("firmwareView.selectedId"), "");assert.equal(f.run("firmwareView.recoveryRequired"), true);
    assert.equal(f.state.connecting, false);assert.equal(f.requests.length, 1);assert.ok(f.requests[0].filters.some((filter) => filter.usagePage === 0xff80));
    assert.equal(boot.sent.length, 1);assert.match(f.run("firmwarePage()"), /Install firmware to finish recovering/);
    // An interrupted recovery session remains reconnectable and cannot claim completion.
    boot.opened = false;f.event("disconnect", boot);await Promise.resolve();
    assert.equal(f.state.transport, null);assert.equal(f.state.bootloaderConnected, true);assert.equal(f.state.page, "firmware");
    assert.equal(f.run("firmwareView.phase"), "error");assert.match(f.node("#firmwareDetail").textContent, /recovery keyboard disconnected/i);
    const replacement = new Device({ bootCollection: false });f.choose(replacement);
    assert.equal(await f.run("connectKeyboard()"), true);assert.equal(f.state.transport.device, replacement);assert.equal(f.state.page, "firmware");
    assert.equal(replacement.sent.length, 1);assert.equal(f.run("firmwareView.prepared"), null);
    // Neither waiting stage exposes a manual selector; failures do expose reconnect.
    for (const phase of ["awaitingBoot", "writing", "awaitingApp"]) {
      f.c.testPhase = phase;f.run("firmwareView.waiting={mode:255};state.firmwareBusy=true;firmwareProgress({phase:testPhase})");
      assert.equal(f.node("#reconnectFirmware").classList.contains("hidden"), true);
    }
    f.run("state.firmwareBusy=false;firmwareProgress({phase:'error',detail:'Connection failed'})");
    assert.equal(f.node("#reconnectFirmware").classList.contains("hidden"), false);
    await f.state.transport.close();f.state.transport = null;f.state.knownDevice = null;f.state.bootloaderConnected = false;
    // A previously authorized recovery device is recognized automatically at startup.
    const authorized = new Device();f.authorize([new Device({ mode: 0, bootCollection: false }), authorized]);await f.run("detectKnownKeyboard()");
    assert.equal(f.state.page, "firmware");assert.equal(f.state.transport.device, authorized);assert.equal(f.requests.length, 2);
    // Replug event also recognizes recovery without another chooser.
    authorized.opened = false;f.event("disconnect", authorized);
    const replugged = new Device();f.event("connect", replugged);
    for (let i = 0; i < 10 && f.run("firmwareView.detecting"); i++) await new Promise(setImmediate);
    assert.equal(f.state.transport.device, replugged);assert.equal(f.state.page, "firmware");assert.equal(f.requests.length, 2);
    // Disconnect rejects an unanswered request immediately instead of waiting for its timeout.
    replugged.dropReply = true;const pending = f.state.transport.getDeviceInfo();await Promise.resolve();await Promise.resolve();
    f.event("disconnect", replugged);await assert.rejects(pending, /connection closed/i);
    f.state.knownDevice = null;f.state.bootloaderConnected = false;f.run("firmwareView.recoveryRequired=false");
    const wrong = new Device({ board: 123 });f.choose(wrong);assert.equal(await f.run("connectKeyboard()"), false);assert.equal(wrong.opened, false);assert.equal(wrong.sent.length, 1);
    // Normal application connections still load settings after the identity preflight.
    Object.assign(f.c, { clone: (v) => JSON.parse(JSON.stringify(v)), rgbToHex: () => "#000000", firmwareKeyPositions: () => new Map(), defaultSocdDraft: () => ({}),
      clearDirty() {}, maybeShowCalibrationRecommendation() {}, readKeymapLayer: async () => {}, readFnLayerTarget: async () => {}, readSelectedKey: async () => {},
      readAllPerformanceRecords: async () => {}, readAllAdvancedRecords: async () => {}, probeFnLighting: async () => {} });
    Object.assign(f.state.hardware, { performance: new Map(), keycodes: new Map(), advancedByKey: new Map() });f.state.profile = { layer: 0, lighting: { base: {}, decorative: { base: {} } } };
    const app = new Device({ mode: 0, bootCollection: false });f.choose(app);assert.equal(await f.run("connectKeyboard()"), true, JSON.stringify(f.logs.slice(-3)));
    assert.equal(f.state.bootloaderConnected, false);assert.ok(app.sent.length > 1);assert.deepEqual(app.sent[0].slice(0, 2), [1, 2]);
    console.log("PASS: recovery connects through normal chooser, unplug/replug/startup recovery, fresh image requirement, identity-only preflight and error-only reconnect prompt. No hardware accessed.");
  } finally { if (f.state.transport) await f.state.transport.close();f.dispose(); }
}
main().catch((e) => { console.error(e);process.exitCode = 1; });
