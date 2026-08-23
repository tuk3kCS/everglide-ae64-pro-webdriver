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
    queueMicrotask(() => this.reply(reply));
  }
}

async function main() {
  for (const file of ["protocol.js", "app.js"]) new Function(read(file));
  const html = read("index.html");
  const app = read("app.js");
  const xml = read("languages.xml");

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

  equal(API.DEVICE_FILTERS, [{ vendorId: 0x1ca6, productId: 0x300a, usagePage: 0xffb0, usage: 1 }], "WebHID filter changed.");
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

  console.log("Smoke test passed: WebHID packets, codecs, language XML, feature visibility, and firmware-update exclusion verified.");
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
