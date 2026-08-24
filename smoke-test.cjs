"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const API = require("./protocol.js");

const root = __dirname;
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const equal = (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}\nExpected ${JSON.stringify(expected)}\nActual   ${JSON.stringify(actual)}`);
};

class FakeDevice {
  constructor() {
    this.opened = true;
    this.vendorId = 0x1ca6;
    this.productId = 0x300a;
    this.collections = [{ usagePage: 0xffb0, usage: 0x01 }];
    this.listeners = new Map();
    this.sent = [];
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  async close() { this.opened = false; }
  async open() { this.opened = true; }
  reply(bytes) {
    const report = new Uint8Array(64);
    report.set(bytes);
    this.listeners.get("inputreport")?.({ data: new DataView(report.buffer) });
  }
  async sendReport(reportId, bytes) {
    const packet = Array.from(bytes);
    this.sent.push({ reportId, packet });
    const reply = new Uint8Array(64);
    reply[0] = packet[0]; reply[1] = packet[1];
    if (packet[0] === 1 && packet[1] === 2) {
      reply.set([0x00, 0x30, 0x00, 0x0a], 4);
      reply.set([0, 0, 7, 0], 8);
    }
    if (packet[0] === 4 && packet[1] === 1) {
      reply[2] = packet[2]; reply[3] = packet[3]; reply[4] = 1;
      reply.set([0xd0, 0x07, 0, 0, 0xd0, 0x07, 0x96, 0, 0x96, 0, 0x64, 0, 0x64, 0, 2, 1, 0x34, 0x12, 0x78, 0x56, 0xbc, 0x9a], 5);
    }
    if (packet[0] === 2 && packet[1] === 8) {
      reply[3] = 2;
      reply.set([0, 20, 6, 15, 1, 5, 1, 38], 4);
    }
    if (packet[0] === 5 && packet[1] === 1 && packet[3] === 0) {
      reply[2] = packet[2];
      reply.set(packet[2] === 0 ? [3, 19, 100, 0, 1, 7] : [1, 4, 80, 50, 0, 2], 4);
    }
    if (packet[0] === 5 && packet[1] === 3) {
      reply[2] = packet[2]; reply[3] = packet[3];
      for (let index = 0; index < 15; index += 1) reply.set([index + packet[3], 20 + packet[2], 40 + index, 0], 4 + index * 4);
    }
    queueMicrotask(() => this.reply(reply));
  }
}

async function main() {
  for (const file of ["protocol.js", "app.js"]) new Function(read(file));
  const html = read("index.html");
  const app = read("app.js");
  const xml = read("languages.xml");
  const pagesWorkflow = read(path.join(".github", "workflows", "pages.yml"));

  for (const action of ["actions/checkout@v6", "actions/configure-pages@v6", "actions/upload-pages-artifact@v5", "actions/deploy-pages@v5"])
    if (!pagesWorkflow.includes(action)) throw new Error(`GitHub Pages workflow is missing ${action}.`);
  for (const file of ["index.html", "styles.css", "protocol.js", "app.js", "languages.xml"])
    if (!pagesWorkflow.includes(file)) throw new Error(`GitHub Pages artifact omits ${file}.`);
  if (!pagesWorkflow.includes("cp index.html styles.css protocol.js app.js languages.xml _site/") || !pagesWorkflow.includes("path: _site"))
    throw new Error("GitHub Pages must upload the isolated runtime-only artifact.");
  for (const privatePath of ["xsyd.top HAR files", "captured_usb_packets.pcapng", "tasks.txt", "ae64pro.txt", ".openai"])
    if (pagesWorkflow.includes(privatePath)) throw new Error(`GitHub Pages workflow publishes non-runtime content: ${privatePath}.`);

  if (!html.includes('id="heroConnect"') || !html.includes('id="applyButton"')) throw new Error("Required connect/apply controls are missing.");
  if (!xml.includes('<language code="en"') || !xml.includes('<language code="vi"')) throw new Error("English and Vietnamese XML languages are required.");
  for (const feature of ["DKS", "MPT", "MT", "TGL", "END", "SOCD", "RS"]) if (!app.includes(`\"${feature}\"`)) throw new Error(`Hidden advanced feature ${feature} is not visible.`);
  for (const forbidden of ["flashFirmware", "writeFirmware", "bootloaderCommand", "firmwareFileInput"]) if ([html, app, read("protocol.js")].some((source) => source.includes(forbidden))) throw new Error(`Firmware-update capability leaked into the project: ${forbidden}`);

  const elements = new Map();
  const makeElement = (selector) => {
    if (elements.has(selector)) return elements.get(selector);
    const node = { innerHTML: "", textContent: "", value: "", disabled: false, dataset: {}, files: [],
      classList: { add() {}, remove() {}, toggle() {}, contains() { return true; } },
      style: { setProperty() {} }, addEventListener() {}, click() {}, focus() {} };
    elements.set(selector, node);
    return node;
  };
  const browser = {
    console, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, Promise, Math, Number, String, Boolean, Object, Array, Set, Map, JSON, Error, Date, RegExp, Blob, URL,
    localStorage: { getItem() { return null; }, setItem() {} },
    navigator: { hid: { addEventListener() {} } },
    document: {
      documentElement: {},
      querySelector: makeElement,
      querySelectorAll(selector) {
        if (selector === ".language-select") return [makeElement("language-1"), makeElement("language-2")];
        if (selector.includes("#connectButton")) return [makeElement("connect-buttons")];
        if (selector.includes("#demoButton")) return [makeElement("demo-buttons")];
        return [];
      },
    },
    fetch: async () => ({ ok: false, status: 404 }),
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    scrollTo() {},
  };
  browser.window = browser;
  browser.AE64Protocol = API;
  vm.createContext(browser);
  vm.runInContext(app, browser, { filename: "app.js" });
  const renderedKeys = (elements.get("#heroKeyboard").innerHTML.match(/class="key /g) || []).length;
  if (renderedKeys !== 64) throw new Error(`Browser bootstrap rendered ${renderedKeys} keys instead of 64.`);
  const settingsEnums = vm.runInContext(`({
    systems: SYSTEM_MODE_OPTIONS.map(({ value, label }) => [value, label]),
    polling: POLLING_RATE_OPTIONS.map(({ value, hz }) => [value, hz]),
    lightingModes: LIGHTING_MODE_OPTIONS.map(({ value, label }) => [value, label]),
    customDefaults: Object.values(defaultProfile().lighting.customEnabled),
    decorativeDefaults: defaultProfile().lighting.decorative.customEnabled,
    rowUnits: layout.map((row) => row.reduce((sum, key) => sum + (key.u || 1), 0)),
  })`, browser);
  equal(settingsEnums.systems, [[0, "Windows"], [1, "macOS"]], "System-mode labels no longer match the manufacturer enum.");
  equal(settingsEnums.polling, [[5, 250], [4, 500], [3, 1000], [2, 2000], [1, 4000], [0, 8000]], "Polling-rate labels no longer match the manufacturer enum.");
  equal(settingsEnums.lightingModes, Array.from({ length: 23 }, (_, value) => [value, `L${value + 1}`]), "The generic lighting catalog must remain L1-L23.");
  if (settingsEnums.customDefaults.some(Boolean)) throw new Error("Per-key custom overrides must be disabled by default.");
  if (settingsEnums.decorativeDefaults.length !== 38 || settingsEnums.decorativeDefaults.some(Boolean)) throw new Error("Decorative1 must default to 38 inherited LEDs.");
  equal(settingsEnums.rowUnits, [15, 15, 15, 15, 15], "Keyboard rows no longer occupy the same 15-unit width.");
  const settingsMarkup = vm.runInContext("settingsPage()", browser);
  for (const label of ["Windows", "macOS", "250 Hz", "500 Hz", "1,000 Hz", "2,000 Hz", "4,000 Hz", "8,000 Hz"]) if (!settingsMarkup.includes(label)) throw new Error(`Device settings omitted mapped label ${label}.`);
  const lightingMarkup = vm.runInContext(`(state.page = "lighting", state.lightingTab = "main", lightingPage())`, browser);
  for (const required of ['data-lighting-tab="main"', 'data-lighting-tab="perKey"', 'data-lighting-tab="strip"', 'data-lighting-mode="19"', 'id="lightingBrightness"', 'id="lightingSpeed"', 'data-lighting-direction="0"', 'data-lighting-direction="1"', 'id="paletteColor"', 'id="upperLighting"', 'id="lowerLighting"', 'id="lightingLive"'])
    if (!lightingMarkup.includes(required)) throw new Error(`Lighting overhaul omitted ${required}.`);
  if (lightingMarkup.includes('data-lighting-mode="20"')) throw new Error("AE64 area 0 must stop at the 20 device-reported modes.");
  for (const invalid of ["Effect 0", ">Left<", ">Right<"])
    if (lightingMarkup.includes(invalid)) throw new Error(`Lighting UI still exposes an invalid mapping: ${invalid}.`);
  const perKeyMarkup = vm.runInContext(`(state.lightingTab = "perKey", lightingPage())`, browser);
  for (const required of ['id="keyCustomEnabled"', 'id="keyColor"', 'id="loadCustomLighting"', 'id="clearKeyColor"', 'id="clearAllKeyColors"'])
    if (!perKeyMarkup.includes(required)) throw new Error(`Per-key lighting editor omitted ${required}.`);
  const stripMarkup = vm.runInContext(`(state.lightingTab = "strip", lightingPage())`, browser);
  for (const required of ['id="stripBrightness"', 'id="stripSpeed"', 'id="stripPaletteColor"', 'id="stripCustomEnabled"', 'id="loadStripLighting"', 'data-lighting-mode="4"'])
    if (!stripMarkup.includes(required)) throw new Error(`Decorative1 editor omitted ${required}.`);
  if ((stripMarkup.match(/data-strip-led=/g) || []).length !== 38) throw new Error("Decorative1 must render all 38 addressable LEDs.");
  if (!read("styles.css").includes("calc((var(--unit) + var(--key-gap)) * var(--u) - var(--key-gap))")) throw new Error("Wide keys do not compensate for the grid gaps they span.");

  equal(API.DEVICE_FILTERS, [{ vendorId: 0x1ca6, productId: 0x300a, usagePage: 0xffb0, usage: 1 }], "WebHID filter changed.");
  equal(API.LIGHTING_OPEN_MODE, { OFF: 0, LOWER: 1, UPPER: 2, BOTH: 3 }, "Upper/lower lighting bit mapping changed.");
  if (API.DECORATIVE_ROWS !== 1 || API.DECORATIVE_COLS !== 38) throw new Error("Decorative1 geometry changed.");
  equal(API.le16(0x1234), [0x34, 0x12], "Little-endian codec failed.");
  const encodedColors = API.encodeColors([{ r: 0x11, g: 0x22, b: 0x33, custom: true }]);
  equal(encodedColors.slice(0, 4), [0x33, 0x22, 0x11, 0xff], "Custom RGB must use B,G,R,flag order.");

  const device = new FakeDevice();
  const transport = new API.AE64HidTransport(device);
  await transport.open();
  const info = await transport.getDeviceInfo();
  if (info.boardIdHex !== "0030000a" || info.firmware !== "0.0.7.0") throw new Error("Device information decoder failed.");

  const performance = await transport.getPerformance({ row: 2, col: 3 });
  if (performance.mode !== 1 || performance.normalPress !== 2 || performance.rtPress !== 0.15 || performance.axisV2Id !== 0x1234) throw new Error("Performance decoder failed.");
  await transport.setPerformance({ row: 2, col: 3 }, performance);
  const write = device.sent.at(-1).packet;
  equal(write.slice(0, 7), [4, 2, 2, 3, 1, 0xd0, 0x07], "Performance write header/actuation encoding failed.");
  if (write.length !== 64) throw new Error("Every HID report must be zero-padded to 64 bytes.");
  await transport.setKeyCode({ row: 1, col: 2 }, 0x1234, 3);
  equal(device.sent.at(-1).packet.slice(0, 7), [3, 4, 3, 1, 2, 0x34, 0x12], "Four-layer keycode write encoding failed.");
  await transport.saveParameters(API.SAVE_GROUP.LAYOUT);
  equal(device.sent.at(-1).packet.slice(0, 3), [2, 2, 4], "Layout save group changed.");
  await transport.setCustomLightingPacket(2, [{ r: 0x11, g: 0x22, b: 0x33, custom: true }]);
  equal(device.sent.at(-1).packet.slice(0, 8), [5, 4, 0, 2, 0x33, 0x22, 0x11, 0xff], "Custom-light packet changed.");
  await transport.setCustomLightingPacket(3, [{ r: 0x11, g: 0x22, b: 0x33, custom: false }]);
  equal(device.sent.at(-1).packet.slice(0, 8), [5, 4, 0, 3, 0x33, 0x22, 0x11, 0x00], "Cleared custom-light overrides must use flag 0.");
  const lightingAreas = await transport.getLightingAreas();
  equal(lightingAreas, [{ index: 0, count: 20, rows: 6, cols: 15 }, { index: 1, count: 5, rows: 1, cols: 38 }], "Lighting-area capability decoder failed.");
  const lightingBase = await transport.getLightingBase(0);
  equal(lightingBase, { area: 0, open: true, openMode: 3, mode: 19, brightness: 100, speed: 0, direction: 1, paletteIndex: 7 }, "Main-light base decoder failed.");
  await transport.setLightingBase(lightingBase, 0);
  equal(device.sent.at(-1).packet.slice(0, 10), [5, 2, 0, 0, 3, 19, 100, 0, 1, 7], "Main-light dual-LED packet mapping failed.");
  await transport.setLightingBase({ ...lightingBase, openMode: API.LIGHTING_OPEN_MODE.UPPER }, 0);
  equal(device.sent.at(-1).packet.slice(0, 5), [5, 2, 0, 0, 2], "North-facing-only lighting must encode value 2.");
  await transport.setLightingBase({ ...lightingBase, openMode: API.LIGHTING_OPEN_MODE.LOWER }, 0);
  equal(device.sent.at(-1).packet.slice(0, 5), [5, 2, 0, 0, 1], "South-facing-only lighting must encode value 1.");
  const decorativeBase = await transport.getLightingBase(1);
  equal(decorativeBase, { area: 1, open: true, openMode: 1, mode: 4, brightness: 80, speed: 50, direction: 0, paletteIndex: 2 }, "Decorative1 base decoder failed.");
  await transport.setCustomLightingPacket(2, [{ r: 1, g: 2, b: 3, custom: true }], 1);
  equal(device.sent.at(-1).packet.slice(0, 8), [5, 4, 1, 2, 3, 2, 1, 0xff], "Decorative1 custom packet changed.");
  const liveStrip = await transport.readLiveLighting(1, 38, 1);
  if (liveStrip.length !== 38 || liveStrip[0].r !== 40 || liveStrip[15].r !== 40) throw new Error("Live Decorative1 framebuffer decoding failed.");

  console.log("Smoke test passed: WebHID packets, RGB mappings, Pages packaging, language XML, feature visibility, and firmware-update exclusion verified.");
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
