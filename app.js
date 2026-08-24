"use strict";

/* AE64 Pro Control — local-first UI for the reverse-engineered WebHID protocol. */
const {
  AE64HidTransport,
  DEVICE_FILTERS,
  SAVE_GROUP,
  MATRIX_ROWS,
  MATRIX_COLS,
  DECORATIVE_ROWS,
  DECORATIVE_COLS,
  LIGHTING_OPEN_MODE,
} = window.AE64Protocol;
const STORAGE_KEY = "ae64-control-workspace-v3";
const LANGUAGE_KEY = "ae64-control-language";

const layout = [
  [
    { n: "Esc" },
    { n: "1" },
    { n: "2" },
    { n: "3" },
    { n: "4" },
    { n: "5" },
    { n: "6" },
    { n: "7" },
    { n: "8" },
    { n: "9" },
    { n: "0" },
    { n: "-" },
    { n: "=" },
    { n: "Backspace", u: 2 },
  ],
  [
    { n: "Tab", u: 1.5 },
    { n: "Q" },
    { n: "W" },
    { n: "E" },
    { n: "R" },
    { n: "T" },
    { n: "Y" },
    { n: "U" },
    { n: "I" },
    { n: "O" },
    { n: "P" },
    { n: "[" },
    { n: "]" },
    { n: "\\", u: 1.5 },
  ],
  [
    { n: "Caps", u: 1.75 },
    { n: "A" },
    { n: "S" },
    { n: "D" },
    { n: "F" },
    { n: "G" },
    { n: "H" },
    { n: "J" },
    { n: "K" },
    { n: "L" },
    { n: ";" },
    { n: "'" },
    { n: "Enter", u: 2.25 },
  ],
  [
    { n: "Shift", u: 2 },
    { n: "Z" },
    { n: "X" },
    { n: "C" },
    { n: "V" },
    { n: "B" },
    { n: "N" },
    { n: "M" },
    { n: "," },
    { n: "." },
    { n: "/" },
    { n: "Shift" },
    { n: "↑" },
    { n: "Del" },
  ],
  [
    { n: "Ctrl", u: 1.25 },
    { n: "Win", u: 1.25 },
    { n: "Alt", u: 1.25 },
    { n: "Space", u: 6.25 },
    { n: "Alt" },
    { n: "Fn" },
    { n: "←" },
    { n: "↓" },
    { n: "→" },
  ],
];

// The five physical rows are addressed as 1–5 by the AE64 firmware.
const keys = layout
  .flatMap((row, uiRow) =>
    row.map((key, col) => ({
      ...key,
      u: key.u || 1,
      uiRow,
      row: uiRow + 1,
      col,
    })),
  )
  .map((key, id) => ({ ...key, id }));
const KEYCODE_GROUPS = {
  keyboard: [
    ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"
      .split("")
      .map((label, index) => ({ label, code: 4 + index })),
    ..."1234567890"
      .split("")
      .map((label, index) => ({ label, code: 30 + index })),
    ["Enter", 40],
    ["Escape", 41],
    ["Backspace", 42],
    ["Tab", 43],
    ["Space", 44],
    ["-", 45],
    ["=", 46],
    ["[", 47],
    ["]", 48],
    ["\\", 49],
    [";", 51],
    ["'", 52],
    [",", 54],
    [".", 55],
    ["/", 56],
    ["Caps Lock", 57],
    ...Array.from({ length: 12 }, (_, index) => [`F${index + 1}`, 58 + index]),
    ["Print Screen", 70],
    ["Scroll Lock", 71],
    ["Pause", 72],
    ["Insert", 73],
    ["Home", 74],
    ["Page Up", 75],
    ["Delete", 76],
    ["End", 77],
    ["Page Down", 78],
    ["Right Arrow", 79],
    ["Left Arrow", 80],
    ["Down Arrow", 81],
    ["Up Arrow", 82],
    ["Left Ctrl", 224],
    ["Left Shift", 225],
    ["Left Alt", 226],
    ["Left Win", 227],
    ["Right Ctrl", 228],
    ["Right Shift", 229],
    ["Right Alt", 230],
    ["Right Win", 231],
    ["Unassigned", 0],
  ].map((item) =>
    Array.isArray(item) ? { label: item[0], code: item[1] } : item,
  ),
  media: [
    ["Play / Pause", 0x00cd],
    ["Next Track", 0x00b5],
    ["Previous Track", 0x00b6],
    ["Stop", 0x00b7],
    ["Mute", 0x00e2],
    ["Volume Up", 0x00e9],
    ["Volume Down", 0x00ea],
    ["Calculator", 0x0192],
    ["Browser Home", 0x0223],
    ["Browser Back", 0x0224],
    ["Browser Forward", 0x0225],
  ].map(([label, code]) => ({ label, code })),
  mouse: [
    ["Mouse Left", 0x0101],
    ["Mouse Right", 0x0102],
    ["Mouse Middle", 0x0104],
    ["Mouse Forward", 0x0108],
    ["Mouse Back", 0x0110],
  ].map(([label, code]) => ({ label, code })),
  firmware: [
    ["Fn layer 1", 0xf001],
    ["Fn layer 2", 0xf002],
    ["Fn layer 3", 0xf003],
    ["Lighting toggle", 0xf010],
    ["Lighting mode +", 0xf011],
    ["Brightness +", 0xf012],
    ["Brightness -", 0xf013],
  ].map(([label, code]) => ({ label, code })),
};
const KEYCODES = Object.values(KEYCODE_GROUPS).flat();
const KEYCODE_LABELS = new Map(
  KEYCODES.map((entry) => [entry.code, entry.label]),
);
// Captured manufacturer enum values. These are protocol values, not array indexes.
const SYSTEM_MODE_OPTIONS = Object.freeze([
  { value: 0, label: "Windows" },
  { value: 1, label: "macOS" },
]);
const POLLING_RATE_OPTIONS = Object.freeze([
  { value: 5, hz: 250 },
  { value: 4, hz: 500 },
  { value: 3, hz: 1000 },
  { value: 2, hz: 2000 },
  { value: 1, hz: 4000 },
  { value: 0, hz: 8000 },
]);
// The generic manufacturer catalog has 23 indexes. This AE64 reports 20 for
// area 0; values 20–22 are exposed as unadvertised experiments with read-back
// verification. Decorative1 continues to follow its reported count of five.
const LIGHTING_MODE_OPTIONS = Object.freeze(
  Array.from({ length: 23 }, (_, value) =>
    Object.freeze({ value, label: `L${value + 1}` }),
  ),
);
const AE64_MAIN_MODE_COUNT = 20;
const AE64_DECORATIVE_MODE_COUNT = 5;
const LIVE_RGB_INTERVAL = 100;

// Visual order follows the keyboard case. The protocol index still travels
// clockwise: top 27…37,0,1; right 2…6; bottom 7…20; left 21…26.
const DECORATIVE_LAYOUT = Object.freeze({
  top: Object.freeze([27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 0, 1]),
  right: Object.freeze([2, 3, 4, 5, 6]),
  bottom: Object.freeze([20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7]),
  left: Object.freeze([26, 25, 24, 23, 22, 21]),
});

const FALLBACK_TRANSLATIONS = {
  en: {
    languageName: "English",
    brandTagline: "Independent WebHID driver",
    navFeatures: "Features",
    navProtocol: "Protocol",
    language: "Language",
    openDemo: "Open demo",
    connectKeyboard: "Connect keyboard",
    heroEyebrow: "LOCAL-FIRST · NO CHINA ROUND TRIP",
    heroLine1: "Your AE64.",
    heroLine2: "Fully visible.",
    heroLead:
      "Configure actuation, Rapid Trigger, remaps, RGB, profiles and the keyboard's hidden diagnostic controls directly through WebHID.",
    exploreOffline: "Explore offline",
    compatibility:
      "Desktop Chrome or Edge · HTTPS or localhost · no account required",
    ready: "READY",
    deviceId: "Device ID",
    reportSize: "Report size",
    collection: "Collection",
    featurePerformanceTitle: "Hall performance",
    featurePerformanceBody:
      "Per-key actuation, RT, independent press/release values and both dead zones.",
    featureKeymapTitle: "Four key layers",
    featureKeymapBody:
      "Keyboard, media, mouse, lighting and internal firmware functions.",
    featureHiddenTitle: "Feature Lab",
    featureHiddenBody:
      "Calibration, raw travel, magnetic-axis metadata and advanced-key inspection stay visible.",
    protocolEyebrow: "CAPTURE-DERIVED, DEVICE-LOCAL",
    protocolTitle: "The keyboard is the source of truth.",
    protocolBody:
      "The driver reads the current hardware record before editing, preserves firmware-owned fields, writes only staged changes, commits the correct parameter group, and reads important values back. Firmware flashing is intentionally excluded.",
    offlineWorkspace: "Offline workspace",
    overview: "Overview",
    performance: "Performance",
    keymap: "Key mapping",
    lighting: "Lighting",
    settings: "Device settings",
    featureLab: "Feature Lab",
    diagnostics: "Diagnostics",
    stagedEdits: "Staged edits",
    stagedEditsBody: "Nothing reaches the keyboard until Apply.",
    profile: "Profile",
    layer: "Layer",
    home: "Home",
    connect: "Connect",
    revert: "Revert",
    applyChanges: "Apply changes",
    offline: "Offline",
    noPendingChanges: "No pending changes",
  },
  vi: {
    languageName: "Tiếng Việt",
    brandTagline: "Trình điều khiển WebHID độc lập",
    navFeatures: "Tính năng",
    navProtocol: "Giao thức",
    language: "Ngôn ngữ",
    openDemo: "Mở bản thử",
    connectKeyboard: "Kết nối bàn phím",
    heroEyebrow: "CỤC BỘ TRƯỚC · KHÔNG CHỜ MÁY CHỦ TRUNG QUỐC",
    heroLine1: "AE64 của bạn.",
    heroLine2: "Hiển thị đầy đủ.",
    heroLead:
      "Thiết lập hành trình, Rapid Trigger, ánh xạ phím, RGB, hồ sơ và các điều khiển chẩn đoán ẩn qua WebHID.",
    exploreOffline: "Khám phá ngoại tuyến",
    compatibility:
      "Chrome hoặc Edge máy tính · HTTPS hoặc localhost · không cần tài khoản",
    ready: "SẴN SÀNG",
    deviceId: "Mã thiết bị",
    reportSize: "Kích thước báo cáo",
    collection: "Collection",
    featurePerformanceTitle: "Hiệu năng Hall",
    featurePerformanceBody:
      "Điểm nhận phím, RT, nhấn/nhả và vùng chết riêng cho từng phím.",
    featureKeymapTitle: "Bốn lớp phím",
    featureKeymapBody:
      "Bàn phím, media, chuột, đèn và chức năng firmware nội bộ.",
    featureHiddenTitle: "Phòng thí nghiệm",
    featureHiddenBody:
      "Luôn hiển thị cân chỉnh, hành trình thô, dữ liệu trục từ và chế độ phím nâng cao.",
    protocolEyebrow: "TỪ BẢN GHI GÓI TIN · CHẠY CỤC BỘ",
    protocolTitle: "Bàn phím là nguồn dữ liệu chuẩn.",
    protocolBody:
      "Trình điều khiển đọc dữ liệu hiện tại trước khi sửa, giữ nguyên trường do firmware quản lý, chỉ ghi thay đổi đã xếp hàng, lưu đúng nhóm tham số và đọc lại giá trị quan trọng. Cập nhật firmware bị loại trừ có chủ ý.",
    offlineWorkspace: "Không gian ngoại tuyến",
    overview: "Tổng quan",
    performance: "Hiệu năng",
    keymap: "Ánh xạ phím",
    lighting: "Ánh sáng",
    settings: "Cài đặt thiết bị",
    featureLab: "Phòng thí nghiệm",
    diagnostics: "Chẩn đoán",
    stagedEdits: "Thay đổi tạm",
    stagedEditsBody: "Không có gì được ghi cho đến khi nhấn Áp dụng.",
    profile: "Hồ sơ",
    layer: "Lớp",
    home: "Trang đầu",
    connect: "Kết nối",
    revert: "Hoàn tác",
    applyChanges: "Áp dụng",
    offline: "Ngoại tuyến",
    noPendingChanges: "Không có thay đổi chờ",
  },
};
Object.assign(FALLBACK_TRANSLATIONS.en, {
  lightingDescription:
    "Keyboard effects, a unified live preview, per-key overrides, and the light strip.",
  lightingMainKeyboard: "Keyboard",
  lightingPerKey: "Per-key",
  lightingDecorative: "Light strip",
  lightingPower: "Lighting power",
  lightingMode: "Lighting mode",
  lightingModeHint: "The firmware reports indexes rather than effect names.",
  lightingBrightness: "Brightness",
  lightingSpeed: "Speed",
  lightingDirection: "Direction",
  lightingForward: "Forward",
  lightingBackward: "Backward",
  lightingPalette: "Eight-color palette",
  lightingPaletteHint: "Choose the active slot, then edit its stored color.",
  lightingActiveColor: "Active color",
  lightingCustomOverride: "Custom override",
  lightingReadMatrix: "Read custom matrix",
  lightingCopyAll: "Copy color to all keys",
  lightingClearKey: "Clear selected override",
  lightingClearAll: "Clear all overrides",
  lightingUpper: "North-facing LEDs",
  lightingLower: "South-facing LEDs",
  lightingLive: "Live hardware RGB",
  lightingLiveHint:
    "Reads the current LED framebuffer about ten times per second.",
  lightingLed: "Strip LED",
  lightingCopyStrip: "Copy color to all strip LEDs",
  lightingClearStrip: "Clear all strip overrides",
});
Object.assign(FALLBACK_TRANSLATIONS.vi, {
  lightingDescription:
    "Hiệu ứng bàn phím, bản xem trực tiếp hợp nhất, màu từng phím và dải đèn.",
  lightingMainKeyboard: "Bàn phím",
  lightingPerKey: "Từng phím",
  lightingDecorative: "Dải đèn",
  lightingPower: "Bật đèn",
  lightingMode: "Chế độ đèn",
  lightingModeHint: "Firmware trả về chỉ số thay vì tên hiệu ứng.",
  lightingBrightness: "Độ sáng",
  lightingSpeed: "Tốc độ",
  lightingDirection: "Hướng",
  lightingForward: "Thuận",
  lightingBackward: "Ngược",
  lightingPalette: "Bảng tám màu",
  lightingPaletteHint: "Chọn ô màu đang dùng rồi chỉnh màu đã lưu.",
  lightingActiveColor: "Màu đang dùng",
  lightingCustomOverride: "Ghi đè màu riêng",
  lightingReadMatrix: "Đọc ma trận màu",
  lightingCopyAll: "Chép màu cho mọi phím",
  lightingClearKey: "Xóa màu riêng của phím",
  lightingClearAll: "Xóa mọi màu riêng",
  lightingUpper: "LED hướng Bắc",
  lightingLower: "LED hướng Nam",
  lightingLive: "RGB phần cứng trực tiếp",
  lightingLiveHint: "Đọc khung màu LED hiện tại khoảng mười lần mỗi giây.",
  lightingLed: "LED dải",
  lightingCopyStrip: "Chép màu cho toàn bộ LED dải",
  lightingClearStrip: "Xóa mọi màu riêng của dải",
});
Object.assign(FALLBACK_TRANSLATIONS.en, {
  quickProfile: "Quick profile",
  rename: "Rename",
  writeToKeyboard: "WRITE TO KEYBOARD",
  applyReviewTitle: "Review changes",
  applyReviewWarning:
    "These changes will be written to the active onboard profile immediately.",
  cancel: "Cancel",
  writeNow: "Write now",
  renameProfile: "Rename profile",
  renameProfileHint:
    "The new name is written directly to the active onboard profile.",
  profileName: "Profile name",
  saveName: "Save name",
  stagedEditsBody:
    "Apply reviews the staged changes, then writes them directly to the keyboard.",
});
Object.assign(FALLBACK_TRANSLATIONS.vi, {
  quickProfile: "Chuyển hồ sơ nhanh",
  rename: "Đổi tên",
  writeToKeyboard: "GHI VÀO BÀN PHÍM",
  applyReviewTitle: "Xem lại thay đổi",
  applyReviewWarning:
    "Các thay đổi này sẽ được ghi ngay vào hồ sơ đang hoạt động trên bàn phím.",
  cancel: "Hủy",
  writeNow: "Ghi ngay",
  renameProfile: "Đổi tên hồ sơ",
  renameProfileHint:
    "Tên mới được ghi trực tiếp vào hồ sơ đang hoạt động trên bàn phím.",
  profileName: "Tên hồ sơ",
  saveName: "Lưu tên",
  stagedEditsBody:
    "Nút Áp dụng cho xem lại thay đổi rồi ghi trực tiếp vào bàn phím.",
});

