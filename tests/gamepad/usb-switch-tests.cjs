"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const P = require("../../js/gamepad/protocol.js"), M = require("../../js/gamepad/model.js");
const BOARD = 0x0030000a, dv = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);

function transport({ flags = 10, board = BOARD, transformStatus, transformSet, intercept } = {}) {
  const state = { enabled: true, targetEnabled: true, phase: 0, revision: 9 }, calls = [];
  const t = { connected: true, calls, state, async raw(request) {
    calls.push(request.slice());
    if (intercept) await intercept(request);
    const command = request[1], reply = request.slice(); reply.fill(0, 8); reply[9] = 0;
    const payload = command === P.CMD.INFO ? new Uint8Array(20) : new Uint8Array(12);
    dv(payload).setUint32(0, board, true);
    if (command === P.CMD.INFO) {
      payload.set([flags, 24, 1, 0], 4); dv(payload).setUint16(12, 3310, true); dv(payload).setUint16(14, 208, true);
    } else if (command === P.CMD.USB_STATUS || command === P.CMD.USB_SET) {
      if (command === P.CMD.USB_SET) {
        assert.equal(request[9], 10); assert.equal(dv(request).getUint32(10, true), BOARD); assert.equal(request[15], 0);
        if (dv(request).getUint32(16, true) !== state.revision) { reply[8] = 3; return reply; }
        state.targetEnabled = Boolean(request[14]);
        if (state.targetEnabled !== state.enabled) { state.revision = (state.revision + 1) >>> 0; state.phase = 1; }
      }
      payload.set([1, Number(state.enabled), Number(state.targetEnabled), state.phase], 4); dv(payload).setUint32(8, state.revision, true);
    } else throw new Error("Unexpected test command");
    const result = command === P.CMD.USB_STATUS && transformStatus ? transformStatus(payload)
      : command === P.CMD.USB_SET && transformSet ? transformSet(payload) : payload;
    reply[9] = result.length; reply.set(result, 10); return reply;
  } };
  return t;
}

function mounted({ caps, state = { enabled: true, targetEnabled: true, phase: 0, revision: 9 }, onUsbDeviceChange, setUsbEnabled, readUsbState } = {}) {
  const template = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../js/gamepad/template.js"), "utf8"), template);
  const ids = [...template.window.AE64GamepadTemplate.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const node = () => ({ listeners: {}, value: "", checked: false, disabled: false, hidden: false, innerHTML: "", textContent: "", style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} }, addEventListener(type, fn) { this.listeners[type] = fn; }, setAttribute() {}, querySelector() { return node(); } });
  const nodes = new Map(ids.map((id) => [id, node()])), notices = [], hid = new Map();
  const root = { querySelector(selector) { assert.ok(nodes.has(selector.slice(1)), selector); return nodes.get(selector.slice(1)); }, querySelectorAll() { return []; } };
  let current = { connected: true, device: {} }, saved, busy = false;
  const profile = M.emptyProfile(); profile.name = "Keep my draft";
  const protocol = { probe: async () => caps, read: async () => ({ ...caps, config: profile }), readUsbState: readUsbState || (async () => ({ ...state })), setUsbEnabled };
  const sandbox = { window: null, document: { hidden: false, addEventListener() {}, removeEventListener() {} }, navigator: { hid: { addEventListener(type, fn) { hid.set(type, fn); }, removeEventListener() {} } },
    localStorage: { getItem: () => JSON.stringify(profile), setItem(key, value) { saved = JSON.parse(value); } },
    setTimeout() {}, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, addEventListener() {}, removeEventListener() {}, console, Blob, URL,
    AE64GamepadModel: M, AE64ControllerIcons: require("../../js/gamepad/icons.js"), AE64GamepadProtocol: protocol };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../js/gamepad/studio.js"), "utf8"), sandbox);
  const component = sandbox.AE64GamepadStudio.mount(root, { getTransport: () => current, onUsbDeviceChange, notify: (message, error) => notices.push({ message, error }), onBusy: (value) => { busy = value; } });
  return { component, nodes, notices, saved: () => saved, busy: () => busy,
    reconnect() { current = { connected: true, device: {} }; },
    disconnect() { const device = current.device; current.connected = false; hid.get("disconnect")?.({ device }); },
  };
}

