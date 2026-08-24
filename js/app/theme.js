"use strict";

/**
 * AE64 Pro Control — local appearance themes.
 *
 * The ATK Hub capture builds its light/dark appearance from shared surface,
 * text, border, and accent tokens. This small layer follows the same model so
 * every screen changes together without coupling appearance to device data.
 */

const THEME_KEY = "ae64-control-theme";
const THEME_OPTIONS = Object.freeze([
  Object.freeze({ value: "mint", label: "Mint", hint: "Original AE64 Control look", color: "#73f0c0", meta: "#07111d" }),
  Object.freeze({ value: "dark", label: "Dark", hint: "Neutral graphite and blue", color: "#8aa4ff", meta: "#090a0e" }),
  Object.freeze({ value: "light", label: "Light", hint: "Bright, cool workspace", color: "#167a62", meta: "#eef3f4" }),
]);

function normalizeTheme(value) {
  return THEME_OPTIONS.some((theme) => theme.value === value) ? value : "mint";
}
function applyTheme(value, { persist = false, announce = false } = {}) {
  const theme = normalizeTheme(value),
    option = THEME_OPTIONS.find((entry) => entry.value === theme);
  state.theme = theme;
  if (document.documentElement.dataset) document.documentElement.dataset.theme = theme;
  else document.documentElement.setAttribute?.("data-theme", theme);
  if (document.documentElement.style) document.documentElement.style.colorScheme = theme === "light" ? "light" : "dark";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = option.meta;
  if (persist) localStorage.setItem(THEME_KEY, theme);
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    const active = button.dataset.themeChoice === theme;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (announce) showToast(`${option.label} appearance enabled.`);
}
function setTheme(value) {
  applyTheme(value, { persist: true, announce: true });
}

state.theme = normalizeTheme(localStorage.getItem(THEME_KEY));
applyTheme(state.theme);
