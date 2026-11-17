"use strict";

const profileFileFormat = "ae64-control-profile";
const profileLayers = [0, 1, 2, 3];
const profileTuningFields = ["normalPress", "normalRelease", "rtFirstTouch", "rtPress", "rtRelease", "pressDeadStroke", "releaseDeadStroke"];
const profileLightingFields = ["openMode", "mode", "brightness", "speed", "direction", "paletteIndex"];
const profileCoreEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const profileGamepadPosition = (key) => position(gamepadPhysicalKey(key));

function profileBounded(value, maximum, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error("The profile contains an out-of-range value.");
  return value;
}

function profileMillimeters(value) {
  if (!Number.isFinite(value) || value < 0 || value > 65.535) throw new Error("The profile contains an invalid travel distance.");
  return value;
}

function profileTuning(value) {
  return { mode: profileBounded(value?.mode, 255), ...Object.fromEntries(profileTuningFields.map((field) => [field, profileMillimeters(value[field])])) };
}

function profileColor(value) {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error("Profile colors must be six-digit HEX values.");
  return value.toLowerCase();
}

function profileBaseLighting(value) {
  if (typeof value?.open !== "boolean") throw new Error("The profile has an invalid lighting setting.");
  return { open: value.open, ...Object.fromEntries(profileLightingFields.map((field) => [field, profileBounded(value[field], 255)])) };
}

function profileLighting(value) {
  if (!Array.isArray(value?.palette) || value.palette.length !== 8) throw new Error("The profile must include eight colors per lighting palette.");
  return { base: profileBaseLighting(value.base), palette: value.palette.map(profileColor) };
}

function profileMatrix(value) {
  return profileItems(value, MATRIX_ROWS * MATRIX_COLS, profileRgbCell);
}

function profileRgbCell(cell) {
  if (typeof cell?.custom !== "boolean") throw new Error("The profile has an invalid RGB override.");
  return { r: profileBounded(cell.r, 255), g: profileBounded(cell.g, 255), b: profileBounded(cell.b, 255), custom: cell.custom };
}

function profileFirmwareIdentity() {
  const info = state.hardware.info;
  if (!connected() || !info?.firmware) return { family: "unknown", version: "", baseVersion: "" };
  if (!info.customFirmware && fnLightingAvailable()) return { family: "unknown", version: "", baseVersion: info.firmware };
  return { family: info.customFirmware ? "custom" : "factory", version: info.customFirmware || info.firmware, baseVersion: info.firmware };
}

function profileFirmwareLabel({ family, version }) {
  if (family === "unknown") return "Firmware unknown";
  return (family === "custom" ? "Custom" : "Factory") + " v" + version;
}

function profileFileName(name) {
  return "ae64-" + (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "profile") + ".json";
}

function profileVerifiedName(value) {
  if (typeof value !== "string" || !value.trim() || /[\x00-\x1f]/.test(value) || new TextEncoder().encode(value).length > 32)
    throw new Error("A profile name must fit in 32 UTF-8 bytes.");
  return value;
}

function profileAdvancedRecord(value) {
  const id = profileBounded(value.id, keys.length - 1), mode = profileBounded(value.mode, ADVANCED_MODE.RS, ADVANCED_MODE.DKS);
  const output = (length) => profileItems(value.keycodes, length, (n) => profileBounded(n, 65535));
  const word = (n) => profileBounded(n, 65535);
  switch (mode) {
    case ADVANCED_MODE.DKS: return { id, mode, keycodes: output(4), travels: profileItems(value.travels, 4, (n) => profileBounded(n, 255)), deadzones: profileItems(value.deadzones, 2, profileMillimeters) };
    case ADVANCED_MODE.MPT: {
      const depths = profileItems(value.depths, 3, profileMillimeters), keycodes = output(3);
      if (!depths.every((depth, i) => depth > (depths[i - 1] ?? 0)) || !keycodes[0] || !keycodes[1] ||
          new Set(keycodes.filter(Boolean)).size !== keycodes.filter(Boolean).length) throw new Error("The profile has an invalid multi-point trigger.");
      return { id, mode, keycodes, depths };
    }
    case ADVANCED_MODE.MT: return { id, mode, keycodes: output(2), time: word(value.time) };
    case ADVANCED_MODE.TGL: return { id, mode, keycode: word(value.keycode), time: word(value.time) };
    case ADVANCED_MODE.END: return { id, mode, keycodes: output(2), delay: word(value.delay) };
    case ADVANCED_MODE.SOCD:
    case ADVANCED_MODE.RS:
      return { id, mode, keycodes: output(2), delay: word(value.delay), partner: profileBounded(value.partner, keys.length - 1),
        ...(mode === ADVANCED_MODE.SOCD ? { socdMode: profileBounded(value.socdMode, 3) } : {}) };
  }
}

