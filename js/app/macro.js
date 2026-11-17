"use strict";

/** Capture-backed AE64 family-0x07 macro editor, recorder and writer. */
const MACRO_PLAYBACK_MODES = Object.freeze([
  { value: 0, label: "Click repeat", detail: "Re-click is ignored" },
  { value: 1, label: "Click repeat", detail: "Re-click restarts playback" },
  { value: 2, label: "Click repeat", detail: "Re-click stops immediately" },
  { value: 3, label: "Click repeat", detail: "Re-click stops after this run" },
  { value: 4, label: "Hold repeat", detail: "Release stops immediately", hold: true },
  { value: 5, label: "Hold repeat", detail: "Release stops after this run", hold: true },
]);
const MACRO_PAGE_SIZE = Number(window.AE64Protocol.MACRO_ACTIONS_PER_PAGE) || 15;
const MACRO_PROTOCOL_EVENT_LIMIT = MACRO_PAGE_SIZE * (Number(window.AE64Protocol.MACRO_MAX_PAGES) || 256);
const MACRO_DELAY_MIN = 1;
const MACRO_DELAY_MAX = 0x7fff;
const MACRO_CLICK_REPEAT_MAX = 9999;
const MACRO_HOLD_REPEAT = 0xffff;

Object.assign(state, {
  macroDraft: null,
  macroRecording: false,
  macroRecorderListener: null,
  macroPressed: new Map(),
  macroLastEventAt: 0,
  macroCatalogLoading: false,
  macroDragIndex: null,
});
state.dirty.macro = false;
state.hardware.macros = state.hardware.macros || new Map();

function macroKeycode(slot) { return 0xf500 + Math.round(clamp(slot, 0, 15)); }
function macroSlotFromKeycode(code) {
  const slot = Number(code) - 0xf500;
  return slot >= 0 && slot < 16 ? slot : null;
}
function macroBaseToken(layer, id, profileIndex = state.profile.profileIndex) {
  return `${Number(profileIndex)}:${Number(layer)}:${Number(id)}`;
}
function macroSlotCount() {
  const reported = Number(state.hardware.macroSpace?.count) || KEYCODE_GROUPS.macro.length;
  return Math.max(1, Math.min(KEYCODE_GROUPS.macro.length, reported));
}
function macroActionLimit() {
  const slots = macroSlotCount(), capacity = Number(state.hardware.macroSpace?.capacity) || 960;
  // This is the exact guard used by the captured driver: slot count + the
  // edited macro's action count may not exceed the reported macroNumber.
  return Math.max(1, Math.min(MACRO_PROTOCOL_EVENT_LIMIT, capacity > slots ? capacity - slots : capacity));
}
function macroPlaybackMode(value) {
  return MACRO_PLAYBACK_MODES.find((mode) => mode.value === Number(value)) || MACRO_PLAYBACK_MODES[0];
}
function macroStoredRepeat(draft) {
  return macroPlaybackMode(draft.mode).hold
    ? MACRO_HOLD_REPEAT
    : Math.round(clamp(draft.repeatCount || 1, 1, MACRO_CLICK_REPEAT_MAX));
}
function macroCachedSlot(slot) {
  return state.hardware.macros.get(Number(slot)) || null;
}
function macroDraftForSlot(slot, base = {}) {
  const cached = macroCachedSlot(slot), actions = cached?.actions ? clone(cached.actions) : [];
  return {
    feature: "MACRO",
    hostId: Number(base.hostId ?? state.profile.selected),
    layer: Number(base.layer ?? state.profile.layer) || 0,
    slot: Number(slot),
    mode: Number(cached?.mode) || 0,
    repeatCount: macroPlaybackMode(cached?.mode).hold ? 1 : Number(cached?.repeatCount) || 1,
    valid: Boolean(cached?.valid),
    loaded: Boolean(cached?.actions),
    removeSlot: false,
    actions,
  };
}
function defaultMacroDraft(hostId = state.profile.selected) {
  const host = keys[Number(hostId)] || selectedKey(),
    slot = macroSlotFromKeycode(displayedKeycode(host, state.profile.layer)) ?? 0;
  return macroDraftForSlot(slot, { hostId: host.id, layer: Number(state.profile.layer) || 0 });
}
function macroDraftDetails(draft = state.macroDraft) {
  if (!draft) return "";
  if (draft.removeSlot) return `Macro ${Number(draft.slot)} · clear slot`;
  const count = Number(draft.actions?.length) || 0, mode = macroPlaybackMode(draft.mode);
  return `Macro ${Number(draft.slot)} · ${count} event${count === 1 ? "" : "s"} · ${mode.label}, ${mode.detail.toLowerCase()}`;
}
function macroAdvancedMeta(key) {
  const slot = macroSlotFromKeycode(displayedKeycode(key, state.profile.layer));
  if (slot === null) return null;
  return {
    feature: ADVANCED_FEATURES.find((item) => item.code === "MACRO"),
    staged: state.dirty.mapping.has(`${state.profile.layer}:${key.id}`) || Boolean(state.dirty.macro && state.macroDraft?.slot === slot),
    removing: false,
    partner: `Macro ${slot}`,
  };
}
function macroAssignmentEntries() {
  const feature = ADVANCED_FEATURES.find((item) => item.code === "MACRO"), entries = [];
  for (let layer = 0; layer < 4; layer += 1)
    keys.forEach((key) => {
      const slot = macroSlotFromKeycode(displayedKeycode(key, layer));
      if (slot === null) return;
      const record = macroCachedSlot(slot), slotEdit = state.dirty.macro && Number(state.macroDraft?.slot) === slot;
      entries.push({
        feature,
        ids: [key.id],
        keys: [key],
        layer,
        details: `${COMBINATION_LAYER_NAMES[layer]} · Macro ${slot}${slotEdit ? state.macroDraft.removeSlot ? " · slot clear staged" : " · sequence staged" : record?.valid ? ` · ${record.actionCount} events` : ""}`,
        staged: state.dirty.mapping.has(`${layer}:${key.id}`) || Boolean(slotEdit),
        removing: false,
        macro: true,
      });
    });
  return entries;
}

