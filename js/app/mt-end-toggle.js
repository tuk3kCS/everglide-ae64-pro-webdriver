"use strict";

// The original AE64 higher-key editor uses one family-06 record for each of
// these modes.  The shared editor below intentionally keeps the controls
// small: a physical host, captured output key values, and the firmware delay.
const SIMPLE_ADVANCED_FEATURES = Object.freeze({
  MT: { title: "Mod-Tap", mode: ADVANCED_MODE.MT, outputs: 2, labels: ["Tap key", "Hold key"], delayLabel: "Hold threshold", defaultDelay: 200, video: "assets/tutorial-videos/modtap.webm" },
  TGL: { title: "Toggle Key", mode: ADVANCED_MODE.TGL, outputs: 1, labels: ["Toggle output"], delayLabel: "Toggle delay", defaultDelay: 200, video: "assets/tutorial-videos/toggle.webm" },
  END: { title: "End Key", mode: ADVANCED_MODE.END, outputs: 2, labels: ["Press key", "Release key"], delayLabel: "Release delay", defaultDelay: 0, video: "assets/tutorial-videos/end_key.webm" },
});
// English tutorial copy transcribed from the original driver's advanced-key
// dialog strings in xsyd.top.har (advancedKeyDialogMt/Tgl/End*).
const SIMPLE_ADVANCED_TUTORIALS = Object.freeze({
  MT: {
    title: "Multi-Tap (MT)",
    description: "Trigger two independent functions through click/long press.",
    features: [
      "Click triggers the main function (for example shooting or jumping).",
      "Long press triggers the secondary function (for example reload or block).",
    ],
    tip: "MOBA games can use this for smart casting.",
  },
  TGL: {
    title: "Toggle (TGL)",
    description: "Persistent key state.",
    features: [
      "Click once to lock the state; click again to unlock it.",
      "Useful for auto-shooting and auto-movement in games.",
    ],
    tip: "Toggle functionality may violate no-macro rules; turn it off before gaming.",
  },
  END: {
    title: "End Trigger (END)",
    description: "Trigger a command when the key rebounds to its set position.",
    features: [
      "Adjustable trigger point from 10% to 90% of rebound travel.",
      "Zero-travel mode treats physical bottom-out as release.",
      "Double reset can trigger twice in quick succession.",
      "The original driver advertises a theoretical 40% APM increase.",
    ],
    tip: "The original example targets a theoretical limit in osu!: trigger quickly after hitting and rebounding.",
  },
});
Object.assign(state, { simpleAdvancedKeyPicker: 0 });

