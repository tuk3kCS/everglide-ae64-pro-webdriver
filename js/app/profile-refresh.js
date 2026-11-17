"use strict";

const settingsRefreshOptions = new Map([[0, "Off"], [15, "15 seconds"], [30, "30 seconds"], [60, "1 minute"], [120, "2 minutes"]]);
const settingsRefreshKey = (globalThis.AE64_STORAGE_PREFIX || "") + "settings-refresh-seconds";
const pausedSettingsRefresh = new Error("Settings refresh paused");
let settingsRefreshSeconds = 30;
let settingsRefreshDue = 0;
let settingsRefreshRunning = false;
let lastSettingsInteraction = 0;
let settingsInteractionVersion = 0;

try {
  const saved = localStorage.getItem(settingsRefreshKey);
  if (saved !== null && settingsRefreshOptions.has(Number(saved))) settingsRefreshSeconds = Number(saved);
} catch {
  // The current session can still use the refresh setting.
}

function resetSettingsRefreshClock() {
  settingsRefreshDue = performance.now() + settingsRefreshSeconds * 1000;
}
resetSettingsRefreshClock();

function noteSettingsInteraction() {
  lastSettingsInteraction = performance.now();
  settingsInteractionVersion++;
}

for (const type of ["pointerdown", "keydown", "input", "change", "dragstart", "wheel", "visibilitychange"])
  document.addEventListener(type, noteSettingsInteraction, { capture: true, passive: true });
window.addEventListener("blur", noteSettingsInteraction);

function settingsRefreshControl() {
  const options = [...settingsRefreshOptions].map(([seconds, label]) =>
    '<option value="' + seconds + '"' + (settingsRefreshSeconds === seconds ? ' selected' : '') + '>' + label + '</option>');
  return '<label class="field"><span>Settings refresh interval</span><select id="settingsRefreshInterval" data-keyboard-input="allow">' +
    options.join("") + '</select><small>Checks onboard settings while this tab is focused and idle.</small></label>';
}

function setSettingsRefreshInterval(value) {
  const seconds = Number(value);
  if (!settingsRefreshOptions.has(seconds)) return;
  settingsRefreshSeconds = seconds;
  noteSettingsInteraction();
  resetSettingsRefreshClock();
  try { localStorage.setItem(settingsRefreshKey, String(seconds)); }
  catch { showToast("Refresh interval changed for this session. Browser storage is unavailable.", true); }
}

function settingsWindowFocused() {
  return document.visibilityState === "visible" && document.hasFocus();
}

function settingsRefreshIdle() {
  return Boolean(settingsRefreshSeconds && settingsWindowFocused() && connected() &&
    !document.querySelector("#workspace")?.classList.contains("hidden") &&
    !["firmware", "recovery"].includes(state.page) && !state.profileNeedsReload &&
    !toolOperationBusy() && !state.calibrationActive && !state.calibrationBusy &&
    !state.macroRecording && !state.macroCatalogLoading && !state.selectionDrag &&
    !pendingChangeCount() && performance.now() - lastSettingsInteraction >= 1500 &&
    !document.querySelector("dialog[open]") &&
    !document.activeElement?.closest("input, select, textarea, [contenteditable], [role=slider]"));
}

// This list contains only the GET subcommands used by the onboard snapshot.
function settingsReadPacket([family, command, subcommand]) {
  if (family === 2) return command === 3 ? subcommand === 1 || subcommand === 3
    : [4, 5, 13, 16].includes(command) ? subcommand === 1 : command === 14 && subcommand === 0;
  if (family === 5) return command === 1 || command === 3;
  if (family === 7) return command === 1 || command === 3;
  if (family === 0x10) return [0x20, 0x25, 0x26, 0x30, 0x35].includes(command);
  return [3, 4, 6].includes(family) && command === 1;
}

function settingsRefreshReader(transport, requireIdle) {
  const reader = Object.create(AE64HidTransport.prototype);
  reader.device = transport.device;
  reader.transact = async (packet, options) => {
    if (!settingsReadPacket(packet)) throw new Error("The settings refresh may only read onboard data.");
    requireIdle();
    // Yield between individual reports so other WebHID work can run, and stop
    // even inside multi-packet Fn, macro, lighting, or gamepad reads.
    await new Promise((resolve) => setTimeout(resolve, 12));
    requireIdle();
    return transport.transact(packet, { ...options, beforeSend: requireIdle });
  };
  return reader;
}

function adoptRefreshedLighting(target, observed, matrix, perKey) {
  target.base = { ...target.base, ...observed.base };
  target.palette = observed.palette;
  if (!matrix) return;
  if (!perKey) {
    matrix.forEach((cell, index) => {
      target.customEnabled[index] = Boolean(cell.custom);
      if (cell.custom) target.perLed[index] = rgbToHex(cell);
    });
    return;
  }
  for (const key of keys) {
    const cells = lightingMatrixIndexes(key).map((index) => matrix[index]).filter(Boolean);
    const enabled = cells.some((cell) => cell.custom);
    target.customEnabled[key.id] = enabled;
    if (enabled) target.perKey[key.id] = rgbToHex(cells[Math.floor(cells.length / 2)]);
  }
}

