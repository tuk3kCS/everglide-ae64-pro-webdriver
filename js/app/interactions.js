"use strict";

/**
 * AE64 Pro Control — page interactions.
 *
 * Loaded as an ordered classic script. Top-level declarations are shared
 * with the other application files; keep the order in index.html intact.
 * Stages form edits and binds controls created by the active page renderer.
 */

function stagePerformance(field, value) {
  selectedKeyIds().forEach((id) => {
    state.profile.performance[id][field] = value;
    state.dirty.performance.add(id);
  });
  renderStatus();
}
function stageSetting(field, value) {
  state.profile.settings[field] = value;
  state.dirty.settings.add(field);
  renderStatus();
}
function bindNumberPair(id, field) {
  const number = document.querySelector(`#${id}`),
    range = document.querySelector(`[data-range-for="${id}"]`);
  if (!number || !range) return;
  const update = (source, other) => {
    const value = clamp(source.value, Number(source.min), Number(source.max));
    other.value = value;
    stagePerformance(field, value);
  };
  number.addEventListener("input", () => update(number, range));
  range.addEventListener("input", () => update(range, number));
}
async function selectMappingLayer(layer) {
  const resolvedLayer = Number(layer);
  if (!Number.isInteger(resolvedLayer) || resolvedLayer < 0 || resolvedLayer > 3)
    return;
  state.profile.layer = resolvedLayer;
  if (connected()) {
    showProgress(
      `Reading ${resolvedLayer ? `Fn${resolvedLayer}` : "Main"}`,
      "Loading all 64 physical key assignments from the keyboard.",
    );
    try {
      await readKeymapLayer(resolvedLayer);
    } catch (error) {
      showToast(error.message, true);
    } finally {
      hideProgress();
    }
  }
  syncCombinationEditor();
  render();
}

