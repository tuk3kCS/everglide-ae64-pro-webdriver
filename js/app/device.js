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
  if (!connected() || toolOperationBusy() || dirtyCount()) return false;
  const transport = state.transport, generation = state.timers.profileGeneration;
  const index = Number(await transport.getCurrentConfig());
  if (transport !== state.transport || generation !== state.timers.profileGeneration || toolOperationBusy() || dirtyCount()) return false;
  if (index === Number(state.profile.profileIndex) && !state.profileNeedsReload) return false;
  if (!state.hardware.configIndexes.includes(index)) return false;
  state.profileSyncInFlight = true;
  stopPolling();
  renderStatus();
  try {
    await reloadProfileFromDevice(index);
    log("Physical profile switch detected", index);
    showToast(`Profile ${index + 1} loaded from keyboard.`);
    return true;
  } finally {
    state.profileSyncInFlight = false;
    render();
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
  if (toolOperationBusy()) return;
  disposeGamepadPage();
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

async function connectKeyboard(device = null, { silent = false, choose = false } = {}) {
  if (firmwareView.detecting) await firmwareView.detectionDone;
  if (state.firmwareBusy || state.gamepadBusy || state.fnLightingBusy || state.connecting || state.profileSyncInFlight) return false;
  if (!choose && state.bootloaderConnected && state.transport?.connected && (!device || state.transport.device === device)) return true;
  const recovering = state.bootloaderConnected || firmwareView.recoveryRequired;
  state.connecting = true;
  state.bootloaderConnected = false;
  const targetDevice = choose ? null : device || state.knownDevice;
  if (!silent)
    showProgress(
      targetDevice ? "Opening AE64 Pro" : "Connecting to AE64 Pro",
      targetDevice
        ? "Opening your previously authorized keyboard."
        : "Choose the 1CA6:300A configuration interface.",
    );
  try {
    stopProfilePolling();
    resetFnLightingCapability();
    if (state.transport) await state.transport.close();
    state.transport = targetDevice
      ? new AE64HidTransport(targetDevice, { allowBootloader: true })
      : await AE64HidTransport.request({ allowBootloader: true });
    if (targetDevice) await state.transport.open();
    const connectionInfo = await state.transport.getDeviceInfo();
    if (connectionInfo.boardId !== window.AE64Firmware.BOARD || ![0, 255].includes(connectionInfo.runMode))
      throw new Error("This device is not a supported AE64 Pro application or recovery keyboard.");
    if (connectionInfo.runMode === 255) {
      enterFirmwareRecovery(state.transport, connectionInfo); return true;
    }
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
    ] = await Promise.all([
      state.transport.getProtocolVersion(),
      Promise.resolve(connectionInfo),
      state.transport.getDeviceFeature(),
      state.transport.getRtPrecision(),
      optional(
        "config list",
        () => state.transport.getConfigList(),
        [0, 1, 2, 3],
      ),
      state.transport.getCurrentConfig(),
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
    state.hardware.macros?.clear();
    state.hardware.macroSpace = null;
    state.macroDraft = null;
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
    if (!state.hardware.configIndexes.includes(currentConfig))
      throw new Error("The keyboard reported an invalid onboard profile.");
    state.profile.profileIndex = currentConfig;
    state.profileNeedsReload = false;
    keys.forEach((key) => { state.profile.lighting.customEnabled[key.id] = false; });
    state.profile.lighting.decorative.customEnabled.fill(false);
    state.advancedDraft = defaultSocdDraft();
    state.hardware.performance.clear();
    state.switchAssignmentsStatus = "idle";
    state.switchAssignmentsError = "";
    state.profile.settings = { systemMode, reportRate, sleepTime, shake };
    state.hardware.configNames = await Promise.all(
      state.hardware.configIndexes.map((index) =>
        optional(
          `profile ${index + 1} name`,
          () => state.transport.getConfigName(index),
          `Profile ${index + 1}`,
        ),
      ),
    );
    if (await readKeymapLayer(state.profile.layer) !== keys.length)
      throw new Error("The full keymap could not be read. Reconnect to retry.");
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
    await probeFnLighting(state.transport);
    if (typeof readLightingProfiles === "function") await readLightingProfiles({ force: true, renderAfter: false });
    if (await state.transport?.getCurrentConfig() !== currentConfig)
      throw new Error("The onboard profile changed while connecting. Reconnect to load it.");
    state.original = clone(state.profile);
    clearDirty();
    log("Connected", {
      boardId: info.boardIdHex,
      firmware: info.firmware,
      customFirmware: info.customFirmware,
      protocol,
      lightingAreas,
      doubleLighting: Boolean(doubleLighting),
      automatic: Boolean(targetDevice),
      remappedPositions: state.hardware.keyPositions.size,
    });
    firmwareView.recoveryRequired = false; firmwareView.recoveryMessage = "";
    if (recovering && firmwareView.phase === "error") firmwareProgress({ phase: "idle", percent: 0, detail: "Keyboard application reconnected." });
    openWorkspace();
    startProfilePolling();
    if (silent || !maybeShowFirmwareShowcase()) maybeShowCalibrationRecommendation();
    showToast(`AE64 Pro connected · firmware ${info.firmwareDisplay || info.firmware}`);
    return true;
  } catch (error) {
    log("Connection failed", error.message);
    if (state.transport) await state.transport.close().catch(() => undefined);
    state.transport = null;
    state.bootloaderConnected = Boolean(recovering);
    stopProfilePolling();
    if (targetDevice === state.knownDevice) state.knownDevice = null;
    if (!silent) showToast(`Could not connect: ${error.message}`, true);
    renderStatus();
    return false;
  } finally {
    state.connecting = false;
    if (!silent) hideProgress();
    if (state.page === "firmware") render();
    else renderStatus();
  }
}
async function detectKnownKeyboard() {
  if (
    !AE64HidTransport.supported() ||
    typeof navigator.hid.getDevices !== "function"
  )
    return;
  try {
    const devices = (await navigator.hid.getDevices()).filter(window.AE64FirmwareReconnect.eligible);
    devices.sort((a, b) => Number(b.collections.some((c) => c.usagePage === 0xff80)) - Number(a.collections.some((c) => c.usagePage === 0xff80)));
    state.knownDevice = devices[0] || null;
    if (state.knownDevice) log("Authorized keyboard detected");
    for (const device of devices) { await detectFirmwareRecovery(device); if (state.transport?.connected || state.connecting) break; }
  } catch (error) {
    log("Keyboard detection failed", error.message);
  }
}
async function reconnectAfterPollingRateChange(original, preferred, expectedRate) {
  showProgress(
    "Reconnecting AE64 Pro",
    "Waiting for the keyboard to restart after the polling-rate change.",
  );
  try {
    const reconnector = new window.AE64FirmwareReconnect.Reconnector({
      getDevices: async () => (await navigator.hid.getDevices()).filter(isAe64Device),
      inspect: inspectFirmwareDevice,
      checkIdentity: window.AE64Firmware.checkIdentity,
      timeout: 10000,
    });
    const { transport } = await reconnector.wait({ mode: 0, original, preferred });
    const device = transport.device;
    await transport.close();
    if (!await connectKeyboard(device, { silent: true }))
      throw new Error("The original keyboard could not finish reconnecting.");
    if (await state.transport.getReportRate() !== expectedRate)
      throw new Error("The keyboard reconnected with a different polling rate than requested.");
    showToast("Polling rate changed and verified on the keyboard.");
    return true;
  } catch (error) {
    log("Automatic polling-rate reconnect failed", error.message);
    render();
    showToast(connected() ? error.message : "Polling rate could not be verified. Reconnect the original keyboard to check its state.", true);
    return false;
  } finally {
    hideProgress();
  }
}
async function readSelectedKey() {
  if (!connected()) return;
  const key = selectedKey(), transport = state.transport, profile = state.profile.profileIndex,
    layer = state.profile.layer, token = `${layer}:${key.id}`;
  const [performance, keyRecord] = await Promise.all([
    transport.getPerformance(position(key)),
    transport.getKeyCode(position(key), layer),
  ]);
  if (transport !== state.transport || profile !== state.profile.profileIndex) return;
  state.hardware.performance.set(key.id, performance);
  state.hardware.keycodes.set(token, keyRecord.keycode);
  if (!state.dirty.performance.has(key.id))
    state.profile.performance[key.id] = performance;
  if (!state.dirty.mapping.has(token))
    state.profile.keycodes[layer][key.id] = keyRecord.keycode;
  log("Selected key read", {
    key: key.n,
    row: key.row,
    col: key.col,
    layer,
  });
}
async function readAllPerformanceRecords({ renderDuringLoad = true } = {}) {
  if (!connected() || state.switchAssignmentsStatus === "loading") return 0;
  const transport = state.transport, profile = state.profile.profileIndex;
  const current = () => transport === state.transport && profile === state.profile.profileIndex;
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
        await transport.getPerformance(position(key)),
      ]),
    );
    if (!current()) return 0;
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
    if (renderDuringLoad && current()) render();
  }
}
async function readKeymapLayer(layer = state.profile.layer) {
  if (!connected()) return 0;
  const transport = state.transport, profile = state.profile.profileIndex,
    resolvedLayer = Number(layer),
    rows = [...new Set(keys.map((key) => position(key).row))];
  const records = await Promise.allSettled(
    rows.map((row) => transport.getKeyLayout(resolvedLayer, row)),
  );
  if (transport !== state.transport || profile !== state.profile.profileIndex) return 0;
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
