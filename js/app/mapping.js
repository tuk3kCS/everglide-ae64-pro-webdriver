"use strict";

// Combination mappings are a HID modifier bitmask in the high byte plus one
// standard keyboard trigger usage in the low byte, as used by the original
// driver's Associated Key / Trigger Key editor. The lower four modifier bits
// are exposed by the original AE64 UI; the upper four are the standard HID
// right-side modifiers and match the independently verified HE30 mapping form.
const COMBINATION_MODIFIERS = Object.freeze([
  { label: "Left Ctrl", short: "L Ctrl", value: 0x01, captured: true },
  { label: "Left Shift", short: "L Shift", value: 0x02, captured: true },
  { label: "Left Alt", short: "L Alt", value: 0x04, captured: true },
  { label: "Left GUI", short: "L GUI", value: 0x08, captured: true },
  { label: "Right Ctrl", short: "R Ctrl", value: 0x10, captured: false },
  { label: "Right Shift", short: "R Shift", value: 0x20, captured: false },
  { label: "Right Alt", short: "R Alt", value: 0x40, captured: false },
  { label: "Right GUI", short: "R GUI", value: 0x80, captured: false },
]);
const COMBINATION_TRIGGER_KEYS = Object.freeze(
  KEYCODE_GROUPS.keyboard.filter(({ code }) => code >= 4 && code < 224),
);
// These are the groups with verified write behavior on the AE64 Pro. Other
// catalog entries remain available for decoding assignments read from hardware.
const KEYMAP_SELECTABLE_GROUPS = Object.freeze([
  "keyboard",
  "media",
  "mouse",
  "firmware",
  "lighting",
]);
const COMBINATION_LAYER_NAMES = Object.freeze(["Main", "Fn1", "Fn2", "Fn3"]);
state.mappingCombination = { modifiers: new Set([0x01]), trigger: 4 };
state.combinationDraft = {
  hostId: Number(state.profile.selected),
  layer: Number(state.profile.layer),
  modifiers: [0x01],
  trigger: 4,
};
state.selectedKeys = new Set([Number(state.profile.selected)]);
state.keySelectionDrag = null;
const selectedKeyIds = () => {
  const ids = [...state.selectedKeys].filter((id) => keys[id]);
  return ids.sort((a, b) => a - b);
};
function decodeCombinationKeycode(keycode, allowExtended = false) {
  const value = Number(keycode), modifiers = (value >>> 8) & 0xff, trigger = value & 0xff;
  if (!Number.isInteger(value) || value <= 0xff || !modifiers || (!allowExtended && modifiers & ~0x0f) || !COMBINATION_TRIGGER_KEYS.some((entry) => entry.code === trigger)) return null;
  return { modifiers: COMBINATION_MODIFIERS.filter(({ value: mask }) => modifiers & mask), trigger };
}
function combinationKeycode(modifiers, trigger) {
  const mask = [...modifiers].reduce((total, value) => total | (Number(value) & 0xff), 0);
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

function combinationLabel(modifiers, trigger) {
  const labels = COMBINATION_MODIFIERS
    .filter(({ value }) => modifiers.includes(value))
    .map(({ short }) => short);
  labels.push(KEYCODE_LABELS.get(Number(trigger)) || `HID ${Number(trigger)}`);
  return labels.join(" + ");
}

function combinationTokenKnown(token) {
  return Object.prototype.hasOwnProperty.call(
    state.profile.combinationBases || {},
    token,
  );
}
function combinationBaseToken(layer, id, profileIndex = state.profile.profileIndex) {
  return `${Number(profileIndex)}:${Number(layer)}:${Number(id)}`;
}

function combinationMappingLabel(key, layer) {
  const token = combinationBaseToken(layer, key.id),
    keycode = displayedKeycode(key, layer),
    decoded = decodeCombinationKeycode(keycode, combinationTokenKnown(token));
  return decoded
    ? combinationLabel(decoded.modifiers.map(({ value }) => value), decoded.trigger)
    : keycodeLabel(keycode);
}

function syncCombinationDraft(hostId, layer) {
  const host = keys[Number(hostId)] || selectedKey(),
    resolvedLayer = clamp(layer, 0, 3),
    token = combinationBaseToken(resolvedLayer, host.id),
    keycode = displayedKeycode(host, resolvedLayer),
    decoded = decodeCombinationKeycode(keycode, combinationTokenKnown(token)),
    basicTrigger = COMBINATION_TRIGGER_KEYS.some(({ code }) => code === Number(keycode))
      ? Number(keycode)
      : 4;
  state.combinationDraft = {
    hostId: host.id,
    layer: resolvedLayer,
    modifiers: decoded?.modifiers.map(({ value }) => value) || [0x01],
    trigger: decoded?.trigger || basicTrigger,
  };
}

function combinationHostKeyboardHtml() {
  const draft = state.combinationDraft;
  return `<div class="combination-host-board"><div class="keyboard combination-host-keyboard" aria-label="Choose the physical key that activates this combination">${layout.map((row, uiRow) => `<div class="keyboard-row">${row.map((_, col) => {
    const key = keys.find((candidate) => candidate.uiRow === uiRow && candidate.col === col),
      selected = Number(draft.hostId) === key.id;
    return `<button class="key combination-host-key ${selected ? "selected" : ""}" style="--u:${key.u}" type="button" data-combination-host="${key.id}" aria-pressed="${selected}" title="Use physical ${esc(key.n)} as the combination host"><span class="mapped">${esc(key.n)}</span><b>${esc(combinationMappingLabel(key, draft.layer))}</b></button>`;
  }).join("")}</div>`).join("")}</div></div>`;
}

function combinationEditor() {
  const draft = state.combinationDraft,
    host = keys[Number(draft.hostId)] || keys[0],
    modifiers = draft.modifiers.map(Number),
    summary = combinationLabel(modifiers, draft.trigger),
    hasExperimental = modifiers.some((value) => value > 0x08);
  return `<div class="combination-editor"><div class="panel-head"><div><span class="eyebrow">INLINE LAYER MAPPING</span><h2>Key combination</h2><p>Choose the layer and physical host key, then combine up to eight HID modifiers with one normal trigger key.</p></div><span class="badge ${hasExperimental ? "experimental" : "ready"}">${modifiers.length} MODIFIER${modifiers.length === 1 ? "" : "S"}</span></div><div class="combination-layer-tabs" role="tablist" aria-label="Combination layer">${COMBINATION_LAYER_NAMES.map((name, layer) => `<button type="button" role="tab" data-combination-layer="${layer}" class="${layer === Number(draft.layer) ? "active" : ""}" aria-selected="${layer === Number(draft.layer)}"><span>0${layer + 1}</span>${name}</button>`).join("")}</div><div class="combination-host-heading"><div><h3>Activation key</h3><p>Pressing this physical key emits the complete combination.</p></div><strong>${esc(host.n)} · ${esc(COMBINATION_LAYER_NAMES[draft.layer])}</strong></div>${combinationHostKeyboardHtml()}<div class="combination-builder"><section><div class="combination-section-heading"><div><h3>Modifier mask</h3><p>All selected modifier bits are sent together. Their click order here does not change firmware timing.</p></div><span>${modifiers.length}/8</span></div><div class="combination-modifier-grid">${COMBINATION_MODIFIERS.map((modifier) => {
    const selected = modifiers.includes(modifier.value);
    return `<button type="button" data-combination-modifier="${modifier.value}" class="${selected ? "selected" : ""} ${modifier.captured ? "captured" : "experimental"}" aria-pressed="${selected}"><i>${selected ? "✓" : "+"}</i><span><b>${esc(modifier.label)}</b><small>${modifier.captured ? "Original AE64 range" : "Extended HID bit"}</small></span></button>`;
  }).join("")}</div></section><section class="combination-trigger-panel"><label class="field"><span>Trigger key</span><select id="combinationTrigger">${COMBINATION_TRIGGER_KEYS.map((entry) => `<option value="${entry.code}" ${Number(draft.trigger) === entry.code ? "selected" : ""}>${esc(entry.label)}</option>`).join("")}</select><small>One standard keyboard usage can accompany the modifier byte.</small></label><div class="combination-output"><span>ONBOARD OUTPUT</span><strong>${esc(summary)}</strong><small>Modifier mask 0x${modifiers.reduce((mask, value) => mask | value, 0).toString(16).padStart(2, "0").toUpperCase()} · Trigger 0x${Number(draft.trigger).toString(16).padStart(2, "0").toUpperCase()}</small></div><div class="combination-timing-note"><b>Simultaneous, not sequenced</b><p>The keyboard holds this report while ${esc(host.n)} is held, then releases it when ${esc(host.n)} is released. Use a macro when events need delays.</p></div></section></div><div class="combination-footer"><p>${hasExperimental ? "Right-side modifier bits are standards-based and HE30-verified, but were hidden by the captured AE64 interface. Test the result before relying on it in games." : "The four left-side modifiers match the range exposed by the captured AE64 interface."}</p><button class="button primary" id="stageCombination" type="button" ${modifiers.length ? "" : "disabled"}>Stage combination</button></div></div>`;
}

function renderCombinationConfiguration() {
  const body = document.querySelector("#combinationConfigBody");
  if (!body) return;
  body.innerHTML = combinationEditor();
  bindCombinationConfiguration();
}

function openCombinationConfiguration() {
  syncCombinationDraft(selectedKey().id, state.profile.layer);
  renderCombinationConfiguration();
  openDialog(document.querySelector("#combinationConfigDialog"));
}

function selectCombinationHost(id) {
  syncCombinationDraft(Number(id), state.combinationDraft.layer);
  renderCombinationConfiguration();
}

function stageCombination() {
  const draft = state.combinationDraft,
    host = keys[Number(draft.hostId)],
    layer = clamp(draft.layer, 0, 3);
  if (!host) return showToast("Choose a valid physical host key.", true);
  let keycode;
  try {
    keycode = combinationKeycode(draft.modifiers, draft.trigger);
  } catch (error) {
    return showToast(error.message, true);
  }
  const token = `${layer}:${host.id}`,
    baseToken = combinationBaseToken(layer, host.id),
    previous = displayedKeycode(host, layer);
  if (!decodeCombinationKeycode(previous, combinationTokenKnown(baseToken)))
    state.profile.combinationBases[baseToken] = previous;
  state.profile.keycodes[layer][host.id] = keycode;
  state.dirty.mapping.add(token);
  state.profile.layer = layer;
  state.profile.selected = host.id;
  state.selectedKeys = new Set([host.id]);
  closeDialog(document.querySelector("#combinationConfigDialog"));
  render();
  showToast(`${combinationLabel(draft.modifiers, draft.trigger)} staged on ${COMBINATION_LAYER_NAMES[layer]} ${host.n}.`);
}

function removeCombinationAssignment(value) {
  const [layerValue, idValue] = String(value).split(":"),
    layer = clamp(layerValue, 0, 3),
    host = keys[Number(idValue)];
  const token = `${layer}:${host?.id}`,
    baseToken = combinationBaseToken(layer, host?.id);
  if (!host || !decodeCombinationKeycode(displayedKeycode(host, layer), combinationTokenKnown(baseToken))) return;
  if (state.dirty.mapping.has(token)) {
    const original = Number(state.original?.keycodes?.[layer]?.[host.id]),
      originalBase = state.original?.combinationBases?.[baseToken];
    state.profile.keycodes[layer][host.id] = Number.isInteger(original)
      ? original
      : defaultKeycode(host);
    if (originalBase === undefined) delete state.profile.combinationBases[baseToken];
    else state.profile.combinationBases[baseToken] = originalBase;
    state.dirty.mapping.delete(token);
    render();
    showToast(`Staged combination discarded for ${COMBINATION_LAYER_NAMES[layer]} ${host.n}.`);
    return;
  }
  const fallback = Number(state.profile.combinationBases[baseToken]);
  state.profile.keycodes[layer][host.id] = Number.isInteger(fallback)
    ? fallback
    : defaultKeycode(host);
  delete state.profile.combinationBases[baseToken];
  state.dirty.mapping.add(token);
  state.profile.layer = layer;
  state.profile.selected = host.id;
  state.selectedKeys = new Set([host.id]);
  render();
  showToast(`Combination removal staged for ${COMBINATION_LAYER_NAMES[layer]} ${host.n}.`);
}

function bindCombinationConfiguration() {
  document.querySelectorAll("[data-combination-layer]").forEach((button) =>
    button.addEventListener("click", () => {
      syncCombinationDraft(state.combinationDraft.hostId, Number(button.dataset.combinationLayer));
      renderCombinationConfiguration();
    }),
  );
  document.querySelectorAll("[data-combination-host]").forEach((button) =>
    button.addEventListener("click", () => selectCombinationHost(button.dataset.combinationHost)),
  );
  document.querySelectorAll("[data-combination-modifier]").forEach((button) =>
    button.addEventListener("click", () => {
      const value = Number(button.dataset.combinationModifier),
        selected = new Set(state.combinationDraft.modifiers.map(Number));
      if (selected.has(value)) selected.delete(value); else selected.add(value);
      state.combinationDraft.modifiers = COMBINATION_MODIFIERS
        .map((modifier) => modifier.value)
        .filter((modifier) => selected.has(modifier));
      renderCombinationConfiguration();
    }),
  );
  document.querySelector("#combinationTrigger")?.addEventListener("change", (event) => {
    state.combinationDraft.trigger = Number(event.target.value);
    renderCombinationConfiguration();
  });
  document.querySelector("#stageCombination")?.addEventListener("click", stageCombination);
}

function combinationAssignmentEntries() {
  const feature = ADVANCED_FEATURES.find((item) => item.code === "COMBO"),
    entries = [];
  for (let layer = 0; layer < 4; layer += 1) {
    keys.forEach((key) => {
      const token = `${layer}:${key.id}`,
        baseToken = combinationBaseToken(layer, key.id),
        keycode = displayedKeycode(key, layer),
        combination = decodeCombinationKeycode(keycode, combinationTokenKnown(baseToken));
      if (!combination) return;
      entries.push({
        feature,
        ids: [key.id],
        keys: [key],
        layer,
        details: `${COMBINATION_LAYER_NAMES[layer]} · ${combinationLabel(combination.modifiers.map(({ value }) => value), combination.trigger)}`,
        staged: state.dirty.mapping.has(token),
        removing: false,
        combination: true,
      });
    });
  }
  return entries;
}

function combinationFeatureInfo() {
  return {
    title: "Key Combination",
    body: `<div class="feature-info-lead"><p>A key combination replaces one host key on one layer with a standard HID keyboard report: one eight-bit modifier mask plus one normal trigger usage. It consumes a layer-mapping entry, not an AE64 higher-key or macro slot.</p><ul><li>Choose the layer and physical host key.</li><li>Select one to eight left/right modifiers.</li><li>Choose one normal trigger key, then stage and apply.</li></ul></div><div class="combination-tutorial"><section><span>01</span><div><b>Pick the host</b><p>The host is the physical key you press. A combination can be different on Main, Fn1, Fn2, and Fn3.</p></div></section><section><span>02</span><div><b>Build the report</b><p>Ctrl, Shift, Alt, and GUI each have left and right bits. The original AE64 UI exposed the first four; right-side bits are an experimental extension supported by the same byte layout.</p></div></section><section><span>03</span><div><b>Understand timing</b><p>The modifier byte and trigger usage appear in the same report. There is no modifier order and no programmable delay. The report stays active for as long as the host key is held.</p></div></section><section><span>04</span><div><b>Test safely</b><p>Apply, then verify in a keyboard tester. Operating systems and games can intercept reserved shortcuts or treat left/right modifier variants identically.</p></div></section></div><div class="combination-report-diagram" aria-label="Combination report timing"><span>Host down</span><i></i><strong>Modifiers + trigger held together</strong><i></i><span>Host up</span></div>`,
  };
}
