"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const F = require("../../js/firmware/flasher.js"), R = require("../../js/firmware/reconnect.js"), M = require("../../js/gamepad/model.js");
const root = path.resolve(__dirname, "../..");

function device({ serial = 7, board = F.BOARD, runMode = 0, enabled = false, targetEnabled = enabled, phase = 0, revision = 10 } = {}) {
  return { vendorId: 0x1ca6, productId: 0x300a, collections: [{ usagePage: 0xffb0, usage: 1 }], serial, board, runMode, usb: { enabled, targetEnabled, phase, revision }, opened: false };
}
function info(d) {
  const reply = new Uint8Array(64); reply.set([1, 2]);
  new DataView(reply.buffer).setUint32(4, d.board, false); reply[16] = d.runMode; reply[17] = d.serial;
  return F.decodeInfo(reply);
}
function fixture(options = {}) {
  const original = device({ enabled: true, revision: 9, ...options.original });
  const replacement = options.replacement || device();
  const inspected = [], writes = [], logs = [], progress = [], delays = [], timerClears = [];
  let time = 0, waits = 0, hidden = 0, rendered = 0, pollingStops = 0, profileStops = 0;
  function wrap(d) {
    d.opened = true;
    const transport = { connected: true, device: d, closes: 0,
      async raw(request) { assert.deepEqual(Array.from(request), [1, 2]); if (options.identityError) throw options.identityError; const reply = new Uint8Array(64); reply.set([1, 2]); new DataView(reply.buffer).setUint32(4, d.board, false); reply[16] = d.runMode; reply[17] = d.serial; return reply; },
      async close() { this.closes++; this.connected = false; d.opened = false; },
    };
    return transport;
  }
  const connection = wrap(original), profile = { selected: 15, unsavedEdit: "ordinary draft", performance: { 15: { normalPress: 1.23 } } }, dirty = { performance: new Set([15]) };
  const drafts = new Map([["0:1", { dirty: true, colors: ["#123456"], revision: 3 }]]);
  const fn = { transport: connection, caps: { verified: true }, drafts, generation: 4, client: { original: true } };
  const state = { transport: connection, knownDevice: original, profile, dirty, timers: { autoApply: 123 }, usbSwitchBusy: false, ...options.state };
  class FastReconnector extends R.Reconnector {
    constructor(input) { waits++; assert.equal(input.timeout, 15000); assert.equal(input.interval, 250); super({ ...input, now: () => time, delay: async (ms) => { time += ms; }, timeout: 1000, interval: 250 }); }
  }
  const c = { window: null, state, fnLightingView: fn, Uint8Array,
    navigator: { hid: { async getDevices() { if (options.getDevicesError) throw options.getDevicesError; return typeof options.devices === "function" ? options.devices(original, replacement) : options.devices || [replacement]; } } },
    setTimeout(resolve, ms) { delays.push(ms); time += ms; resolve(); return 1; }, clearTimeout: (id) => timerClears.push(id),
    stopPolling() { pollingStops++; }, stopProfilePolling() { profileStops++; }, showProgress: (...args) => progress.push(args),
    hideProgress() { hidden++; }, renderStatus() { rendered++; }, log: (...args) => logs.push(args),
    AE64Firmware: F, AE64FirmwareReconnect: { Reconnector: FastReconnector }, AE64GamepadModel: M,
    AE64FnRgb: { Client: class { constructor(transport) { this.transport = transport; } } },
    AE64GamepadProtocol: {
      async readUsbState(transport) { if (options.usbReadError) throw options.usbReadError; assert.equal(transport.connected, true); return { ...transport.device.usb }; },
      async setUsbEnabled(transport, enabled, revision) {
        assert.equal(transport, connection); assert.equal(revision, original.usb.revision); writes.push({ enabled, revision });
        if (options.onSet) await options.onSet(original);
        if (options.setError) throw options.setError;
        return { accepted: true, phase: 1, revision: revision + 1 };
      },
    },
    async inspectFirmwareDevice(d) {
      const transport = wrap(d); inspected.push(transport);
      return { transport, info: info(d) };
    },
    connected: () => Boolean(state.transport?.connected), localStorage: { getItem: () => null }, esc: String,
  };
  c.window = c; vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(root, "js/app/gamepad-overview.js"), "utf8"), c);
  vm.runInContext("gamepadOverview.transport = state.transport; gamepadOverview.config = AE64GamepadModel.defaults();", c);
  vm.runInContext(fs.readFileSync(path.join(root, "js/app/gamepad-usb.js"), "utf8"), c);
  return { state, connection, original, replacement, inspected, writes, logs, progress, delays, timerClears, fn, profile, dirty, drafts,
    run: (enabled) => { c.requested = enabled; return vm.runInContext("changeGamepadUsbDevice(requested)", c); },
    overview: () => vm.runInContext("gamepadOverview", c),
    counts: () => ({ waits, hidden, rendered, pollingStops, profileStops }),
  };
}
function cleaned(f) {
  assert.equal(f.state.usbSwitchBusy, false); assert.equal(f.counts().hidden, 1); assert.equal(f.counts().rendered, 1);
  assert.equal(f.counts().pollingStops, 1); assert.equal(f.counts().profileStops, 1); assert.deepEqual(f.timerClears, [123]);
}
function draftsRetained(f) {
  assert.equal(f.state.profile, f.profile); assert.equal(f.state.dirty, f.dirty); assert.equal(f.state.dirty.performance.has(15), true);
  assert.equal(f.state.profile.performance[15].normalPress, 1.23); assert.equal(f.fn.drafts, f.drafts);
  assert.equal(f.fn.drafts.get("0:1").dirty, true); assert.equal(f.fn.drafts.get("0:1").colors[0], "#123456");
  assert.equal(f.overview().config.bindings.filter((b) => b.key !== null).length, 6);
}
async function main() {
  const same = fixture();
  assert.deepEqual(JSON.parse(JSON.stringify(await same.run(false))), { enabled: false, verified: true, revision: 10 });
  assert.deepEqual(same.writes, [{ enabled: false, revision: 9 }]); assert.deepEqual(same.delays, [400]);
  assert.equal(same.connection.connected, false); assert.equal(same.connection.closes, 1);
  assert.equal(same.state.transport.device, same.replacement); assert.equal(same.state.knownDevice, same.replacement);
  assert.equal(same.state.transport.connected, true); assert.equal(same.fn.transport, same.state.transport); assert.equal(same.fn.client.transport, same.state.transport);
  assert.equal(same.fn.generation, 5); assert.equal(same.overview().transport, same.state.transport);
  assert.equal(same.logs.at(-1)[0], "Xbox USB device visibility verified"); cleaned(same); draftsRetained(same);
  const reused = fixture({ devices: (original) => [original], onSet: (original) => { original.usb = { enabled: false, targetEnabled: false, phase: 0, revision: 10 }; } });
  assert.equal((await reused.run(false)).verified, true); assert.equal(reused.state.transport.device, reused.original);
  assert.notEqual(reused.state.transport, reused.connection); cleaned(reused); draftsRetained(reused);

  const enable = fixture({ original: { enabled: false, targetEnabled: false }, replacement: device({ enabled: true }) });
  assert.equal((await enable.run(true)).verified, true); assert.equal(enable.writes[0].enabled, true); cleaned(enable); draftsRetained(enable);
  const noop = fixture();
  assert.deepEqual(JSON.parse(JSON.stringify(await noop.run(true))), { enabled: true, verified: true, revision: 9 });
  assert.equal(noop.writes.length, 0); assert.equal(noop.counts().waits, 0); assert.equal(noop.connection.closes, 0); assert.equal(noop.state.transport, noop.connection);
  assert.equal(noop.fn.generation, 4); cleaned(noop); draftsRetained(noop);

  const noIdentity = fixture({ original: { serial: 0 } });
  await assert.rejects(noIdentity.run(false), /unique USB identity/); assert.equal(noIdentity.writes.length, 0); assert.equal(noIdentity.connection.connected, true); cleaned(noIdentity);
  const ffIdentity = fixture({ original: { serial: 255 } }); await assert.rejects(ffIdentity.run(false), /unique USB identity/); assert.equal(ffIdentity.writes.length, 0); cleaned(ffIdentity);
  const preflightWrongBoard = fixture({ original: { board: 123 } });
  await assert.rejects(preflightWrongBoard.run(false), /wrong board ID/); assert.equal(preflightWrongBoard.writes.length, 0); cleaned(preflightWrongBoard);
  const pending = fixture({ original: { phase: 1 } });
  await assert.rejects(pending.run(false), /already pending/); assert.equal(pending.writes.length, 0); cleaned(pending);

  // A SET ACK alone must never produce a successful result.
  const ackOnly = fixture({ devices: [] });
  await assert.rejects(ackOnly.run(false), /did not confirm/); assert.equal(ackOnly.writes.length, 1); assert.equal(ackOnly.state.transport, null);
  assert.ok(!ackOnly.logs.some((entry) => entry[0] === "Xbox USB device visibility verified")); cleaned(ackOnly); draftsRetained(ackOnly);
  for (const options of [
    { replacement: device({ serial: 8 }) }, { replacement: device({ board: 123 }) }, { replacement: device({ runMode: 255 }) },
    { replacement: device({ enabled: true }) }, { replacement: device({ targetEnabled: true }) }, { replacement: device({ phase: 1 }) },
  ]) {
    const bad = fixture(options); await assert.rejects(bad.run(false), /did not confirm/);
    assert.ok(bad.inspected.length > 0); assert.ok(bad.inspected.every((transport) => !transport.connected && transport.closes === 1), "Every rejected identity/state probe must be closed once");
    assert.equal(bad.state.transport, null); assert.equal(bad.fn.transport, bad.connection); assert.equal(bad.fn.generation, 4); cleaned(bad); draftsRetained(bad);
  }
  const duplicate = fixture({ devices: [device(), device()] });
  await assert.rejects(duplicate.run(false), /did not confirm/); assert.ok(duplicate.inspected.every((transport) => !transport.connected)); cleaned(duplicate);
  for (const options of [{ identityError: new Error("Identity timeout") }, { usbReadError: new Error("Status timeout") }, { setError: new Error("SET failed") }, { getDevicesError: new Error("Permission unavailable") }]) {
    const failed = fixture(options); await assert.rejects(failed.run(false)); cleaned(failed); draftsRetained(failed);
  }
  for (const state of [{ usbSwitchBusy: true }, { firmwareBusy: true }, { fnLightingBusy: true }, { writeInFlight: true }]) {
    const blocked = fixture({ state }); await assert.rejects(blocked.run(false), /not ready/); assert.equal(blocked.writes.length, 0); assert.equal(blocked.progress.length, 0);
  }
  const invalid = fixture(); await assert.rejects(invalid.run("false"), /not ready/); assert.equal(invalid.writes.length, 0);
  const missingConnection = fixture({ state: { transport: null } }); await assert.rejects(missingConnection.run(false), /not ready/); assert.equal(missingConnection.writes.length, 0);
  let release;
  const busy = fixture({ onSet: () => new Promise((resolve) => { release = resolve; }) });
  const first = busy.run(false); while (!release) await Promise.resolve();
  await assert.rejects(busy.run(false), /not ready/); assert.equal(busy.state.usbSwitchBusy, true); release(); await first; cleaned(busy);
  console.log("PASS: same-identity Xbox USB reconnect, idle no-op, ACK-only rejection, target/phase/identity/duplicate failures with closed probes, draft/client preservation, preflight guards, mutual exclusion and busy cleanup. Simulated devices only.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
