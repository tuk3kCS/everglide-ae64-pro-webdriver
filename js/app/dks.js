"use strict";

/** Dynamic Keystroke (mode 1), reconstructed from the captured AE64 driver. */
const DKS_CAPTURED_HOST_CODES = Object.freeze([
  ...Array.from({ length: 112 }, (_, index) => index + 4),
  ...Array.from({ length: 8 }, (_, index) => index + 224),
]);
const DKS_CAPTURED_LEGACY_EXTENDED_CODES = Object.freeze(MPT_CAPTURED_EXTENDED_CODES.filter((code) => code < 224));
const DKS_CAPTURED_MOUSE_CODES = Object.freeze([0x4000, 0x4100, 0x4200, 0x4300, 0x4400, 0x4500, 0x4600, 0x4700, 0x4800, 0x4900, 0x4a01, 0x4b01]);
const DKS_HOST_CODE_SET = new Set(DKS_CAPTURED_HOST_CODES);
const DKS_TIMELINE_POINTS = Object.freeze([
  { mask: 0x01, label: "P1", detail: "shallow press", shape: "event", phase: "down" },
  { mask: 0x02, label: "S", detail: "downstroke span", shape: "span", phase: "down" },
  { mask: 0x04, label: "P2", detail: "deep press", shape: "event", phase: "down" },
  { mask: 0x18, label: "S", detail: "bottom span", shape: "span", phase: "turn" },
  { mask: 0x20, label: "R2", detail: "deep release", shape: "event", phase: "up" },
  { mask: 0x40, label: "S", detail: "upstroke span", shape: "span", phase: "up" },
  { mask: 0x80, label: "R1", detail: "shallow release", shape: "event", phase: "up" },
]);
const DKS_ACTION_COLORS = Object.freeze(["#ff6f91", "#ffb454", "#6fa8ff", "#73f0c0"]);
Object.assign(state, { dksKeyPickerSlot: 0, dksKeyPickerGroup: "basic", dksTimelinePaint: null });

