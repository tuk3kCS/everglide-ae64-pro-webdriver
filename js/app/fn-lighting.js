"use strict";

/* Static Fn profiles use a separate capability-checked extension. Factory RGB
 * state is deliberately not reused: its custom colors belong to the main layer.
 */
const fnLightingView = {
  transport: null, client: null, caps: null, generation: 0, busy: false,
  profile: 0, layer: 1, selected: new Set([0]), color: "#73f0c0",
  drafts: new Map(), errors: new Map(),
};
function fnLightingAvailable() {
  return Boolean(connected() && fnLightingView.transport === state.transport &&
    fnLightingView.caps?.verified && fnLightingView.caps.profiles === 4 &&
    fnLightingView.caps.layers === 3 && fnLightingView.caps.rows === 6 && fnLightingView.caps.cols === 21);
}
function resetFnLightingCapability() {
  fnLightingView.generation++;
  fnLightingView.transport = null; fnLightingView.client = null; fnLightingView.caps = null;
  fnLightingView.drafts.clear(); fnLightingView.errors.clear();
  if (state.lightingTab === "fn") state.lightingTab = "main";
}
async function probeFnLighting(transport) {
  resetFnLightingCapability();
  const generation = fnLightingView.generation;
  if (!transport || !window.AE64FnRgb?.Client) return false;
  try {
    const client = new window.AE64FnRgb.Client(transport), caps = await client.capabilities();
    if (generation !== fnLightingView.generation || state.transport !== transport) return false;
    if (!caps?.verified || caps.profiles !== 4 || caps.layers !== 3 || caps.rows !== 6 || caps.cols !== 21) return false;
    fnLightingView.transport = transport; fnLightingView.client = client; fnLightingView.caps = caps;
    fnLightingView.profile = Math.max(0, Math.min(3, Number(state.profile.profileIndex) || 0));
    return true;
  } catch (_) { return false; }
}
function fnLightingDraftKey() { return `${fnLightingView.profile}:${fnLightingView.layer}`; }
function fnLightingDraft() { return fnLightingView.drafts.get(fnLightingDraftKey()); }
function fnLightingNormalizeProfile(value) {
  if (!value || typeof value.enabled !== "boolean" || !Array.isArray(value.colors) || value.colors.length !== 126)
    throw new Error("This Fn profile must contain an enabled setting and 126 RGB cells.");
  const colors = value.colors.map((color) => {
    const normalized = normalizeHex(color);
    if (!normalized) throw new Error("Every Fn color must use a six-digit HEX value.");
    return normalized;
  });
  return { enabled: value.enabled, colors, revision: Number(value.revision) >>> 0, dirty: false };
}
function fnLightingTabButton() {
  return fnLightingAvailable() ? `<button type="button" role="tab" data-lighting-tab="fn" aria-selected="${state.lightingTab === "fn"}" class="${state.lightingTab === "fn" ? "active" : ""}"><span>04</span>Fn layers</button>` : "";
}
function fnLightingCellIndexes(key) {
  return lightingMatrixIndexes(key).filter((index) => Number.isInteger(index) && index >= 0 && index < 126);
}
function fnLightingPreview() {
  const draft = fnLightingDraft();
  return `<div class="fn-lighting-preview-scroll"><div class="keyboard fn-lighting-keyboard" aria-label="Fn ${fnLightingView.layer} static color preview">${layout.map((row, uiRow) => `<div class="keyboard-row">${row.map((_, col) => {
    const key = keys.find((candidate) => candidate.uiRow === uiRow && candidate.col === col),
      cells = fnLightingCellIndexes(key), colors = cells.map((index) => draft?.colors[index] || "#000000"),
      color = colors[0] || "#000000", selected = fnLightingView.selected.has(key.id),
      mapped = keycodeLabel(resolvedLayerKeycode(key, fnLightingView.layer));
    return `<button type="button" class="key custom-light ${selected ? "selected" : ""}" data-fn-lighting-key="${key.id}" style="--u:${key.u};--key-color:${esc(color)}" aria-pressed="${selected}" title="${esc(`${key.n} · ${color.toUpperCase()}`)}"><span class="mapped">${esc(mapped)}</span><b>${esc(key.n)}</b><i class="color-dot custom"></i>${colors.length > 1 ? `<span class="spacebar-lighting-leds" aria-hidden="true">${colors.map((value) => `<i style="--space-led-color:${value}"></i>`).join("")}</span>` : ""}</button>`;
  }).join("")}</div>`).join("")}</div></div>`;
}
function fnLightingPage() {
  if (!fnLightingAvailable()) return "";
  const draft = fnLightingDraft(), error = fnLightingView.errors.get(fnLightingDraftKey()),
    disabled = !draft || fnLightingView.busy, selected = fnLightingView.selected.size,
    persistent = Boolean(fnLightingView.caps.persistent),
    activeProfile = Number(state.profile.profileIndex) === fnLightingView.profile,
    profileName = state.hardware.configNames[fnLightingView.profile] || `Profile ${fnLightingView.profile + 1}`;
  return `<div class="fn-lighting-editor">
    <section class="panel"><div class="panel-head"><div><h2>Static lighting while Fn is held</h2><p>Choose colors for each key in each Fn layer. Releasing Fn restores the main lighting effect. The live preview above shows the normal effect; this Fn preview shows your draft.</p></div><span class="badge ready">CUSTOM FIRMWARE</span></div>
      <div class="fn-lighting-selectors"><label class="field"><span>Onboard profile to edit</span><select id="fnLightingProfile" ${fnLightingView.busy ? "disabled" : ""}>${[0, 1, 2, 3].map((index) => `<option value="${index}" ${index === fnLightingView.profile ? "selected" : ""}>${esc(state.hardware.configNames[index] || `Profile ${index + 1}`)}${Number(state.profile.profileIndex) === index ? " · active" : ""}</option>`).join("")}</select></label><label class="field"><span>Fn layer</span><select id="fnLightingLayer" ${fnLightingView.busy ? "disabled" : ""}>${[1, 2, 3].map((layer) => `<option value="${layer}" ${layer === fnLightingView.layer ? "selected" : ""}>Fn ${layer}</option>`).join("")}</select></label><span class="badge ${draft?.dirty ? "experimental" : ""}">${fnLightingView.busy ? "WORKING…" : draft?.dirty ? "UNSAVED CHANGES" : draft ? "READ FROM KEYBOARD" : "NOT READ"}</span></div>
      <p class="fn-lighting-storage">${persistent ? "Applied colors are saved on the keyboard and survive unplugging." : "Applied colors last for the current powered session. Export a backup to keep them."} Editing another profile here does not switch the keyboard's active profile.</p>
      ${!activeProfile ? `<p class="fn-lighting-storage">To apply this Fn profile, select ${esc(profileName)} in the sidebar's profile selector first. Reading and editing its colors here is available now.</p>` : ""}
      ${error ? `<p class="fn-lighting-error" role="alert">${esc(error)}</p>` : ""}
      <label class="switch-row"><span><b>Use custom colors for ${esc(profileName)} · Fn ${fnLightingView.layer}</b><small>When disabled, this Fn layer uses the factory action-group colors. Black turns an individual key off.</small></span><input id="fnLightingEnabled" class="toggle" type="checkbox" ${draft?.enabled ? "checked" : ""} ${disabled ? "disabled" : ""}></label>
      ${fnLightingPreview()}<div class="board-footer"><span>Click keys to select them. Ctrl/⌘+click toggles additional keys. Space sets all five LEDs.</span><span>${selected} selected</span></div>
    </section>
    <section class="panel"><div class="panel-head"><div><h2>Selected key colors</h2><p>The preview shows your draft. Use Apply Fn profile to write it to the keyboard.</p></div><div class="apply-row"><button class="button ghost" id="fnLightingSelectAll" ${disabled ? "disabled" : ""}>Select all keys</button><button class="button ghost" id="fnLightingClearSelection" ${disabled ? "disabled" : ""}>Clear selection</button></div></div>
      <div class="fn-lighting-color-row"><label class="field"><span>Color</span><input id="fnLightingColor" type="color" value="${fnLightingView.color}" ${disabled || !selected ? "disabled" : ""}></label><label class="field"><span>HEX</span><input id="fnLightingHex" type="text" value="${fnLightingView.color.toUpperCase()}" maxlength="7" data-keyboard-input="allow" ${disabled || !selected ? "disabled" : ""}></label><button class="button ghost" id="fnLightingBlack" ${disabled || !selected ? "disabled" : ""}>Turn selected keys off</button></div>
      <div class="preset-color-row">${["#ff3b30", "#ff9500", "#ffd60a", "#34c759", "#00c7be", "#32ade6", "#5856d6", "#af52de", "#ff2d55", "#ffffff"].map((color) => `<button type="button" data-fn-lighting-color="${color}" style="--preset:${color}" title="Set ${color}" ${disabled || !selected ? "disabled" : ""}></button>`).join("")}</div>
      <div class="apply-row fn-lighting-actions"><button class="button ghost" id="fnLightingRead" ${fnLightingView.busy ? "disabled" : ""}>Read Fn profile</button><button class="button ghost" id="fnLightingExport" ${disabled ? "disabled" : ""}>Export Fn profile</button><button class="button ghost" id="fnLightingImport" ${fnLightingView.busy ? "disabled" : ""}>Import Fn profile</button><input type="file" id="fnLightingImportFile" accept=".json,application/json" hidden><button class="button primary" id="fnLightingApply" ${disabled || !draft?.dirty || !activeProfile ? "disabled" : ""}>Apply Fn profile</button></div>
    </section>
  </div>`;
}
function fnLightingStageColor(value) {
  const color = normalizeHex(value), draft = fnLightingDraft();
  if (!color || !draft || fnLightingView.busy) return false;
  fnLightingView.color = color;
  for (const id of fnLightingView.selected) {
    const key = keys.find((candidate) => candidate.id === id);
    if (key) for (const index of fnLightingCellIndexes(key)) draft.colors[index] = color;
  }
  if (fnLightingView.selected.size) draft.dirty = true;
  return true;
}
async function fnLightingOperation(operation) {
  if (!fnLightingAvailable() || fnLightingView.busy || state.writeInFlight || state.firmwareBusy || state.gamepadBusy) return;
  const generation = fnLightingView.generation, key = fnLightingDraftKey(),
    profile = fnLightingView.profile, layer = fnLightingView.layer;
  fnLightingView.busy = true; state.fnLightingBusy = true;
  stopPolling(); stopProfilePolling(); clearTimeout(state.timers.autoApply);
  document.querySelectorAll(".fn-lighting-editor input,.fn-lighting-editor select,.fn-lighting-editor button,[data-lighting-tab]").forEach((node) => { node.disabled = true; });
  renderStatus();
  try {
    const value = await operation(fnLightingView.client, profile, layer);
    if (generation !== fnLightingView.generation) return;
    fnLightingView.drafts.set(key, fnLightingNormalizeProfile(value)); fnLightingView.errors.delete(key);
  } catch (error) {
    if (generation === fnLightingView.generation) {
      fnLightingView.errors.set(key, error.message || String(error)); showToast(error.message || String(error), true);
    }
  } finally {
    fnLightingView.busy = false; state.fnLightingBusy = false;
    if (connected()) startProfilePolling();
    if (state.page === "lighting") render(); else renderStatus();
  }
}
function fnLightingRead() {
  return fnLightingOperation((client, profile, layer) => client.read(profile, layer));
}
function bindFnLightingPage() {
  if (state.page !== "lighting" || state.lightingTab !== "fn" || !fnLightingAvailable()) return;
  const on = (selector, event, handler) => document.querySelector(selector)?.addEventListener(event, handler);
  on("#fnLightingProfile", "change", (event) => { fnLightingView.profile = Number(event.target.value); render(); });
  on("#fnLightingLayer", "change", (event) => { fnLightingView.layer = Number(event.target.value); render(); });
  on("#fnLightingEnabled", "change", (event) => {
    const draft = fnLightingDraft(); if (draft) { draft.enabled = event.target.checked; draft.dirty = true; render(); }
  });
  document.querySelectorAll("[data-fn-lighting-key]").forEach((button) => button.addEventListener("click", (event) => {
    if (!fnLightingDraft() || fnLightingView.busy) return;
    const id = Number(button.dataset.fnLightingKey);
    if (event.ctrlKey || event.metaKey) {
      if (fnLightingView.selected.has(id)) fnLightingView.selected.delete(id); else fnLightingView.selected.add(id);
    } else fnLightingView.selected = new Set([id]);
    const key = keys.find((candidate) => candidate.id === id), index = fnLightingCellIndexes(key)[0];
    fnLightingView.color = fnLightingDraft().colors[index] || "#000000"; render();
  }));
  on("#fnLightingSelectAll", "click", () => { fnLightingView.selected = new Set(keys.map((key) => key.id)); render(); });
  on("#fnLightingClearSelection", "click", () => { fnLightingView.selected.clear(); render(); });
  on("#fnLightingColor", "change", (event) => { fnLightingStageColor(event.target.value); render(); });
  on("#fnLightingHex", "change", (event) => {
    if (!fnLightingStageColor(event.target.value)) showToast("Use a six-digit HEX color, for example #73F0C0.", true);
    render();
  });
  on("#fnLightingBlack", "click", () => { fnLightingStageColor("#000000"); render(); });
  document.querySelectorAll("[data-fn-lighting-color]").forEach((button) => button.addEventListener("click", () => { fnLightingStageColor(button.dataset.fnLightingColor); render(); }));
  on("#fnLightingRead", "click", fnLightingRead);
  on("#fnLightingApply", "click", () => {
    const draft = fnLightingDraft();
    if (!draft?.dirty) return;
    if (Number(state.profile.profileIndex) !== fnLightingView.profile) {
      showToast("Select the matching onboard profile in the sidebar before applying its Fn colors.", true); return;
    }
    fnLightingOperation(async (client, profile, layer) => {
      const result = await client.write(profile, layer, { enabled: draft.enabled, colors: [...draft.colors], revision: draft.revision });
      return result || client.read(profile, layer);
    });
  });
  on("#fnLightingExport", "click", () => {
    const draft = fnLightingDraft(); if (!draft) return;
    downloadJson(`ae64-profile-${fnLightingView.profile + 1}-fn-${fnLightingView.layer}.json`, {
      format: "ae64-fn-rgb", version: 1, rows: 6, cols: 21,
      profile: fnLightingView.profile, layer: fnLightingView.layer,
      enabled: draft.enabled, colors: draft.colors,
    });
  });
  on("#fnLightingImport", "click", () => document.querySelector("#fnLightingImportFile")?.click());
  on("#fnLightingImportFile", "change", async (event) => {
    const file = event.target.files?.[0], generation = fnLightingView.generation, key = fnLightingDraftKey();
    if (!file) return;
    try {
      if (file.size > 32768) throw new Error("This file is too large for an Fn color profile.");
      const value = JSON.parse(await file.text());
      if (value.format !== "ae64-fn-rgb" || value.version !== 1 || value.rows !== 6 || value.cols !== 21)
        throw new Error("Choose an AE64 Fn color profile exported by this editor.");
      if (generation !== fnLightingView.generation || key !== fnLightingDraftKey()) return;
      const draft = fnLightingNormalizeProfile(value);
      draft.revision = fnLightingDraft()?.revision || 0; draft.dirty = true;
      fnLightingView.drafts.set(key, draft); fnLightingView.errors.delete(key); render();
    } catch (error) { showToast(error.message || String(error), true); }
  });
  if (!fnLightingDraft() && !fnLightingView.errors.has(fnLightingDraftKey())) fnLightingRead();
}