function macroHostKeyboardHtml() {
  const draft = state.macroDraft || defaultMacroDraft();
  return `<div class="socd-picker-board"><div class="keyboard socd-picker-keyboard" aria-label="Choose the physical key that runs this macro">${layout.map((row, uiRow) => `<div class="keyboard-row">${row.map((_, col) => {
    const key = keys.find((candidate) => candidate.uiRow === uiRow && candidate.col === col), selected = Number(draft.hostId) === key.id;
    return `<button class="key socd-picker-key ${selected ? "pair-a" : ""}" style="--u:${key.u}" type="button" data-macro-host="${key.id}" aria-pressed="${selected}" title="Bind Macro ${draft.slot} to ${esc(key.n)}" ${state.macroRecording ? "disabled" : ""}><span class="mapped">${esc(key.n)}</span><b>${esc(keycodeLabel(displayedKeycode(key, draft.layer)))}</b></button>`;
  }).join("")}</div>`).join("")}</div></div>`;
}
function macroKeyPickerGroups() {
  const allowed = KEYCODE_GROUPS.keyboard.filter(({ code }) => Number(code) > 1), groups = [
    { id: "basic", label: "Basic keys", test: (code) => code >= 4 && code <= 57 },
    { id: "function", label: "F1–F24", test: (code) => (code >= 58 && code <= 69) || (code >= 104 && code <= 115) },
    { id: "navigation", label: "Navigation", test: (code) => code >= 70 && code <= 82 },
    { id: "numpad", label: "Numpad", test: (code) => code >= 83 && code <= 101 },
    { id: "modifier", label: "Modifiers", test: (code) => code >= 224 && code <= 231 },
  ];
  return groups.map((group) => ({ ...group, entries: allowed.filter((entry) => group.test(Number(entry.code))) })).filter((group) => group.entries.length);
}
function openMacroActionPicker(index) {
  const draft = collectMacroDraftFromForm(), action = draft.actions[Number(index)];
  if (!action) return;
  openAdvancedKeyPicker({
    title: `Choose event ${Number(index) + 1} key`,
    eyebrow: "MACRO KEY RECORD",
    context: `MACRO ${draft.slot} · EVENT ${String(Number(index) + 1).padStart(2, "0")}`,
    description: "Choose the keyboard usage emitted by this down/up record.",
    groups: macroKeyPickerGroups(),
    current: Number(action.keycode),
    accent: "#d49a62",
    exclusion: "The captured macro recorder accepts keyboard operations. Firmware controls, lighting, macro recursion, media, mouse and gamepad values are excluded.",
    onSelect: (code) => {
      state.macroDraft.actions[Number(index)].keycode = Number(code);
      renderMacroConfiguration();
    },
  });
}
function macroBalanceWarnings(actions) {
  const held = new Map(), warnings = [];
  actions.forEach((action, index) => {
    const code = Number(action.keycode), count = held.get(code) || 0;
    if (action.pressed) held.set(code, count + 1);
    else if (!count) warnings.push(`Event ${index + 1} releases ${keycodeLabel(code)} before a matching press.`);
    else held.set(code, count - 1);
  });
  const stuck = [...held].filter(([, count]) => count > 0).map(([code]) => keycodeLabel(code));
  if (stuck.length) warnings.push(`No final release for ${stuck.join(", ")}.`);
  return warnings;
}
function macroRow(action, index, total) {
  return `<article class="macro-row" data-macro-row="${index}" draggable="true"><button class="macro-drag-handle" type="button" data-macro-drag-handle="${index}" title="Drag to reorder" aria-label="Drag event ${index + 1} to reorder">⋮⋮</button><span class="macro-event-index">${String(index + 1).padStart(2, "0")}</span><button type="button" class="advanced-key-value assigned macro-key-value" data-macro-key-picker="${index}"><small>KEY VALUE</small><b>${esc(keycodeLabel(action.keycode))}</b><i aria-hidden="true">›</i></button><div class="macro-direction" role="group" aria-label="Event ${index + 1} direction"><button type="button" data-macro-direction="${index}:1" class="${action.pressed ? "active" : ""}" aria-pressed="${action.pressed}">↓ Down</button><button type="button" data-macro-direction="${index}:0" class="${!action.pressed ? "active" : ""}" aria-pressed="${!action.pressed}">↑ Up</button></div><label class="field macro-delay"><span>Delay</span><div class="input-with-unit"><input data-macro-delay="${index}" type="number" min="${MACRO_DELAY_MIN}" max="${MACRO_DELAY_MAX}" step="1" value="${Math.round(clamp(action.delay, MACRO_DELAY_MIN, MACRO_DELAY_MAX))}"><span>ms</span></div></label><div class="macro-row-actions"><button class="button ghost small" data-move-macro-row="${index}:-1" type="button" ${index ? "" : "disabled"} aria-label="Move event up">↑</button><button class="button ghost small" data-move-macro-row="${index}:1" type="button" ${index + 1 < total ? "" : "disabled"} aria-label="Move event down">↓</button><button class="button danger small" data-remove-macro-row="${index}" type="button" aria-label="Delete event">×</button></div></article>`;
}
function macroSlotBrowser() {
  const draft = state.macroDraft, count = macroSlotCount();
  return `<div class="macro-slot-browser" role="tablist" aria-label="Macro slots">${Array.from({ length: count }, (_, slot) => {
    const record = macroCachedSlot(slot), selected = Number(draft.slot) === slot, staged = state.dirty.macro && selected;
    const eventCount = staged ? draft.actions.length : Number(record?.actionCount) || 0;
    return `<button type="button" role="tab" data-macro-slot="${slot}" class="${selected ? "active" : ""} ${record?.valid ? "used" : ""} ${staged ? "staged" : ""}" aria-selected="${selected}" ${state.macroRecording ? "disabled" : ""}><span>M${String(slot).padStart(2, "0")}</span><strong>${eventCount ? `${eventCount} event${eventCount === 1 ? "" : "s"}` : "Empty"}</strong><small>${staged ? draft.removeSlot ? "CLEAR STAGED" : "EDIT STAGED" : record?.valid ? "ONBOARD" : "AVAILABLE"}</small></button>`;
  }).join("")}</div>`;
}
function macroEditor() {
  const draft = state.macroDraft || (state.macroDraft = defaultMacroDraft()), host = keys[Number(draft.hostId)] || keys[0],
    layer = clamp(draft.layer, 0, 3), actions = draft.actions || [], limit = macroActionLimit(), mode = macroPlaybackMode(draft.mode),
    warnings = macroBalanceWarnings(actions), pages = Math.ceil(actions.length / MACRO_PAGE_SIZE), slotUsers = keys.reduce((count, key) => count + Array.from({ length: 4 }, (_, itemLayer) => macroSlotFromKeycode(displayedKeycode(key, itemLayer)) === Number(draft.slot)).filter(Boolean).length, 0);
  return `<div class="socd-editor macro-editor"><div class="panel-head"><div><span class="eyebrow">CAPTURE-VERIFIED FAMILY 0x07</span><h2>Macro editor</h2><p>Record or arrange keyboard down/up events, choose firmware playback behavior, then bind the slot to a physical key.</p></div><span class="badge ${state.macroRecording ? "experimental" : "ready"}">${state.macroRecording ? "RECORDING" : `${actions.length} EVENTS · ${pages} PAGE${pages === 1 ? "" : "S"}`}</span></div><section class="macro-library"><div class="macro-section-heading"><div><h3>Onboard macro library</h3><p>${state.macroCatalogLoading ? "Reading slot metadata…" : `${macroSlotCount()} slots · ${Number(state.hardware.macroSpace?.capacity) || 960} reported capacity units · captured limit ${limit} events for the edited slot`}</p></div><button class="button ghost small" id="refreshMacroLibrary" type="button" ${connected() && !state.macroCatalogLoading && !state.macroRecording ? "" : "disabled"}>Refresh</button></div>${macroSlotBrowser()}</section><section class="macro-binding"><div class="socd-picker-heading"><div><h3>Activation key</h3><p>${slotUsers ? `Macro ${draft.slot} is currently referenced by ${slotUsers} layer mapping${slotUsers === 1 ? "" : "s"}. Editing the slot changes every reference.` : `Bind Macro ${draft.slot} to one physical key on the selected layer.`}</p></div><strong>${esc(COMBINATION_LAYER_NAMES[layer])} · ${esc(host.n)}</strong></div><div class="combination-layer-tabs" role="tablist" aria-label="Macro layer">${COMBINATION_LAYER_NAMES.map((name, index) => `<button type="button" role="tab" data-macro-layer="${index}" class="${layer === index ? "active" : ""}" aria-selected="${layer === index}" ${state.macroRecording ? "disabled" : ""}><span>0${index + 1}</span>${name}</button>`).join("")}</div>${macroHostKeyboardHtml()}</section><section class="macro-playback"><div class="macro-section-heading"><div><h3>Playback behavior</h3><p>The six modes and hold-mode repeat sentinel match the original driver.</p></div><span>${mode.hold ? "∞ WHILE HELD" : `${Math.round(clamp(draft.repeatCount || 1, 1, MACRO_CLICK_REPEAT_MAX))}×`}</span></div><div class="macro-mode-grid">${MACRO_PLAYBACK_MODES.map((item) => `<button type="button" data-macro-mode="${item.value}" class="${Number(draft.mode) === item.value ? "active" : ""}" aria-pressed="${Number(draft.mode) === item.value}" ${state.macroRecording ? "disabled" : ""}><span>${item.hold ? "HOLD" : "CLICK"} · MODE ${item.value}</span><b>${item.label}</b><small>${item.detail}</small></button>`).join("")}</div><label class="field macro-repeat ${mode.hold || state.macroRecording ? "disabled-field" : ""}"><span>Repeat count</span><input id="macroRepeat" type="number" min="1" max="${MACRO_CLICK_REPEAT_MAX}" step="1" value="${Math.round(clamp(draft.repeatCount || 1, 1, MACRO_CLICK_REPEAT_MAX))}" ${mode.hold || state.macroRecording ? "disabled" : ""}><small>${mode.hold ? "Hold modes store 65535 (infinite) exactly as the original driver does." : `Click modes accept 1–${MACRO_CLICK_REPEAT_MAX.toLocaleString()}.`}</small></label></section><section class="macro-sequence"><div class="macro-section-heading"><div><h3>Event sequence</h3><p>Each HID page carries ${MACRO_PAGE_SIZE} records. Delays are stored before each event in milliseconds.</p></div><div class="macro-record-actions"><button class="button ${state.macroRecording ? "danger" : "primary"}" id="toggleMacroRecording" type="button">${state.macroRecording ? "Stop recording" : "Start recording"}</button><button class="button ghost" id="addMacroRow" type="button" ${actions.length >= limit || state.macroRecording ? "disabled" : ""}>Add event</button></div></div>${state.macroRecording ? '<div class="macro-recording-banner"><i></i><div><b>Recording keyboard operations</b><span>Press keys now. Browser shortcuts and page actions are blocked; stopping releases any keys still held in the recording.</span></div></div>' : ""}<div class="macro-rows" id="macroRows">${actions.length ? actions.map((action, index) => macroRow(action, index, actions.length)).join("") : `<div class="macro-empty"><strong>No events in Macro ${draft.slot}</strong><p>Start recording or insert the first key record manually.</p></div>`}</div><div class="macro-sequence-tools"><label class="field"><span>Set every delay</span><div class="input-with-unit"><input id="macroBatchDelay" type="number" min="${MACRO_DELAY_MIN}" max="${MACRO_DELAY_MAX}" step="1" value="10"><span>ms</span></div></label><button class="button ghost" id="applyMacroBatchDelay" type="button" ${actions.length && !state.macroRecording ? "" : "disabled"}>Apply to all</button><button class="button ghost" id="clearMacroEvents" type="button" ${actions.length && !state.macroRecording ? "" : "disabled"}>Clear events</button></div>${warnings.length ? `<div class="macro-warning"><b>Sequence check</b><p>${esc(warnings.join(" "))} The firmware permits this, but it may leave a key logically held until another report releases it.</p></div>` : ""}</section><footer class="macro-footer"><div><b>${draft.loaded ? draft.valid ? "Loaded from keyboard" : "Empty onboard slot" : connected() ? "Select Read slot to load onboard data" : "Connect to read this slot"}</b><p>Stage writes only the working copy. Apply changes writes mode metadata, all ${MACRO_PAGE_SIZE}-event pages, commits group 6, and verifies the full sequence.</p></div><div class="apply-row"><button class="button ghost" id="readMacroSlot" type="button" ${connected() && !state.macroRecording && !state.dirty.macro ? "" : "disabled"}>Read slot</button><button class="button danger" id="clearMacroSlot" type="button" ${!state.macroRecording && (draft.valid || actions.length) ? "" : "disabled"}>Clear slot</button><button class="button primary" id="stageMacro" type="button" ${actions.length && !state.macroRecording ? "" : "disabled"}>Stage macro</button></div></footer>${state.dirty.macro && Number(state.macroDraft?.slot) === Number(draft.slot) ? `<p class="socd-stage-note">${draft.removeSlot ? `Macro ${draft.slot} will be invalidated when changes are applied.` : `Macro ${draft.slot} and its ${actions.length} events are staged for verified write-back.`}</p>` : ""}</div>`;
}

