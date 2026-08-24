"use strict";

/**
 * AE64 Pro Control — writes and profiles.
 *
 * Loaded as an ordered classic script. Top-level declarations are shared
 * with the other application files; keep the order in index.html intact.
 * Reviews staged changes, performs verified writes, switches profiles, and imports or exports JSON.
 */

function summarizeChanges() {
  const changes = [],
    names = (ids) => {
      const labels = [...ids]
        .map((id) => keys[Number(String(id).split(":").at(-1))]?.n)
        .filter(Boolean);
      return labels.length <= 5
        ? labels.join(", ")
        : `${labels.slice(0, 5).join(", ")} +${labels.length - 5} more`;
    };
  if (state.dirty.performance.size)
    changes.push(
      `Performance settings: ${state.dirty.performance.size} key${state.dirty.performance.size === 1 ? "" : "s"} (${names(state.dirty.performance)})`,
    );
  if (state.dirty.mapping.size)
    changes.push(
      `Key assignments: ${state.dirty.mapping.size} mapping${state.dirty.mapping.size === 1 ? "" : "s"} (${names(state.dirty.mapping)})`,
    );
  if (state.dirty.lightingBase) {
    const base = state.profile.lighting.base,
      reported = lightingModeCount(0, AE64_MAIN_MODE_COUNT),
      experimental = Number(base.mode) >= reported ? " · experimental" : "";
    changes.push(
      `Main RGB: L${Number(base.mode) + 1}${experimental}, ${base.brightness}% brightness, ${base.speed}% speed, north ${Number(base.openMode) & LIGHTING_OPEN_MODE.UPPER ? "on" : "off"}, south ${Number(base.openMode) & LIGHTING_OPEN_MODE.LOWER ? "on" : "off"}`,
    );
  }
  if (state.dirty.lightingPalette)
    changes.push("Main RGB: eight-color palette");
  if (state.dirty.customLighting.size)
    changes.push(
      `Per-key RGB: ${state.dirty.customLighting.size} LED override${state.dirty.customLighting.size === 1 ? "" : "s"}`,
    );
  if (state.dirty.decorativeBase) {
    const base = state.profile.lighting.decorative.base;
    changes.push(
      `Decorative1: L${Number(base.mode) + 1}, ${base.brightness}% brightness, ${base.speed}% speed`,
    );
  }
  if (state.dirty.decorativePalette)
    changes.push("Decorative1: eight-color palette");
  if (state.dirty.decorativeLighting.size)
    changes.push(
      `Decorative1: ${state.dirty.decorativeLighting.size} perimeter LED override${state.dirty.decorativeLighting.size === 1 ? "" : "s"}`,
    );
  for (const field of state.dirty.settings) {
    const value = state.profile.settings[field];
    if (field === "systemMode")
      changes.push(
        `System mode: ${SYSTEM_MODE_OPTIONS.find((option) => option.value === Number(value))?.label || `value ${value}`}`,
      );
    if (field === "reportRate")
      changes.push(
        `Polling rate: ${(POLLING_RATE_OPTIONS.find((option) => option.value === Number(value))?.hz || value).toLocaleString()} Hz`,
      );
    if (field === "sleepTime")
      changes.push(
        `RGB sleep: ${value} minute${Number(value) === 1 ? "" : "s"}`,
      );
    if (field === "shake")
      changes.push(`Shake optimization: ${value ? "on" : "off"}`);
  }
  return changes;
}
function openDialog(dialog) {
  if (typeof dialog?.showModal === "function") dialog.showModal();
  else dialog?.setAttribute?.("open", "");
}
function closeDialog(dialog) {
  if (typeof dialog?.close === "function") dialog.close();
  else dialog?.removeAttribute?.("open");
}
function requestApplyChanges() {
  if (!dirtyCount()) return;
  if (!connected())
    return showToast(
      "Connect the AE64 Pro before applying changes. Staged changes have not been cleared.",
      true,
    );
  const dialog = document.querySelector("#applyReviewDialog"),
    list = document.querySelector("#applyReviewList");
  list.innerHTML = summarizeChanges()
    .map((change) => `<li>${esc(change)}</li>`)
    .join("");
  openDialog(dialog);
}

