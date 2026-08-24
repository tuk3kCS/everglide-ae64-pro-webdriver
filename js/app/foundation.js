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