const defaultPerformance = () => ({
  mode: 0,
  normalPress: 2,
  normalRelease: 0,
  rtFirstTouch: 2,
  rtPress: 0.15,
  rtRelease: 0.15,
  pressDeadStroke: 0.1,
  releaseDeadStroke: 0.1,
  axis: 0,
  calibrate: 0,
  axisV2Id: 0,
  axisRangeMax: 0,
  axisCoefficient: 0,
});
function defaultKeycode(key) {
  const aliases = {
    Esc: 41,
    Backspace: 42,
    Tab: 43,
    Caps: 57,
    Enter: 40,
    Del: 76,
    "←": 80,
    "↓": 81,
    "↑": 82,
    "→": 79,
    Space: 44,
  };
  if (key.uiRow === 3 && key.col === 0) return 225;
  if (key.uiRow === 3 && key.col === 11) return 229;
  if (key.uiRow === 4 && key.col === 0) return 224;
  if (key.uiRow === 4 && key.col === 1) return 227;
  if (key.uiRow === 4 && key.col === 2) return 226;
  if (key.uiRow === 4 && key.col === 4) return 230;
  if (key.n === "Fn") return 0xf001;
  return (
    aliases[key.n] ?? KEYCODES.find((entry) => entry.label === key.n)?.code ?? 0
  );
}
const defaultPalette = () => [
  "#73f0c0",
  "#70a5ff",
  "#d17cff",
  "#ff7894",
  "#ffc36d",
  "#ffffff",
  "#33bdd0",
  "#587482",
];
const defaultProfile = () => ({
  schema: 4,
  selected: 15,
  layer: 0,
  profileIndex: 0,
  performance: Object.fromEntries(
    keys.map((key) => [key.id, defaultPerformance()]),
  ),
  keycodes: Object.fromEntries(
    Array.from({ length: 4 }, (_, layerIndex) => [
      layerIndex,
      Object.fromEntries(keys.map((key) => [key.id, defaultKeycode(key)])),
    ]),
  ),
  lighting: {
    base: {
      open: true,
      openMode: LIGHTING_OPEN_MODE.BOTH,
      mode: 1,
      brightness: 80,
      speed: 50,
      direction: 0,
      paletteIndex: 0,
    },
    palette: defaultPalette(),
    perKey: Object.fromEntries(keys.map((key) => [key.id, "#73f0c0"])),
    customEnabled: Object.fromEntries(keys.map((key) => [key.id, false])),
    decorative: {
      base: {
        open: true,
        openMode: LIGHTING_OPEN_MODE.LOWER,
        mode: 0,
        brightness: 80,
        speed: 50,
        direction: 0,
        paletteIndex: 0,
      },
      palette: defaultPalette(),
      perLed: Array.from({ length: DECORATIVE_COLS }, () => "#73f0c0"),
      customEnabled: Array.from({ length: DECORATIVE_COLS }, () => false),
    },
  },
  settings: { systemMode: 0, reportRate: 0, sleepTime: 10, shake: false },
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}
function closeEnough(a, b) {
  return Math.abs(Number(a) - Number(b)) <= 0.0011;
}
function hexToRgb(hex) {
  const value = String(hex).replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
    custom: true,
  };
}
function rgbToHex(color) {
  return `#${[color.r, color.g, color.b]
    .map((value) =>
      Number(value || 0)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
function normalizeHex(value) {
  const hex = String(value || "")
    .trim()
    .replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : null;
}
function selectedKey() {
  return (
    keys.find((key) => key.id === Number(state.profile.selected)) || keys[0]
  );
}
function position(key = selectedKey()) {
  return { row: key.row, col: key.col };
}
function mergeDecorative(base, saved = {}) {
  return {
    ...base,
    ...saved,
    base: { ...base.base, ...saved.base },
    palette: Array.from(
      { length: 8 },
      (_, index) => saved.palette?.[index] || base.palette[index],
    ),
    perLed: Array.from(
      { length: DECORATIVE_COLS },
      (_, index) => saved.perLed?.[index] || base.perLed[index],
    ),
    customEnabled: Array.from({ length: DECORATIVE_COLS }, (_, index) =>
      Boolean(saved.customEnabled?.[index]),
    ),
  };
}
function loadSavedProfile() {
  const base = defaultProfile();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || ![3, 4].includes(saved.schema)) return base;
    return {
      ...base,
      ...saved,
      schema: 4,
      performance: { ...base.performance, ...saved.performance },
      keycodes: Object.fromEntries(
        Array.from({ length: 4 }, (_, i) => [
          i,
          { ...base.keycodes[i], ...saved.keycodes?.[i] },
        ]),
      ),
      lighting: {
        ...base.lighting,
        ...saved.lighting,
        base: { ...base.lighting.base, ...saved.lighting?.base },
        perKey: { ...base.lighting.perKey, ...saved.lighting?.perKey },
        customEnabled: {
          ...base.lighting.customEnabled,
          ...saved.lighting?.customEnabled,
        },
        decorative: mergeDecorative(
          base.lighting.decorative,
          saved.lighting?.decorative,
        ),
      },
      settings: { ...base.settings, ...saved.settings },
    };
  } catch {
    return base;
  }
}

const state = {
  page: "overview",
  performanceTab: "trigger",
  lightingTab: "main",
  stripSelected: 0,
  lightingSelectedKeys: new Set(),
  stripSelection: new Set([0]),
  selectionDrag: null,
  liveLighting: true,
  mappingGroup: "keyboard",
  mappingSearch: "",
  profile: loadSavedProfile(),
  original: null,
  transport: null,
  knownDevice: null,
  translations: clone(FALLBACK_TRANSLATIONS),
  language: localStorage.getItem(LANGUAGE_KEY) || "en",
  hardware: {
    info: null,
    feature: null,
    protocol: null,
    precision: 0.001,
    configIndexes: [0, 1, 2, 3],
    configNames: ["Profile 1", "Profile 2", "Profile 3", "Profile 4"],
    systemModes: [],
    reportRates: [],
    axisLibrary: [],
    lightingAreas: [],
    doubleLighting: false,
    customMatrix: null,
    decorativeMatrix: null,
    liveMatrix: null,
    liveStrip: null,
    liveUpdatedAt: 0,
    advanced: null,
    macroSpace: null,
    layoutStyle: null,
    travelValue: 0,
    performance: new Map(),
    keycodes: new Map(),
    logs: [],
  },
  dirty: {
    performance: new Set(),
    mapping: new Set(),
    lightingBase: false,
    lightingPalette: false,
    customLighting: new Set(),
    decorativeBase: false,
    decorativePalette: false,
    decorativeLighting: new Set(),
    settings: new Set(),
  },
  timers: {
    travel: null,
    lighting: null,
    lightingGeneration: 0,
    calibration: null,
  },
  toastTimer: null,
};
state.lightingSelectedKeys.add(Number(state.profile.selected));
state.original = clone(state.profile);
const t = (key) =>
  state.translations[state.language]?.[key] ||
  state.translations.en?.[key] ||
  key;
const connected = () => Boolean(state.transport?.connected);
const isAe64Device = (device) =>
  DEVICE_FILTERS.some(
    (filter) =>
      device?.vendorId === filter.vendorId &&
      device?.productId === filter.productId &&
      device.collections?.some(
        (collection) =>
          collection.usagePage === filter.usagePage &&
          collection.usage === filter.usage,
      ),
  );
const dirtyCount = () =>
  state.dirty.performance.size +
  state.dirty.mapping.size +
  state.dirty.customLighting.size +
  state.dirty.decorativeLighting.size +
  Number(state.dirty.lightingBase) +
  Number(state.dirty.lightingPalette) +
  Number(state.dirty.decorativeBase) +
  Number(state.dirty.decorativePalette) +
  state.dirty.settings.size;
const lightingKeyIds = () =>
  [...state.lightingSelectedKeys]
    .filter((id) => keys[id])
    .sort((a, b) => a - b);
const stripLedIds = () =>
  [...state.stripSelection]
    .filter((index) => index >= 0 && index < DECORATIVE_COLS)
    .sort((a, b) => a - b);
function lightingAnchorKey() {
  return (
    keys.find((key) => key.id === Number(state.profile.selected)) ||
    keys[lightingKeyIds().at(-1)] ||
    keys[0]
  );
}
function log(message, details) {
  state.hardware.logs.unshift({
    time: new Date().toISOString(),
    message,
    ...(details === undefined ? {} : { details }),
  });
  state.hardware.logs = state.hardware.logs.slice(0, 80);
}

async function loadLanguages() {
  try {
    const response = await fetch("languages.xml", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = new DOMParser().parseFromString(
      await response.text(),
      "application/xml",
    );
    if (xml.querySelector("parsererror")) throw new Error("Invalid XML");
    xml.querySelectorAll("language").forEach((language) => {
      const code = language.getAttribute("code");
      if (!code) return;
      state.translations[code] = {
        ...(state.translations[code] || {}),
        languageName: language.getAttribute("name") || code,
      };
      language.querySelectorAll("string").forEach((node) => {
        state.translations[code][node.getAttribute("key")] = node.textContent;
      });
    });
  } catch (error) {
    log("Language XML unavailable; embedded translations used", error.message);
  }
  if (!state.translations[state.language]) state.language = "en";
  populateLanguageSelectors();
  translateStaticPage();
}
function populateLanguageSelectors() {
  const html = Object.entries(state.translations)
    .map(
      ([code, strings]) =>
        `<option value="${esc(code)}" ${code === state.language ? "selected" : ""}>${esc(strings.languageName || code)}</option>`,
    )
    .join("");
  document.querySelectorAll(".language-select").forEach((select) => {
    select.innerHTML = html;
  });
}
function translateStaticPage() {
  document.documentElement.lang = state.language;
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
}
function setLanguage(language) {
  if (!state.translations[language]) return;
  state.language = language;
  localStorage.setItem(LANGUAGE_KEY, language);
  populateLanguageSelectors();
  translateStaticPage();
  if (!document.querySelector("#workspace").classList.contains("hidden"))
    render();
}

function keyboardHtml({ hero = false, lighting = false } = {}) {
  const layer = Number(state.profile.layer),
    light = state.profile.lighting,
    baseColor =
      light.palette[Number(light.base.paletteIndex)] ||
      light.palette[0] ||
      "#000000",
    live =
      lighting &&
      state.liveLighting &&
      connected() &&
      Array.isArray(state.hardware.liveMatrix);
  return `<div class="keyboard" aria-label="AE64 Pro keyboard">${layout
    .map(
      (row, uiRow) =>
        `<div class="keyboard-row">${row
          .map((_, col) => {
            const key = keys.find(
              (candidate) => candidate.uiRow === uiRow && candidate.col === col,
            );
            const code = state.profile.keycodes[layer][key.id];
            const mapped =
              KEYCODE_LABELS.get(code) ||
              `0x${Number(code).toString(16).padStart(4, "0")}`;
            const custom = Boolean(light.customEnabled?.[key.id]),
              liveColor = live
                ? state.hardware.liveMatrix[key.row * MATRIX_COLS + key.col]
                : null,
              previewColor = liveColor
                ? rgbToHex(liveColor)
                : lighting
                  ? custom
                    ? light.perKey[key.id]
                    : baseColor
                  : light.perKey[key.id],
              lightingSelected =
                lighting &&
                state.page === "lighting" &&
                state.lightingTab === "perKey" &&
                state.lightingSelectedKeys.has(key.id),
              selected =
                !hero &&
                (lighting ? lightingSelected : key.id === selectedKey().id);
            const dirty =
              state.dirty.performance.has(key.id) ||
              [...state.dirty.mapping].some((token) =>
                token.endsWith(`:${key.id}`),
              ) ||
              state.dirty.customLighting.has(key.id);
            return `<button class="key ${selected ? "selected" : ""} ${dirty ? "dirty" : ""} ${lighting && custom ? "custom-light" : ""}" style="--u:${key.u};--key-color:${esc(previewColor)}" type="button" ${hero ? 'tabindex="-1"' : `data-key="${key.id}" aria-pressed="${lightingSelected}"`}><b>${esc(key.n)}</b>${hero ? "" : `<span class="mapped">${esc(mapped)}</span>`}${lighting ? `<i class="color-dot ${custom ? "custom" : ""}" title="${live ? "Live hardware color" : custom ? "Custom override" : "Main palette"}"></i>` : ""}</button>`;
          })
          .join("")}</div>`,
    )
    .join("")}</div>`;
}
function boardPanel(options = {}) {
  return `<section class="panel ${options.full ? "full-span" : ""}"><div class="panel-head"><div><h2>${options.title || "AE64 Pro"}</h2><p>${options.description || "Select a key to inspect or stage a change."}</p></div><span class="badge ${connected() ? "ready" : ""}">${connected() ? "HARDWARE" : "OFFLINE"}</span></div><div class="keyboard-wrap ${options.lighting ? "lighting-preview" : ""}">${keyboardHtml({ lighting: options.lighting })}</div><div class="board-footer"><span>Layer ${Number(state.profile.layer) + 1}</span><span>Selected: <b class="selected-name">${esc(selectedKey().n)}</b> · row ${selectedKey().row}, col ${selectedKey().col}</span></div></section>`;
}
function selectedCard() {
  const key = selectedKey(),
    performance = state.profile.performance[key.id],
    code = state.profile.keycodes[state.profile.layer][key.id];
  return `<div class="selected-key-card"><b>${esc(key.n)}</b><div><span>SELECTED KEY · ${key.row}:${key.col}</span><strong>${esc(KEYCODE_LABELS.get(code) || `Keycode 0x${Number(code).toString(16)}`)} · ${performance.normalPress.toFixed(2)} mm${performance.mode ? " · RT on" : ""}</strong></div></div>`;
}
function pageCopy() {
  return {
    overview: [
      t("overview"),
      "Device state, current profile, and selected-key summary.",
    ],
    performance: [
      t("performance"),
      "Per-key Hall actuation, Rapid Trigger, dead zones, calibration, and raw travel.",
    ],
    keymap: [t("keymap"), "Stage assignments across all four firmware layers."],
    lighting: [t("lighting"), t("lightingDescription")],
    settings: [
      t("settings"),
      "Profiles, USB behavior, polling rate, sleep, and stabilization.",
    ],
    advanced: [
      t("featureLab"),
      "All advanced key modes remain visible, with safe read-only inspection in this basic release.",
    ],
    diagnostics: [
      t("diagnostics"),
      "Feature bitmap, device metadata, protocol surface, and session log.",
    ],
  }[state.page];
}

function overviewPage() {
  const perf = state.profile.performance[selectedKey().id],
    info = state.hardware.info,
    rtCount = Object.values(state.profile.performance).filter(
      (item) => item.mode === 1,
    ).length;
  return `<div class="page-grid"><section class="panel full-span"><div class="summary-grid"><article class="summary-card"><span>Connection</span><strong>${connected() ? "Connected" : "Offline"}</strong><small>${connected() ? `${esc(info?.serial || "AE64 Pro")} · FW ${esc(info?.firmware || "?")}` : "Demo data; no writes possible"}</small></article><article class="summary-card"><span>Current profile</span><strong>${esc(state.hardware.configNames[state.profile.profileIndex] || `Profile ${state.profile.profileIndex + 1}`)}</strong><small>Hardware configuration ${state.profile.profileIndex + 1}</small></article><article class="summary-card"><span>Rapid Trigger</span><strong>${rtCount} keys</strong><small>Selected: ${perf.mode ? "enabled" : "normal"}</small></article><article class="summary-card"><span>Pending changes</span><strong>${dirtyCount()}</strong><small>Written only when you apply</small></article></div></section>${boardPanel()}<section class="panel"><div class="panel-head"><div><h2>Selected key</h2><p>The current working copy for this key.</p></div></div>${selectedCard()}<ul class="fact-list"><li><span>Actuation</span><strong>${perf.normalPress.toFixed(2)} mm</strong></li><li><span>Rapid Trigger</span><strong>${perf.mode ? `${perf.rtPress.toFixed(2)} / ${perf.rtRelease.toFixed(2)} mm` : "Off"}</strong></li><li><span>Dead zones</span><strong>${perf.pressDeadStroke.toFixed(2)} / ${perf.releaseDeadStroke.toFixed(2)} mm</strong></li><li><span>Hardware address</span><strong>${selectedKey().row}:${selectedKey().col}</strong></li></ul><div class="apply-row"><button class="button primary" data-goto="performance" type="button">Tune this key</button></div></section></div>`;
}
function numberField(id, label, value, min, max, step, hint = "") {
  return `<label class="field"><span>${label}</span><div class="range-pair"><input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-range-for="${id}"><input id="${id}" type="number" min="${min}" max="${max}" step="${step}" value="${value}"></div>${hint ? `<small>${hint}</small>` : ""}</label>`;
}
function performanceControls() {
  const value = state.profile.performance[selectedKey().id];
  if (state.performanceTab === "trigger")
    return `${selectedCard()}<div class="switch-row"><div><h3>Rapid Trigger</h3><p>Reset as soon as the key reverses direction.</p></div><input id="performanceMode" class="toggle" type="checkbox" ${value.mode === 1 ? "checked" : ""}></div><div class="form-grid">${numberField("normalPress", "Normal press", value.normalPress, 0.1, 4, 0.01, "Used when Rapid Trigger is off.")}${numberField("normalRelease", "Normal release", value.normalRelease, 0, 4, 0.01, "Independent release point.")}${numberField("rtFirstTouch", "RT first touch", value.rtFirstTouch, 0.1, 4, 0.01)}${numberField("rtPress", "RT press delta", value.rtPress, 0.01, 2, 0.01)}${numberField("rtRelease", "RT release delta", value.rtRelease, 0.01, 2, 0.01)}</div><div class="apply-row"><button class="button ghost" data-copy-performance type="button">Copy to every key</button></div>`;
  if (state.performanceTab === "deadzone")
    return `${selectedCard()}<div class="form-grid">${numberField("pressDeadStroke", "Top dead zone", value.pressDeadStroke, 0, 1, 0.01, "Ignored movement near the top.")}${numberField("releaseDeadStroke", "Bottom dead zone", value.releaseDeadStroke, 0, 1, 0.01, "Ignored movement near full travel.")}</div>`;
  if (state.performanceTab === "axis")
    return `${selectedCard()}<ul class="fact-list"><li><span>Axis slot</span><strong>${value.axis}</strong></li><li><span>Axis library ID</span><strong>${value.axisV2Id || "Not reported"}</strong></li><li><span>Maximum range</span><strong>${value.axisRangeMax || "Not reported"}</strong></li><li><span>Coefficient</span><strong>${value.axisCoefficient || "Not reported"}</strong></li><li><span>Available IDs</span><strong>${state.hardware.axisLibrary.length ? state.hardware.axisLibrary.join(", ") : "Connect to read"}</strong></li></ul><p>The basic release preserves these firmware-owned fields during every performance write.</p>`;
  if (state.performanceTab === "calibration")
    return `<div class="panel-head"><div><h2>Hall sensor calibration</h2><p>Start calibration, press every key fully several times, then stop and save.</p></div><span class="badge experimental">DEVICE-WIDE</span></div><div class="calibration-grid">${keys.map(() => "<i></i>").join("")}</div><div class="apply-row"><button class="button ghost" id="stopCalibration" type="button">Stop</button><button class="button primary" id="startCalibration" type="button">Start calibration</button></div>`;
  const raw = state.hardware.travelValue || 0,
    mm = Math.min(4, raw / 1000);
  return `${selectedCard()}<div class="travel-meter" style="--travel:${Math.round((mm / 4) * 100)}%;--actuation:${Math.round((1 - value.normalPress / 4) * 100)}%"><div class="fill"></div><div class="line"></div><div class="value">${mm.toFixed(3)} mm</div></div><p>Raw route values are read from the selected physical row.</p><div class="apply-row"><button class="button ghost" id="stopTravel" type="button">Stop</button><button class="button primary" id="startTravel" type="button">Start live reading</button></div>`;
}
function performancePage() {
  const tabs = [
    ["trigger", "Actuation & RT"],
    ["deadzone", "Dead zones"],
    ["axis", "Switch axis"],
    ["calibration", "Calibration"],
    ["travel", "Travel test"],
  ];
  return `<div class="page-grid">${boardPanel()}<section class="panel"><div class="tab-bar">${tabs.map(([id, label]) => `<button type="button" data-performance-tab="${id}" class="${state.performanceTab === id ? "active" : ""}">${label}</button>`).join("")}</div>${performanceControls()}</section></div>`;
}
function keymapPage() {
  const active = state.profile.keycodes[state.profile.layer][selectedKey().id],
    entries = KEYCODE_GROUPS[state.mappingGroup].filter((entry) =>
      entry.label.toLowerCase().includes(state.mappingSearch.toLowerCase()),
    );
  return `<div class="page-grid">${boardPanel()}<section class="panel"><div class="panel-head"><div><h2>Assign ${esc(selectedKey().n)}</h2><p>Writes a 16-bit keycode on layer ${Number(state.profile.layer) + 1}.</p></div><span class="badge ready">4 LAYERS</span></div>${selectedCard()}<div class="mapping-browser"><input class="search-input" id="mappingSearch" type="search" placeholder="Search functions" value="${esc(state.mappingSearch)}"><div class="mapping-groups">${Object.keys(
    KEYCODE_GROUPS,
  )
    .map(
      (group) =>
        `<button type="button" data-mapping-group="${group}" class="${group === state.mappingGroup ? "active" : ""}">${group}</button>`,
    )
    .join(
      "",
    )}</div><div class="mapping-list">${entries.map((entry) => `<button type="button" data-keycode="${entry.code}" class="${entry.code === active ? "active" : ""}">${esc(entry.label)}</button>`).join("")}</div></div><div class="apply-row"><button class="button ghost" id="resetKeycode" type="button">Default for this key</button></div></section></div>`;
}

function lightingArea(index) {
  return (
    state.hardware.lightingAreas.find(
      (area) => Number(area.index) === Number(index),
    ) || null
  );
}
function mainLightingArea() {
  return lightingArea(0) || state.hardware.lightingAreas[0] || null;
}
function decorativeLightingArea() {
  return lightingArea(1) || null;
}
function lightingModeCount(index, fallback) {
  const count = Number(lightingArea(index)?.count);
  return Number.isInteger(count) && count > 0
    ? Math.min(count, LIGHTING_MODE_OPTIONS.length)
    : fallback;
}
function lightingRange(id, label, value, hint) {
  return `<label class="lighting-range" for="${id}"><span><b>${esc(label)}</b><output id="${id}Value">${Number(value)}</output></span><input id="${id}" type="range" min="0" max="100" step="1" value="${Number(value)}"><small>${esc(hint)}</small></label>`;
}
function lightingTabs() {
  return `<div class="lighting-tabs" role="tablist" aria-label="Lighting sections"><button type="button" role="tab" data-lighting-tab="main" aria-selected="${state.lightingTab === "main"}" class="${state.lightingTab === "main" ? "active" : ""}"><span>01</span>${t("lightingMainKeyboard")}</button><button type="button" role="tab" data-lighting-tab="perKey" aria-selected="${state.lightingTab === "perKey"}" class="${state.lightingTab === "perKey" ? "active" : ""}"><span>02</span>${t("lightingPerKey")}</button><button type="button" role="tab" data-lighting-tab="strip" aria-selected="${state.lightingTab === "strip"}" class="${state.lightingTab === "strip" ? "active" : ""}"><span>03</span>${t("lightingDecorative")}</button></div>`;
}
function lightingPowerPanel(base, title, description) {
  return `<section class="panel full-span area-power-panel"><div><h2>${esc(title)}</h2><p>${esc(description)}</p></div><label class="lighting-power"><span><b>${t("lightingPower")}</b><small>${base.open ? "On" : "Off"} · firmware value ${base.open ? base.openMode || 1 : 0}</small></span><input id="lightingOpen" class="toggle" type="checkbox" ${base.open ? "checked" : ""}></label></section>`;
}
function lightingModePanel(base, count, target, area, reportedCount = count) {
  const modes = LIGHTING_MODE_OPTIONS.slice(0, count);
  return `<section class="panel lighting-mode-panel"><div class="panel-head"><div><h2>${t("lightingMode")}</h2><p>${t("lightingModeHint")}</p></div><span class="badge ready">${count} MODES</span></div><div class="lighting-mode-grid">${modes
    .map((mode) => {
      const experimental = mode.value >= reportedCount;
      return `<button type="button" data-lighting-mode="${mode.value}" data-lighting-target="${target}" class="${mode.value === Number(base.mode) ? "active " : ""}${experimental ? "experimental" : ""}"><span>${mode.label}${experimental ? " *" : ""}</span><small>${experimental ? "UNADVERTISED" : "Area " + area} · value ${mode.value}</small></button>`;
    })
    .join("")}</div></section>`;
}
function lightingDirection(base, target) {
  return `<div class="lighting-direction"><span><b>${t("lightingDirection")}</b><small>One firmware bit; no left/right variants.</small></span><div><button type="button" data-lighting-direction="0" data-lighting-target="${target}" class="${Number(base.direction) === 0 ? "active" : ""}">→ ${t("lightingForward")}</button><button type="button" data-lighting-direction="1" data-lighting-target="${target}" class="${Number(base.direction) === 1 ? "active" : ""}">← ${t("lightingBackward")}</button></div></div>`;
}
function lightingTunePanel(base, target, area) {
  const prefix = target === "main" ? "lighting" : "strip";
  return `<section class="panel lighting-tune-panel"><div class="panel-head"><div><h2>Effect tuning</h2><p>Continuous values used by this firmware area.</p></div><span class="badge">AREA ${area}</span></div>${lightingRange(`${prefix}Brightness`, t("lightingBrightness"), base.brightness, "0 is dark; 100 is maximum output.")}${lightingRange(`${prefix}Speed`, t("lightingSpeed"), base.speed, "0 is slowest; 100 is fastest.")}${lightingDirection(base, target)}</section>`;
}
function lightingPalettePanel(base, palette, target) {
  const paletteIndex = Math.max(0, Math.min(7, Number(base.paletteIndex))),
    activeColor = palette[paletteIndex] || "#000000",
    colorId = target === "main" ? "paletteColor" : "stripPaletteColor",
    hexId = target === "main" ? "paletteHex" : "stripPaletteHex";
  return `<section class="panel full-span lighting-palette-panel"><div class="panel-head"><div><h2>${t("lightingPalette")}</h2><p>${t("lightingPaletteHint")}</p></div><span class="badge ready">SLOT ${paletteIndex + 1}</span></div><div class="palette palette-large">${palette.map((swatch, index) => `<button type="button" data-palette="${index}" data-lighting-target="${target}" class="${index === paletteIndex ? "active" : ""}" style="--swatch:${esc(swatch)}" aria-label="Select palette color ${index + 1}" title="${esc(swatch)}"><span>${String(index + 1).padStart(2, "0")}</span></button>`).join("")}</div><div class="palette-editor"><input id="${colorId}" type="color" value="${esc(activeColor)}" aria-label="${t("lightingActiveColor")}"><label class="field"><span>${t("lightingActiveColor")}</span><input id="${hexId}" type="text" maxlength="7" pattern="#[0-9A-Fa-f]{6}" value="${esc(activeColor.toUpperCase())}"><small>RGB ${parseInt(activeColor.slice(1, 3), 16)}, ${parseInt(activeColor.slice(3, 5), 16)}, ${parseInt(activeColor.slice(5, 7), 16)} · palette slot ${paletteIndex + 1}</small></label><div class="palette-note"><strong>Stored on the keyboard</strong><span>This palette belongs only to ${target === "main" ? "the key LEDs" : "Decorative1"}.</span></div></div></section>`;
}
function dualLightingControls(base) {
  const upper =
      base.open && Boolean(Number(base.openMode) & LIGHTING_OPEN_MODE.UPPER),
    lower =
      base.open && Boolean(Number(base.openMode) & LIGHTING_OPEN_MODE.LOWER);
  return `<section class="panel full-span dual-lighting-card"><div class="panel-head"><div><h2>Upper / lower lighting switch</h2><p>The firmware encodes the two LED orientations as bits in the main power value.</p></div><span class="badge ${state.hardware.doubleLighting ? "ready" : ""}">${state.hardware.doubleLighting ? "REPORTED" : "CAPTURED"}</span></div><div class="dual-lighting-switches"><label class="switch-row"><span><b>${t("lightingUpper")}</b><small>Original driver: Upper Lighting Switch · bit 2</small></span><input id="upperLighting" class="toggle" type="checkbox" ${upper ? "checked" : ""}></label><label class="switch-row"><span><b>${t("lightingLower")}</b><small>Original driver: Lower Lighting Switch · bit 1</small></span><input id="lowerLighting" class="toggle" type="checkbox" ${lower ? "checked" : ""}></label></div></section>`;
}
function mainLightingPage() {
  const lighting = state.profile.lighting,
    base = lighting.base,
    reportedCount = lightingModeCount(0, AE64_MAIN_MODE_COUNT),
    count = LIGHTING_MODE_OPTIONS.length;
  return `<div class="lighting-layout">${lightingPowerPanel(base, t("lightingMainKeyboard"), "Controls the main keyboard LED area.")}<section class="panel full-span capture-note experimental-note"><strong>L21–L23 are experimental</strong><span>AE64 area 0 advertises values 0–19. Catalog values 20–22 are exposed for testing; Apply accepts a value only when the keyboard reads it back unchanged.</span></section>${dualLightingControls(base)}${lightingModePanel(base, count, "main", 0, reportedCount)}${lightingTunePanel(base, "main", 0)}${lightingPalettePanel(base, lighting.palette, "main")}</div>`;
}
function perKeyLightingPage() {
  const lighting = state.profile.lighting,
    ids = lightingKeyIds(),
    key = lightingAnchorKey(),
    hasSelection = ids.length > 0,
    color = lighting.perKey[key.id] || "#73f0c0",
    enabled =
      hasSelection && ids.every((id) => Boolean(lighting.customEnabled?.[id])),
    mixed =
      hasSelection &&
      !enabled &&
      ids.some((id) => Boolean(lighting.customEnabled?.[id])),
    customCount = Object.values(lighting.customEnabled || {}).filter(
      Boolean,
    ).length,
    label = ids.length === 1 ? keys[ids[0]].n : `${ids.length} keys`;
  return `<div class="lighting-layout"><section class="panel per-key-editor"><div class="panel-head"><div><h2>${hasSelection ? `${esc(label)} · ${t("lightingCustomOverride")}` : "Select keys in the preview"}</h2><p>Drag across keys to select. Hold Ctrl and click to add or remove individual keys.</p></div><span class="badge ${enabled ? "ready" : mixed ? "experimental" : ""}">${ids.length} SELECTED</span></div><div class="switch-row"><div><h3>${t("lightingCustomOverride")}</h3><p>The setting is applied to every selected key.</p></div><input id="keyCustomEnabled" class="toggle" type="checkbox" ${enabled ? "checked" : ""} ${hasSelection ? "" : "disabled"}></div><div class="key-color-editor"><input id="keyColor" type="color" value="${esc(color)}" aria-label="Selected key color" ${hasSelection ? "" : "disabled"}><div><span>Selected key color</span><strong>${esc(color.toUpperCase())}</strong><small>${customCount} of 64 keys currently use overrides.</small></div></div><div class="apply-row"><button class="button ghost" id="clearKeyColor" type="button" ${hasSelection ? "" : "disabled"}>Clear selected overrides</button><button class="button primary" id="copyKeyColor" type="button" ${hasSelection ? "" : "disabled"}>${t("lightingCopyAll")}</button></div></section><section class="panel matrix-card"><div class="panel-head"><div><h2>Keyboard LED framebuffer</h2><p>Nine packets cover the firmware's 6 × 21 address space.</p></div><span class="badge">9 × 15 RECORDS</span></div><ul class="fact-list"><li><span>Visible keys</span><strong>64</strong></li><li><span>Selected keys</span><strong>${ids.length}</strong></li><li><span>Live refresh</span><strong>≈ 10 FPS</strong></li></ul><div class="apply-row"><button class="button ghost" id="loadCustomLighting" type="button">${t("lightingReadMatrix")}</button><button class="button ghost" id="clearAllKeyColors" type="button">${t("lightingClearAll")}</button></div></section></div>`;
}
function stripLedButton(index, side) {
  const lighting = state.profile.lighting.decorative,
    baseColor =
      lighting.palette[Number(lighting.base.paletteIndex)] ||
      lighting.palette[0] ||
      "#000000",
    live =
      state.liveLighting &&
      connected() &&
      Array.isArray(state.hardware.liveStrip),
    custom = Boolean(lighting.customEnabled[index]),
    record = live ? state.hardware.liveStrip[index] : null,
    color = record
      ? rgbToHex(record)
      : custom
        ? lighting.perLed[index]
        : baseColor,
    selected =
      state.page === "lighting" &&
      state.lightingTab === "strip" &&
      state.stripSelection.has(index);
  return `<button type="button" data-strip-led="${index}" data-strip-side="${side}" class="${selected ? "selected" : ""} ${custom ? "custom" : ""}" style="--led-color:${esc(color)}" title="LED ${index} · ${esc(color.toUpperCase())}" aria-pressed="${selected}"><span>${index}</span></button>`;
}
function stripHtml() {
  const side = (name) =>
    DECORATIVE_LAYOUT[name]
      .map((index) => stripLedButton(index, name))
      .join("");
  return `<div class="decorative-frame" aria-label="Light strip physical perimeter with 38 LEDs"><div class="decorative-side decorative-top">${side("top")}</div><div class="decorative-side decorative-left">${side("left")}</div><div class="decorative-keyboard-core lighting-preview">${keyboardHtml({ lighting: true })}</div><div class="decorative-side decorative-right">${side("right")}</div><div class="decorative-side decorative-bottom">${side("bottom")}</div></div>`;
}
function unifiedLightingPreview() {
  const keyCount = lightingKeyIds().length,
    stripCount = stripLedIds().length,
    hints = {
      main: "Live preview only. Choose the keyboard effect in the controls below.",
      perKey:
        "Drag across keyboard keys. Ctrl+click adds or removes individual keys.",
      strip:
        "Drag only across the four light-strip sides. Ctrl+click adds or removes LEDs.",
    };
  return `<section class="panel unified-lighting-preview"><div class="panel-head"><div><h2>Unified live lighting</h2><p>The keyboard and all 38 perimeter LEDs stay visible while the settings below change.</p></div><span class="badge ${state.liveLighting && connected() ? "ready" : ""}">KEYBOARD + 38 LEDS</span></div><div class="unified-preview-scroll">${stripHtml()}</div><div class="board-footer"><span>${hints[state.lightingTab]}</span><span id="lightingSelectionSummary">${state.lightingTab === "perKey" ? `Selected: <b>${keyCount} key${keyCount === 1 ? "" : "s"}</b>` : state.lightingTab === "strip" ? `Selected: <b>${stripCount} LED${stripCount === 1 ? "" : "s"}</b>` : "Preview mode"}</span></div></section>`;
}
function decorativeLightingPage() {
  const lighting = state.profile.lighting.decorative,
    base = lighting.base,
    count = lightingModeCount(1, AE64_DECORATIVE_MODE_COUNT),
    ids = stripLedIds(),
    hasSelection = ids.length > 0,
    selected = Math.max(
      0,
      Math.min(DECORATIVE_COLS - 1, Number(state.stripSelected)),
    ),
    color = lighting.perLed[selected] || "#73f0c0",
    enabled =
      hasSelection &&
      ids.every((index) => Boolean(lighting.customEnabled[index])),
    mixed =
      hasSelection &&
      !enabled &&
      ids.some((index) => Boolean(lighting.customEnabled[index])),
    customCount = lighting.customEnabled.filter(Boolean).length;
  return `<div class="lighting-layout">${lightingPowerPanel(base, t("lightingDecorative"), "Controls the independent 38-LED perimeter area.")}${lightingModePanel(base, count, "strip", 1)}${lightingTunePanel(base, "strip", 1)}${lightingPalettePanel(base, lighting.palette, "strip")}<section class="panel full-span strip-editor"><div class="panel-head"><div><h2>${hasSelection ? `${ids.length} light strip LED${ids.length === 1 ? "" : "s"} selected` : "Select LEDs on the four sides"}</h2><p>Drag along the perimeter. Hold Ctrl and click to add or remove individual LEDs.</p></div><span class="badge ${enabled ? "ready" : mixed ? "experimental" : ""}">${ids.length} SELECTED</span></div><div class="strip-editor-grid"><label class="switch-row"><span><b>${t("lightingCustomOverride")}</b><small>The setting is applied to every selected light-strip LED.</small></span><input id="stripCustomEnabled" class="toggle" type="checkbox" ${enabled ? "checked" : ""} ${hasSelection ? "" : "disabled"}></label><div class="key-color-editor"><input id="stripColor" type="color" value="${esc(color)}" aria-label="Selected strip LED color" ${hasSelection ? "" : "disabled"}><div><span>Selected strip color</span><strong>${esc(color.toUpperCase())}</strong><small>${customCount} of 38 overrides enabled.</small></div></div></div><div class="apply-row"><button class="button ghost" id="loadStripLighting" type="button">${t("lightingReadMatrix")}</button><button class="button ghost" id="clearStripColor" type="button" ${hasSelection ? "" : "disabled"}>Clear selected overrides</button><button class="button ghost" id="clearAllStripColors" type="button">${t("lightingClearStrip")}</button><button class="button primary" id="copyStripColor" type="button" ${hasSelection ? "" : "disabled"}>${t("lightingCopyStrip")}</button></div></section></div>`;
}
function lightingPage() {
  const lighting = state.profile.lighting,
    keyboardOff = !lighting.base.open,
    stripOff = !lighting.decorative.base.open;
  return `<div class="lighting-page lighting-context-${state.lightingTab} ${keyboardOff ? "keyboard-off" : ""} ${stripOff ? "strip-off" : ""}"><section class="panel lighting-command"><div class="lighting-command-copy"><span class="eyebrow">RGB / LIVE FRAMEBUFFER</span><h2>Keyboard + light strip</h2><p>One permanent preview for both firmware lighting areas.</p><span id="liveRgbStatus" class="badge ${state.liveLighting && connected() ? "ready" : ""}">${state.liveLighting && connected() ? "LIVE · READING" : "LIVE · PAUSED"}</span></div><label class="lighting-power live-rgb-toggle"><span><b>${t("lightingLive")}</b><small>${t("lightingLiveHint")}</small></span><input id="lightingLive" class="toggle" type="checkbox" ${state.liveLighting ? "checked" : ""}></label></section>${unifiedLightingPreview()}<section class="panel lighting-section-nav">${lightingTabs()}</section>${state.lightingTab === "main" ? mainLightingPage() : state.lightingTab === "perKey" ? perKeyLightingPage() : decorativeLightingPage()}</div>`;
}
function mappedOptions(options, current, supportedValues, labelFor) {
  const supported = new Set(supportedValues.map(Number)),
    visible = supported.size
      ? options.filter((option) => supported.has(option.value))
      : options;
  const normalized = visible.some((option) => option.value === Number(current))
    ? visible
    : [{ value: Number(current), unknown: true }, ...visible];
  return normalized
    .map(
      (option) =>
        `<option value="${option.value}" ${option.value === Number(current) ? "selected" : ""}>${esc(option.unknown ? `Unknown device value ${option.value}` : labelFor(option))}</option>`,
    )
    .join("");
}
function settingsPage() {
  const settings = state.profile.settings;
  const systemOptions = mappedOptions(
    SYSTEM_MODE_OPTIONS,
    settings.systemMode,
    state.hardware.systemModes,
    (option) => option.label,
  );
  const pollingOptions = mappedOptions(
    POLLING_RATE_OPTIONS,
    settings.reportRate,
    state.hardware.reportRates,
    (option) => `${option.hz.toLocaleString()} Hz`,
  );
  return `<div class="page-grid three"><section class="panel"><div class="panel-head"><div><h2>USB & scanning</h2><p>General firmware settings from the original driver.</p></div></div><div class="form-grid"><label class="field"><span>System mode</span><select id="systemMode">${systemOptions}</select><small>Firmware value 0 is Windows; value 1 is macOS.</small></label><label class="field"><span>Polling rate</span><select id="reportRate">${pollingOptions}</select><small>250 to 8,000 Hz. Higher rates use more USB processing time.</small></label><label class="field"><span>RGB sleep (minutes)</span><input id="sleepTime" type="number" min="0" max="65535" value="${settings.sleepTime}"></label></div><div class="switch-row"><div><h3>Shake optimization</h3><p>Firmware key-stability optimization.</p></div><input id="shake" class="toggle" type="checkbox" ${settings.shake ? "checked" : ""}></div></section><section class="panel"><div class="panel-head"><div><h2>Profiles</h2><p>Switch or rename onboard configurations.</p></div></div><label class="field"><span>Profile name</span><input id="profileName" type="text" maxlength="32" value="${esc(state.hardware.configNames[state.profile.profileIndex] || `Profile ${state.profile.profileIndex + 1}`)}"></label><div class="apply-row"><button class="button ghost" id="saveProfileName" type="button">Save name</button></div><ul class="fact-list"><li><span>Active slot</span><strong>${state.profile.profileIndex + 1}</strong></li><li><span>Available slots</span><strong>${state.hardware.configIndexes.length}</strong></li></ul></section><section class="panel"><div class="panel-head"><div><h2>Files & recovery</h2><p>Portable JSON, independent of the manufacturer cloud.</p></div></div><div class="apply-row"><button class="button ghost" id="importProfile" type="button">Import JSON</button><button class="button primary" id="exportProfile" type="button">Export JSON</button></div><hr style="border:0;border-top:1px solid var(--line);margin:22px 0"><h3>Factory restore</h3><p>This destructive command stays visible but disabled until physical-device verification.</p><button class="button danger" type="button" disabled>Restore factory settings</button></section></div>`;
}
const ADVANCED_FEATURES = [
  [
    "DKS",
    "Dynamic Keystroke",
    "Up to four keycodes at multiple press/release points.",
  ],
  [
    "MPT",
    "Multi-point Trigger",
    "Three key actions at distinct travel depths.",
  ],
  [
    "MT",
    "Mod-Tap",
    "Tap one function and hold another after a time threshold.",
  ],
  ["TGL", "Toggle Key", "Latch a key action with firmware timing."],
  ["END", "End Key", "Trigger paired actions with an end delay."],
  [
    "SOCD",
    "SOCD Resolution",
    "Resolve two opposing keys using firmware priority modes.",
  ],
  [
    "RS",
    "Rappy Snappy",
    "Compare two keys by travel and prefer the deeper input.",
  ],
];
function advancedPage() {
  return `<div class="page-grid"><section class="panel full-span warning-card"><div class="panel-head"><div><h2>Advanced Hall-key modes</h2><p>All seven shipped features are visible. This basic release safely decodes them without unverified writes.</p></div><span class="badge experimental">VISIBLE · READ ONLY</span></div></section>${boardPanel()}<section class="panel"><div class="panel-head"><div><h2>Selected-key record</h2><p>Decoded directly from family 0x06.</p></div></div>${selectedCard()}<div class="apply-row"><button class="button ghost" id="readMacroSpace" type="button">Read macro capacity</button><button class="button primary" id="readAdvanced" type="button">Read advanced record</button></div><pre class="raw-output">${esc(JSON.stringify({ advanced: state.hardware.advanced || "Connect and read", macroSpace: state.hardware.macroSpace || "Not read" }, null, 2))}</pre></section><section class="panel full-span"><div class="advanced-grid">${ADVANCED_FEATURES.map(([code, title, body], i) => `<article class="advanced-card"><header><h3>${code}</h3><span class="badge deferred">EDITOR NEXT</span></header><strong>${title}</strong><p>${body}</p><small>family 06 · mode ${i + 1}</small></article>`).join("")}</div></section></div>`;
}
function capabilityCards() {
  const feature = state.hardware.feature;
  const known = {
    mechanical: null,
    magnetic: null,
    optical: null,
    inductive: null,
    magnetic3D: null,
    usb: null,
    wireless24: null,
    bluetooth: null,
    usb3: null,
    rgb: null,
    knob: null,
    smallScreen: null,
    fullScreen: null,
    haptic: null,
    voicePlayback: null,
    voiceRecognition: null,
    gamepad: null,
    dotMatrix: null,
  };
  if (feature)
    Object.assign(
      known,
      feature.axis,
      feature.connection,
      feature.basic,
      feature.extended,
    );
  return `<div class="capability-grid">${Object.entries(known)
    .map(
      ([name, enabled]) =>
        `<article class="capability ${enabled === true ? "yes" : "no"}"><span>${esc(name)}</span><strong>${enabled === null ? "Connect to detect" : enabled ? "Reported" : "Not reported"}</strong></article>`,
    )
    .join("")}</div>`;
}
function diagnosticsPage() {
  const info = state.hardware.info || {};
  return `<div class="page-grid"><section class="panel"><div class="panel-head"><div><h2>Device identity</h2><p>Configuration HID collection metadata.</p></div><span class="badge ${connected() ? "ready" : ""}">${connected() ? "LIVE" : "DEMO"}</span></div><ul class="fact-list"><li><span>VID:PID</span><strong>1CA6:300A</strong></li><li><span>Board ID</span><strong>${esc(info.boardIdHex || "0030000A expected")}</strong></li><li><span>Firmware</span><strong>${esc(info.firmware || "Connect to read")}</strong></li><li><span>Protocol</span><strong>${state.hardware.protocol ? `${state.hardware.protocol.main}.${state.hardware.protocol.sub}` : "Connect to read"}</strong></li><li><span>Serial</span><strong>${esc(info.serial || "Connect to read")}</strong></li><li><span>RT precision</span><strong>${Number(state.hardware.precision || 0.001).toFixed(3)} mm</strong></li></ul><div class="apply-row"><button class="button ghost" id="readLayoutStyle" type="button">Read layout metadata</button><button class="button ghost" id="exportLog" type="button">Export session log</button></div></section><section class="panel"><div class="panel-head"><div><h2>Firmware capabilities</h2><p>Hidden generic features remain visible even when their bit is off.</p></div></div>${capabilityCards()}</section><section class="panel full-span"><div class="panel-head"><div><h2>Supported protocol surface</h2><p>Firmware upgrade and bootloader commands are intentionally absent.</p></div><span class="badge ready">NO UPDATER</span></div><div class="capability-grid">${["Device identity", "Profiles", "System settings", "Four key layers", "Hall performance", "Raw axis data", "Base RGB", "Custom RGB", "Advanced key reads", "Macro reads", "Calibration", "Read-back verify"].map((name) => `<article class="capability yes"><span>Available</span><strong>${name}</strong></article>`).join("")}</div><pre class="raw-output">${esc(JSON.stringify({ layoutStyle: state.hardware.layoutStyle, recent: state.hardware.logs.slice(0, 12) }, null, 2))}</pre></section></div>`;
}