function simpleAdvancedSpec(feature) { return SIMPLE_ADVANCED_FEATURES[String(feature).toUpperCase()] || SIMPLE_ADVANCED_FEATURES.MT; }
function simpleAdvancedOutputCodes(feature) {
  const spec = simpleAdvancedSpec(feature);
  if (spec.mode === ADVANCED_MODE.END && typeof dksSupportsExpandedOutputs === "function" && !dksSupportsExpandedOutputs()) return DKS_CAPTURED_LEGACY_EXTENDED_CODES;
  return [...MPT_CAPTURED_BASIC_CODES, ...MPT_CAPTURED_EXTENDED_CODES];
}
function simpleAdvancedOutputAllowed(feature, code) { return Number(code) === 0 || simpleAdvancedOutputCodes(feature).includes(Number(code)); }
function simpleAdvancedHost(host) { return typeof dksHostEligible === "function" ? dksHostEligible(host) : multipointHostEligible(host); }
function simpleAdvancedDefaultDraft(feature, hostId = state.profile.selected) {
  const spec = simpleAdvancedSpec(feature), requested = keys[Number(hostId)], host = simpleAdvancedHost(requested) ? requested : keys.find(simpleAdvancedHost) || keys[0];
  return { feature: Object.keys(SIMPLE_ADVANCED_FEATURES).find((key) => SIMPLE_ADVANCED_FEATURES[key].mode === spec.mode), hostId: host.id, keycodes: Array(spec.outputs).fill(0), delay: spec.defaultDelay };
}
function simpleAdvancedDraftFromRecord(host, record) {
  const mode = Number(record?.mode), feature = Object.keys(SIMPLE_ADVANCED_FEATURES).find((key) => SIMPLE_ADVANCED_FEATURES[key].mode === mode) || "MT", spec = simpleAdvancedSpec(feature);
  return { ...simpleAdvancedDefaultDraft(feature, host.id), keycodes: Array.from({ length: spec.outputs }, (_, index) => Number(record?.keycodes?.[index] ?? (index === 0 ? record?.keycode : 0)) || 0), delay: Number(record?.time ?? record?.delay) || 0 };
}
function normalizeSimpleAdvancedDraft(draft = state.advancedDraft) {
  const feature = Object.prototype.hasOwnProperty.call(SIMPLE_ADVANCED_FEATURES, draft?.feature) ? draft.feature : "MT", spec = simpleAdvancedSpec(feature), requested = keys[Number(draft?.hostId)], host = simpleAdvancedHost(requested) ? requested : keys.find(simpleAdvancedHost) || keys[0];
  return { feature, hostId: host.id, keycodes: Array.from({ length: spec.outputs }, (_, index) => simpleAdvancedOutputAllowed(feature, draft?.keycodes?.[index]) ? Number(draft.keycodes[index]) || 0 : 0), delay: Math.round(clamp(draft?.delay ?? spec.defaultDelay, 0, 1000)) };
}
function simpleAdvancedDraftDetails(draft = state.advancedDraft) {
  const normalized = normalizeSimpleAdvancedDraft(draft), spec = simpleAdvancedSpec(normalized.feature);
  return spec.labels.map((label, index) => normalized.keycodes[index] ? `${label}: ${keycodeLabel(normalized.keycodes[index])}` : `${label}: not assigned`).join(" · ") + ` · ${spec.delayLabel}: ${normalized.delay} ms`;
}
function simpleAdvancedRecordDetails(record) {
  const feature = Object.keys(SIMPLE_ADVANCED_FEATURES).find((key) => SIMPLE_ADVANCED_FEATURES[key].mode === Number(record?.mode));
  return feature ? simpleAdvancedDraftDetails({ feature, hostId: 0, keycodes: record.keycodes || [record.keycode], delay: record.time ?? record.delay }) : `Firmware mode ${record?.mode}`;
}
function simpleAdvancedHostKeyboardHtml(feature, hostId) {
  return `<div class="mpt-host-board simple-advanced-host-board"><div class="keyboard mpt-host-keyboard simple-advanced-host-keyboard" aria-label="Choose the physical host key for ${esc(simpleAdvancedSpec(feature).title)}">${layout.map((row, uiRow) => `<div class="keyboard-row">${row.map((_, col) => { const key = keys.find((candidate) => candidate.uiRow === uiRow && candidate.col === col), selected = Number(hostId) === key.id, eligible = simpleAdvancedHost(key); return `<button class="key mpt-host-key simple-advanced-host-key ${selected ? "selected" : ""}" style="--u:${key.u}" type="button" data-simple-host="${key.id}" aria-pressed="${selected}" ${eligible ? "" : "disabled"} title="${eligible ? `Use ${key.n} as the physical host` : "Only standard keyboard host keys are supported"}><span class="mapped">${esc(key.n)}</span><b>${esc(keycodeLabel(displayedKeycode(key, 0)))}</b></button>`; }).join("")}</div>`).join("")}</div></div>`;
}
function simpleAdvancedOutputSelect(feature, index, value) {
  const options = simpleAdvancedOutputCodes(feature).map((code) => `<option value="${code}" ${Number(value) === code ? "selected" : ""}>${esc(keycodeLabel(code))}</option>`).join("");
  return `<label class="field"><span>${esc(simpleAdvancedSpec(feature).labels[index])}</span><select data-simple-output="${index}"><option value="0" ${!Number(value) ? "selected" : ""}>Not assigned</option>${options}</select></label>`;
}
function simpleAdvancedEditor() {
  const draft = state.advancedDraft = normalizeSimpleAdvancedDraft(state.advancedDraft), spec = simpleAdvancedSpec(draft.feature), host = keys[draft.hostId] || keys[0], active = draft.keycodes.filter(Number).length;
  return `<div class="simple-advanced-editor socd-editor ${draft.feature.toLowerCase()}-editor"><div class="panel-head"><div><span class="eyebrow">CAPTURE-VERIFIED MODE ${spec.mode}</span><h2>${spec.title}</h2><p>${draft.feature === "MT" ? "Tap one output and hold another after the threshold." : draft.feature === "TGL" ? "Press once to latch the output, then press again to release it." : "Emit one output on press and another when the key reaches its end state."}</p></div><span class="badge ${active === spec.outputs ? "ready" : "experimental"}">${active}/${spec.outputs} OUTPUTS</span></div><div class="mpt-host-heading simple-advanced-host-heading"><div><h3>Physical host key</h3><p>Choose the key whose press activates this higher-key behavior.</p></div><strong>${esc(host.n)}</strong></div>${simpleAdvancedHostKeyboardHtml(draft.feature, draft.hostId)}<div class="simple-advanced-fields">${Array.from({ length: spec.outputs }, (_, index) => simpleAdvancedOutputSelect(draft.feature, index, draft.keycodes[index])).join("")}<label class="field"><span>${esc(spec.delayLabel)}</span><div class="input-with-unit"><input id="simpleAdvancedDelay" type="number" min="0" max="1000" step="1" value="${draft.delay}"><span>ms</span></div><small>${draft.feature === "MT" ? "Hold this long to choose the hold output instead of the tap output." : "Stored in the family-06 higher-key record."}</small></label></div><div class="mpt-footer simple-advanced-footer"><p>Output values use the captured AE64 keyboard palette. Existing Hall actuation and switch metadata are preserved while this record is written.</p><div class="apply-row"><button class="button ghost" id="readSimpleAdvanced" type="button" ${connected() ? "" : "disabled"}>Read selected record</button><button class="button primary" id="stageSimpleAdvanced" type="button" ${active === spec.outputs ? "" : "disabled"}>Stage ${spec.title}</button></div></div>${state.dirty.advanced && state.advancedDraft.feature === draft.feature ? '<p class="socd-stage-note">This higher-key record is staged. Apply changes to write and verify it.</p>' : ""}</div>`;
}
function renderSimpleAdvancedConfiguration() {
  const body = document.querySelector("#socdConfigBody"), title = document.querySelector("#socdConfigTitle");
  if (!body) return;
  const spec = simpleAdvancedSpec(state.advancedDraft.feature);
  if (title) title.textContent = `Configure ${spec.title}`;
  body.innerHTML = simpleAdvancedEditor(); bindSimpleAdvancedConfiguration();
}
function openSimpleAdvancedConfiguration(feature) {
  const selected = selectedKey(), record = state.hardware.advancedByKey.get(selected.id), spec = simpleAdvancedSpec(feature);
  state.advancedDraft = Number(record?.mode) === spec.mode ? simpleAdvancedDraftFromRecord(selected, record) : simpleAdvancedDefaultDraft(feature, selected.id);
  state.profile.selected = selected.id; state.selectedKeys = new Set([selected.id]); renderSimpleAdvancedConfiguration(); openDialog(document.querySelector("#socdConfigDialog"));
}
function selectSimpleAdvancedHost(id) {
  const host = keys[Number(id)];
  if (!simpleAdvancedHost(host)) return;
  const feature = state.advancedDraft.feature, record = state.hardware.advancedByKey.get(host.id);
  state.advancedDraft = Number(record?.mode) === simpleAdvancedSpec(feature).mode ? simpleAdvancedDraftFromRecord(host, record) : simpleAdvancedDefaultDraft(feature, host.id);
  state.profile.selected = host.id; state.selectedKeys = new Set([host.id]); renderSimpleAdvancedConfiguration();
}
function stageSimpleAdvanced() {
  const draft = state.advancedDraft = normalizeSimpleAdvancedDraft(state.advancedDraft), spec = simpleAdvancedSpec(draft.feature), host = keys[draft.hostId];
  if (!host || !simpleAdvancedHost(host)) return showToast("Choose a standard keyboard host key.", true);
  if (draft.keycodes.some((code) => !code)) return showToast(`Assign all ${spec.outputs} ${spec.title} outputs before staging.`, true);
  const existing = state.hardware.advancedByKey.get(host.id);
  if (Number(existing?.mode) === spec.mode) state.dirty.advancedRemovals.delete(host.id);
  state.dirty.advanced = true; state.profile.selected = host.id; state.selectedKeys = new Set([host.id]); render(); renderSimpleAdvancedConfiguration(); showToast(`${spec.title} staged on ${host.n}.`);
}
function bindSimpleAdvancedConfiguration() {
  document.querySelectorAll("[data-simple-host]").forEach((button) => button.addEventListener("click", () => selectSimpleAdvancedHost(button.dataset.simpleHost)));
  document.querySelectorAll("[data-simple-output]").forEach((select) => select.addEventListener("change", () => { state.advancedDraft.keycodes[Number(select.dataset.simpleOutput)] = Number(select.value); renderSimpleAdvancedConfiguration(); }));
  document.querySelector("#simpleAdvancedDelay")?.addEventListener("change", (event) => { state.advancedDraft.delay = Math.round(clamp(event.target.value, 0, 1000)); renderSimpleAdvancedConfiguration(); });
  document.querySelector("#stageSimpleAdvanced")?.addEventListener("click", stageSimpleAdvanced);
  document.querySelector("#readSimpleAdvanced")?.addEventListener("click", async () => { state.profile.selected = Number(state.advancedDraft.hostId); await readAdvanced(); if (SIMPLE_ADVANCED_FEATURES[state.advancedDraft.feature]) renderSimpleAdvancedConfiguration(); });
}
async function applySimpleAdvancedDraft(draft, performanceNormalizations) {
  const normalized = normalizeSimpleAdvancedDraft(draft), spec = simpleAdvancedSpec(normalized.feature), host = keys[normalized.hostId], address = position(host);
  if (!host || !simpleAdvancedHost(host)) throw new Error(`${spec.title} requires a standard keyboard host key.`);
  document.querySelector("#progressDetail").textContent = `${spec.title}: checking ${host.n}`;
  const [currentRecord, tuning] = await Promise.all([state.transport.getAdvancedKey(address), state.transport.getPerformance(address)]);
  if (![ADVANCED_MODE.NONE, spec.mode].includes(Number(currentRecord.mode))) throw new Error(`${host.n} already has another advanced assignment. Clear it before creating ${spec.title}.`);
  let verified;
  if (spec.mode === ADVANCED_MODE.MT) verified = await state.transport.setModTap({ position: address, keycodes: normalized.keycodes, delay: normalized.delay });
  else if (spec.mode === ADVANCED_MODE.TGL) verified = await state.transport.setToggleKey({ position: address, keycode: normalized.keycodes[0], delay: normalized.delay });
  else verified = await state.transport.setEndKey({ position: address, keycodes: normalized.keycodes, delay: normalized.delay });
  await state.transport.saveParameters(SAVE_GROUP.ADVANCED);
  const sameOutputs = spec.mode === ADVANCED_MODE.TGL ? Number(verified.keycode) === normalized.keycodes[0] : normalized.keycodes.every((code, index) => Number(verified.keycodes[index]) === code), sameDelay = Number(verified.time ?? verified.delay) === normalized.delay;
  if (Number(verified.mode) !== spec.mode || !sameOutputs || !sameDelay) throw new Error(`${spec.title} read-back verification failed.`);
  state.hardware.advanced = verified; state.hardware.advancedByKey.set(host.id, verified); state.advancedDraft = { ...normalized };
  document.querySelector("#progressDetail").textContent = `${spec.title}: restoring Hall tuning for ${host.n}`;
  const current = await state.transport.getPerformance(address), desired = { ...current, ...tuning, axis: current.axis, calibrate: current.calibrate };
  await state.transport.setPerformance(address, desired);
  const restored = await state.transport.getPerformance(address), comparison = performanceReadbackComparison(desired, restored, true);
  if (!comparison.valid) throw new Error(`${spec.title} was saved but ${host.n} tuning could not be restored: ${comparison.hard.join(", ")}.`);
  if (comparison.normalized.length) { const warning = `${host.n}: ${comparison.normalized.join(", ")}`; performanceNormalizations.push(warning); log(`Firmware normalized ${spec.title} Hall read-back`, warning); }
  state.profile.performance[host.id] = restored; state.hardware.performance.set(host.id, restored); await state.transport.saveParameters(SAVE_GROUP.PERFORMANCE);
}
function simpleAdvancedFeatureInfo(feature) {
  const spec = simpleAdvancedSpec(feature), tutorial = SIMPLE_ADVANCED_TUTORIALS[feature] || SIMPLE_ADVANCED_TUTORIALS.MT;
  return { title: tutorial.title, body: `<div class="feature-info-lead"><p><strong>${tutorial.description}</strong></p><h3>Function Principle</h3><p>${feature === "MT" ? "A short press selects the Tap output; holding the host past the configured threshold selects the Hold output." : feature === "TGL" ? "The first press latches the output and the next press releases it, keeping the key state persistent between presses." : "The Press output fires at the leading edge; the Release output fires when the switch rebounds through the configured end point."}</p><h3>Core Features</h3><ul>${tutorial.features.map((item) => `<li>${item}</li>`).join("")}</ul><p><b>Tip:</b> ${tutorial.tip}</p></div><div class="feature-info-lead"><h3>Configure this mode</h3><ol><li>Choose a physical host key.</li><li>Assign the captured output key values.</li><li>Set the firmware delay in milliseconds, then Apply changes to write and verify the record.</li></ol></div><div class="socd-tutorial-grid"><article><video controls preload="metadata" playsinline src="${spec.video}" aria-label="Original AE64 ${tutorial.title} tutorial"></video><div><strong>Original AE64 tutorial</strong><p>${tutorial.description}</p></div></article></div>` };
}