function refreshLightingSelection() {
  document
    .querySelectorAll(".unified-lighting-preview [data-key]")
    .forEach((node) => {
      const selected =
        state.lightingTab === "perKey" &&
        state.lightingSelectedKeys.has(Number(node.dataset.key));
      node.classList.toggle("selected", selected);
      node.setAttribute("aria-pressed", String(selected));
    });
  document
    .querySelectorAll(".unified-lighting-preview [data-strip-led]")
    .forEach((node) => {
      const selected =
        state.lightingTab === "strip" &&
        state.stripSelection.has(Number(node.dataset.stripLed));
      node.classList.toggle("selected", selected);
      node.setAttribute("aria-pressed", String(selected));
    });
  const summary = document.querySelector("#lightingSelectionSummary");
  if (summary) {
    const count =
        state.lightingTab === "perKey"
          ? lightingKeyIds().length
          : stripLedIds().length,
      label =
        state.lightingTab === "perKey"
          ? `key${count === 1 ? "" : "s"}`
          : `LED${count === 1 ? "" : "s"}`;
    summary.innerHTML = `Selected: <b>${count} ${label}</b>`;
  }
}
function refreshKeySelection() {
  document.querySelectorAll(".layout-board [data-key]").forEach((node) => {
    const selected = state.selectedKeys.has(Number(node.dataset.key));
    node.classList.toggle("selected", selected);
    node.setAttribute("aria-pressed", String(selected));
  });
}
function commitKeySelection(selection, primary) {
  if (!selection.size && Number.isInteger(primary)) selection.add(primary);
  state.selectedKeys = selection;
  if (selection.size)
    state.profile.selected = selection.has(primary)
      ? primary
      : [...selection].at(-1);
  refreshKeySelection();
}
function updateKeyMarquee(event) {
  const drag = state.keySelectionDrag;
  if (!drag) return;
  const left = Math.min(drag.startX, event.clientX),
    top = Math.min(drag.startY, event.clientY),
    width = Math.abs(event.clientX - drag.startX),
    height = Math.abs(event.clientY - drag.startY),
    bounds = drag.surface.getBoundingClientRect();
  if (width < 4 && height < 4) return;
  drag.moved = true;
  Object.assign(drag.marquee.style, {
    left: `${left - bounds.left}px`,
    top: `${top - bounds.top}px`,
    width: `${width}px`,
    height: `${height}px`,
  });
  drag.marquee.classList.add("active");
  const inside = [...document.querySelectorAll(".layout-board [data-key]")]
    .filter((node) => {
      const rect = node.getBoundingClientRect(),
        centerX = rect.left + rect.width / 2,
        centerY = rect.top + rect.height / 2;
      return centerX >= left && centerX <= left + width && centerY >= top && centerY <= top + height;
    })
    .map((node) => Number(node.dataset.key));
  commitKeySelection(
    new Set(drag.ctrl ? [...drag.initial, ...inside] : inside),
    drag.startKey,
  );
}
function stopKeySelection() {
  const drag = state.keySelectionDrag;
  if (!drag) return;
  document.removeEventListener("pointermove", updateKeyMarquee);
  document.removeEventListener("pointerup", stopKeySelection);
  document.removeEventListener("pointercancel", stopKeySelection);
  state.keySelectionDrag = null;
  drag.marquee.classList.remove("active");
  if (!drag.moved) {
    if (Number.isInteger(drag.startKey)) {
      const selection = new Set(drag.initial);
      if (drag.ctrl && selection.has(drag.startKey) && selection.size > 1) {
        selection.delete(drag.startKey);
      } else {
        if (!drag.ctrl) selection.clear();
        selection.add(drag.startKey);
      }
      commitKeySelection(selection, drag.startKey);
    } else if (!drag.ctrl) {
      state.selectedKeys.clear();
      refreshKeySelection();
    }
  }
  render();
  if (connected())
    readSelectedKey()
      .then(() => render())
      .catch((error) => showToast(error.message, true));
}
function beginKeySelection(event) {
  if (event.button !== 0 || state.calibrationActive) return;
  event.preventDefault();
  const surface = event.currentTarget,
    startKey = Number(event.target.closest("[data-key]")?.dataset.key);
  state.keySelectionDrag = {
    surface,
    marquee: surface.querySelector(".key-selection-marquee"),
    startX: event.clientX,
    startY: event.clientY,
    startKey: Number.isInteger(startKey) ? startKey : null,
    initial: new Set(state.selectedKeys),
    ctrl: event.ctrlKey,
    moved: false,
  };
  document.addEventListener("pointermove", updateKeyMarquee);
  document.addEventListener("pointerup", stopKeySelection);
  document.addEventListener("pointercancel", stopKeySelection);
}
function bindKeySelection() {
  document
    .querySelectorAll(".layout-board")
    .forEach((node) => node.addEventListener("pointerdown", beginKeySelection));
}
function marqueeSelection(initial, inside, ctrl) {
  if (!ctrl) return new Set(inside);
  const selection = new Set(initial);
  inside.forEach((index) => {
    if (selection.has(index)) selection.delete(index);
    else selection.add(index);
  });
  return selection;
}
function commitLightingSelection(kind, selection, primary) {
  if (kind === "key") {
    state.lightingSelectedKeys = selection;
    if (selection.size) {
      state.profile.selected = selection.has(primary)
        ? primary
        : [...selection].at(-1);
      state.selectedKeys = new Set([state.profile.selected]);
    }
  } else {
    state.stripSelection = selection;
    if (selection.size)
      state.stripSelected = selection.has(primary)
        ? primary
        : [...selection].at(-1);
  }
  refreshLightingSelection();
}
function updateLightingMarquee(event) {
  const drag = state.selectionDrag;
  if (!drag) return;
  const left = Math.min(drag.startX, event.clientX),
    top = Math.min(drag.startY, event.clientY),
    width = Math.abs(event.clientX - drag.startX),
    height = Math.abs(event.clientY - drag.startY),
    bounds = drag.surface.getBoundingClientRect();
  if (width < 4 && height < 4) return;
  drag.moved = true;
  Object.assign(drag.marquee.style, {
    left: `${left - bounds.left + drag.surface.scrollLeft}px`,
    top: `${top - bounds.top + drag.surface.scrollTop}px`,
    width: `${width}px`,
    height: `${height}px`,
  });
  drag.marquee.classList.add("active");
  const inside = [...drag.surface.querySelectorAll(drag.selector)]
    .filter((node) => {
      const rect = node.getBoundingClientRect(),
        centerX = rect.left + rect.width / 2,
        centerY = rect.top + rect.height / 2;
      return (
        centerX >= left &&
        centerX <= left + width &&
        centerY >= top &&
        centerY <= top + height
      );
    })
    .map((node) =>
      Number(drag.kind === "key" ? node.dataset.key : node.dataset.stripLed),
    );
  commitLightingSelection(
    drag.kind,
    marqueeSelection(drag.initial, inside, drag.ctrl),
    drag.startIndex,
  );
}
function stopLightingSelection() {
  const drag = state.selectionDrag;
  if (!drag) return;
  document.removeEventListener("pointermove", updateLightingMarquee);
  document.removeEventListener("pointerup", stopLightingSelection);
  document.removeEventListener("pointercancel", stopLightingSelection);
  state.selectionDrag = null;
  drag.marquee.classList.remove("active");
  if (!drag.moved) {
    const inside = Number.isInteger(drag.startIndex) ? [drag.startIndex] : [];
    commitLightingSelection(
      drag.kind,
      marqueeSelection(drag.initial, inside, drag.ctrl),
      drag.startIndex,
    );
  }
  render();
}
function beginLightingSelection(event) {
  if (event.button !== 0 || !["perKey", "strip"].includes(state.lightingTab))
    return;
  event.preventDefault();
  const surface = event.currentTarget,
    kind = state.lightingTab === "perKey" ? "key" : "strip",
    selector = kind === "key" ? "[data-key]" : "[data-strip-led]",
    startNode = event.target.closest(selector),
    startIndex = startNode
      ? Number(kind === "key" ? startNode.dataset.key : startNode.dataset.stripLed)
      : null,
    initial = new Set(
      kind === "key" ? state.lightingSelectedKeys : state.stripSelection,
    );
  state.selectionDrag = {
    surface,
    marquee: surface.querySelector(".lighting-selection-marquee"),
    kind,
    selector,
    startX: event.clientX,
    startY: event.clientY,
    startIndex: Number.isInteger(startIndex) ? startIndex : null,
    initial,
    ctrl: event.ctrlKey,
    moved: false,
  };
  document.addEventListener("pointermove", updateLightingMarquee);
  document.addEventListener("pointerup", stopLightingSelection);
  document.addEventListener("pointercancel", stopLightingSelection);
}
function bindLightingSelection() {
  if (!["perKey", "strip"].includes(state.lightingTab)) return;
  document
    .querySelector(".unified-preview-scroll")
    ?.addEventListener("pointerdown", beginLightingSelection);
}

