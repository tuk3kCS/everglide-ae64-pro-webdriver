"use strict";

/** Multi-Point Trigger (mode 2), decoded from the captured manufacturer app. */
const MPT_CAPTURED_BASIC_CODES = Object.freeze([
  ...Array.from({ length: 36 }, (_, index) => index + 4),
  ...Array.from({ length: 13 }, (_, index) => index + 44),
]);
const MPT_CAPTURED_EXTENDED_CODES = Object.freeze([
  41,
  ...Array.from({ length: 12 }, (_, index) => index + 58),
  ...Array.from({ length: 12 }, (_, index) => index + 104),
  ...Array.from({ length: 9 }, (_, index) => index + 70),
  83,
  ...Array.from({ length: 11 }, (_, index) => index + 88),
  ...Array.from({ length: 4 }, (_, index) => index + 84),
  ...Array.from({ length: 7 }, (_, index) => index + 224),
]);
const MPT_KEY_GROUPS = Object.freeze([
  { id: "basic", label: "Basic keys", codes: MPT_CAPTURED_BASIC_CODES },
  { id: "extended", label: "Extended keys", codes: MPT_CAPTURED_EXTENDED_CODES },
]);
const MPT_ALLOWED_CODES = new Set(MPT_KEY_GROUPS.flatMap(({ codes }) => codes));
Object.assign(state, { mptKeyPickerStage: 0, mptKeyPickerGroup: "basic" });