async function applyChanges() {
  if (!dirtyCount()) return;
  if (!connected())
    return showToast(
      "The keyboard disconnected before writing. Staged changes are still available.",
      true,
    );
  stopPolling();
  showProgress(
    "Applying staged changes",
    "Reading existing records and preserving firmware-owned fields.",
  );
  try {
    const performanceIds = [...state.dirty.performance];
    for (let index = 0; index < performanceIds.length; index += 1) {
      const id = performanceIds[index],
        key = keys[id];
      document.querySelector("#progressDetail").textContent =
        `Performance ${index + 1} of ${performanceIds.length}: ${key.n}`;
      const current =
        state.hardware.performance.get(id) ||
        (await state.transport.getPerformance(position(key)));
      const desired = {
        ...current,
        ...state.profile.performance[id],
        axis: current.axis,
        calibrate: current.calibrate,
        axisV2Id: current.axisV2Id,
        axisRangeMax: current.axisRangeMax,
        axisCoefficient: current.axisCoefficient,
      };
      await state.transport.setPerformance(position(key), desired);
      const verified = await state.transport.getPerformance(position(key));
      if (!verifyPerformance(desired, verified))
        throw new Error(`Performance verification failed for ${key.n}.`);
      state.profile.performance[id] = verified;
      state.hardware.performance.set(id, verified);
    }
    if (performanceIds.length)
      await state.transport.saveParameters(SAVE_GROUP.PERFORMANCE);
    const mappingTokens = [...state.dirty.mapping];
    for (let index = 0; index < mappingTokens.length; index += 1) {
      const [layer, id] = mappingTokens[index].split(":").map(Number),
        key = keys[id],
        expected = state.profile.keycodes[layer][id];
      document.querySelector("#progressDetail").textContent =
        `Key mapping ${index + 1} of ${mappingTokens.length}: ${key.n}`;
      await state.transport.setKeyCode(position(key), expected, layer);
      const verified = await state.transport.getKeyCode(position(key), layer);
      if (verified.keycode !== expected)
        throw new Error(`Mapping verification failed for ${key.n}.`);
      state.hardware.keycodes.set(`${layer}:${id}`, expected);
    }
    if (mappingTokens.length)
      await state.transport.saveParameters(SAVE_GROUP.LAYOUT);
    if (state.dirty.lightingBase || state.dirty.lightingPalette) {
      if (state.dirty.lightingBase) {
        await state.transport.setLightingBase(state.profile.lighting.base, 0);
        const verified = await state.transport.getLightingBase(0);
        if (!verifyLightingBase(state.profile.lighting.base, verified)) {
          const expectedMode = Number(state.profile.lighting.base.mode),
            reported = lightingModeCount(0, AE64_MAIN_MODE_COUNT);
          if (
            expectedMode >= reported &&
            Number(verified.mode) !== expectedMode
          )
            throw new Error(
              `Firmware rejected experimental L${expectedMode + 1}; it read back L${Number(verified.mode) + 1}.`,
            );
          throw new Error("Main lighting read-back verification failed.");
        }
        state.profile.lighting.base = {
          ...state.profile.lighting.base,
          ...verified,
        };
      }
      if (state.dirty.lightingPalette)
        await state.transport.setLightingPalette(
          state.profile.lighting.palette.map(hexToRgb),
          0,
        );
      await state.transport.saveParameters(SAVE_GROUP.LIGHTING);
    }
    if (state.dirty.customLighting.size) {
      if (!state.hardware.customMatrix)
        state.hardware.customMatrix = await state.transport.readCustomLighting(
          MATRIX_ROWS,
          MATRIX_COLS,
          0,
        );
      for (const id of state.dirty.customLighting) {
        const key = keys[id],
          color = hexToRgb(state.profile.lighting.perKey[id]);
        color.custom = Boolean(state.profile.lighting.customEnabled[id]);
        state.hardware.customMatrix[key.row * MATRIX_COLS + key.col] = color;
      }
      await state.transport.writeCustomLighting(
        state.hardware.customMatrix,
        MATRIX_ROWS,
        MATRIX_COLS,
        0,
      );
      await state.transport.saveParameters(SAVE_GROUP.LIGHTING);
      const id = [...state.dirty.customLighting][0],
        key = keys[id],
        matrixIndex = key.row * MATRIX_COLS + key.col,
        packet = await state.transport.getCustomLightingPacket(
          Math.floor(matrixIndex / 15),
          0,
        ),
        verified = packet[matrixIndex % 15];
      if (
        rgbToHex(verified) !==
          state.profile.lighting.perKey[id].toLowerCase() ||
        Boolean(verified.custom) !==
          Boolean(state.profile.lighting.customEnabled[id])
      )
        throw new Error(`Custom lighting verification failed for ${key.n}.`);
    }
    if (state.dirty.decorativeBase || state.dirty.decorativePalette) {
      const decorative = state.profile.lighting.decorative;
      if (state.dirty.decorativeBase) {
        await state.transport.setLightingBase(decorative.base, 1);
        const verified = await state.transport.getLightingBase(1);
        if (!verifyLightingBase(decorative.base, verified))
          throw new Error("Decorative1 base read-back verification failed.");
        decorative.base = { ...decorative.base, ...verified };
      }
      if (state.dirty.decorativePalette)
        await state.transport.setLightingPalette(
          decorative.palette.map(hexToRgb),
          1,
        );
      await state.transport.saveParameters(SAVE_GROUP.LIGHTING);
    }
    if (state.dirty.decorativeLighting.size) {
      const decorative = state.profile.lighting.decorative;
      if (!state.hardware.decorativeMatrix)
        state.hardware.decorativeMatrix =
          await state.transport.readCustomLighting(
            DECORATIVE_ROWS,
            DECORATIVE_COLS,
            1,
          );
      for (const index of state.dirty.decorativeLighting) {
        const color = hexToRgb(decorative.perLed[index]);
        color.custom = Boolean(decorative.customEnabled[index]);
        state.hardware.decorativeMatrix[index] = color;
      }
      await state.transport.writeCustomLighting(
        state.hardware.decorativeMatrix,
        DECORATIVE_ROWS,
        DECORATIVE_COLS,
        1,
      );
      await state.transport.saveParameters(SAVE_GROUP.LIGHTING);
      const index = [...state.dirty.decorativeLighting][0],
        packet = await state.transport.getCustomLightingPacket(
          Math.floor(index / 15),
          1,
        ),
        verified = packet[index % 15];
      if (
        rgbToHex(verified) !== decorative.perLed[index].toLowerCase() ||
        Boolean(verified.custom) !== Boolean(decorative.customEnabled[index])
      )
        throw new Error(`Decorative1 verification failed for LED ${index}.`);
    }
    for (const field of state.dirty.settings) {
      if (field === "systemMode")
        await state.transport.setSystemMode(state.profile.settings[field]);
      if (field === "reportRate")
        await state.transport.setReportRate(state.profile.settings[field]);
      if (field === "sleepTime")
        await state.transport.setLightingSleepTime(
          state.profile.settings[field],
        );
      if (field === "shake")
        await state.transport.setShakeOptimization(
          state.profile.settings[field],
        );
    }
    state.original = clone(state.profile);
    clearDirty();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.profile));
    log("Staged changes applied and verified");
    render();
    showToast("Changes written, committed, and verified on the AE64 Pro.");
  } catch (error) {
    log("Apply failed", error.message);
    renderStatus();
    showToast(`Apply stopped: ${error.message}`, true);
  } finally {
    hideProgress();
    if (state.page === "lighting" && state.liveLighting && connected())
      startLightingLive();
  }
}