function render() {
  stopPolling();
  const [title, description] = pageCopy();
  document.querySelector("#pageKicker").textContent =
    `AE64 PRO / ${state.page.toUpperCase()}`;
  document.querySelector("#pageTitle").textContent = title;
  document.querySelector("#pageDescription").textContent = description;
  document
    .querySelectorAll("#sideNav button")
    .forEach((button) =>
      button.classList.toggle("active", button.dataset.page === state.page),
    );
  const pages = {
    overview: overviewPage,
    performance: performancePage,
    keymap: keymapPage,
    lighting: lightingPage,
    settings: settingsPage,
    advanced: advancedPage,
    diagnostics: diagnosticsPage,
  };
  document.querySelector("#pageContent").innerHTML = pages[state.page]();
  renderToolbar();
  renderStatus();
  bindPage();
}
function renderToolbar() {
  const profiles = state.hardware.configIndexes
    .map(
      (index) =>
        `<option value="${index}" ${index === Number(state.profile.profileIndex) ? "selected" : ""}>${esc(state.hardware.configNames[index] || `Profile ${index + 1}`)}</option>`,
    )
    .join("");
  const select = document.querySelector("#quickProfileSelect");
  if (select) select.innerHTML = profiles;
  document.querySelector("#layerSelect").value = String(state.profile.layer);
  document.querySelectorAll(".language-select").forEach((select) => {
    select.value = state.language;
  });
}
function renderStatus() {
  const count = dirtyCount();
  document.querySelector("#connectionStatus").textContent = connected()
    ? `Connected · FW ${state.hardware.info?.firmware || "?"}`
    : t("offline");
  document.querySelector("#connectionDot").className = connected()
    ? ""
    : "offline";
  document.querySelector("#dirtyStatus").textContent = count
    ? `${count} staged change${count === 1 ? "" : "s"}`
    : t("noPendingChanges");
  document.querySelector("#applyButton").disabled = count === 0;
  document.querySelector("#revertButton").disabled = count === 0;
  document.querySelector("#connectionLabel").textContent = connected()
    ? `Connected · FW ${state.hardware.info?.firmware || "?"}`
    : t("offlineWorkspace");
}
function stagePerformance(field, value) {
  state.profile.performance[selectedKey().id][field] = value;
  state.dirty.performance.add(selectedKey().id);
  renderStatus();
}
function stageSetting(field, value) {
  state.profile.settings[field] = value;
  state.dirty.settings.add(field);
  renderStatus();
}
function bindNumberPair(id, field) {
  const number = document.querySelector(`#${id}`),
    range = document.querySelector(`[data-range-for="${id}"]`);
  if (!number || !range) return;
  const update = (source, other) => {
    const value = clamp(source.value, Number(source.min), Number(source.max));
    other.value = value;
    stagePerformance(field, value);
  };
  number.addEventListener("input", () => update(number, range));
  range.addEventListener("input", () => update(range, number));
}

