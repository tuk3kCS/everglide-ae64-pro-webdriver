"use strict";

/**
 * AE64 Pro Control — live device tools.
 *
 * Loaded as an ordered classic script. Top-level declarations are shared
 * with the other application files; keep the order in index.html intact.
 * Handles RGB matrices, advanced reads, calibration, travel telemetry, and polling.
 */

const lightingReadState = { transport: null, profile: null, fnGeneration: -1, loaded: false, pending: null, errors: [] };
function lightingReadStatus() {
  const current = lightingReadState.transport === state.transport && lightingReadState.profile === Number(state.profile.profileIndex) && lightingReadState.fnGeneration === fnLightingView.generation;
  const message = !connected() ? "Lighting is read automatically when the keyboard connects."
    : current && lightingReadState.pending ? "Reading keyboard, strip and Fn lighting…"
    : current && lightingReadState.errors.length ? `Lighting read needs attention: ${lightingReadState.errors.join(" ")}`
    : current && lightingReadState.loaded ? `Lighting read automatically${fnLightingAvailable() ? " · Fn 1, Fn 2 and Fn 3 ready" : ""}.`
    : "Lighting will be read automatically.";
  return `<div class="lighting-read-status"><span id="lightingReadStatus" role="status">${esc(message)}</span><button id="refreshLightingProfiles" class="button ghost small" type="button" ${!connected() || state.fnLightingBusy ? "disabled" : ""}>Refresh lighting</button></div>`;
}
async function readLightingProfiles({ force = false, renderAfter = true } = {}) {
  if (!connected() || state.firmwareBusy || state.gamepadBusy || (state.writeInFlight && !state.connecting) ||
      (state.profileNeedsReload && !state.profileSyncInFlight)) return;
  const transport = state.transport, profile = Number(state.profile.profileIndex);
  if (lightingReadState.pending && lightingReadState.transport === transport && lightingReadState.profile === profile) return lightingReadState.pending.promise;
  if (state.fnLightingBusy) return;
  if (!force && lightingReadState.transport === transport && lightingReadState.profile === profile && lightingReadState.fnGeneration === fnLightingView.generation && lightingReadState.loaded) return;
  let finish;
  const job = { promise: new Promise((resolve) => { finish = resolve; }) }, fnGeneration = fnLightingView.generation;
  Object.assign(lightingReadState, { transport, profile, fnGeneration, loaded: false, errors: [], pending: job });
  const current = () => lightingReadState.pending === job && state.transport === transport && transport.connected && Number(state.profile.profileIndex) === profile && fnGeneration === fnLightingView.generation;
  const adopting = state.connecting || state.profileSyncInFlight;
  state.fnLightingBusy = true; fnLightingView.busy = true;
  stopPolling();
  if (!state.profileSyncInFlight) stopProfilePolling();
  clearTimeout(state.timers.autoApply);
  document.querySelectorAll(".lighting-page input,.lighting-page select,.lighting-page button").forEach((node) => { node.disabled = true; });
  const status = document.querySelector("#lightingReadStatus"); if (status) status.textContent = "Reading keyboard, strip and Fn lighting…";
  renderStatus();
  const attempt = async (label, operation) => {
    if (!current()) return;
    try { await operation(); }
    catch (error) { if (current()) lightingReadState.errors.push(`${label}: ${error.message || error}`); }
  };
  try {
    for (const area of [0, 1]) {
      const target = area ? state.profile.lighting.decorative : state.profile.lighting,
        original = adopting ? null : area ? state.original?.lighting?.decorative : state.original?.lighting;
      const label = area ? "Strip" : "Keyboard";
      await attempt(`${label} settings`, async () => {
        const base = await transport.getLightingBase(area);
        if (current() && (adopting || !state.dirty[area ? "decorativeBase" : "lightingBase"])) {
          target.base = { ...target.base, ...base }; if (original) original.base = { ...target.base };
        }
      });
      await attempt(`${label} palette`, async () => {
        const palette = await transport.getLightingPalette(area);
        if (current() && (adopting || !state.dirty[area ? "decorativePalette" : "lightingPalette"])) {
          target.palette = palette.map(rgbToHex); if (original) original.palette = [...target.palette];
        }
      });
    }
    await attempt("Keyboard colors", async () => {
      const matrix = await transport.readCustomLighting(MATRIX_ROWS, MATRIX_COLS, 0);
      if (!current()) return;
      state.hardware.customMatrix = matrix;
      for (const key of keys) {
        if (!adopting && state.dirty.customLighting.has(key.id)) continue;
        const records = lightingMatrixIndexes(key).map((index) => matrix[index]).filter(Boolean), record = records[Math.floor(records.length / 2)] || records[0];
        if (!record) continue;
        state.profile.lighting.perKey[key.id] = rgbToHex(record);
        state.profile.lighting.customEnabled[key.id] = key.n === "Space" ? records.some((item) => Boolean(item.custom)) : Boolean(record.custom);
        if (!adopting && state.original?.lighting) {
          state.original.lighting.perKey[key.id] = state.profile.lighting.perKey[key.id];
          state.original.lighting.customEnabled[key.id] = state.profile.lighting.customEnabled[key.id];
        }
      }
    });
    await attempt("Strip colors", async () => {
      const matrix = await transport.readCustomLighting(DECORATIVE_ROWS, DECORATIVE_COLS, 1);
      if (!current()) return;
      state.hardware.decorativeMatrix = matrix;
      matrix.forEach((record, index) => {
        if (!adopting && state.dirty.decorativeLighting.has(index)) return;
        state.profile.lighting.decorative.perLed[index] = rgbToHex(record);
        state.profile.lighting.decorative.customEnabled[index] = Boolean(record.custom);
        if (!adopting && state.original?.lighting?.decorative) {
          state.original.lighting.decorative.perLed[index] = state.profile.lighting.decorative.perLed[index];
          state.original.lighting.decorative.customEnabled[index] = Boolean(record.custom);
        }
      });
    });
    if (fnLightingAvailable()) {
      for (let layer = 0; layer <= 3; layer++) await attempt(`Fn keymap ${layer}`, async () => {
        if (!hardwareLayerReady(layer)) await readKeymapLayer(layer);
      });
      const client = fnLightingView.client;
      for (let layer = 1; layer <= 3; layer++) await attempt(`Fn ${layer}`, async () => {
        const key = `${profile}:${layer}`;
        if (fnLightingView.drafts.get(key)?.dirty) return;
        try {
          const value = await client.read(profile, layer);
          if (!current() || fnLightingView.drafts.get(key)?.dirty) return;
          fnLightingView.drafts.set(key, fnLightingNormalizeProfile(value)); fnLightingView.errors.delete(key);
        } catch (error) { if (current()) fnLightingView.errors.set(key, error.message); throw error; }
      });
    }
    if (current()) lightingReadState.loaded = true;
  } finally {
    if (lightingReadState.pending === job) {
      lightingReadState.pending = null; state.fnLightingBusy = false; fnLightingView.busy = false;
      if (connected() && !state.connecting && !state.profileSyncInFlight) startProfilePolling();
      if (renderAfter && state.page === "lighting") render(); else renderStatus();
    }
    finish();
  }
}

