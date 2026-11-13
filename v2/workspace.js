"use strict";

// Reloaded composes the same device editors inside its own navigation shell.
(() => {
  const titles = {
    quick: "Quick Settings", actuation: "Actuation Point", rapid: "Rapid Trigger",
    switches: "Magnetic Switches", keymap: "Remap", lighting: "RGB Settings",
    advanced: "Advanced Keys", gamepad: "Gamepad", settings: "Device Settings", profiles: "My Profiles",
    overview: "Device Overview", firmware: "Firmware", recovery: "Firmware recovery", diagnostics: "Diagnostics",
    about: "Help",
  };
  const navigation = document.querySelector("#sideNav");
  const content = document.querySelector("#pageContent");
  const sidebarToggle = document.querySelector("#toggleSidebar");
  const sidebarPreference = globalThis.AE64_STORAGE_PREFIX + "compact-sidebar";
  function setSidebarCompact(compact) {
    document.documentElement.dataset.sidebar = compact ? "compact" : "expanded";
    const label = compact ? "Expand sidebar" : "Collapse sidebar";
    sidebarToggle.setAttribute("aria-label", label);
    sidebarToggle.setAttribute("aria-expanded", String(!compact));
    sidebarToggle.title = label;
  }
  setSidebarCompact(driverStorage.getItem(sidebarPreference) === "true");
  sidebarToggle.addEventListener("click", () => {
    const compact = document.documentElement.dataset.sidebar !== "compact";
    setSidebarCompact(compact);
    driverStorage.setItem(sidebarPreference, String(compact));
  });
  for (const button of navigation.querySelectorAll(".sidebar button[data-page]")) {
    const label = button.querySelector("b").textContent;
    button.title = label;
    button.setAttribute("aria-label", label);
  }
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
  const paint = render;
  const paintStatus = renderStatus;
  const paintToolbar = renderToolbar;
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
    document.querySelector("#connectButton").classList.toggle("hidden", connected());
  };

  renderToolbar = () => {
    paintToolbar();
    const select = document.querySelector("#quickProfileSelect");
    const options = new Map(Array.from(select.options, (option) => [Number(option.value), option]));
    select.append(...reloadedProfileSlots().map((slot) => options.get(slot)));
    select.value = state.profile.profileIndex;
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
    paintReloadedLivePress(content);
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
    paintReloadedRemapCatalog(intro, board);
  }

  render = () => {
    if (state.firmwareBusy || state.gamepadBusy || state.fnLightingBusy) return;
    paint();
    const view = state.page === "performance" ? performanceView : state.page === "settings" ? settingsView : state.page;
    document.querySelector("#workspace").classList.toggle("standalone-recovery", view === "recovery");
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
    if (state.page === "lighting") paintReloadedLighting(content);
    if (state.page === "gamepad") paintReloadedGamepad(content);
    if (state.page === "firmware") paintReloadedFirmware(content);
    if (state.page === "recovery") paintReloadedRecovery(content);
    if (view === "profiles") paintReloadedProfiles(content);
  };
})();
