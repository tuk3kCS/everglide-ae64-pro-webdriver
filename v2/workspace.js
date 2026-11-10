"use strict";

// Reloaded composes the same device editors inside its own navigation shell.
(() => {
  const titles = {
    quick: "Quick Settings", actuation: "Actuation Point", rapid: "Rapid Trigger",
    switches: "Magnetic Switches", keymap: "Remap", lighting: "RGB Settings",
    advanced: "Advanced Keys", gamepad: "Gamepad", settings: "Device Settings", profiles: "My Profiles",
    overview: "Device Overview", firmware: "Firmware", diagnostics: "Diagnostics",
    about: "Help",
  };
  const navigation = document.querySelector("#sideNav");
  const content = document.querySelector("#pageContent");
  const performanceRoutes = {
    quick: "quick-settings", actuation: "actuation-point", rapid: "rapid-trigger", switches: "magnetic-switches",
  };
  const initialRoute = window.location.hash.slice(1);
  let performanceView = Object.keys(performanceRoutes).find((view) => performanceRoutes[view] === initialRoute) || "quick";
  let settingsView = initialRoute === "profiles" ? "profiles" : "settings";
  state.performanceWorkspace = performanceView === "switches" ? "switches" : "tuning";
  window.AE64_ROUTE_FOR_PAGE = (page) => {
    if (page === "performance") return performanceRoutes[performanceView];
    return page === "settings" ? settingsView : page;
  };
  let remapSearch = "";
  let remapGroup = "keyboard";
  const paint = render;
  const paintStatus = renderStatus;
  const selectClassicMappingKey = selectMappingKey;

  navigation.addEventListener("click", (event) => {
    const view = event.target.closest("button[data-view]")?.dataset.view;
    if (!view || toolOperationBusy()) return;
    if (view === "settings" || view === "profiles") settingsView = view;
    else {
      performanceView = view;
      state.performanceWorkspace = view === "switches" ? "switches" : "tuning";
    }
  }, true);

  renderStatus = () => {
    paintStatus();
    document.querySelector("#connectButton").textContent = connected()
      ? "Reconnect keyboard" : "Connect keyboard";
  };

  selectMappingKey = (event) => {
    if (state.page !== "keymap") return selectClassicMappingKey(event);
    const id = Number(event.target.closest("[data-key]")?.dataset.key);
    if (!keys[id]) return;
    state.profile.selected = id;
    state.selectedKeys = new Set([id]);
    render();
    if (connected()) readSelectedKey().then(render).catch((error) => showToast(error.message, true));
  };

  function paintPreview(board) {
    if (connected() || state.calibrationActive) return;
    for (const node of board.querySelectorAll(".keyboard-row")) {
      let offset = 0;
      for (const key of node.querySelectorAll("[data-key]")) {
        const { u } = keys[Number(key.dataset.key)];
        const hue = 323 * (1 - (offset + u / 2) / 15);
        key.style.setProperty("--demo-color", `hsl(${hue} 86% 39%)`);
        offset += u;
      }
    }
  }

  function paintPerformance(view) {
    const tuning = content.querySelector(".performance-tuning");
    const heading = tuning.querySelector(".panel-head");
    heading.querySelector(".eyebrow").hidden = true;
    heading.querySelector("h2").textContent = titles[view];
    heading.querySelector("p").hidden = true;
    const selection = document.createElement("div");
    selection.className = "selection-toolbar";
    selection.innerHTML = `<span>${state.selectedKeys.size ? `${state.selectedKeys.size} selected` : "Select one or more keys to adjust their settings."}</span>
      <button type="button" class="button ghost small" data-select-all>Select all keys</button>
      <button type="button" class="button ghost small" data-discard ${state.selectedKeys.size ? "" : "disabled"}>Discard selection</button>`;
    heading.after(selection);
    const board = content.querySelector(".performance-board");
    if (!state.calibrationActive) {
      const calibration = board.querySelector(".calibration-board-action");
      if (calibration) selection.append(calibration);
    }
    if (view === "quick") paintPreview(board);
    selection.querySelector("[data-select-all]").addEventListener("click", () => {
      commitKeySelection(new Set(keys.map((key) => key.id)), selectedKey().id);
      render();
    });
    selection.querySelector("[data-discard]").addEventListener("click", () => {
      state.selectedKeys.clear();
      render();
    });

    const columns = tuning.querySelector(".actuation-tuning-columns");
    if (!columns) return;
    tuning.querySelector(".selected-key-card").hidden = !state.selectedKeys.size;
    const actuation = columns.firstElementChild;
    actuation.classList.add("reloaded-actuation");
    actuation.querySelector("h3").textContent = "Actuation Point";
    actuation.querySelector(".tuning-column-head p").textContent = "Set the point that activates a keypress.";
    const rapid = document.createElement("section");
    rapid.className = "tuning-column reloaded-rapid";
    rapid.innerHTML = '<div class="tuning-column-head"><div><h3>Rapid Trigger</h3></div></div>';
    rapid.append(actuation.querySelector("#performanceMode").closest("label"));
    const sensitivities = actuation.querySelector(".rt-settings");
    if (sensitivities) rapid.append(sensitivities);
    const axis = document.createElement("img");
    axis.src = "assets/images/axis.png";
    axis.alt = "";
    axis.className = "reloaded-switch";
    actuation.querySelector(".actuation-distance-field").before(axis);
    actuation.after(rapid);
    columns.inert = state.selectedKeys.size === 0;
    const copy = tuning.querySelector("[data-copy-performance]");
    if (copy) copy.disabled = columns.inert;
  }

  function paintRemap() {
    const grid = content.querySelector(".keymap-page");
    const intro = grid.querySelector(".keymap-assignment-workspace");
    const board = grid.querySelector(".layout-board");
    const layers = grid.querySelector(".layer-bar");
    const top = document.createElement("div");
    top.className = "remap-board";
    grid.prepend(top);
    top.append(layers, board);
    paintPreview(board);
    layers.querySelectorAll("[data-layer]").forEach((button) => {
      button.textContent = Number(button.dataset.layer) === 0 ? "Main Layer" : `Fn Layer ${button.dataset.layer}`;
    });

    const heading = document.createElement("h2");
    heading.className = "remap-title";
    heading.textContent = "Remap";
    intro.before(heading);
    intro.querySelector(".mapping-launcher p").textContent = "Drag a key from the catalog onto the keyboard, or select a key and click its new assignment.";
    intro.querySelector("#openMappingPicker").textContent = "Open full catalog";
    const catalog = document.createElement("section");
    catalog.className = "panel reloaded-key-catalog";
    catalog.innerHTML = `<input type="search" id="reloadedRemapSearch" placeholder="Search for a character" aria-label="Search for a key">
      <div class="reloaded-categories" aria-label="Key categories"></div>
      <div class="reloaded-catalog-entries"></div>`;
    intro.after(catalog);
    const input = catalog.querySelector("input");
    const categories = catalog.querySelector(".reloaded-categories");
    const entries = catalog.querySelector(".reloaded-catalog-entries");
    input.value = remapSearch;

    const assign = (code, id) => {
      if (toolOperationBusy() || !keys[id] || !KEYCODE_LABELS.has(code)) return;
      state.profile.selected = id;
      state.selectedKeys = new Set([id]);
      applyMappingPickerKeycode(code);
    };
    function updateCatalog() {
      const label = remapGroup === "keyboard" ? "Basic Characters" : remapGroup[0].toUpperCase() + remapGroup.slice(1);
      categories.innerHTML = KEYMAP_SELECTABLE_GROUPS.map((group) =>
        `<button class="button ghost small" type="button" data-catalog-group="${group}" aria-pressed="${group === remapGroup}">${esc(group)}</button>`).join("");
      const choices = remapSearch.trim()
        ? mappingPickerEntries(remapGroup, remapSearch)
        : KEYCODE_GROUPS[remapGroup];
      entries.innerHTML = `<h3>${remapSearch.trim() ? "Search results" : label}</h3><div class="reloaded-keycodes">${choices.map(({ code, label: name }) =>
        `<button type="button" draggable="true" data-catalog-code="${code}" title="${esc(name)}">${esc(name)}</button>`).join("") || "<p>No matching keys.</p>"}</div>`;
    }
    input.addEventListener("input", () => { remapSearch = input.value; updateCatalog(); });
    categories.addEventListener("click", (event) => {
      const group = event.target.closest("[data-catalog-group]")?.dataset.catalogGroup;
      if (group) { remapGroup = group; remapSearch = input.value = ""; updateCatalog(); }
    });
    entries.addEventListener("click", (event) => {
      const code = event.target.closest("[data-catalog-code]")?.dataset.catalogCode;
      if (code !== undefined) assign(Number(code), selectedKey().id);
    });
    const dragType = "application/x-ae64-reloaded-keycode";
    entries.addEventListener("dragstart", (event) => {
      const code = event.target.closest("[data-catalog-code]")?.dataset.catalogCode;
      if (code !== undefined) event.dataTransfer.setData(dragType, code);
    });
    board.addEventListener("dragover", (event) => {
      if (event.dataTransfer.types.includes(dragType) && event.target.closest("[data-key]")) event.preventDefault();
    });
    board.addEventListener("drop", (event) => {
      const key = event.target.closest("[data-key]");
      if (!key || !event.dataTransfer.types.includes(dragType)) return;
      event.preventDefault();
      assign(Number(event.dataTransfer.getData(dragType)), Number(key.dataset.key));
    });
    updateCatalog();
  }

  render = () => {
    if (state.firmwareBusy || state.gamepadBusy || state.fnLightingBusy) return;
    paint();
    const view = state.page === "performance" ? performanceView : state.page === "settings" ? settingsView : state.page;
    content.dataset.view = view;
    document.querySelector("#pageTitle").textContent = titles[view];
    navigation.querySelectorAll("button[data-page]").forEach((button) => {
      const active = button.dataset.page === state.page &&
        (button.dataset.view === undefined || button.dataset.view === view || button.closest(".tool-rail"));
      button.classList.toggle("active", Boolean(active));
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    if (state.page === "performance") paintPerformance(view);
    if (state.page === "keymap") paintRemap();
    if (state.page === "lighting") {
      const preview = content.querySelector(".unified-lighting-preview");
      const command = content.querySelector(".lighting-command");
      if (preview && command) {
        command.before(preview);
        command.querySelector("h2").textContent = titles.lighting;
      }
    }
    if (view === "profiles") {
      content.querySelectorAll("[data-profile-slot]").forEach((button) => {
        const index = Number(button.dataset.profileSlot);
        button.textContent = state.hardware.configNames[index] || `Profile ${index + 1}`;
      });
    }
  };
})();