function profileItems(value, length, normalize) {
  if (!Array.isArray(value) || value.length !== length) throw new Error("The profile has a missing or incomplete settings record.");
  return value.map(normalize);
}

function profileAdvancedRecords(list) {
  if (!Array.isArray(list) || list.length > keys.length) throw new Error("The profile has an invalid advanced-key table.");
  const records = list.map(profileAdvancedRecord).sort((a, b) => a.id - b.id);
  const byId = new Map(records.map((record) => [record.id, record]));
  if (byId.size !== records.length) throw new Error("The profile has duplicate advanced keys.");
  for (const record of records) {
    if (record.partner === undefined) continue;
    const other = byId.get(record.partner);
    if (other?.partner !== record.id || other.id === record.id || other.mode !== record.mode || other.delay !== record.delay ||
        !profileCoreEqual(other.keycodes, [...record.keycodes].reverse()) ||
        (record.mode === ADVANCED_MODE.SOCD && !SOCD_PAIR_MODES.some(([a, b]) => a === record.socdMode && b === other.socdMode)))
      throw new Error("The profile has an invalid paired advanced key.");
  }
  return records;
}

function profileMacroRecords(list) {
  if (!Array.isArray(list) || list.length > 16) throw new Error("The profile has an invalid macro table.");
  const records = list.map((record) => {
    if (!Array.isArray(record.actions) || record.actions.length > MACRO_PROTOCOL_EVENT_LIMIT) throw new Error("The profile has an invalid macro length.");
    return {
      macroId: profileBounded(record.macroId, 15), mode: profileBounded(record.mode, 5), repeatCount: profileBounded(record.repeatCount, 65535),
      actions: record.actions.map((action) => {
        if (typeof action.pressed !== "boolean") throw new Error("The profile has an invalid macro action.");
        return { pressed: action.pressed, delay: profileBounded(action.delay, 0x7fff), keycode: profileBounded(action.keycode, 65535, 1) };
      }),
    };
  }).sort((a, b) => a.macroId - b.macroId);
  if (new Set(records.map((record) => record.macroId)).size !== records.length) throw new Error("The profile has duplicate macro slots.");
  return records;
}

function profileHasCurves(version) {
  const [major, minor] = version.split(".").map(Number);
  return major > 0 || minor >= 10;
}

