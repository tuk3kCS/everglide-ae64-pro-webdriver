"use strict";

/** In-page per-key RGB editor. Kept separate from page composition. */
function rgbToHsv(color) {
  const red = Number(color.r) / 255, green = Number(color.g) / 255, blue = Number(color.b) / 255,
    max = Math.max(red, green, blue), min = Math.min(red, green, blue), delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return { h: hue, s: max ? delta / max : 0, v: max };
}

function hsvToHex(hue, saturation, value) {
  const h = ((Number(hue) % 360) + 360) % 360, s = clamp(saturation, 0, 1), v = clamp(value, 0, 1),
    chroma = v * s, x = chroma * (1 - Math.abs((h / 60) % 2 - 1)), offset = v - chroma;
  let channels = [0, 0, 0];
  if (h < 60) channels = [chroma, x, 0];
  else if (h < 120) channels = [x, chroma, 0];
  else if (h < 180) channels = [0, chroma, x];
  else if (h < 240) channels = [0, x, chroma];
  else if (h < 300) channels = [x, 0, chroma];
  else channels = [chroma, 0, x];
  return rgbToHex({ r: Math.round((channels[0] + offset) * 255), g: Math.round((channels[1] + offset) * 255), b: Math.round((channels[2] + offset) * 255) });
}

function colorChannelInputs(prefix, color, disabled = false) {
  const rgb = hexToRgb(color);
  return `<div class="color-channel-grid editable-color-channels" aria-label="RGB channels">${[["R", rgb.r], ["G", rgb.g], ["B", rgb.b]].map(([channel, value]) => `<label><b>${channel}</b><input id="${prefix}${channel}" type="number" inputmode="numeric" min="0" max="255" step="1" value="${value}" aria-label="${channel} channel, 0 to 255" data-keyboard-input="allow" ${disabled ? "disabled" : ""}></label>`).join("")}</div>`;
}

function updateColorChannelInputs(prefix, color) {
  const normalized = normalizeHex(color);
  if (!normalized) return;
  const rgb = hexToRgb(normalized);
  [["R", rgb.r], ["G", rgb.g], ["B", rgb.b]].forEach(([channel, value]) => {
    const input = document.querySelector(`#${prefix}${channel}`);
    if (input) input.value = String(value);
  });
}

function bindRgbColorInputs(prefix, onColor, currentColor) {
  const inputs = ["R", "G", "B"].map((channel) => document.querySelector(`#${prefix}${channel}`));
  if (inputs.some((input) => !input)) return;
  const apply = () => {
    const values = inputs.map((input) => Number(input.value)), valid = inputs.every((input, index) => input.value !== "" && Number.isInteger(values[index]) && values[index] >= 0 && values[index] <= 255);
    if (valid) return onColor(rgbToHex({ r: values[0], g: values[1], b: values[2] }));
    updateColorChannelInputs(prefix, currentColor());
    showToast("RGB channels must be whole numbers from 0 to 255.", true);
  };
  inputs.forEach((input) => {
    input.addEventListener("change", apply);
    input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); apply(); } });
  });
}

function perKeyColorPicker(color, disabled = false) {
  const rgb = hexToRgb(color), hsv = rgbToHsv(rgb), presets = ["#ff3b30", "#ff9500", "#ffd60a", "#34c759", "#00c7be", "#32ade6", "#5856d6", "#af52de", "#ff2d55", "#ffffff"];
  return `<div class="custom-color-picker ${disabled ? "disabled" : ""}" id="perKeyColorPicker" style="--picker-color:${esc(color)};--picker-hue:${hsv.h.toFixed(1)}"><div class="custom-color-stage"><div class="custom-color-sv" id="keyColorSurface" role="slider" tabindex="${disabled ? "-1" : "0"}" aria-label="Color saturation and brightness" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(hsv.v * 100)}" style="--picker-s:${(hsv.s * 100).toFixed(2)}%;--picker-v:${(hsv.v * 100).toFixed(2)}%"><i aria-hidden="true"></i></div><label class="custom-hue-row"><span>Hue</span><input id="keyColorHue" type="range" min="0" max="360" step="1" value="${Math.round(hsv.h)}" ${disabled ? "disabled" : ""}></label></div><div class="custom-color-details"><div class="custom-color-swatch" aria-hidden="true"></div><label class="field"><span>HEX</span><input id="keyColorHex" type="text" maxlength="7" pattern="#[0-9A-Fa-f]{6}" value="${esc(color.toUpperCase())}" data-keyboard-input="allow" ${disabled ? "disabled" : ""}></label>${colorChannelInputs("keyColor", color, disabled)}<div class="preset-color-row key-color-presets" aria-label="Per-key color presets">${presets.map((preset) => `<button type="button" data-key-color-preset="${preset}" style="--preset:${preset}" title="Set ${preset}" ${disabled ? "disabled" : ""}></button>`).join("")}</div><small>Drag in the color field or type a HEX/RGB value. Selected keys update in the keyboard preview immediately.</small></div></div>`;
}