function collectMacroDraftFromForm() {
  const draft = state.macroDraft || defaultMacroDraft(), repeat = document.querySelector("#macroRepeat");
  if (repeat && repeat.value !== "") draft.repeatCount = Math.round(clamp(repeat.value, 1, MACRO_CLICK_REPEAT_MAX));
  const rows = [...document.querySelectorAll("[data-macro-row]")];
  if (rows.length)
    draft.actions = rows.map((row) => {
      const index = Number(row.dataset.macroRow), current = draft.actions[index] || { pressed: true, keycode: 4, delay: 10 },
        delay = document.querySelector(`[data-macro-delay="${index}"]`);
      return { ...current, delay: Math.round(clamp(delay?.value ?? current.delay, MACRO_DELAY_MIN, MACRO_DELAY_MAX)) };
    });
  state.macroDraft = draft;
  return draft;
}
function renderMacroConfiguration() {
  const body = document.querySelector("#socdConfigBody"), title = document.querySelector("#socdConfigTitle");
  if (!body) return;
  if (title) title.textContent = "Configure Macro";
  body.innerHTML = macroEditor();
  const stageNote = body.querySelector?.(".socd-stage-note");
  if (stageNote && state.macroDraft?.removeSlot)
    stageNote.textContent = `Macro ${state.macroDraft.slot} event data will be cleared when changes are applied; activation-key mappings remain.`;
  bindMacroConfiguration();
}
function openMacroConfiguration() {
  if (!state.macroDraft) state.macroDraft = defaultMacroDraft();
  renderMacroConfiguration();
  openDialog(document.querySelector("#socdConfigDialog"));
  if (connected() && !state.dirty.macro) void loadMacroWorkspace();
}
async function loadMacroWorkspace() {
  if (!connected() || state.macroCatalogLoading || state.dirty.macro) return;
  state.macroCatalogLoading = true;
  renderMacroConfiguration();
  try {
    state.hardware.macroSpace = await state.transport.getMacroSpaceInfo();
    const modes = await Promise.all(Array.from({ length: macroSlotCount() }, (_, slot) => state.transport.getMacroMode(slot)));
    modes.forEach((record, slot) => {
      const cached = macroCachedSlot(slot);
      state.hardware.macros.set(slot, { ...cached, ...record, actions: cached?.actionCount === record.actionCount ? cached?.actions : undefined });
    });
    await readMacroDraftFromDevice(state.macroDraft?.slot, { quiet: true });
  } catch (error) {
    showToast(`Could not read macro library: ${error.message}`, true);
  } finally {
    state.macroCatalogLoading = false;
    renderMacroConfiguration();
  }
}
async function readMacroDraftFromDevice(slot = state.macroDraft?.slot, { quiet = false } = {}) {
  if (!connected()) return showToast("Connect to read a macro slot.", true);
  const selectedSlot = Math.round(clamp(slot, 0, macroSlotCount() - 1)), previous = state.macroDraft || defaultMacroDraft(),
    mode = await state.transport.getMacroMode(selectedSlot), actions = await state.transport.getMacroActions(selectedSlot, mode.actionCount);
  const record = { ...mode, actions: actions.filter((action) => Number(action.keycode) > 0) };
  state.hardware.macros.set(selectedSlot, record);
  if (Number(state.macroDraft?.slot) === selectedSlot || Number(previous.slot) === selectedSlot)
    state.macroDraft = {
      ...previous,
      slot: selectedSlot,
      mode: Number(mode.mode) || 0,
      repeatCount: macroPlaybackMode(mode.mode).hold ? 1 : Math.round(clamp(mode.repeatCount || 1, 1, MACRO_CLICK_REPEAT_MAX)),
      valid: Boolean(mode.valid),
      loaded: true,
      removeSlot: false,
      actions: clone(record.actions),
    };
  renderMacroConfiguration();
  if (!quiet) showToast(`Macro ${selectedSlot} read from keyboard (${record.actions.length} events).`);
  return record;
}
async function selectMacroSlot(slot) {
  const next = Math.round(clamp(slot, 0, macroSlotCount() - 1)), current = Number(state.macroDraft?.slot);
  if (state.macroRecording) return showToast("Stop macro recording before changing slots.", true);
  if (state.dirty.macro && current !== next) return showToast("Apply or revert the staged macro before opening another slot.", true);
  stopMacroRecording({ render: false });
  const previous = collectMacroDraftFromForm();
  state.macroDraft = macroDraftForSlot(next, { hostId: previous.hostId, layer: previous.layer });
  renderMacroConfiguration();
  if (connected()) {
    try { await readMacroDraftFromDevice(next); }
    catch (error) { showToast(`Could not read Macro ${next}: ${error.message}`, true); }
  }
}

