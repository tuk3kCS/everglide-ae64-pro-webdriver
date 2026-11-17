"use strict";

/** Rappy Snappy (mode 7) pair editor and manufacturer-derived tutorial. */
function defaultRappySnappyDraft() {
  const first = selectedKey(),
    preferred = keys.find((key) => key.n === "D" && key.id !== first.id),
    second = preferred || keys.find((key) => key.id !== first.id) || keys[1];
  return {
    feature: "RS",
    keyAId: first.id,
    keyBId: second.id,
    delay: 0,
    socdMode: SOCD_MODE.LAST_OVERRIDE,
    keycodes: null,
  };
}

function rappyDraftFromRecord(key, record) {
  if (Number(record?.mode) !== ADVANCED_MODE.RS) return null;
  const partner = keyAtFirmwarePosition(record.pairedRow, record.pairedCol);
  if (!partner) return null;
  return {
    feature: "RS",
    keyAId: key.id,
    keyBId: partner.id,
    delay: clamp(record.delay, 0, 50),
    socdMode: SOCD_MODE.LAST_OVERRIDE,
    keycodes: [...record.keycodes],
  };
}

function prepareRappySnappyDraft() {
  const key = selectedKey(),
    onboard = rappyDraftFromRecord(
      key,
      state.hardware.advancedByKey.get(key.id),
    );
  if (onboard) state.advancedDraft = onboard;
  else if (state.advancedDraft.feature !== "RS" || !state.dirty.advanced)
    state.advancedDraft = defaultRappySnappyDraft();
}

function rappySnappyPickerKeyboardHtml() {
  const draft = state.advancedDraft,
    pair = [Number(draft.keyAId), Number(draft.keyBId)],
    activeSlot = Number(state.socdPickerSlot) === 1 ? 1 : 0;
  return `<div class="socd-picker-board"><div class="keyboard socd-picker-keyboard" aria-label="Choose the two physical keys for Rappy Snappy">${layout.map((row, uiRow) => `<div class="keyboard-row">${row.map((_, col) => {
    const key = keys.find((candidate) => candidate.uiRow === uiRow && candidate.col === col),
      pairPosition = pair.indexOf(key.id),
      mapped = keycodeLabel(displayedKeycode(key, 0));
    return `<button class="key socd-picker-key ${pairPosition === 0 ? "pair-a" : pairPosition === 1 ? "pair-b" : ""}" style="--u:${key.u}" type="button" data-rs-picker-key="${key.id}" aria-pressed="${pairPosition >= 0}" aria-label="Set RS Key ${activeSlot ? "B" : "A"} to physical ${esc(key.n)}" title="Set Key ${activeSlot ? "B" : "A"} to physical ${esc(key.n)}"><span class="mapped">${esc(key.n)}</span><b>${esc(mapped)}</b>${pairPosition >= 0 ? `<i class="socd-pair-marker" aria-hidden="true">${pairPosition ? "B" : "A"}</i>` : ""}</button>`;
  }).join("")}</div>`).join("")}</div></div>`;
}

function rappySnappyEditor() {
  const draft = state.advancedDraft,
    keyA = keys[draft.keyAId] || keys[0],
    keyB = keys[draft.keyBId] || keys[1],
    keycodes = Array.isArray(draft.keycodes) ? draft.keycodes : [displayedKeycode(keyA, 0), displayedKeycode(keyB, 0)],
    activeSlot = Number(state.socdPickerSlot) === 1 ? 1 : 0,
    staged = state.dirty.advanced && draft.feature === "RS";
  return `<div class="socd-editor rs-editor"><div class="panel-head"><div><span class="eyebrow">CAPTURE-VERIFIED EDITOR</span><h2>Rappy Snappy pair</h2><p>Select two physical keys. While both are partially pressed, firmware keeps the deeper key active; both can output at full bottom-out.</p></div><span class="badge ready">TRAVEL PRIORITY</span></div><div class="socd-picker-heading"><div><h3>Physical key pair</h3><p>After choosing Key A, the picker advances to Key B automatically.</p></div><div class="socd-pair-slots" role="tablist" aria-label="Rappy Snappy pair position"><button type="button" role="tab" data-rs-picker-slot="0" class="${activeSlot === 0 ? "active" : ""}" aria-selected="${activeSlot === 0}"><i>A</i><span><b>Key A</b><strong>${esc(keyA.n)}</strong><small>${esc(keycodeLabel(keycodes[0]))}</small></span></button><button type="button" role="tab" data-rs-picker-slot="1" class="${activeSlot === 1 ? "active" : ""}" aria-selected="${activeSlot === 1}"><i>B</i><span><b>Key B</b><strong>${esc(keyB.n)}</strong><small>${esc(keycodeLabel(keycodes[1]))}</small></span></button></div></div>${rappySnappyPickerKeyboardHtml()}<div class="socd-picker-legend"><span><i class="pair-a"></i>Key A</span><span><i class="pair-b"></i>Key B</span><strong>The pair uses each key’s Main-layer output.</strong></div><div class="rs-principle"><article><span>01</span><div><b>Compare travel continuously</b><p>The farther-pressed key has priority while the two travel values differ.</p></div></article><article><span>02</span><div><b>Allow full bottom-out</b><p>If both switches reach their physical bottom, firmware permits both outputs.</p></div></article></div><div class="socd-footer"><label class="field socd-delay"><span>RS delay</span><div class="input-with-unit"><input id="rsDelay" type="number" min="0" max="50" step="1" value="${clamp(draft.delay, 0, 50)}"><span>ms</span></div><small>Stored in both captured mode-7 records.</small></label><div class="apply-row"><button class="button ghost" id="readRsAdvanced" type="button" ${connected() ? "" : "disabled"}>Read selected record</button><button class="button primary" id="stageRs" type="button">Stage RS pair</button></div></div>${staged ? '<p class="socd-stage-note">This complete Rappy Snappy pair is staged. Use Apply changes, or let experimental Auto apply write and verify it.</p>' : ""}</div>`;
}