function refreshLightingSelection() {
  document
    .querySelectorAll(".unified-lighting-preview [data-key]")
    .forEach((node) => {
      const selected =
        state.lightingTab === "perKey" &&
        state.lightingSelectedKeys.has(Number(node.dataset.key));
      node.classList.toggle("selected", selected);
      node.setAttribute("aria-pressed", String(selected));
    });
  document
    .querySelectorAll(".unified-lighting-preview [data-strip-led]")
    .forEach((node) => {
      const selected =
        state.lightingTab === "strip" &&
        state.stripSelection.has(Number(node.dataset.stripLed));
      node.classList.toggle("selected", selected);
      node.setAttribute("aria-pressed", String(selected));
    });
  const summary = document.querySelector("#lightingSelectionSummary");
  if (summary) {
    const count =
        state.lightingTab === "perKey"
          ? lightingKeyIds().length
          : stripLedIds().length,
      label =
        state.lightingTab === "perKey"
          ? `key${count === 1 ? "" : "s"}`
          : `LED${count === 1 ? "" : "s"}`;
    summary.innerHTML = `Selected: <b>${count} ${label}</b>`;
  }
}
function applyLightingSelection(kind, index, mode) {
  const selection =
    kind === "key" ? state.lightingSelectedKeys : state.stripSelection;
  if (mode === "remove") selection.delete(index);
  else selection.add(index);
  if (kind === "key") {
    if (mode !== "remove") state.profile.selected = index;
    else if (Number(state.profile.selected) === index && selection.size)
      state.profile.selected = [...selection].at(-1);
  } else {
    if (mode !== "remove") state.stripSelected = index;
    else if (Number(state.stripSelected) === index && selection.size)
      state.stripSelected = [...selection].at(-1);
  }
  refreshLightingSelection();
}
function stopLightingSelection() {
  if (!state.selectionDrag) return;
  document.removeEventListener("pointermove", moveLightingSelection);
  document.removeEventListener("pointerup", stopLightingSelection);
  document.removeEventListener("pointercancel", stopLightingSelection);
  state.selectionDrag = null;
  render();
}
function moveLightingSelection(event) {
  const drag = state.selectionDrag;
  if (!drag) return;
  const selector = drag.kind === "key" ? "[data-key]" : "[data-strip-led]",
    node = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest(selector);
  if (!node || !node.closest(".unified-lighting-preview")) return;
  const index = Number(
    drag.kind === "key" ? node.dataset.key : node.dataset.stripLed,
  );
  if (drag.visited.has(index)) return;
  drag.visited.add(index);
  applyLightingSelection(drag.kind, index, drag.mode);
}
function beginLightingSelection(kind, index, event) {
  if (event.button !== 0) return;
  event.preventDefault();
  const selection =
      kind === "key" ? state.lightingSelectedKeys : state.stripSelection,
    mode = event.ctrlKey ? (selection.has(index) ? "remove" : "add") : "add";
  if (!event.ctrlKey) selection.clear();
  state.selectionDrag = { kind, mode, visited: new Set([index]) };
  applyLightingSelection(kind, index, mode);
  document.addEventListener("pointermove", moveLightingSelection);
  document.addEventListener("pointerup", stopLightingSelection);
  document.addEventListener("pointercancel", stopLightingSelection);
}
function bindLightingSelection() {
  if (state.lightingTab === "perKey")
    document
      .querySelectorAll(".unified-lighting-preview [data-key]")
      .forEach((node) =>
        node.addEventListener("pointerdown", (event) =>
          beginLightingSelection("key", Number(node.dataset.key), event),
        ),
      );
  if (state.lightingTab === "strip")
    document
      .querySelectorAll(".unified-lighting-preview [data-strip-led]")
      .forEach((node) =>
        node.addEventListener("pointerdown", (event) =>
          beginLightingSelection("strip", Number(node.dataset.stripLed), event),
        ),
      );
}