async function loadCustomLighting() {
  if (!connected()) return showToast("Connect to read custom RGB.", true);
  stopPolling();
  showProgress("Reading custom lighting", "Loading all nine matrix packets.");
  try {
    state.hardware.customMatrix = await state.transport.readCustomLighting(
      MATRIX_ROWS,
      MATRIX_COLS,
      0,
    );
    keys.forEach((key) => {
      const records = lightingMatrixIndexes(key)
          .map((matrixIndex) => state.hardware.customMatrix[matrixIndex])
          .filter(Boolean),
        record = records[Math.floor(records.length / 2)] || records[0];
      if (!record) return;
      state.profile.lighting.perKey[key.id] = rgbToHex(record);
      state.profile.lighting.customEnabled[key.id] =
        key.n === "Space" ? records.some((item) => Boolean(item.custom)) : Boolean(record.custom);
    });
    state.dirty.customLighting.clear();
    render();
    showToast("Custom lighting matrix and override flags loaded.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    hideProgress();
  }
}
async function loadDecorativeLighting() {
  if (!connected()) return showToast("Connect to read Decorative1 RGB.", true);
  stopPolling();
  showProgress("Reading Decorative1", "Loading all three strip packets.");
  try {
    state.hardware.decorativeMatrix = await state.transport.readCustomLighting(
      DECORATIVE_ROWS,
      DECORATIVE_COLS,
      1,
    );
    state.hardware.decorativeMatrix.forEach((record, index) => {
      state.profile.lighting.decorative.perLed[index] = rgbToHex(record);
      state.profile.lighting.decorative.customEnabled[index] = Boolean(
        record.custom,
      );
    });
    state.dirty.decorativeLighting.clear();
    render();
    showToast("Decorative1 matrix and override flags loaded.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    hideProgress();
  }
}
async function readAdvanced() {
  if (!connected())
    return showToast("Connect to read the advanced-key record.", true);
  try {
    const key = selectedKey();
    state.hardware.advanced = await state.transport.getAdvancedKey(position(key));
    if (Number(state.hardware.advanced.mode) === ADVANCED_MODE.NONE)
      state.hardware.advancedByKey.delete(key.id);
    else state.hardware.advancedByKey.set(key.id, state.hardware.advanced);
    if (Number(state.hardware.advanced.mode) === ADVANCED_MODE.MPT && !state.dirty.advanced)
      state.advancedDraft = multipointDraftFromRecord(key, state.hardware.advanced);
    if (Number(state.hardware.advanced.mode) === ADVANCED_MODE.DKS && !state.dirty.advanced)
      state.advancedDraft = dksDraftFromRecord(key, state.hardware.advanced);
    if ([ADVANCED_MODE.MT, ADVANCED_MODE.TGL, ADVANCED_MODE.END].includes(Number(state.hardware.advanced.mode)) && !state.dirty.advanced)
      state.advancedDraft = simpleAdvancedDraftFromRecord(key, state.hardware.advanced);
    if ([ADVANCED_MODE.SOCD, ADVANCED_MODE.RS].includes(Number(state.hardware.advanced.mode)) && !state.dirty.advanced) {
      const first = keys.find((key) => {
          const address = position(key);
          return address.row === state.hardware.advanced.row && address.col === state.hardware.advanced.col;
        }),
        second = keys.find((key) => {
          const address = position(key);
          return address.row === state.hardware.advanced.pairedRow && address.col === state.hardware.advanced.pairedCol;
        });
      if (first && second) {
        state.advancedDraft = {
          feature: state.hardware.advanced.mode === ADVANCED_MODE.RS ? "RS" : "SOCD",
          keyAId: first.id,
          keyBId: second.id,
          delay: clamp(state.hardware.advanced.delay, 0, 50),
          socdMode: state.hardware.advanced.mode === ADVANCED_MODE.SOCD ? clamp(state.hardware.advanced.socdMode, SOCD_MODE.LAST_OVERRIDE, SOCD_MODE.NEUTRAL) : SOCD_MODE.LAST_OVERRIDE,
          keycodes: [...state.hardware.advanced.keycodes],
        };
      }
    }
    log("Advanced record read", state.hardware.advanced);
    render();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function readAllAdvancedRecords({ renderDuringLoad = true } = {}) {
  if (!connected()) return 0;
  const transport = state.transport, profile = state.profile.profileIndex;
  const results = await Promise.allSettled(
    keys.map(async (key) => [
      key,
      await transport.getAdvancedKey(position(key)),
    ]),
  );
  if (transport !== state.transport || profile !== state.profile.profileIndex) return 0;
  const failed = [];
  let loaded = 0;
  state.hardware.advancedByKey.clear();
  results.forEach((result, index) => {
    if (result.status !== "fulfilled") {
      failed.push(keys[index].n);
      return;
    }
    const [key, record] = result.value;
    if (Number(record.mode) !== ADVANCED_MODE.NONE)
      state.hardware.advancedByKey.set(key.id, record);
    loaded += 1;
  });
  if (failed.length)
    throw new Error(
      `Could not read advanced assignments for ${failed.length} key${failed.length === 1 ? "" : "s"}.`,
    );
  log("All advanced key assignments read", {
    keys: loaded,
    configured: state.hardware.advancedByKey.size,
  });
  if (renderDuringLoad) render();
  return loaded;
}

function calibrationRecommendation() {
  const checked = keys.filter((key) => state.hardware.performance.has(key.id)),
    uncalibrated = checked.filter(
      (key) => Number(state.hardware.performance.get(key.id)?.calibrate) === 0,
    );
  return {
    checked: checked.length,
    uncalibrated,
    needed: uncalibrated.length > 0,
  };
}
function maybeShowCalibrationRecommendation() {
  if (!connected() || state.calibrationActive || state.calibrationBusy) return false;
  const profile = Number(state.profile.profileIndex),
    result = calibrationRecommendation();
  if (!result.needed || state.calibrationPromptedProfiles.has(profile)) return false;
  state.calibrationPromptedProfiles.add(profile);
  const detail = document.querySelector("#calibrationRecommendationDetail");
  if (detail)
    detail.textContent = `${result.uncalibrated.length} of ${result.checked} readable physical keys report firmware calibration value 0.`;
  openDialog(document.querySelector("#calibrationRecommendationDialog"));
  log("Calibration recommended", {
    profile,
    checked: result.checked,
    uncalibrated: result.uncalibrated.map((key) => key.n),
  });
  return true;
}
async function readMacroSpace() {
  if (!connected()) return showToast("Connect to read macro capacity.", true);
  try {
    state.hardware.macroSpace = await state.transport.getMacroSpaceInfo();
    log("Macro capacity read", state.hardware.macroSpace);
    render();
  } catch (error) {
    showToast(error.message, true);
  }
}
async function readLayoutStyle() {
  if (!connected()) return showToast("Connect to read layout metadata.", true);
  try {
    state.hardware.layoutStyle = await Promise.all(
      [0, 1, 2, 3, 4, 5].map((row) => state.transport.getKeyLayoutStyle(row)),
    );
    state.hardware.keyPositions = firmwareKeyPositions(
      state.hardware.layoutStyle,
    );
    log("Layout metadata read");
    render();
  } catch (error) {
    showToast(error.message, true);
  }
}
async function startCalibration() {
  if (!connected()) return showToast("Connect before calibration.", true);
  if (state.calibrationActive || state.calibrationBusy) return;
  state.calibrationBusy = true;
  state.livePressDistance = false;
  stopPolling();
  stopProfilePolling();
  state.hardware.calibrationAdc.clear();
  state.hardware.calibrationRoute.clear();
  state.hardware.calibrationStatus.clear();
  render();
  try {
    await state.transport.setCalibration(true);
    state.calibrationActive = true;
    state.calibrationBusy = false;
    log("Calibration started");
    showToast("Calibration active. Press every key fully several times.");
    render();
    startCalibrationPolling();
  } catch (error) {
    state.calibrationActive = false;
    state.calibrationBusy = false;
    render();
    showToast(error.message, true);
    if (connected()) startProfilePolling();
  }
}
function stopCalibrationPolling(clear = false) {
  if (state.timers.calibration) clearTimeout(state.timers.calibration);
  state.timers.calibration = null;
  state.timers.calibrationGeneration += 1;
  if (clear) {
    state.hardware.calibrationAdc.clear();
    state.hardware.calibrationRoute.clear();
    state.hardware.calibrationStatus.clear();
  }
}
function resetCalibrationSession(clear = true) {
  stopCalibrationPolling(clear);
  state.calibrationActive = false;
  state.calibrationBusy = false;
}
async function stopCalibration(save = true) {
  if (!state.calibrationActive && !state.calibrationBusy) return;
  stopCalibrationPolling();
  state.calibrationBusy = true;
  render();
  try {
    if (connected()) {
      await state.transport.setCalibration(false);
      if (save) await state.transport.saveParameters(SAVE_GROUP.CALIBRATION);
    }
    state.hardware.calibrationStatus.forEach((status, key) => {
      if (Number(status) === 2) state.hardware.calibrationStatus.set(key, 1);
    });
    log(save ? "Calibration stopped and saved" : "Calibration stopped");
    showToast(save ? "Calibration stopped and saved." : "Calibration stopped.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    state.calibrationActive = false;
    state.calibrationBusy = false;
    render();
    if (connected()) startProfilePolling();
  }
}
function updateCalibrationVisuals() {
  if (!state.calibrationActive || state.page !== "performance") return;
  document.querySelectorAll(".layout-board [data-key]").forEach((node) => {
    const id = Number(node.dataset.key),
      status = Number(state.hardware.calibrationStatus.get(id) || 0),
      meta = calibrationStatusMeta(status),
      route = Number(state.hardware.calibrationRoute.get(id) || 0),
      range = Number(state.profile.performance[id]?.axisRangeMax) || 4000,
      percent = status === 2 ? 100 : Math.min(100, Math.max(0, route / range * 100));
    node.classList.remove("calibration-uncalibrated", "calibration-calibrated", "calibration-new");
    node.classList.add(`calibration-${meta.className}`);
    node.style.setProperty("--calibration-depth", `${percent.toFixed(2)}%`);
    const adc = node.querySelector(".calibration-adc");
    if (adc) adc.textContent = String(Number(state.hardware.calibrationAdc.get(id) || 0));
  });
  const statuses = keys.map((key) => Number(state.hardware.calibrationStatus.get(key.id) || 0)),
    known = document.querySelector("#calibrationKnown"),
    fresh = document.querySelector("#calibrationFresh"),
    max = document.querySelector("#calibrationMaxRoute");
  if (known) known.textContent = String(statuses.filter((status) => status === 1).length);
  if (fresh) fresh.textContent = String(statuses.filter((status) => status === 2).length);
  if (max) max.textContent = String(Math.max(0, ...keys.map((key) => Number(state.hardware.calibrationRoute.get(key.id) || 0))));
}
async function startCalibrationPolling() {
  stopCalibrationPolling();
  if (!connected() || !state.calibrationActive || state.page !== "performance") return;
  const generation = state.timers.calibrationGeneration,
    rows = Array.from({ length: MATRIX_ROWS }, (_, row) => row);
  const read = async () => {
    if (generation !== state.timers.calibrationGeneration || !connected() || !state.calibrationActive || state.page !== "performance") return;
    try {
      const samples = await Promise.all(rows.map(async (row) => [row, await Promise.all([
        state.transport.getAxisData("adc", row),
        state.transport.getAxisData("route", row),
        state.transport.getAxisData("calibration", row),
      ])]));
      if (generation !== state.timers.calibrationGeneration) return;
      const matrices = new Map(samples.map(([row, values]) => [row, values.map((sample) => sample.values)]));
      keys.forEach((key) => {
        const address = position(key), values = matrices.get(address.row);
        state.hardware.calibrationAdc.set(key.id, Number(values?.[0]?.[address.col] || 0));
        state.hardware.calibrationRoute.set(key.id, Number(values?.[1]?.[address.col] || 0));
        state.hardware.calibrationStatus.set(key.id, Number(values?.[2]?.[address.col] || 0));
      });
      updateCalibrationVisuals();
    } catch (error) {
      if (generation !== state.timers.calibrationGeneration) return;
      log("Calibration telemetry retrying", error.message);
      const badge = document.querySelector("#calibrationStatusBadge");
      if (badge) { badge.textContent = "LIVE · RETRYING"; badge.classList.remove("ready"); badge.classList.add("experimental"); }
      state.timers.calibration = setTimeout(read, 500);
      return;
    }
    state.timers.calibration = setTimeout(read, 40);
  };
  return read();
}
async function startTravel() {
  if (
    !connected() ||
    state.page !== "performance" ||
    !state.livePressDistance
  )
    return;
  stopTravelPolling();
  const generation = state.timers.travelGeneration,
    rows = Array.from({ length: MATRIX_ROWS }, (_, row) => row);
  const read = async () => {
    if (
      generation !== state.timers.travelGeneration ||
      !connected() ||
      state.page !== "performance" ||
      !state.livePressDistance
    )
      return;
    try {
      const samples = await Promise.all(
        rows.map(async (row) => [
          row,
          await state.transport.getAxisData("route", row),
        ]),
      );
      if (generation !== state.timers.travelGeneration) return;
      const routes = new Map(samples.map(([row, sample]) => [row, sample.values]));
      keys.forEach((key) => {
        const address = position(key),
          value = Number(routes.get(address.row)?.[address.col] || 0);
        state.hardware.travelValues.set(key.id, value);
      });
      updateTravelVisuals();
    } catch (error) {
      if (generation !== state.timers.travelGeneration) return;
      log("Live press distance retrying", error.message);
      const status = document.querySelector("#livePressStatus");
      if (status) {
        status.textContent = "LIVE · RETRYING";
        status.classList.remove("ready");
        status.classList.add("experimental");
      }
      state.timers.travel = setTimeout(read, 500);
      return;
    }
    state.timers.travel = setTimeout(read, 40);
  };
  return read();
}
function updateTravelVisuals() {
  if (state.page !== "performance" || !state.livePressDistance) return;
  document.querySelectorAll(".layout-board [data-key]").forEach((node) => {
    const key = keys[Number(node.dataset.key)],
      raw = Number(
        state.hardware.travelValues.get(Number(node.dataset.key)) || 0,
      ),
      range = key ? keySwitchTravel(key) * 1000 : 4000,
      percent = Math.min(100, Math.max(0, raw / range * 100));
    node.style.setProperty("--press-depth", `${percent.toFixed(2)}%`);
    node.classList.toggle("pressed", raw >= 10);
  });
  const focus = liveTravelTarget(),
    { key, raw, mm, actuation, travelMax, selectedCount } = focus,
    panel = document.querySelector("#livePressPanel"),
    visual = panel?.querySelector(".axis-visual"),
    scale = panel?.querySelector(".axis-gauge-scale"),
    value = document.querySelector("#livePressValue"),
    rawNode = document.querySelector("#livePressRaw"),
    keyNode = document.querySelector("#livePressKey"),
    actuationNode = document.querySelector("#livePressActuation"),
    actuationMarker = document.querySelector("#liveActuationMarkerLabel"),
    scopeNode = document.querySelector("#livePressScope"),
    status = document.querySelector("#livePressStatus"),
    pressed = keys
      .map((key) => ({
        key,
        mm: Math.min(
          keySwitchTravel(key),
          Math.max(0, Number(state.hardware.travelValues.get(key.id) || 0) / 1000),
        ),
      }))
      .filter((entry) => entry.mm >= 0.01)
      .sort((a, b) => b.mm - a.mm);
  if (scale && scale.dataset.travelMax !== travelMax.toFixed(3)) {
    scale.querySelectorAll("[data-travel-tick]").forEach((tick) => tick.remove());
    scale.insertAdjacentHTML("afterbegin", travelGaugeTicks(travelMax));
    scale.dataset.travelMax = travelMax.toFixed(3);
  }
  if (visual)
    visual.setAttribute(
      "aria-label",
      `Focused switch travel and actuation point from zero to ${travelRangeLabel(travelMax)} millimeters`,
    );
  panel?.style.setProperty(
    "--press-distance",
    `${((mm / travelMax) * 100).toFixed(2)}%`,
  );
  panel?.style.setProperty(
    "--actuation-distance",
    `${((actuation / travelMax) * 100).toFixed(2)}%`,
  );
  panel?.classList.toggle("actuated", mm >= actuation && mm >= 0.01);
  if (keyNode) keyNode.textContent = key.n;
  if (value) value.innerHTML = `${mm.toFixed(3)} <small>mm</small>`;
  if (rawNode) rawNode.textContent = String(raw);
  if (actuationNode) actuationNode.textContent = `${actuation.toFixed(3)} mm`;
  if (actuationMarker) actuationMarker.textContent = `AP ${actuation.toFixed(3)}`;
  if (scopeNode)
    scopeNode.textContent = selectedCount ? `${selectedCount} selected` : "All keys";
  if (status) {
    status.textContent = `LIVE · ${pressed.length} PRESSED`;
    status.classList.add("ready");
    status.classList.remove("experimental");
  }
  const list = document.querySelector("#pressedKeyList");
  if (list)
    list.innerHTML = pressed.length
      ? pressed
          .map(
            ({ key, mm: distance }) =>
              `<span><b>${esc(key.n)}</b>${distance.toFixed(3)} mm</span>`,
          )
          .join("")
      : "<em>Press any key to begin.</em>";
}
function stopTravelPolling(clear = false) {
  if (state.timers.travel) clearTimeout(state.timers.travel);
  state.timers.travel = null;
  state.timers.travelGeneration += 1;
  if (clear) state.hardware.travelValues.clear();
}
function updateLiveKeyboard(matrix) {
  state.hardware.liveMatrix = matrix;
  state.hardware.liveUpdatedAt = Date.now();
  syncLightingEffectPreviewStatus();
  // Keep received frames for later use, but never paint over a staged effect.
  if (lightingEffectPreviewSource().approximate) return;
  document.querySelectorAll(".lighting-preview [data-key]").forEach((node) => {
    const key = keys[Number(node.dataset.key)],
      matrixIndex = key ? lightingMatrixIndex(key) : null,
      record = matrixIndex === null ? null : matrix[matrixIndex];
    if (key && state.dirty.customLighting.has(key.id)) return;
    node.removeAttribute?.("data-effect-preview");
    if (record) node.style.setProperty("--key-color", rgbToHex(record));
    node.querySelectorAll("[data-spacebar-led-index]").forEach((dot) => {
      const ledRecord = matrix[Number(dot.dataset.spacebarLedIndex)];
      dot.removeAttribute?.("data-effect-preview");
      if (ledRecord) dot.style.setProperty("--space-led-color", rgbToHex(ledRecord));
    });
  });
}
function updateLiveStrip(matrix) {
  state.hardware.liveStrip = matrix;
  state.hardware.liveUpdatedAt = Date.now();
  document.querySelectorAll("[data-strip-led]").forEach((node) => {
    const record = matrix[Number(node.dataset.stripLed)];
    if (record) {
      node.style.setProperty("--led-color", rgbToHex(record));
      node.title = `LED ${Number(node.dataset.stripLed)} · ${rgbToHex(record).toUpperCase()}`;
    }
  });
}
function hardwareLayerReady(layer) {
  return keys.every((key) => state.hardware.keycodes.has(`${layer}:${key.id}`));
}
function fnTriggerMappings() {
  return keys
    .map((key) => ({
      key,
      layer: fnLayerFromKeycode(resolvedLayerKeycode(key, 0)),
    }))
    .filter(({ layer }) => Number(layer) > 0);
}
async function ensureFnLightingMappings() {
  if (!hardwareLayerReady(0)) await readKeymapLayer(0);
  const triggers = fnTriggerMappings(),
    layers = [...new Set(triggers.map(({ layer }) => layer))];
  for (const layer of layers)
    if (!hardwareLayerReady(layer)) await readKeymapLayer(layer);
  return triggers;
}
async function readFnLightingState() {
  const triggers = await ensureFnLightingMappings();
  if (!triggers.length) return { status: 0, layer: 0, triggerId: null };
  const rows = [...new Set(triggers.map(({ key }) => position(key).row))],
    replies = await Promise.all(
      rows.map((row) => state.transport.getAxisData("keyStatus", row)),
    ),
    valuesByRow = new Map(rows.map((row, index) => [row, replies[index].values])),
    active = triggers.find(({ key }) => {
      const address = position(key),
        status = Number(valuesByRow.get(address.row)?.[address.col] || 0);
      return status > 0 && status < 8;
    });
  if (!active) return { status: 0, layer: 0, triggerId: null };
  const address = position(active.key),
    status = Number(valuesByRow.get(address.row)?.[address.col] || 0);
  return { status, layer: active.layer, triggerId: active.key.id };
}
function updateFnLightingState(status, targetLayer = 0, triggerId = null) {
  const pressed = Number(status) > 0 && Number(status) < 8 && Number(targetLayer) > 0,
    activeLayer = pressed ? Number(targetLayer) : 0;
  state.hardware.fnStatus = Number(status) || 0;
  state.hardware.fnPressed = pressed;
  state.hardware.fnLayer = activeLayer;
  state.hardware.fnTriggerId = pressed ? Number(triggerId) : null;
  document.querySelectorAll(".unified-lighting-preview [data-key]").forEach((node) => {
    const key = keys[Number(node.dataset.key)],
      label = node.querySelector(".mapped"),
      meta = key && pressed ? fnLightingKeyMeta(key, activeLayer) : null;
    node.classList.toggle("fn-held", pressed && key?.id === Number(triggerId));
    node.classList.toggle("fn-layer-override", Boolean(meta?.override));
    node.classList.toggle("fn-layer-inherited", Boolean(meta && !meta.override));
    if (key && label)
      label.textContent = keycodeLabel(meta ? meta.resolved : displayedKeycode(key, 0));
  });
  const badge = document.querySelector(".unified-lighting-preview .badge:not(#lightingEffectPreviewStatus)");
  if (badge)
    badge.textContent = pressed
      ? `KEYBOARD + 38 LEDS · FN${activeLayer}`
      : "KEYBOARD + 38 LEDS";
  syncLightingEffectPreviewStatus();
}
function updateLiveStatus(message, error = false) {
  const node = document.querySelector("#liveRgbStatus");
  if (!node) return;
  node.textContent = !error && lightingEffectPreviewSource().draft ? "DRAFT · APPROXIMATE" : message;
  node.title = message;
  node.classList.toggle("ready", !error);
  node.classList.toggle("experimental", error);
}
function stopLightingPolling() {
  if (state.timers.lighting) clearTimeout(state.timers.lighting);
  state.timers.lighting = null;
  state.timers.lightingGeneration += 1;
}
function startLightingLive() {
  stopLightingPolling();
  if (!connected() || state.page !== "lighting" || !state.liveLighting || state.fnLightingBusy || isFnLightingTab()) return;
  const generation = state.timers.lightingGeneration;
  const read = async () => {
    if (
      generation !== state.timers.lightingGeneration ||
      !connected() ||
      state.page !== "lighting" ||
      !state.liveLighting
    )
      return;
    try {
      const keyboardMatrix = await state.transport.readLiveLighting(
        MATRIX_ROWS,
        MATRIX_COLS,
        0,
      );
      if (generation !== state.timers.lightingGeneration) return;
      updateLiveKeyboard(keyboardMatrix);
      const stripMatrix = await state.transport.readLiveLighting(
        DECORATIVE_ROWS,
        DECORATIVE_COLS,
        1,
      );
      if (generation !== state.timers.lightingGeneration) return;
      updateLiveStrip(stripMatrix);
      try {
        const fnState = await readFnLightingState();
        if (generation !== state.timers.lightingGeneration) return;
        updateFnLightingState(fnState.status, fnState.layer, fnState.triggerId);
        state.hardware.fnReadError = null;
      } catch (error) {
        if (state.hardware.fnReadError !== error.message) log("Fn status read unavailable", error.message);
        state.hardware.fnReadError = error.message;
        updateFnLightingState(0);
      }
      state.hardware.liveError = null;
      updateLiveStatus(state.hardware.fnPressed ? `LIVE · FN${state.hardware.fnLayer}` : "LIVE · ≈10 FPS");
    } catch (error) {
      if (generation !== state.timers.lightingGeneration) return;
      if (state.hardware.liveError !== error.message)
        log("Live RGB read retrying", error.message);
      state.hardware.liveError = error.message;
      updateLiveStatus("LIVE · RETRYING", true);
    }
    state.timers.lighting = setTimeout(read, LIVE_RGB_INTERVAL);
  };
  read();
}
function stopPolling() {
  if (state.selectionDrag?.kind === "fn") cancelLightingSelection();
  stopTravelPolling();
  stopLightingPolling();
}