function renderRappySnappyConfiguration() {
  const body = document.querySelector("#rsConfigBody");
  if (!body) return;
  body.innerHTML = rappySnappyEditor();
  bindRappySnappyConfiguration();
}

function openRappySnappyConfiguration() {
  prepareRappySnappyDraft();
  state.socdPickerSlot = 0;
  renderRappySnappyConfiguration();
  openDialog(document.querySelector("#rsConfigDialog"));
}

function selectRappySnappyPickerKey(id) {
  const keyId = Number(id),
    key = keys.find((candidate) => candidate.id === keyId),
    slot = Number(state.socdPickerSlot) === 1 ? 1 : 0,
    otherSlot = slot === 0 ? 1 : 0,
    fields = ["keyAId", "keyBId"];
  if (!key) return;
  if (Number(state.advancedDraft[fields[otherSlot]]) === keyId)
    state.advancedDraft[fields[otherSlot]] = Number(state.advancedDraft[fields[slot]]);
  state.advancedDraft[fields[slot]] = keyId;
  state.advancedDraft.keycodes = null;
  if (slot === 0) state.socdPickerSlot = 1;
  renderRappySnappyConfiguration();
}

function stageRappySnappyPair() {
  const draft = state.advancedDraft,
    keyA = keys[Number(draft.keyAId)],
    keyB = keys[Number(draft.keyBId)];
  if (!keyA || !keyB) return showToast("Choose two valid physical keys for Rappy Snappy.", true);
  if (keyA.id === keyB.id) return showToast("RS Key A and Key B must be different.", true);
  draft.feature = "RS";
  draft.delay = Math.round(clamp(draft.delay, 0, 50));
  draft.keycodes = [displayedKeycode(keyA, 0), displayedKeycode(keyB, 0)];
  const recordA = state.hardware.advancedByKey.get(keyA.id),
    partnerA = recordA ? keyAtFirmwarePosition(recordA.pairedRow, recordA.pairedCol) : null;
  if (Number(recordA?.mode) === ADVANCED_MODE.RS && partnerA?.id === keyB.id) {
    state.dirty.advancedRemovals.delete(keyA.id);
    state.dirty.advancedRemovals.delete(keyB.id);
  }
  state.dirty.advanced = true;
  render();
  renderRappySnappyConfiguration();
  showToast(`Rappy Snappy staged for ${keyA.n} + ${keyB.n}.`);
}

function bindRappySnappyConfiguration() {
  document.querySelectorAll("[data-rs-picker-slot]").forEach((button) =>
    button.addEventListener("click", () => {
      state.socdPickerSlot = Number(button.dataset.rsPickerSlot) === 1 ? 1 : 0;
      renderRappySnappyConfiguration();
    }),
  );
  document.querySelectorAll("[data-rs-picker-key]").forEach((button) =>
    button.addEventListener("click", () => selectRappySnappyPickerKey(button.dataset.rsPickerKey)),
  );
  document.querySelector("#rsDelay")?.addEventListener("change", (event) => {
    state.advancedDraft.delay = Math.round(clamp(event.target.value, 0, 50));
    event.target.value = state.advancedDraft.delay;
  });
  document.querySelector("#stageRs")?.addEventListener("click", stageRappySnappyPair);
  document.querySelector("#readRsAdvanced")?.addEventListener("click", async () => {
    state.profile.selected = Number(state.advancedDraft.keyAId);
    await readAdvanced();
    if (state.advancedDraft.feature === "RS") renderRappySnappyConfiguration();
  });
}

function rappySnappyFeatureInfo() {
  return {
    title: "Rappy Snappy (RS)",
    body: `<div class="feature-info-lead"><p>The captured manufacturer driver calls this feature “迅洁 (RS)” and describes it as a way to trigger commands quickly through switch pressure.</p><ul><li>Monitor two selected keys and trigger the key pressed farther.</li><li>If both keys are pressed completely to the bottom, trigger both.</li><li>The manufacturer’s example is counter-strafing in Valorant.</li></ul><p>RS compares live Hall travel rather than press order. The two keys, their Main-layer outputs, and one delay value are written as reciprocal mode-7 records.</p></div><div class="socd-tutorial-grid"><article><video controls preload="metadata" playsinline src="assets/tutorial-videos/rs-Ck_H-6K8.webm" aria-label="Manufacturer Rappy Snappy tutorial"></video><div><strong>Deeper key wins</strong><p>Watch the original demonstration: priority follows the farther-travelled switch until both keys reach full bottom-out.</p></div></article></div>`,
  };
}
