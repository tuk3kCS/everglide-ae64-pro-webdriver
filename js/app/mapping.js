"use strict";

// Combination mappings are a HID modifier bitmask in the high byte plus one
// standard keyboard trigger usage in the low byte, as used by the original
// driver's Associated Key / Trigger Key editor.
const COMBINATION_MODIFIERS = Object.freeze([
  { label: "Ctrl", value: 0x01 },
  { label: "Shift", value: 0x02 },
  { label: "Alt", value: 0x04 },
  { label: "Win", value: 0x08 },
]);
const COMBINATION_TRIGGER_KEYS = Object.freeze(
  KEYCODE_GROUPS.keyboard.filter(({ code }) => code >= 4 && code < 224),
);
state.mappingCombination = { modifiers: new Set([0x01]), trigger: 4 };
state.selectedKeys = new Set([Number(state.profile.selected)]);
state.keySelectionDrag = null;
const selectedKeyIds = () => {
  const ids = [...state.selectedKeys].filter((id) => keys[id]);
  return ids.sort((a, b) => a - b);
};
function decodeCombinationKeycode(keycode) {
  const value = Number(keycode), modifiers = (value >>> 8) & 0xff, trigger = value & 0xff;
  if (!Number.isInteger(value) || value <= 0xff || !modifiers || modifiers & ~0x0f || !COMBINATION_TRIGGER_KEYS.some((entry) => entry.code === trigger)) return null;
  return { modifiers: COMBINATION_MODIFIERS.filter(({ value: mask }) => modifiers & mask), trigger };
}
function combinationKeycode(modifiers, trigger) {
  const mask = [...modifiers].reduce((total, value) => total | (Number(value) & 0x0f), 0);
  if (!mask) throw new Error("Select at least one modifier key.");
  if (!COMBINATION_TRIGGER_KEYS.some((entry) => entry.code === Number(trigger))) throw new Error("Select a standard keyboard trigger key.");
  return (mask << 8) | Number(trigger);
}
function keycodeLabel(keycode) {
  const combination = decodeCombinationKeycode(keycode);
  if (combination) return `${combination.modifiers.map(({ label }) => label).join(" + ")} + ${KEYCODE_LABELS.get(combination.trigger)}`;
  return KEYCODE_LABELS.get(Number(keycode)) || `Keycode 0x${Number(keycode).toString(16).padStart(4, "0")}`;
}
function syncCombinationEditor(keycode = displayedKeycode(selectedKey())) {
  const combination = decodeCombinationKeycode(keycode), basicTrigger = COMBINATION_TRIGGER_KEYS.some((entry) => entry.code === Number(keycode)) ? Number(keycode) : 4;
  state.mappingCombination.modifiers = new Set(combination?.modifiers.map(({ value }) => value) || [0x01]);
  state.mappingCombination.trigger = combination?.trigger || basicTrigger;
}