function parseProfileBundle(data) {
  if (data?.format !== profileFileFormat || data.version !== 2 ||
      data.device?.vendorId !== "1CA6" || data.device?.productId !== "300A") throw new Error("Choose an AE64 Pro profile exported in the new format.");
  const { firmware, profile } = data;
  const firmwareVersion = /^\d+(?:\.\d+){1,3}$/;
  const validVersion = (value) => typeof value === "string" && firmwareVersion.test(value);
  if (!firmware || !["custom", "factory", "unknown"].includes(firmware.family) ||
      (firmware.family !== "unknown" && (!validVersion(firmware.version) || !validVersion(firmware.baseVersion))))
    throw new Error("The profile has invalid firmware information.");
  const measure = profile?.lighting;
  const custom = {};
  if (firmware.family === "custom") {
    if (data.custom?.fnLighting !== undefined) custom.fnLighting = profileItems(data.custom.fnLighting, 3, (layer) => {
      const { enabled, colors } = fnLightingNormalizeProfile(layer);
      return { enabled, colors };
    });
    if (data.custom?.mainRgb !== undefined) custom.mainRgb = profileMatrix(data.custom.mainRgb);
    if (data.custom?.gamepad !== undefined) {
      custom.gamepad = window.AE64GamepadModel.validate(data.custom.gamepad);
      window.AE64GamepadProtocol.encode(custom.gamepad);
    }
  }
  const native = {};
  if (data.native?.advanced !== undefined) native.advanced = profileAdvancedRecords(data.native.advanced);
  if (data.native?.macros !== undefined) native.macros = profileMacroRecords(data.native.macros);
  const sharedMain = firmware.family !== "unknown" && data.sharedMain !== undefined ? profileMatrix(data.sharedMain) : undefined;
  const sharedStrip = data.sharedStrip !== undefined ? profileItems(data.sharedStrip, DECORATIVE_ROWS * DECORATIVE_COLS, profileRgbCell) : undefined;
  return {
    format: profileFileFormat, version: 2, device: { vendorId: "1CA6", productId: "300A" },
    name: profileVerifiedName(data.name), firmware: { family: firmware.family, version: firmware.version, baseVersion: firmware.baseVersion },
    exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : new Date().toISOString(),
    systemMode: profileBounded(data.systemMode, 255), native, custom, sharedMain, sharedStrip,
    profile: {
      keycodes: Object.fromEntries(profileLayers.map((layer) => [layer, Object.fromEntries(keys.map(({ id }) => [id, profileBounded(profile?.keycodes?.[layer]?.[id], 65535)]))])),
      performance: Object.fromEntries(keys.map(({ id }) => [id, profileTuning(profile?.performance?.[id])])),
      lighting: { ...profileLighting(measure), decorative: profileLighting(measure?.decorative) },
    },
  };
}

async function assertProfileTransferTarget(transport, slot, reader = transport) {
  if (transport !== state.transport || !connected() || await reader.getCurrentConfig() !== slot || transport !== state.transport)
    throw new Error("The onboard profile changed or disconnected during the transfer.");
}

function profileAdvancedFromKeyboard(id, value) {
  const partner = keyAtFirmwarePosition(value.pairedRow, value.pairedCol)?.id;
  return profileAdvancedRecord({ ...value, id, partner });
}

