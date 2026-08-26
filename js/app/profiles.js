"use strict";

/**
 * AE64 Pro Control — writes and profiles.
 *
 * Loaded as an ordered classic script. Top-level declarations are shared
 * with the other application files; keep the order in index.html intact.
 * Reviews staged changes, performs verified writes, switches profiles, and imports or exports JSON.
 */

const AUTO_APPLY_KEY = "ae64-control-auto-apply-v1";
Object.assign(state, {
  autoApply: localStorage.getItem(AUTO_APPLY_KEY) === "true",
  writeInFlight: false,
});
state.timers.autoApply = null;

function toggleAdvancedRemoval(value) {
  const ids = String(value).split(",").map(Number)
      .filter((id) => keys.some((key) => key.id === id)),
    expanded = new Set(ids);
  ids.forEach((id) => {
    const record = state.hardware.advancedByKey.get(id);
    if (![ADVANCED_MODE.SOCD, ADVANCED_MODE.RS].includes(Number(record?.mode))) return;
    const partner = keyAtFirmwarePosition(record.pairedRow, record.pairedCol);
    if (partner) expanded.add(partner.id);
  });
  if (!expanded.size) return;
  const resolved = [...expanded],
    undo = resolved.every((id) => state.dirty.advancedRemovals.has(id));
  if (undo) resolved.forEach((id) => state.dirty.advancedRemovals.delete(id));
  else {
    const stagedKeys = advancedDraftKeyIds(state.advancedDraft);
    if (state.dirty.advanced && resolved.every((id) => stagedKeys.includes(id)) && stagedKeys.every((id) => resolved.includes(id))) {
      state.dirty.advanced = false;
      render();
      showToast("Staged advanced assignment discarded.");
      return;
    }
    resolved.forEach((id) => {
      if (state.hardware.advancedByKey.has(id)) state.dirty.advancedRemovals.add(id);
    });
  }
  render();
  showToast(undo
    ? "Advanced assignment removal canceled."
    : state.dirty.advancedRemovals.size
      ? "Advanced assignment removal staged. Apply changes to write it."
      : "Staged advanced assignment discarded.");
}