function revertChanges() {
  state.profile = clone(state.original);
  clearDirty();
  render();
  showToast("Staged changes reverted.");
}
async function switchProfile(index) {
  if (dirtyCount()) {
    showToast("Apply or revert changes before switching profiles.", true);
    renderToolbar();
    return;
  }
  if (connected()) {
    stopPolling();
    showProgress("Switching profile", `Loading profile ${index + 1}.`);
    try {
      await state.transport.switchConfig(index);
      state.profile.profileIndex = index;
      const [lightingBase, palette, decorativeBase, decorativePalette] =
        await Promise.all([
          state.transport.getLightingBase(0),
          state.transport.getLightingPalette(0),
          state.transport.getLightingBase(1),
          state.transport.getLightingPalette(1),
        ]);
      state.profile.lighting.base = {
        ...state.profile.lighting.base,
        ...lightingBase,
      };
      state.profile.lighting.palette = palette.map(rgbToHex);
      state.profile.lighting.decorative.base = {
        ...state.profile.lighting.decorative.base,
        ...decorativeBase,
      };
      state.profile.lighting.decorative.palette =
        decorativePalette.map(rgbToHex);
      keys.forEach((key) => {
        state.profile.lighting.customEnabled[key.id] = false;
      });
      state.profile.lighting.decorative.customEnabled.fill(false);
      Object.assign(state.hardware, {
        customMatrix: null,
        decorativeMatrix: null,
        liveMatrix: null,
        liveStrip: null,
      });
      await readSelectedKey();
      state.original = clone(state.profile);
      log("Profile switched", index);
      showToast(
        `Profile ${index + 1} loaded. Live RGB readback has restarted.`,
      );
    } catch (error) {
      showToast(error.message, true);
    } finally {
      hideProgress();
      render();
    }
  } else {
    state.profile.profileIndex = index;
    state.original = clone(state.profile);
    render();
  }
}
async function renameProfile(name) {
  name = String(name || "").trim();
  if (!name) {
    showToast("Profile name cannot be empty.", true);
    return false;
  }
  if (!connected()) {
    showToast("Connect to rename an onboard profile.", true);
    return false;
  }
  try {
    await state.transport.setConfigName(state.profile.profileIndex, name);
    const verified = await state.transport.getConfigName(
      state.profile.profileIndex,
    );
    state.hardware.configNames[state.profile.profileIndex] = verified;
    render();
    showToast(`Profile renamed to ${verified}.`);
    return true;
  } catch (error) {
    showToast(error.message, true);
    return false;
  }
}
async function saveProfileName() {
  return renameProfile(document.querySelector("#profileName").value);
}
function openProfileRename() {
  if (!connected())
    return showToast("Connect to rename an onboard profile.", true);
  const input = document.querySelector("#quickProfileName");
  input.value =
    state.hardware.configNames[state.profile.profileIndex] ||
    `Profile ${state.profile.profileIndex + 1}`;
  openDialog(document.querySelector("#profileRenameDialog"));
  input.focus();
}