async function readOnboardProfileBundle(transport, slot, { includeShared = false, reader = transport } = {}) {
  await assertProfileTransferTarget(transport, slot, reader);
  const background = reader !== transport;
  const firmware = profileFirmwareIdentity(), performance = {}, keycodes = {}, native = { advanced: [], macros: [] }, custom = {};
  const advanced = new Map(), fnRevisions = [];
  const rows = [...new Set(keys.map((key) => position(key).row))];
  for (const layer of profileLayers) {
    const records = new Map();
    for (const row of rows) {
      const reply = await reader.getKeyLayout(layer, row);
      if (reply.row !== row || reply.layer !== layer) throw new Error("The keyboard returned the wrong keymap layer.");
      records.set(row, reply.keycodes);
    }
    keycodes[layer] = Object.fromEntries(keys.map((key) => {
      const { row, col } = position(key);
      return [key.id, profileBounded(records.get(row)?.[col], 65535)];
    }));
  }
  for (const key of keys) {
    const address = position(key);
    performance[key.id] = await reader.getPerformance(address);
    const record = await reader.getAdvancedKey(address);
    if (record.mode !== ADVANCED_MODE.NONE) {
      advanced.set(key.id, record);
      if (!background) native.advanced.push(profileAdvancedFromKeyboard(key.id, record));
    }
  }
  const macroSpace = await reader.getMacroSpaceInfo();
  profileBounded(macroSpace.count, 16);
  for (let macroId = 0; macroId < macroSpace.count; macroId++) {
    const mode = await reader.getMacroMode(macroId);
    if (mode.macroId !== macroId) throw new Error("The keyboard returned the wrong macro slot.");
    if (mode.valid && mode.actionCount) native.macros.push({ ...mode, actions: await reader.getMacroActions(macroId, mode.actionCount) });
  }
  const lighting = await readProfileBaseLighting(reader, 0);
  lighting.decorative = await readProfileBaseLighting(reader, 1);
  if (background ? fnLightingAvailable() : firmware.family === "custom") {
    if (!background && (!fnLightingAvailable() || !fnLightingView.caps.persistent))
      throw new Error("The keyboard did not verify persistent Fn lighting. Reconnect and try again.");
    const client = background ? new window.AE64FnRgb.Client(reader) : fnLightingView.client;
    custom.fnLighting = [];
    for (const layer of profileLayers.slice(1)) {
      const value = await client.read(slot, layer);
      custom.fnLighting.push(value);
      fnRevisions.push(value.revision);
    }
    if (background ? profileMainRgbAvailable() : expectsProfileMainRgb())
      custom.mainRgb = (await (background ? client : requireProfileMainRgb()).read(slot, 0)).matrix;
    if (new Set(fnRevisions).size !== 1) throw new Error("Fn lighting changed during the profile read. Try again.");
  }
  let gamepad, usb;
  if (firmware.family === "custom" && profileHasCurves(firmware.version)) {
    gamepad = await window.AE64GamepadProtocol.read(reader);
    if (!background && !gamepad.persistent) throw new Error("The keyboard did not verify persistent gamepad profiles.");
    custom.gamepad = gamepad.config;
    if (background && gamepad.usbDeviceSwitch) usb = await window.AE64GamepadProtocol.readUsbState(reader);
  }
  const sharedMain = includeShared && !custom.mainRgb && (!background || !expectsProfileMainRgb())
    ? await (background ? reader.readCustomLighting(MATRIX_ROWS, MATRIX_COLS, 0) : readMainRgbMatrix(transport)) : undefined;
  const sharedStrip = includeShared ? await reader.readCustomLighting(DECORATIVE_ROWS, DECORATIVE_COLS, 1) : undefined;
  const name = (await reader.getConfigName(slot)) || "Profile " + (slot + 1);
  const systemMode = await reader.getSystemMode();
  await assertProfileTransferTarget(transport, slot, reader);
  const data = { format: profileFileFormat, version: 2, device: { vendorId: "1CA6", productId: "300A" },
    firmware, name, systemMode, profile: { keycodes, performance, lighting }, native, custom, sharedMain, sharedStrip };
  return { bundle: background ? data : parseProfileBundle(data), performance, macroSpace, advanced, fnRevisions, gamepad, usb };
}

async function readProfileBaseLighting(transport, area) {
  const base = await transport.getLightingBase(area);
  return { base, palette: (await transport.getLightingPalette(area)).map(rgbToHex) };
}

async function withOnboardProfileRead(title, slot, operation, { switchSlot = false } = {}) {
  if (toolOperationBusy() || state.calibrationActive || state.calibrationBusy) throw new Error("Finish the current keyboard operation first.");
  if (!connected()) throw new Error("Connect the keyboard first.");
  if (pendingChangeCount()) throw new Error("Apply or revert changes before using onboard profiles.");
  const transport = state.transport;
  state.profileSyncInFlight = true;
  stopPolling();
  stopProfilePolling();
  renderStatus();
  showProgress(title, "Reading the onboard profile.");
  try {
    if (switchSlot && await transport.getCurrentConfig() !== slot) {
      state.profileNeedsReload = true;
      await transport.switchConfig(slot);
    }
    await assertProfileTransferTarget(transport, slot);
    return await operation(transport);
  } finally {
    state.profileSyncInFlight = false;
    hideProgress();
    render();
    if (connected()) startProfilePolling();
  }
}