function bindPage() {
  if (state.page !== "lighting")
    document
      .querySelectorAll("[data-key]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          selectKey(Number(button.dataset.key)),
        ),
      );
  document.querySelectorAll("[data-goto]").forEach((button) =>
    button.addEventListener("click", () => {
      state.page = button.dataset.goto;
      render();
    }),
  );
  document.querySelectorAll("[data-performance-tab]").forEach((button) =>
    button.addEventListener("click", () => {
      state.performanceTab = button.dataset.performanceTab;
      render();
    }),
  );
  if (state.page === "performance") {
    document
      .querySelector("#performanceMode")
      ?.addEventListener("change", (event) =>
        stagePerformance("mode", event.target.checked ? 1 : 0),
      );
    [
      "normalPress",
      "normalRelease",
      "rtFirstTouch",
      "rtPress",
      "rtRelease",
      "pressDeadStroke",
      "releaseDeadStroke",
    ].forEach((field) => bindNumberPair(field, field));
    document
      .querySelector("[data-copy-performance]")
      ?.addEventListener("click", () => {
        const source = clone(state.profile.performance[selectedKey().id]);
        keys.forEach((key) => {
          state.profile.performance[key.id] = clone(source);
          state.dirty.performance.add(key.id);
        });
        render();
        showToast("Performance settings staged for all 64 keys.");
      });
    document
      .querySelector("#startCalibration")
      ?.addEventListener("click", startCalibration);
    document
      .querySelector("#stopCalibration")
      ?.addEventListener("click", stopCalibration);
    document
      .querySelector("#startTravel")
      ?.addEventListener("click", startTravel);
    document
      .querySelector("#stopTravel")
      ?.addEventListener("click", stopPolling);
  }
  if (state.page === "keymap") {
    document
      .querySelector("#mappingSearch")
      ?.addEventListener("input", (event) => {
        state.mappingSearch = event.target.value;
        render();
        document.querySelector("#mappingSearch")?.focus();
      });
    document.querySelectorAll("[data-mapping-group]").forEach((button) =>
      button.addEventListener("click", () => {
        state.mappingGroup = button.dataset.mappingGroup;
        state.mappingSearch = "";
        render();
      }),
    );
    document.querySelectorAll("[data-keycode]").forEach((button) =>
      button.addEventListener("click", () => {
        const token = `${state.profile.layer}:${selectedKey().id}`;
        state.profile.keycodes[state.profile.layer][selectedKey().id] = Number(
          button.dataset.keycode,
        );
        state.dirty.mapping.add(token);
        render();
      }),
    );
    document.querySelector("#resetKeycode")?.addEventListener("click", () => {
      state.profile.keycodes[state.profile.layer][selectedKey().id] =
        defaultKeycode(selectedKey());
      state.dirty.mapping.add(`${state.profile.layer}:${selectedKey().id}`);
      render();
    });
  }
  if (state.page === "lighting") {
    const lighting = state.profile.lighting,
      stripLighting = lighting.decorative,
      activeBase =
        state.lightingTab === "strip" ? stripLighting.base : lighting.base;
    bindLightingSelection();
    document.querySelectorAll("[data-lighting-tab]").forEach((button) =>
      button.addEventListener("click", () => {
        state.lightingTab = button.dataset.lightingTab;
        render();
      }),
    );
    document
      .querySelector("#lightingOpen")
      ?.addEventListener("change", (event) => {
        activeBase.open = event.target.checked;
        activeBase.openMode = activeBase.open
          ? state.lightingTab === "strip"
            ? LIGHTING_OPEN_MODE.LOWER
            : LIGHTING_OPEN_MODE.BOTH
          : LIGHTING_OPEN_MODE.OFF;
        if (state.lightingTab === "strip") state.dirty.decorativeBase = true;
        else state.dirty.lightingBase = true;
        render();
      });
    document
      .querySelector("#lightingLive")
      ?.addEventListener("change", (event) => {
        state.liveLighting = event.target.checked;
        render();
      });
    const stageDoubleLighting = (mask, enabled) => {
      let mode = Number(lighting.base.openMode) || LIGHTING_OPEN_MODE.OFF;
      mode = enabled ? mode | mask : mode & ~mask;
      lighting.base.openMode = mode;
      lighting.base.open = mode !== LIGHTING_OPEN_MODE.OFF;
      state.dirty.lightingBase = true;
      render();
    };
    document
      .querySelector("#upperLighting")
      ?.addEventListener("change", (event) =>
        stageDoubleLighting(LIGHTING_OPEN_MODE.UPPER, event.target.checked),
      );
    document
      .querySelector("#lowerLighting")
      ?.addEventListener("change", (event) =>
        stageDoubleLighting(LIGHTING_OPEN_MODE.LOWER, event.target.checked),
      );
    document.querySelectorAll("[data-lighting-mode]").forEach((button) =>
      button.addEventListener("click", () => {
        const strip = button.dataset.lightingTarget === "strip",
          base = strip ? stripLighting.base : lighting.base;
        base.mode = Number(button.dataset.lightingMode);
        if (strip) state.dirty.decorativeBase = true;
        else state.dirty.lightingBase = true;
        render();
      }),
    );
    [
      ["lightingBrightness", "brightness", lighting.base, "main"],
      ["lightingSpeed", "speed", lighting.base, "main"],
      ["stripBrightness", "brightness", stripLighting.base, "strip"],
      ["stripSpeed", "speed", stripLighting.base, "strip"],
    ].forEach(([id, field, base, target]) =>
      document.querySelector(`#${id}`)?.addEventListener("input", (event) => {
        base[field] = clamp(event.target.value, 0, 100);
        document.querySelector(`#${id}Value`).textContent = String(base[field]);
        if (target === "strip") state.dirty.decorativeBase = true;
        else state.dirty.lightingBase = true;
        renderStatus();
      }),
    );
    document.querySelectorAll("[data-lighting-direction]").forEach((button) =>
      button.addEventListener("click", () => {
        const strip = button.dataset.lightingTarget === "strip",
          base = strip ? stripLighting.base : lighting.base;
        base.direction = Number(button.dataset.lightingDirection);
        if (strip) state.dirty.decorativeBase = true;
        else state.dirty.lightingBase = true;
        render();
      }),
    );
    document.querySelectorAll("[data-palette]").forEach((button) =>
      button.addEventListener("click", () => {
        const strip = button.dataset.lightingTarget === "strip",
          base = strip ? stripLighting.base : lighting.base;
        base.paletteIndex = Number(button.dataset.palette);
        if (strip) state.dirty.decorativeBase = true;
        else state.dirty.lightingBase = true;
        render();
      }),
    );
    const stagePaletteColor = (value, target = "main") => {
      const color = normalizeHex(value);
      if (!color)
        return showToast(
          "Use a six-digit HEX color, for example #73F0C0.",
          true,
        );
      const strip = target === "strip",
        base = strip ? stripLighting.base : lighting.base,
        palette = strip ? stripLighting.palette : lighting.palette;
      palette[Number(base.paletteIndex)] = color;
      if (strip) state.dirty.decorativePalette = true;
      else state.dirty.lightingPalette = true;
      render();
    };
    document
      .querySelector("#paletteColor")
      ?.addEventListener("change", (event) =>
        stagePaletteColor(event.target.value),
      );
    document
      .querySelector("#paletteHex")
      ?.addEventListener("change", (event) =>
        stagePaletteColor(event.target.value),
      );
    document
      .querySelector("#stripPaletteColor")
      ?.addEventListener("change", (event) =>
        stagePaletteColor(event.target.value, "strip"),
      );
    document
      .querySelector("#stripPaletteHex")
      ?.addEventListener("change", (event) =>
        stagePaletteColor(event.target.value, "strip"),
      );
    document
      .querySelector("#keyCustomEnabled")
      ?.addEventListener("change", (event) => {
        for (const id of lightingKeyIds()) {
          lighting.customEnabled[id] = event.target.checked;
          state.dirty.customLighting.add(id);
        }
        render();
      });
    document.querySelector("#keyColor")?.addEventListener("input", (event) => {
      for (const id of lightingKeyIds()) {
        lighting.perKey[id] = event.target.value;
        lighting.customEnabled[id] = true;
        state.dirty.customLighting.add(id);
      }
      document
        .querySelectorAll(".unified-lighting-preview [data-key]")
        .forEach((node) => {
          if (state.lightingSelectedKeys.has(Number(node.dataset.key)))
            node.style.setProperty("--key-color", event.target.value);
        });
      renderStatus();
    });
    document
      .querySelector("#loadCustomLighting")
      ?.addEventListener("click", loadCustomLighting);
    document.querySelector("#copyKeyColor")?.addEventListener("click", () => {
      const color = lighting.perKey[lightingAnchorKey().id];
      keys.forEach((key) => {
        lighting.perKey[key.id] = color;
        lighting.customEnabled[key.id] = true;
        state.dirty.customLighting.add(key.id);
      });
      render();
      showToast("Custom color staged for all 64 keys.");
    });
    document.querySelector("#clearKeyColor")?.addEventListener("click", () => {
      for (const id of lightingKeyIds()) {
        lighting.customEnabled[id] = false;
        state.dirty.customLighting.add(id);
      }
      render();
    });
    document
      .querySelector("#clearAllKeyColors")
      ?.addEventListener("click", () => {
        keys.forEach((key) => {
          lighting.customEnabled[key.id] = false;
          state.dirty.customLighting.add(key.id);
        });
        render();
        showToast("All custom overrides staged for clearing.");
      });
    document
      .querySelector("#stripCustomEnabled")
      ?.addEventListener("change", (event) => {
        for (const index of stripLedIds()) {
          stripLighting.customEnabled[index] = event.target.checked;
          state.dirty.decorativeLighting.add(index);
        }
        render();
      });
    document
      .querySelector("#stripColor")
      ?.addEventListener("input", (event) => {
        for (const index of stripLedIds()) {
          stripLighting.perLed[index] = event.target.value;
          stripLighting.customEnabled[index] = true;
          state.dirty.decorativeLighting.add(index);
        }
        document
          .querySelectorAll(".unified-lighting-preview [data-strip-led]")
          .forEach((node) => {
            if (state.stripSelection.has(Number(node.dataset.stripLed)))
              node.style.setProperty("--led-color", event.target.value);
          });
        renderStatus();
      });
    document
      .querySelector("#loadStripLighting")
      ?.addEventListener("click", loadDecorativeLighting);
    document.querySelector("#copyStripColor")?.addEventListener("click", () => {
      const color = stripLighting.perLed[state.stripSelected];
      for (let index = 0; index < DECORATIVE_COLS; index += 1) {
        stripLighting.perLed[index] = color;
        stripLighting.customEnabled[index] = true;
        state.dirty.decorativeLighting.add(index);
      }
      render();
      showToast("Custom color staged for all 38 strip LEDs.");
    });
    document
      .querySelector("#clearStripColor")
      ?.addEventListener("click", () => {
        for (const index of stripLedIds()) {
          stripLighting.customEnabled[index] = false;
          state.dirty.decorativeLighting.add(index);
        }
        render();
      });
    document
      .querySelector("#clearAllStripColors")
      ?.addEventListener("click", () => {
        for (let index = 0; index < DECORATIVE_COLS; index += 1) {
          stripLighting.customEnabled[index] = false;
          state.dirty.decorativeLighting.add(index);
        }
        render();
        showToast("All Decorative1 overrides staged for clearing.");
      });
    if (state.liveLighting && connected()) startLightingLive();
  }
  if (state.page === "settings") {
    document
      .querySelector("#systemMode")
      ?.addEventListener("change", (event) =>
        stageSetting("systemMode", Number(event.target.value)),
      );
    document
      .querySelector("#reportRate")
      ?.addEventListener("change", (event) =>
        stageSetting("reportRate", Number(event.target.value)),
      );
    document
      .querySelector("#sleepTime")
      ?.addEventListener("change", (event) =>
        stageSetting("sleepTime", clamp(event.target.value, 0, 65535)),
      );
    document
      .querySelector("#shake")
      ?.addEventListener("change", (event) =>
        stageSetting("shake", event.target.checked),
      );
    document
      .querySelector("#saveProfileName")
      ?.addEventListener("click", saveProfileName);
    document
      .querySelector("#exportProfile")
      ?.addEventListener("click", exportProfile);
    document
      .querySelector("#importProfile")
      ?.addEventListener("click", () =>
        document.querySelector("#profileFileInput").click(),
      );
  }
  if (state.page === "advanced") {
    document
      .querySelector("#readAdvanced")
      ?.addEventListener("click", readAdvanced);
    document
      .querySelector("#readMacroSpace")
      ?.addEventListener("click", readMacroSpace);
  }
  if (state.page === "diagnostics") {
    document
      .querySelector("#readLayoutStyle")
      ?.addEventListener("click", readLayoutStyle);
    document.querySelector("#exportLog")?.addEventListener("click", exportLog);
  }
}