function bindPage() {
  if (state.page !== "lighting") bindKeySelection();
  document.querySelectorAll("[data-goto]").forEach((button) =>
    button.addEventListener("click", () => {
      state.page = button.dataset.goto;
      render();
    }),
  );
  if (state.page === "performance") {
    document
      .querySelector("#performanceMode")
      ?.addEventListener("change", (event) =>
        stagePerformance("mode", event.target.checked ? 1 : 0),
      );
    [
      "normalPress",
      "normalRelease",
      "rtFirstTouch",
      "rtPress",
      "rtRelease",
      "pressDeadStroke",
      "releaseDeadStroke",
    ].forEach((field) => bindNumberPair(field, field));
    document
      .querySelector("[data-copy-performance]")
      ?.addEventListener("click", () => {
        const source = clone(state.profile.performance[selectedKey().id]);
        keys.forEach((key) => {
          state.profile.performance[key.id] = clone(source);
          state.dirty.performance.add(key.id);
        });
        render();
        showToast("Performance settings staged for all 64 keys.");
      });
    document.querySelector("#calibrationToggle")?.addEventListener("click", () =>
      state.calibrationActive ? stopCalibration(true) : startCalibration(),
    );
    document
      .querySelector("#livePressDistanceToggle")
      ?.addEventListener("change", (event) => {
        state.livePressDistance = event.target.checked;
        if (!state.livePressDistance) stopTravelPolling(true);
        render();
      });
    if (state.livePressDistance) startTravel();
  }
  if (state.page === "keymap") {
    document.querySelectorAll("[data-layer]").forEach((button) =>
      button.addEventListener("click", () => selectMappingLayer(button.dataset.layer)),
    );
    document
      .querySelector("#mappingSearch")
      ?.addEventListener("input", (event) => {
        state.mappingSearch = event.target.value;
        render();
        const search = document.querySelector("#mappingSearch");
        search?.focus();
        search?.setSelectionRange(search.value.length, search.value.length);
      });
    document.querySelectorAll("[data-mapping-group]").forEach((button) =>
      button.addEventListener("click", () => {
        state.mappingGroup = button.dataset.mappingGroup;
        state.mappingSearch = "";
        if (state.mappingGroup === "combination") syncCombinationEditor();
        render();
      }),
    );
    document.querySelectorAll("[data-keycode]").forEach((button) =>
      button.addEventListener("click", () => {
        selectedKeyIds().forEach((id) => {
          state.profile.keycodes[state.profile.layer][id] = Number(
            button.dataset.keycode,
          );
          state.dirty.mapping.add(`${state.profile.layer}:${id}`);
        });
        render();
      }),
    );
    document.querySelectorAll("[data-combo-modifier]").forEach((button) =>
      button.addEventListener("click", () => {
        const modifier = Number(button.dataset.comboModifier);
        if (state.mappingCombination.modifiers.has(modifier))
          state.mappingCombination.modifiers.delete(modifier);
        else state.mappingCombination.modifiers.add(modifier);
        render();
      }),
    );
    document.querySelectorAll("[data-combo-trigger]").forEach((button) =>
      button.addEventListener("click", () => {
        state.mappingCombination.trigger = Number(button.dataset.comboTrigger);
        render();
      }),
    );
    document
      .querySelector("#applyCombination")
      ?.addEventListener("click", () => {
        try {
          const code = combinationKeycode(
              state.mappingCombination.modifiers,
              state.mappingCombination.trigger,
            );
          selectedKeyIds().forEach((id) => {
            state.profile.keycodes[state.profile.layer][id] = code;
            state.dirty.mapping.add(`${state.profile.layer}:${id}`);
          });
          render();
          showToast(
            `Staged ${keycodeLabel(code)} for ${selectedKeyIds().length} key${selectedKeyIds().length === 1 ? "" : "s"}.`,
          );
        } catch (error) {
          showToast(error.message, true);
        }
      });
    document.querySelector("#resetKeycode")?.addEventListener("click", () => {
      selectedKeyIds().forEach((id) => {
        state.profile.keycodes[state.profile.layer][id] = defaultKeycode(keys[id]);
        state.dirty.mapping.add(`${state.profile.layer}:${id}`);
      });
      render();
    });
  }
  if (state.page === "lighting") {
    const lighting = state.profile.lighting,
      stripLighting = lighting.decorative,
      activeBase =
        state.lightingTab === "strip" ? stripLighting.base : lighting.base;
    bindLightingSelection();
    document.querySelectorAll("[data-lighting-tab]").forEach((button) =>
      button.addEventListener("click", () => {
        state.lightingTab = button.dataset.lightingTab;
        render();
      }),
    );
    document
      .querySelector("#lightingOpen")
      ?.addEventListener("change", (event) => {
        activeBase.open = event.target.checked;
        activeBase.openMode = activeBase.open
          ? state.lightingTab === "strip"
            ? LIGHTING_OPEN_MODE.LOWER
            : LIGHTING_OPEN_MODE.BOTH
          : LIGHTING_OPEN_MODE.OFF;
        if (state.lightingTab === "strip") state.dirty.decorativeBase = true;
        else state.dirty.lightingBase = true;
        render();
      });
    document
      .querySelector("#lightingLive")
      ?.addEventListener("change", (event) => {
        state.liveLighting = event.target.checked;
        if (!state.liveLighting) {
          state.hardware.fnPressed = false;
          state.hardware.fnStatus = 0;
        }
        render();
      });
    const stageDoubleLighting = (mask, enabled) => {
      let mode = Number(lighting.base.openMode) || LIGHTING_OPEN_MODE.OFF;
      mode = enabled ? mode | mask : mode & ~mask;
      lighting.base.openMode = mode;
      lighting.base.open = mode !== LIGHTING_OPEN_MODE.OFF;
      state.dirty.lightingBase = true;
      render();
    };
    document
      .querySelector("#upperLighting")
      ?.addEventListener("change", (event) =>
        stageDoubleLighting(LIGHTING_OPEN_MODE.UPPER, event.target.checked),
      );
    document
      .querySelector("#lowerLighting")
      ?.addEventListener("change", (event) =>
        stageDoubleLighting(LIGHTING_OPEN_MODE.LOWER, event.target.checked),
      );
    document.querySelectorAll("[data-lighting-mode]").forEach((button) =>
      button.addEventListener("click", () => {
        const strip = button.dataset.lightingTarget === "strip",
          base = strip ? stripLighting.base : lighting.base;
        base.mode = Number(button.dataset.lightingMode);
        if (strip) state.dirty.decorativeBase = true;
        else state.dirty.lightingBase = true;
        render();
      }),
    );
    [
      ["lightingBrightness", "brightness", lighting.base, "main"],
      ["lightingSpeed", "speed", lighting.base, "main"],
      ["stripBrightness", "brightness", stripLighting.base, "strip"],
      ["stripSpeed", "speed", stripLighting.base, "strip"],
    ].forEach(([id, field, base, target]) =>
      document.querySelector(`#${id}`)?.addEventListener("input", (event) => {
        base[field] = clamp(event.target.value, 0, 100);
        document.querySelector(`#${id}Value`).textContent = String(base[field]);
        if (target === "strip") state.dirty.decorativeBase = true;
        else state.dirty.lightingBase = true;
        renderStatus();
      }),
    );
    document.querySelectorAll("[data-lighting-direction]").forEach((button) =>
      button.addEventListener("click", () => {
        const strip = button.dataset.lightingTarget === "strip",
          base = strip ? stripLighting.base : lighting.base;
        base.direction = Number(button.dataset.lightingDirection);
        if (strip) state.dirty.decorativeBase = true;
        else state.dirty.lightingBase = true;
        render();
      }),
    );
    document.querySelectorAll("[data-palette]").forEach((button) =>
      button.addEventListener("click", () => {
        const strip = button.dataset.lightingTarget === "strip",
          base = strip ? stripLighting.base : lighting.base;
        base.paletteIndex = Number(button.dataset.palette);
        if (strip) state.dirty.decorativeBase = true;
        else state.dirty.lightingBase = true;
        render();
      }),
    );
    const stagePaletteColor = (value, target = "main") => {
      const color = normalizeHex(value);
      if (!color)
        return showToast(
          "Use a six-digit HEX color, for example #73F0C0.",
          true,
        );
      const strip = target === "strip",
        base = strip ? stripLighting.base : lighting.base,
        palette = strip ? stripLighting.palette : lighting.palette;
      if (Number(base.paletteIndex) === 0)
        return showToast("Rainbow is firmware palette index 0 and is not an editable RGB slot.", true);
      palette[Number(base.paletteIndex)] = color;
      if (strip) state.dirty.decorativePalette = true;
      else state.dirty.lightingPalette = true;
      render();
    };
    document
      .querySelector("#paletteColor")
      ?.addEventListener("change", (event) =>
        stagePaletteColor(event.target.value),
      );
    document
      .querySelector("#paletteHex")
      ?.addEventListener("change", (event) =>
        stagePaletteColor(event.target.value),
      );
    document
      .querySelector("#stripPaletteColor")
      ?.addEventListener("change", (event) =>
        stagePaletteColor(event.target.value, "strip"),
      );
    document
      .querySelector("#stripPaletteHex")
      ?.addEventListener("change", (event) =>
        stagePaletteColor(event.target.value, "strip"),
      );
    document
      .querySelector("#keyCustomEnabled")
      ?.addEventListener("change", (event) => {
        for (const id of lightingKeyIds()) {
          lighting.customEnabled[id] = event.target.checked;
          state.dirty.customLighting.add(id);
        }
        render();
      });
    document.querySelector("#keyColor")?.addEventListener("input", (event) => {
      for (const id of lightingKeyIds()) {
        lighting.perKey[id] = event.target.value;
        lighting.customEnabled[id] = true;
        state.dirty.customLighting.add(id);
      }
      document
        .querySelectorAll(".unified-lighting-preview [data-key]")
        .forEach((node) => {
          if (state.lightingSelectedKeys.has(Number(node.dataset.key)))
            node.style.setProperty("--key-color", event.target.value);
        });
      renderStatus();
    });
    document
      .querySelector("#loadCustomLighting")
      ?.addEventListener("click", loadCustomLighting);
    document.querySelector("#copyKeyColor")?.addEventListener("click", () => {
      const color = lighting.perKey[lightingAnchorKey().id];
      keys.forEach((key) => {
        lighting.perKey[key.id] = color;
        lighting.customEnabled[key.id] = true;
        state.dirty.customLighting.add(key.id);
      });
      render();
      showToast("Custom color staged for all 64 keys.");
    });
    document.querySelector("#clearKeyColor")?.addEventListener("click", () => {
      for (const id of lightingKeyIds()) {
        lighting.customEnabled[id] = false;
        state.dirty.customLighting.add(id);
      }
      render();
    });
    document
      .querySelector("#clearAllKeyColors")
      ?.addEventListener("click", () => {
        keys.forEach((key) => {
          lighting.customEnabled[key.id] = false;
          state.dirty.customLighting.add(key.id);
        });
        render();
        showToast("All custom overrides staged for clearing.");
      });
    document
      .querySelector("#stripCustomEnabled")
      ?.addEventListener("change", (event) => {
        for (const index of stripLedIds()) {
          stripLighting.customEnabled[index] = event.target.checked;
          state.dirty.decorativeLighting.add(index);
        }
        render();
      });
    document
      .querySelector("#stripColor")
      ?.addEventListener("input", (event) => {
        for (const index of stripLedIds()) {
          stripLighting.perLed[index] = event.target.value;
          stripLighting.customEnabled[index] = true;
          state.dirty.decorativeLighting.add(index);
        }
        document
          .querySelectorAll(".unified-lighting-preview [data-strip-led]")
          .forEach((node) => {
            if (state.stripSelection.has(Number(node.dataset.stripLed)))
              node.style.setProperty("--led-color", event.target.value);
          });
        renderStatus();
      });
    document
      .querySelector("#loadStripLighting")
      ?.addEventListener("click", loadDecorativeLighting);
    document.querySelector("#copyStripColor")?.addEventListener("click", () => {
      const color = stripLighting.perLed[state.stripSelected];
      for (let index = 0; index < DECORATIVE_COLS; index += 1) {
        stripLighting.perLed[index] = color;
        stripLighting.customEnabled[index] = true;
        state.dirty.decorativeLighting.add(index);
      }
      render();
      showToast("Custom color staged for all 38 strip LEDs.");
    });
    document
      .querySelector("#clearStripColor")
      ?.addEventListener("click", () => {
        for (const index of stripLedIds()) {
          stripLighting.customEnabled[index] = false;
          state.dirty.decorativeLighting.add(index);
        }
        render();
      });
    document
      .querySelector("#clearAllStripColors")
      ?.addEventListener("click", () => {
        for (let index = 0; index < DECORATIVE_COLS; index += 1) {
          stripLighting.customEnabled[index] = false;
          state.dirty.decorativeLighting.add(index);
        }
        render();
        showToast("All Decorative1 overrides staged for clearing.");
      });
    if (state.liveLighting && connected()) startLightingLive();
  }
  if (state.page === "settings") {
    document.querySelectorAll("[data-theme-choice]").forEach((button) =>
      button.addEventListener("click", () => setTheme(button.dataset.themeChoice)),
    );
    document
      .querySelector("#systemMode")
      ?.addEventListener("change", (event) =>
        stageSetting("systemMode", Number(event.target.value)),
      );
    document
      .querySelector("#reportRate")
      ?.addEventListener("change", (event) =>
        stageSetting("reportRate", Number(event.target.value)),
      );
    document
      .querySelector("#reconnectKeyboard")
      ?.addEventListener("click", () => connectKeyboard());
    document
      .querySelector("#sleepTime")
      ?.addEventListener("change", (event) =>
        stageSetting("sleepTime", clamp(event.target.value, 0, 65535)),
      );
    document
      .querySelector("#shake")
      ?.addEventListener("change", (event) =>
        stageSetting("shake", event.target.checked),
      );
    document
      .querySelector("#saveProfileName")
      ?.addEventListener("click", saveProfileName);
    document
      .querySelector("#exportProfile")
      ?.addEventListener("click", exportProfile);
    document
      .querySelector("#importProfile")
      ?.addEventListener("click", () =>
        document.querySelector("#profileFileInput").click(),
      );
  }
  if (state.page === "advanced") {
    document
      .querySelector("#readAdvanced")
      ?.addEventListener("click", readAdvanced);
    document
      .querySelector("#readMacroSpace")
      ?.addEventListener("click", readMacroSpace);
  }
  if (state.page === "diagnostics") {
    document
      .querySelector("#readLayoutStyle")
      ?.addEventListener("click", readLayoutStyle);
    document.querySelector("#exportLog")?.addEventListener("click", exportLog);
  }
}