function downloadJson(filename, value) {
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    ),
    link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
function exportProfile() {
  downloadJson("ae64-pro-profile.json", {
    format: "ae64-control-profile",
    version: 1,
    device: { vendorId: "1CA6", productId: "300A" },
    exportedAt: new Date().toISOString(),
    profile: state.profile,
  });
  showToast("Profile exported.");
}
function exportLog() {
  downloadJson("ae64-pro-session-log.json", {
    device: state.hardware.info,
    logs: state.hardware.logs,
  });
  showToast("Session log exported.");
}
async function importProfile(file) {
  try {
    const data = JSON.parse(await file.text()),
      imported = data.profile || data;
    if (!imported.performance || !imported.keycodes || !imported.lighting)
      throw new Error("Not an AE64 Control profile.");
    const base = defaultProfile();
    state.profile = {
      ...base,
      ...imported,
      schema: base.schema,
      performance: { ...base.performance, ...imported.performance },
      keycodes: Object.fromEntries(
        Array.from({ length: 4 }, (_, i) => [
          i,
          { ...base.keycodes[i], ...imported.keycodes?.[i] },
        ]),
      ),
      lighting: {
        ...base.lighting,
        ...imported.lighting,
        base: { ...base.lighting.base, ...imported.lighting.base },
        perKey: { ...base.lighting.perKey, ...imported.lighting.perKey },
        customEnabled: {
          ...base.lighting.customEnabled,
          ...imported.lighting.customEnabled,
        },
        decorative: mergeDecorative(
          base.lighting.decorative,
          imported.lighting.decorative,
        ),
      },
    };
    keys.forEach((key) => {
      state.dirty.performance.add(key.id);
      state.dirty.customLighting.add(key.id);
      for (let layer = 0; layer < 4; layer += 1)
        state.dirty.mapping.add(`${layer}:${key.id}`);
    });
    for (let index = 0; index < DECORATIVE_COLS; index += 1)
      state.dirty.decorativeLighting.add(index);
    state.dirty.lightingBase = true;
    state.dirty.lightingPalette = true;
    state.dirty.decorativeBase = true;
    state.dirty.decorativePalette = true;
    render();
    showToast("Profile imported and staged. Review before applying.");
  } catch (error) {
    showToast(`Import failed: ${error.message}`, true);
  }
}
