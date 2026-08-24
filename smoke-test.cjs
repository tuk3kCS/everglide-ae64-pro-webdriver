"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const API = require("./protocol.js");

const root = __dirname;
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const APP_FILES = [
  "js/app/foundation.js",
  "js/app/pages.js",
  "js/app/interactions.js",
  "js/app/device.js",
  "js/app/live.js",
  "js/app/profiles.js",
  "app.js",
];
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
    if (packet[0] === 3 && packet[1] === 1) {
      reply[2] = packet[2]; reply[3] = packet[3];
      for (let col = 0; col < 30; col += 1) {
        const keycode = 0x1000 + packet[2] * 0x100 + packet[3] * 0x10 + col;
        reply[4 + col * 2] = keycode & 0xff;
        reply[5 + col * 2] = keycode >>> 8;
      }
    }
    if (packet[0] === 3 && packet[1] === 3) {
      reply[2] = packet[2]; reply[3] = packet[3]; reply[4] = packet[4];
      const keycode = 0x1000 + packet[2] * 0x100 + packet[3] * 0x10 + packet[4];
      reply[5] = keycode & 0xff; reply[6] = keycode >>> 8;
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
  for (const file of ["protocol.js", ...APP_FILES]) new Function(read(file));
  const html = read("index.html");
  const app = APP_FILES.map(read).join("\n");
  const xml = read("languages.xml");
  const pagesWorkflow = read(path.join(".github", "workflows", "pages.yml"));

  for (const action of ["actions/checkout@v6", "actions/configure-pages@v6", "actions/upload-pages-artifact@v5", "actions/deploy-pages@v5"])
    if (!pagesWorkflow.includes(action)) throw new Error(`GitHub Pages workflow is missing ${action}.`);
  for (const file of ["index.html", "styles.css", "protocol.js", "app.js", "languages.xml", "js/app/*.js"])
    if (!pagesWorkflow.includes(file)) throw new Error(`GitHub Pages artifact omits ${file}.`);
  if (!pagesWorkflow.includes("cp index.html styles.css protocol.js app.js languages.xml _site/") || !pagesWorkflow.includes("cp js/app/*.js _site/js/app/") || !pagesWorkflow.includes("path: _site"))
    throw new Error("GitHub Pages must upload the isolated runtime-only artifact.");
  for (const privatePath of ["xsyd.top HAR files", "captured_usb_packets.pcapng", "tasks.txt", "ae64pro.txt", ".openai"])
    if (pagesWorkflow.includes(privatePath)) throw new Error(`GitHub Pages workflow publishes non-runtime content: ${privatePath}.`);

  if (!html.includes('id="heroConnect"') || !html.includes('id="applyButton"')) throw new Error("Required connect/apply controls are missing.");
  let previousScript = -1;
  for (const file of ["protocol.js", ...APP_FILES]) {
    const script = `<script src="${file}"></script>`;
    const position = html.indexOf(script);
    if (position < 0) throw new Error(`index.html does not load ${file}.`);
    if (position <= previousScript) throw new Error(`Application script order is invalid at ${file}.`);
    previousScript = position;
  }
  for (const file of APP_FILES) {
    const lines = read(file).split(/\r?\n/).length;
    if (lines > 1000) throw new Error(`${file} has ${lines} lines; split application modules must stay below 1,000.`);
  }
  for (const control of ['id="quickProfileSelect"', 'id="quickProfileRename"', 'id="applyReviewDialog"', 'id="profileRenameDialog"'])
    if (!html.includes(control)) throw new Error(`Profile/apply workflow omitted ${control}.`);
  for (const removedId of ['id="profileSelect"', 'id="workspaceConnectButton"']) if (html.includes(removedId)) throw new Error(`Header control remains: ${removedId}.`);
  for (const sidebarControl of ['id="backHomeButton"', 'id="layerSelect"', 'class="sidebar-controls"']) if (!html.includes(sidebarControl)) throw new Error(`Sidebar control is missing: ${sidebarControl}.`);
  for (const removedId of ['id="demoButton"', 'id="heroDemo"', 'id="features"', 'id="protocol"']) if (html.includes(removedId)) throw new Error(`Removed landing-page section remains: ${removedId}.`);
  if (!app.includes("navigator.hid.getDevices") || !app.includes("detectKnownKeyboard") || !app.includes("state.knownDevice")) throw new Error("Known WebHID devices are not detected for direct connection.");
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
    decorativeLayout: Object.fromEntries(Object.entries(DECORATIVE_LAYOUT).map(([side, indexes]) => [side, Array.from(indexes)])),
    rowUnits: layout.map((row) => row.reduce((sum, key) => sum + (key.u || 1), 0)),
    vendorKeycodes: {
      fn1: KEYCODE_LABELS.get(0xf101),
      fn2: KEYCODE_LABELS.get(0xf102),
      leftAlt: KEYCODE_LABELS.get(0x00e2),
      mute: KEYCODE_LABELS.get(0x20e2),
      mouseLeft: KEYCODE_LABELS.get(0x4100),
      lightingToggle: KEYCODE_LABELS.get(0xf307),
      fnDefault: defaultKeycode(keys.find((key) => key.n === "Fn")),
    },
    selectorCoverage: {
      empty: KEYCODE_LABELS.get(0),
      transparent: KEYCODE_LABELS.get(1),
      decorative2: KEYCODE_LABELS.get(0xf320),
      decorative3: KEYCODE_LABELS.get(0xf338),
      macroCount: KEYCODE_GROUPS.macro.length,
      connectionCount: KEYCODE_GROUPS.connection.length,
      gamepadCount: KEYCODE_GROUPS.gamepad.length,
      gamepadDpadRight: KEYCODE_LABELS.get(0x5208),
    },
    vendorCatalog: Object.fromEntries(
      ["system", "media", "mouse", "firmware", "lighting"].map((group) => [
        group,
        KEYCODE_GROUPS[group].map(({ code }) => code),
      ]),
    ),
    shiftedRowPositions: (() => {
      const style = layout.map((row, firmwareRow) =>
        row.map((_, visualCol) => ({ row: firmwareRow, col: visualCol, ratio: 4 })),
      );
      style[3] = [{ ratio: 0 }, ...layout[3].map((_, visualCol) => ({ row: 3, col: visualCol, ratio: 4 }))];
      style[4] = [{ ratio: 0 }, ...layout[4].map((_, visualCol) => ({ row: 4, col: visualCol, ratio: 4 }))];
      const positions = firmwareKeyPositions(style);
      return [
        positions.get(keys.find((key) => key.uiRow === 3 && key.col === 0).id),
        positions.get(keys.find((key) => key.uiRow === 3 && key.col === 13).id),
        positions.get(keys.find((key) => key.uiRow === 4 && key.col === 0).id),
        positions.get(keys.find((key) => key.uiRow === 4 && key.col === 8).id),
      ];
    })(),
  })`, browser);
  equal(settingsEnums.systems, [[0, "Windows"], [1, "macOS"]], "System-mode labels no longer match the manufacturer enum.");
  equal(settingsEnums.polling, [[5, 250], [4, 500], [3, 1000], [2, 2000], [1, 4000], [0, 8000]], "Polling-rate labels no longer match the manufacturer enum.");
  equal(settingsEnums.lightingModes, Array.from({ length: 23 }, (_, value) => [value, `L${value + 1}`]), "The generic lighting catalog must remain L1-L23.");
  if (settingsEnums.customDefaults.some(Boolean)) throw new Error("Per-key custom overrides must be disabled by default.");
  if (settingsEnums.decorativeDefaults.length !== 38 || settingsEnums.decorativeDefaults.some(Boolean)) throw new Error("Decorative1 must default to 38 inherited LEDs.");
  equal(settingsEnums.decorativeLayout, {
    top: [27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 0, 1],
    right: [2, 3, 4, 5, 6],
    bottom: [20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7],
    left: [26, 25, 24, 23, 22, 21],
  }, "Decorative1 physical perimeter order changed.");
  const perimeterIndexes = Object.values(settingsEnums.decorativeLayout).flat().sort((a, b) => a - b);
  equal(perimeterIndexes, Array.from({ length: 38 }, (_, index) => index), "Decorative1 perimeter must contain every protocol index exactly once.");
  equal(settingsEnums.rowUnits, [15, 15, 15, 15, 15], "Keyboard rows no longer occupy the same 15-unit width.");
  equal(settingsEnums.vendorKeycodes, {
    fn1: "Switch Fn1 layer",
    fn2: "Switch Fn2 layer",
    leftAlt: "Left Alt",
    mute: "Mute",
    mouseLeft: "Mouse Left",
    lightingToggle: "Lighting on / off",
    fnDefault: 0xf102,
  }, "Vendor keycodes must match the values captured from the original driver.");
  equal(settingsEnums.selectorCoverage, {
    empty: "Empty Key",
    transparent: "Transparent Key",
    decorative2: "Decorative lighting 2 mode",
    decorative3: "Decorative lighting 3 direction",
    macroCount: 16,
    connectionCount: 7,
    gamepadCount: 58,
    gamepadDpadRight: "Gamepad D-pad Right",
  }, "The complete original-driver mapping catalog must remain selectable.");
  equal(settingsEnums.vendorCatalog, {
    system: [0x1152, 0x1329, 0x1807, 0x1808, 0x1815],
    media: [0x206f, 0x2070, 0x20b5, 0x20b6, 0x20b7, 0x20cd, 0x20e2, 0x20e9, 0x20ea, 0x2183, 0x218a, 0x2192, 0x2194, 0x2223],
    mouse: [0x4000, 0x4100, 0x4200, 0x4300, 0x4400, 0x4500, 0x4600, 0x4700, 0x4800, 0x4900, 0x4a01, 0x4b01],
    firmware: [0xf100, 0xf101, 0xf102, 0xf103, 0xf200, 0xf201, 0xf202, 0xf203, 0xf205, 0xf206, 0xf207, 0xf208, 0xf209, 0xf20a, 0xf20c],
    lighting: [0xf300, 0xf301, 0xf302, 0xf303, 0xf304, 0xf305, 0xf306, 0xf307, 0xf308, 0xf310, 0xf311, 0xf312, 0xf313, 0xf314, 0xf315, 0xf316, 0xf317, 0xf318, 0xf320, 0xf321, 0xf322, 0xf323, 0xf324, 0xf325, 0xf326, 0xf327, 0xf328, 0xf330, 0xf331, 0xf332, 0xf333, 0xf334, 0xf335, 0xf336, 0xf337, 0xf338],
  }, "Every supported non-keyboard keycode must match the original-driver HAR catalog.");
  equal(settingsEnums.shiftedRowPositions, [
    { row: 3, col: 1 },
    { row: 3, col: 14 },
    { row: 4, col: 1 },
    { row: 4, col: 9 },
  ], "Firmware layout metadata must correct leading blank slots without moving the visible keys.");
  const settingsMarkup = vm.runInContext("settingsPage()", browser);
  for (const label of ["Windows", "macOS", "250 Hz", "500 Hz", "1,000 Hz", "2,000 Hz", "4,000 Hz", "8,000 Hz"]) if (!settingsMarkup.includes(label)) throw new Error(`Device settings omitted mapped label ${label}.`);
  const lightingMarkup = vm.runInContext(`(state.page = "lighting", state.lightingTab = "main", lightingPage())`, browser);
  for (const required of ['data-lighting-tab="main"', 'data-lighting-tab="perKey"', 'data-lighting-tab="strip"', '>Keyboard</button>', '>Per-key</button>', '>Light strip</button>', 'Unified live lighting', 'Keyboard + light strip', 'data-lighting-mode="19"', 'data-lighting-mode="20"', 'data-lighting-mode="21"', 'data-lighting-mode="22"', 'id="lightingBrightness"', 'id="lightingSpeed"', 'data-lighting-direction="0"', 'data-lighting-direction="1"', 'id="paletteColor"', 'id="upperLighting"', 'id="lowerLighting"', 'id="lightingLive"'])
    if (!lightingMarkup.includes(required)) throw new Error(`Lighting overhaul omitted ${required}.`);
  if ((lightingMarkup.match(/class="decorative-frame"/g) || []).length !== 1) throw new Error("Lighting must render exactly one unified keyboard-and-strip preview.");
  if (!lightingMarkup.includes("UNADVERTISED") || !lightingMarkup.includes("L21–L23 are experimental")) throw new Error("Unadvertised effects must be clearly labeled as experimental.");
  for (const invalid of ["Effect 0", ">Left<", ">Right<"])
    if (lightingMarkup.includes(invalid)) throw new Error(`Lighting UI still exposes an invalid mapping: ${invalid}.`);
  const perKeyMarkup = vm.runInContext(`(state.lightingTab = "perKey", lightingPage())`, browser);
  for (const required of ['id="keyCustomEnabled"', 'id="keyColor"', 'id="loadCustomLighting"', 'id="clearKeyColor"', 'id="clearAllKeyColors"'])
    if (!perKeyMarkup.includes(required)) throw new Error(`Per-key lighting editor omitted ${required}.`);
  if ((perKeyMarkup.match(/class="decorative-frame"/g) || []).length !== 1 || !perKeyMarkup.includes("Drag across keyboard keys")) throw new Error("Per-key must reuse the unified preview and explain drag selection.");
  const perKeyMultiMarkup = vm.runInContext(`(state.lightingSelectedKeys = new Set([0, 1, 2]), lightingPage())`, browser);
  if (!perKeyMultiMarkup.includes("3 keys") || !perKeyMultiMarkup.includes("3 SELECTED")) throw new Error("Per-key multi-selection is not reflected in its editor.");
  const stripMarkup = vm.runInContext(`(state.lightingTab = "strip", lightingPage())`, browser);
  for (const required of ['id="stripBrightness"', 'id="stripSpeed"', 'id="stripPaletteColor"', 'id="stripCustomEnabled"', 'id="loadStripLighting"', 'data-lighting-mode="4"'])
    if (!stripMarkup.includes(required)) throw new Error(`Decorative1 editor omitted ${required}.`);
  if ((stripMarkup.match(/data-strip-led=/g) || []).length !== 38) throw new Error("Decorative1 must render all 38 addressable LEDs.");
  if ((stripMarkup.match(/class="decorative-frame"/g) || []).length !== 1 || !stripMarkup.includes("Drag only across the four light-strip sides")) throw new Error("Light strip must reuse the unified preview and scope selection to its four sides.");
  for (const side of ["top", "right", "bottom", "left"]) if (!stripMarkup.includes(`data-strip-side="${side}"`)) throw new Error(`Decorative1 omitted its ${side} physical side.`);
  if ((stripMarkup.match(/class="key /g) || []).length !== 64) throw new Error("Decorative1 perimeter must surround the live 64-key preview.");
  const stripMultiMarkup = vm.runInContext(`(state.stripSelection = new Set([2, 3, 4, 5]), lightingPage())`, browser);
  if (!stripMultiMarkup.includes("4 light strip LEDs selected") || !stripMultiMarkup.includes("4 SELECTED")) throw new Error("Light-strip multi-selection is not reflected in its editor.");
  for (const selectionFeature of ["beginLightingSelection", "moveLightingSelection", "event.ctrlKey", "bindLightingSelection"])
    if (!app.includes(selectionFeature)) throw new Error(`Lighting selection omitted ${selectionFeature}.`);
  const changeSummary = vm.runInContext(`(state.dirty.lightingBase = true, state.profile.lighting.base.mode = 20, summarizeChanges())`, browser);
  if (!changeSummary.some((entry) => entry.includes("L21") && entry.includes("experimental"))) throw new Error("Apply review must identify experimental lighting changes.");
  vm.runInContext("clearDirty()", browser);
  if (app.includes("Workspace saved in this browser. Connect to write it to the keyboard.")) throw new Error("Disconnected Apply must not masquerade as an onboard save.");
  if (!app.includes("requestApplyChanges") || !app.includes("summarizeChanges")) throw new Error("Apply review-confirm-write workflow is missing.");
  const css = read("styles.css");
  if (!css.includes("calc((var(--unit) + var(--key-gap)) * var(--u) - var(--key-gap))")) throw new Error("Wide keys do not compensate for the grid gaps they span.");
  for (const layoutRule of ['grid-template-areas: ". top ." "left keyboard right" ". bottom ."', ".lighting-context-perKey .unified-lighting-preview [data-strip-led]", ".lighting-context-strip .unified-lighting-preview [data-key]"])
    if (!css.includes(layoutRule)) throw new Error(`Unified preview selection/layout scoping omitted ${layoutRule}.`);

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
  browser.injectedTransport = transport;
  vm.runInContext("state.transport = injectedTransport; state.profile.keycodes[2][0] = 0xbeef; state.dirty.mapping.add('2:0')", browser);
  const loadedLayerKeys = await vm.runInContext("readKeymapLayer(2)", browser);
  if (loadedLayerKeys !== 64) throw new Error(`Layer read loaded ${loadedLayerKeys} keys instead of 64.`);
  const layerReadback = vm.runInContext("[state.profile.keycodes[2][0], state.profile.keycodes[2][1], state.profile.keycodes[2][63], state.hardware.keycodes.get('2:63')]", browser);
  equal(layerReadback, [0xbeef, 0x1211, 0x1258, 0x1258], "Layer read must load every physical key while preserving staged edits.");
  const displayedReadback = vm.runInContext(`(() => {
    const key = keys[1], token = "2:" + key.id;
    state.profile.keycodes[2][key.id] = 0xbeef;
    const hardwareValue = displayedKeycode(key, 2);
    state.dirty.mapping.add(token);
    const stagedValue = displayedKeycode(key, 2);
    state.dirty.mapping.delete(token);
    return [hardwareValue, stagedValue];
  })()`, browser);
  equal(displayedReadback, [0x1211, 0xbeef], "The keyboard preview must show refreshed hardware values unless an edit is staged.");
  vm.runInContext("clearDirty()", browser);

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