function updatePerKeyColorPicker(color) {
  const normalized = normalizeHex(color);
  if (!normalized) return;
  const rgb = hexToRgb(normalized), hsv = rgbToHsv(rgb), picker = document.querySelector("#perKeyColorPicker"),
    surface = document.querySelector("#keyColorSurface"), hue = document.querySelector("#keyColorHue"), hex = document.querySelector("#keyColorHex");
  picker?.style.setProperty("--picker-color", normalized);
  picker?.style.setProperty("--picker-hue", hsv.h.toFixed(1));
  surface?.style.setProperty("--picker-s", `${(hsv.s * 100).toFixed(2)}%`);
  surface?.style.setProperty("--picker-v", `${(hsv.v * 100).toFixed(2)}%`);
  surface?.setAttribute("aria-valuenow", String(Math.round(hsv.v * 100)));
  if (hue) hue.value = String(Math.round(hsv.h));
  if (hex) hex.value = normalized.toUpperCase();
  updateColorChannelInputs("keyColor", normalized);
  const meta = document.querySelector(".per-key-color-meta b");
  if (meta) meta.textContent = normalized.toUpperCase();
}

function stagePerKeyPreviewColor(value) {
  const color = normalizeHex(value);
  if (!color) return false;
  const lighting = state.profile.lighting, ids = lightingKeyIds();
  if (!ids.length) return false;
  for (const id of ids) {
    lighting.perKey[id] = color;
    lighting.customEnabled[id] = true;
    state.dirty.customLighting.add(id);
  }
  const enabled = document.querySelector("#keyCustomEnabled");
  if (enabled) enabled.checked = true;
  document.querySelectorAll(".unified-lighting-preview [data-key]").forEach((node) => {
    if (!state.lightingSelectedKeys.has(Number(node.dataset.key))) return;
    node.style.setProperty("--key-color", color);
    node.classList.add("custom-light", "dirty");
    node.querySelector(".color-dot")?.classList.add("custom");
    node.querySelectorAll("[data-spacebar-led-index]").forEach((dot) => dot.style.setProperty("--space-led-color", color));
  });
  updatePerKeyColorPicker(color);
  renderStatus();
  return true;
}

function bindPerKeyColorPicker() {
  const surface = document.querySelector("#keyColorSurface"), hue = document.querySelector("#keyColorHue"), hex = document.querySelector("#keyColorHex");
  if (!surface || surface.getAttribute?.("tabindex") === "-1") return;
  const colorAtPointer = (event) => {
    const bounds = surface.getBoundingClientRect(), saturation = clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 1),
      value = 1 - clamp((event.clientY - bounds.top) / Math.max(1, bounds.height), 0, 1);
    stagePerKeyPreviewColor(hsvToHex(Number(hue?.value || 0), saturation, value));
  };
  surface.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    surface.setPointerCapture?.(event.pointerId);
    colorAtPointer(event);
  });
  surface.addEventListener("pointermove", (event) => {
    if (surface.hasPointerCapture?.(event.pointerId)) colorAtPointer(event);
  });
  surface.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const anchor = lightingAnchorKey(), current = rgbToHsv(hexToRgb(state.profile.lighting.perKey[anchor.id] || "#73f0c0")), step = event.shiftKey ? 0.05 : 0.01,
      saturation = clamp(current.s + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0), 0, 1),
      value = clamp(current.v + (event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0), 0, 1);
    stagePerKeyPreviewColor(hsvToHex(current.h, saturation, value));
  });
  hue?.addEventListener("input", (event) => {
    const anchor = lightingAnchorKey(), current = rgbToHsv(hexToRgb(state.profile.lighting.perKey[anchor.id] || "#73f0c0"));
    stagePerKeyPreviewColor(hsvToHex(event.target.value, current.s, current.v));
  });
  hex?.addEventListener("change", (event) => {
    if (!stagePerKeyPreviewColor(event.target.value)) {
      updatePerKeyColorPicker(state.profile.lighting.perKey[lightingAnchorKey().id] || "#73f0c0");
      showToast("Use a six-digit HEX color, for example #73F0C0.", true);
    }
  });
  bindRgbColorInputs("keyColor", stagePerKeyPreviewColor, () => state.profile.lighting.perKey[lightingAnchorKey().id] || "#73f0c0");
  document.querySelectorAll("[data-key-color-preset]").forEach((button) => button.addEventListener("click", () => stagePerKeyPreviewColor(button.dataset.keyColorPreset)));
}

function stageStripPreviewColor(value) {
  const color = normalizeHex(value), ids = stripLedIds();
  if (!color || !ids.length) return false;
  const lighting = state.profile.lighting.decorative;
  for (const index of ids) {
    lighting.perLed[index] = color;
    lighting.customEnabled[index] = true;
    state.dirty.decorativeLighting.add(index);
  }
  document.querySelectorAll(".unified-lighting-preview [data-strip-led]").forEach((node) => {
    if (state.stripSelection.has(Number(node.dataset.stripLed))) node.style.setProperty("--led-color", color);
  });
  const native = document.querySelector("#stripColor"), hex = document.querySelector("#stripColorHex"), summary = document.querySelector(".strip-color-summary strong");
  if (native) native.value = color;
  if (hex) hex.value = color.toUpperCase();
  if (summary) summary.textContent = color.toUpperCase();
  updateColorChannelInputs("stripColorChannel", color);
  renderStatus();
  return true;
}

function bindStripColorInputs() {
  const current = () => state.profile.lighting.decorative.perLed[state.stripSelected] || "#73f0c0", reject = () => {
    const color = current(), hex = document.querySelector("#stripColorHex");
    if (hex) hex.value = color.toUpperCase();
    showToast("Use a six-digit HEX color, for example #73F0C0.", true);
  };
  document.querySelector("#stripColor")?.addEventListener("input", (event) => stageStripPreviewColor(event.target.value));
  document.querySelector("#stripColorHex")?.addEventListener("change", (event) => { if (!stageStripPreviewColor(event.target.value)) reject(); });
  bindRgbColorInputs("stripColorChannel", stageStripPreviewColor, current);
}