async function selectKey(id) {
  state.profile.selected = id;
  render();
  if (!connected()) return;
  try {
    await readSelectedKey();
    if (selectedKey().id === id) render();
  } catch (error) {
    showToast(error.message, true);
  }
}
function openWorkspace() {
  document.querySelector("#topbar").classList.add("hidden");
  document.querySelector("main").classList.add("hidden");
  document.querySelector("#workspace").classList.remove("hidden");
  render();
  window.scrollTo({ top: 0 });
}
function returnHome() {
  stopPolling();
  document.querySelector("#workspace").classList.add("hidden");
  document.querySelector("#topbar").classList.remove("hidden");
  document.querySelector("main").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function showToast(message, isError = false) {
  const node = document.querySelector("#toast");
  node.textContent = message;
  node.classList.toggle("error", isError);
  node.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => node.classList.remove("show"), 3600);
}
function showProgress(title, detail = "") {
  document.querySelector("#progressTitle").textContent = title;
  document.querySelector("#progressDetail").textContent = detail;
  document.querySelector("#progressOverlay").classList.remove("hidden");
}
function hideProgress() {
  document.querySelector("#progressOverlay").classList.add("hidden");
}
async function optional(label, operation, fallback = null) {
  try {
    return await operation();
  } catch (error) {
    log(`${label} unavailable`, error.message);
    return fallback;
  }
}

async function connectKeyboard(device = null) {
  const targetDevice = device || state.knownDevice;
  showProgress(
    targetDevice ? "Opening AE64 Pro" : "Connecting to AE64 Pro",
    targetDevice
      ? "Opening your previously authorized keyboard."
      : "Choose the 1CA6:300A configuration interface.",
  );
  try {
    if (state.transport) await state.transport.close();
    state.transport = targetDevice
      ? new AE64HidTransport(targetDevice)
      : await AE64HidTransport.request();
    if (targetDevice) await state.transport.open();
    await optional("open-web-driver handshake", () =>
      state.transport.openWebDriver(),
    );
    const [
      protocol,
      info,
      feature,
      precision,
      configIndexes,
      currentConfig,
      systemModes,
      systemMode,
      reportRates,
      reportRate,
      sleepTime,
      shake,
      axisLibrary,
      lightingAreas,
      doubleLighting,
      lightingBase,
      palette,
      decorativeBase,
      decorativePalette,
    ] = await Promise.all([
      state.transport.getProtocolVersion(),
      state.transport.getDeviceInfo(),
      state.transport.getDeviceFeature(),
      state.transport.getRtPrecision(),
      optional(
        "config list",
        () => state.transport.getConfigList(),
        [0, 1, 2, 3],
      ),
      optional("current config", () => state.transport.getCurrentConfig(), 0),
      optional("system modes", () => state.transport.getSystemModes(), []),
      optional("system mode", () => state.transport.getSystemMode(), 0),
      optional("report rates", () => state.transport.getReportRates(), []),
      optional("report rate", () => state.transport.getReportRate(), 0),
      optional(
        "lighting sleep",
        () => state.transport.getLightingSleepTime(),
        10,
      ),
      optional(
        "shake optimization",
        () => state.transport.getShakeOptimization(),
        false,
      ),
      optional("axis library", () => state.transport.getAxisLibrary(), []),
      optional("lighting areas", () => state.transport.getLightingAreas(), []),
      optional(
        "double lighting",
        () => state.transport.getDoubleLighting(),
        false,
      ),
      optional(
        "lighting base",
        () => state.transport.getLightingBase(0),
        state.profile.lighting.base,
      ),
      optional(
        "lighting palette",
        () => state.transport.getLightingPalette(0),
        null,
      ),
      optional(
        "Decorative1 base",
        () => state.transport.getLightingBase(1),
        state.profile.lighting.decorative.base,
      ),
      optional(
        "Decorative1 palette",
        () => state.transport.getLightingPalette(1),
        null,
      ),
    ]);
    if (info.boardIdHex.toUpperCase() !== "0030000A")
      throw new Error(
        `Unexpected board ID ${info.boardIdHex}; writes refused.`,
      );
    state.knownDevice = state.transport.device;
    Object.assign(state.hardware, {
      protocol,
      info,
      feature,
      precision,
      configIndexes: configIndexes.length ? configIndexes : [0, 1, 2, 3],
      systemModes,
      reportRates,
      axisLibrary,
      lightingAreas,
      doubleLighting: Boolean(doubleLighting),
      customMatrix: null,
      decorativeMatrix: null,
      liveMatrix: null,
      liveStrip: null,
    });
    state.profile.profileIndex = currentConfig;
    state.profile.settings = { systemMode, reportRate, sleepTime, shake };
    state.profile.lighting.base = {
      ...state.profile.lighting.base,
      ...lightingBase,
    };
    state.profile.lighting.decorative.base = {
      ...state.profile.lighting.decorative.base,
      ...decorativeBase,
    };
    if (palette) state.profile.lighting.palette = palette.map(rgbToHex);
    if (decorativePalette)
      state.profile.lighting.decorative.palette =
        decorativePalette.map(rgbToHex);
    state.hardware.configNames = await Promise.all(
      state.hardware.configIndexes.map((index) =>
        optional(
          `profile ${index + 1} name`,
          () => state.transport.getConfigName(index),
          `Profile ${index + 1}`,
        ),
      ),
    );
    await readSelectedKey();
    state.original = clone(state.profile);
    clearDirty();
    log("Connected", {
      boardId: info.boardIdHex,
      firmware: info.firmware,
      protocol,
      lightingAreas,
      doubleLighting: Boolean(doubleLighting),
      automatic: Boolean(targetDevice),
    });
    openWorkspace();
    showToast(`AE64 Pro connected · firmware ${info.firmware}`);
  } catch (error) {
    log("Connection failed", error.message);
    if (state.transport) await state.transport.close().catch(() => undefined);
    state.transport = null;
    if (targetDevice === state.knownDevice) state.knownDevice = null;
    showToast(`Could not connect: ${error.message}`, true);
    renderStatus();
  } finally {
    hideProgress();
  }
}
async function detectKnownKeyboard() {
  if (
    !AE64HidTransport.supported() ||
    typeof navigator.hid.getDevices !== "function"
  )
    return;
  try {
    state.knownDevice =
      (await navigator.hid.getDevices()).find(isAe64Device) || null;
    if (state.knownDevice) log("Authorized keyboard detected");
  } catch (error) {
    log("Keyboard detection failed", error.message);
  }
}
async function readSelectedKey() {
  if (!connected()) return;
  const key = selectedKey(),
    token = `${state.profile.layer}:${key.id}`;
  const [performance, keyRecord] = await Promise.all([
    state.transport.getPerformance(position(key)),
    state.transport.getKeyCode(position(key), state.profile.layer),
  ]);
  state.hardware.performance.set(key.id, performance);
  state.hardware.keycodes.set(token, keyRecord.keycode);
  if (!state.dirty.performance.has(key.id))
    state.profile.performance[key.id] = performance;
  if (!state.dirty.mapping.has(token))
    state.profile.keycodes[state.profile.layer][key.id] = keyRecord.keycode;
  log("Selected key read", {
    key: key.n,
    row: key.row,
    col: key.col,
    layer: state.profile.layer,
  });
}
function clearDirty() {
  state.dirty.performance.clear();
  state.dirty.mapping.clear();
  state.dirty.customLighting.clear();
  state.dirty.decorativeLighting.clear();
  state.dirty.settings.clear();
  state.dirty.lightingBase = false;
  state.dirty.lightingPalette = false;
  state.dirty.decorativeBase = false;
  state.dirty.decorativePalette = false;
}
function verifyPerformance(expected, actual) {
  return [
    "mode",
    "normalPress",
    "normalRelease",
    "rtFirstTouch",
    "rtPress",
    "rtRelease",
    "pressDeadStroke",
    "releaseDeadStroke",
  ].every((field) =>
    field === "mode"
      ? Number(expected[field]) === Number(actual[field])
      : closeEnough(expected[field], actual[field]),
  );
}
function verifyLightingBase(expected, actual) {
  const expectedOpenMode = expected.open
    ? Number(expected.openMode || LIGHTING_OPEN_MODE.LOWER)
    : LIGHTING_OPEN_MODE.OFF;
  return (
    Number(actual.openMode) === expectedOpenMode &&
    ["mode", "brightness", "speed", "direction", "paletteIndex"].every(
      (field) => Number(actual[field]) === Number(expected[field]),
    )
  );
}

