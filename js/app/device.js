"use strict";

/**
 * AE64 Pro Control — device session.
 *
 * Loaded as an ordered classic script. Top-level declarations are shared
 * with the other application files; keep the order in index.html intact.
 * Owns workspace transitions, WebHID connection, device reads, and verification helpers.
 */

async function selectKey(id) {
  state.profile.selected = id;
  render();
  if (!connected()) return;
  try {
    await readSelectedKey();
    if (selectedKey().id === id) render();
  } catch (error) {
    showToast(error.message, true);
  }
}
async function readFnLayerTarget() {
  if (!connected()) return null;
  const fn = keys.find((key) => key.n === "Fn"), result = await state.transport.getKeyCode(position(fn), 0);
  state.profile.keycodes[0][fn.id] = result.keycode;
  state.hardware.keycodes.set(`0:${fn.id}`, result.keycode);
  return result.keycode;
}
function stopProfilePolling() {
  if (state.timers.profile) clearTimeout(state.timers.profile);
  state.timers.profile = null;
  state.timers.profileGeneration += 1;
}
async function syncPhysicalProfile() {
  if (!connected() || dirtyCount() || state.profileSyncInFlight) return false;
  const index = await state.transport.getCurrentConfig();
  if (Number(index) === Number(state.profile.profileIndex)) return false;
  if (!state.hardware.configIndexes.includes(Number(index))) return false;
  state.profileSyncInFlight = true;
  stopPolling();
  try {
    await reloadProfileFromDevice(Number(index));
    log("Physical profile switch detected", index);
    render();
    showToast(`Profile ${Number(index) + 1} loaded from keyboard.`);
    return true;
  } finally {
    state.profileSyncInFlight = false;
  }
}
function startProfilePolling() {
  stopProfilePolling();
  if (!connected()) return;
  const generation = state.timers.profileGeneration;
  const read = async () => {
    if (generation !== state.timers.profileGeneration || !connected()) return;
    try {
      await syncPhysicalProfile();
    } catch (error) {
      log("Physical profile check failed", error.message);
    }
    if (generation === state.timers.profileGeneration && connected())
      state.timers.profile = setTimeout(read, 250);
  };
  read();
}
function openWorkspace() {
  document.querySelector("#topbar").classList.add("hidden");
  document.querySelector("main").classList.add("hidden");
  document.querySelector("#workspace").classList.remove("hidden");
  render();
  window.scrollTo({ top: 0 });
}
async function returnHome() {
  if (state.calibrationActive || state.calibrationBusy) await stopCalibration(true);
  stopPolling();
  stopProfilePolling();
  document.querySelector("#workspace").classList.add("hidden");
  document.querySelector("#topbar").classList.remove("hidden");
  document.querySelector("main").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function showToast(message, isError = false) {
  const node = document.querySelector("#toast");
  node.textContent = message;
  node.classList.toggle("error", isError);
  node.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => node.classList.remove("show"), 3600);
}
function showProgress(title, detail = "") {
  document.querySelector("#progressTitle").textContent = title;
  document.querySelector("#progressDetail").textContent = detail;
  document.querySelector("#progressOverlay").classList.remove("hidden");
}
function hideProgress() {
  document.querySelector("#progressOverlay").classList.add("hidden");
}
async function optional(label, operation, fallback = null) {
  try {
    return await operation();
  } catch (error) {
    log(`${label} unavailable`, error.message);
    return fallback;
  }
}

