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
function openWorkspace() {
  document.querySelector("#topbar").classList.add("hidden");
  document.querySelector("main").classList.add("hidden");
  document.querySelector("#workspace").classList.remove("hidden");
  render();
  window.scrollTo({ top: 0 });
}
function returnHome() {
  stopPolling();
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

async function connectKeyboard(device = null) {
  const targetDevice = device || state.knownDevice;
  showProgress(
    targetDevice ? "Opening AE64 Pro" : "Connecting to AE64 Pro",
    targetDevice
      ? "Opening your previously authorized keyboard."
      : "Choose the 1CA6:300A configuration interface.",
  );
  try {
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
      layoutStyle,
      keyPositions: firmwareKeyPositions(layoutStyle),
    });
    state.profile.profileIndex = currentConfig;
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
    await readSelectedKey();
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
    showToast(`AE64 Pro connected · firmware ${info.firmware}`);
  } catch (error) {
    log("Connection failed", error.message);
    if (state.transport) await state.transport.close().catch(() => undefined);
    state.transport = null;
    if (targetDevice === state.knownDevice) state.knownDevice = null;
    showToast(`Could not connect: ${error.message}`, true);
    renderStatus();
  } finally {
    hideProgress();
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
async function readKeymapLayer(layer = state.profile.layer) {
  if (!connected()) return 0;
  const resolvedLayer = Number(layer);
  const records = await Promise.allSettled(
    keys.map((key) =>
      state.transport.getKeyCode(position(key), resolvedLayer),
    ),
  );
  let loaded = 0;
  records.forEach((record, id) => {
    if (record.status !== "fulfilled") return;
    const key = keys[id],
      keycode = record.value.keycode;
    if (!Number.isInteger(keycode)) return;
    const token = `${resolvedLayer}:${key.id}`;
    state.hardware.keycodes.set(token, keycode);
    if (!state.dirty.mapping.has(token))
      state.profile.keycodes[resolvedLayer][key.id] = keycode;
    loaded += 1;
  });
  if (!loaded) throw new Error(`Could not read layer ${resolvedLayer + 1}.`);
  log("Keymap layer read", { layer: resolvedLayer, keys: loaded });
  return loaded;
}
function clearDirty() {
  state.dirty.performance.clear();
  state.dirty.mapping.clear();
  state.dirty.customLighting.clear();
  state.dirty.decorativeLighting.clear();
  state.dirty.settings.clear();
  state.dirty.lightingBase = false;
  state.dirty.lightingPalette = false;
  state.dirty.decorativeBase = false;
  state.dirty.decorativePalette = false;
}
function verifyPerformance(expected, actual) {
  return [
    "mode",
    "normalPress",
    "normalRelease",
    "rtFirstTouch",
    "rtPress",
    "rtRelease",
    "pressDeadStroke",
    "releaseDeadStroke",
  ].every((field) =>
    field === "mode"
      ? Number(expected[field]) === Number(actual[field])
      : closeEnough(expected[field], actual[field]),
  );
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
