"use strict";

/**
 * AE64 Pro Control — page rendering.
 *
 * Loaded as an ordered classic script. Top-level declarations are shared
 * with the other application files; keep the order in index.html intact.
 * Contains keyboard markup, every page renderer, and shared status rendering.
 */

const RAINBOW_PREVIEW = Object.freeze(["#ff334f", "#ff9d2e", "#ffe73d", "#37df75", "#30c8f2", "#5378ff", "#a75cff", "#f04dc1"]);
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
function calibrationStatusMeta(value) {
  return Number(value) === 2
    ? { label: "New", className: "new" }
    : Number(value) === 1
      ? { label: "Calibrated", className: "calibrated" }
      : { label: "Uncalibrated", className: "uncalibrated" };
}
function activeActuationDistance(performance) {
  return Number(performance?.mode) === 1
    ? Number(performance?.rtFirstTouch) || 0
    : Number(performance?.normalPress) || 0;
}
function rtIndependenceToken(id) {
  return `${Number(state.profile.profileIndex)}:${Number(id)}`;
}
function rtIndependentForKey(id, performance = state.profile.performance[id]) {
  return (
    state.rtIndependentKeys.has(rtIndependenceToken(id)) ||
    Math.abs(Number(performance?.rtPress || 0) - Number(performance?.rtRelease || 0)) > 0.0005
  );
}
function deadZonesEnabled(performance) {
  return (
    Number(performance?.pressDeadStroke) > 0 ||
    Number(performance?.releaseDeadStroke) > 0
  );
}
function switchCatalogEntry(axisV2Id) {
  return state.switchCatalog.find(
    (entry) => Number(entry.axisV2Id) === Number(axisV2Id),
  );
}
function keyboardHtml({ hero = false, lighting = false } = {}) {
  const layer = Number(lighting ? state.hardware.fnPressed ? fnTargetLayer() : 0 : state.profile.layer),
    light = state.profile.lighting,
    paletteIndex = Number(light.base.paletteIndex),
    baseColor = light.palette[paletteIndex] || light.palette[0] || "#000000",
    live =
      lighting &&
      state.liveLighting &&
      connected() &&
      Array.isArray(state.hardware.liveMatrix),
    showCalibration = !hero && state.page === "performance" && state.calibrationActive,
    showSwitchProfiles =
      !hero &&
      !lighting &&
      state.page === "performance" &&
      !showCalibration &&
      state.performanceWorkspace === "switches",
    showPerformance =
      !hero &&
      !lighting &&
      state.page === "performance" &&
      !showCalibration &&
      !showSwitchProfiles,
    showPressDistance =
      !showCalibration &&
      !showSwitchProfiles &&
      !hero &&
      state.page === "performance" &&
      state.livePressDistance;
  return `<div class="keyboard" aria-label="AE64 Pro keyboard">${layout
    .map(
      (row, uiRow) =>
        `<div class="keyboard-row">${row
          .map((_, col) => {
            const key = keys.find(
              (candidate) => candidate.uiRow === uiRow && candidate.col === col,
            );
            const fnMeta = lighting && state.hardware.fnPressed
              ? fnLightingKeyMeta(key, layer)
              : null,
              code = fnMeta ? fnMeta.resolved : displayedKeycode(key, layer);
            const mapped = keycodeLabel(code);
            const custom = Boolean(light.customEnabled?.[key.id]),
              liveColor = live
                ? state.hardware.liveMatrix[key.row * MATRIX_COLS + key.col]
                : null,
              previewColor = liveColor
                ? rgbToHex(liveColor)
                : lighting
                  ? custom
                    ? light.perKey[key.id]
                    : paletteIndex === 0
                      ? RAINBOW_PREVIEW[key.id % RAINBOW_PREVIEW.length]
                      : baseColor
                  : light.perKey[key.id],
              lightingSelected =
                lighting &&
                state.page === "lighting" &&
                state.lightingTab === "perKey" &&
                state.lightingSelectedKeys.has(key.id),
              keySelected =
                !lighting && !hero && state.selectedKeys.has(key.id),
              selected =
                !hero &&
                (lighting ? lightingSelected : keySelected),
              pressMax = keySwitchTravel(key),
              pressMm = Math.min(
                pressMax,
                Number(state.hardware.travelValues.get(key.id) || 0) / 1000,
              ),
              pressPercent = Math.max(0, (pressMm / pressMax) * 100),
              calibrationAdc = Number(state.hardware.calibrationAdc.get(key.id) || 0),
              calibrationRoute = Number(state.hardware.calibrationRoute.get(key.id) || 0),
              calibrationState = calibrationStatusMeta(state.hardware.calibrationStatus.get(key.id)),
              calibrationRange = Number(state.profile.performance[key.id]?.axisRangeMax) || 4000,
              calibrationPercent = calibrationState.className === "new" ? 100 : Math.min(100, Math.max(0, calibrationRoute / calibrationRange * 100)),
              performance = state.profile.performance[key.id],
              rapidTrigger = Number(performance?.mode) === 1,
              deadZone = Number(performance?.pressDeadStroke) > 0 || Number(performance?.releaseDeadStroke) > 0,
              actuation = activeActuationDistance(performance),
              switchProfile = switchCatalogEntry(performance?.axisV2Id),
              switchRecordPending =
                showSwitchProfiles &&
                connected() &&
                ["idle", "loading"].includes(state.switchAssignmentsStatus) &&
                !state.hardware.performance.has(key.id) &&
                !state.dirty.performance.has(key.id),
              switchName = switchRecordPending
                ? "Reading…"
                : switchProfile?.name ||
                  (Number(performance?.axisV2Id)
                    ? `Axis ${Number(performance.axisV2Id)}`
                    : "Unassigned"),
              switchColor = switchRecordPending
                ? "var(--key-muted)"
                : switchProfile?.color || "var(--mint)";
            const dirty =
              state.dirty.performance.has(key.id) ||
              [...state.dirty.mapping].some((token) =>
                token.endsWith(`:${key.id}`),
              ) ||
              state.dirty.customLighting.has(key.id);
            return `<button class="key ${selected ? "selected" : ""} ${dirty ? "dirty" : ""} ${lighting && custom ? "custom-light" : ""} ${fnMeta ? fnMeta.override ? "fn-layer-override" : "fn-layer-inherited" : ""} ${fnMeta && key.id === state.hardware.fnTriggerId ? "fn-held" : ""} ${showPerformance ? "performance-key" : ""} ${showSwitchProfiles ? "switch-profile-key" : ""} ${showPressDistance ? "live-press-key" : ""} ${showCalibration ? `calibration-key calibration-${calibrationState.className}` : ""}" style="--u:${key.u};--key-color:${esc(previewColor)};--switch-color:${esc(switchColor)};--press-depth:${pressPercent.toFixed(2)}%;--calibration-depth:${calibrationPercent.toFixed(2)}%" type="button" ${hero ? 'tabindex="-1"' : `data-key="${key.id}" aria-pressed="${lighting ? lightingSelected : keySelected}"`}>
              ${showPressDistance ? '<i class="press-distance-fill" aria-hidden="true"></i>' : ""}${showCalibration ? `<i class="calibration-fill" aria-hidden="true"></i><span class="calibration-adc" title="Raw Hall ADC">${calibrationAdc}</span>` : ""}${showSwitchProfiles ? `<span class="switch-key-name" title="${esc(switchName)}">${esc(switchName)}</span>` : showPerformance ? `<span class="performance-actuation"><strong>${actuation.toFixed(2)}</strong><small>mm</small></span>${rapidTrigger ? '<i class="performance-flag rt" title="Rapid Trigger enabled">RT</i>' : ""}${deadZone ? '<i class="performance-flag dz" title="Dead zone enabled">DZ</i>' : ""}` : hero ? "" : `<span class="mapped">${esc(mapped)}</span>`}<b>${esc(key.n)}</b>${lighting ? `<i class="color-dot ${custom ? "custom" : ""}" title="${live ? "Live hardware color" : custom ? "Custom override" : paletteIndex === 0 ? "Firmware rainbow palette" : "Main palette"}"></i>` : ""}</button>`;
          })
          .join("")}</div>`,
    )
    .join("")}</div>`;
}
function boardPanel(options = {}) {
  const address = position(selectedKey()),
    selected = selectedKeyIds(),
    selectionLabel =
      selected.length === 0
        ? "No keys selected"
        : selected.length === 1
          ? `${selectedKey().n} · row ${address.row}, col ${address.col}`
          : `${selected.length} keys selected · primary: ${selectedKey().n}`,
    calibration = Boolean(options.performance && state.calibrationActive),
    calibrationBusy = Boolean(options.performance && state.calibrationBusy),
    statuses = options.performance
      ? keys.map((key) => Number(state.hardware.calibrationStatus.get(key.id) || 0))
      : [],
    calibrated = statuses.filter((status) => status === 1).length,
    fresh = statuses.filter((status) => status === 2).length,
    maxRoute = options.performance
      ? Math.max(0, ...keys.map((key) => Number(state.hardware.calibrationRoute.get(key.id) || 0)))
      : 0,
    title = options.performance
      ? calibration ? "Live calibration matrix" : "AE64 Pro performance map"
      : options.title || "AE64 Pro",
    description = options.performance
      ? calibration
        ? "Each key is colored by firmware status. The centered number is its raw Hall ADC reading; the fill follows measured travel."
        : "Select keys to tune them, or start a device-wide Hall calibration from this keyboard panel."
      : options.description || "Select one key to inspect or change its mapping.",
    headAction = options.performance
      ? `<div class="calibration-board-action"><span id="calibrationStatusBadge" class="badge ${calibration ? "ready" : "experimental"}">${calibration ? "CALIBRATING" : "CALIBRATION READY"}</span><button class="button ${calibration ? "ghost" : "primary"} small" id="calibrationToggle" type="button" ${!connected() || calibrationBusy ? "disabled" : ""}>${calibrationBusy ? "Working…" : calibration ? "Stop & save" : "Start calibration"}</button></div>`
      : `<span class="badge ${connected() ? "ready" : ""}">${connected() ? "HARDWARE" : "OFFLINE"}</span>`,
    calibrationGuide = options.performance && calibration
      ? `<div class="calibration-board-guide"><div class="calibration-legend" aria-label="Calibration status colors"><span><i class="uncalibrated"></i>Uncalibrated</span><span><i class="calibrated"></i>Calibrated</span><span><i class="new"></i>New calibration</span></div><div class="calibration-board-stats"><span><small>Calibrated</small><b id="calibrationKnown">${calibrated}</b></span><span><small>New</small><b id="calibrationFresh">${fresh}</b></span><span><small>Max route</small><b id="calibrationMaxRoute">${maxRoute}</b></span></div></div>`
      : "";
  return `<section class="panel layout-board ${options.full ? "full-span" : ""} ${options.performance ? "performance-board" : ""} ${calibration ? "calibration-active" : ""}"><i class="key-selection-marquee" aria-hidden="true"></i><div class="panel-head"><div><h2>${title}</h2><p>${description}</p></div>${headAction}</div><div class="keyboard-wrap ${options.lighting ? "lighting-preview" : ""}">${keyboardHtml({ lighting: options.lighting })}</div>${calibrationGuide}<div class="board-footer"><span>Layer ${Number(state.profile.layer) + 1}</span><span>Selected: <b class="selected-name">${esc(selectionLabel)}</b></span></div></section>`;
}
function selectedCard() {
  const key = selectedKey(),
    performance = state.profile.performance[key.id],
    code = displayedKeycode(key),
    address = position(key);
  return `<div class="selected-key-card"><b>${esc(key.n)}</b><div><span>SELECTED KEY · ${address.row}:${address.col}</span><strong>${esc(keycodeLabel(code))} · ${activeActuationDistance(performance).toFixed(2)} mm${performance.mode ? " · RT on" : ""}</strong></div></div>`;
}
function pageCopy() {
  return {
    overview: [
      t("overview"),
      "Device state, current profile, and selected-key summary.",
    ],
    performance: [
      t("performance"),
      "Per-key Hall actuation, Rapid Trigger, dead zones, calibration, and live travel.",
    ],
    keymap: [t("keymap"), "Stage assignments across all four firmware layers."],
    lighting: [t("lighting"), t("lightingDescription")],
    settings: [
      t("settings"),
      "Profiles, USB behavior, polling rate, sleep, and stabilization.",
    ],
    advanced: [
      t("featureLab"),
      "All advanced key modes remain visible, with safe read-only inspection in this basic release.",
    ],
    diagnostics: [
      t("diagnostics"),
      "Feature bitmap, device metadata, protocol surface, and session log.",
    ],
    about: [
      t("about"),
      "Project background, credits, links, and other author-written content.",
    ],
  }[state.page];
}

