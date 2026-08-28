"use strict";

/** Macro family 0x07 proof-of-concept editor and writer. */
const MACRO_PLAYBACK_MODES = Object.freeze([
  { value: 0, label: "Click repeat · re-click ignored" },
  { value: 1, label: "Click repeat · re-click restart" },
  { value: 2, label: "Click repeat · re-click stop now" },
  { value: 3, label: "Click repeat · stop after current" },
  { value: 4, label: "Hold repeat · release stop now" },
  { value: 5, label: "Hold repeat · release after current" },
]);
Object.assign(state, { macroDraft: null });
state.dirty.macro = false;

function macroKeycode(slot) { return 0xf500 + Math.round(clamp(slot, 0, 15)); }
function macroSlotFromKeycode(code) {
  const slot = Number(code) - 0xf500;
  return slot >= 0 && slot < 16 ? slot : null;
}
function macroActionKeyOptions(selected) {
  return KEYCODE_GROUPS.keyboard
    .filter(({ code }) => code > 1)
    .map(({ code, label }) => `<option value="${code}" ${Number(selected) === code ? "selected" : ""}>${esc(label)}</option>`)
    .join("");
}
function defaultMacroDraft(hostId = state.profile.selected) {
  const host = keys[Number(hostId)] || selectedKey(),
    slot = macroSlotFromKeycode(displayedKeycode(host, state.profile.layer)) ?? 0;
  return {
    feature: "MACRO",
    hostId: host.id,
    layer: Number(state.profile.layer) || 0,
    slot,
    mode: 0,
    repeatCount: 1,
    actions: [
      { pressed: true, keycode: 4, delay: 1 },
      { pressed: false, keycode: 4, delay: 25 },
    ],
  };
}
function macroDraftDetails(draft = state.macroDraft) {
  if (!draft) return "";
  return `Macro ${Number(draft.slot)} · ${Number(draft.actions?.length) || 0} event${Number(draft.actions?.length) === 1 ? "" : "s"} · ${MACRO_PLAYBACK_MODES.find((mode) => mode.value === Number(draft.mode))?.label || `mode ${draft.mode}`}`;
}
function macroAdvancedMeta(key) {
  const slot = macroSlotFromKeycode(displayedKeycode(key, state.profile.layer));
  if (slot === null) return null;
  return {
    feature: ADVANCED_FEATURES.find((item) => item.code === "MACRO"),
    staged: state.dirty.mapping.has(`${state.profile.layer}:${key.id}`) || Boolean(state.dirty.macro && state.macroDraft?.hostId === key.id),
    removing: false,
    partner: `Macro ${slot}`,
  };
}
function macroAssignmentEntries() {
  const feature = ADVANCED_FEATURES.find((item) => item.code === "MACRO"),
    entries = [];
  for (let layer = 0; layer < 4; layer += 1)
    keys.forEach((key) => {
      const slot = macroSlotFromKeycode(displayedKeycode(key, layer));
      if (slot === null) return;
      entries.push({
        feature,
        ids: [key.id],
        keys: [key],
        layer,
        details: `${COMBINATION_LAYER_NAMES[layer]} · Macro ${slot}${state.dirty.macro && state.macroDraft?.slot === slot ? " · sequence staged" : ""}`,
        staged: state.dirty.mapping.has(`${layer}:${key.id}`) || Boolean(state.dirty.macro && state.macroDraft?.hostId === key.id),
        removing: false,
        combination: true,
      });
    });
  return entries;
}
function macroHostKeyboardHtml() {
  const draft = state.macroDraft || defaultMacroDraft();
  return `<div class="socd-picker-board"><div class="keyboard socd-picker-keyboard" aria-label="Choose the physical key that runs this macro">${layout.map((row, uiRow) => `<div class="keyboard-row">${row.map((_, col) => {
    const key = keys.find((candidate) => candidate.uiRow === uiRow && candidate.col === col),
      selected = Number(draft.hostId) === key.id;
    return `<button class="key socd-picker-key ${selected ? "pair-a" : ""}" style="--u:${key.u}" type="button" data-macro-host="${key.id}" aria-pressed="${selected}" title="Bind Macro ${draft.slot} to ${esc(key.n)}"><span class="mapped">${esc(key.n)}</span><b>${esc(keycodeLabel(displayedKeycode(key, draft.layer)))}</b></button>`;
  }).join("")}</div>`).join("")}</div></div>`;
}
function macroRow(action, index) {
  return `<div class="macro-row" data-macro-row="${index}"><label class="field"><span>Key</span><select data-macro-key="${index}">${macroActionKeyOptions(action.keycode)}</select></label><label class="field"><span>Direction</span><select data-macro-pressed="${index}"><option value="1" ${action.pressed ? "selected" : ""}>Down (↓)</option><option value="0" ${!action.pressed ? "selected" : ""}>Up (↑)</option></select></label><label class="field"><span>Delay ms</span><input data-macro-delay="${index}" type="number" min="0" max="32767" step="1" value="${Math.round(Number(action.delay) || 0)}"></label><button class="button ghost small" data-remove-macro-row="${index}" type="button">×</button></div>`;
}
function macroEditor() {
  const draft = state.macroDraft || (state.macroDraft = defaultMacroDraft()),
    host = keys[Number(draft.hostId)] || keys[0],
    layer = clamp(draft.layer, 0, 3),
    actions = (draft.actions || []).slice(0, 15);
  return `<div class="socd-editor macro-editor"><div class="panel-head"><div><span class="eyebrow">MACRO FAMILY 0x07</span><h2>Macro proof of concept</h2><p>Bind one physical key to one macro slot, then write an ordered list of key down/up events and delays.</p></div><span class="badge ready">${actions.length}/15 EVENTS</span></div><div class="socd-picker-heading"><div><h3>Macro host key</h3><p>The mapping layer receives Macro ${Number(draft.slot)} (${macroKeycode(draft.slot).toString(16).toUpperCase()}).</p></div><strong>${esc(COMBINATION_LAYER_NAMES[layer])} · ${esc(host.n)}</strong></div>${macroHostKeyboardHtml()}<div class="field-grid"><label class="field"><span>Layer</span><select id="macroLayer">${COMBINATION_LAYER_NAMES.map((name, index) => `<option value="${index}" ${layer === index ? "selected" : ""}>${name}</option>`).join("")}</select></label><label class="field"><span>Macro slot</span><select id="macroSlot">${KEYCODE_GROUPS.macro.map((entry, slot) => `<option value="${slot}" ${Number(draft.slot) === slot ? "selected" : ""}>${esc(entry.label)}</option>`).join("")}</select></label><label class="field"><span>Mode</span><select id="macroMode">${MACRO_PLAYBACK_MODES.map((mode) => `<option value="${mode.value}" ${Number(draft.mode) === mode.value ? "selected" : ""}>${esc(mode.label)}</option>`).join("")}</select></label><label class="field"><span>Repeat count</span><input id="macroRepeat" type="number" min="1" max="65535" step="1" value="${Number(draft.repeatCount) || 1}"></label></div><div class="macro-rows" id="macroRows">${actions.map(macroRow).join("")}</div><div class="apply-row"><button class="button ghost" id="addMacroRow" type="button" ${actions.length >= 15 ? "disabled" : ""}>Add event</button><button class="button ghost" id="readMacroSlot" type="button" ${connected() ? "" : "disabled"}>Read macro slot</button><button class="button primary" id="stageMacro" type="button" ${actions.length ? "" : "disabled"}>Stage macro</button></div><p class="socd-stage-note">The original editor supports key record insert/edit, direction Up/Down, millisecond timing, and drag reorder. This POC writes the same event shape without recorder polish.</p></div>`;
}
function collectMacroDraftFromForm() {
  const draft = state.macroDraft || defaultMacroDraft();
  draft.layer = clamp(document.querySelector("#macroLayer")?.value ?? draft.layer, 0, 3);
  draft.slot = clamp(document.querySelector("#macroSlot")?.value ?? draft.slot, 0, 15);
  draft.mode = clamp(document.querySelector("#macroMode")?.value ?? draft.mode, 0, 5);
  draft.repeatCount = clamp(document.querySelector("#macroRepeat")?.value ?? draft.repeatCount, 1, 65535);
  draft.actions = [...document.querySelectorAll("[data-macro-row]")].map((row) => {
    const index = Number(row.dataset.macroRow);
    return {
      keycode: Number(document.querySelector(`[data-macro-key="${index}"]`)?.value || 4),
      pressed: document.querySelector(`[data-macro-pressed="${index}"]`)?.value !== "0",
      delay: clamp(document.querySelector(`[data-macro-delay="${index}"]`)?.value || 0, 0, 32767),
    };
  });
  state.macroDraft = draft;
  return draft;
}
function renderMacroConfiguration() {
  const body = document.querySelector("#socdConfigBody"), title = document.querySelector("#socdConfigTitle");
  if (!body) return;
  if (title) title.textContent = "Configure Macro";
  body.innerHTML = macroEditor();
  bindMacroConfiguration();
}
function openMacroConfiguration() {
  if (!state.macroDraft) state.macroDraft = defaultMacroDraft();
  renderMacroConfiguration();
  openDialog(document.querySelector("#socdConfigDialog"));
}
function bindMacroConfiguration() {
  document.querySelectorAll("[data-macro-host]").forEach((button) => button.addEventListener("click", () => { state.macroDraft = { ...(state.macroDraft || defaultMacroDraft()), hostId: Number(button.dataset.macroHost) }; state.profile.selected = state.macroDraft.hostId; state.selectedKeys = new Set([state.profile.selected]); renderMacroConfiguration(); }));
  ["#macroLayer", "#macroSlot", "#macroMode", "#macroRepeat"].forEach((selector) => document.querySelector(selector)?.addEventListener("change", () => { collectMacroDraftFromForm(); renderMacroConfiguration(); }));
  document.querySelector("#addMacroRow")?.addEventListener("click", () => { collectMacroDraftFromForm(); state.macroDraft.actions.push({ pressed: true, keycode: 4, delay: 1 }); renderMacroConfiguration(); });
  document.querySelectorAll("[data-remove-macro-row]").forEach((button) => button.addEventListener("click", () => { collectMacroDraftFromForm(); state.macroDraft.actions.splice(Number(button.dataset.removeMacroRow), 1); renderMacroConfiguration(); }));
  document.querySelector("#stageMacro")?.addEventListener("click", stageMacro);
  document.querySelector("#readMacroSlot")?.addEventListener("click", readMacroDraftFromDevice);
}
async function readMacroDraftFromDevice() {
  if (!connected()) return showToast("Connect to read a macro slot.", true);
  const draft = collectMacroDraftFromForm(), mode = await state.transport.getMacroMode(draft.slot),
    actions = await state.transport.getMacroData(draft.slot, 0);
  state.macroDraft = { ...draft, mode: Number(mode.mode) || 0, repeatCount: Number(mode.repeatCount) || 1, actions: actions.slice(0, mode.actionCount || actions.length).filter((action) => action.keycode) };
  renderMacroConfiguration(); showToast(`Macro ${draft.slot} read from keyboard.`);
}
function stageMacro() {
  const draft = collectMacroDraftFromForm(), host = keys[Number(draft.hostId)];
  if (!host) return showToast("Choose a valid macro host key.", true);
  if (!draft.actions.length) return showToast("Add at least one macro event.", true);
  if (draft.actions.length > 15) return showToast("This POC writes up to 15 events in one HID packet.", true);
  if (draft.actions.some((action) => !Number(action.keycode))) return showToast("Every macro row needs a key.", true);
  const token = `${draft.layer}:${host.id}`;
  state.profile.keycodes[draft.layer][host.id] = macroKeycode(draft.slot);
  state.dirty.mapping.add(token);
  state.dirty.macro = true;
  state.profile.layer = draft.layer; state.profile.selected = host.id; state.selectedKeys = new Set([host.id]);
  render(); renderMacroConfiguration(); showToast(`Macro ${draft.slot} staged on ${COMBINATION_LAYER_NAMES[draft.layer]} ${host.n}.`);
}
async function applyMacroDraft(draft = state.macroDraft) {
  if (!draft || !state.dirty.macro) return;
  const slot = clamp(draft.slot, 0, 15), actions = draft.actions.slice(0, 15);
  document.querySelector("#progressDetail").textContent = `Macro ${slot}: writing ${actions.length} event${actions.length === 1 ? "" : "s"}`;
  await state.transport.setMacroData({ macroId: slot, offset: 0, actions });
  const verifiedMode = await state.transport.setMacroMode({ macroId: slot, valid: true, actionCount: actions.length, repeatCount: draft.repeatCount, mode: draft.mode });
  await state.transport.saveParameters(SAVE_GROUP.MACRO);
  const readMode = await state.transport.getMacroMode(slot), readActions = await state.transport.getMacroData(slot, 0),
    modeOk = readMode.valid && Number(readMode.actionCount) === actions.length && Number(readMode.repeatCount) === Number(verifiedMode.repeatCount) && Number(readMode.mode) === Number(verifiedMode.mode),
    dataOk = actions.every((action, index) => Number(readActions[index]?.keycode) === Number(action.keycode) && Boolean(readActions[index]?.pressed) === Boolean(action.pressed) && Number(readActions[index]?.delay) === Math.round(Number(action.delay) || 0));
  if (!modeOk || !dataOk) throw new Error(`Macro ${slot} read-back verification failed.`);
  state.hardware.macroSpace = state.hardware.macroSpace || { count: 16, capacity: 960 };
}
function macroFeatureInfo() {
  return {
    title: "Macros",
    body: `<div class="feature-info-lead"><p>The original AE64 editor stores a macro as a slot plus ordered key records. A host key is assigned through normal key mapping, while the sequence is written through macro family 0x07.</p><ul><li>Choose a macro key and playback mode.</li><li>Record or insert key records with Key, Direction, and Time (ms).</li><li>Direction is Down (↓) or Up (↑); time is a millisecond delay.</li><li>The captured UI validates timing as roughly 1–32768 ms, and shows empty recordings only as drafts.</li></ul><p>This proof of concept exposes manual rows instead of the polished recorder/drag-reorder flow.</p></div>`,
  };
}