function scheduleAutoApply() {
  clearTimeout(state.timers.autoApply);
  state.timers.autoApply = null;
  if (
    !state.autoApply ||
    state.writeInFlight ||
    !connected() ||
    !dirtyCount()
  )
    return;
  state.timers.autoApply = setTimeout(flushAutoApply, 350);
}
async function flushAutoApply() {
  state.timers.autoApply = null;
  if (
    !state.autoApply ||
    state.writeInFlight ||
    !connected() ||
    !dirtyCount()
  )
    return false;
  return applyChanges({ automatic: true });
}
function setAutoApply(enabled) {
  state.autoApply = Boolean(enabled);
  localStorage.setItem(AUTO_APPLY_KEY, String(state.autoApply));
  if (!state.autoApply) {
    clearTimeout(state.timers.autoApply);
    state.timers.autoApply = null;
  }
  renderStatus();
  showToast(
    state.autoApply
      ? connected()
        ? "Experimental auto apply enabled. Completed edits will write automatically."
        : "Experimental auto apply enabled. Connect the keyboard before editing."
      : "Auto apply disabled. Changes will remain staged until Apply.",
  );
}

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
  if (state.switchAssignmentKeys.size) {
    const assignments = new Map();
    [...state.switchAssignmentKeys].forEach((id) => {
      const performance = state.profile.performance[id],
        profile = switchCatalogEntry(performance.axisV2Id),
        label = profile?.name || `Axis ${performance.axisV2Id}`;
      assignments.set(label, (assignments.get(label) || 0) + 1);
    });
    changes.push(
      `Magnetic switch: ${[...assignments].map(([label, count]) => `${label} (${count} key${count === 1 ? "" : "s"})`).join(", ")}`,
    );
  }
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
  if (state.dirty.advanced) {
    const draft = state.advancedDraft;
    if (draft.feature === "MPT") changes.push(`MPT: ${keys[Number(draft.hostId)]?.n || "host key"}, ${multipointDraftDetails(draft)}`);
    else {
      const keyA = keys[draft.keyAId],
      keyB = keys[draft.keyBId],
      feature = draft.feature === "RS" ? "RS" : "SOCD",
      behavior = feature === "RS" ? "deeper key wins" : SOCD_MODES[Number(draft.socdMode)]?.name || `mode ${draft.socdMode}`;
      changes.push(`${feature}: ${keyA?.n || "Key A"} + ${keyB?.n || "Key B"}, ${behavior}, ${Number(draft.delay) || 0} ms delay`);
    }
  }
  if (state.dirty.advancedRemovals.size)
    changes.push(
      `Remove advanced assignments from ${state.dirty.advancedRemovals.size} key${state.dirty.advancedRemovals.size === 1 ? "" : "s"} (${names(state.dirty.advancedRemovals)})`,
    );
  for (const field of state.dirty.settings) {
    const value = state.profile.settings[field];
    if (field === "systemMode")
      changes.push(
        `System mode: ${SYSTEM_MODE_OPTIONS.find((option) => option.value === Number(value))?.label || `value ${value}`}`,
      );
    if (field === "reportRate")
      changes.push(
        `Polling rate: ${(POLLING_RATE_OPTIONS.find((option) => option.value === Number(value))?.hz || value).toLocaleString()} Hz (keyboard reconnect required)`,
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

async function applyChanges({ automatic = false } = {}) {
  if (!dirtyCount()) return false;
  if (!connected()) {
    showToast(
      "The keyboard disconnected before writing. Staged changes are still available.",
      true,
    );
    return false;
  }
  state.writeInFlight = true;
  renderStatus();
  stopPolling();
  showProgress(
    automatic ? "Auto applying changes" : "Applying staged changes",
    "Reading existing records and preserving firmware-owned fields.",
  );
  try {
    const performanceIds = [...state.dirty.performance],
      performanceNormalizations = [];
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
        ...(state.switchAssignmentKeys.has(id)
          ? {}
          : {
              axisV2Id: current.axisV2Id,
              axisRangeMax: current.axisRangeMax,
              axisCoefficient: current.axisCoefficient,
            }),
      };
      await state.transport.setPerformance(position(key), desired);
      const verified = await state.transport.getPerformance(position(key)),
        comparison = performanceReadbackComparison(
          desired,
          verified,
          state.switchAssignmentKeys.has(id),
        );
      if (!comparison.valid)
        throw new Error(
          `Performance verification failed for ${key.n}: ${comparison.hard.join(", ")}.`,
        );
      if (comparison.normalized.length) {
        const warning = `${key.n}: ${comparison.normalized.join(", ")}`;
        performanceNormalizations.push(warning);
        log("Firmware normalized performance read-back", warning);
      }
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
    const advancedRemovalKeys = [...state.dirty.advancedRemovals]
      .map((id) => keys[Number(id)])
      .filter(Boolean);
    if (advancedRemovalKeys.length) {
      const tuningSnapshots = new Map();
      for (let index = 0; index < advancedRemovalKeys.length; index += 1) {
        const key = advancedRemovalKeys[index];
        document.querySelector("#progressDetail").textContent =
          `Removing advanced assignment ${index + 1} of ${advancedRemovalKeys.length}: ${key.n}`;
        tuningSnapshots.set(
          key.id,
          await state.transport.getPerformance(position(key)),
        );
        await state.transport.clearAdvancedKey(position(key));
        const verified = await state.transport.getAdvancedKey(position(key));
        if (Number(verified.mode) !== ADVANCED_MODE.NONE)
          throw new Error(`Advanced removal verification failed for ${key.n}.`);
        state.hardware.advancedByKey.delete(key.id);
      }
      await state.transport.saveParameters(SAVE_GROUP.ADVANCED);
      for (const key of advancedRemovalKeys) {
        const expected = tuningSnapshots.get(key.id),
          current = await state.transport.getPerformance(position(key)),
          desired = {
            ...current,
            ...expected,
            axis: current.axis,
            calibrate: current.calibrate,
          };
        await state.transport.setPerformance(position(key), desired);
        const restored = await state.transport.getPerformance(position(key)),
          comparison = performanceReadbackComparison(desired, restored, true);
        if (!comparison.valid)
          throw new Error(
            `Advanced assignment was removed but ${key.n} tuning could not be restored: ${comparison.hard.join(", ")}.`,
          );
        if (comparison.normalized.length) {
          const warning = `${key.n}: ${comparison.normalized.join(", ")}`;
          performanceNormalizations.push(warning);
          log("Firmware normalized advanced-removal Hall read-back", warning);
        }
        state.profile.performance[key.id] = restored;
        state.hardware.performance.set(key.id, restored);
      }
      await state.transport.saveParameters(SAVE_GROUP.PERFORMANCE);
      const selectedAdvancedKey = keys.find((key) => {
        const address = position(key);
        return (
          Number(address.row) === Number(state.hardware.advanced?.row) &&
          Number(address.col) === Number(state.hardware.advanced?.col)
        );
      });
      if (selectedAdvancedKey && state.dirty.advancedRemovals.has(selectedAdvancedKey.id))
        state.hardware.advanced = null;
    }
    if (state.dirty.advanced) {
      const draft = state.advancedDraft;
      if (draft.feature === "MPT") await applyMultipointDraft(draft, performanceNormalizations);
      else {
        const keyA = keys[draft.keyAId],
        keyB = keys[draft.keyBId],
        feature = draft.feature === "RS" ? "RS" : "SOCD",
        advancedMode = feature === "RS" ? ADVANCED_MODE.RS : ADVANCED_MODE.SOCD;
      if (!keyA || !keyB || keyA.id === keyB.id)
        throw new Error(`${feature} requires two different physical keys.`);
      document.querySelector("#progressDetail").textContent =
        `${feature}: checking ${keyA.n} and ${keyB.n}`;
      const firstPosition = position(keyA),
        secondPosition = position(keyB),
        [currentA, currentB, tuningA, tuningB] = await Promise.all([
          state.transport.getAdvancedKey(firstPosition),
          state.transport.getAdvancedKey(secondPosition),
          state.transport.getPerformance(firstPosition),
          state.transport.getPerformance(secondPosition),
        ]),
        pairedWith = (record, target) =>
          Number(record.pairedRow) === Number(target.row) &&
          Number(record.pairedCol) === Number(target.col),
        compatible = (record, target) =>
          Number(record.mode) === ADVANCED_MODE.NONE ||
          (Number(record.mode) === advancedMode && pairedWith(record, target));
      if (!compatible(currentA, secondPosition))
        throw new Error(`${keyA.n} already has another advanced assignment. Clear it before creating this ${feature} pair.`);
      if (!compatible(currentB, firstPosition))
        throw new Error(`${keyB.n} already has another advanced assignment. Clear it before creating this ${feature} pair.`);
      const keycodes = Array.isArray(draft.keycodes)
          ? draft.keycodes
          : [displayedKeycode(keyA, 0), displayedKeycode(keyB, 0)],
        socdMode = Number(draft.socdMode),
        delay = Math.round(clamp(draft.delay, 0, 50));
      if (feature === "RS")
        await state.transport.setRappySnappyPair({ first: firstPosition, second: secondPosition, keycodes, delay });
      else
        await state.transport.setSocdPair({ first: firstPosition, second: secondPosition, keycodes, delay, mode: socdMode });
      await state.transport.saveParameters(SAVE_GROUP.ADVANCED);
      const [verifiedA, verifiedB] = await Promise.all([
          state.transport.getAdvancedKey(firstPosition),
          state.transport.getAdvancedKey(secondPosition),
        ]),
        pairModes = SOCD_PAIR_MODES[socdMode],
        verified =
          verifiedA.mode === advancedMode &&
          verifiedB.mode === advancedMode &&
          pairedWith(verifiedA, secondPosition) &&
          pairedWith(verifiedB, firstPosition) &&
          (feature === "RS" || (verifiedA.socdMode === pairModes[0] && verifiedB.socdMode === pairModes[1])) &&
          verifiedA.delay === delay &&
          verifiedB.delay === delay &&
          verifiedA.keycodes[0] === keycodes[0] &&
          verifiedA.keycodes[1] === keycodes[1] &&
          verifiedB.keycodes[0] === keycodes[1] &&
          verifiedB.keycodes[1] === keycodes[0];
      if (!verified) throw new Error(`${feature} read-back verification failed.`);
      state.hardware.advanced = verifiedA;
      state.hardware.advancedByKey.set(keyA.id, verifiedA);
      state.hardware.advancedByKey.set(keyB.id, verifiedB);
      state.advancedDraft = { ...draft, feature, delay, socdMode, keycodes: [...keycodes] };
      document.querySelector("#progressDetail").textContent =
        `${feature}: restoring Hall tuning for ${keyA.n} and ${keyB.n}`;
      for (const key of [keyA, keyB]) {
        const expected = key.id === keyA.id ? tuningA : tuningB,
          current = await state.transport.getPerformance(position(key)),
          desired = {
            ...current,
            ...expected,
            axis: current.axis,
            calibrate: current.calibrate,
          };
        await state.transport.setPerformance(position(key), desired);
        const restored = await state.transport.getPerformance(position(key)),
          comparison = performanceReadbackComparison(desired, restored, true);
        if (!comparison.valid)
          throw new Error(
            `${feature} preserved the pair but could not restore ${key.n} tuning: ${comparison.hard.join(", ")}.`,
          );
        if (comparison.normalized.length) {
          const warning = `${key.n}: ${comparison.normalized.join(", ")}`;
          performanceNormalizations.push(warning);
          log(`Firmware normalized ${feature} Hall read-back`, warning);
        }
        state.profile.performance[key.id] = restored;
        state.hardware.performance.set(key.id, restored);
      }
      await state.transport.saveParameters(SAVE_GROUP.PERFORMANCE);
      }
    }
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
    const settingsToWrite = [...state.dirty.settings],
      pollingRateChanged = settingsToWrite.includes("reportRate");
    for (const field of settingsToWrite.filter((field) => field !== "reportRate")) {
      if (field === "systemMode")
        await state.transport.setSystemMode(state.profile.settings[field]);
      if (field === "sleepTime")
        await state.transport.setLightingSleepTime(
          state.profile.settings[field],
        );
      if (field === "shake")
        await state.transport.setShakeOptimization(
          state.profile.settings[field],
        );
    }
    // The controller restarts its HID interface immediately after this write.
    // Keep it last, then close our old session instead of issuing any stale
    // commands while the keyboard re-enumerates.
    if (pollingRateChanged)
      await state.transport.setReportRate(state.profile.settings.reportRate);
    state.original = clone(state.profile);
    clearDirty();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.profile));
    if (pollingRateChanged) {
      const transport = state.transport;
      state.transport = null;
      await transport.close().catch((error) =>
        log("Polling-rate session close failed", error.message),
      );
      log("Polling rate changed; reconnect required");
      await reconnectAfterPollingRateChange();
      return true;
    }
    log("Staged changes applied and verified");
    render();
    const normalizationNote = performanceNormalizations.length
      ? ` Firmware normalized ${performanceNormalizations.length} key${performanceNormalizations.length === 1 ? "" : "s"}: ${performanceNormalizations.slice(0, 2).join("; ")}${performanceNormalizations.length > 2 ? `; +${performanceNormalizations.length - 2} more` : ""}.`
      : "";
    showToast(
      `${automatic ? "Auto apply wrote and verified the completed edit." : "Changes written, committed, and verified on the AE64 Pro."}${normalizationNote}`,
    );
    return true;
  } catch (error) {
    log("Apply failed", error.message);
    if (automatic) {
      state.autoApply = false;
      localStorage.setItem(AUTO_APPLY_KEY, "false");
    }
    showToast(
      `${automatic ? "Auto apply was disabled" : "Apply stopped"}: ${error.message}`,
      true,
    );
    return false;
  } finally {
    state.writeInFlight = false;
    hideProgress();
    renderStatus();
    if (state.page === "lighting" && state.liveLighting && connected())
      startLightingLive();
  }
}