function summarizeChanges() {
  const changes = [],
    names = (ids) => {
      const labels = [...ids]
        .map((id) => keys[Number(String(id).split(":").at(-1))]?.n)
        .filter(Boolean);
      return labels.length <= 5
        ? labels.join(", ")
        : `${labels.slice(0, 5).join(", ")} +${labels.length - 5} more`;
    };
  if (state.dirty.performance.size)
    changes.push(
      `Performance settings: ${state.dirty.performance.size} key${state.dirty.performance.size === 1 ? "" : "s"} (${names(state.dirty.performance)})`,
    );
  if (state.dirty.mapping.size)
    changes.push(
      `Key assignments: ${state.dirty.mapping.size} mapping${state.dirty.mapping.size === 1 ? "" : "s"} (${names(state.dirty.mapping)})`,
    );
  if (state.dirty.lightingBase) {
    const base = state.profile.lighting.base,
      reported = lightingModeCount(0, AE64_MAIN_MODE_COUNT),
      experimental = Number(base.mode) >= reported ? " · experimental" : "";
    changes.push(
      `Main RGB: L${Number(base.mode) + 1}${experimental}, ${base.brightness}% brightness, ${base.speed}% speed, north ${Number(base.openMode) & LIGHTING_OPEN_MODE.UPPER ? "on" : "off"}, south ${Number(base.openMode) & LIGHTING_OPEN_MODE.LOWER ? "on" : "off"}`,
    );
  }
  if (state.dirty.lightingPalette)
    changes.push("Main RGB: eight-color palette");
  if (state.dirty.customLighting.size)
    changes.push(
      `Per-key RGB: ${state.dirty.customLighting.size} LED override${state.dirty.customLighting.size === 1 ? "" : "s"}`,
    );
  if (state.dirty.decorativeBase) {
    const base = state.profile.lighting.decorative.base;
    changes.push(
      `Decorative1: L${Number(base.mode) + 1}, ${base.brightness}% brightness, ${base.speed}% speed`,
    );
  }
  if (state.dirty.decorativePalette)
    changes.push("Decorative1: eight-color palette");
  if (state.dirty.decorativeLighting.size)
    changes.push(
      `Decorative1: ${state.dirty.decorativeLighting.size} perimeter LED override${state.dirty.decorativeLighting.size === 1 ? "" : "s"}`,
    );
  for (const field of state.dirty.settings) {
    const value = state.profile.settings[field];
    if (field === "systemMode")
      changes.push(
        `System mode: ${SYSTEM_MODE_OPTIONS.find((option) => option.value === Number(value))?.label || `value ${value}`}`,
      );
    if (field === "reportRate")
      changes.push(
        `Polling rate: ${(POLLING_RATE_OPTIONS.find((option) => option.value === Number(value))?.hz || value).toLocaleString()} Hz`,
      );
    if (field === "sleepTime")
      changes.push(
        `RGB sleep: ${value} minute${Number(value) === 1 ? "" : "s"}`,
      );
    if (field === "shake")
      changes.push(`Shake optimization: ${value ? "on" : "off"}`);
  }
  return changes;
}
function openDialog(dialog) {
  if (typeof dialog?.showModal === "function") dialog.showModal();
  else dialog?.setAttribute?.("open", "");
}
function closeDialog(dialog) {
  if (typeof dialog?.close === "function") dialog.close();
  else dialog?.removeAttribute?.("open");
}
function requestApplyChanges() {
  if (!dirtyCount()) return;
  if (!connected())
    return showToast(
      "Connect the AE64 Pro before applying changes. Staged changes have not been cleared.",
      true,
    );
  const dialog = document.querySelector("#applyReviewDialog"),
    list = document.querySelector("#applyReviewList");
  list.innerHTML = summarizeChanges()
    .map((change) => `<li>${esc(change)}</li>`)
    .join("");
  openDialog(dialog);
}

async function applyChanges() {
  if (!dirtyCount()) return;
  if (!connected())
    return showToast(
      "The keyboard disconnected before writing. Staged changes are still available.",
      true,
    );
  stopPolling();
  showProgress(
    "Applying staged changes",
    "Reading existing records and preserving firmware-owned fields.",
  );
  try {
    const performanceIds = [...state.dirty.performance];
    for (let index = 0; index < performanceIds.length; index += 1) {
      const id = performanceIds[index],
        key = keys[id];
      document.querySelector("#progressDetail").textContent =
        `Performance ${index + 1} of ${performanceIds.length}: ${key.n}`;
      const current =
        state.hardware.performance.get(id) ||
        (await state.transport.getPerformance(position(key)));
      const desired = {
        ...current,
        ...state.profile.performance[id],
        axis: current.axis,
        calibrate: current.calibrate,
        axisV2Id: current.axisV2Id,
        axisRangeMax: current.axisRangeMax,
        axisCoefficient: current.axisCoefficient,
      };
      await state.transport.setPerformance(position(key), desired);
      const verified = await state.transport.getPerformance(position(key));
      if (!verifyPerformance(desired, verified))
        throw new Error(`Performance verification failed for ${key.n}.`);
      state.profile.performance[id] = verified;
      state.hardware.performance.set(id, verified);
    }
    if (performanceIds.length)
      await state.transport.saveParameters(SAVE_GROUP.PERFORMANCE);
    const mappingTokens = [...state.dirty.mapping];
    for (let index = 0; index < mappingTokens.length; index += 1) {
      const [layer, id] = mappingTokens[index].split(":").map(Number),
        key = keys[id],
        expected = state.profile.keycodes[layer][id];
      document.querySelector("#progressDetail").textContent =
        `Key mapping ${index + 1} of ${mappingTokens.length}: ${key.n}`;
      await state.transport.setKeyCode(position(key), expected, layer);
      const verified = await state.transport.getKeyCode(position(key), layer);
      if (verified.keycode !== expected)
        throw new Error(`Mapping verification failed for ${key.n}.`);
      state.hardware.keycodes.set(`${layer}:${id}`, expected);
    }
    if (mappingTokens.length)
      await state.transport.saveParameters(SAVE_GROUP.LAYOUT);
    if (state.dirty.lightingBase || state.dirty.lightingPalette) {
      if (state.dirty.lightingBase) {
        await state.transport.setLightingBase(state.profile.lighting.base, 0);
        const verified = await state.transport.getLightingBase(0);
        if (!verifyLightingBase(state.profile.lighting.base, verified)) {
          const expectedMode = Number(state.profile.lighting.base.mode),
            reported = lightingModeCount(0, AE64_MAIN_MODE_COUNT);
          if (
            expectedMode >= reported &&
            Number(verified.mode) !== expectedMode
          )
            throw new Error(
              `Firmware rejected experimental L${expectedMode + 1}; it read back L${Number(verified.mode) + 1}.`,
            );
          throw new Error("Main lighting read-back verification failed.");
        }
        state.profile.lighting.base = {
          ...state.profile.lighting.base,
          ...verified,
        };
      }
      if (state.dirty.lightingPalette)
        await state.transport.setLightingPalette(
          state.profile.lighting.palette.map(hexToRgb),
          0,
        );
      await state.transport.saveParameters(SAVE_GROUP.LIGHTING);
    }
    if (state.dirty.customLighting.size) {
      if (!state.hardware.customMatrix)
        state.hardware.customMatrix = await state.transport.readCustomLighting(
          MATRIX_ROWS,
          MATRIX_COLS,
          0,
        );
      for (const id of state.dirty.customLighting) {
        const key = keys[id],
          color = hexToRgb(state.profile.lighting.perKey[id]);
        color.custom = Boolean(state.profile.lighting.customEnabled[id]);
        state.hardware.customMatrix[key.row * MATRIX_COLS + key.col] = color;
      }
      await state.transport.writeCustomLighting(
        state.hardware.customMatrix,
        MATRIX_ROWS,
        MATRIX_COLS,
        0,
      );
      await state.transport.saveParameters(SAVE_GROUP.LIGHTING);
      const id = [...state.dirty.customLighting][0],
        key = keys[id],
        matrixIndex = key.row * MATRIX_COLS + key.col,
        packet = await state.transport.getCustomLightingPacket(
          Math.floor(matrixIndex / 15),
          0,
        ),
        verified = packet[matrixIndex % 15];
      if (
        rgbToHex(verified) !==
          state.profile.lighting.perKey[id].toLowerCase() ||
        Boolean(verified.custom) !==
          Boolean(state.profile.lighting.customEnabled[id])
      )
        throw new Error(`Custom lighting verification failed for ${key.n}.`);
    }
    if (state.dirty.decorativeBase || state.dirty.decorativePalette) {
      const decorative = state.profile.lighting.decorative;
      if (state.dirty.decorativeBase) {
        await state.transport.setLightingBase(decorative.base, 1);
        const verified = await state.transport.getLightingBase(1);
        if (!verifyLightingBase(decorative.base, verified))
          throw new Error("Decorative1 base read-back verification failed.");
        decorative.base = { ...decorative.base, ...verified };
      }
      if (state.dirty.decorativePalette)
        await state.transport.setLightingPalette(
          decorative.palette.map(hexToRgb),
          1,
        );
      await state.transport.saveParameters(SAVE_GROUP.LIGHTING);
    }
    if (state.dirty.decorativeLighting.size) {
      const decorative = state.profile.lighting.decorative;
      if (!state.hardware.decorativeMatrix)
        state.hardware.decorativeMatrix =
          await state.transport.readCustomLighting(
            DECORATIVE_ROWS,
            DECORATIVE_COLS,
            1,
          );
      for (const index of state.dirty.decorativeLighting) {
        const color = hexToRgb(decorative.perLed[index]);
        color.custom = Boolean(decorative.customEnabled[index]);
        state.hardware.decorativeMatrix[index] = color;
      }
      await state.transport.writeCustomLighting(
        state.hardware.decorativeMatrix,
        DECORATIVE_ROWS,
        DECORATIVE_COLS,
        1,
      );
      await state.transport.saveParameters(SAVE_GROUP.LIGHTING);
      const index = [...state.dirty.decorativeLighting][0],
        packet = await state.transport.getCustomLightingPacket(
          Math.floor(index / 15),
          1,
        ),
        verified = packet[index % 15];
      if (
        rgbToHex(verified) !== decorative.perLed[index].toLowerCase() ||
        Boolean(verified.custom) !== Boolean(decorative.customEnabled[index])
      )
        throw new Error(`Decorative1 verification failed for LED ${index}.`);
    }
    for (const field of state.dirty.settings) {
      if (field === "systemMode")
        await state.transport.setSystemMode(state.profile.settings[field]);
      if (field === "reportRate")
        await state.transport.setReportRate(state.profile.settings[field]);
      if (field === "sleepTime")
        await state.transport.setLightingSleepTime(
          state.profile.settings[field],
        );
      if (field === "shake")
        await state.transport.setShakeOptimization(
          state.profile.settings[field],
        );
    }
    state.original = clone(state.profile);
    clearDirty();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.profile));
    log("Staged changes applied and verified");
    render();
    showToast("Changes written, committed, and verified on the AE64 Pro.");
  } catch (error) {
    log("Apply failed", error.message);
    renderStatus();
    showToast(`Apply stopped: ${error.message}`, true);
  } finally {
    hideProgress();
    if (state.page === "lighting" && state.liveLighting && connected())
      startLightingLive();
  }
}