function macroKeyboardEventKeycode(event) {
  const code = String(event.code || ""), direct = {
    Enter: 40, Escape: 41, Backspace: 42, Tab: 43, Space: 44, Minus: 45, Equal: 46,
    BracketLeft: 47, BracketRight: 48, Backslash: 49, IntlHash: 50, Semicolon: 51,
    Quote: 52, Backquote: 53, Comma: 54, Period: 55, Slash: 56, CapsLock: 57,
    PrintScreen: 70, ScrollLock: 71, Pause: 72, Insert: 73, Home: 74, PageUp: 75,
    Delete: 76, End: 77, PageDown: 78, ArrowRight: 79, ArrowLeft: 80, ArrowDown: 81,
    ArrowUp: 82, NumLock: 83, NumpadDivide: 84, NumpadMultiply: 85, NumpadSubtract: 86,
    NumpadAdd: 87, NumpadEnter: 88, NumpadDecimal: 99, IntlBackslash: 100, ContextMenu: 101,
    ControlLeft: 224, ShiftLeft: 225, AltLeft: 226, MetaLeft: 227,
    ControlRight: 228, ShiftRight: 229, AltRight: 230, MetaRight: 231,
  };
  if (/^Key[A-Z]$/.test(code)) return 4 + code.charCodeAt(3) - 65;
  if (/^Digit[0-9]$/.test(code)) return code === "Digit0" ? 39 : 29 + Number(code.slice(5));
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) {
    const number = Number(code.slice(1));
    return number <= 12 ? 57 + number : 91 + number;
  }
  if (/^Numpad[0-9]$/.test(code)) return code === "Numpad0" ? 98 : 88 + Number(code.slice(6));
  return direct[code] ?? null;
}
function recordMacroKeyboardEvent(event) {
  if (!state.macroRecording) return;
  event.preventDefault?.();
  event.stopImmediatePropagation?.();
  if (event.repeat) return;
  const keycode = macroKeyboardEventKeycode(event);
  if (!keycode) return;
  const pressed = event.type === "keydown", pressToken = String(event.code || keycode);
  if (pressed && state.macroPressed.has(pressToken)) return;
  if (!pressed && !state.macroPressed.has(pressToken)) return;
  const now = performance.now(), delay = state.macroLastEventAt ? Math.round(clamp(now - state.macroLastEventAt, MACRO_DELAY_MIN, MACRO_DELAY_MAX)) : MACRO_DELAY_MIN;
  if (state.macroDraft.actions.length >= macroActionLimit()) {
    stopMacroRecording();
    return showToast(`Macro event limit reached (${macroActionLimit()}).`, true);
  }
  state.macroDraft.actions.push({ keycode, pressed, delay });
  if (pressed) state.macroPressed.set(pressToken, keycode); else state.macroPressed.delete(pressToken);
  state.macroLastEventAt = now;
  renderMacroConfiguration();
}
function startMacroRecording() {
  if (state.macroRecording) return;
  const draft = collectMacroDraftFromForm();
  draft.removeSlot = false;
  state.macroRecording = true;
  state.macroPressed.clear();
  state.macroLastEventAt = 0;
  state.macroRecorderListener = recordMacroKeyboardEvent;
  window.addEventListener("keydown", state.macroRecorderListener, true);
  window.addEventListener("keyup", state.macroRecorderListener, true);
  renderMacroConfiguration();
}
function stopMacroRecording({ render: shouldRender = true } = {}) {
  if (!state.macroRecording) return;
  const now = performance.now();
  for (const keycode of state.macroPressed.values()) {
    if (state.macroDraft.actions.length >= macroActionLimit()) break;
    const delay = state.macroLastEventAt ? Math.round(clamp(now - state.macroLastEventAt, MACRO_DELAY_MIN, MACRO_DELAY_MAX)) : MACRO_DELAY_MIN;
    state.macroDraft.actions.push({ keycode, pressed: false, delay });
    state.macroLastEventAt = now;
  }
  window.removeEventListener("keydown", state.macroRecorderListener, true);
  window.removeEventListener("keyup", state.macroRecorderListener, true);
  state.macroPressed.clear();
  state.macroRecorderListener = null;
  state.macroRecording = false;
  if (shouldRender) renderMacroConfiguration();
}
function moveMacroAction(from, direction) {
  collectMacroDraftFromForm();
  const to = Number(from) + Number(direction);
  if (from < 0 || from >= state.macroDraft.actions.length || to < 0 || to >= state.macroDraft.actions.length) return;
  const [action] = state.macroDraft.actions.splice(from, 1);
  state.macroDraft.actions.splice(to, 0, action);
  renderMacroConfiguration();
}
function bindMacroDragAndDrop() {
  document.querySelectorAll("[data-macro-row]").forEach((row) => {
    row.addEventListener("dragstart", (event) => {
      state.macroDragIndex = Number(row.dataset.macroRow);
      event.dataTransfer?.setData("text/plain", row.dataset.macroRow);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      row.classList.add("dragging");
    });
    row.addEventListener("dragover", (event) => { event.preventDefault(); row.classList.add("drag-over"); });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", (event) => {
      event.preventDefault(); collectMacroDraftFromForm();
      const from = Number(state.macroDragIndex), to = Number(row.dataset.macroRow);
      if (Number.isInteger(from) && from !== to) {
        const [action] = state.macroDraft.actions.splice(from, 1);
        state.macroDraft.actions.splice(to, 0, action);
      }
      state.macroDragIndex = null; renderMacroConfiguration();
    });
    row.addEventListener("dragend", () => { state.macroDragIndex = null; row.classList.remove("dragging"); });
  });
}
function bindMacroConfiguration() {
  document.querySelectorAll("[data-macro-host]").forEach((button) => button.addEventListener("click", () => {
    collectMacroDraftFromForm(); state.macroDraft.hostId = Number(button.dataset.macroHost);
    state.profile.selected = state.macroDraft.hostId; state.selectedKeys = new Set([state.profile.selected]); renderMacroConfiguration();
  }));
  document.querySelectorAll("[data-macro-layer]").forEach((button) => button.addEventListener("click", () => {
    collectMacroDraftFromForm(); state.macroDraft.layer = Number(button.dataset.macroLayer); renderMacroConfiguration();
  }));
  document.querySelectorAll("[data-macro-slot]").forEach((button) => button.addEventListener("click", () => void selectMacroSlot(button.dataset.macroSlot)));
  document.querySelectorAll("[data-macro-mode]").forEach((button) => button.addEventListener("click", () => {
    collectMacroDraftFromForm(); state.macroDraft.mode = Number(button.dataset.macroMode); renderMacroConfiguration();
  }));
  document.querySelectorAll("[data-macro-key-picker]").forEach((button) => button.addEventListener("click", () => openMacroActionPicker(button.dataset.macroKeyPicker)));
  document.querySelectorAll("[data-macro-direction]").forEach((button) => button.addEventListener("click", () => {
    collectMacroDraftFromForm(); const [index, pressed] = button.dataset.macroDirection.split(":").map(Number);
    state.macroDraft.actions[index].pressed = Boolean(pressed); renderMacroConfiguration();
  }));
  document.querySelectorAll("[data-remove-macro-row]").forEach((button) => button.addEventListener("click", () => {
    collectMacroDraftFromForm(); state.macroDraft.actions.splice(Number(button.dataset.removeMacroRow), 1); renderMacroConfiguration();
  }));
  document.querySelectorAll("[data-move-macro-row]").forEach((button) => button.addEventListener("click", () => {
    const [index, direction] = button.dataset.moveMacroRow.split(":").map(Number); moveMacroAction(index, direction);
  }));
  document.querySelector("#addMacroRow")?.addEventListener("click", () => {
    collectMacroDraftFromForm(); state.macroDraft.actions.push({ pressed: true, keycode: 4, delay: 10 }); state.macroDraft.removeSlot = false; renderMacroConfiguration();
  });
  document.querySelector("#toggleMacroRecording")?.addEventListener("click", () => state.macroRecording ? stopMacroRecording() : startMacroRecording());
  document.querySelector("#clearMacroEvents")?.addEventListener("click", () => { collectMacroDraftFromForm(); state.macroDraft.actions = []; renderMacroConfiguration(); });
  document.querySelector("#applyMacroBatchDelay")?.addEventListener("click", () => {
    collectMacroDraftFromForm(); const value = Math.round(clamp(document.querySelector("#macroBatchDelay")?.value || 10, MACRO_DELAY_MIN, MACRO_DELAY_MAX));
    state.macroDraft.actions.forEach((action) => { action.delay = value; }); renderMacroConfiguration();
  });
  document.querySelector("#refreshMacroLibrary")?.addEventListener("click", () => state.dirty.macro
    ? showToast("Apply or revert the staged macro before refreshing the library.", true)
    : void loadMacroWorkspace());
  document.querySelector("#stageMacro")?.addEventListener("click", stageMacro);
  document.querySelector("#clearMacroSlot")?.addEventListener("click", stageMacroSlotClear);
  document.querySelector("#readMacroSlot")?.addEventListener("click", () => void readMacroDraftFromDevice());
  bindMacroDragAndDrop();
}