function profileImportPolicy(source, destination, { swap = false } = {}) {
  const sameFamily = source.firmware.family !== "unknown" && source.firmware.family === destination.firmware.family;
  if (swap && (!sameFamily || source.firmware.family === "unknown"))
    throw new Error("Inactive profiles can only swap onto the same firmware family. Use JSON Import for compatible settings.");
  if (swap && source.systemMode !== destination.systemMode)
    throw new Error("Switch the keyboard to the profile's Windows or macOS mode before swapping it.");
  const skipped = [];
  const native = source.firmware.family !== "unknown" && destination.firmware.family !== "unknown" &&
    source.firmware.baseVersion === destination.firmware.baseVersion ? source.native : {};
  if (native !== source.native && (source.native.advanced || source.native.macros)) skipped.push("advanced keys and macros");
  const custom = {};
  for (const [key, label] of Object.entries({ fnLighting: "Fn RGB", mainRgb: "per-profile Main RGB", gamepad: "gamepad" })) {
    if (sameFamily && source.custom[key] !== undefined && destination.custom[key] !== undefined) custom[key] = source.custom[key];
    else if (source.custom[key] !== undefined || swap && destination.custom[key] !== undefined) skipped.push(label);
  }
  if (source.firmware.family === "custom" && !profileHasCurves(source.firmware.version)) {
    if (swap) skipped.push("legacy gamepad format");
  }
  const sharedMain = !swap && sameFamily && destination.sharedMain ? source.sharedMain : undefined;
  if (!swap && source.sharedMain && !sharedMain) skipped.push("shared Main RGB");
  if (swap && (skipped.length || !native.advanced || !native.macros)) throw new Error("This inactive profile cannot fully replace the current slot on this firmware. Use JSON Import to load supported settings.");
  return { native, custom, skipped, sharedMain, sharedStrip: !swap && destination.sharedStrip ? source.sharedStrip : undefined };
}

function profileStageLighting(target, incoming, defaultModes, dirtyBase, dirtyPalette, skipped) {
  const base = { ...incoming.base };
  if (base.mode >= defaultModes) {
    base.mode = target.base.mode;
    skipped.push("unsupported RGB effect");
  }
  state.dirty[dirtyBase] = !profileCoreEqual(target.base, base);
  state.dirty[dirtyPalette] = !profileCoreEqual(target.palette, incoming.palette);
  Object.assign(target, { base, palette: [...incoming.palette] });
}