function overviewPage() {
  const perf = state.profile.performance[selectedKey().id],
    info = state.hardware.info,
    rtCount = Object.values(state.profile.performance).filter(
      (item) => item.mode === 1,
    ).length;
  return `<div class="page-grid"><section class="panel full-span"><div class="summary-grid"><article class="summary-card"><span>Connection</span><strong>${connected() ? "Connected" : "Offline"}</strong><small>${connected() ? `${esc(info?.serial || "AE64 Pro")} · FW ${esc(info?.firmware || "?")}` : "Demo data; no writes possible"}</small></article><article class="summary-card"><span>Current profile</span><strong>${esc(state.hardware.configNames[state.profile.profileIndex] || `Profile ${state.profile.profileIndex + 1}`)}</strong><small>Hardware configuration ${state.profile.profileIndex + 1}</small></article><article class="summary-card"><span>Rapid Trigger</span><strong>${rtCount} keys</strong><small>Selected: ${perf.mode ? "enabled" : "normal"}</small></article><article class="summary-card"><span>Pending changes</span><strong>${dirtyCount()}</strong><small>${state.autoApply ? "Auto apply writes completed edits" : "Written only when you apply"}</small></article></div></section>${boardPanel()}<section class="panel"><div class="panel-head"><div><h2>Selected key</h2><p>The current working copy for this key.</p></div></div>${selectedCard()}<ul class="fact-list"><li><span>Actuation</span><strong>${activeActuationDistance(perf).toFixed(2)} mm</strong></li><li><span>Rapid Trigger</span><strong>${perf.mode ? `${perf.rtPress.toFixed(2)} / ${perf.rtRelease.toFixed(2)} mm` : "Off"}</strong></li><li><span>Dead zones</span><strong>${perf.pressDeadStroke.toFixed(2)} / ${perf.releaseDeadStroke.toFixed(2)} mm</strong></li><li><span>Hardware address</span><strong>${selectedKey().row}:${selectedKey().col}</strong></li></ul><div class="apply-row"><button class="button primary" data-goto="performance" type="button">Tune this key</button></div></section></div>`;
}
function numberField(id, label, value, min, max, step, hint = "", disabled = false) {
  const inactive = disabled ? " disabled" : "";
  return `<label class="field ${disabled ? "disabled-field" : ""}"><span>${label}</span><div class="range-pair"><input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-range-for="${id}"${inactive}><input id="${id}" type="number" min="${min}" max="${max}" step="${step}" value="${value}"${inactive}></div>${hint ? `<small>${hint}</small>` : ""}</label>`;
}
function performanceControls() {
  const key = selectedKey(),
    value = state.profile.performance[key.id],
    rapidTrigger = Number(value.mode) === 1,
    independentRt = rtIndependentForKey(key.id, value),
    syncRt = !independentRt,
    deadZoneOn = deadZonesEnabled(value),
    actuationHint = rapidTrigger
      ? "The firmware's First Trigger Travel: RT starts only after this depth is crossed."
      : "The fixed depth that actuates this key in standard mode.";
  const standardRelease = !rapidTrigger
    ? `<label class="switch-row experimental-performance-toggle"><span><b>Expose normal release</b><small>Experimental: edit the firmware's normally hidden fixed release distance.</small></span><input id="normalReleaseExperiment" class="toggle" type="checkbox" ${state.showNormalReleaseExperimental ? "checked" : ""}></label>${state.showNormalReleaseExperimental ? `<div class="tuning-fields experimental-performance-field">${numberField("normalRelease", "Normal release", value.normalRelease, 0, 4, 0.01, "Experimental fixed-mode release value captured in the performance packet.")}</div>` : ""}`
    : "";
  const rapidSettings = rapidTrigger
    ? `<div class="rt-settings"><label class="switch-row independent-rt-toggle"><span><b>Sync RT Press & Release</b><small>Keeps both RT sensitivity values identical. Turn off to tune them separately.</small></span><input id="syncRt" class="toggle" type="checkbox" ${syncRt ? "checked" : ""}></label><div class="tuning-fields">${numberField("rtPress", "RT Press", value.rtPress, 0.01, 2, 0.01, "Downstroke movement required to reactuate.")}${numberField("rtRelease", "RT Release", syncRt ? value.rtPress : value.rtRelease, 0.01, 2, 0.01, syncRt ? "Synced to RT Press." : "Upstroke movement required to reset.", syncRt)}</div></div>`
    : "";
  return `${selectedCard()}<div class="actuation-tuning-columns"><section class="tuning-column"><div class="tuning-column-head"><span>01</span><div><h3>Actuation & Rapid Trigger</h3><p>Choose the initial actuation point, then optionally add dynamic press and release sensitivity.</p></div></div><label class="switch-row"><span><b>Rapid Trigger</b><small>Reset and reactuate from movement instead of fixed return points.</small></span><input id="performanceMode" class="toggle" type="checkbox" ${rapidTrigger ? "checked" : ""}></label><div class="tuning-fields actuation-distance-field">${numberField("actuationDistance", "Actuation distance", activeActuationDistance(value), 0.1, 4, 0.01, actuationHint)}</div>${standardRelease}${rapidSettings}</section><section class="tuning-column"><div class="tuning-column-head"><span>02</span><div><h3>Dead zones</h3><p>Ignore unstable movement at the top and bottom of switch travel.</p></div></div><label class="switch-row dead-zone-toggle-row"><span><b>Dead zones</b><small>Off writes 0.00 mm to both top and bottom dead-zone fields.</small></span><input id="deadZoneToggle" class="toggle" type="checkbox" ${deadZoneOn ? "checked" : ""}></label><div class="tuning-fields">${numberField("pressDeadStroke", "Top dead zone", deadZoneOn ? value.pressDeadStroke : 0, 0, 1, 0.01, deadZoneOn ? "Ignored movement near the top." : "Disabled; stored as 0.00 mm.", !deadZoneOn)}${numberField("releaseDeadStroke", "Bottom dead zone", deadZoneOn ? value.releaseDeadStroke : 0, 0, 1, 0.01, deadZoneOn ? "Ignored movement near full travel." : "Disabled; stored as 0.00 mm.", !deadZoneOn)}</div></section></div><div class="apply-row"><button class="button ghost" data-copy-performance type="button">Copy tuning to every key</button></div>`;
}
function switchSelectorControls() {
  const selected = selectedKey(),
    performance = state.profile.performance[selected.id],
    current = switchCatalogEntry(performance.axisV2Id),
    currentPending =
      connected() &&
      ["idle", "loading"].includes(state.switchAssignmentsStatus) &&
      !state.hardware.performance.has(selected.id) &&
      !state.dirty.performance.has(selected.id),
    query = state.switchSearch.trim().toLowerCase(),
    brands = [...new Set(state.switchCatalog.map((entry) => entry.brand))].sort(
      (a, b) => a.localeCompare(b),
    ),
    visible = state.switchCatalog.filter((entry) => {
      const inBrand = state.switchBrand === "all" || entry.brand === state.switchBrand,
        haystack = [entry.name, entry.originalName, entry.brand, ...entry.aliases]
          .join(" ")
          .toLowerCase();
      return inBrand && (!query || haystack.includes(query));
    });
  if (state.switchCatalogStatus === "loading")
    return `${selectedCard()}<div class="switch-catalog-state"><span class="spinner"></span><b>Loading magnetic switch profiles…</b></div>`;
  if (state.switchCatalogStatus === "error")
    return `${selectedCard()}<div class="switch-catalog-state error"><b>Switch catalog unavailable</b><small>${esc(state.switchCatalogError || "The local catalog could not be loaded.")}</small></div>`;
  const cards = visible
    .map((entry) => {
      const active = Number(performance.axisV2Id) === Number(entry.axisV2Id),
        imageCandidates = entry.imageCandidates?.length
          ? entry.imageCandidates
          : switchImageCandidates(entry.axisV2Id, entry.image),
        encodedCandidates = encodeURIComponent(JSON.stringify(imageCandidates)),
        image = imageCandidates.length
          ? `<img src="${esc(imageCandidates[0])}" alt="${esc(entry.name)}" loading="lazy" decoding="async" data-switch-image-candidates="${esc(encodedCandidates)}" data-switch-image-index="0"><i class="switch-placeholder" data-switch-image-placeholder hidden style="--switch-color:${esc(entry.color || "#73f0c0")}"><span></span></i>`
          : `<i class="switch-placeholder" data-switch-image-placeholder style="--switch-color:${esc(entry.color || "#73f0c0")}"><span></span></i>`,
        original = entry.name !== entry.originalName
          ? `<small title="Captured name">${esc(entry.originalName)}</small>`
          : "";
      return `<button class="switch-catalog-card ${active ? "active" : ""}" style="--switch-color:${esc(entry.color || "var(--mint)")}" type="button" data-axis-v2-id="${entry.axisV2Id}" aria-pressed="${active}"><span class="switch-card-media">${image}</span><span class="switch-card-copy"><b>${esc(entry.name)}</b>${original}<em>${esc(entry.brand)} · ${(entry.axisRangeMax / 1000).toFixed(3)} mm</em></span><span class="switch-card-status">${active ? "SELECTED" : `ID ${entry.axisV2Id}`}</span></button>`;
    })
    .join("");
  const readStatus = connected() && state.switchAssignmentsStatus !== "ready"
    ? `<div class="switch-assignment-read ${state.switchAssignmentsStatus}"><span class="spinner"></span><div><b>${state.switchAssignmentsStatus === "error" ? "Some assignments could not be read" : "Reading all 64 switch assignments"}</b><small>${state.switchAssignmentsStatus === "error" ? esc(state.switchAssignmentsError) : "The keyboard map will update once; selecting individual keys is not required."}</small></div></div>`
    : "";
  return `${selectedCard()}${readStatus}<div class="switch-selector-summary"><div><span>CURRENT SWITCH PROFILE</span><b>${currentPending ? "Reading…" : current ? esc(current.name) : `Unknown axis ${Number(performance.axisV2Id) || 0}`}</b><small>${currentPending ? "Loading the selected key's switch record from the keyboard." : current ? `${esc(current.brand)} · ${(current.axisRangeMax / 1000).toFixed(3)} mm travel · coefficient ${current.axisCoefficient}` : "The keyboard-reported axis ID is not present in this captured catalog."}</small></div><span class="badge ${current ? "ready" : "experimental"}">${selectedKeyIds().length} KEY${selectedKeyIds().length === 1 ? "" : "S"}</span></div><div class="switch-catalog-toolbar"><input class="search-input" id="switchSearch" type="search" placeholder="Search switch, brand, or alias" value="${esc(state.switchSearch)}"><div class="switch-brand-tabs" role="tablist" aria-label="Magnetic switch brand"><button type="button" data-switch-brand="all" class="${state.switchBrand === "all" ? "active" : ""}">All <span>${state.switchCatalog.length}</span></button>${brands.map((brand) => `<button type="button" data-switch-brand="${esc(brand)}" class="${state.switchBrand === brand ? "active" : ""}">${esc(brand)} <span>${state.switchCatalog.filter((entry) => entry.brand === brand).length}</span></button>`).join("")}</div></div><div class="switch-catalog-grid">${cards || '<div class="switch-catalog-empty"><b>No switch profiles match this filter.</b><small>Try another brand or search term.</small></div>'}</div><div class="switch-selector-note"><b>Firmware behavior</b><span>Selecting a profile stages its detailed axis ID, range, and coefficient for every selected key—the same three fields used by the original driver. Recalibrate after installing a different switch.</span></div>`;
}
function performanceWorkspaceTabs() {
  const tabs = [
    ["tuning", "Actuation tuning"],
    ["switches", "Magnetic Switch Selector"],
  ];
  return `<div class="performance-workspace-tabs" role="tablist" aria-label="Performance settings mode">${tabs.map(([value, label]) => `<button type="button" role="tab" data-performance-workspace="${value}" aria-selected="${state.performanceWorkspace === value}" class="${state.performanceWorkspace === value ? "active" : ""}">${label}</button>`).join("")}</div>`;
}
function keySwitchTravel(key) {
  const performance = state.profile.performance[key.id],
    catalog = switchCatalogEntry(performance?.axisV2Id),
    rawRange = Number(catalog?.axisRangeMax || performance?.axisRangeMax || 4000);
  return rawRange > 0 ? rawRange / 1000 : 4;
}
function travelRangeLabel(distance) {
  return Number(distance).toFixed(3).replace(/0$/, "");
}
function travelGaugeTicks(maxTravel = 4) {
  const range = Math.max(0.1, Number(maxTravel) || 4),
    lastTenth = Math.floor((range + 0.0000001) * 10),
    distances = Array.from({ length: lastTenth + 1 }, (_, index) => index / 10);
  if (range - distances.at(-1) > 0.0005) distances.push(range);
  return distances.map((distance, index) => {
    const endpoint = Math.abs(distance - range) <= 0.0005,
      major = index === 0 || index % 5 === 0 || endpoint,
      label = endpoint ? travelRangeLabel(range) : distance.toFixed(1),
      position = Math.min(100, Math.max(0, distance / range * 100));
    return `<i class="${major ? "major" : ""} ${endpoint ? "endpoint" : ""}" data-travel-tick="${distance.toFixed(3)}" style="--tick-position:${position.toFixed(4)}%" title="${label} mm">${major ? `<span>${label}</span>` : ""}</i>`;
  }).join("");
}
function liveTravelTarget() {
  const selectedIds = selectedKeyIds(),
    candidates = selectedIds.length ? selectedIds.map((id) => keys[id]) : keys,
    key = candidates.reduce((furthest, candidate) => {
      const value = Number(state.hardware.travelValues.get(candidate.id) || 0),
        furthestValue = Number(state.hardware.travelValues.get(furthest.id) || 0);
      return value > furthestValue ? candidate : furthest;
    }, candidates[0] || keys[0]),
    raw = Number(state.hardware.travelValues.get(key.id) || 0),
    travelMax = keySwitchTravel(key),
    mm = Math.min(travelMax, Math.max(0, raw / 1000)),
    actuation = Math.min(travelMax, Math.max(0, activeActuationDistance(state.profile.performance[key.id])));
  return { key, raw, mm, actuation, travelMax, selectedCount: selectedIds.length };
}
function livePressDistancePanel() {
  const focus = liveTravelTarget(),
    { key, raw, mm, actuation, travelMax, selectedCount } = focus,
    percent = (mm / travelMax) * 100,
    actuationPercent = (actuation / travelMax) * 100,
    active = keys
      .map((key) => ({
        key,
        mm: Math.min(
          keySwitchTravel(key),
          Math.max(0, Number(state.hardware.travelValues.get(key.id) || 0) / 1000),
        ),
      }))
      .filter(({ mm: distance }) => distance >= 0.01)
      .sort((a, b) => b.mm - a.mm);
  return `<section class="panel live-press-panel compact" id="livePressPanel" style="--press-distance:${percent.toFixed(2)}%;--actuation-distance:${actuationPercent.toFixed(2)}%">
    <div class="panel-head"><div><h2>Live press distance</h2><p>The gauge follows the furthest pressed key ${selectedCount ? "inside the current selection" : "across the whole keyboard"}.</p></div><span id="livePressStatus" class="badge ${connected() ? "ready" : "experimental"}">${connected() ? "LIVE" : "CONNECT"}</span></div>
    <div class="live-press-layout">
      <div class="axis-visual" aria-label="Focused switch travel and actuation point from zero to ${travelRangeLabel(travelMax)} millimeters">
        <img src="assets/images/axis.png" alt="Magnetic switch axis outline">
        <div class="axis-gauge-pole"><i class="axis-gauge-fill"></i></div>
        <div class="axis-gauge-scale" data-travel-max="${travelMax.toFixed(3)}">${travelGaugeTicks(travelMax)}<span class="axis-actuation-marker"><b id="liveActuationMarkerLabel">AP ${actuation.toFixed(2)}</b></span></div>
      </div>
      <div class="live-press-readout">
        <span>TRACKING · <b id="livePressKey">${esc(key.n)}</b></span>
        <strong id="livePressValue">${mm.toFixed(3)} <small>mm</small></strong>
        <div class="live-press-summary"><span><small>Raw route</small><b id="livePressRaw">${raw}</b></span><span><small>Actuation</small><b id="livePressActuation">${actuation.toFixed(2)} mm</b></span><span><small>Scope</small><b id="livePressScope">${selectedCount ? `${selectedCount} selected` : "All keys"}</b></span></div>
        <div><h3>Pressed keys</h3><p>Multiple switches remain visible at the same time.</p><div class="pressed-key-list" id="pressedKeyList">${active.length ? active.map(({ key, mm: distance }) => `<span><b>${esc(key.n)}</b>${distance.toFixed(3)} mm</span>`).join("") : "<em>Press any key to begin.</em>"}</div></div>
      </div>
    </div>
  </section>`;
}
function performancePage() {
  const switchMode = state.performanceWorkspace === "switches";
  return `<div class="performance-page"><div class="performance-primary ${state.livePressDistance ? "with-live-monitor" : ""}">${boardPanel({ performance: true })}${state.livePressDistance ? livePressDistancePanel() : ""}</div><section class="panel performance-tuning"><div class="panel-head"><div><span class="eyebrow">PER-KEY HALL SETTINGS</span><h2>${switchMode ? "Magnetic Switch Selector" : "Actuation tuning"}</h2><p>${switchMode ? "Assign captured AE64 Pro magnetic-switch calibration metadata to the selected keys." : "Actuation, Rapid Trigger, and both dead zones are edited together for the selected keys."}</p></div><label class="switch-row live-press-toggle"><span><b>Live press distance</b><small>Show the compact gauge beside the keyboard.</small></span><input id="livePressDistanceToggle" class="toggle" type="checkbox" ${state.livePressDistance ? "checked" : ""} ${connected() && !state.calibrationActive && !state.calibrationBusy ? "" : "disabled"}></label></div>${performanceWorkspaceTabs()}${switchMode ? switchSelectorControls() : performanceControls()}</section></div>`;
}
function keymapPage() {
  const primaryKey = selectedKey().id;
  if (state.selectedKeys.size !== 1 || !state.selectedKeys.has(primaryKey))
    state.selectedKeys = new Set([primaryKey]);
  const active = displayedKeycode(selectedKey()),
    selected = selectedKeyIds(),
    mappingGroup = KEYMAP_SELECTABLE_GROUPS.includes(state.mappingGroup)
      ? state.mappingGroup
      : KEYMAP_SELECTABLE_GROUPS[0],
    groups = KEYMAP_SELECTABLE_GROUPS,
    entries = KEYCODE_GROUPS[mappingGroup].filter((entry) =>
      entry.label.toLowerCase().includes(state.mappingSearch.toLowerCase()),
    ),
    editor = `<input class="search-input" id="mappingSearch" type="search" placeholder="Search functions" value="${esc(state.mappingSearch)}"><div class="mapping-list">${entries.map((entry) => `<button type="button" data-keycode="${entry.code}" class="${entry.code === active ? "active" : ""}">${esc(entry.label)}</button>`).join("")}</div>`;
  const layers = ["Main", "Fn1", "Fn2", "Fn3"];
  return `<div class="page-grid"><div class="layer-bar full-span"><div class="layer-tabs" role="tablist" aria-label="Key mapping layer">${layers.map((label, layer) => `<button type="button" role="tab" data-layer="${layer}" aria-selected="${layer === Number(state.profile.layer)}" class="${layer === Number(state.profile.layer) ? "active" : ""}"><span>0${layer + 1}</span>${label}</button>`).join("")}</div><span>Choose a layer, then select one physical key.</span></div>${boardPanel()}<section class="panel"><div class="panel-head"><div><h2>Assign ${selected.length === 1 ? esc(selectedKey().n) : `${selected.length} keys`}</h2><p>Writes a 16-bit keycode on ${layers[Number(state.profile.layer)]}.</p></div><span class="badge ready">4 LAYERS</span></div>${selectedCard()}<div class="mapping-browser"><div class="mapping-groups">${groups.map((group) => `<button type="button" data-mapping-group="${group}" class="${group === mappingGroup ? "active" : ""}">${group}</button>`).join("")}</div>${editor}</div><div class="apply-row"><button class="button ghost" id="resetKeycode" type="button">Default for selected key${selected.length === 1 ? "" : "s"}</button></div></section></div>`;
}