function dksFirmwareAtLeast(target) {
  const firmware = String(state.hardware.info?.firmware || "").trim();
  if (!firmware) return true;
  const current = firmware.split(".").map(Number), required = String(target).split(".").map(Number);
  if (current.some((part) => !Number.isFinite(part))) return true;
  for (let index = 0; index < Math.max(current.length, required.length); index += 1) {
    const difference = (current[index] || 0) - (required[index] || 0);
    if (difference) return difference > 0;
  }
  return true;
}
function dksSupportsExpandedOutputs() { return dksFirmwareAtLeast("1.1.3.0"); }
function dksKeyGroups() {
  const expanded = dksSupportsExpandedOutputs(), groups = [
    { id: "basic", label: "Basic keys", codes: MPT_CAPTURED_BASIC_CODES },
    { id: "extended", label: "Extended keys", codes: expanded ? MPT_CAPTURED_EXTENDED_CODES : DKS_CAPTURED_LEGACY_EXTENDED_CODES },
  ];
  if (expanded) groups.push({ id: "mouse", label: "Mouse", codes: DKS_CAPTURED_MOUSE_CODES });
  return groups;
}
function dksOutputAllowed(code) { return dksKeyGroups().some((group) => group.codes.includes(Number(code))); }
function dksTravelLimit() { return 3.3; }
function dksHostEligible(key) { return DKS_HOST_CODE_SET.has(Number(key ? displayedKeycode(key, 0) : 0)); }
function dksDefaultLimits(host) {
  const max = dksTravelLimit(host), deep = Math.max(0.2, Math.min(max, 3));
  return [Math.min(1.5, Number((deep - 0.1).toFixed(1))), deep];
}
function normalizeDksDraft(draft = state.advancedDraft) {
  const requested = keys[Number(draft?.hostId)], host = dksHostEligible(requested) ? requested : keys.find(dksHostEligible) || keys[0],
    max = dksTravelLimit(host), defaults = dksDefaultLimits(host), rawShallow = Number(draft?.dbs?.[0]), rawDeep = Number(draft?.dbs?.[1]),
    shallow = Math.round(clamp(Number.isFinite(rawShallow) ? rawShallow : defaults[0], 0.1, Math.max(0.1, max - 0.1)) * 10) / 10,
    deep = Math.round(clamp(Number.isFinite(rawDeep) ? rawDeep : defaults[1], shallow + 0.1, max) * 10) / 10;
  return {
    feature: "DKS", hostId: host.id,
    keycodes: Array.from({ length: 4 }, (_, index) => dksOutputAllowed(draft?.keycodes?.[index]) ? Number(draft.keycodes[index]) : 0),
    travels: Array.from({ length: 4 }, (_, index) => normalizeDksMask(draft?.travels?.[index])),
    dbs: [shallow, deep],
  };
}
function defaultDksDraft(hostId = state.profile.selected) { return normalizeDksDraft({ feature: "DKS", hostId }); }
function dksDraftFromRecord(host, record) {
  return normalizeDksDraft({ feature: "DKS", hostId: host.id, keycodes: record?.keycodes, travels: record?.travels, dbs: record?.deadzones });
}
function dksPointActive(mask, point) { return (Number(mask) & DKS_TIMELINE_POINTS[point].mask) === DKS_TIMELINE_POINTS[point].mask; }
function normalizeDksMask(mask) {
  return DKS_TIMELINE_POINTS.reduce((normalized, point, index) => dksPointActive(mask, index) ? normalized | point.mask : normalized, 0);
}
function dksMaskSummary(mask) {
  return DKS_TIMELINE_POINTS.filter((_, point) => dksPointActive(mask, point)).map(({ label, detail }) => `${label} ${detail}`).join(", ") || "No lifecycle points";
}
function dksDraftDetails(draft = state.advancedDraft) {
  const normalized = normalizeDksDraft(draft);
  return normalized.keycodes.map((code, index) => code ? `A${index + 1} ${keycodeLabel(code)}: ${dksMaskSummary(normalized.travels[index])}` : "").filter(Boolean).join(" · ");
}
function dksHostKeyboardHtml() {
  const draft = normalizeDksDraft(state.advancedDraft);
  return `<div class="mpt-host-board"><div class="keyboard mpt-host-keyboard" aria-label="Choose the physical key that runs Dynamic Keystroke">${layout.map((row, uiRow) => `<div class="keyboard-row">${row.map((_, col) => {
    const key = keys.find((candidate) => candidate.uiRow === uiRow && candidate.col === col), selected = Number(draft.hostId) === key.id, eligible = dksHostEligible(key);
    return `<button class="key mpt-host-key ${selected ? "selected" : ""}" style="--u:${key.u}" type="button" data-dks-host="${key.id}" aria-pressed="${selected}" ${eligible ? "" : "disabled"} title="${eligible ? `Use physical ${esc(key.n)} for DKS` : "The original driver only allows a basic keyboard mapping as a DKS host"}"><span class="mapped">${esc(key.n)}</span><b>${esc(keycodeLabel(displayedKeycode(key, 0)))}</b></button>`;
  }).join("")}</div>`).join("")}</div></div>`;
}
function dksTimelineHeader(draft) {
  const [shallow, deep] = draft.dbs;
  return `<div class="dks-timeline-head"><span></span>${DKS_TIMELINE_POINTS.map((point, index) => `<div class="${point.phase}"><b>${point.label}</b><small>${index === 0 || index === 6 ? `${shallow.toFixed(1)} mm` : index === 2 || index === 4 ? `${deep.toFixed(1)} mm` : point.detail}</small></div>`).join("")}<span></span></div>`;
}
function dksActionRow(draft, row) {
  const code = Number(draft.keycodes[row]), mask = Number(draft.travels[row]), color = DKS_ACTION_COLORS[row];
  return `<article class="dks-action-row ${code ? "assigned" : "empty"}" style="--dks-action:${color}"><button type="button" class="dks-action-key" data-dks-bind="${row}"><span>ACTION ${row + 1}</span><b>${esc(code ? keycodeLabel(code) : "Choose key")}</b><small>${code ? `0x${code.toString(16).padStart(4, "0").toUpperCase()}` : "Choose an output value"}</small></button><div class="dks-timeline" role="group" aria-label="Action ${row + 1} lifecycle">${DKS_TIMELINE_POINTS.map((point, index) => `${index ? `<i data-dks-link="${row}:${index - 1}" class="${dksPointActive(mask, index - 1) && dksPointActive(mask, index) ? "active" : ""}"></i>` : ""}<button type="button" data-dks-point="${row}:${index}" class="${point.shape} ${dksPointActive(mask, index) ? "active" : ""}" aria-pressed="${dksPointActive(mask, index)}" aria-label="Action ${row + 1}: ${point.label} ${point.detail}" title="${point.label} ${point.detail}" ${code ? "" : "disabled"}><span></span></button>`).join("")}</div><button class="dks-clear-action" type="button" data-dks-clear="${row}" ${code ? "" : "disabled"}>Clear</button></article>`;
}
function dksEditor() {
  const draft = state.advancedDraft = normalizeDksDraft(state.advancedDraft), host = keys[Number(draft.hostId)] || keys[0], max = dksTravelLimit(host), active = draft.keycodes.filter(Number).length;
  return `<div class="dks-editor"><div class="panel-head"><div><span class="eyebrow">CAPTURE-VERIFIED MODE 1</span><h2>Dynamic Keystroke</h2><p>Place up to four key values across one complete press-and-release lifecycle.</p></div><span class="badge ${active ? "ready" : "experimental"}">${active}/4 ACTIONS</span></div><div class="mpt-host-heading"><div><h3>Physical host key</h3><p>The original AE64 DKS editor uses a fixed 0.1–3.3 mm threshold range.</p></div><strong>${esc(host.n)} · DKS 3.3 mm</strong></div>${dksHostKeyboardHtml()}<div class="dks-thresholds"><div><span>DOWNSTROKE</span><b>Press phase</b><small>Cross P1, then P2</small></div><label><span>Shallow point · db1</span><div class="input-with-unit"><input id="dksDb1" type="number" min="0.1" max="${Math.max(0.1, draft.dbs[1] - 0.1).toFixed(1)}" step="0.1" value="${draft.dbs[0].toFixed(1)}"><span>mm</span></div></label><label><span>Deep point · db2</span><div class="input-with-unit"><input id="dksDb2" type="number" min="${Math.min(max, draft.dbs[0] + 0.1).toFixed(1)}" max="${max.toFixed(1)}" step="0.1" value="${draft.dbs[1].toFixed(1)}"><span>mm</span></div></label><div class="release"><span>UPSTROKE</span><b>Release phase</b><small>Cross R2, then R1</small></div></div><div class="dks-sequence"><div class="dks-sequence-heading"><div><h3>Action lifecycle</h3><p>Toggle the original P1–S–P2–S–R2–S–R1 cells. Dragging is an optional shortcut for painting adjacent cells.</p></div><div class="dks-legend"><span><i class="event"></i>P/R event</span><span><i class="span"></i>S span</span></div></div>${dksTimelineHeader(draft)}<div class="dks-action-stack">${Array.from({ length: 4 }, (_, row) => dksActionRow(draft, row)).join("")}</div></div><div class="dks-firmware-note"><b>AE64 encoding</b><p>The seven visible cells map to each action’s captured 8-bit mask. The center S cell represents both internal turnaround bits, exactly as the original driver writes them.</p></div><div class="dks-footer"><div><span>ORIGINAL FIRMWARE RANGE</span><strong>0.1–${max.toFixed(1)} mm · 0.1 mm steps</strong><small>At least one output key is required. Each lifecycle cell remains independently optional, as in the original editor.</small></div><div class="apply-row"><button class="button ghost" id="readDksAdvanced" type="button" ${connected() ? "" : "disabled"}>Read selected record</button><button class="button primary" id="stageDks" type="button" ${active ? "" : "disabled"}>Stage DKS</button></div></div>${state.dirty.advanced && draft.feature === "DKS" ? '<p class="socd-stage-note">This DKS record is staged. Apply changes to write and verify it.</p>' : ""}</div>`;
}
function renderDksConfiguration() {
  const body = document.querySelector("#socdConfigBody"), title = document.querySelector("#socdConfigTitle");
  if (!body) return;
  if (title) title.textContent = "Configure DKS";
  body.innerHTML = dksEditor(); bindDksConfiguration();
}
function selectDksHost(id) {
  const host = keys[Number(id)];
  if (!dksHostEligible(host)) return showToast("The original driver only allows a basic keyboard mapping as a DKS host.", true);
  const record = state.hardware.advancedByKey.get(host.id);
  state.advancedDraft = Number(record?.mode) === ADVANCED_MODE.DKS ? dksDraftFromRecord(host, record) : defaultDksDraft(host.id);
  state.profile.selected = host.id; state.selectedKeys = new Set([host.id]); renderDksConfiguration();
}
function openDksConfiguration() {
  if (!(state.dirty.advanced && state.advancedDraft.feature === "DKS")) {
    const selected = selectedKey(), host = dksHostEligible(selected) ? selected : keys.find(dksHostEligible);
    selectDksHost(host.id);
  } else renderDksConfiguration();
  openDialog(document.querySelector("#socdConfigDialog"));
}
function setDksThreshold(index, value) {
  const draft = state.advancedDraft, host = keys[Number(draft.hostId)], max = dksTravelLimit(host), parsed = Number(value), rounded = Math.round(parsed * 10) / 10;
  if (!Number.isFinite(parsed)) return renderDksConfiguration();
  if (index === 0) draft.dbs[0] = clamp(rounded, 0.1, draft.dbs[1] - 0.1);
  else draft.dbs[1] = clamp(rounded, draft.dbs[0] + 0.1, max);
  renderDksConfiguration();
}
function syncDksTimelineRow(row) {
  const mask = Number(state.advancedDraft.travels[row]);
  document.querySelectorAll(`[data-dks-point^="${row}:"]`).forEach((button) => {
    const point = Number(button.dataset.dksPoint.split(":")[1]), active = dksPointActive(mask, point);
    button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll(`[data-dks-link^="${row}:"]`).forEach((link) => {
    const point = Number(link.dataset.dksLink.split(":")[1]); link.classList.toggle("active", dksPointActive(mask, point) && dksPointActive(mask, point + 1));
  });
}
function setDksTimelinePoint(row, point, active) {
  const bit = DKS_TIMELINE_POINTS[point].mask, current = Number(state.advancedDraft.travels[row]);
  state.advancedDraft.travels[row] = active ? current | bit : current & ~bit; syncDksTimelineRow(row);
}
function renderDksKeyPicker() {
  const body = document.querySelector("#mptKeyPickerBody"), title = document.querySelector("#mptKeyPickerTitle"), slot = Number(state.dksKeyPickerSlot), current = Number(state.advancedDraft.keycodes[slot]), groups = dksKeyGroups(), group = groups.find((entry) => entry.id === state.dksKeyPickerGroup) || groups[0];
  if (!body) return;
  if (title) title.textContent = `Choose DKS action ${slot + 1}`;
  body.innerHTML = `<div class="mpt-picker-summary dks-picker-summary"><span>ACTION ${slot + 1}</span><b>${esc(current ? keycodeLabel(current) : "Not assigned")}</b><small>This is the Basic / Extended / Mouse palette exposed by the captured AE64 editor for this firmware.</small></div><input class="search-input" id="dksKeySearch" type="search" placeholder="Search compatible key values" autocomplete="off"><div class="mpt-picker-tabs" role="tablist" aria-label="DKS output group">${groups.map((entry) => `<button type="button" role="tab" data-dks-key-group="${entry.id}" class="${entry.id === group.id ? "active" : ""}" aria-selected="${entry.id === group.id}">${entry.label}<span>${entry.codes.length}</span></button>`).join("")}</div><div class="mpt-key-grid dks-key-grid">${group.codes.map((code) => { const label = keycodeLabel(code); return `<button type="button" data-dks-keycode="${code}" data-dks-key-label="${esc(label.toLowerCase())}" class="${code === current ? "active" : ""}"><b>${esc(label)}</b><small>0x${code.toString(16).padStart(4, "0").toUpperCase()}</small></button>`; }).join("")}</div><p class="mpt-picker-exclusion">The original DKS palette excludes Empty, Transparent, media, lighting, firmware-control, macro, gamepad, and combination actions.</p>${current ? '<button class="button ghost dks-picker-clear" id="clearDksPickerAction" type="button">Remove this action</button>' : ""}`;
  bindDksKeyPicker();
}
function openDksKeyPicker(slot) {
  state.dksKeyPickerSlot = clamp(slot, 0, 3);
  const current = Number(state.advancedDraft.keycodes[state.dksKeyPickerSlot]), currentGroup = dksKeyGroups().find((group) => group.codes.includes(current));
  state.dksKeyPickerGroup = currentGroup?.id || "basic"; renderDksKeyPicker(); openDialog(document.querySelector("#mptKeyPickerDialog")); document.querySelector("#dksKeySearch")?.focus();
}
function bindDksKeyPicker() {
  document.querySelectorAll("[data-dks-key-group]").forEach((button) => button.addEventListener("click", () => { state.dksKeyPickerGroup = button.dataset.dksKeyGroup; renderDksKeyPicker(); }));
  document.querySelector("#dksKeySearch")?.addEventListener("input", (event) => { const query = event.target.value.trim().toLowerCase(); document.querySelectorAll("[data-dks-keycode]").forEach((button) => { button.hidden = !button.dataset.dksKeyLabel.includes(query); }); });
  document.querySelectorAll("[data-dks-keycode]").forEach((button) => button.addEventListener("click", () => {
    const slot = Number(state.dksKeyPickerSlot); state.advancedDraft.keycodes[slot] = Number(button.dataset.dksKeycode);
    closeDialog(document.querySelector("#mptKeyPickerDialog")); renderDksConfiguration();
  }));
  document.querySelector("#clearDksPickerAction")?.addEventListener("click", () => { const slot = Number(state.dksKeyPickerSlot); state.advancedDraft.keycodes[slot] = 0; state.advancedDraft.travels[slot] = 0; closeDialog(document.querySelector("#mptKeyPickerDialog")); renderDksConfiguration(); });
}
function bindDksConfiguration() {
  document.querySelectorAll("[data-dks-host]").forEach((button) => button.addEventListener("click", () => selectDksHost(button.dataset.dksHost)));
  document.querySelectorAll("[data-dks-bind]").forEach((button) => button.addEventListener("click", () => openDksKeyPicker(Number(button.dataset.dksBind))));
  document.querySelectorAll("[data-dks-clear]").forEach((button) => button.addEventListener("click", () => { const row = Number(button.dataset.dksClear); state.advancedDraft.keycodes[row] = 0; state.advancedDraft.travels[row] = 0; renderDksConfiguration(); }));
  document.querySelectorAll("[data-dks-point]").forEach((button) => {
    button.addEventListener("pointerdown", (event) => { event.preventDefault(); const [row, point] = button.dataset.dksPoint.split(":").map(Number), active = !dksPointActive(state.advancedDraft.travels[row], point); state.dksTimelinePaint = { row, active }; setDksTimelinePoint(row, point, active); });
    button.addEventListener("pointerenter", (event) => { const [row, point] = button.dataset.dksPoint.split(":").map(Number), paint = state.dksTimelinePaint; if (event.buttons === 1 && paint?.row === row) setDksTimelinePoint(row, point, paint.active); });
  });
  document.querySelector("#dksDb1")?.addEventListener("change", (event) => setDksThreshold(0, event.target.value));
  document.querySelector("#dksDb2")?.addEventListener("change", (event) => setDksThreshold(1, event.target.value));
  document.querySelector("#stageDks")?.addEventListener("click", stageDks);
  document.querySelector("#readDksAdvanced")?.addEventListener("click", async () => { state.profile.selected = Number(state.advancedDraft.hostId); await readAdvanced(); if (state.advancedDraft.feature === "DKS") renderDksConfiguration(); });
}
function stageDks() {
  const draft = state.advancedDraft = normalizeDksDraft(state.advancedDraft), host = keys[Number(draft.hostId)], assigned = draft.keycodes.map((code, index) => ({ code, mask: draft.travels[index] })).filter(({ code }) => code);
  if (!dksHostEligible(host)) return showToast("Choose a physical key with a basic keyboard mapping.", true);
  if (!assigned.length) return showToast("Assign at least one DKS action.", true);
  if (assigned.some(({ code }) => !dksOutputAllowed(code))) return showToast("One or more DKS outputs are unavailable on this firmware.", true);
  if (draft.dbs[0] >= draft.dbs[1]) return showToast("The shallow point must be above the deep point.", true);
  draft.keycodes.forEach((code, index) => { if (!code) draft.travels[index] = 0; });
  if (Number(state.hardware.advancedByKey.get(host.id)?.mode) === ADVANCED_MODE.DKS) state.dirty.advancedRemovals.delete(host.id);
  state.dirty.advanced = true; state.profile.selected = host.id; state.selectedKeys = new Set([host.id]); render(); renderDksConfiguration(); showToast(`DKS staged on ${host.n} with ${assigned.length} action${assigned.length === 1 ? "" : "s"}.`);
}
async function applyDynamicKeystrokeDraft(draft, performanceNormalizations) {
  const normalized = normalizeDksDraft(draft), host = keys[Number(normalized.hostId)], address = position(host);
  document.querySelector("#progressDetail").textContent = `DKS: checking ${host.n}`;
  const [currentRecord, tuning] = await Promise.all([state.transport.getAdvancedKey(address), state.transport.getPerformance(address)]);
  if (![ADVANCED_MODE.NONE, ADVANCED_MODE.DKS].includes(Number(currentRecord.mode))) throw new Error(`${host.n} already has another advanced assignment. Clear it before creating DKS.`);
  await state.transport.setDynamicKeystroke({ position: address, keycodes: normalized.keycodes, travels: normalized.travels, dbs: normalized.dbs }); await state.transport.saveParameters(SAVE_GROUP.ADVANCED);
  const verified = await state.transport.getAdvancedKey(address), valid = Number(verified.mode) === ADVANCED_MODE.DKS && normalized.keycodes.every((code, index) => Number(verified.keycodes[index]) === code) && normalized.travels.every((travel, index) => Number(verified.travels[index]) === travel) && normalized.dbs.every((value, index) => closeEnough(verified.deadzones[index], value));
  if (!valid) throw new Error("DKS read-back verification failed.");
  state.hardware.advanced = verified; state.hardware.advancedByKey.set(host.id, verified); state.advancedDraft = { ...normalized };
  document.querySelector("#progressDetail").textContent = `DKS: restoring Hall tuning for ${host.n}`;
  const current = await state.transport.getPerformance(address), desired = { ...current, ...tuning, axis: current.axis, calibrate: current.calibrate };
  await state.transport.setPerformance(address, desired);
  const restored = await state.transport.getPerformance(address), comparison = performanceReadbackComparison(desired, restored, true);
  if (!comparison.valid) throw new Error(`DKS was saved but ${host.n} tuning could not be restored: ${comparison.hard.join(", ")}.`);
  if (comparison.normalized.length) { const warning = `${host.n}: ${comparison.normalized.join(", ")}`; performanceNormalizations.push(warning); log("Firmware normalized DKS Hall read-back", warning); }
  state.profile.performance[host.id] = restored; state.hardware.performance.set(host.id, restored); await state.transport.saveParameters(SAVE_GROUP.PERFORMANCE);
}
function dksFeatureInfo() {
  return {
    title: "Dynamic Keystroke (DKS)",
    body: `<div class="feature-info-lead"><p>AE64 DKS follows one physical press from its shallow threshold to its deep threshold and back again. Up to four key values can be triggered once or held across connected parts of that lifecycle.</p><ul><li><b>Press:</b> trigger on the way down at db1 or db2.</li><li><b>Bottom:</b> keep an action active through the direction change.</li><li><b>Release:</b> change or release actions as the switch rises through db2 and db1.</li><li><b>Connected cells:</b> keep the selected key value held between events.</li></ul><p>The captured manufacturer examples describe shooting or jumping on press, tactical commands at bottom-out, a finisher on release, and movement on lift. Competitive rules differ by game and event.</p></div><div class="socd-tutorial-grid"><article><video controls preload="metadata" playsinline src="assets/tutorial-videos/dynamic_keystroke.webm" aria-label="Manufacturer Dynamic Keystroke tutorial"></video><div><strong>Original AE64 tutorial</strong><p>Choose a physical host, assign action keys, set shallow/deep travel, then paint each action across the downstroke and upstroke timeline.</p></div></article></div>`,
  };
}