async function stageProfileBundle(source, target, transport, slot, { swap = false, beforeStage } = {}) {
  const destination = target.bundle, policy = profileImportPolicy(source, destination, { swap });
  if (policy.native.macros) {
    const { count, capacity } = target.macroSpace;
    if (policy.native.macros.some((macro) => macro.macroId >= count) ||
        policy.native.macros.reduce((total, macro) => total + macro.actions.length, 0) + count > capacity)
      throw new Error("The profile's macros exceed this keyboard's available macro space.");
  }
  if (policy.custom.gamepad?.mode && policy.custom.gamepad.mode !== "off") {
    const api = window.AE64GamepadProtocol;
    api.validateTravelLimits(policy.custom.gamepad, await api.readTravelLimits(transport, policy.custom.gamepad, profileGamepadPosition));
  }
  await assertProfileTransferTarget(transport, slot);
  if (beforeStage) beforeStage();
  const stageGamepad = policy.custom.gamepad && !gamepadConfigurationEqual(policy.custom.gamepad, destination.custom.gamepad);
  if (stageGamepad) driverStorage.setItem(gamepadDraftKey, JSON.stringify(policy.custom.gamepad));
  const previous = destination.profile, next = source.profile, profile = state.profile;
  profile.profileIndex = slot;
  state.hardware.configNames[slot] = destination.name;
  state.profileNeedsReload = false;
  state.hardware.performance = new Map(keys.map(({ id }) => [id, target.performance[id]]));
  state.hardware.advancedByKey = target.advanced;
  state.hardware.advanced = null;
  state.advancedDraft = defaultSocdDraft();
  state.hardware.macros.clear();
  for (const record of destination.native.macros)
    state.hardware.macros.set(record.macroId, { ...record, valid: true, actionCount: record.actions.length });
  state.hardware.macroSpace = target.macroSpace;
  state.macroDraft = null;
  state.hardware.keycodes = new Map(profileLayers.flatMap((layer) => keys.map(({ id }) => [layer + ":" + id, previous.keycodes[layer][id]])));
  profile.keycodes = clone(previous.keycodes);
  profile.performance = clone(target.performance);
  profile.combinationBases = {};
  profile.macroBases = {};
  Object.assign(profile.lighting, { base: previous.lighting.base, palette: previous.lighting.palette });
  Object.assign(profile.lighting.decorative, previous.lighting.decorative);
  state.hardware.customMatrix = null;
  const oldMain = destination.custom.mainRgb || destination.sharedMain;
  if (oldMain) adoptTransferMainRgb(oldMain);
  state.hardware.decorativeMatrix = destination.sharedStrip || null;
  destination.sharedStrip?.forEach((cell, index) => {
    profile.lighting.decorative.perLed[index] = rgbToHex(cell);
    profile.lighting.decorative.customEnabled[index] = cell.custom;
  });
  state.original = clone(profile);
  const transfer = {
    name: source.name !== destination.name ? source.name : null,
    advanced: policy.native.advanced && !profileCoreEqual(policy.native.advanced, destination.native.advanced) ? policy.native.advanced : null,
    macros: policy.native.macros && !profileCoreEqual(policy.native.macros, destination.native.macros) ? policy.native.macros : null,
    mainRgb: policy.custom.mainRgb && !profileCoreEqual(policy.custom.mainRgb, destination.custom.mainRgb) ? policy.custom.mainRgb : null,
    sharedMain: policy.sharedMain && !profileCoreEqual(policy.sharedMain, destination.sharedMain) ? policy.sharedMain : null,
  };
  state.profileTransfer = Object.values(transfer).some(Boolean) ? { ...transfer, transport, slot, auto: !swap } : null;
  for (const { id } of keys) {
    if (!profileCoreEqual(next.performance[id], previous.performance[id])) {
      Object.assign(profile.performance[id], next.performance[id]);
      state.dirty.performance.add(id);
    }
    for (const layer of profileLayers) {
      const code = next.keycodes[layer][id];
      if (code !== previous.keycodes[layer][id] && (policy.native.macros || macroSlotFromKeycode(code) === null)) {
        profile.keycodes[layer][id] = code;
        state.dirty.mapping.add(layer + ":" + id);
      }
    }
  }
  if (transfer.advanced) {
    const affected = [...destination.native.advanced, ...transfer.advanced].map(({ id }) => id);
    for (const id of affected) state.dirty.performance.add(id);
  }
  profileStageLighting(profile.lighting, next.lighting, swap ? Infinity : lightingModeCount(0, AE64_MAIN_MODE_COUNT), "lightingBase", "lightingPalette", policy.skipped);
  profileStageLighting(profile.lighting.decorative, next.lighting.decorative, swap ? Infinity : lightingModeCount(1, AE64_DECORATIVE_MODE_COUNT), "decorativeBase", "decorativePalette", policy.skipped);
  policy.sharedStrip?.forEach((cell, index) => {
    if (profileCoreEqual(cell, destination.sharedStrip[index])) return;
    profile.lighting.decorative.perLed[index] = rgbToHex(cell);
    profile.lighting.decorative.customEnabled[index] = cell.custom;
    state.dirty.decorativeLighting.add(index);
  });
  if (transfer.mainRgb || transfer.sharedMain) adoptTransferMainRgb(transfer.mainRgb || transfer.sharedMain);
  if (policy.custom.fnLighting) {
    for (const [i, fn] of policy.custom.fnLighting.entries()) {
      const baseline = destination.custom.fnLighting[i];
      const key = slot + ":" + (i + 1);
      const draft = fnLightingNormalizeProfile({ ...baseline, revision: target.fnRevisions[i] });
      if (!profileCoreEqual(fn, baseline)) Object.assign(draft, { ...fn, dirty: true });
      fnLightingView.drafts.set(key, draft);
    }
  }
  if (stageGamepad) {
    rememberGamepadProfile(destination.custom.gamepad, transport);
    stageGamepadChange(policy.custom.gamepad, destination.custom.gamepad);
  }
  stageFnReleaseMappings();
  if (!state.profileTransfer && pendingChangeCount()) state.profileTransfer = { transport, slot, auto: !swap };
  return [...new Set(policy.skipped)];
}