function lightingArea(index) {
  return (
    state.hardware.lightingAreas.find(
      (area) => Number(area.index) === Number(index),
    ) || null
  );
}
function mainLightingArea() {
  return lightingArea(0) || state.hardware.lightingAreas[0] || null;
}
function decorativeLightingArea() {
  return lightingArea(1) || null;
}
function lightingModeCount(index, fallback) {
  const count = Number(lightingArea(index)?.count);
  return Number.isInteger(count) && count > 0
    ? Math.min(count, LIGHTING_MODE_OPTIONS.length)
    : fallback;
}
function lightingRange(id, label, value, hint) {
  return `<label class="lighting-range" for="${id}"><span><b>${esc(label)}</b><output id="${id}Value">${Number(value)}</output></span><input id="${id}" type="range" min="0" max="100" step="1" value="${Number(value)}"><small>${esc(hint)}</small></label>`;
}
function lightingTabs() {
  return `<div class="lighting-tabs" role="tablist" aria-label="Lighting sections"><button type="button" role="tab" data-lighting-tab="main" aria-selected="${state.lightingTab === "main"}" class="${state.lightingTab === "main" ? "active" : ""}"><span>01</span>${t("lightingMainKeyboard")}</button><button type="button" role="tab" data-lighting-tab="perKey" aria-selected="${state.lightingTab === "perKey"}" class="${state.lightingTab === "perKey" ? "active" : ""}"><span>02</span>${t("lightingPerKey")}</button><button type="button" role="tab" data-lighting-tab="strip" aria-selected="${state.lightingTab === "strip"}" class="${state.lightingTab === "strip" ? "active" : ""}"><span>03</span>${t("lightingDecorative")}</button></div>`;
}
function lightingPowerPanel(base, title, description, includeLedBanks = false) {
  const upper = base.open && Boolean(Number(base.openMode) & LIGHTING_OPEN_MODE.UPPER),
    lower = base.open && Boolean(Number(base.openMode) & LIGHTING_OPEN_MODE.LOWER),
    ledBanks = includeLedBanks
      ? `<label class="lighting-power">
    <span>
        <b>${t("lightingUpper")}</b>
        <small>bit 2</small>
    </span>
    <input id="upperLighting" class="toggle" type="checkbox" ${upper ? "checked" : "" }>
</label>

<label class="lighting-power">
    <span>
        <b>${t("lightingLower")}</b>
        <small>bit 1</small>
    </span>
    <input id="lowerLighting" class="toggle" type="checkbox" ${lower ? "checked" : "" }>
</label>`
      : "";
  return `<section class="panel full-span area-power-panel"><div class="area-power-summary"><div><h2>${esc(title)}</h2><p>${esc(description)}</p></div><label class="lighting-power"><span><b>${t("lightingPower")}</b><small>${base.open ? "On" : "Off"} · firmware value ${base.open ? base.openMode || 1 : 0}</small></span><input id="lightingOpen" class="toggle" type="checkbox" ${base.open ? "checked" : ""}></label>${ledBanks}</div></section>`;
}
function lightingModePanel(base, count, target, area, reportedCount = count) {
  const modes = LIGHTING_MODE_OPTIONS.slice(0, count),
    showExperimental = target === "main" && Number(base.mode) >= reportedCount;
  return `<section class="panel lighting-mode-panel"><div class="panel-head"><div><h2>${t("lightingMode")}</h2><p>${t("lightingModeHint")}</p></div><span class="badge ready">${count} MODES</span></div><div class="lighting-mode-grid">${modes
    .map((mode) => {
      const experimental = mode.value >= reportedCount;
      return `<button type="button" data-lighting-mode="${mode.value}" data-lighting-target="${target}" class="${mode.value === Number(base.mode) ? "active " : ""}${experimental ? "experimental" : ""}"><span>${mode.label}${experimental ? " *" : ""}</span><small>${experimental ? "UNADVERTISED" : "Area " + area} · value ${mode.value}</small></button>`;
    })
    .join("")}</div>${showExperimental ? '<div class="capture-note experimental-note lighting-mode-warning"><strong>L21–L23 are experimental</strong><span>AE64 area 0 advertises values 0–19. Catalog values 20–22 are exposed for testing; Apply accepts a value only when the keyboard reads it back unchanged.</span></div>' : ""}</section>`;
}
function lightingDirection(base, target) {
  return `<div class="lighting-direction"><span><b>${t("lightingDirection")}</b><small>One firmware bit; no left/right variants.</small></span><div><button type="button" data-lighting-direction="0" data-lighting-target="${target}" class="${Number(base.direction) === 0 ? "active" : ""}">→ ${t("lightingForward")}</button><button type="button" data-lighting-direction="1" data-lighting-target="${target}" class="${Number(base.direction) === 1 ? "active" : ""}">← ${t("lightingBackward")}</button></div></div>`;
}
function lightingTunePanel(base, target, area) {
  const prefix = target === "main" ? "lighting" : "strip";
  return `<section class="panel lighting-tune-panel"><div class="panel-head"><div><h2>Effect tuning</h2><p>Continuous values used by this firmware area.</p></div><span class="badge">AREA ${area}</span></div>${lightingRange(`${prefix}Brightness`, t("lightingBrightness"), base.brightness, "0 is dark; 100 is maximum output.")}${lightingRange(`${prefix}Speed`, t("lightingSpeed"), base.speed, "0 is slowest; 100 is fastest.")}${lightingDirection(base, target)}</section>`;
}
function lightingPalettePanel(base, palette, target) {
  const paletteIndex = Math.max(0, Math.min(7, Number(base.paletteIndex))),
    activeColor = palette[paletteIndex] || "#000000",
    rainbow = paletteIndex === 0,
    colorId = target === "main" ? "paletteColor" : "stripPaletteColor",
    hexId = target === "main" ? "paletteHex" : "stripPaletteHex";
  return `<section class="panel full-span lighting-palette-panel"><div class="panel-head"><div><h2>${t("lightingPalette")}</h2><p>Eight firmware choices. The first entry is the original driver's rainbow palette; the remaining seven are editable RGB colors.</p></div><span class="badge ${rainbow ? "experimental" : "ready"}">${rainbow ? "RAINBOW" : `COLOR ${paletteIndex}`}</span></div><div class="palette palette-large">${palette.map((swatch, index) => `<button type="button" data-palette="${index}" data-lighting-target="${target}" class="${index === paletteIndex ? "active " : ""}${index === 0 ? "rainbow" : ""}" style="--swatch:${esc(swatch)}" aria-label="${index === 0 ? "Select firmware rainbow palette" : `Select palette color ${index}`}" title="${index === 0 ? "Rainbow · firmware index 0" : esc(swatch)}"><span>${index === 0 ? "RGB" : String(index).padStart(2, "0")}</span></button>`).join("")}</div><div class="palette-editor ${rainbow ? "rainbow-selected" : ""}">${rainbow ? `<div class="rainbow-chip" aria-hidden="true"><input id="${colorId}" type="color" value="${esc(activeColor)}" disabled></div>` : `<input id="${colorId}" type="color" value="${esc(activeColor)}" aria-label="${t("lightingActiveColor")}">`}<label class="field"><span>${rainbow ? "Firmware palette" : t("lightingActiveColor")}</span><input id="${hexId}" type="text" maxlength="7" pattern="#[0-9A-Fa-f]{6}" value="${rainbow ? "RAINBOW" : esc(activeColor.toUpperCase())}" ${rainbow ? "disabled" : ""}><small>${rainbow ? "Index 0 is rendered as a moving spectrum by firmware. Its captured seed RGB is red and all hue bytes are 0." : `RGB ${parseInt(activeColor.slice(1, 3), 16)}, ${parseInt(activeColor.slice(3, 5), 16)}, ${parseInt(activeColor.slice(5, 7), 16)} · firmware index ${paletteIndex}`}</small></label><div class="palette-note"><strong>${rainbow ? "Original rainbow behavior" : "Stored on the keyboard"}</strong><span>${rainbow ? "This is a selector value, not an extra editable color or a hidden H-byte flag." : `This palette belongs only to ${target === "main" ? "the key LEDs" : "Decorative1"}.`}</span></div></div></section>`;
}
function mainLightingPage() {
  const lighting = state.profile.lighting,
    base = lighting.base,
    reportedCount = lightingModeCount(0, AE64_MAIN_MODE_COUNT),
    count = LIGHTING_MODE_OPTIONS.length;
  return `<div class="lighting-layout">${lightingPowerPanel(base, t("lightingMainKeyboard"), "Controls the main keyboard LED area.", true)}${lightingModePanel(base, count, "main", 0, reportedCount)}${lightingTunePanel(base, "main", 0)}${lightingPalettePanel(base, lighting.palette, "main")}</div>`;
}
function perKeyLightingPage() {
  const lighting = state.profile.lighting,
    ids = lightingKeyIds(),
    key = lightingAnchorKey(),
    hasSelection = ids.length > 0,
    color = lighting.perKey[key.id] || "#73f0c0",
    enabled =
      hasSelection && ids.every((id) => Boolean(lighting.customEnabled?.[id])),
    mixed =
      hasSelection &&
      !enabled &&
      ids.some((id) => Boolean(lighting.customEnabled?.[id])),
    customCount = Object.values(lighting.customEnabled || {}).filter(
      Boolean,
    ).length,
    label = ids.length === 1 ? keys[ids[0]].n : `${ids.length} keys`;
  return `<div class="lighting-layout"><section class="panel per-key-editor"><div class="panel-head"><div><h2>${hasSelection ? `${esc(label)} · ${t("lightingCustomOverride")}` : "Select keys in the preview"}</h2><p>Drag a rectangular marquee over keys. Hold Ctrl while dragging or clicking to toggle the enclosed keys.</p></div><span class="badge ${enabled ? "ready" : mixed ? "experimental" : ""}">${ids.length} SELECTED</span></div><div class="switch-row"><div><h3>${t("lightingCustomOverride")}</h3><p>The setting is applied to every selected key.</p></div><input id="keyCustomEnabled" class="toggle" type="checkbox" ${enabled ? "checked" : ""} ${hasSelection ? "" : "disabled"}></div><div class="key-color-editor"><input id="keyColor" type="color" value="${esc(color)}" aria-label="Selected key color" ${hasSelection ? "" : "disabled"}><div><span>Selected key color</span><strong>${esc(color.toUpperCase())}</strong><small>${customCount} of 64 keys currently use overrides.</small></div></div><div class="apply-row"><button class="button ghost" id="clearKeyColor" type="button" ${hasSelection ? "" : "disabled"}>Clear selected overrides</button><button class="button primary" id="copyKeyColor" type="button" ${hasSelection ? "" : "disabled"}>${t("lightingCopyAll")}</button></div></section><section class="panel matrix-card"><div class="panel-head"><div><h2>Keyboard LED framebuffer</h2><p>Nine packets cover the firmware's 6 × 21 address space.</p></div><span class="badge">9 × 15 RECORDS</span></div><ul class="fact-list"><li><span>Visible keys</span><strong>64</strong></li><li><span>Selected keys</span><strong>${ids.length}</strong></li><li><span>Live refresh</span><strong>≈ 10 FPS</strong></li></ul><div class="apply-row"><button class="button ghost" id="loadCustomLighting" type="button">${t("lightingReadMatrix")}</button><button class="button ghost" id="clearAllKeyColors" type="button">${t("lightingClearAll")}</button></div></section></div>`;
}
function stripLedButton(index, side) {
  const lighting = state.profile.lighting.decorative,
    paletteIndex = Number(lighting.base.paletteIndex),
    baseColor =
      (paletteIndex === 0 ? RAINBOW_PREVIEW[index % RAINBOW_PREVIEW.length] : lighting.palette[paletteIndex]) ||
      lighting.palette[0] ||
      "#000000",
    live =
      state.liveLighting &&
      connected() &&
      Array.isArray(state.hardware.liveStrip),
    custom = Boolean(lighting.customEnabled[index]),
    record = live ? state.hardware.liveStrip[index] : null,
    color = record
      ? rgbToHex(record)
      : custom
        ? lighting.perLed[index]
        : baseColor,
    selected =
      state.page === "lighting" &&
      state.lightingTab === "strip" &&
      state.stripSelection.has(index);
  return `<button type="button" data-strip-led="${index}" data-strip-side="${side}" class="${selected ? "selected" : ""} ${custom ? "custom" : ""}" style="--led-color:${esc(color)}" title="LED ${index} · ${esc(color.toUpperCase())}" aria-pressed="${selected}"><span>${index}</span></button>`;
}
function stripHtml() {
  const side = (name) =>
    DECORATIVE_LAYOUT[name]
      .map((index) => stripLedButton(index, name))
      .join("");
  return `<div class="decorative-frame" aria-label="Light strip physical perimeter with 38 LEDs"><div class="decorative-side decorative-top">${side("top")}</div><div class="decorative-side decorative-left">${side("left")}</div><div class="decorative-keyboard-core lighting-preview">${keyboardHtml({ lighting: true })}</div><div class="decorative-side decorative-right">${side("right")}</div><div class="decorative-side decorative-bottom">${side("bottom")}</div></div>`;
}
function unifiedLightingPreview() {
  const keyCount = lightingKeyIds().length,
    stripCount = stripLedIds().length,
    hints = {
      main: "Live preview only. Choose the keyboard effect in the controls below.",
      perKey:
        "Drag a rectangle over keyboard keys. Ctrl+drag or Ctrl+click toggles keys.",
      strip:
        "Drag a rectangle over the four light-strip sides. Ctrl toggles LEDs.",
    };
  return `<section class="panel unified-lighting-preview"><div class="panel-head"><div><h2>Unified live lighting</h2><p>The keyboard and all 38 perimeter LEDs stay visible while the settings below change.</p></div><span class="badge ${state.liveLighting && connected() ? "ready" : ""}">KEYBOARD + 38 LEDS</span></div><div class="unified-preview-scroll"><i class="lighting-selection-marquee" aria-hidden="true"></i>${stripHtml()}</div><div class="board-footer"><span>${hints[state.lightingTab]}</span><span id="lightingSelectionSummary">${state.lightingTab === "perKey" ? `Selected: <b>${keyCount} key${keyCount === 1 ? "" : "s"}</b>` : state.lightingTab === "strip" ? `Selected: <b>${stripCount} LED${stripCount === 1 ? "" : "s"}</b>` : "Preview mode"}</span></div></section>`;
}
function decorativeLightingPage() {
  const lighting = state.profile.lighting.decorative,
    base = lighting.base,
    count = lightingModeCount(1, AE64_DECORATIVE_MODE_COUNT),
    ids = stripLedIds(),
    hasSelection = ids.length > 0,
    selected = Math.max(
      0,
      Math.min(DECORATIVE_COLS - 1, Number(state.stripSelected)),
    ),
    color = lighting.perLed[selected] || "#73f0c0",
    enabled =
      hasSelection &&
      ids.every((index) => Boolean(lighting.customEnabled[index])),
    mixed =
      hasSelection &&
      !enabled &&
      ids.some((index) => Boolean(lighting.customEnabled[index])),
    customCount = lighting.customEnabled.filter(Boolean).length;
  return `<div class="lighting-layout">${lightingPowerPanel(base, t("lightingDecorative"), "Controls the independent 38-LED perimeter area.")}${lightingModePanel(base, count, "strip", 1)}${lightingTunePanel(base, "strip", 1)}${lightingPalettePanel(base, lighting.palette, "strip")}<section class="panel full-span strip-editor"><div class="panel-head"><div><h2>${hasSelection ? `${ids.length} light strip LED${ids.length === 1 ? "" : "s"} selected` : "Select LEDs on the four sides"}</h2><p>Drag a rectangular marquee over any of the four sides. Hold Ctrl to toggle the enclosed LEDs.</p></div><span class="badge ${enabled ? "ready" : mixed ? "experimental" : ""}">${ids.length} SELECTED</span></div><div class="strip-editor-grid"><label class="switch-row"><span><b>${t("lightingCustomOverride")}</b><small>The setting is applied to every selected light-strip LED.</small></span><input id="stripCustomEnabled" class="toggle" type="checkbox" ${enabled ? "checked" : ""} ${hasSelection ? "" : "disabled"}></label><div class="key-color-editor"><input id="stripColor" type="color" value="${esc(color)}" aria-label="Selected strip LED color" ${hasSelection ? "" : "disabled"}><div><span>Selected strip color</span><strong>${esc(color.toUpperCase())}</strong><small>${customCount} of 38 overrides enabled.</small></div></div></div><div class="apply-row"><button class="button ghost" id="loadStripLighting" type="button">${t("lightingReadMatrix")}</button><button class="button ghost" id="clearStripColor" type="button" ${hasSelection ? "" : "disabled"}>Clear selected overrides</button><button class="button ghost" id="clearAllStripColors" type="button">${t("lightingClearStrip")}</button><button class="button primary" id="copyStripColor" type="button" ${hasSelection ? "" : "disabled"}>${t("lightingCopyStrip")}</button></div></section></div>`;
}
function lightingPage() {
  const lighting = state.profile.lighting,
    keyboardOff = !lighting.base.open,
    stripOff = !lighting.decorative.base.open;
  return `<div class="lighting-page lighting-context-${state.lightingTab} ${keyboardOff ? "keyboard-off" : ""} ${stripOff ? "strip-off" : ""}"><section class="panel lighting-command"><div class="lighting-command-copy"><span class="eyebrow">RGB / LIVE FRAMEBUFFER</span><h2>Keyboard + light strip</h2><p>One permanent preview for both firmware lighting areas.</p><span id="liveRgbStatus" class="badge ${state.liveLighting && connected() ? "ready" : ""}">${state.liveLighting && connected() ? "LIVE · READING" : "LIVE · PAUSED"}</span></div><label class="lighting-power live-rgb-toggle"><span><b>${t("lightingLive")}</b><small>${t("lightingLiveHint")}</small></span><input id="lightingLive" class="toggle" type="checkbox" ${state.liveLighting ? "checked" : ""}></label></section>${unifiedLightingPreview()}<section class="panel lighting-section-nav">${lightingTabs()}</section>${state.lightingTab === "main" ? mainLightingPage() : state.lightingTab === "perKey" ? perKeyLightingPage() : decorativeLightingPage()}</div>`;
}
function mappedOptions(options, current, supportedValues, labelFor) {
  const supported = new Set(supportedValues.map(Number)),
    visible = supported.size
      ? options.filter((option) => supported.has(option.value))
      : options;
  const normalized = visible.some((option) => option.value === Number(current))
    ? visible
    : [{ value: Number(current), unknown: true }, ...visible];
  return normalized
    .map(
      (option) =>
        `<option value="${option.value}" ${option.value === Number(current) ? "selected" : ""}>${esc(option.unknown ? `Unknown device value ${option.value}` : labelFor(option))}</option>`,
    )
    .join("");
}
function settingsPage() {
  const settings = state.profile.settings,
    activeProfile = state.profile.profileIndex + 1,
    connectedLabel = connected() ? `Firmware ${esc(state.hardware.info?.firmware || "?")}` : "Offline workspace";
  const systemOptions = mappedOptions(
    SYSTEM_MODE_OPTIONS,
    settings.systemMode,
    [],
    (option) => option.label,
  );
  const pollingOptions = mappedOptions(
    POLLING_RATE_OPTIONS,
    settings.reportRate,
    state.hardware.reportRates,
    (option) => `${option.hz.toLocaleString()} Hz`,
  );
  const reconnect = connected()
    ? ""
    : `<button class="button primary" id="reconnectKeyboard" type="button">Reconnect keyboard</button>`;
  const themes = THEME_OPTIONS.map((theme) => `<button class="theme-choice ${state.theme === theme.value ? "active" : ""}" type="button" data-theme-choice="${theme.value}" aria-pressed="${state.theme === theme.value}" style="--theme-color:${theme.color}"><i><span></span></i><b>${theme.label}</b><small>${theme.hint}</small></button>`).join("");
  return `<div class="settings-page"><section class="panel settings-hero"><div class="settings-hero-copy"><span class="eyebrow">DEVICE CONTROL CENTER</span><h2>AE64 Pro settings</h2><p>Hardware behavior, onboard profiles, local backups, and the driver's appearance in one quieter workspace.</p></div><div class="settings-connection ${connected() ? "online" : ""}"><i></i><div><small>${connected() ? "KEYBOARD CONNECTED" : "KEYBOARD OFFLINE"}</small><b>${connectedLabel}</b></div>${reconnect}</div><div class="settings-hero-facts"><span><small>Active profile</small><b>0${activeProfile}</b></span><span><small>System</small><b>${Number(settings.systemMode) === 1 ? "macOS" : "Windows"}</b></span><span><small>Polling</small><b>${POLLING_RATE_OPTIONS.find((option) => option.value === Number(settings.reportRate))?.hz.toLocaleString() || "?"} Hz</b></span></div></section><div class="settings-grid"><section class="panel settings-card settings-usb"><div class="settings-card-icon">↯</div><div class="panel-head"><div><h2>System & USB</h2><p>Firmware-owned operating mode and scan behavior.</p></div><span class="badge ready">ONBOARD</span></div><div class="form-grid"><label class="field"><span>System mode</span><select id="systemMode">${systemOptions}</select><small>Windows = 0 · macOS = 1 in the original protocol.</small></label><label class="field"><span>Polling rate</span><select id="reportRate">${pollingOptions}</select><small>Changing this restarts the USB interface and reconnects automatically.</small></label><label class="field"><span>RGB sleep timer</span><div class="input-with-unit"><input id="sleepTime" type="number" min="0" max="65535" value="${settings.sleepTime}"><span>minutes</span></div><small>Use 0 only if you want the firmware to keep lighting awake.</small></label></div><label class="switch-row setting-switch"><span><b>Shake optimization</b><small>Firmware key-stability filtering for small magnetic fluctuations.</small></span><input id="shake" class="toggle" type="checkbox" ${settings.shake ? "checked" : ""}></label></section><section class="panel settings-card settings-profile"><div class="settings-card-icon">P${activeProfile}</div><div class="panel-head"><div><h2>Onboard profile</h2><p>Rename or switch the loaded configuration.</p></div><span class="badge">${state.hardware.configIndexes.length} SLOTS</span></div><label class="field"><span>Profile ${activeProfile} name</span><input id="profileName" type="text" maxlength="32" value="${esc(state.hardware.configNames[state.profile.profileIndex] || `Profile ${activeProfile}`)}"><small>The quick switch remains at the top of the navigation bar.</small></label><div class="profile-slot-row" role="group" aria-label="Onboard profile">${state.hardware.configIndexes.map((index) => `<button type="button" data-profile-slot="${index}" class="${index === state.profile.profileIndex ? "active" : ""}" aria-pressed="${index === state.profile.profileIndex}" title="Switch to profile ${index + 1}">${index + 1}</button>`).join("")}</div><div class="apply-row"><button class="button ghost" id="saveProfileName" type="button">Save profile name</button></div></section><section class="panel settings-card settings-appearance"><div class="settings-card-icon">◐</div><div class="panel-head"><div><h2>Appearance</h2><p>Inspired by the token-based light and dark surfaces found in the ATK Hub capture. Stored only in this browser.</p></div><span class="badge ready">INSTANT</span></div><div class="theme-grid" role="group" aria-label="Driver appearance">${themes}</div></section><section class="panel settings-card settings-files"><div class="settings-card-icon">⇅</div><div class="panel-head"><div><h2>Backup & portability</h2><p>Keep a local JSON copy independent of the manufacturer cloud.</p></div></div><div class="file-actions"><button class="button ghost" id="importProfile" type="button"><span>Import</span><small>Open a saved JSON profile</small></button><button class="button primary" id="exportProfile" type="button"><span>Export</span><small>Download the current workspace</small></button></div></section><section class="panel settings-card settings-recovery"><div class="settings-card-icon danger">!</div><div class="panel-head"><div><h2>Recovery</h2><p>Potentially destructive device operations remain deliberately guarded.</p></div><span class="badge experimental">LOCKED</span></div><div class="recovery-row"><div><b>Factory restore</b><small>Visible for completeness, disabled until a physical-device restore packet is captured and verified.</small></div><button class="button danger" type="button" disabled>Restore factory settings</button></div></section></div></div>`;
}
const ADVANCED_FEATURES = [
  [
    "DKS",
    "Dynamic Keystroke",
    "Up to four keycodes at multiple press/release points.",
  ],
  [
    "MPT",
    "Multi-point Trigger",
    "Three key actions at distinct travel depths.",
  ],
  [
    "MT",
    "Mod-Tap",
    "Tap one function and hold another after a time threshold.",
  ],
  ["TGL", "Toggle Key", "Latch a key action with firmware timing."],
  ["END", "End Key", "Trigger paired actions with an end delay."],
  [
    "SOCD",
    "SOCD Resolution",
    "Resolve two opposing keys using firmware priority modes.",
  ],
  [
    "RS",
    "Rappy Snappy",
    "Compare two keys by travel and prefer the deeper input.",
  ],
];
function advancedPage() {
  return `<div class="page-grid"><section class="panel full-span warning-card"><div class="panel-head"><div><h2>Advanced Hall-key modes</h2><p>All seven shipped features are visible. This basic release safely decodes them without unverified writes.</p></div><span class="badge experimental">VISIBLE · READ ONLY</span></div></section>${boardPanel()}<section class="panel"><div class="panel-head"><div><h2>Selected-key record</h2><p>Decoded directly from family 0x06.</p></div></div>${selectedCard()}<div class="apply-row"><button class="button ghost" id="readMacroSpace" type="button">Read macro capacity</button><button class="button primary" id="readAdvanced" type="button">Read advanced record</button></div><pre class="raw-output">${esc(JSON.stringify({ advanced: state.hardware.advanced || "Connect and read", macroSpace: state.hardware.macroSpace || "Not read" }, null, 2))}</pre></section><section class="panel full-span"><div class="advanced-grid">${ADVANCED_FEATURES.map(([code, title, body], i) => `<article class="advanced-card"><header><h3>${code}</h3><span class="badge deferred">EDITOR NEXT</span></header><strong>${title}</strong><p>${body}</p><small>family 06 · mode ${i + 1}</small></article>`).join("")}</div></section></div>`;
}
function capabilityCards() {
  const feature = state.hardware.feature;
  const known = {
    mechanical: null,
    magnetic: null,
    optical: null,
    inductive: null,
    magnetic3D: null,
    usb: null,
    wireless24: null,
    bluetooth: null,
    usb3: null,
    rgb: null,
    knob: null,
    smallScreen: null,
    fullScreen: null,
    haptic: null,
    voicePlayback: null,
    voiceRecognition: null,
    gamepad: null,
    dotMatrix: null,
  };
  if (feature)
    Object.assign(
      known,
      feature.axis,
      feature.connection,
      feature.basic,
      feature.extended,
    );
  return `<div class="capability-grid">${Object.entries(known)
    .map(
      ([name, enabled]) =>
        `<article class="capability ${enabled === true ? "yes" : "no"}"><span>${esc(name)}</span><strong>${enabled === null ? "Connect to detect" : enabled ? "Reported" : "Not reported"}</strong></article>`,
    )
    .join("")}</div>`;
}
function diagnosticsPage() {
  const info = state.hardware.info || {};
  return `<div class="page-grid"><section class="panel"><div class="panel-head"><div><h2>Device identity</h2><p>Configuration HID collection metadata.</p></div><span class="badge ${connected() ? "ready" : ""}">${connected() ? "LIVE" : "DEMO"}</span></div><ul class="fact-list"><li><span>VID:PID</span><strong>1CA6:300A</strong></li><li><span>Board ID</span><strong>${esc(info.boardIdHex || "0030000A expected")}</strong></li><li><span>Firmware</span><strong>${esc(info.firmware || "Connect to read")}</strong></li><li><span>Protocol</span><strong>${state.hardware.protocol ? `${state.hardware.protocol.main}.${state.hardware.protocol.sub}` : "Connect to read"}</strong></li><li><span>Serial</span><strong>${esc(info.serial || "Connect to read")}</strong></li><li><span>RT precision</span><strong>${Number(state.hardware.precision || 0.001).toFixed(3)} mm</strong></li></ul><div class="apply-row"><button class="button ghost" id="readLayoutStyle" type="button">Read layout metadata</button><button class="button ghost" id="exportLog" type="button">Export session log</button></div></section><section class="panel"><div class="panel-head"><div><h2>Firmware capabilities</h2><p>Hidden generic features remain visible even when their bit is off.</p></div></div>${capabilityCards()}</section><section class="panel full-span"><div class="panel-head"><div><h2>Supported protocol surface</h2><p>Firmware upgrade and bootloader commands are intentionally absent.</p></div><span class="badge ready">NO UPDATER</span></div><div class="capability-grid">${["Device identity", "Profiles", "System settings", "Four key layers", "Hall performance", "Raw axis data", "Base RGB", "Custom RGB", "Advanced key reads", "Macro reads", "Calibration", "Read-back verify"].map((name) => `<article class="capability yes"><span>Available</span><strong>${name}</strong></article>`).join("")}</div><pre class="raw-output">${esc(JSON.stringify({ layoutStyle: state.hardware.layoutStyle, recent: state.hardware.logs.slice(0, 12) }, null, 2))}</pre></section></div>`;
}
function aboutPage() {
  return `<section class="panel about-shell"><div class="panel-head"><div><h2>About us</h2><p>This page is authored as ordinary HTML in <code>about.html</code>.</p></div><span class="badge ready">AUTHOR HTML</span></div><iframe class="about-frame" src="about.html" title="About the AE64 Pro Control project"></iframe></section>`;
}