function validateMacroDraft(draft) {
  if (!draft.actions.length) throw new Error("Record or add at least one macro event.");
  if (draft.actions.length > macroActionLimit()) throw new Error(`Macro ${draft.slot} exceeds the captured ${macroActionLimit()}-event capacity guard.`);
  const allowed = new Set(KEYCODE_GROUPS.keyboard.filter(({ code }) => Number(code) > 1).map(({ code }) => Number(code)));
  draft.actions.forEach((action, index) => {
    if (!allowed.has(Number(action.keycode))) throw new Error(`Event ${index + 1} uses an unsupported key value.`);
    if (!Number.isInteger(Number(action.delay)) || Number(action.delay) < MACRO_DELAY_MIN || Number(action.delay) > MACRO_DELAY_MAX)
      throw new Error(`Event ${index + 1} delay must be ${MACRO_DELAY_MIN}–${MACRO_DELAY_MAX} ms.`);
  });
}
function stageMacro() {
  stopMacroRecording({ render: false });
  const draft = collectMacroDraftFromForm(), host = keys[Number(draft.hostId)];
  try { validateMacroDraft(draft); }
  catch (error) { renderMacroConfiguration(); return showToast(error.message, true); }
  if (!host) return showToast("Choose a valid macro activation key.", true);
  const token = `${draft.layer}:${host.id}`, baseToken = macroBaseToken(draft.layer, host.id), previous = displayedKeycode(host, draft.layer);
  if (macroSlotFromKeycode(previous) === null) state.profile.macroBases[baseToken] = previous;
  state.profile.keycodes[draft.layer][host.id] = macroKeycode(draft.slot);
  state.dirty.mapping.add(token);
  draft.removeSlot = false; draft.valid = true;
  state.dirty.macro = true;
  state.profile.layer = draft.layer; state.profile.selected = host.id; state.selectedKeys = new Set([host.id]);
  render(); renderMacroConfiguration();
  showToast(`Macro ${draft.slot} staged on ${COMBINATION_LAYER_NAMES[draft.layer]} ${host.n} (${draft.actions.length} events across ${Math.ceil(draft.actions.length / MACRO_PAGE_SIZE)} pages).`);
}
function stageMacroSlotClear() {
  stopMacroRecording({ render: false });
  const draft = collectMacroDraftFromForm();
  draft.actions = []; draft.valid = true; draft.removeSlot = true;
  state.dirty.macro = true;
  render(); renderMacroConfiguration();
  showToast(`Macro ${draft.slot} data clear staged. Existing key mappings to this slot are not removed.`);
}
function removeMacroAssignment(value) {
  const [layerValue, idValue] = String(value).split(":"), layer = clamp(layerValue, 0, 3), host = keys[Number(idValue)];
  if (!host || macroSlotFromKeycode(displayedKeycode(host, layer)) === null) return;
  const token = `${layer}:${host.id}`, baseToken = macroBaseToken(layer, host.id);
  if (state.dirty.mapping.has(token)) {
    const original = Number(state.original?.keycodes?.[layer]?.[host.id]), originalBase = state.original?.macroBases?.[baseToken];
    state.profile.keycodes[layer][host.id] = Number.isInteger(original) ? original : defaultKeycode(host);
    if (originalBase === undefined) delete state.profile.macroBases[baseToken]; else state.profile.macroBases[baseToken] = originalBase;
    state.dirty.mapping.delete(token);
    render(); showToast(`Staged macro binding discarded for ${COMBINATION_LAYER_NAMES[layer]} ${host.n}.`); return;
  }
  const fallback = Number(state.profile.macroBases[baseToken]);
  state.profile.keycodes[layer][host.id] = Number.isInteger(fallback) ? fallback : defaultKeycode(host);
  delete state.profile.macroBases[baseToken];
  state.dirty.mapping.add(token); state.profile.layer = layer; state.profile.selected = host.id; state.selectedKeys = new Set([host.id]);
  render(); showToast(`Macro binding removal staged for ${COMBINATION_LAYER_NAMES[layer]} ${host.n}.`);
}
async function applyMacroDraft(draft = state.macroDraft) {
  if (!draft || !state.dirty.macro) return;
  const slot = Math.round(clamp(draft.slot, 0, macroSlotCount() - 1));
  if (draft.removeSlot) {
    const repeatCount = macroStoredRepeat(draft);
    document.querySelector("#progressDetail").textContent = `Macro ${slot}: clearing event data`;
    await state.transport.setMacroMode({ macroId: slot, valid: true, actionCount: 0, repeatCount, mode: draft.mode });
    await state.transport.saveParameters(SAVE_GROUP.MACRO);
    const verified = await state.transport.getMacroMode(slot);
    if (!verified.valid || Number(verified.actionCount) !== 0 || Number(verified.repeatCount) !== repeatCount || Number(verified.mode) !== Number(draft.mode))
      throw new Error(`Macro ${slot} clear verification failed.`);
    state.hardware.macros.set(slot, { ...verified, actions: [] });
    return;
  }
  validateMacroDraft(draft);
  const actions = clone(draft.actions), repeatCount = macroStoredRepeat(draft), pageCount = Math.ceil(actions.length / MACRO_PAGE_SIZE);
  document.querySelector("#progressDetail").textContent = `Macro ${slot}: allocating ${actions.length} events`;
  await state.transport.setMacroMode({ macroId: slot, valid: true, actionCount: actions.length, repeatCount, mode: draft.mode });
  for (let page = 0; page < pageCount; page += 1) {
    document.querySelector("#progressDetail").textContent = `Macro ${slot}: writing page ${page + 1} of ${pageCount}`;
    await state.transport.setMacroData({ macroId: slot, offset: page, actions: actions.slice(page * MACRO_PAGE_SIZE, (page + 1) * MACRO_PAGE_SIZE) });
  }
  await state.transport.saveParameters(SAVE_GROUP.MACRO);
  const readMode = await state.transport.getMacroMode(slot), readActions = await state.transport.getMacroActions(slot, readMode.actionCount),
    modeOk = readMode.valid && Number(readMode.actionCount) === actions.length && Number(readMode.repeatCount) === repeatCount && Number(readMode.mode) === Number(draft.mode),
    dataOk = actions.every((action, index) => Number(readActions[index]?.keycode) === Number(action.keycode) && Boolean(readActions[index]?.pressed) === Boolean(action.pressed) && Number(readActions[index]?.delay) === Number(action.delay));
  if (!modeOk || !dataOk) throw new Error(`Macro ${slot} full-sequence read-back verification failed.`);
  state.hardware.macros.set(slot, { ...readMode, actions: readActions });
}
function macroFeatureInfo() {
  return {
    title: "Macros",
    body: `<div class="feature-info-lead"><p>The captured AE64 driver stores each macro in one of 16 family-0x07 slots. The physical activation key is a normal layer mapping to <code>F500–F50F</code>; the timed sequence lives separately in the slot.</p><ul><li><b>Record or insert:</b> capture keyboard operations, or add a key record manually and choose its key, Down/Up direction, and delay.</li><li><b>Arrange:</b> drag records or use the arrow buttons. Each HID page carries 15 records and this driver writes every required page.</li><li><b>Choose playback:</b> four click-repeat modes define what a second click does; two hold-repeat modes define whether releasing stops now or after the current run.</li><li><b>Repeat:</b> click modes accept 1–9999. Hold modes store the original driver’s <code>65535</code> infinite-repeat sentinel.</li><li><b>Apply safely:</b> mode metadata, all event pages, commit group 6, and the complete read-back are verified before the edit is accepted.</li></ul><p>The original UI allows 32768 ms while its packet encoder rejects values above 32767. This driver uses the protocol-safe 1–32767 ms range. The captured tutorial asset inventory contains no separate Macro WebM.</p></div><div class="combination-tutorial"><section><span>01</span><div><b>Select a slot</b><p>Read an existing slot before editing it. A slot may be referenced by more than one layer mapping.</p></div></section><section><span>02</span><div><b>Build the sequence</b><p>Keep Down and Up records paired unless you intentionally want a key to remain held.</p></div></section><section><span>03</span><div><b>Set playback</b><p>Use click modes for a finite repeat count or hold modes for playback that follows the physical host key.</p></div></section><section><span>04</span><div><b>Stage and apply</b><p>Staging updates the workspace; Apply changes writes the slot and activation-key mapping to the active onboard profile.</p></div></section></div>`,
  };
}

document.querySelector("#socdConfigDialog")?.addEventListener("close", () => stopMacroRecording({ render: false }));