function adoptTransferMainRgb(matrix) {
  for (const key of keys) {
    const records = lightingMatrixIndexes(key).map((index) => matrix[index]).filter(Boolean);
    if (records.length) {
      state.profile.lighting.perKey[key.id] = rgbToHex(records[Math.floor(records.length / 2)]);
      state.profile.lighting.customEnabled[key.id] = records.some((record) => record.custom);
    }
  }
}

async function applyProfileNativeRecords(transport, slot, transfer) {
  if (transfer.macros) await writeTransferredMacros(transport, slot, transfer.macros);
  if (transfer.advanced) await writeTransferredAdvanced(transport, slot, transfer.advanced);
}

async function writeTransferredMacros(transport, slot, records) {
  const space = await transport.getMacroSpaceInfo(), byId = new Map(records.map((record) => [record.macroId, record]));
  const current = [];
  for (let id = 0; id < space.count; id++) {
    const mode = await transport.getMacroMode(id);
    if (mode.valid && mode.actionCount) current.push({ ...mode, actions: await transport.getMacroActions(id, mode.actionCount) });
  }
  const original = new Map(profileMacroRecords(current).map((record) => [record.macroId, record]));
  const changes = [...new Set([...original.keys(), ...byId.keys()])].filter((id) => !profileCoreEqual(original.get(id), byId.get(id)));
  if (!changes.length) return;
  document.querySelector("#progressDetail").textContent = "Restoring profile macros.";
  // Clear changed allocations first so the complete incoming table can fit.
  for (const macroId of changes) {
    await assertProfileTransferTarget(transport, slot);
    if (original.has(macroId)) await transport.setMacroMode({ macroId, valid: true, actionCount: 0 });
  }
  for (const macroId of changes) {
    const record = byId.get(macroId);
    if (!record) continue;
    await assertProfileTransferTarget(transport, slot);
    await transport.setMacroMode({ ...record, valid: true, actionCount: record.actions.length });
    await transport.setMacroActions(record);
  }
  await assertProfileTransferTarget(transport, slot);
  await transport.saveParameters(SAVE_GROUP.MACRO);
  for (const id of changes) {
    const verified = await transport.getMacroMode(id), record = byId.get(id);
    if (record) {
      const actions = await transport.getMacroActions(id, verified.actionCount);
      if (!verified.valid || !profileCoreEqual(profileMacroRecords([{ ...verified, actions }])[0], record))
        throw new Error("Macro " + id + " could not be verified.");
      state.hardware.macros.set(id, { ...verified, actions });
    } else {
      if (verified.valid && verified.actionCount) throw new Error("Macro " + id + " could not be cleared.");
      state.hardware.macros.delete(id);
    }
  }
}

