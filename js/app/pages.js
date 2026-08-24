"use strict";

/**
 * AE64 Pro Control — page rendering.
 *
 * Loaded as an ordered classic script. Top-level declarations are shared
 * with the other application files; keep the order in index.html intact.
 * Contains keyboard markup, every page renderer, and shared status rendering.
 */

function keyboardHtml({ hero = false, lighting = false } = {}) {
  const layer = Number(state.profile.layer),
    light = state.profile.lighting,
    baseColor =
      light.palette[Number(light.base.paletteIndex)] ||
      light.palette[0] ||
      "#000000",
    live =
      lighting &&
      state.liveLighting &&
      connected() &&
      Array.isArray(state.hardware.liveMatrix);
  return `<div class="keyboard" aria-label="AE64 Pro keyboard">${layout
    .map(
      (row, uiRow) =>
        `<div class="keyboard-row">${row
          .map((_, col) => {
            const key = keys.find(
              (candidate) => candidate.uiRow === uiRow && candidate.col === col,
            );
            const code = displayedKeycode(key, layer);
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
                    : baseColor
                  : light.perKey[key.id],
              lightingSelected =
                lighting &&
                state.page === "lighting" &&
                state.lightingTab === "perKey" &&
                state.lightingSelectedKeys.has(key.id),
              selected =
                !hero &&
                (lighting ? lightingSelected : key.id === selectedKey().id);
            const dirty =
              state.dirty.performance.has(key.id) ||
              [...state.dirty.mapping].some((token) =>
                token.endsWith(`:${key.id}`),
              ) ||
              state.dirty.customLighting.has(key.id);
            return `<button class="key ${selected ? "selected" : ""} ${dirty ? "dirty" : ""} ${lighting && custom ? "custom-light" : ""}" style="--u:${key.u};--key-color:${esc(previewColor)}" type="button" ${hero ? 'tabindex="-1"' : `data-key="${key.id}" aria-pressed="${lightingSelected}"`}><b>${esc(key.n)}</b>${hero ? "" : `<span class="mapped">${esc(mapped)}</span>`}${lighting ? `<i class="color-dot ${custom ? "custom" : ""}" title="${live ? "Live hardware color" : custom ? "Custom override" : "Main palette"}"></i>` : ""}</button>`;
          })
          .join("")}</div>`,
    )
    .join("")}</div>`;
}
function boardPanel(options = {}) {
  const address = position(selectedKey());
  return `<section class="panel ${options.full ? "full-span" : ""}"><div class="panel-head"><div><h2>${options.title || "AE64 Pro"}</h2><p>${options.description || "Select a key to inspect or stage a change."}</p></div><span class="badge ${connected() ? "ready" : ""}">${connected() ? "HARDWARE" : "OFFLINE"}</span></div><div class="keyboard-wrap ${options.lighting ? "lighting-preview" : ""}">${keyboardHtml({ lighting: options.lighting })}</div><div class="board-footer"><span>Layer ${Number(state.profile.layer) + 1}</span><span>Selected: <b class="selected-name">${esc(selectedKey().n)}</b> · row ${address.row}, col ${address.col}</span></div></section>`;
}
function selectedCard() {
  const key = selectedKey(),
    performance = state.profile.performance[key.id],
    code = displayedKeycode(key),
    address = position(key);
  return `<div class="selected-key-card"><b>${esc(key.n)}</b><div><span>SELECTED KEY · ${address.row}:${address.col}</span><strong>${esc(keycodeLabel(code))} · ${performance.normalPress.toFixed(2)} mm${performance.mode ? " · RT on" : ""}</strong></div></div>`;
}
function pageCopy() {
  return {
    overview: [
      t("overview"),
      "Device state, current profile, and selected-key summary.",
    ],
    performance: [
      t("performance"),
      "Per-key Hall actuation, Rapid Trigger, dead zones, calibration, and raw travel.",
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
  }[state.page];
}

function overviewPage() {
  const perf = state.profile.performance[selectedKey().id],
    info = state.hardware.info,
    rtCount = Object.values(state.profile.performance).filter(
      (item) => item.mode === 1,
    ).length;
  return `<div class="page-grid"><section class="panel full-span"><div class="summary-grid"><article class="summary-card"><span>Connection</span><strong>${connected() ? "Connected" : "Offline"}</strong><small>${connected() ? `${esc(info?.serial || "AE64 Pro")} · FW ${esc(info?.firmware || "?")}` : "Demo data; no writes possible"}</small></article><article class="summary-card"><span>Current profile</span><strong>${esc(state.hardware.configNames[state.profile.profileIndex] || `Profile ${state.profile.profileIndex + 1}`)}</strong><small>Hardware configuration ${state.profile.profileIndex + 1}</small></article><article class="summary-card"><span>Rapid Trigger</span><strong>${rtCount} keys</strong><small>Selected: ${perf.mode ? "enabled" : "normal"}</small></article><article class="summary-card"><span>Pending changes</span><strong>${dirtyCount()}</strong><small>Written only when you apply</small></article></div></section>${boardPanel()}<section class="panel"><div class="panel-head"><div><h2>Selected key</h2><p>The current working copy for this key.</p></div></div>${selectedCard()}<ul class="fact-list"><li><span>Actuation</span><strong>${perf.normalPress.toFixed(2)} mm</strong></li><li><span>Rapid Trigger</span><strong>${perf.mode ? `${perf.rtPress.toFixed(2)} / ${perf.rtRelease.toFixed(2)} mm` : "Off"}</strong></li><li><span>Dead zones</span><strong>${perf.pressDeadStroke.toFixed(2)} / ${perf.releaseDeadStroke.toFixed(2)} mm</strong></li><li><span>Hardware address</span><strong>${selectedKey().row}:${selectedKey().col}</strong></li></ul><div class="apply-row"><button class="button primary" data-goto="performance" type="button">Tune this key</button></div></section></div>`;
}
function numberField(id, label, value, min, max, step, hint = "") {
  return `<label class="field"><span>${label}</span><div class="range-pair"><input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-range-for="${id}"><input id="${id}" type="number" min="${min}" max="${max}" step="${step}" value="${value}"></div>${hint ? `<small>${hint}</small>` : ""}</label>`;
}
function performanceControls() {
  const value = state.profile.performance[selectedKey().id];
  if (state.performanceTab === "trigger")
    return `${selectedCard()}<div class="switch-row"><div><h3>Rapid Trigger</h3><p>Reset as soon as the key reverses direction.</p></div><input id="performanceMode" class="toggle" type="checkbox" ${value.mode === 1 ? "checked" : ""}></div><div class="form-grid">${numberField("normalPress", "Normal press", value.normalPress, 0.1, 4, 0.01, "Used when Rapid Trigger is off.")}${numberField("normalRelease", "Normal release", value.normalRelease, 0, 4, 0.01, "Independent release point.")}${numberField("rtFirstTouch", "RT first touch", value.rtFirstTouch, 0.1, 4, 0.01)}${numberField("rtPress", "RT press delta", value.rtPress, 0.01, 2, 0.01)}${numberField("rtRelease", "RT release delta", value.rtRelease, 0.01, 2, 0.01)}</div><div class="apply-row"><button class="button ghost" data-copy-performance type="button">Copy to every key</button></div>`;
  if (state.performanceTab === "deadzone")
    return `${selectedCard()}<div class="form-grid">${numberField("pressDeadStroke", "Top dead zone", value.pressDeadStroke, 0, 1, 0.01, "Ignored movement near the top.")}${numberField("releaseDeadStroke", "Bottom dead zone", value.releaseDeadStroke, 0, 1, 0.01, "Ignored movement near full travel.")}</div>`;
  if (state.performanceTab === "axis")
    return `${selectedCard()}<ul class="fact-list"><li><span>Axis slot</span><strong>${value.axis}</strong></li><li><span>Axis library ID</span><strong>${value.axisV2Id || "Not reported"}</strong></li><li><span>Maximum range</span><strong>${value.axisRangeMax || "Not reported"}</strong></li><li><span>Coefficient</span><strong>${value.axisCoefficient || "Not reported"}</strong></li><li><span>Available IDs</span><strong>${state.hardware.axisLibrary.length ? state.hardware.axisLibrary.join(", ") : "Connect to read"}</strong></li></ul><p>The basic release preserves these firmware-owned fields during every performance write.</p>`;
  if (state.performanceTab === "calibration")
    return `<div class="panel-head"><div><h2>Hall sensor calibration</h2><p>Start calibration, press every key fully several times, then stop and save.</p></div><span class="badge experimental">DEVICE-WIDE</span></div><div class="calibration-grid">${keys.map(() => "<i></i>").join("")}</div><div class="apply-row"><button class="button ghost" id="stopCalibration" type="button">Stop</button><button class="button primary" id="startCalibration" type="button">Start calibration</button></div>`;
  const raw = state.hardware.travelValue || 0,
    mm = Math.min(4, raw / 1000);
  return `${selectedCard()}<div class="travel-meter" style="--travel:${Math.round((mm / 4) * 100)}%;--actuation:${Math.round((1 - value.normalPress / 4) * 100)}%"><div class="fill"></div><div class="line"></div><div class="value">${mm.toFixed(3)} mm</div></div><p>Raw route values are read from the selected physical row.</p><div class="apply-row"><button class="button ghost" id="stopTravel" type="button">Stop</button><button class="button primary" id="startTravel" type="button">Start live reading</button></div>`;
}
function performancePage() {
  const tabs = [
    ["trigger", "Actuation & RT"],
    ["deadzone", "Dead zones"],
    ["axis", "Switch axis"],
    ["calibration", "Calibration"],
    ["travel", "Travel test"],
  ];
  return `<div class="page-grid">${boardPanel()}<section class="panel"><div class="tab-bar">${tabs.map(([id, label]) => `<button type="button" data-performance-tab="${id}" class="${state.performanceTab === id ? "active" : ""}">${label}</button>`).join("")}</div>${performanceControls()}</section></div>`;
}
function combinationEditor() {
  const combination = state.mappingCombination,
    modifiers = combination.modifiers,
    trigger = combination.trigger,
    preview = modifiers.size
      ? keycodeLabel(combinationKeycode(modifiers, trigger))
      : "Choose modifier keys and a trigger key";
  return `<section class="combination-editor" aria-label="Key combination editor"><div class="combination-heading"><div><span>Associated keys</span><strong>${esc(preview)}</strong></div><small>Uses the keyboard's standard modifier-bitmask mapping.</small></div><div class="combination-modifiers">${COMBINATION_MODIFIERS.map(({ label, value }) => `<button type="button" data-combo-modifier="${value}" aria-pressed="${modifiers.has(value)}" class="${modifiers.has(value) ? "active" : ""}">${label}</button>`).join("")}</div><div class="combination-trigger"><div><span>Trigger key</span><small>Select the key pressed with the associated modifiers.</small></div><div class="combination-key-grid">${COMBINATION_TRIGGER_KEYS.map(({ label, code }) => `<button type="button" data-combo-trigger="${code}" aria-pressed="${trigger === code}" class="${trigger === code ? "active" : ""}">${esc(label)}</button>`).join("")}</div></div><div class="apply-row"><button class="button primary" id="applyCombination" type="button" ${modifiers.size ? "" : "disabled"}>Apply combination</button></div></section>`;
}
function keymapPage() {
  const active = displayedKeycode(selectedKey()),
    groups = [...Object.keys(KEYCODE_GROUPS), "combination"],
    entries = (KEYCODE_GROUPS[state.mappingGroup] || []).filter((entry) =>
      entry.label.toLowerCase().includes(state.mappingSearch.toLowerCase()),
    ),
    editor =
      state.mappingGroup === "combination"
        ? combinationEditor()
        : `<input class="search-input" id="mappingSearch" type="search" placeholder="Search functions" value="${esc(state.mappingSearch)}"><div class="mapping-list">${entries.map((entry) => `<button type="button" data-keycode="${entry.code}" class="${entry.code === active ? "active" : ""}">${esc(entry.label)}</button>`).join("")}</div>`;
  return `<div class="page-grid">${boardPanel()}<section class="panel"><div class="panel-head"><div><h2>Assign ${esc(selectedKey().n)}</h2><p>Writes a 16-bit keycode on layer ${Number(state.profile.layer) + 1}.</p></div><span class="badge ready">4 LAYERS</span></div>${selectedCard()}<div class="mapping-browser"><div class="mapping-groups">${groups.map((group) => `<button type="button" data-mapping-group="${group}" class="${group === state.mappingGroup ? "active" : ""}">${group === "combination" ? "Combination" : group}</button>`).join("")}</div>${editor}</div><div class="apply-row"><button class="button ghost" id="resetKeycode" type="button">Default for this key</button></div></section></div>`;
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
function lightingPowerPanel(base, title, description) {
  return `<section class="panel full-span area-power-panel"><div><h2>${esc(title)}</h2><p>${esc(description)}</p></div><label class="lighting-power"><span><b>${t("lightingPower")}</b><small>${base.open ? "On" : "Off"} · firmware value ${base.open ? base.openMode || 1 : 0}</small></span><input id="lightingOpen" class="toggle" type="checkbox" ${base.open ? "checked" : ""}></label></section>`;
}
function lightingModePanel(base, count, target, area, reportedCount = count) {
  const modes = LIGHTING_MODE_OPTIONS.slice(0, count);
  return `<section class="panel lighting-mode-panel"><div class="panel-head"><div><h2>${t("lightingMode")}</h2><p>${t("lightingModeHint")}</p></div><span class="badge ready">${count} MODES</span></div><div class="lighting-mode-grid">${modes
    .map((mode) => {
      const experimental = mode.value >= reportedCount;
      return `<button type="button" data-lighting-mode="${mode.value}" data-lighting-target="${target}" class="${mode.value === Number(base.mode) ? "active " : ""}${experimental ? "experimental" : ""}"><span>${mode.label}${experimental ? " *" : ""}</span><small>${experimental ? "UNADVERTISED" : "Area " + area} · value ${mode.value}</small></button>`;
    })
    .join("")}</div></section>`;
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
    colorId = target === "main" ? "paletteColor" : "stripPaletteColor",
    hexId = target === "main" ? "paletteHex" : "stripPaletteHex";
  return `<section class="panel full-span lighting-palette-panel"><div class="panel-head"><div><h2>${t("lightingPalette")}</h2><p>${t("lightingPaletteHint")}</p></div><span class="badge ready">SLOT ${paletteIndex + 1}</span></div><div class="palette palette-large">${palette.map((swatch, index) => `<button type="button" data-palette="${index}" data-lighting-target="${target}" class="${index === paletteIndex ? "active" : ""}" style="--swatch:${esc(swatch)}" aria-label="Select palette color ${index + 1}" title="${esc(swatch)}"><span>${String(index + 1).padStart(2, "0")}</span></button>`).join("")}</div><div class="palette-editor"><input id="${colorId}" type="color" value="${esc(activeColor)}" aria-label="${t("lightingActiveColor")}"><label class="field"><span>${t("lightingActiveColor")}</span><input id="${hexId}" type="text" maxlength="7" pattern="#[0-9A-Fa-f]{6}" value="${esc(activeColor.toUpperCase())}"><small>RGB ${parseInt(activeColor.slice(1, 3), 16)}, ${parseInt(activeColor.slice(3, 5), 16)}, ${parseInt(activeColor.slice(5, 7), 16)} · palette slot ${paletteIndex + 1}</small></label><div class="palette-note"><strong>Stored on the keyboard</strong><span>This palette belongs only to ${target === "main" ? "the key LEDs" : "Decorative1"}.</span></div></div></section>`;
}
function dualLightingControls(base) {
  const upper =
      base.open && Boolean(Number(base.openMode) & LIGHTING_OPEN_MODE.UPPER),
    lower =
      base.open && Boolean(Number(base.openMode) & LIGHTING_OPEN_MODE.LOWER);
  return `<section class="panel full-span dual-lighting-card"><div class="panel-head"><div><h2>Upper / lower lighting switch</h2><p>The firmware encodes the two LED orientations as bits in the main power value.</p></div><span class="badge ${state.hardware.doubleLighting ? "ready" : ""}">${state.hardware.doubleLighting ? "REPORTED" : "CAPTURED"}</span></div><div class="dual-lighting-switches"><label class="switch-row"><span><b>${t("lightingUpper")}</b><small>Original driver: Upper Lighting Switch · bit 2</small></span><input id="upperLighting" class="toggle" type="checkbox" ${upper ? "checked" : ""}></label><label class="switch-row"><span><b>${t("lightingLower")}</b><small>Original driver: Lower Lighting Switch · bit 1</small></span><input id="lowerLighting" class="toggle" type="checkbox" ${lower ? "checked" : ""}></label></div></section>`;
}
function mainLightingPage() {
  const lighting = state.profile.lighting,
    base = lighting.base,
    reportedCount = lightingModeCount(0, AE64_MAIN_MODE_COUNT),
    count = LIGHTING_MODE_OPTIONS.length;
  return `<div class="lighting-layout">${lightingPowerPanel(base, t("lightingMainKeyboard"), "Controls the main keyboard LED area.")}<section class="panel full-span capture-note experimental-note"><strong>L21–L23 are experimental</strong><span>AE64 area 0 advertises values 0–19. Catalog values 20–22 are exposed for testing; Apply accepts a value only when the keyboard reads it back unchanged.</span></section>${dualLightingControls(base)}${lightingModePanel(base, count, "main", 0, reportedCount)}${lightingTunePanel(base, "main", 0)}${lightingPalettePanel(base, lighting.palette, "main")}</div>`;
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
  return `<div class="lighting-layout"><section class="panel per-key-editor"><div class="panel-head"><div><h2>${hasSelection ? `${esc(label)} · ${t("lightingCustomOverride")}` : "Select keys in the preview"}</h2><p>Drag across keys to select. Hold Ctrl and click to add or remove individual keys.</p></div><span class="badge ${enabled ? "ready" : mixed ? "experimental" : ""}">${ids.length} SELECTED</span></div><div class="switch-row"><div><h3>${t("lightingCustomOverride")}</h3><p>The setting is applied to every selected key.</p></div><input id="keyCustomEnabled" class="toggle" type="checkbox" ${enabled ? "checked" : ""} ${hasSelection ? "" : "disabled"}></div><div class="key-color-editor"><input id="keyColor" type="color" value="${esc(color)}" aria-label="Selected key color" ${hasSelection ? "" : "disabled"}><div><span>Selected key color</span><strong>${esc(color.toUpperCase())}</strong><small>${customCount} of 64 keys currently use overrides.</small></div></div><div class="apply-row"><button class="button ghost" id="clearKeyColor" type="button" ${hasSelection ? "" : "disabled"}>Clear selected overrides</button><button class="button primary" id="copyKeyColor" type="button" ${hasSelection ? "" : "disabled"}>${t("lightingCopyAll")}</button></div></section><section class="panel matrix-card"><div class="panel-head"><div><h2>Keyboard LED framebuffer</h2><p>Nine packets cover the firmware's 6 × 21 address space.</p></div><span class="badge">9 × 15 RECORDS</span></div><ul class="fact-list"><li><span>Visible keys</span><strong>64</strong></li><li><span>Selected keys</span><strong>${ids.length}</strong></li><li><span>Live refresh</span><strong>≈ 10 FPS</strong></li></ul><div class="apply-row"><button class="button ghost" id="loadCustomLighting" type="button">${t("lightingReadMatrix")}</button><button class="button ghost" id="clearAllKeyColors" type="button">${t("lightingClearAll")}</button></div></section></div>`;
}
function stripLedButton(index, side) {
  const lighting = state.profile.lighting.decorative,
    baseColor =
      lighting.palette[Number(lighting.base.paletteIndex)] ||
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
        "Drag across keyboard keys. Ctrl+click adds or removes individual keys.",
      strip:
        "Drag only across the four light-strip sides. Ctrl+click adds or removes LEDs.",
    };
  return `<section class="panel unified-lighting-preview"><div class="panel-head"><div><h2>Unified live lighting</h2><p>The keyboard and all 38 perimeter LEDs stay visible while the settings below change.</p></div><span class="badge ${state.liveLighting && connected() ? "ready" : ""}">KEYBOARD + 38 LEDS</span></div><div class="unified-preview-scroll">${stripHtml()}</div><div class="board-footer"><span>${hints[state.lightingTab]}</span><span id="lightingSelectionSummary">${state.lightingTab === "perKey" ? `Selected: <b>${keyCount} key${keyCount === 1 ? "" : "s"}</b>` : state.lightingTab === "strip" ? `Selected: <b>${stripCount} LED${stripCount === 1 ? "" : "s"}</b>` : "Preview mode"}</span></div></section>`;
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
  return `<div class="lighting-layout">${lightingPowerPanel(base, t("lightingDecorative"), "Controls the independent 38-LED perimeter area.")}${lightingModePanel(base, count, "strip", 1)}${lightingTunePanel(base, "strip", 1)}${lightingPalettePanel(base, lighting.palette, "strip")}<section class="panel full-span strip-editor"><div class="panel-head"><div><h2>${hasSelection ? `${ids.length} light strip LED${ids.length === 1 ? "" : "s"} selected` : "Select LEDs on the four sides"}</h2><p>Drag along the perimeter. Hold Ctrl and click to add or remove individual LEDs.</p></div><span class="badge ${enabled ? "ready" : mixed ? "experimental" : ""}">${ids.length} SELECTED</span></div><div class="strip-editor-grid"><label class="switch-row"><span><b>${t("lightingCustomOverride")}</b><small>The setting is applied to every selected light-strip LED.</small></span><input id="stripCustomEnabled" class="toggle" type="checkbox" ${enabled ? "checked" : ""} ${hasSelection ? "" : "disabled"}></label><div class="key-color-editor"><input id="stripColor" type="color" value="${esc(color)}" aria-label="Selected strip LED color" ${hasSelection ? "" : "disabled"}><div><span>Selected strip color</span><strong>${esc(color.toUpperCase())}</strong><small>${customCount} of 38 overrides enabled.</small></div></div></div><div class="apply-row"><button class="button ghost" id="loadStripLighting" type="button">${t("lightingReadMatrix")}</button><button class="button ghost" id="clearStripColor" type="button" ${hasSelection ? "" : "disabled"}>Clear selected overrides</button><button class="button ghost" id="clearAllStripColors" type="button">${t("lightingClearStrip")}</button><button class="button primary" id="copyStripColor" type="button" ${hasSelection ? "" : "disabled"}>${t("lightingCopyStrip")}</button></div></section></div>`;
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
  const settings = state.profile.settings;
  const systemOptions = mappedOptions(
    SYSTEM_MODE_OPTIONS,
    settings.systemMode,
    state.hardware.systemModes,
    (option) => option.label,
  );
  const pollingOptions = mappedOptions(
    POLLING_RATE_OPTIONS,
    settings.reportRate,
    state.hardware.reportRates,
    (option) => `${option.hz.toLocaleString()} Hz`,
  );
  return `<div class="page-grid three"><section class="panel"><div class="panel-head"><div><h2>USB & scanning</h2><p>General firmware settings from the original driver.</p></div></div><div class="form-grid"><label class="field"><span>System mode</span><select id="systemMode">${systemOptions}</select><small>Firmware value 0 is Windows; value 1 is macOS.</small></label><label class="field"><span>Polling rate</span><select id="reportRate">${pollingOptions}</select><small>250 to 8,000 Hz. Higher rates use more USB processing time.</small></label><label class="field"><span>RGB sleep (minutes)</span><input id="sleepTime" type="number" min="0" max="65535" value="${settings.sleepTime}"></label></div><div class="switch-row"><div><h3>Shake optimization</h3><p>Firmware key-stability optimization.</p></div><input id="shake" class="toggle" type="checkbox" ${settings.shake ? "checked" : ""}></div></section><section class="panel"><div class="panel-head"><div><h2>Profiles</h2><p>Switch or rename onboard configurations.</p></div></div><label class="field"><span>Profile name</span><input id="profileName" type="text" maxlength="32" value="${esc(state.hardware.configNames[state.profile.profileIndex] || `Profile ${state.profile.profileIndex + 1}`)}"></label><div class="apply-row"><button class="button ghost" id="saveProfileName" type="button">Save name</button></div><ul class="fact-list"><li><span>Active slot</span><strong>${state.profile.profileIndex + 1}</strong></li><li><span>Available slots</span><strong>${state.hardware.configIndexes.length}</strong></li></ul></section><section class="panel"><div class="panel-head"><div><h2>Files & recovery</h2><p>Portable JSON, independent of the manufacturer cloud.</p></div></div><div class="apply-row"><button class="button ghost" id="importProfile" type="button">Import JSON</button><button class="button primary" id="exportProfile" type="button">Export JSON</button></div><hr style="border:0;border-top:1px solid var(--line);margin:22px 0"><h3>Factory restore</h3><p>This destructive command stays visible but disabled until physical-device verification.</p><button class="button danger" type="button" disabled>Restore factory settings</button></section></div>`;
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

function render() {
  stopPolling();
  const [title, description] = pageCopy();
  document.querySelector("#pageKicker").textContent =
    `AE64 PRO / ${state.page.toUpperCase()}`;
  document.querySelector("#pageTitle").textContent = title;
  document.querySelector("#pageDescription").textContent = description;
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
  document.querySelector("#layerSelect").value = String(state.profile.layer);
  document.querySelectorAll(".language-select").forEach((select) => {
    select.value = state.language;
  });
}
function renderStatus() {
  const count = dirtyCount();
  document.querySelector("#connectionStatus").textContent = connected()
    ? `Connected · FW ${state.hardware.info?.firmware || "?"}`
    : t("offline");
  document.querySelector("#connectionDot").className = connected()
    ? ""
    : "offline";
  document.querySelector("#dirtyStatus").textContent = count
    ? `${count} staged change${count === 1 ? "" : "s"}`
    : t("noPendingChanges");
  document.querySelector("#applyButton").disabled = count === 0;
  document.querySelector("#revertButton").disabled = count === 0;
  document.querySelector("#connectionLabel").textContent = connected()
    ? `Connected · FW ${state.hardware.info?.firmware || "?"}`
    : t("offlineWorkspace");
}
