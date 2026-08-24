"use strict";

/**
 * AE64 Pro Control — live device tools.
 *
 * Loaded as an ordered classic script. Top-level declarations are shared
 * with the other application files; keep the order in index.html intact.
 * Handles RGB matrices, advanced reads, calibration, travel telemetry, and polling.
 */

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
      const record =
        state.hardware.customMatrix[key.row * MATRIX_COLS + key.col];
      state.profile.lighting.perKey[key.id] = rgbToHex(record);
      state.profile.lighting.customEnabled[key.id] = Boolean(record.custom);
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
    state.hardware.advanced = await state.transport.getAdvancedKey(position());
    log("Advanced record read", state.hardware.advanced);
    render();
  } catch (error) {
    showToast(error.message, true);
  }
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
  try {
    await state.transport.setCalibration(true);
    log("Calibration started");
    showToast("Calibration active. Press every key fully several times.");
    let cursor = 0;
    const cells = [...document.querySelectorAll(".calibration-grid i")];
    state.timers.calibration = setInterval(() => {
      cells
        .slice(0, (cursor += 2))
        .forEach((cell) => cell.classList.add("done"));
    }, 250);
  } catch (error) {
    showToast(error.message, true);
  }
}
async function stopCalibration() {
  if (state.timers.calibration) clearInterval(state.timers.calibration);
  state.timers.calibration = null;
  if (!connected()) return;
  try {
    await state.transport.setCalibration(false);
    await state.transport.saveParameters(SAVE_GROUP.CALIBRATION);
    log("Calibration stopped and saved");
    showToast("Calibration stopped and saved.");
  } catch (error) {
    showToast(error.message, true);
  }
}
async function startTravel() {
  if (!connected()) return showToast("Connect to read live travel.", true);
  stopPolling();
  const read = async () => {
    if (
      !connected() ||
      state.page !== "performance" ||
      state.performanceTab !== "travel"
    )
      return;
    try {
      const key = selectedKey(),
        data = await state.transport.getAxisData("route", key.row);
      state.hardware.travelValue = data.values[key.col] || 0;
      const valueNode = document.querySelector(".travel-meter .value"),
        meter = document.querySelector(".travel-meter");
      if (valueNode && meter) {
        const mm = Math.min(4, state.hardware.travelValue / 1000);
        valueNode.textContent = `${mm.toFixed(3)} mm`;
        meter.style.setProperty("--travel", `${Math.round((mm / 4) * 100)}%`);
      }
    } catch (error) {
      log("Travel poll stopped", error.message);
      showToast(error.message, true);
      return;
    }
    state.timers.travel = setTimeout(read, 120);
  };
  read();
}
function updateLiveKeyboard(matrix) {
  state.hardware.liveMatrix = matrix;
  state.hardware.liveUpdatedAt = Date.now();
  document.querySelectorAll(".lighting-preview [data-key]").forEach((node) => {
    const key = keys[Number(node.dataset.key)],
      record = key && matrix[key.row * MATRIX_COLS + key.col];
    if (record) node.style.setProperty("--key-color", rgbToHex(record));
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
function updateLiveStatus(message, error = false) {
  const node = document.querySelector("#liveRgbStatus");
  if (!node) return;
  node.textContent = message;
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
  if (!connected() || state.page !== "lighting" || !state.liveLighting) return;
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
      state.hardware.liveError = null;
      updateLiveStatus("LIVE · ≈10 FPS");
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
  if (state.timers.travel) clearTimeout(state.timers.travel);
  state.timers.travel = null;
  stopLightingPolling();
}
