"use strict";

/* Illustrative browser effects, not an emulation of the factory LED engine.
 * Pure sampling keeps previews deterministic; CSS owns animation/lifetime. */
(function (root) {
  const clamp = (value, low, high) => Math.max(low, Math.min(high, Number(value) || 0));
  const fract = (value) => value - Math.floor(value);
  const wave = (value) => (1 + Math.sin(value * Math.PI * 2)) / 2;
  const hash = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
  function hsv(hue) {
    const h = fract(hue) * 6, x = 1 - Math.abs(h % 2 - 1);
    return [[1,x,0],[x,1,0],[0,1,x],[0,x,1],[x,0,1],[1,0,x]][Math.floor(h)];
  }
  function source({ fn = false, draft = false, live = false, connected = false, hasFrame = false, mode = 0 } = {}) {
    if (fn) return { kind: "fn", approximate: false, draft: false };
    if (!draft && live && connected && hasFrame) return { kind: "live", approximate: false, draft: false };
    return { kind: mode >= 0 && mode < 20 ? "effect" : "unlisted", approximate: true, draft: Boolean(draft) };
  }
  function sample(setting, position, phase = 0) {
    const mode = Number(setting.mode), direction = Number(setting.direction) === 1,
      x = direction ? 1 - clamp(position.x, 0, 1) : clamp(position.x, 0, 1),
      y = clamp(position.y, 0, 1), t = direction ? -phase : phase,
      radius = Math.hypot(x - .5, (y - .5) * .7), seed = hash(Math.round(x * 28), Math.round(y * 8));
    if (!setting.open || mode < 0 || mode >= 20 || !Number.isInteger(mode)) return "#000000";
    let intensity = 1, hue = x * .78 + y * .12;
    switch (mode) {
      case 0: break; // Steady spatial spectrum / chosen color.
      case 1: intensity = .08 + .92 * wave(t); break;
      case 2: hue = t; intensity = .55 + .45 * wave(t * 2); break;
      case 3: hue = x - t; intensity = .45 + .55 * wave(x - t); break;
      case 4: hue = y - t; intensity = .25 + .75 * wave(y - t); break;
      case 5: hue = x + y * .5 - t; intensity = .2 + .8 * wave(x + y - t); break;
      case 6: intensity = Math.pow(wave(radius * 3 - t), 3); hue = radius * 2 - t; break;
      case 7: {
        const row = Math.min(4, Math.floor(y * 5)), path = (row + (row % 2 ? 1 - x : x)) / 5;
        intensity = Math.pow(wave(path - t), 12); hue = path - t; break;
      }
      case 8: intensity = Math.pow(wave(x - t), 8); break;
      case 9: intensity = Math.pow(wave(y - t * 2 + hash(Math.round(x * 28), 3)), 10); hue = .48 + seed * .2; break;
      case 10: intensity = Math.pow(wave(t + seed * 5), 18); hue = seed; break;
      case 11: intensity = .12 + .88 * wave(t + (Math.round(x * 14) + Math.round(y * 4)) % 2 / 2); break;
      case 12: intensity = Math.exp(-Math.pow((radius - fract(t) * .85) * 12, 2)); hue = radius * 1.5; break;
      case 13: intensity = Math.pow(wave(t + seed * 2), 6) * (.2 + .8 * seed); hue = .1 + seed * .3; break;
      case 14: intensity = Math.pow(fract(x - t), 3); hue = x * .4 - t; break;
      case 15: intensity = Math.pow(wave(Math.abs(x - .5) * 2 - t), 5); hue = Math.abs(x - .5) * 2; break;
      case 16: intensity = .15 + .85 * wave(x + y - t) * wave(x - y + t); hue = x - y * .5 + t; break;
      case 17: hue = Math.atan2(y - .5, x - .5) / (Math.PI * 2) + radius - t; intensity = .3 + .7 * wave(hue * 2); break;
      case 18: hue = Math.floor(fract(x - t) * 6) / 6; intensity = .3 + .7 * wave(y + t); break;
      case 19: intensity = .12 + .55 * wave(t) + .33 * Math.pow(wave(t * 2 + seed * 7), 24); hue = seed + t; break;
    }
    const palette = setting.palette || [], index = Number(setting.paletteIndex) || 0,
      chosen = /^#[0-9a-f]{6}$/i.test(palette[index] || "") ? palette[index] : "#73f0c0",
      rgb = index === 0 ? hsv(hue) : [1,3,5].map((offset) => parseInt(chosen.slice(offset, offset + 2), 16) / 255),
      brightness = clamp(setting.brightness, 0, 100) / 100;
    return "#" + rgb.map((channel) => Math.round(clamp(channel * intensity * brightness, 0, 1) * 255).toString(16).padStart(2, "0")).join("");
  }
  function style(setting, position) {
    const colors = Array.from({ length: 8 }, (_, index) => sample(setting, position, index / 8)),
      duration = 12 - clamp(setting.speed, 0, 100) * .11;
    return { color: colors[0], style: colors.map((color, index) => `--effect-${index}:${color}`).join(";") + `;--effect-duration:${duration.toFixed(2)}s` };
  }
  const api = Object.freeze({ sample, source, style });
  root.AE64LightingPreview = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window === "undefined" ? globalThis : window);

function lightingEffectPreviewSource() {
  return window.AE64LightingPreview.source({
    fn: isFnLightingTab(),
    draft: Boolean(state.dirty.lightingBase || state.dirty.lightingPalette),
    live: state.liveLighting, connected: connected(),
    hasFrame: Array.isArray(state.hardware.liveMatrix),
    mode: Number(state.profile.lighting.base.mode),
  });
}
function lightingEffectKeyPreview(key, custom, led = null) {
  const source = lightingEffectPreviewSource();
  if (custom || !source.approximate || source.kind === "unlisted") return null;
  const light = state.profile.lighting;
  return window.AE64LightingPreview.style({ ...light.base, palette: light.palette }, {
    x: Math.min(1, Math.max(0, Number(key.col) / 14 + (led === null ? 0 : (led - 2) * .025))),
    y: Number(key.uiRow) / 4,
  });
}
function lightingEffectPreviewLabel() {
  const source = lightingEffectPreviewSource();
  return source.kind === "live" ? "Live hardware RGB" : source.kind === "unlisted"
    ? "Unlisted effect · no simulation" : `${source.draft ? "Draft effect preview" : "Effect preview"} · approximate`;
}
function syncLightingEffectPreviewStatus() {
  const source = lightingEffectPreviewSource(), badge = document.querySelector("#lightingEffectPreviewStatus"),
    note = document.querySelector("#lightingEffectPreviewNote");
  if (badge) { badge.textContent = lightingEffectPreviewLabel(); badge.classList.toggle("ready", source.kind === "live"); }
  const liveStatus = document.querySelector("#liveRgbStatus");
  if (liveStatus && source.draft) liveStatus.textContent = "DRAFT · APPROXIMATE";
  if (note) note.textContent = source.kind === "live"
    ? "Colors read from the keyboard's effect buffer. Fn overlays may differ on the physical LEDs."
    : source.kind === "unlisted" ? "L21–L23 have no confirmed AE64 effect to simulate. Apply uses the existing hardware read-back checks."
    : `${source.draft ? "Shows your staged keyboard effect before Apply. " : "Live RGB is paused, unavailable, or awaiting its first frame. "}Animation is illustrative; reactive patterns are demonstrated automatically. Per-key overrides stay visible.`;
}
function refreshLightingEffectPreview() {
  if (!lightingEffectPreviewSource().approximate) return;
  document.querySelectorAll(".lighting-preview [data-key]").forEach((node) => {
    const key = keys[Number(node.dataset.key)];
    if (!key) return;
    const custom = Boolean(state.profile.lighting.customEnabled?.[key.id]), preview = lightingEffectKeyPreview(key, custom);
    const paint = (target, frame, colorProperty) => {
      if (!frame) { target.removeAttribute?.("data-effect-preview"); return; }
      target.setAttribute?.("data-effect-preview", "approximate");
      target.style.setProperty(colorProperty, frame.color);
      frame.style.split(";").forEach((item) => { const colon = item.indexOf(":"); target.style.setProperty(item.slice(0, colon), item.slice(colon + 1)); });
    };
    paint(node, preview, "--key-color");
    node.querySelectorAll("[data-spacebar-led-index]").forEach((dot, led) => paint(dot, lightingEffectKeyPreview(key, custom, led), "--space-led-color"));
  });
  syncLightingEffectPreviewStatus();
}