async function main() {
  const t = transport();
  assert.equal((await P.probe(t)).usbDeviceSwitch, true);
  assert.deepEqual(await P.readUsbState(t), { boardId: BOARD, protocolVersion: 1, enabled: true, targetEnabled: true, phase: 0, revision: 9 });
  const pending = await P.setUsbEnabled(t, false, 9);
  assert.deepEqual(pending, { boardId: BOARD, protocolVersion: 1, enabled: true, targetEnabled: false, phase: 1, revision: 10, accepted: true });
  assert.equal(pending.verified, undefined, "SET acceptance is not post-reconnect verification");
  t.state.enabled = false; t.state.phase = 0;
  assert.equal((await P.readUsbState(t)).enabled, false);
  assert.equal((await P.setUsbEnabled(t, false, 10)).revision, 10, "An idle no-op retains its revision");
  await assert.rejects(P.setUsbEnabled(t, true, 9), (e) => e instanceof P.KeyboardRejectedError && e.status === 3);
  for (const enabled of [0, 1, null, "false"]) await assert.rejects(P.setUsbEnabled(t, enabled, 10), TypeError);
  for (const revision of [-1, 1.5, 0x100000000, undefined]) await assert.rejects(P.setUsbEnabled(t, false, revision), RangeError);
  t.connected = false; await assert.rejects(P.readUsbState(t), /connected/);
  const legacy = transport({ flags: 2 }); assert.equal((await P.probe(legacy)).usbDeviceSwitch, false);
  await assert.rejects(P.readUsbState(legacy), P.UnsupportedFirmwareError); await assert.rejects(P.setUsbEnabled(legacy, false, 0), P.UnsupportedFirmwareError);
  assert.ok(legacy.calls.every((b) => b[1] === P.CMD.INFO), "Legacy firmware receives no switch commands");
  await assert.rejects(P.readUsbState(transport({ board: 123 })), P.UnsupportedFirmwareError);
  for (const corrupt of [
    (b) => b.slice(0, 11), (b) => { b[0] = 1; return b; }, (b) => { b[4] = 2; return b; },
    (b) => { b[5] = 2; return b; }, (b) => { b[6] = 2; return b; }, (b) => { b[7] = 3; return b; },
    (b) => { b[6] = 0; return b; },
  ]) await assert.rejects(P.readUsbState(transport({ transformStatus: corrupt })), /Invalid Xbox/);
  for (const corrupt of [(b) => { b[6] = 1; return b; }, (b) => { b[8] += 1; return b; }, (b) => { b[7] = 2; return b; }])
    await assert.rejects(P.setUsbEnabled(transport({ transformSet: corrupt }), false, 9), /not confirmed/);
  const wrap = transport(); wrap.state.revision = 0xffffffff;
  assert.equal((await P.setUsbEnabled(wrap, false, 0xffffffff)).revision, 0);

  let entered, release;
  const activeSet = transport({ intercept: (b) => b[1] === P.CMD.USB_SET ? new Promise((resolve) => { release = resolve; entered = true; }) : undefined });
  const changing = P.setUsbEnabled(activeSet, false, 9);
  while (!entered) await Promise.resolve();
  await assert.rejects(P.upload(activeSet, M.emptyProfile()), /already running/);
  await assert.rejects(P.setUsbEnabled(activeSet, false, 9), /already running/); release(); await changing;
  let enteredUpload, releaseUpload;
  const activeUpload = transport({ intercept: () => new Promise((resolve, reject) => { enteredUpload = true; releaseUpload = () => reject(new Error("Stopped test upload")); }) });
  const uploading = P.upload(activeUpload, M.emptyProfile());
  while (!enteredUpload) await Promise.resolve();
  await assert.rejects(P.setUsbEnabled(activeUpload, false, 9), /already running/); releaseUpload(); await assert.rejects(uploading, /Stopped test upload/);

  const caps = { verified: true, boardId: BOARD, protocolVersion: 1, transports: { xinput: true }, usbDeviceSwitch: true };
  const stock = mounted({ caps: { ...caps, usbDeviceSwitch: false } }); await stock.component.ready;
  assert.equal(stock.nodes.get("usbDeviceEnabled").disabled, true); assert.match(stock.nodes.get("usbDeviceStatus").textContent, /Requires/); stock.component.dispose();
  let stateReadFails = true;
  const retry = mounted({ caps, readUsbState: async () => { if (stateReadFails) throw new Error("State read timeout"); return { enabled: true, targetEnabled: true, phase: 0, revision: 9 }; } }); await retry.component.ready;
  assert.equal(retry.nodes.get("usbDeviceEnabled").disabled, true); stateReadFails = false; await retry.nodes.get("connect").listeners.click();
  assert.equal(retry.nodes.get("usbDeviceEnabled").disabled, false); retry.component.dispose();
  const fallback = mounted({ caps, setUsbEnabled: async () => pending }); await fallback.component.ready;
  assert.equal(fallback.nodes.get("usbDeviceEnabled").checked, true); assert.equal(fallback.nodes.get("usbDeviceEnabled").disabled, false);
  fallback.nodes.get("usbDeviceEnabled").checked = false; await fallback.nodes.get("usbDeviceEnabled").listeners.change();
  assert.equal(fallback.nodes.get("usbDeviceEnabled").disabled, true); assert.equal(fallback.nodes.get("apply").disabled, true);
  assert.match(fallback.notices.at(-1).message, /not been verified/); assert.equal(fallback.saved().name, "Keep my draft"); fallback.component.dispose();
  let complete, desired;
  const integrated = mounted({ caps, onUsbDeviceChange: (value) => { desired = value; return new Promise((resolve) => { complete = resolve; }); } }); await integrated.component.ready;
  integrated.nodes.get("usbDeviceEnabled").checked = false; const operation = integrated.nodes.get("usbDeviceEnabled").listeners.change();
  assert.equal(desired, false); assert.equal(integrated.busy(), true);
  integrated.disconnect(); integrated.reconnect(); complete({ enabled: false, verified: true, revision: 10 }); await operation;
  assert.equal(integrated.nodes.get("usbDeviceEnabled").checked, false); assert.equal(integrated.nodes.get("usbDeviceEnabled").disabled, false); assert.equal(integrated.busy(), false);
  assert.match(integrated.notices.at(-1).message, /verified after USB reconnect/); assert.equal(integrated.saved().name, "Keep my draft"); integrated.component.dispose();
  const uncertain = mounted({ caps, onUsbDeviceChange: async () => ({ enabled: false, verified: false }) }); await uncertain.component.ready;
  uncertain.nodes.get("usbDeviceEnabled").checked = false; await uncertain.nodes.get("usbDeviceEnabled").listeners.change();
  assert.equal(uncertain.nodes.get("usbDeviceEnabled").disabled, true); assert.equal(uncertain.notices.at(-1).error, true); assert.match(uncertain.notices.at(-1).message, /not confirmed/); uncertain.component.dispose();
  const disconnected = mounted({ caps, onUsbDeviceChange: async () => { disconnected.disconnect(); return { enabled: false, verified: true }; } }); await disconnected.component.ready;
  disconnected.nodes.get("usbDeviceEnabled").checked = false; await disconnected.nodes.get("usbDeviceEnabled").listeners.change();
  assert.equal(disconnected.notices.at(-1).error, true); assert.match(disconnected.notices.at(-1).message, /not confirmed/); disconnected.component.dispose();
  console.log("PASS: Xbox USB switch capability gating, packet validation, stale revisions, no-op/wraparound, upload mutual exclusion, reconnect verification, uncertain/disconnected results and draft preservation. Simulated devices only.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