function advancedDraftFeatureCode(draft = state.advancedDraft) {
  return ["DKS", "MPT", "RS", "MACRO", "MT", "TGL", "END"].includes(draft?.feature) ? draft.feature : "SOCD";
}
function advancedDraftKeyIds(draft = state.advancedDraft) {
  return ["DKS", "MPT", "MACRO", "MT", "TGL", "END"].includes(advancedDraftFeatureCode(draft))
    ? [Number(draft.hostId)]
    : [Number(draft.keyAId), Number(draft.keyBId)];
}
function multipointHostEligible(key) {
  const code = Number(key ? displayedKeycode(key, 0) : 0);
  return KEYCODE_GROUPS.keyboard.some((entry) => entry.code === code && code > 1);
}
function multipointTravelLimit(key) {
  const performance = state.profile.performance[key.id],
    catalog = state.switchCatalog.find((entry) => Number(entry.axisV2Id) === Number(performance?.axisV2Id)),
    millimeters = Number(catalog?.axisRangeMax || performance?.axisRangeMax || 4000) / 1000;
  return Math.max(0.3, Math.floor((millimeters + 0.0000001) * 10) / 10);
}
function normalizeMultipointDepths(depths, maxTravel) {
  const maxStep = Math.max(3, Math.floor(Number(maxTravel) * 10 + 0.0000001)),
    source = [0.5, 1, 1.5].map((fallback, index) => Math.round((Number(depths?.[index]) || fallback) * 10)),
    third = Math.max(3, Math.min(maxStep, source[2])),
    second = Math.max(2, Math.min(third - 1, source[1])),
    first = Math.max(1, Math.min(second - 1, source[0]));
  return [first, second, third].map((step) => step / 10);
}
function defaultMultipointDraft(hostId = state.profile.selected) {
  const requested = keys[Number(hostId)],
    host = multipointHostEligible(requested) ? requested : keys.find(multipointHostEligible) || keys[0],
    firstCode = MPT_ALLOWED_CODES.has(Number(displayedKeycode(host, 0))) ? Number(displayedKeycode(host, 0)) : 4;
  return { feature: "MPT", hostId: host.id, keycodes: [firstCode, 0, 0], depths: normalizeMultipointDepths(null, multipointTravelLimit(host)) };
}
function multipointDraftFromRecord(host, record) {
  const draft = defaultMultipointDraft(host.id);
  return {
    ...draft,
    keycodes: Array.from({ length: 3 }, (_, index) => Number(record?.keycodes?.[index]) || 0),
    depths: normalizeMultipointDepths(record?.depths, multipointTravelLimit(host)),
  };
}
function multipointDepthBounds(index, draft = state.advancedDraft) {
  const host = keys[Number(draft.hostId)] || keys[0],
    depths = normalizeMultipointDepths(draft.depths, multipointTravelLimit(host)),
    maxTravel = multipointTravelLimit(host);
  if (index === 0) return { min: 0.1, max: Number((depths[1] - 0.1).toFixed(1)) };
  if (index === 1) return { min: Number((depths[0] + 0.1).toFixed(1)), max: Number((depths[2] - 0.1).toFixed(1)) };
  return { min: Number((depths[1] + 0.1).toFixed(1)), max: maxTravel };
}
function multipointKeyLabel(code) {
  return Number(code) ? keycodeLabel(Number(code)) : "Not assigned";
}
function multipointRecordDetails(record) {
  return record.keycodes.map((code, index) => Number(code) ? `${multipointKeyLabel(code)} @ ${Number(record.depths[index]).toFixed(1)} mm` : "").filter(Boolean).join(" · ");
}
function multipointDraftDetails(draft = state.advancedDraft) {
  return multipointRecordDetails({ keycodes: draft.keycodes, depths: draft.depths });
}
function multipointHostKeyboardHtml() {
  const draft = state.advancedDraft;
  return `<div class="mpt-host-board"><div class="keyboard mpt-host-keyboard" aria-label="Choose the physical key that runs Multi-Point Trigger">${layout.map((row, uiRow) => `<div class="keyboard-row">${row.map((_, col) => {
    const key = keys.find((candidate) => candidate.uiRow === uiRow && candidate.col === col),
      selected = key.id === Number(draft.hostId), eligible = multipointHostEligible(key);
    return `<button class="key mpt-host-key ${selected ? "selected" : ""}" style="--u:${key.u}" type="button" data-mpt-host="${key.id}" aria-pressed="${selected}" ${eligible ? "" : "disabled"} title="${eligible ? `Use physical ${esc(key.n)} for MPT` : "The original driver only allows a basic keyboard mapping as an advanced-key host"}"><span class="mapped">${esc(key.n)}</span><b>${esc(keycodeLabel(displayedKeycode(key, 0)))}</b></button>`;
  }).join("")}</div>`).join("")}</div></div>`;
}
function multipointEditor() {
  const draft = state.advancedDraft, host = keys[Number(draft.hostId)] || keys[0],
    maxTravel = multipointTravelLimit(host), depths = normalizeMultipointDepths(draft.depths, maxTravel),
    keycodes = Array.from({ length: 3 }, (_, index) => Number(draft.keycodes?.[index]) || 0),
    activeStages = keycodes.filter((code) => code > 0).length;
  draft.depths = depths; draft.keycodes = keycodes;
  return `<div class="mpt-editor"><div class="panel-head"><div><span class="eyebrow">CAPTURE-VERIFIED MODE 2</span><h2>Multi-Point Trigger</h2><p>One physical switch can emit two or three different key values as it travels deeper.</p></div><span class="badge ${activeStages >= 2 ? "ready" : "experimental"}">${activeStages}/3 OUTPUTS</span></div><div class="mpt-host-heading"><div><h3>Physical host key</h3><p>The switch profile assigned to this key sets every slider’s maximum.</p></div><strong>${esc(host.n)} · ${maxTravel.toFixed(1)} mm</strong></div>${multipointHostKeyboardHtml()}<div class="mpt-stage-stack">${depths.map((depth, index) => {
    const bounds = multipointDepthBounds(index, draft), assigned = keycodes[index] > 0, optional = index === 2;
    return `<article class="mpt-stage ${assigned ? "assigned" : "empty"}" style="--mpt-stage:${index + 1}"><div class="mpt-stage-index"><span>0${index + 1}</span><i></i></div><div class="mpt-stage-copy"><small>${optional ? "OPTIONAL FINAL STAGE" : "REQUIRED STAGE"}</small><button type="button" data-mpt-bind-stage="${index}" class="mpt-key-value ${assigned ? "assigned" : ""}"><span>${assigned ? "KEY VALUE" : "SELECT KEY VALUE"}</span><b>${esc(multipointKeyLabel(keycodes[index]))}</b></button>${optional && assigned ? `<button class="mpt-clear-stage" type="button" data-mpt-clear-stage="2">Clear optional stage</button>` : ""}</div><label class="mpt-depth-control"><span><b>Actuation point</b><output data-mpt-depth-output="${index}">${depth.toFixed(1)} mm</output></span><input type="range" data-mpt-depth="${index}" min="${bounds.min.toFixed(1)}" max="${bounds.max.toFixed(1)}" step="0.1" value="${depth.toFixed(1)}"><small><i>${bounds.min.toFixed(1)}</i><i>${bounds.max.toFixed(1)} mm</i></small></label></article>`;
  }).join("")}</div><div class="mpt-order-note"><b>Depth locking is active</b><p>Each slider is constrained by its neighbours. Move the deepest stage farther down before trying to move an earlier stage past it.</p></div><div class="mpt-footer"><div><span>SWITCH-LIMITED RANGE</span><strong>0.1–${maxTravel.toFixed(1)} mm · 0.1 mm steps</strong><small>${esc(state.switchCatalog.find((entry) => Number(entry.axisV2Id) === Number(state.profile.performance[host.id]?.axisV2Id))?.name || `Axis ${Number(state.profile.performance[host.id]?.axisV2Id) || 0}`)}</small></div><div class="apply-row"><button class="button ghost" id="readMptAdvanced" type="button" ${connected() ? "" : "disabled"}>Read selected record</button><button class="button primary" id="stageMpt" type="button" ${activeStages >= 2 ? "" : "disabled"}>Stage MPT</button></div></div>${state.dirty.advanced && draft.feature === "MPT" ? '<p class="socd-stage-note">This Multi-Point Trigger record is staged. Apply changes to write and verify it.</p>' : ""}</div>`;
}
function renderMultipointConfiguration() {
  const body = document.querySelector("#mptConfigBody");
  if (!body) return;
  body.innerHTML = multipointEditor();
  bindMultipointConfiguration();
}
function selectMultipointHost(id) {
  const host = keys[Number(id)];
  if (!multipointHostEligible(host)) return showToast("The original driver only allows a basic keyboard mapping as an MPT host.", true);
  const record = state.hardware.advancedByKey.get(host.id);
  state.advancedDraft = Number(record?.mode) === ADVANCED_MODE.MPT ? multipointDraftFromRecord(host, record) : defaultMultipointDraft(host.id);
  state.profile.selected = host.id; state.selectedKeys = new Set([host.id]);
  renderMultipointConfiguration();
}
function openMultipointConfiguration() {
  if (!(state.dirty.advanced && state.advancedDraft.feature === "MPT")) {
    const selected = selectedKey(), host = multipointHostEligible(selected) ? selected : keys.find(multipointHostEligible);
    selectMultipointHost(host.id);
  }
  else renderMultipointConfiguration();
  openDialog(document.querySelector("#mptConfigDialog"));
}
function syncMultipointDepthControls() {
  document.querySelectorAll("[data-mpt-depth]").forEach((input) => {
    const index = Number(input.dataset.mptDepth), bounds = multipointDepthBounds(index);
    input.min = bounds.min.toFixed(1); input.max = bounds.max.toFixed(1);
    input.value = Number(state.advancedDraft.depths[index]).toFixed(1);
    const output = document.querySelector(`[data-mpt-depth-output="${index}"]`);
    if (output) output.textContent = `${input.value} mm`;
    const labels = input.parentElement?.querySelectorAll("small i") || [];
    if (labels[0]) labels[0].textContent = input.min;
    if (labels[1]) labels[1].textContent = `${input.max} mm`;
  });
}
function setMultipointDepth(index, value) {
  const bounds = multipointDepthBounds(index), rounded = Math.round(clamp(value, bounds.min, bounds.max) * 10) / 10;
  state.advancedDraft.depths[index] = rounded;
  syncMultipointDepthControls();
}
function renderMultipointKeyPicker() {
  const body = document.querySelector("#mptKeyPickerBody"), stage = Number(state.mptKeyPickerStage),
    current = Number(state.advancedDraft.keycodes?.[stage]) || 0, used = new Set(state.advancedDraft.keycodes.map(Number).filter((code, index) => code > 0 && index !== stage)),
    group = MPT_KEY_GROUPS.find((entry) => entry.id === state.mptKeyPickerGroup) || MPT_KEY_GROUPS[0];
  if (!body) return;
  body.innerHTML = `<div class="mpt-picker-summary"><span>STAGE 0${stage + 1}</span><b>${esc(multipointKeyLabel(current))}</b><small>Only key values exposed by the original MPT editor are listed.</small></div><input class="search-input" id="mptKeySearch" type="search" placeholder="Search compatible key values" autocomplete="off"><div class="mpt-picker-tabs" role="tablist" aria-label="MPT key-value group">${MPT_KEY_GROUPS.map((entry) => `<button type="button" role="tab" data-mpt-key-group="${entry.id}" class="${entry.id === group.id ? "active" : ""}" aria-selected="${entry.id === group.id}">${entry.label}<span>${entry.codes.length}</span></button>`).join("")}</div><div class="mpt-key-grid">${group.codes.map((code) => {
    const assignedElsewhere = used.has(code), label = keycodeLabel(code);
    return `<button type="button" data-mpt-keycode="${code}" data-mpt-key-label="${esc(label.toLowerCase())}" class="${code === current ? "active" : ""}" ${assignedElsewhere ? "disabled" : ""}><b>${esc(label)}</b><small>${assignedElsewhere ? "Used on another stage" : `0x${code.toString(16).padStart(4, "0").toUpperCase()}`}</small></button>`;
  }).join("")}</div><p class="mpt-picker-exclusion">Excluded from the captured MPT palette: Empty, Transparent, media, mouse, lighting, firmware-control, macro, gamepad, and combination actions.</p>`;
  bindMultipointKeyPicker();
}
function openMultipointKeyPicker(stage) {
  state.mptKeyPickerStage = clamp(stage, 0, 2);
  const current = Number(state.advancedDraft.keycodes[stage]);
  state.mptKeyPickerGroup = !current || MPT_CAPTURED_BASIC_CODES.includes(current) ? "basic" : "extended";
  const title = document.querySelector("#mptKeyPickerTitle"); if (title) title.textContent = `Choose MPT stage ${Number(stage) + 1}`;
  renderMultipointKeyPicker();
  openDialog(document.querySelector("#mptKeyPickerDialog"));
  document.querySelector("#mptKeySearch")?.focus();
}
function bindMultipointKeyPicker() {
  document.querySelectorAll("[data-mpt-key-group]").forEach((button) => button.addEventListener("click", () => {
    state.mptKeyPickerGroup = button.dataset.mptKeyGroup; renderMultipointKeyPicker();
  }));
  document.querySelector("#mptKeySearch")?.addEventListener("input", (event) => {
    const query = event.target.value.trim().toLowerCase();
    document.querySelectorAll("[data-mpt-keycode]").forEach((button) => { button.hidden = !button.dataset.mptKeyLabel.includes(query); });
  });
  document.querySelectorAll("[data-mpt-keycode]").forEach((button) => button.addEventListener("click", () => {
    state.advancedDraft.keycodes[state.mptKeyPickerStage] = Number(button.dataset.mptKeycode);
    closeDialog(document.querySelector("#mptKeyPickerDialog")); renderMultipointConfiguration();
  }));
}
function stageMultipointTrigger() {
  const draft = state.advancedDraft, host = keys[Number(draft.hostId)], keycodes = draft.keycodes.map(Number),
    maxTravel = host ? multipointTravelLimit(host) : 0, depths = normalizeMultipointDepths(draft.depths, maxTravel), active = keycodes.filter((code) => code > 0);
  if (!multipointHostEligible(host)) return showToast("Choose a physical key with a basic keyboard mapping.", true);
  if (keycodes[0] <= 0 || keycodes[1] <= 0 || active.length < 2) return showToast("Assign key values to at least stages 1 and 2.", true);
  if (new Set(active).size !== active.length) return showToast("Each MPT stage must use a different key value.", true);
  if (keycodes.some((code) => code > 0 && !MPT_ALLOWED_CODES.has(code))) return showToast("One or more MPT key values are not supported by the original driver.", true);
  if (!(depths[0] < depths[1] && depths[1] < depths[2]) || depths[2] > maxTravel) return showToast("MPT depths must increase in 0.1 mm steps inside the switch travel range.", true);
  draft.feature = "MPT"; draft.keycodes = keycodes; draft.depths = depths;
  if (Number(state.hardware.advancedByKey.get(host.id)?.mode) === ADVANCED_MODE.MPT) state.dirty.advancedRemovals.delete(host.id);
  state.dirty.advanced = true; state.profile.selected = host.id; state.selectedKeys = new Set([host.id]);
  render(); renderMultipointConfiguration(); showToast(`MPT staged on ${host.n} with ${active.length} outputs.`);
}
function bindMultipointConfiguration() {
  document.querySelectorAll("[data-mpt-host]").forEach((button) => button.addEventListener("click", () => selectMultipointHost(button.dataset.mptHost)));
  document.querySelectorAll("[data-mpt-depth]").forEach((input) => input.addEventListener("input", () => setMultipointDepth(Number(input.dataset.mptDepth), input.value)));
  document.querySelectorAll("[data-mpt-bind-stage]").forEach((button) => button.addEventListener("click", () => openMultipointKeyPicker(Number(button.dataset.mptBindStage))));
  document.querySelector("[data-mpt-clear-stage]")?.addEventListener("click", () => { state.advancedDraft.keycodes[2] = 0; renderMultipointConfiguration(); });
  document.querySelector("#stageMpt")?.addEventListener("click", stageMultipointTrigger);
  document.querySelector("#readMptAdvanced")?.addEventListener("click", async () => { state.profile.selected = Number(state.advancedDraft.hostId); await readAdvanced(); if (state.advancedDraft.feature === "MPT") renderMultipointConfiguration(); });
}
async function applyMultipointDraft(draft, performanceNormalizations) {
  const host = keys[Number(draft.hostId)];
  if (!multipointHostEligible(host)) throw new Error("MPT requires a physical key with a basic keyboard mapping.");
  const maxTravel = multipointTravelLimit(host), depths = normalizeMultipointDepths(draft.depths, maxTravel), keycodes = draft.keycodes.map(Number), address = position(host);
  document.querySelector("#progressDetail").textContent = `MPT: checking ${host.n}`;
  const [currentRecord, tuning] = await Promise.all([state.transport.getAdvancedKey(address), state.transport.getPerformance(address)]);
  if (![ADVANCED_MODE.NONE, ADVANCED_MODE.MPT].includes(Number(currentRecord.mode))) throw new Error(`${host.n} already has another advanced assignment. Clear it before creating MPT.`);
  await state.transport.setMultipointTrigger({ position: address, keycodes, depths });
  await state.transport.saveParameters(SAVE_GROUP.ADVANCED);
  const verified = await state.transport.getAdvancedKey(address), valid = Number(verified.mode) === ADVANCED_MODE.MPT && keycodes.every((code, index) => Number(verified.keycodes[index]) === code) && depths.every((depth, index) => closeEnough(verified.depths[index], depth));
  if (!valid) throw new Error("MPT read-back verification failed.");
  state.hardware.advanced = verified; state.hardware.advancedByKey.set(host.id, verified); state.advancedDraft = { feature: "MPT", hostId: host.id, keycodes: [...keycodes], depths: [...depths] };
  document.querySelector("#progressDetail").textContent = `MPT: restoring Hall tuning for ${host.n}`;
  const current = await state.transport.getPerformance(address), desired = { ...current, ...tuning, axis: current.axis, calibrate: current.calibrate };
  await state.transport.setPerformance(address, desired);
  const restored = await state.transport.getPerformance(address), comparison = performanceReadbackComparison(desired, restored, true);
  if (!comparison.valid) throw new Error(`MPT was saved but ${host.n} tuning could not be restored: ${comparison.hard.join(", ")}.`);
  if (comparison.normalized.length) { const warning = `${host.n}: ${comparison.normalized.join(", ")}`; performanceNormalizations.push(warning); log("Firmware normalized MPT Hall read-back", warning); }
  state.profile.performance[host.id] = restored; state.hardware.performance.set(host.id, restored);
  await state.transport.saveParameters(SAVE_GROUP.PERFORMANCE);
}
function multipointFeatureInfo() {
  return {
    title: "Multi-Point Trigger (MPT)",
    body: `<div class="feature-info-lead"><p>The captured manufacturer driver describes MPT as triggering different commands in stages during one press.</p><ul><li>Three independent trigger depths.</li><li>Each stage can bind a different key value.</li><li>Manufacturer claim: stage-switching latency below 1 ms.</li></ul><p>Its example is Project CARS: a light press for fine steering, a medium press for normal steering, and a heavy press for a sharp turn.</p></div><div class="socd-tutorial-grid"><article><video controls preload="metadata" playsinline src="assets/tutorial-videos/multipoint_trigger.webm" aria-label="Manufacturer Multi-Point Trigger tutorial"></video><div><strong>One press, up to three stages</strong><p>Watch the original demonstration, then choose two required outputs and an optional third output at strictly increasing depths.</p></div></article></div>`,
  };
}