async function connectKeyboard(device = null, { silent = false } = {}) {
  const targetDevice = device || state.knownDevice;
  if (!silent)
    showProgress(
      targetDevice ? "Opening AE64 Pro" : "Connecting to AE64 Pro",
      targetDevice
        ? "Opening your previously authorized keyboard."
        : "Choose the 1CA6:300A configuration interface.",
    );
  try {
    stopProfilePolling();
    if (state.transport) await state.transport.close();
    state.transport = targetDevice
      ? new AE64HidTransport(targetDevice)
      : await AE64HidTransport.request();
    if (targetDevice) await state.transport.open();
    await optional("open-web-driver handshake", () =>
      state.transport.openWebDriver(),
    );
    const [
      protocol,
      info,
      feature,
      precision,
      configIndexes,
      currentConfig,
      systemModes,
      systemMode,
      reportRates,
      reportRate,
      sleepTime,
      shake,
      axisLibrary,
      lightingAreas,
      doubleLighting,
      lightingBase,
      palette,
      decorativeBase,
      decorativePalette,
    ] = await Promise.all([
      state.transport.getProtocolVersion(),
      state.transport.getDeviceInfo(),
      state.transport.getDeviceFeature(),
      state.transport.getRtPrecision(),
      optional(
        "config list",
        () => state.transport.getConfigList(),
        [0, 1, 2, 3],
      ),
      optional("current config", () => state.transport.getCurrentConfig(), 0),
      optional("system modes", () => state.transport.getSystemModes(), []),
      optional("system mode", () => state.transport.getSystemMode(), 0),
      optional("report rates", () => state.transport.getReportRates(), []),
      optional("report rate", () => state.transport.getReportRate(), 0),
      optional(
        "lighting sleep",
        () => state.transport.getLightingSleepTime(),
        10,
      ),
      optional(
        "shake optimization",
        () => state.transport.getShakeOptimization(),
        false,
      ),
      optional("axis library", () => state.transport.getAxisLibrary(), []),
      optional("lighting areas", () => state.transport.getLightingAreas(), []),
      optional(
        "double lighting",
        () => state.transport.getDoubleLighting(),
        false,
      ),
      optional(
        "lighting base",
        () => state.transport.getLightingBase(0),
        state.profile.lighting.base,
      ),
      optional(
        "lighting palette",
        () => state.transport.getLightingPalette(0),
        null,
      ),
      optional(
        "Decorative1 base",
        () => state.transport.getLightingBase(1),
        state.profile.lighting.decorative.base,
      ),
      optional(
        "Decorative1 palette",
        () => state.transport.getLightingPalette(1),
        null,
      ),
    ]);
    if (info.boardIdHex.toUpperCase() !== "0030000A")
      throw new Error(
        `Unexpected board ID ${info.boardIdHex}; writes refused.`,
      );
    const layoutStyle = await optional("key layout style", () =>
      Promise.all(
        [0, 1, 2, 3, 4, 5].map((row) => state.transport.getKeyLayoutStyle(row)),
      ),
    );
    state.knownDevice = state.transport.device;
    state.hardware.keycodes.clear();
    state.hardware.advancedByKey.clear();
    Object.assign(state.hardware, {
      protocol,
      info,
      feature,
      precision,
      configIndexes: configIndexes.length ? configIndexes : [0, 1, 2, 3],
      systemModes,
      reportRates,
      axisLibrary,
      lightingAreas,
      doubleLighting: Boolean(doubleLighting),
      customMatrix: null,
      decorativeMatrix: null,
      liveMatrix: null,
      liveStrip: null,
      advanced: null,
      layoutStyle,
      keyPositions: firmwareKeyPositions(layoutStyle),
    });
    state.profile.profileIndex = currentConfig;
    state.advancedDraft = defaultSocdDraft();
    state.hardware.performance.clear();
    state.switchAssignmentsStatus = "idle";
    state.switchAssignmentsError = "";
    state.profile.settings = { systemMode, reportRate, sleepTime, shake };
    state.profile.lighting.base = {
      ...state.profile.lighting.base,
      ...lightingBase,
    };
    state.profile.lighting.decorative.base = {
      ...state.profile.lighting.decorative.base,
      ...decorativeBase,
    };
    if (palette) state.profile.lighting.palette = palette.map(rgbToHex);
    if (decorativePalette)
      state.profile.lighting.decorative.palette =
        decorativePalette.map(rgbToHex);
    state.hardware.configNames = await Promise.all(
      state.hardware.configIndexes.map((index) =>
        optional(
          `profile ${index + 1} name`,
          () => state.transport.getConfigName(index),
          `Profile ${index + 1}`,
        ),
      ),
    );
    await readKeymapLayer(state.profile.layer);
    await optional("Fn layer target", readFnLayerTarget);
    await readSelectedKey();
    await optional(
      "calibration status",
      () => readAllPerformanceRecords({ renderDuringLoad: false }),
      0,
    );
    await optional(
      "advanced key assignments",
      () => readAllAdvancedRecords({ renderDuringLoad: false }),
      0,
    );
    state.original = clone(state.profile);
    clearDirty();
    log("Connected", {
      boardId: info.boardIdHex,
      firmware: info.firmware,
      protocol,
      lightingAreas,
      doubleLighting: Boolean(doubleLighting),
      automatic: Boolean(targetDevice),
      remappedPositions: state.hardware.keyPositions.size,
    });
    openWorkspace();
    startProfilePolling();
    maybeShowCalibrationRecommendation();
    showToast(`AE64 Pro connected · firmware ${info.firmware}`);
    return true;
  } catch (error) {
    log("Connection failed", error.message);
    if (state.transport) await state.transport.close().catch(() => undefined);
    state.transport = null;
    stopProfilePolling();
    if (targetDevice === state.knownDevice) state.knownDevice = null;
    if (!silent) showToast(`Could not connect: ${error.message}`, true);
    renderStatus();
    return false;
  } finally {
    if (!silent) hideProgress();
  }
}
async function detectKnownKeyboard() {
  if (
    !AE64HidTransport.supported() ||
    typeof navigator.hid.getDevices !== "function"
  )
    return;
  try {
    state.knownDevice =
      (await navigator.hid.getDevices()).find(isAe64Device) || null;
    if (state.knownDevice) log("Authorized keyboard detected");
  } catch (error) {
    log("Keyboard detection failed", error.message);
  }
}
async function reconnectAfterPollingRateChange() {
  const attempts = 20;
  showProgress(
    "Reconnecting AE64 Pro",
    "Waiting for the keyboard to restart after the polling-rate change.",
  );
  try {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const devices =
          typeof navigator.hid?.getDevices === "function"
            ? await navigator.hid.getDevices()
            : [],
        device = devices.find(isAe64Device) || state.knownDevice;
      if (device) {
        state.knownDevice = device;
        if (await connectKeyboard(device, { silent: true })) return true;
      }
      document.querySelector("#progressDetail").textContent =
        `Waiting for the keyboard to restart (${attempt}/${attempts}).`;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    render();
    showToast("Polling rate changed. Reconnect the keyboard to continue.", true);
    return false;
  } catch (error) {
    log("Automatic polling-rate reconnect failed", error.message);
    render();
    showToast("Polling rate changed. Reconnect the keyboard to continue.", true);
    return false;
  } finally {
    hideProgress();
  }
}
async function readSelectedKey() {
  if (!connected()) return;
  const key = selectedKey(),
    token = `${state.profile.layer}:${key.id}`;
  const [performance, keyRecord] = await Promise.all([
    state.transport.getPerformance(position(key)),
    state.transport.getKeyCode(position(key), state.profile.layer),
  ]);
  state.hardware.performance.set(key.id, performance);
  state.hardware.keycodes.set(token, keyRecord.keycode);
  if (!state.dirty.performance.has(key.id))
    state.profile.performance[key.id] = performance;
  if (!state.dirty.mapping.has(token))
    state.profile.keycodes[state.profile.layer][key.id] = keyRecord.keycode;
  log("Selected key read", {
    key: key.n,
    row: key.row,
    col: key.col,
    layer: state.profile.layer,
  });
}
async function readAllPerformanceRecords({ renderDuringLoad = true } = {}) {
  if (!connected() || state.switchAssignmentsStatus === "loading") return 0;
  const targets = keys.filter(
    (key) =>
      !state.hardware.performance.has(key.id) &&
      !state.dirty.performance.has(key.id),
  );
  if (!targets.length) {
    state.switchAssignmentsStatus = "ready";
    state.switchAssignmentsError = "";
    return 0;
  }
  state.switchAssignmentsStatus = "loading";
  state.switchAssignmentsError = "";
  if (renderDuringLoad) render();
  try {
    const results = await Promise.allSettled(
      targets.map(async (key) => [
        key,
        await state.transport.getPerformance(position(key)),
      ]),
    );
    let loaded = 0;
    const failed = [];
    results.forEach((result, index) => {
      if (result.status !== "fulfilled") {
        failed.push(targets[index].n);
        return;
      }
      const [key, performance] = result.value;
      state.hardware.performance.set(key.id, performance);
      if (!state.dirty.performance.has(key.id))
        state.profile.performance[key.id] = performance;
      loaded += 1;
    });
    if (failed.length)
      throw new Error(
        `Could not read switch assignments for ${failed.length} key${failed.length === 1 ? "" : "s"}.`,
      );
    state.switchAssignmentsStatus = "ready";
    log("All switch assignments read", { keys: loaded });
    return loaded;
  } catch (error) {
    state.switchAssignmentsStatus = "error";
    state.switchAssignmentsError = error.message;
    throw error;
  } finally {
    if (renderDuringLoad) render();
  }
}
async function readKeymapLayer(layer = state.profile.layer) {
  if (!connected()) return 0;
  const resolvedLayer = Number(layer),
    rows = [...new Set(keys.map((key) => position(key).row))];
  const records = await Promise.allSettled(
    rows.map((row) => state.transport.getKeyLayout(resolvedLayer, row)),
  );
  let loaded = 0;
  records.forEach((record, rowIndex) => {
    if (record.status !== "fulfilled") return;
    const row = rows[rowIndex],
      keycodes = record.value.keycodes;
    keys.filter((key) => position(key).row === row).forEach((key) => {
      const keycode = keycodes[position(key).col];
      if (!Number.isInteger(keycode)) return;
      const token = `${resolvedLayer}:${key.id}`;
      state.hardware.keycodes.set(token, keycode);
      if (!state.dirty.mapping.has(token))
        state.profile.keycodes[resolvedLayer][key.id] = keycode;
      loaded += 1;
    });
  });
  if (!loaded) throw new Error(`Could not read layer ${resolvedLayer + 1}.`);
  log("Keymap layer read", { layer: resolvedLayer, keys: loaded });
  return loaded;
}
function clearDirty() {
  state.dirty.performance.clear();
  state.switchAssignmentKeys.clear();
  state.dirty.mapping.clear();
  state.dirty.customLighting.clear();
  state.dirty.decorativeLighting.clear();
  state.dirty.settings.clear();
  state.dirty.lightingBase = false;
  state.dirty.lightingPalette = false;
  state.dirty.decorativeBase = false;
  state.dirty.decorativePalette = false;
  state.dirty.advanced = false;
  state.dirty.macro = false;
  state.dirty.advancedRemovals.clear();
}
function performanceReadbackComparison(expected, actual, verifyAxis = false) {
  const hard = [],
    normalized = [],
    rapidTrigger = Number(expected.mode) === 1,
    labels = {
      mode: "mode",
      normalPress: "actuation",
      normalRelease: "experimental normal release",
      rtFirstTouch: "RT first touch",
      rtPress: "RT press",
      rtRelease: "RT release",
      pressDeadStroke: "top dead zone",
      releaseDeadStroke: "bottom dead zone",
      axisV2Id: "switch axis ID",
      axisRangeMax: "switch range",
      axisCoefficient: "switch coefficient",
    },
    integerFields = new Set([
      "mode",
      "axisV2Id",
      "axisRangeMax",
      "axisCoefficient",
    ]),
    differs = (field) =>
      integerFields.has(field)
        ? Number(expected[field]) !== Number(actual[field])
        : !closeEnough(expected[field], actual[field]),
    describe = (field) =>
      `${labels[field]} ${Number(expected[field])}→${Number(actual[field])}`;

  const strictTuning = rapidTrigger
    ? ["mode", "rtFirstTouch", "rtPress", "rtRelease"]
    : ["mode", "normalPress"];
  strictTuning.forEach((field) => {
    if (differs(field)) hard.push(describe(field));
  });
  ["normalRelease", "pressDeadStroke", "releaseDeadStroke"].forEach(
    (field) => {
      if (differs(field)) normalized.push(describe(field));
    },
  );
  if (verifyAxis) {
    if (differs("axisV2Id")) hard.push(describe("axisV2Id"));
    else
      ["axisRangeMax", "axisCoefficient"].forEach((field) => {
        if (differs(field)) normalized.push(describe(field));
      });
  }
  return { valid: hard.length === 0, hard, normalized };
}
function verifyLightingBase(expected, actual) {
  const expectedOpenMode = expected.open
    ? Number(expected.openMode || LIGHTING_OPEN_MODE.LOWER)
    : LIGHTING_OPEN_MODE.OFF;
  return (
    Number(actual.openMode) === expectedOpenMode &&
    ["mode", "brightness", "speed", "direction", "paletteIndex"].every(
      (field) => Number(actual[field]) === Number(expected[field]),
    )
  );
}
