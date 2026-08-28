"use strict";

/**
 * Shared key-value picker for advanced features.
 *
 * Key Combination, MPT, Mod-Tap, Toggle and End Trigger all choose one
 * 16-bit output value. Their allowed catalogs differ, but their interaction
 * should not. Callers provide grouped entries and a small completion callback.
 */
Object.assign(state, {
  advancedKeyPicker: null,
  advancedKeyPickerGroup: "basic",
  advancedKeyPickerSearch: "",
});

function advancedKeyPickerEntries(codes, disabled = new Set()) {
  return [...new Set(codes.map(Number))].map((code) => ({
    code,
    label: keycodeLabel(code),
    disabled: disabled.has(code),
  }));
}

function advancedKeyPickerGroups(groups, disabled = new Set()) {
  return groups
    .map((group) => ({
      id: String(group.id),
      label: String(group.label),
      entries: Array.isArray(group.entries)
        ? group.entries.map((entry) => ({
            code: Number(entry.code),
            label: String(entry.label || keycodeLabel(entry.code)),
            disabled: Boolean(entry.disabled || disabled.has(Number(entry.code))),
          }))
        : advancedKeyPickerEntries(group.codes || [], disabled),
    }))
    .filter((group) => group.entries.length);
}

function openAdvancedKeyPicker(options) {
  const disabled = new Set((options.disabledCodes || []).map(Number)),
    groups = advancedKeyPickerGroups(options.groups || [], disabled),
    current = Number(options.current) || 0,
    containing = groups.find((group) =>
      group.entries.some((entry) => entry.code === current),
    );
  if (!groups.length) return showToast("No compatible key values are available.", true);
  state.advancedKeyPicker = {
    title: options.title || "Choose key value",
    eyebrow: options.eyebrow || "SHARED ADVANCED KEY PICKER",
    context: options.context || "Advanced feature",
    description: options.description || "Choose one firmware-compatible key value.",
    current,
    groups,
    exclusion: options.exclusion || "Only values supported by this feature are shown.",
    allowClear: Boolean(options.allowClear),
    clearLabel: options.clearLabel || "Clear value",
    accent: options.accent || "var(--mint)",
    onSelect: options.onSelect,
    onClear: options.onClear,
  };
  state.advancedKeyPickerGroup = containing?.id || groups[0].id;
  state.advancedKeyPickerSearch = "";
  renderAdvancedKeyPicker();
  const dialog = document.querySelector("#advancedKeyPickerDialog");
  if (!dialog?.open) openDialog(dialog);
  queueMicrotask(() => document.querySelector("#advancedKeyPickerSearch")?.focus());
}

function renderAdvancedKeyPicker() {
  const picker = state.advancedKeyPicker,
    body = document.querySelector("#advancedKeyPickerBody"),
    title = document.querySelector("#advancedKeyPickerTitle"),
    eyebrow = document.querySelector("#advancedKeyPickerEyebrow");
  if (!picker || !body) return;
  const group = picker.groups.find((entry) => entry.id === state.advancedKeyPickerGroup) || picker.groups[0],
    query = state.advancedKeyPickerSearch.trim().toLowerCase(),
    entries = group.entries.filter((entry) => entry.label.toLowerCase().includes(query)),
    currentLabel = picker.current ? keycodeLabel(picker.current) : "Not assigned";
  if (title) title.textContent = picker.title;
  if (eyebrow) eyebrow.textContent = picker.eyebrow;
  body.style.setProperty("--picker-accent", picker.accent);
  body.innerHTML = `<div class="advanced-picker-shell"><aside class="advanced-picker-sidebar"><div class="advanced-picker-context"><span>${esc(picker.context)}</span><strong>${esc(currentLabel)}</strong><small>${esc(picker.description)}</small></div><div class="advanced-picker-tabs" role="tablist" aria-label="Compatible key groups">${picker.groups.map((entry) => `<button type="button" role="tab" data-advanced-picker-group="${esc(entry.id)}" class="${entry.id === group.id ? "active" : ""}" aria-selected="${entry.id === group.id}"><span>${esc(entry.label)}</span><b>${entry.entries.length}</b></button>`).join("")}</div>${picker.allowClear && picker.current ? `<button class="button ghost advanced-picker-clear" id="clearAdvancedPickerValue" type="button">${esc(picker.clearLabel)}</button>` : ""}</aside><section class="advanced-picker-catalog"><label class="advanced-picker-search"><span>Search compatible values</span><input class="search-input" id="advancedKeyPickerSearch" type="search" autocomplete="off" placeholder="Type a key name…" value="${esc(state.advancedKeyPickerSearch)}"></label><div class="advanced-picker-grid">${entries.length ? entries.map((entry) => `<button type="button" data-advanced-picker-code="${entry.code}" data-advanced-picker-label="${esc(entry.label.toLowerCase())}" class="${entry.code === picker.current ? "active" : ""}" ${entry.disabled ? "disabled" : ""}><span>${entry.code === picker.current ? "CURRENT" : entry.disabled ? "IN USE" : "KEY VALUE"}</span><b>${esc(entry.label)}</b><small>0x${entry.code.toString(16).padStart(4, "0").toUpperCase()}</small></button>`).join("") : '<p class="advanced-picker-empty">No matching key values in this group.</p>'}</div><p class="advanced-picker-exclusion">${esc(picker.exclusion)}</p></section></div>`;
  bindAdvancedKeyPicker();
}

function bindAdvancedKeyPicker() {
  document.querySelectorAll("[data-advanced-picker-group]").forEach((button) =>
    button.addEventListener("click", () => {
      state.advancedKeyPickerGroup = button.dataset.advancedPickerGroup;
      state.advancedKeyPickerSearch = "";
      renderAdvancedKeyPicker();
    }),
  );
  document.querySelector("#advancedKeyPickerSearch")?.addEventListener("input", (event) => {
    state.advancedKeyPickerSearch = event.target.value;
    renderAdvancedKeyPicker();
    const search = document.querySelector("#advancedKeyPickerSearch");
    search?.focus();
    search?.setSelectionRange(search.value.length, search.value.length);
  });
  document.querySelectorAll("[data-advanced-picker-code]").forEach((button) =>
    button.addEventListener("click", () => {
      const picker = state.advancedKeyPicker,
        code = Number(button.dataset.advancedPickerCode);
      picker.current = code;
      closeDialog(document.querySelector("#advancedKeyPickerDialog"));
      picker.onSelect?.(code);
    }),
  );
  document.querySelector("#clearAdvancedPickerValue")?.addEventListener("click", () => {
    const picker = state.advancedKeyPicker;
    closeDialog(document.querySelector("#advancedKeyPickerDialog"));
    picker.onClear?.();
  });
}