async function writeTransferredAdvanced(transport, slot, records) {
  const desired = new Map(records.map((record) => [record.id, record]));
  const existing = new Set();
  document.querySelector("#progressDetail").textContent = "Restoring profile advanced keys.";
  for (const key of keys) {
    const value = await transport.getAdvancedKey(position(key));
    if (value.mode !== ADVANCED_MODE.NONE) existing.add(key.id);
  }
  // Clear existing assignments and recreate reciprocal pairs together.
  for (const id of existing) {
    await assertProfileTransferTarget(transport, slot);
    await transport.clearAdvancedKey(position(keys[id]));
  }
  for (const record of records) {
    if (record.partner !== undefined && record.partner < record.id) continue;
    await assertProfileTransferTarget(transport, slot);
    const address = position(keys[record.id]), input = { ...record, position: address };
    switch (record.mode) {
      case ADVANCED_MODE.DKS: await transport.setDynamicKeystroke({ ...input, dbs: record.deadzones }); break;
      case ADVANCED_MODE.MPT: await transport.setMultipointTrigger(input); break;
      case ADVANCED_MODE.MT: await transport.setModTap({ ...input, delay: record.time }); break;
      case ADVANCED_MODE.TGL: await transport.setToggleKey({ ...input, delay: record.time }); break;
      case ADVANCED_MODE.END: await transport.setEndKey(input); break;
      case ADVANCED_MODE.RS:
      case ADVANCED_MODE.SOCD: {
        const pair = { first: address, second: position(keys[record.partner]), keycodes: record.keycodes, delay: record.delay };
        if (record.mode === ADVANCED_MODE.SOCD) await transport.setSocdPair({ ...pair, mode: record.socdMode });
        else await transport.setRappySnappyPair(pair);
        break;
      }
    }
  }
  await assertProfileTransferTarget(transport, slot);
  await transport.saveParameters(SAVE_GROUP.ADVANCED);
  state.hardware.advancedByKey.clear();
  for (const id of new Set([...existing, ...desired.keys()])) {
    const read = await transport.getAdvancedKey(position(keys[id])), record = desired.get(id);
    if (record ? !profileCoreEqual(profileAdvancedFromKeyboard(id, read), record) : read.mode !== ADVANCED_MODE.NONE)
      throw new Error("Advanced key verification failed for " + keys[id].n + ".");
    if (record) state.hardware.advancedByKey.set(id, read);
  }
}

async function readProfileFile(file) {
  if (file.size > 2 * 1024 * 1024) throw new Error("The profile file is larger than 2 MiB.");
  return JSON.parse(await file.text());
}

async function exportOnboardProfile() {
  const slot = Number(state.profile.profileIndex);
  try {
    const { bundle } = await withOnboardProfileRead("Exporting profile", slot, (transport) => readOnboardProfileBundle(transport, slot, { includeShared: true }));
    downloadJson(profileFileName(bundle.name), bundle);
    showToast("Downloaded " + bundle.name + ".");
  } catch (error) { showToast(error.message, true); }
}

async function importProfileBundle(data) {
  const source = parseProfileBundle(data), slot = Number(state.profile.profileIndex);
  const skipped = await withOnboardProfileRead("Preparing profile import", slot, async (transport) => {
    const target = await readOnboardProfileBundle(transport, slot, { includeShared: true });
    return stageProfileBundle(source, target, transport, slot);
  });
  const note = skipped.length ? " Skipped " + skipped.join(", ") + "." : "";
  showToast((state.autoApply ? "Compatible settings are ready for Auto Apply." : "Compatible settings are staged. Review and apply them to the keyboard.") + note);
}

async function importGamepadBackup(data) {
  const config = window.AE64GamepadModel.validate(data), slot = Number(state.profile.profileIndex);
  const firmware = profileFirmwareIdentity();
  if (firmware.family !== "custom" || !profileHasCurves(firmware.version))
    throw new Error("Connect compatible custom firmware to import a gamepad backup.");
  const protocol = window.AE64GamepadProtocol;
  const staged = await withOnboardProfileRead("Preparing gamepad import", slot, async (transport) => {
    const onboard = await protocol.read(transport);
    if (gamepadConfigurationEqual(config, onboard.config)) return false;
    if (config.mode !== "off") {
      if (!onboard.transports?.[config.transport]) throw new Error("The selected controller type is unavailable on this firmware.");
      protocol.validateTravelLimits(config, await protocol.readTravelLimits(transport, config, profileGamepadPosition));
    }
    await assertProfileTransferTarget(transport, slot);
    driverStorage.setItem(gamepadDraftKey, JSON.stringify(config));
    rememberGamepadProfile(onboard.config, transport);
    stageGamepadChange(config, onboard.config);
    return true;
  });
  showToast(staged ? "Gamepad settings staged for the active profile." : "The onboard gamepad already matches this backup.");
}
