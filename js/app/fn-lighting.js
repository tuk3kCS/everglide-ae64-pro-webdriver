"use strict";

/* Static Fn profiles use a separate capability-checked extension. Factory RGB
 * state is deliberately not reused: its custom colors belong to the main layer.
 */
function fnLayerFromKeycode(keycode) {
  const code = Number(keycode);
  return code >= 0xf100 && code <= 0xf103 ? code - 0xf100 : null;
}
function resolvedLayerKeycode(key, layer) {
  for (let current = Math.max(0, Number(layer)); current >= 0; current -= 1) {
    const code = displayedKeycode(key, current);
    if (code !== 1) return code;
  }
  return 0;
}
function fnLightingKeyMeta(key, targetLayer) {
  const layer = Math.max(1, Math.min(3, Number(targetLayer))),
    raw = displayedKeycode(key, layer),
    inherited = resolvedLayerKeycode(key, layer - 1),
    resolved = raw === 1 ? inherited : raw;
  return {
    raw,
    inherited,
    resolved,
    override: raw > 1 && raw !== inherited,
  };
}
function fnTargetLayer() {
  if (state.hardware.fnPressed && Number(state.hardware.fnLayer) > 0)
    return Number(state.hardware.fnLayer);
  const fn = keys.find((key) => key.n === "Fn"),
    layer = fnLayerFromKeycode(fn ? resolvedLayerKeycode(fn, 0) : 0);
  return layer ?? 0;
}
const fnLightingView = {
  transport: null, client: null, caps: null, generation: 0, busy: false,
  selected: new Set([0]), color: "#73f0c0", selectionScope: "",
  drafts: new Map(), errors: new Map(),
};
function isFnLightingTab(tab = state.lightingTab) { return /^fn[123]$/.test(tab); }
function fnLightingLayer() { return isFnLightingTab() ? Number(state.lightingTab.slice(2)) : 1; }
function fnLightingProfile() { return Number(state.profile.profileIndex); }
function fnLightingEditing() { return isFnLightingTab() && fnLightingAvailable(); }
function fnLightingAvailable() {
  return Boolean(connected() && fnLightingView.transport === state.transport &&
    fnLightingView.caps?.verified && fnLightingView.caps.profiles === 4 &&
    fnLightingView.caps.layers === 3 && fnLightingView.caps.rows === 6 && fnLightingView.caps.cols === 21);
}
function resetFnLightingCapability() {
  fnLightingView.generation++;
  fnLightingView.transport = null; fnLightingView.client = null; fnLightingView.caps = null;
  fnLightingView.drafts.clear(); fnLightingView.errors.clear();
  if (isFnLightingTab() || state.lightingTab === "fn") state.lightingTab = "main";
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
    return true;
  } catch (_) { return false; }
}
function fnLightingDraftKey() { return `${fnLightingProfile()}:${fnLightingLayer()}`; }
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
  return fnLightingAvailable() ? [1, 2, 3].map((layer) => `<button type="button" role="tab" data-lighting-tab="fn${layer}" aria-selected="${state.lightingTab === `fn${layer}`}" class="${state.lightingTab === `fn${layer}` ? "active" : ""}"><span>0${layer + 3}</span>Fn ${layer}</button>`).join("") : "";
}
function fnLightingCellIndexes(key) {
  return lightingMatrixIndexes(key).filter((index) => Number.isInteger(index) && index >= 0 && index < 126);
}
function fnLightingPreview() {
  const draft = fnLightingDraft();
  return `<div class="keyboard fn-lighting-keyboard" aria-label="Fn ${fnLightingLayer()} static color preview">${layout.map((row, uiRow) => `<div class="keyboard-row">${row.map((_, col) => {
    const key = keys.find((candidate) => candidate.uiRow === uiRow && candidate.col === col),
      cells = fnLightingCellIndexes(key), colors = cells.map((index) => draft?.colors[index] || "#000000"),
      color = colors[0] || "#000000", selected = fnLightingView.selected.has(key.id),
      mapped = keycodeLabel(resolvedLayerKeycode(key, fnLightingLayer()));
    return `<button type="button" class="key custom-light ${selected ? "selected" : ""}" data-fn-lighting-key="${key.id}" style="--u:${key.u};--key-color:${esc(color)}" aria-pressed="${selected}" title="${esc(`${key.n} · ${color.toUpperCase()}`)}" ${!draft || fnLightingView.busy ? "disabled" : ""}><span class="mapped">${esc(mapped)}</span><b>${esc(key.n)}</b><i class="color-dot custom"></i>${colors.length > 1 ? `<span class="spacebar-lighting-leds" aria-hidden="true">${colors.map((value) => `<i style="--space-led-color:${value}"></i>`).join("")}</span>` : ""}</button>`;
  }).join("")}</div>`).join("")}</div>`;
}
function fnLightingUnifiedPreview() {
  return `<section class="panel unified-lighting-preview fn-unified-preview"><div class="panel-head"><div><h2>Fn ${fnLightingLayer()} lighting preview</h2><p>Drag over keys to select them. Ctrl/⌘+drag or click toggles keys. The light strip keeps its normal settings.</p></div><span class="badge">FN ${fnLightingLayer()} COLOR DRAFT</span></div><div class="unified-preview-scroll"><i class="lighting-selection-marquee" aria-hidden="true"></i>${stripHtml(fnLightingPreview())}</div><div class="board-footer"><span>Space sets all five LEDs. Preview changes stay local until Apply.</span><span id="lightingSelectionSummary">Selected: <b>${fnLightingView.selected.size}</b> key${fnLightingView.selected.size === 1 ? "" : "s"}</span></div></section>`;
}
function fnLightingLayout() {
  if (fnLightingView.selectionScope !== fnLightingDraftKey()) { fnLightingView.selectionScope = fnLightingDraftKey(); commitFnLightingSelection(fnLightingView.selected, [...fnLightingView.selected].at(-1)); }
  return `<div class="lighting-page lighting-context-${state.lightingTab} fn-lighting-context ${state.profile.lighting?.decorative?.base?.open === false ? "strip-off" : ""}"><section class="panel lighting-command"><div class="lighting-command-copy"><span class="eyebrow">FN LAYER COLORS</span><h2>Fn ${fnLightingLayer()} · static key lighting</h2><p>Editing ${esc(state.hardware.configNames[fnLightingProfile()] || `Profile ${fnLightingProfile() + 1}`)}, the active onboard profile.</p></div><span class="badge ready">CUSTOM FIRMWARE</span></section>${fnLightingUnifiedPreview()}<section class="panel lighting-section-nav">${lightingTabs()}</section>${fnLightingPage()}</div>`;
}
function commitFnLightingSelection(selection, primary) {
  fnLightingView.selected = new Set([...selection].filter((id) => keys.some((key) => key.id === id)));
  const id = fnLightingView.selected.has(primary) ? primary : [...fnLightingView.selected].at(-1), key = keys.find((item) => item.id === id);
  if (key) fnLightingView.color = fnLightingDraft()?.colors[fnLightingCellIndexes(key)[0]] || "#000000";
}
function fnLightingPage() {
  if (!fnLightingEditing()) return "";
  const draft = fnLightingDraft(), error = fnLightingView.errors.get(fnLightingDraftKey()),
    disabled = !draft || fnLightingView.busy, selected = fnLightingView.selected.size,
    persistent = Boolean(fnLightingView.caps.persistent), layer = fnLightingLayer(),
    profileName = state.hardware.configNames[fnLightingProfile()] || `Profile ${fnLightingProfile() + 1}`;
  return `<div class="fn-lighting-editor"><section class="panel">
    <div class="panel-head"><div><h2>Fn ${layer} colors · ${esc(profileName)}</h2><p>Select keys in the keyboard preview above, then set their color here.</p></div><span class="badge ${draft?.dirty ? "experimental" : ""}">${fnLightingView.busy ? "WORKING…" : draft?.dirty ? "UNSAVED CHANGES" : draft ? "READ FROM KEYBOARD" : "NOT READ"}</span></div>
    <p class="fn-lighting-storage">${persistent ? "Applied colors are saved on the keyboard and survive unplugging." : "Applied colors last for the current powered session. Export a backup to keep them."} Use the sidebar to switch the active profile.</p>
    ${error ? `<p class="fn-lighting-error" role="alert">${esc(error)}</p>` : ""}
    <label class="switch-row"><span><b>Use custom colors for Fn ${layer}</b><small>When disabled, this layer uses the factory action-group colors. Black turns an individual key off.</small></span><input id="fnLightingEnabled" class="toggle" type="checkbox" ${draft?.enabled ? "checked" : ""} ${disabled ? "disabled" : ""}></label>
    <div class="panel-head"><div><h2>Selected key colors</h2><p>${selected} key${selected === 1 ? "" : "s"} selected in the preview. Apply writes this Fn layer to the active profile.</p></div><div class="apply-row"><button class="button ghost" id="fnLightingSelectAll" ${disabled ? "disabled" : ""}>Select all keys</button><button class="button ghost" id="fnLightingClearSelection" ${disabled ? "disabled" : ""}>Clear selection</button></div></div>
    <div class="fn-lighting-color-row"><label class="field"><span>Color</span><input id="fnLightingColor" type="color" value="${fnLightingView.color}" ${disabled || !selected ? "disabled" : ""}></label><label class="field"><span>HEX</span><input id="fnLightingHex" type="text" value="${fnLightingView.color.toUpperCase()}" maxlength="7" data-keyboard-input="allow" ${disabled || !selected ? "disabled" : ""}></label><button class="button ghost" id="fnLightingBlack" ${disabled || !selected ? "disabled" : ""}>Turn selected keys off</button></div>
    <div class="preset-color-row">${["#ff3b30", "#ff9500", "#ffd60a", "#34c759", "#00c7be", "#32ade6", "#5856d6", "#af52de", "#ff2d55", "#ffffff"].map((color) => `<button type="button" data-fn-lighting-color="${color}" style="--preset:${color}" title="Set ${color}" ${disabled || !selected ? "disabled" : ""}></button>`).join("")}</div>
    <div class="apply-row fn-lighting-actions"><button class="button ghost" id="fnLightingRead" ${fnLightingView.busy ? "disabled" : ""}>Read Fn ${layer} colors</button><button class="button ghost" id="fnLightingExport" ${disabled ? "disabled" : ""}>Export Fn ${layer} colors</button><button class="button ghost" id="fnLightingImport" ${disabled ? "disabled" : ""}>Import Fn colors</button><input type="file" id="fnLightingImportFile" accept=".json,application/json" hidden><button class="button primary" id="fnLightingApply" ${disabled || !draft?.dirty ? "disabled" : ""}>Apply Fn ${layer} colors</button></div>
  </section></div>`;
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
async function fnLightingOperation(operation, saving = false) {
  if (!fnLightingAvailable() || fnLightingView.busy || state.writeInFlight || state.firmwareBusy || state.gamepadBusy) return;
  const generation = fnLightingView.generation, key = fnLightingDraftKey(),
    profile = fnLightingProfile(), layer = fnLightingLayer(), previousRevision = fnLightingDraft()?.revision;
  fnLightingView.busy = true; state.fnLightingBusy = true;
  stopPolling(); stopProfilePolling(); clearTimeout(state.timers.autoApply);
  document.querySelectorAll(".fn-lighting-editor input,.fn-lighting-editor select,.fn-lighting-editor button,[data-lighting-tab],[data-fn-lighting-key]").forEach((node) => { node.disabled = true; });
  renderStatus();
  try {
    const value = await operation(fnLightingView.client, profile, layer);
    if (generation !== fnLightingView.generation) return;
    fnLightingView.drafts.set(key, fnLightingNormalizeProfile(value)); fnLightingView.errors.delete(key);
    if (fnLightingDraftKey() === key) commitFnLightingSelection(fnLightingView.selected, [...fnLightingView.selected].at(-1));
    if (saving) for (const [otherKey, draft] of fnLightingView.drafts) {
      if (otherKey.startsWith(`${profile}:`) && draft.revision === previousRevision) draft.revision = Number(value.revision) >>> 0;
    }
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
  return fnLightingOperation(async (client, profile, layer) => {
    if (typeof readKeymapLayer === "function") for (let current = 0; current <= layer; current++) {
      if (typeof hardwareLayerReady !== "function" || !hardwareLayerReady(current)) await readKeymapLayer(current);
    }
    return client.read(profile, layer);
  });
}
function bindFnLightingPage() {
  if (state.page !== "lighting" || !fnLightingEditing()) return;
  const on = (selector, event, handler) => document.querySelector(selector)?.addEventListener(event, handler);
  on("#fnLightingEnabled", "change", (event) => {
    const draft = fnLightingDraft(); if (draft) { draft.enabled = event.target.checked; draft.dirty = true; render(); }
  });
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
    fnLightingOperation(async (client, profile, layer) => {
      const result = await client.write(profile, layer, { enabled: draft.enabled, colors: [...draft.colors], revision: draft.revision });
      return result || client.read(profile, layer);
    }, true);
  });
  on("#fnLightingExport", "click", () => {
    const draft = fnLightingDraft(); if (!draft) return;
    downloadJson(`ae64-profile-${fnLightingProfile() + 1}-fn-${fnLightingLayer()}.json`, {
      format: "ae64-fn-rgb", version: 1, rows: 6, cols: 21,
      profile: fnLightingProfile(), layer: fnLightingLayer(),
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
