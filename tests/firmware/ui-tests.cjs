"use strict";
// Exercise selection/review/navigation without a browser or hardware transport.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const F = require("../../js/firmware/flasher.js"), root = path.resolve(__dirname, "../..");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "firmware/catalog.json"), "utf8"));
const nodes = new Map(), notices = [], fetches = [], starts = [];
let pendingFirst = null;
function node(selector) {
  if (!nodes.has(selector)) nodes.set(selector, { listeners: {}, textContent: "", value: 0, disabled: false, classList: { toggle() {} }, addEventListener(type, fn) { this.listeners[type] = fn; }, showModal() { this.open = true; }, close() { this.open = false; }, scrollIntoView() {} });
  return nodes.get(selector);
}
const fakeTransport = { connected: true, device: {}, close: async () => {} };
const context = {
  window: null, document: { baseURI: "https://example.test/keyboard-driver/", querySelector: node, querySelectorAll: () => [] },
  navigator: { hid: {} }, URL, console, setTimeout, clearTimeout,
  state: { page: "firmware", firmwareBusy: false, gamepadBusy: false, transport: fakeTransport, timers: {}, hardware: { info: { firmware: "0.0.7.0" } } },
  esc: (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"),
  dirtyCount: () => 0, connected: () => true, render() {}, renderStatus() {}, stopPolling() {}, stopProfilePolling() {},
  showToast: (text) => notices.push(text), log() {},
  connectKeyboard: async () => { context.state.transport = fakeTransport; return true; },
  rememberGamepadProfile() {},
  AE64GamepadTemplate: "<p>Hardware controls</p>", AE64GamepadStudio: { mount: () => ({ dispose() {} }) },
  AE64Firmware: { ...F, Updater: class { constructor(options) { this.options = options; } async run(prepared) { starts.push(prepared);this.options.progress({ phase: "complete", percent: 100 });return { transport: fakeTransport }; } } },
  fetch: async (url) => {
    const target = String(url);fetches.push(target);
    if (target.endsWith("catalog.json")) return { ok: true, json: async () => catalog };
    if (pendingFirst && target.includes(pendingFirst.file)) return pendingFirst.promise;
    const file = decodeURIComponent(target.split("/firmware/")[1]);
    const bytes = fs.readFileSync(path.join(root, "firmware", file));
    return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  },
};
context.window = context;vm.createContext(context);
for (const file of ["js/app/gamepad-usb.js", "js/app/gamepad-page.js", "js/app/firmware-page.js"]) vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context);
async function main() {
  await vm.runInContext("loadFirmwareCatalog()", context);
  assert.equal(starts.length, 0);assert.equal(fetches[0], "https://example.test/keyboard-driver/firmware/catalog.json");
  assert.throws(() => vm.runInContext("firmwareFileUrl('../outside.bin')", context), /invalid firmware path/);
  assert.throws(() => vm.runInContext("firmwareFileUrl('https://other.test/firmware.bin')", context), /invalid firmware path/);
  const stock = catalog.firmwares.find((e) => e.kind === "stock");context.stockId = stock.id;
  await vm.runInContext("selectCatalogFirmware(stockId)", context);
  assert.equal(vm.runInContext("firmwareView.prepared.entry.id", context), stock.id);
  assert.equal(starts.length, 0);
  const markup = vm.runInContext("firmwarePage()", context);assert.ok(markup.includes("Review and flash firmware"));assert.ok(markup.includes(stock.sha256));
  assert.match(markup, /Flash factory firmware/);
  assert.doesNotMatch(markup, /firmwareRiskAcknowledgment/);
  vm.runInContext("bindFirmwarePage()", context);
  node("#reviewFirmware").listeners.click();assert.equal(node("#firmwareReviewDialog").open, true);assert.equal(starts.length, 0);
  node("#cancelFirmwareReview").listeners.click();assert.equal(starts.length, 0);
  // The hardware shortcut must replace the prior stock selection, not keep it.
  context.driverStorage = {};
  vm.runInContext("state.page = 'gamepad'; bindGamepadPage()", context);
  node("#openHardwareFirmware").listeners.click();
  assert.equal(vm.runInContext("firmwareView.prepared", context), null);
  assert.equal(vm.runInContext("state.page", context), "firmware");
  await vm.runInContext("selectCatalogFirmware(firmwareView.selectedId)", context);
  assert.equal(vm.runInContext("firmwareView.prepared.entry.kind", context), "custom");assert.equal(starts.length, 0);
  // Stale review cannot start another selected image.
  vm.runInContext("bindFirmwarePage()", context);
  const acknowledgment = node("#firmwareRiskAcknowledgment"), start = node("#startFirmwareUpdate");
  node("#reviewFirmware").listeners.click();acknowledgment.checked = true;acknowledgment.listeners.change();
  vm.runInContext("firmwareView.prepared = {...firmwareView.prepared}", context);
  node("#startFirmwareUpdate").listeners.click();await Promise.resolve();
  assert.equal(starts.length, 0);assert.match(notices.at(-1), /image changed/);
  // Display a useful error after a re-render, instead of replacing it with generic help.
  vm.runInContext("firmwareProgress({phase:'error',detail:'Specific validation failure'}); firmwareProgress({})", context);
  assert.equal(node("#firmwareDetail").textContent, "Specific validation failure");
  // A slower previous selection must not overwrite the newer custom image.
  let release;
  const bytes = fs.readFileSync(path.join(root, "firmware", stock.file));
  pendingFirst = { file: stock.file, promise: new Promise((resolve) => { release = () => resolve({ ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }); }) };
  const first = vm.runInContext("selectCatalogFirmware(stockId)", context);
  context.customId = catalog.firmwares.find((e) => e.kind === "custom").id;
  await vm.runInContext("selectCatalogFirmware(customId)", context);
  release();await first;pendingFirst = null;
  assert.equal(vm.runInContext("firmwareView.prepared.entry.kind", context), "custom");
  const customMarkup = vm.runInContext("firmwarePage()", context);
  assert.match(customMarkup, /Experimental firmware can stop the keyboard from working/);
  assert.match(customMarkup, /id="startFirmwareUpdate" disabled/);
  // A custom update requires a new acknowledgment and an explicit Start.
  vm.runInContext("bindFirmwarePage()", context);node("#reviewFirmware").listeners.click();assert.equal(starts.length, 0);
  assert.equal(start.disabled, true);
  start.listeners.click();assert.equal(starts.length, 0);assert.ok(node("#firmwareReviewDialog").open);
  acknowledgment.checked = true;acknowledgment.listeners.change();assert.equal(start.disabled, false);
  node("#cancelFirmwareReview").listeners.click();node("#reviewFirmware").listeners.click();
  assert.equal(acknowledgment.checked, false);assert.equal(start.disabled, true);
  acknowledgment.checked = true;acknowledgment.listeners.change();
  start.listeners.click();await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(starts.length, 1);assert.equal(starts[0].entry.kind, "custom");
  // A local filename cannot establish whether the binary is from the factory.
  const localFile = (bytes, name) => ({ name, arrayBuffer: async () => Uint8Array.from(bytes).buffer });
  const chooseLocal = (file) => node("#firmwareFileInput").listeners.change({ target: { files: [file] } });
  await chooseLocal(localFile(bytes, "renamed.bin"));
  assert.match(vm.runInContext("firmwarePage()", context), /Flash factory firmware/);
  vm.runInContext("bindFirmwarePage()", context);node("#reviewFirmware").listeners.click();start.listeners.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(starts.length, 2);assert.equal(starts[1].entry.kind, "stock");
  const unverified = Uint8Array.from(bytes);unverified[4096] ^= 1;
  new DataView(unverified.buffer).setUint32(16, F.crc32(unverified.subarray(4096)), true);
  await chooseLocal(localFile(unverified, stock.file));
  const localMarkup = vm.runInContext("firmwarePage()", context);
  assert.match(localMarkup, /Unverified local firmware/);
  assert.match(localMarkup, /id="startFirmwareUpdate" disabled/);
  const gamepad = vm.runInContext("gamepadPage()", context);
  assert.ok(gamepad.includes("Hardware Solution") && gamepad.includes("Software Solution") && gamepad.includes("https://github.com/z750sasr/he-kb-analog-mapper"));
  console.log("PASS: firmware review and risk acknowledgment, local image classification, image-switch race, hardware shortcut and subpath URLs. No hardware accessed.");
}
main().catch((e) => { console.error(e);process.exitCode = 1; });