function revertChanges() {
  clearTimeout(state.timers.autoApply);
  state.timers.autoApply = null;
  state.profile = clone(state.original);
  state.advancedDraft = defaultSocdDraft();
  if (Number(state.hardware.advanced?.mode) === ADVANCED_MODE.MPT) {
    const record = state.hardware.advanced,
      host = keys.find((key) => { const address = position(key); return address.row === record.row && address.col === record.col; });
    if (host) state.advancedDraft = multipointDraftFromRecord(host, record);
  } else if ([ADVANCED_MODE.SOCD, ADVANCED_MODE.RS].includes(Number(state.hardware.advanced?.mode))) {
    const record = state.hardware.advanced,
      first = keys.find((key) => {
        const address = position(key);
        return address.row === record.row && address.col === record.col;
      }),
      second = keys.find((key) => {
        const address = position(key);
        return address.row === record.pairedRow && address.col === record.pairedCol;
      });
    if (first && second)
      state.advancedDraft = {
        feature: record.mode === ADVANCED_MODE.RS ? "RS" : "SOCD",
        keyAId: first.id,
        keyBId: second.id,
        delay: record.delay,
        socdMode: record.mode === ADVANCED_MODE.SOCD ? record.socdMode : SOCD_MODE.LAST_OVERRIDE,
        keycodes: [...record.keycodes],
      };
  }
  clearDirty();
  render();
  showToast("Staged changes reverted.");
}
async function reloadProfileFromDevice(index) {
  state.profile.profileIndex = index;
  state.hardware.advanced = null;
  state.hardware.advancedByKey.clear();
  state.advancedDraft = defaultSocdDraft();
  state.hardware.keycodes.clear();
  state.hardware.performance.clear();
  state.switchAssignmentsStatus = "idle";
  state.switchAssignmentsError = "";
  const [lightingBase, palette, decorativeBase, decorativePalette] =
    await Promise.all([
      state.transport.getLightingBase(0),
      state.transport.getLightingPalette(0),
      state.transport.getLightingBase(1),
      state.transport.getLightingPalette(1),
    ]);
  state.profile.lighting.base = { ...state.profile.lighting.base, ...lightingBase };
  state.profile.lighting.palette = palette.map(rgbToHex);
  state.profile.lighting.decorative.base = {
    ...state.profile.lighting.decorative.base,
    ...decorativeBase,
  };
  state.profile.lighting.decorative.palette = decorativePalette.map(rgbToHex);
  keys.forEach((key) => { state.profile.lighting.customEnabled[key.id] = false; });
  state.profile.lighting.decorative.customEnabled.fill(false);
  Object.assign(state.hardware, {
    customMatrix: null, decorativeMatrix: null, liveMatrix: null, liveStrip: null,
  });
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
  maybeShowCalibrationRecommendation();
}
async function switchProfile(index) {
  if (state.calibrationActive || state.calibrationBusy) await stopCalibration(true);
  if (dirtyCount()) {
    showToast("Apply or revert changes before switching profiles.", true);
    renderToolbar();
    return;
  }
  if (connected()) {
    stopPolling();
    stopProfilePolling();
    showProgress("Switching profile", `Loading profile ${index + 1}.`);
    try {
      await state.transport.switchConfig(index);
      await reloadProfileFromDevice(index);
      log("Profile switched", index);
      showToast(
        `Profile ${index + 1} loaded. Live RGB readback has restarted.`,
      );
    } catch (error) {
      showToast(error.message, true);
    } finally {
      hideProgress();
      render();
      startProfilePolling();
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
      combinationBases: {
        ...base.combinationBases,
        ...imported.combinationBases,
      },
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
    showToast(
      state.autoApply
        ? "Profile imported. Experimental auto apply will write it now."
        : "Profile imported and staged. Review before applying.",
    );
  } catch (error) {
    showToast(`Import failed: ${error.message}`, true);
  }
}
