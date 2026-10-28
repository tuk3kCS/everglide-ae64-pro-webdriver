"use strict";
// All devices below are in-memory simulations. Never opens a USB/HID device.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os"), crypto = require("node:crypto");
const F = require("../../js/firmware/flasher.js"), { AE64HidTransport } = require("../../protocol.js");
const { Reconnector } = require("../../js/firmware/reconnect.js");
let checks = 0;
function check(value, message) { checks++; assert.ok(value, message); }
function equal(a, b, message) { checks++; assert.deepEqual(a, b, message); }
const root = path.resolve(__dirname, "../.."), catalog = JSON.parse(fs.readFileSync(path.join(root, "firmware/catalog.json"), "utf8"));
function fixtureImage() { const bytes = new Uint8Array(4096 + 117), d = new DataView(bytes.buffer); bytes.fill(0xa5, 4096); d.setUint32(0, 0xbeaf5aa5, true); d.setUint32(4, F.BOARD, true); d.setUint32(8, 4096, true); d.setUint32(12, 117, true); d.setUint32(16, F.crc32(bytes.subarray(4096)), true); return bytes; }
class Keyboard {
  constructor({ mode = 0, board = F.BOARD, validate = true, failOffset = -1, serial = 1, corruptAck = false } = {}) {
    this.mode = mode; this.board = board; this.validate = validate; this.failOffset = failOffset; this.serial = serial; this.corruptAck = corruptAck;
    this.vendorId = 0x1ca6; this.productId = 0x300a; this.collections = [{ usagePage: 0xffb0, usage: 1 }]; this.opened = false;
    this.listeners = new Set(); this.sent = []; this.chunks = []; this.applicationVersion = [0, 1, 0, 0];
  }
  async open() { this.opened = true; }
  async close() { this.opened = false; }
  addEventListener(type, listener) { if (type === "inputreport") this.listeners.add(listener); }
  removeEventListener(type, listener) { if (type === "inputreport") this.listeners.delete(listener); }
  async sendReport(report, bytes) {
    assert.equal(report, 0); assert.equal(bytes.length, 64); this.sent.push(bytes.slice());
    const r = new Uint8Array(64); r.set(bytes.subarray(0, 2));
    if (bytes[0] === 1 && bytes[1] === 2) {
      new DataView(r.buffer).setUint32(4, this.board, false); r.set(this.applicationVersion, 8); r[16] = this.mode; r[17] = this.serial;
    } else if (bytes[0] === 8) {
      if (bytes[1] === F.COMMAND.ENTER) this.mode = 255;
      if (bytes[1] === F.COMMAND.WRITE) {
        assert.equal(this.mode, 255);const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset = d.getUint32(2, true), count = d.getUint16(6, true);
        if (offset === this.failOffset) throw new Error("Simulated missing write ACK");
        assert.equal(offset, this.chunks.reduce((n, b) => n + b.length, 0)); assert.ok(count > 0 && count <= 56);
        this.chunks.push(bytes.slice(8, 8 + count)); new DataView(r.buffer).setUint32(2, 0x12345678, true);
        if (this.corruptAck) r[1] = 99;
      }
      if (bytes[1] === F.COMMAND.VALIDATE) r[2] = this.validate ? 1 : 0;
      if (bytes[1] === F.COMMAND.RESTART) this.mode = 0;
    }
    queueMicrotask(() => this.listeners.forEach((listener) => listener({ data: new DataView(r.buffer) })));
  }
}
async function open(k) { const t = new AE64HidTransport(k); await t.open(); return t; }
async function updater(k, options = {}) {
  const events = [], t = await open(k), prepared = await F.prepare(fixtureImage(), { name: "Test image", appVersion: "0.1.0.0" });
  const update = new F.Updater({ delay: async () => {}, progress: (e) => events.push(e), reconnect: async () => ({ transport: await open(k), explicit: false }), ...options });
  return { update, t, prepared, events };
}
async function main() {
  equal(F.crc32(Buffer.from("123456789")), 0xcbf43926);
  for (const entry of catalog.firmwares) {
    const bytes = new Uint8Array(fs.readFileSync(path.join(root, "firmware", entry.file))), p = await F.prepare(bytes, entry);
    equal(p.sha256, entry.sha256);equal(p.info.bytes, entry.bytes);
    const rebuilt = [];
    for (let offset = 0; offset < bytes.length; offset += 56) { const data = bytes.slice(offset, offset + 56), packet = F.packet(2, offset, data); equal(packet.length, 64);equal(new DataView(packet.buffer).getUint32(2, true), offset); rebuilt.push(...packet.slice(8, 8 + data.length)); }
    equal(new Uint8Array(rebuilt), bytes, "Packetization preserves the entire container, including its header.");
  }
  const corrupt = fixtureImage();corrupt[4100] ^= 1;assert.throws(() => F.inspect(corrupt), /checksum/);checks++;
  const wrong = fixtureImage();new DataView(wrong.buffer).setUint32(4, 0x12345678, true);assert.throws(() => F.inspect(wrong), /different keyboard/);checks++;
  assert.throws(() => F.inspect(new Uint8Array(4096)), /size/);checks++;
  assert.throws(() => F.packet(2, 0, new Uint8Array(57)), /chunk/);checks++;
  await assert.rejects(F.prepare(fixtureImage(), { sha256: "0".repeat(64) }), /hash/);checks++;
  // Lease excludes ordinary configuration calls and restores them after release.
  const leaseKeyboard = new Keyboard(), leased = await open(leaseKeyboard), lease = await leased.acquireExclusive();
  await assert.rejects(leased.getDeviceInfo(), /reserved/);checks++;equal(leaseKeyboard.sent.length, 0);
  equal((await F.identity(lease)).boardId, F.BOARD);await lease.release();equal((await leased.getDeviceInfo()).runMode, 0);await leased.close();
  // Complete application -> bootloader -> full transfer -> validation -> application.
  const k = new Keyboard(), success = await updater(k), answer = await success.update.run(success.prepared, success.t);
  check(answer.validated && answer.info.runMode === 0, "Complete update reconnects the app.");
  equal(Buffer.concat(k.chunks.map((b) => Buffer.from(b))), Buffer.from(success.prepared.bytes));
  equal(k.sent.filter((p) => p[0] === 8).map((p) => p[1]).slice(-2), [3, 4]);
  equal(answer.chunkAckWords, [0x12345678], "Unknown per-chunk ACK words are recorded; final validation gates success.");
  equal(success.events.at(-1).percent, 100);check(!success.update.running);await answer.transport.close();
  // Full automatic flow with new HID objects in both modes and another AE64.
  const originalApp = new Keyboard(), autoBoot = new Keyboard({ mode: 255 }), autoApp = new Keyboard(), secondKeyboard = new Keyboard({ mode: 255, serial: 2 });
  const automatic = await updater(originalApp, { delay: async () => { throw new Error("Fixed mode delays must not be used"); }, reconnect: async (expected) => {
    const target = expected.mode === 255 ? autoBoot : autoApp;
    const reconnect = new Reconnector({ getDevices: async () => [secondKeyboard, target], checkIdentity: F.checkIdentity, timeout: 1000,
      inspect: async (device) => { const transport = await open(device), lease = await transport.acquireExclusive();try { return { transport, info: await F.identity(lease) }; } finally { await lease.release(); } } });
    return reconnect.wait(expected);
  } });
  const autoResult = await automatic.update.run(automatic.prepared, automatic.t);
  equal(autoResult.transport.device, autoApp);equal(Buffer.concat(autoBoot.chunks.map((b) => Buffer.from(b))), Buffer.from(automatic.prepared.bytes));
  check(secondKeyboard.sent.every((p) => p[0] === 1 && p[1] === 2), "The other keyboard only receives identity reads.");
  check(!originalApp.sent.some((p) => p[0] === 8 && p[1] === 2));await autoResult.transport.close();
  // Validation failure must never reboot a potentially unusable application.
  const failed = new Keyboard({ validate: false }), invalid = await updater(failed);
  await assert.rejects(invalid.update.run(invalid.prepared, invalid.t), /rejected the complete image/);checks++;
  check(!failed.sent.some((p) => p[0] === 8 && p[1] === 4), "No restart follows failed validation.");equal(failed.mode, 255);check(!invalid.t.exclusiveToken);
  // A missing ACK stops at that chunk. No blind retry/automatic reboot.
  const missing = new Keyboard({ failOffset: 56 }), timeout = await updater(missing);
  await assert.rejects(timeout.update.run(timeout.prepared, timeout.t), (e) => e.firmwareStage.wrote && /missing write ACK/.test(e.message));checks++;
  equal(missing.sent.filter((p) => p[0] === 8 && p[1] === 2).length, 2);
  check(!missing.sent.some((p) => p[0] === 8 && [3, 4].includes(p[1])));
  const mismatched = new Keyboard({ board: 123 }), mismatch = await updater(mismatched);
  await assert.rejects(mismatch.update.run(mismatch.prepared, mismatch.t), /supported AE64/);checks++;
  check(!mismatched.sent.some((p) => p[0] === 8), "Wrong board receives no firmware commands.");
  // Reject a reconnect to another keyboard without an explicit user selection.
  const first = new Keyboard(), other = new Keyboard({ mode: 255, serial: 2 }), swap = await updater(first, { reconnect: async () => ({ transport: await open(other), explicit: false }) });
  await assert.rejects(swap.update.run(swap.prepared, swap.t), /different keyboard/);checks++;
  check(!other.sent.some((p) => p[0] === 8));
  const from = new Keyboard(), chosen = new Keyboard({ mode: 255, serial: 2 }), expectations = [];
  const explicitSwap = await updater(from, { reconnect: async ({ mode, original, preferred }) => {
    expectations.push({ mode, serial: original.serial, preferred });
    return { transport: await open(chosen), explicit: mode === 255 };
  } });
  const chosenResult = await explicitSwap.update.run(explicitSwap.prepared, explicitSwap.t);
  equal(chosenResult.info.serial, "02" + "00".repeat(11));
  equal(expectations[1].serial, "02" + "00".repeat(11));check(expectations[1].preferred === chosen, "App reconnect follows the explicitly selected keyboard actually written.");
  await chosenResult.transport.close();
  // A still-running app is never sent a write, even after the enter command.
  const notBoot = new Keyboard(), badBoot = await updater(notBoot, { reconnect: async () => { notBoot.mode = 0; return { transport: await open(notBoot) }; } });
  await assert.rejects(badBoot.update.run(badBoot.prepared, badBoot.t), /still running its app/);checks++;
  check(!notBoot.sent.some((p) => p[0] === 8 && p[1] === 2));
  // Already in bootloader mode: skip the application-to-boot transition.
  const boot = new Keyboard({ mode: 255 }), bootTest = await updater(boot), bootAnswer = await bootTest.update.run(bootTest.prepared, bootTest.t);
  check(!boot.sent.some((p) => p[0] === 8 && p[1] === 1));await bootAnswer.transport.close();
  // Mutation after review is caught before any keyboard command or close.
  const mutated = new Keyboard(), mutation = await updater(mutated);mutation.prepared.bytes[4097] ^= 1;
  await assert.rejects(mutation.update.run(mutation.prepared, mutation.t), /checksum/);checks++;
  equal(mutated.sent.length, 0);check(mutated.opened, "Bad file does not close a connection it never acquired.");await mutation.t.close();
  // Bootloader vendor collection is accepted only by the dedicated opt-in path.
  const ff80 = new Keyboard({ mode: 255 });ff80.collections = [{ usagePage: 0xff80, usage: 2 }];
  await assert.rejects(new AE64HidTransport(ff80).open(), /collection/);checks++;
  const opted = new AE64HidTransport(ff80, { allowBootloader: true });await opted.open();check(opted.connected);await opted.close();
  const noStart = new Keyboard();new F.Updater({ reconnect: async () => {} });equal(noStart.sent.length, 0, "Constructing an updater does not start it.");
  // Deployment includes actual binaries/catalog, not just a list of filenames.
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), "ae64-firmware-package-"));
  const { packageFirmware } = require("../../scripts/package-firmware.cjs");equal(packageFirmware(destination), catalog.firmwares.length);
  for (const e of catalog.firmwares) equal(crypto.createHash("sha256").update(fs.readFileSync(path.join(destination, "firmware", e.file))).digest("hex"), e.sha256);
  if (path.dirname(destination) !== path.resolve(os.tmpdir()) || !path.basename(destination).startsWith("ae64-firmware-package-")) throw new Error("Unexpected test temporary directory.");
  fs.rmSync(destination, { recursive: true, force: true });
  console.log(`PASS: ${checks} firmware checks; simulated lifecycle, isolation, failure handling, all ${catalog.firmwares.length} binary streams and deployment. No hardware accessed.`);
}
main().catch((error) => { console.error(error);process.exitCode = 1; });
