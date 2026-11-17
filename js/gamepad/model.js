/* Original independent gamepad configuration model. SPDX-License-Identifier: MIT */
(function (root) {
  "use strict";
  const ROWS = [
    [["Esc"], ["1"], ["2"], ["3"], ["4"], ["5"], ["6"], ["7"], ["8"], ["9"], ["0"], ["-"], ["="], ["Backspace", 2]],
    [["Tab", 1.5], ["Q"], ["W"], ["E"], ["R"], ["T"], ["Y"], ["U"], ["I"], ["O"], ["P"], ["["], ["]"], ["\\", 1.5]],
    [["Caps", 1.75], ["A"], ["S"], ["D"], ["F"], ["G"], ["H"], ["J"], ["K"], ["L"], [";"], ["'"], ["Enter", 2.25]],
    [["Shift", 2], ["Z"], ["X"], ["C"], ["V"], ["B"], ["N"], ["M"], [","], ["."], ["/"], ["Shift"], ["↑"], ["Del"]],
    [["Ctrl", 1.25], ["Win", 1.25], ["Alt", 1.25], ["Space", 6.25], ["Alt"], ["Fn"], ["←"], ["↓"], ["→"]],
  ];
  let index = 0;
  const KEYS = ROWS.flatMap((row, uiRow) => row.map(([label, width = 1], col) => Object.freeze({ id: index++, label, width, uiRow, row: uiRow + 1, col })));
  const CONTROLS = Object.freeze([
    ["LT", "Left trigger", "trigger"], ["RT", "Right trigger", "trigger"],
    ["LX-", "Left stick · left", "stick"], ["LX+", "Left stick · right", "stick"], ["LY-", "Left stick · down", "stick"], ["LY+", "Left stick · up", "stick"],
    ["RX-", "Right stick · left", "stick"], ["RX+", "Right stick · right", "stick"], ["RY-", "Right stick · down", "stick"], ["RY+", "Right stick · up", "stick"],
    ["A", "A", "button"], ["B", "B", "button"], ["X", "X", "button"], ["Y", "Y", "button"],
    ["LB", "Left bumper", "button"], ["RB", "Right bumper", "button"], ["BACK", "Back / View", "button"], ["START", "Start / Menu", "button"],
    ["L3", "Left stick press", "button"], ["R3", "Right stick press", "button"],
    ["DPAD_UP", "D-pad · up", "button"], ["DPAD_DOWN", "D-pad · down", "button"], ["DPAD_LEFT", "D-pad · left", "button"], ["DPAD_RIGHT", "D-pad · right", "button"],
  ].map(([id, label, kind]) => Object.freeze({ id, label, kind })));
  const CONTROL = new Map(CONTROLS.map((entry) => [entry.id, entry]));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const um = (value) => Math.round(Number(value) * 1000);
  const CURVE_MAX = 255;
  const CURVE_PRESETS = Object.freeze([
    ["linear", "Linear", [[0, 20], [60, 60], [194, 195], [253, 255]]],
    ["aggro", "Aggro", [[0, 33], [63, 114], [139, 231], [253, 255]]],
    ["slow", "Slow", [[0, 23], [128, 63], [226, 145], [253, 255]]],
    ["smooth", "Smooth", [[0, 26], [78, 84], [199, 174], [253, 255]]],
    ["steep", "Steep", [[0, 26], [25, 132], [192, 135], [253, 255]]],
    ["instant", "Instant", [[0, 255], [2, 255], [192, 255], [255, 255]]],
    ["turbo", "Turbo", [[0, 255], [1, 255], [2, 255], [3, 255]]],
  ].map(([id, label, points]) => Object.freeze({ id, label, points: Object.freeze(points.map(Object.freeze)) })));
  const LEGACY_CURVES = {
    linear: [[0, 0], [85, 85], [170, 170], [255, 255]],
    smooth: [[0, 0], [85, 66], [170, 189], [255, 255]],
  };
  function curvePreset(points) {
    return CURVE_PRESETS.find((preset) => preset.points.every(([x, y], i) => points[i][0] === x && points[i][1] === y));
  }
  function validateCurve(points) {
    if (!Array.isArray(points) || points.length !== 4 || Array.from(points).some((point, i) =>
      !Array.isArray(point) || point.length !== 2 || Array.from(point).some((v) => !Number.isInteger(v) || v < 0 || v > CURVE_MAX) ||
      (i > 0 && (!points[i - 1] || point[0] <= points[i - 1][0]))))
      throw new Error("A curve needs four points with strictly increasing travel and output from 0 to 255.");
    return points.map(([x, y]) => [x, y]);
  }
  function defaultTravel(maxTravelMm = 4) {
    const max = um(maxTravelMm);
    if (!Number.isInteger(max) || max < 10 || max > 10000) throw new RangeError("Invalid switch travel limit.");
    const end = Math.min(3500, max);
    return { startMm: Math.min(500, end - 10) / 1000, endMm: end / 1000, maxTravelMm: max / 1000 };
  }
  function defaults(travelForKey = () => undefined) {
    const initial = { LT: 15, RT: 17, "LX-": 29, "LX+": 31, "LY-": 30, "LY+": 16 };
    return { schema: "ae64-gamepad", version: 2, name: "Analog essentials", mode: "controller", transport: "xinput",
      bindings: CONTROLS.map(({ id, kind }) => kind === "button" ? { control: id, key: null } :
        { control: id, key: initial[id] ?? null, ...defaultTravel(initial[id] === undefined ? undefined : travelForKey(initial[id])), curve: validateCurve(CURVE_PRESETS[0].points) }),
      sticks: [0, 1].map(() => ({ opposition: "difference", circular: true, deadzone: 0.05 })) };
  }
  function emptyProfile() {
    const config = defaults();
    config.name = "Custom gamepad";
    config.bindings.forEach((binding) => { binding.key = null; });
    return config;
  }
  function validate(config) {
    if (!config || config.schema !== "ae64-gamepad" || ![1, 2].includes(config.version)) throw new Error("Choose an AE64 Gamepad profile, version 1 or 2.");
    if (typeof config.name !== "string" || config.name.length < 1 || config.name.length > 64) throw new Error("Profile name must contain 1–64 characters.");
    if (!["off", "controller", "mixed"].includes(config.mode)) throw new Error("Choose a valid output mode.");
    if (!["xinput", "hid"].includes(config.transport)) throw new Error("Choose a valid controller connection.");
    if (!Array.isArray(config.bindings) || config.bindings.length !== CONTROLS.length) throw new Error("A profile must contain all 24 controller assignments.");
    const seen = new Set(), assigned = new Set();
    const bindings = config.bindings.map((b) => {
      if (!b || !CONTROL.has(b.control) || seen.has(b.control)) throw new Error("Controller assignments must be unique and known.");
      seen.add(b.control);
      if (b.key !== null && (!Number.isInteger(b.key) || b.key < 0 || b.key >= 64)) throw new Error("Choose a physical key from this keyboard.");
      if (b.key !== null && assigned.has(b.key)) throw new Error("One physical key can have one controller assignment in this profile.");
      if (b.key !== null) assigned.add(b.key);
      if (CONTROL.get(b.control).kind === "button") return { control: b.control, key: b.key };
      if (![b.startMm, b.endMm, b.maxTravelMm].every((v) => typeof v === "number" && Number.isFinite(v))) throw new Error("Travel settings must be finite numbers.");
      const start = um(b.startMm), end = um(b.endMm), max = um(b.maxTravelMm);
      if (max < 10 || max > 10000) throw new Error("Switch travel must be between 0.01 and 10.00 mm.");
      if (start < 0 || start >= end || end > max) throw new Error(`${b.control}: start must be below full output, inside the switch's travel.`);
      const curve = validateCurve(config.version === 1 && Object.hasOwn(LEGACY_CURVES, b.curve) ? LEGACY_CURVES[b.curve] : b.curve);
      return { control: b.control, key: b.key, startMm: start / 1000, endMm: end / 1000, maxTravelMm: max / 1000, curve };
    });
    if (!Array.isArray(config.sticks) || config.sticks.length !== 2) throw new Error("Both stick settings are required.");
    const sticks = config.sticks.map((s) => {
      if (!s || !["difference", "neutral", "deeper"].includes(s.opposition) || typeof s.circular !== "boolean" || typeof s.deadzone !== "number" || !Number.isFinite(s.deadzone) || s.deadzone < 0 || s.deadzone >= 0.95) throw new Error("Choose valid stick opposition and dead-zone settings.");
      if (!s.circular && s.deadzone !== 0) throw new Error("Square sticks use zero radial dead zone.");
      const deadzone = Math.round(s.deadzone * 10000);
      if (deadzone >= 9500) throw new Error("Radial dead zone must remain below 95% after rounding.");
      return { opposition: s.opposition, circular: s.circular, deadzone: deadzone / 10000 };
    });
    return { schema: "ae64-gamepad", version: 2, name: config.name, mode: config.mode, transport: config.transport,
      bindings: CONTROLS.map(({ id }) => bindings.find((b) => b.control === id)), sticks };
  }
  function level(binding, travelMm) {
    if (binding.key === null || !binding.curve) return 0;
    const depth = um(travelMm), start = um(binding.startMm), end = um(binding.endMm);
    if (!Number.isFinite(depth)) return 0;
    if (depth <= start) return 0;
    const points = typeof binding.curve === "string" ? LEGACY_CURVES[binding.curve] : binding.curve;
    const value = Math.min(10000, Math.floor((depth - start) * 10000 / (end - start)));
    const scale = (v) => Math.round(v * 10000 / CURVE_MAX);
    if (value < scale(points[0][0])) return 0;
    for (let i = 1; i < 4; i += 1) {
      const [x, y] = points[i].map(scale), [px, py] = points[i - 1].map(scale);
      if (value <= x) return py + Math.trunc((value - px) * (y - py) / (x - px));
    }
    return scale(points[3][1]);
  }
  function evaluate(input, travelMm = [], pressed = []) {
    const config = validate(input), values = Object.fromEntries(config.bindings.map((b) => [b.control, level(b, travelMm[b.key] || 0)]));
    const out = { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, buttons: [], dpad: [], values };
    if (config.mode === "off") return out;
    function axis(negative, positive, policy) {
      const n = values[negative], p = values[positive];
      if (policy === "neutral" && n && p) return 0;
      return policy === "deeper" ? (p === n ? 0 : (p > n ? p : -n)) : p - n;
    }
    ["L", "R"].forEach((name, i) => {
      const s = config.sticks[i]; let x = axis(`${name}X-`, `${name}X+`, s.opposition), y = axis(`${name}Y-`, `${name}Y+`, s.opposition);
      if (s.circular) {
        const r = Math.ceil(Math.sqrt(x * x + y * y)), dead = Math.round(s.deadzone * 10000);
        if (r <= dead) x = y = 0;
        else { const magnitude = Math.floor((Math.min(r, 10000) - dead) * 10000 / (10000 - dead)); x = Math.trunc(x * magnitude / r); y = Math.trunc(y * magnitude / r); }
      }
      out[name.toLowerCase() + "x"] = x / 10000; out[name.toLowerCase() + "y"] = y / 10000;
    });
    out.lt = Math.floor(values.LT * 255 / 10000); out.rt = Math.floor(values.RT * 255 / 10000);
    for (const b of config.bindings) if (CONTROL.get(b.control).kind === "button" && b.key !== null && Boolean(pressed[b.key])) (b.control.startsWith("DPAD_") ? out.dpad : out.buttons).push(b.control);
    if (out.dpad.includes("DPAD_UP") && out.dpad.includes("DPAD_DOWN")) out.dpad = out.dpad.filter((d) => !["DPAD_UP", "DPAD_DOWN"].includes(d));
    if (out.dpad.includes("DPAD_LEFT") && out.dpad.includes("DPAD_RIGHT")) out.dpad = out.dpad.filter((d) => !["DPAD_LEFT", "DPAD_RIGHT"].includes(d));
    return out;
  }
  const api = Object.freeze({ ROWS, KEYS, CONTROLS, CONTROL, CURVE_MAX, CURVE_PRESETS, curvePreset, defaultTravel, defaults, emptyProfile, validate, level, evaluate, um, clamp });
  root.AE64GamepadModel = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