function applySettingsRefresh(snapshot, deviceSettings, names, transport, slot) {
  const { bundle, performance: tuned, macroSpace, advanced, fnRevisions, gamepad, usb } = snapshot;
  const profile = clone(state.profile), lighting = bundle.profile.lighting,
    mainMatrix = bundle.custom.mainRgb || bundle.sharedMain;
  profile.keycodes = bundle.profile.keycodes;
  profile.performance = tuned;
  profile.settings = { ...profile.settings, ...deviceSettings, systemMode: bundle.systemMode };
  adoptRefreshedLighting(profile.lighting, lighting, mainMatrix, true);
  adoptRefreshedLighting(profile.lighting.decorative, lighting.decorative, bundle.sharedStrip, false);

  const changed = (a, b) => !profileCoreEqual(a, b);
  const staticCells = (matrix) => matrix?.map((cell) => cell.custom ? cell : null);
  let redraw = changed(profile, state.profile) || changed(names, state.hardware.configNames) ||
    changed([...advanced], [...state.hardware.advancedByKey]) ||
    (mainMatrix && changed(staticCells(mainMatrix), staticCells(state.hardware.customMatrix)));
  state.profile = profile;
  state.original = clone(profile);
  state.hardware.performance = new Map(keys.map(({ id }) => [id, tuned[id]]));
  for (const [layer, entries] of Object.entries(profile.keycodes))
    for (const [id, code] of Object.entries(entries)) state.hardware.keycodes.set(layer + ":" + id, code);
  state.hardware.advancedByKey = advanced;
  state.hardware.advanced = advanced.get(state.profile.selected) || null;
  state.hardware.macroSpace = macroSpace;
  const macros = new Map(bundle.native.macros.map((record) => [record.macroId, record]));
  if (changed([...macros], [...state.hardware.macros].filter(([, record]) => record.valid && record.actionCount))) redraw = true;
  state.hardware.macros = macros;
  state.hardware.configNames = names;
  if (mainMatrix) state.hardware.customMatrix = mainMatrix;
  if (bundle.sharedStrip) state.hardware.decorativeMatrix = bundle.sharedStrip;

  for (const [index, layer] of (bundle.custom.fnLighting || []).entries()) {
    const key = slot + ":" + (index + 1), before = fnLightingView.drafts.get(key);
    const draft = fnLightingNormalizeProfile({ ...layer, revision: fnRevisions[index] });
    if (changed(draft, before) || fnLightingView.errors.has(key)) redraw = true;
    fnLightingView.drafts.set(key, draft);
    fnLightingView.errors.delete(key);
  }
  if (isFnLightingTab()) commitFnLightingSelection(fnLightingView.selected, [...fnLightingView.selected].at(-1));
  if (gamepad) {
    if (state.page === "overview" && !gamepadConfigurationEqual(gamepad.config, gamepadOverview.config)) redraw = true;
    rememberGamepadProfile(gamepad.config, transport);
  }
  if (state.page === "gamepad") activeGamepadStudio?.acceptSettingsRefresh?.(gamepad, usb, transport);
  if (redraw && state.page === "gamepad") renderToolbar();
  else if (redraw) render();
}

async function maybeRefreshOnboardSettings() {
  if (settingsRefreshRunning || performance.now() < settingsRefreshDue || !settingsRefreshIdle()) return;
  const transport = state.transport, slot = Number(state.profile.profileIndex), page = state.page;
  const generation = state.timers.profileGeneration, interaction = settingsInteractionVersion;
  const requireIdle = () => {
    if (transport !== state.transport || page !== state.page || slot !== Number(state.profile.profileIndex) ||
        generation !== state.timers.profileGeneration || interaction !== settingsInteractionVersion || !settingsRefreshIdle())
      throw pausedSettingsRefresh;
  };
  settingsRefreshRunning = true;
  try {
    const reader = settingsRefreshReader(transport, requireIdle);
    const snapshot = await readOnboardProfileBundle(transport, slot, { includeShared: true, reader });
    const deviceSettings = {
      reportRate: await reader.getReportRate(),
      sleepTime: await reader.getLightingSleepTime(),
      shake: await reader.getShakeOptimization(),
    };
    const names = [...state.hardware.configNames];
    for (const index of state.hardware.configIndexes)
      names[index] = index === slot ? snapshot.bundle.name : (await reader.getConfigName(index)) || "Profile " + (index + 1);
    await assertProfileTransferTarget(transport, slot, reader);
    requireIdle();
    applySettingsRefresh(snapshot, deviceSettings, names, transport, slot);
  } catch (error) {
    if (error !== pausedSettingsRefresh) log("Settings refresh read incomplete", error.message);
  } finally {
    settingsRefreshRunning = false;
    resetSettingsRefreshClock();
  }
}