function revertChanges() {
  state.profile = clone(state.original);
  clearDirty();
  render();
  showToast("Staged changes reverted.");
}
async function switchProfile(index) {
  if (dirtyCount()) {
    showToast("Apply or revert changes before switching profiles.", true);
    renderToolbar();
    return;
  }
  if (connected()) {
    stopPolling();
    showProgress("Switching profile", `Loading profile ${index + 1}.`);
    try {
      await state.transport.switchConfig(index);
      state.profile.profileIndex = index;
      const [lightingBase, palette, decorativeBase, decorativePalette] =
        await Promise.all([
          state.transport.getLightingBase(0),
          state.transport.getLightingPalette(0),
          state.transport.getLightingBase(1),
          state.transport.getLightingPalette(1),
        ]);
      state.profile.lighting.base = {
        ...state.profile.lighting.base,
        ...lightingBase,
      };
      state.profile.lighting.palette = palette.map(rgbToHex);
      state.profile.lighting.decorative.base = {
        ...state.profile.lighting.decorative.base,
        ...decorativeBase,
      };
      state.profile.lighting.decorative.palette =
        decorativePalette.map(rgbToHex);
      keys.forEach((key) => {
        state.profile.lighting.customEnabled[key.id] = false;
      });
      state.profile.lighting.decorative.customEnabled.fill(false);
      Object.assign(state.hardware, {
        customMatrix: null,
        decorativeMatrix: null,
        liveMatrix: null,
        liveStrip: null,
      });
      await readSelectedKey();
      state.original = clone(state.profile);
      log("Profile switched", index);
      showToast(
        `Profile ${index + 1} loaded. Live RGB readback has restarted.`,
      );
    } catch (error) {
      showToast(error.message, true);
    } finally {
      hideProgress();
      render();
    }
  } else {
    state.profile.profileIndex = index;
    state.original = clone(state.profile);
    render();
  }
}
async function renameProfile(name) {
  name = String(name || "").trim();
  if (!name) {
    showToast("Profile name cannot be empty.", true);
    return false;
  }
  if (!connected()) {
    showToast("Connect to rename an onboard profile.", true);
    return false;
  }
  try {
    await state.transport.setConfigName(state.profile.profileIndex, name);
    const verified = await state.transport.getConfigName(
      state.profile.profileIndex,
    );
    state.hardware.configNames[state.profile.profileIndex] = verified;
    render();
    showToast(`Profile renamed to ${verified}.`);
    return true;
  } catch (error) {
    showToast(error.message, true);
    return false;
  }
}
async function saveProfileName() {
  return renameProfile(document.querySelector("#profileName").value);
}
function openProfileRename() {
  if (!connected())
    return showToast("Connect to rename an onboard profile.", true);
  const input = document.querySelector("#quickProfileName");
  input.value =
    state.hardware.configNames[state.profile.profileIndex] ||
    `Profile ${state.profile.profileIndex + 1}`;
  openDialog(document.querySelector("#profileRenameDialog"));
  input.focus();
}
async function loadCustomLighting() {
  if (!connected()) return showToast("Connect to read custom RGB.", true);
  stopPolling();
  showProgress("Reading custom lighting", "Loading all nine matrix packets.");
  try {
    state.hardware.customMatrix = await state.transport.readCustomLighting(
      MATRIX_ROWS,
      MATRIX_COLS,
      0,
    );
    keys.forEach((key) => {
      const record =
        state.hardware.customMatrix[key.row * MATRIX_COLS + key.col];
      state.profile.lighting.perKey[key.id] = rgbToHex(record);
      state.profile.lighting.customEnabled[key.id] = Boolean(record.custom);
    });
    state.dirty.customLighting.clear();
    render();
    showToast("Custom lighting matrix and override flags loaded.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    hideProgress();
  }
}
async function loadDecorativeLighting() {
  if (!connected()) return showToast("Connect to read Decorative1 RGB.", true);
  stopPolling();
  showProgress("Reading Decorative1", "Loading all three strip packets.");
  try {
    state.hardware.decorativeMatrix = await state.transport.readCustomLighting(
      DECORATIVE_ROWS,
      DECORATIVE_COLS,
      1,
    );
    state.hardware.decorativeMatrix.forEach((record, index) => {
      state.profile.lighting.decorative.perLed[index] = rgbToHex(record);
      state.profile.lighting.decorative.customEnabled[index] = Boolean(
        record.custom,
      );
    });
    state.dirty.decorativeLighting.clear();
    render();
    showToast("Decorative1 matrix and override flags loaded.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    hideProgress();
  }
}
async function readAdvanced() {
  if (!connected())
    return showToast("Connect to read the advanced-key record.", true);
  try {
    state.hardware.advanced = await state.transport.getAdvancedKey(position());
    log("Advanced record read", state.hardware.advanced);
    render();
  } catch (error) {
    showToast(error.message, true);
  }
}
async function readMacroSpace() {
  if (!connected()) return showToast("Connect to read macro capacity.", true);
  try {
    state.hardware.macroSpace = await state.transport.getMacroSpaceInfo();
    log("Macro capacity read", state.hardware.macroSpace);
    render();
  } catch (error) {
    showToast(error.message, true);
  }
}
async function readLayoutStyle() {
  if (!connected()) return showToast("Connect to read layout metadata.", true);
  try {
    state.hardware.layoutStyle = await Promise.all(
      [1, 2, 3, 4, 5].map((row) => state.transport.getKeyLayoutStyle(row)),
    );
    log("Layout metadata read");
    render();
  } catch (error) {
    showToast(error.message, true);
  }
}
async function startCalibration() {
  if (!connected()) return showToast("Connect before calibration.", true);
  try {
    await state.transport.setCalibration(true);
    log("Calibration started");
    showToast("Calibration active. Press every key fully several times.");
    let cursor = 0;
    const cells = [...document.querySelectorAll(".calibration-grid i")];
    state.timers.calibration = setInterval(() => {
      cells
        .slice(0, (cursor += 2))
        .forEach((cell) => cell.classList.add("done"));
    }, 250);
  } catch (error) {
    showToast(error.message, true);
  }
}
async function stopCalibration() {
  if (state.timers.calibration) clearInterval(state.timers.calibration);
  state.timers.calibration = null;
  if (!connected()) return;
  try {
    await state.transport.setCalibration(false);
    await state.transport.saveParameters(SAVE_GROUP.CALIBRATION);
    log("Calibration stopped and saved");
    showToast("Calibration stopped and saved.");
  } catch (error) {
    showToast(error.message, true);
  }
}
async function startTravel() {
  if (!connected()) return showToast("Connect to read live travel.", true);
  stopPolling();
  const read = async () => {
    if (
      !connected() ||
      state.page !== "performance" ||
      state.performanceTab !== "travel"
    )
      return;
    try {
      const key = selectedKey(),
        data = await state.transport.getAxisData("route", key.row);
      state.hardware.travelValue = data.values[key.col] || 0;
      const valueNode = document.querySelector(".travel-meter .value"),
        meter = document.querySelector(".travel-meter");
      if (valueNode && meter) {
        const mm = Math.min(4, state.hardware.travelValue / 1000);
        valueNode.textContent = `${mm.toFixed(3)} mm`;
        meter.style.setProperty("--travel", `${Math.round((mm / 4) * 100)}%`);
      }
    } catch (error) {
      log("Travel poll stopped", error.message);
      showToast(error.message, true);
      return;
    }
    state.timers.travel = setTimeout(read, 120);
  };
  read();
}
function updateLiveKeyboard(matrix) {
  state.hardware.liveMatrix = matrix;
  state.hardware.liveUpdatedAt = Date.now();
  document.querySelectorAll(".lighting-preview [data-key]").forEach((node) => {
    const key = keys[Number(node.dataset.key)],
      record = key && matrix[key.row * MATRIX_COLS + key.col];
    if (record) node.style.setProperty("--key-color", rgbToHex(record));
  });
}
function updateLiveStrip(matrix) {
  state.hardware.liveStrip = matrix;
  state.hardware.liveUpdatedAt = Date.now();
  document.querySelectorAll("[data-strip-led]").forEach((node) => {
    const record = matrix[Number(node.dataset.stripLed)];
    if (record) {
      node.style.setProperty("--led-color", rgbToHex(record));
      node.title = `LED ${Number(node.dataset.stripLed)} · ${rgbToHex(record).toUpperCase()}`;
    }
  });
}
function updateLiveStatus(message, error = false) {
  const node = document.querySelector("#liveRgbStatus");
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("ready", !error);
  node.classList.toggle("experimental", error);
}
function stopLightingPolling() {
  if (state.timers.lighting) clearTimeout(state.timers.lighting);
  state.timers.lighting = null;
  state.timers.lightingGeneration += 1;
}
function startLightingLive() {
  stopLightingPolling();
  if (!connected() || state.page !== "lighting" || !state.liveLighting) return;
  const generation = state.timers.lightingGeneration;
  const read = async () => {
    if (
      generation !== state.timers.lightingGeneration ||
      !connected() ||
      state.page !== "lighting" ||
      !state.liveLighting
    )
      return;
    try {
      const keyboardMatrix = await state.transport.readLiveLighting(
        MATRIX_ROWS,
        MATRIX_COLS,
        0,
      );
      if (generation !== state.timers.lightingGeneration) return;
      updateLiveKeyboard(keyboardMatrix);
      const stripMatrix = await state.transport.readLiveLighting(
        DECORATIVE_ROWS,
        DECORATIVE_COLS,
        1,
      );
      if (generation !== state.timers.lightingGeneration) return;
      updateLiveStrip(stripMatrix);
      state.hardware.liveError = null;
      updateLiveStatus("LIVE · ≈10 FPS");
    } catch (error) {
      if (generation !== state.timers.lightingGeneration) return;
      if (state.hardware.liveError !== error.message)
        log("Live RGB read retrying", error.message);
      state.hardware.liveError = error.message;
      updateLiveStatus("LIVE · RETRYING", true);
    }
    state.timers.lighting = setTimeout(read, LIVE_RGB_INTERVAL);
  };
  read();
}
function stopPolling() {
  if (state.timers.travel) clearTimeout(state.timers.travel);
  state.timers.travel = null;
  stopLightingPolling();
}

function downloadJson(filename, value) {
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    ),
    link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
function exportProfile() {
  downloadJson("ae64-pro-profile.json", {
    format: "ae64-control-profile",
    version: 1,
    device: { vendorId: "1CA6", productId: "300A" },
    exportedAt: new Date().toISOString(),
    profile: state.profile,
  });
  showToast("Profile exported.");
}
function exportLog() {
  downloadJson("ae64-pro-session-log.json", {
    device: state.hardware.info,
    logs: state.hardware.logs,
  });
  showToast("Session log exported.");
}
async function importProfile(file) {
  try {
    const data = JSON.parse(await file.text()),
      imported = data.profile || data;
    if (!imported.performance || !imported.keycodes || !imported.lighting)
      throw new Error("Not an AE64 Control profile.");
    const base = defaultProfile();
    state.profile = {
      ...base,
      ...imported,
      schema: 4,
      performance: { ...base.performance, ...imported.performance },
      keycodes: Object.fromEntries(
        Array.from({ length: 4 }, (_, i) => [
          i,
          { ...base.keycodes[i], ...imported.keycodes?.[i] },
        ]),
      ),
      lighting: {
        ...base.lighting,
        ...imported.lighting,
        base: { ...base.lighting.base, ...imported.lighting.base },
        perKey: { ...base.lighting.perKey, ...imported.lighting.perKey },
        customEnabled: {
          ...base.lighting.customEnabled,
          ...imported.lighting.customEnabled,
        },
        decorative: mergeDecorative(
          base.lighting.decorative,
          imported.lighting.decorative,
        ),
      },
    };
    keys.forEach((key) => {
      state.dirty.performance.add(key.id);
      state.dirty.customLighting.add(key.id);
      for (let layer = 0; layer < 4; layer += 1)
        state.dirty.mapping.add(`${layer}:${key.id}`);
    });
    for (let index = 0; index < DECORATIVE_COLS; index += 1)
      state.dirty.decorativeLighting.add(index);
    state.dirty.lightingBase = true;
    state.dirty.lightingPalette = true;
    state.dirty.decorativeBase = true;
    state.dirty.decorativePalette = true;
    render();
    showToast("Profile imported and staged. Review before applying.");
  } catch (error) {
    showToast(`Import failed: ${error.message}`, true);
  }
}
function mountHero() {
  document.querySelector("#heroKeyboard").innerHTML = keyboardHtml({
    hero: true,
  });
}

document
  .querySelectorAll("#connectButton,#heroConnect")
  .forEach((button) =>
    button.addEventListener("click", () => connectKeyboard()),
  );
document.querySelector("#backHomeButton").addEventListener("click", returnHome);
document
  .querySelector("#applyButton")
  .addEventListener("click", requestApplyChanges);
document
  .querySelector("#revertButton")
  .addEventListener("click", revertChanges);
document.querySelector("#sideNav").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-page]");
  if (button) {
    state.page = button.dataset.page;
    render();
  }
});
document
  .querySelector("#quickProfileSelect")
  .addEventListener("change", (event) =>
    switchProfile(Number(event.target.value)),
  );
document
  .querySelector("#quickProfileRename")
  .addEventListener("click", openProfileRename);
document.querySelector("#confirmApplyButton").addEventListener("click", () => {
  closeDialog(document.querySelector("#applyReviewDialog"));
  applyChanges();
});
document
  .querySelector("#profileRenameForm")
  .addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    if (await renameProfile(document.querySelector("#quickProfileName").value))
      closeDialog(document.querySelector("#profileRenameDialog"));
  });
document
  .querySelector("#layerSelect")
  .addEventListener("change", async (event) => {
    state.profile.layer = Number(event.target.value);
    render();
    if (connected())
      try {
        await readSelectedKey();
        render();
      } catch (error) {
        showToast(error.message, true);
      }
  });
document
  .querySelectorAll(".language-select")
  .forEach((select) =>
    select.addEventListener("change", (event) =>
      setLanguage(event.target.value),
    ),
  );
document
  .querySelector("#profileFileInput")
  .addEventListener("change", (event) => {
    const [file] = event.target.files;
    if (file) importProfile(file);
    event.target.value = "";
  });
if (navigator.hid) {
  navigator.hid.addEventListener("disconnect", (event) => {
    if (event.device === state.knownDevice) state.knownDevice = null;
    if (event.device === state.transport?.device) {
      state.transport = null;
      stopPolling();
      log("Keyboard disconnected");
      renderStatus();
      showToast("AE64 Pro disconnected.", true);
    }
  });
  navigator.hid.addEventListener("connect", (event) => {
    if (isAe64Device(event.device)) {
      state.knownDevice = event.device;
      log("Authorized keyboard detected");
    }
  });
}
mountHero();
loadLanguages().finally(detectKnownKeyboard);