function render() {
  stopPolling();
  if (state.page !== "lighting" || !state.liveLighting) {
    state.hardware.fnPressed = false;
    state.hardware.fnStatus = 0;
    state.hardware.fnLayer = 0;
    state.hardware.fnTriggerId = null;
  }
  const [title] = pageCopy();
  document.querySelector("#pageTitle").textContent = title;
  document
    .querySelectorAll("#sideNav button")
    .forEach((button) =>
      button.classList.toggle("active", button.dataset.page === state.page),
    );
  const pages = {
    overview: overviewPage,
    performance: performancePage,
    keymap: keymapPage,
    lighting: lightingPage,
    settings: settingsPage,
    advanced: advancedPage,
    diagnostics: diagnosticsPage,
    about: aboutPage,
  };
  document.querySelector("#pageContent").innerHTML = pages[state.page]();
  renderToolbar();
  renderStatus();
  bindPage();
}
function renderToolbar() {
  const profiles = state.hardware.configIndexes
    .map(
      (index) =>
        `<option value="${index}" ${index === Number(state.profile.profileIndex) ? "selected" : ""}>${esc(state.hardware.configNames[index] || `Profile ${index + 1}`)}</option>`,
    )
    .join("");
  const select = document.querySelector("#quickProfileSelect");
  if (select) select.innerHTML = profiles;
  const themeSelect = document.querySelector("#sidebarThemeSelect");
  if (themeSelect) themeSelect.value = state.theme;
  document.querySelectorAll(".language-select").forEach((select) => {
    select.value = state.language;
  });
}
function renderStatus() {
  const count = dirtyCount(),
    autoApply = Boolean(state.autoApply),
    writing = Boolean(state.writeInFlight);
  document.querySelector("#connectionStatus").textContent = connected()
    ? `Connected · FW ${state.hardware.info?.firmware || "?"}`
    : t("offline");
  document.querySelector("#connectionDot").className = connected()
    ? ""
    : "offline";
  document.querySelector("#dirtyStatus").textContent = writing
    ? "Writing to keyboard…"
    : count
      ? `${count} ${autoApply ? "queued" : "staged"} change${count === 1 ? "" : "s"}`
      : autoApply
        ? t("autoApplyActive")
        : t("noPendingChanges");
  document.querySelector("#applyButton").disabled = count === 0 || autoApply || writing;
  document.querySelector("#revertButton").disabled = count === 0 || writing;
  const autoApplyToggle = document.querySelector("#autoApplyToggle");
  autoApplyToggle.checked = autoApply;
  autoApplyToggle.disabled = writing;
  document.querySelector("#stagedEditsBody").textContent = autoApply
    ? t("autoApplyHint")
    : t("stagedEditsBody");
  document.querySelector("#connectionLabel").textContent = connected()
    ? `Connected · FW ${state.hardware.info?.firmware || "?"}`
    : t("offlineWorkspace");
  scheduleAutoApply();
}
