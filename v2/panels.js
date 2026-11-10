"use strict";

let reloadedLivePressPosition = null;
let reloadedLivePressSize = null;
const livePressArrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

function positionReloadedLivePress(panel, left, top, { remember = true } = {}) {
  const inset = 8;
  const position = {
    left: clamp(left, inset, Math.max(inset, document.documentElement.clientWidth - panel.offsetWidth - inset)),
    top: clamp(top, inset, Math.max(inset, document.documentElement.clientHeight - panel.offsetHeight - inset)),
  };
  panel.style.inset = `${position.top}px auto auto ${position.left}px`;
  if (remember) reloadedLivePressPosition = position;
}

function applyReloadedLivePressSize(panel) {
  if (!reloadedLivePressSize) return;
  const { width, height } = reloadedLivePressSize;
  panel.style.width = `${width}px`;
  panel.style.height = `${height}px`;
  panel.classList.add("resized");
}

function resizeReloadedLivePress(panel, origin, dx, dy) {
  const maxWidth = document.documentElement.clientWidth - 16;
  const maxHeight = document.documentElement.clientHeight - 16;
  reloadedLivePressSize = {
    width: clamp(origin.width - dx, Math.min(248, maxWidth), maxWidth),
    height: clamp(origin.height - dy, Math.min(180, maxHeight), maxHeight),
  };
  applyReloadedLivePressSize(panel);
  positionReloadedLivePress(panel, origin.right - panel.offsetWidth, origin.bottom - panel.offsetHeight);
}

function bindLivePressPointer(handle, start, move) {
  let drag = null;
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || drag) return;
    const origin = start(event);
    if (!origin) return;
    drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, origin };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", (event) => {
    if (event.pointerId === drag?.pointer)
      move(drag.origin, event.clientX - drag.x, event.clientY - drag.y);
  });
  handle.addEventListener("lostpointercapture", () => { drag = null; });
}

function bindLivePressArrows(handle, adjust) {
  handle.addEventListener("keydown", (event) => {
    const direction = livePressArrows[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = event.shiftKey ? 40 : 12;
    adjust(direction[0] * step, direction[1] * step);
  });
}

window.addEventListener("resize", () => {
  const panel = document.querySelector(".reloaded-live-press");
  if (panel?.offsetWidth && reloadedLivePressPosition)
    positionReloadedLivePress(panel, reloadedLivePressPosition.left, reloadedLivePressPosition.top, { remember: false });
});

function paintReloadedLivePress(page) {
  const panel = page.querySelector("#livePressPanel");
  if (!panel) return;
  panel.parentElement.classList.remove("with-live-monitor");
  panel.classList.add("reloaded-live-press");
  panel.setAttribute("aria-label", "Live press distance");
  page.append(panel);

  const header = panel.querySelector(".panel-head");
  const title = header.querySelector("h2");
  title.innerHTML = '<button type="button" class="live-press-handle" data-keyboard-input="allow" aria-label="Move Live Press Distance panel with arrow keys" title="Drag to move"><span aria-hidden="true">⠿</span> Live press distance</button>';
  const handle = title.firstElementChild;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "button ghost small live-press-close";
  close.dataset.keyboardInput = "allow";
  close.setAttribute("aria-label", "Close live press distance");
  close.textContent = "×";
  header.append(close);

  const scope = panel.querySelector(".live-press-scope");
  const readout = panel.querySelector(".live-press-readout");
  const valueRow = document.createElement("div");
  valueRow.className = "live-press-value-row";
  valueRow.append(readout.firstElementChild, panel.querySelector("#livePressValue"));
  readout.prepend(valueRow, panel.querySelector(".axis-visual"));
  panel.querySelector("#pressedKeyList").parentElement.classList.add("live-press-pressed");
  panel.append(scope);
  const resize = document.createElement("button");
  resize.type = "button";
  resize.className = "live-press-resize";
  resize.dataset.keyboardInput = "allow";
  resize.setAttribute("aria-label", "Resize Live Press Distance panel with arrow keys");
  resize.title = "Drag to resize";
  panel.prepend(resize);

  applyReloadedLivePressSize(panel);
  if (reloadedLivePressPosition)
    positionReloadedLivePress(panel, reloadedLivePressPosition.left, reloadedLivePressPosition.top, { remember: false });

  const bounds = () => panel.getBoundingClientRect();
  const move = ({ left, top }, dx, dy) => positionReloadedLivePress(panel, left + dx, top + dy);
  bindLivePressPointer(header, (event) => {
    if (close.contains(event.target)) return null;
    panel.classList.add("moving");
    return bounds();
  }, move);
  header.addEventListener("lostpointercapture", () => panel.classList.remove("moving"));
  bindLivePressArrows(handle, (dx, dy) => move(bounds(), dx, dy));
  bindLivePressPointer(resize, bounds, (origin, dx, dy) => resizeReloadedLivePress(panel, origin, dx, dy));
  bindLivePressArrows(resize, (dx, dy) => resizeReloadedLivePress(panel, bounds(), dx, dy));
  close.addEventListener("click", () => {
    page.querySelector("#livePressDistanceToggle").click();
    page.querySelector("#livePressDistanceToggle").focus();
  });
}

const reloadedProfileOrderKey = globalThis.AE64_STORAGE_PREFIX + "onboard-profile-order-v1";
const reloadedProfileDragType = "application/x-ae64-onboard-profile";
let reloadedProfileOrder = [];
try {
  const savedOrder = JSON.parse(localStorage.getItem(reloadedProfileOrderKey));
  if (Array.isArray(savedOrder)) reloadedProfileOrder = savedOrder;
} catch {
  // The default slot order also works if saved preferences cannot be read.
}

function reloadedProfileSlots() {
  const slots = state.hardware.configIndexes;
  return [...new Set([...reloadedProfileOrder, ...slots])].filter((slot) => slots.includes(slot));
}

function paintReloadedProfiles(page) {
  const panel = page.querySelector(".settings-profile");
  const list = panel.querySelector(".profile-slot-row");
  const slots = reloadedProfileSlots();
  const active = Number(state.profile.profileIndex);
  const name = (slot) => state.hardware.configNames[slot] || `Profile ${slot + 1}`;
  panel.querySelector("h2").textContent = "Onboard profiles";
  panel.querySelector(".panel-head p").textContent =
    "Click to activate a profile. Drag one card onto another to swap their order in this browser. Slot numbers and keyboard shortcuts stay the same.";
  panel.querySelector(".panel-head").after(list);
  list.setAttribute("aria-label", "Onboard profiles");
  list.innerHTML = slots.map((slot, index) => `
    <div class="reloaded-profile-card${slot === active ? " active" : ""}" data-reloaded-slot="${slot}" draggable="true">
      <button class="reloaded-profile-load" type="button" data-load-profile="${slot}" aria-pressed="${slot === active}"
        data-keyboard-input="allow" aria-label="Activate ${esc(name(slot))}, onboard slot ${slot + 1}">
        <span class="reloaded-profile-icon" aria-hidden="true">⌨</span>
        <span class="reloaded-profile-label"><b>${esc(name(slot))}</b><small>Slot ${slot + 1}${slot === active ? " · Active" : ""}</small></span>
      </button>
      <div class="reloaded-profile-move">
        <button type="button" data-swap-profile="${slots[index - 1] ?? ""}" ${index === 0 ? "disabled" : ""}
          data-keyboard-input="allow" aria-label="Move ${esc(name(slot))} earlier" title="Move earlier">↑</button>
        <button type="button" data-swap-profile="${slots[index + 1] ?? ""}" ${index === slots.length - 1 ? "disabled" : ""}
          data-keyboard-input="allow" aria-label="Move ${esc(name(slot))} later" title="Move later">↓</button>
      </div>
      <span class="reloaded-profile-grip" aria-hidden="true" title="Drag to swap profiles">⠿</span>
    </div>`).join("");

  function swap(source, target, restoreFocus = false) {
    if (toolOperationBusy() || source === target || !slots.includes(source) || !slots.includes(target)) return;
    const order = [...slots];
    const from = order.indexOf(source), to = order.indexOf(target);
    [order[from], order[to]] = [order[to], order[from]];
    reloadedProfileOrder = order;
    try {
      localStorage.setItem(reloadedProfileOrderKey, JSON.stringify(order));
      showToast(`Swapped ${name(source)} and ${name(target)} in My Profiles.`);
    } catch {
      showToast("Profile order changed for this session. Browser storage is unavailable.", true);
    }
    render();
    if (restoreFocus) page.querySelector(`[data-load-profile="${source}"]`)?.focus();
  }

  let dragged = null;
  function clearDrag() {
    list.querySelector(".dragging")?.classList.remove("dragging");
    list.querySelector(".drop-target")?.classList.remove("drop-target");
    dragged = null;
  }
  for (const card of list.querySelectorAll("[data-reloaded-slot]")) {
    const slot = Number(card.dataset.reloadedSlot);
    card.querySelector("[data-load-profile]").addEventListener("click", () => {
      if (slot !== Number(state.profile.profileIndex)) switchProfile(slot);
    });
    for (const button of card.querySelectorAll("[data-swap-profile]:enabled"))
      button.addEventListener("click", () => swap(slot, Number(button.dataset.swapProfile), true));
    card.addEventListener("dragstart", (event) => {
      if (toolOperationBusy() || event.target.closest("[data-swap-profile]")) return event.preventDefault();
      event.dataTransfer.setData(reloadedProfileDragType, String(slot));
      event.dataTransfer.effectAllowed = "move";
      dragged = slot;
      card.classList.add("dragging");
    });
    card.addEventListener("dragover", (event) => {
      if (dragged === null || dragged === slot || !event.dataTransfer.types.includes(reloadedProfileDragType)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      card.classList.add("drop-target");
    });
    card.addEventListener("dragleave", (event) => {
      if (!card.contains(event.relatedTarget)) card.classList.remove("drop-target");
    });
    card.addEventListener("drop", (event) => {
      if (dragged === null || event.dataTransfer.getData(reloadedProfileDragType) !== String(dragged)) return;
      event.preventDefault();
      const source = dragged;
      clearDrag();
      swap(source, slot);
    });
    card.addEventListener("dragend", clearDrag);
  }
}

function paintReloadedFirmware(page) {
  const intro = page.querySelector(".firmware-intro");
  intro.querySelector("h2").textContent = "Flash or recover firmware";
  intro.querySelector("p").textContent = "Install a factory or custom release, or recover an AE64 Pro already in recovery mode.";
  const grid = page.querySelector(".firmware-page .page-grid");
  const [image, flash] = grid.children;
  image.querySelector("h2").textContent = "2. Choose an image";
  flash.querySelector("h2").textContent = "3. Flash the keyboard";
  const connect = document.createElement("section");
  connect.className = "panel reloaded-firmware-connect";
  connect.innerHTML = '<div class="panel-head"><div><h2>1. Connect the keyboard</h2><p>Select your AE64 Pro in normal or recovery mode.</p></div></div>';
  const device = flash.querySelector(".firmware-device");
  const button = device.querySelector("#firmwareConnect");
  if (!state.transport?.connected) {
    button.textContent = state.bootloaderConnected ? "Reconnect recovery keyboard" : "Connect keyboard";
    device.querySelector("p").textContent = "Use a USB data cable and choose the keyboard in the browser’s device list.";
  }
  connect.append(device);
  grid.before(connect);
}

let reloadedGamepadView = "setup";

function paintReloadedGamepad(page) {
  const studio = page.querySelector("#gamepadHardware");
  const component = activeGamepadStudio;
  const mapping = studio.querySelector(".mapping-card");
  const keyboard = mapping.querySelector(".keyboard-wrap");
  const picker = mapping.querySelector("#controlPicker");
  const grid = studio.querySelector(".workspace-grid");
  const tuning = grid.querySelector(".tuning-card");
  const behavior = grid.querySelector(".behavior-card");
  const device = studio.querySelector(".usb-device-control");
  const profile = studio.querySelector(".profilebar");
  const actions = profile.querySelector(".profile-actions");
  const status = studio.querySelector(".gp-device-bar");
  const fallback = document.createElement("details");
  fallback.className = "panel reloaded-gamepad-options";
  fallback.innerHTML = "<summary>Firmware and software options</summary>";
  fallback.append(page.querySelector(".hardware-solution-info"), page.querySelector(".solution-grid"));
  page.querySelector(".solution-intro").remove();

  keyboard.classList.add("reloaded-gamepad-board");
  studio.prepend(keyboard);
  const heading = document.createElement("div");
  heading.className = "reloaded-panel-heading";
  heading.innerHTML = `<h2>Gamepad</h2><div class="reloaded-segments" role="group" aria-label="Gamepad views">
    <button type="button" data-gamepad-view="setup">Setup &amp; Remap</button>
    <button type="button" data-gamepad-view="configuration">Configuration</button>
    <button type="button" data-gamepad-view="tester">Gamepad Tester</button>
  </div>`;
  keyboard.after(heading);

  device.querySelector("#usbDeviceTitle").textContent = "Enable Gamepad";
  mapping.querySelector("h2").textContent = "Controller Mapping";
  mapping.querySelector(".card-head div > p:last-child").textContent =
    "Drag a controller action onto a key, or select a key and choose an action. Right-click a key to remove its assignment.";
  mapping.querySelector(".assignment-head").before(picker);
  tuning.querySelector("h2").textContent = "Analog Curve";
  behavior.querySelector("h2").textContent = "Gamepad Response";
  const setup = document.createElement("div");
  setup.className = "reloaded-gamepad-setup";
  const enable = document.createElement("section");
  enable.className = "card reloaded-enable-gamepad";
  enable.append(device, profile);
  setup.append(enable, mapping, status, fallback);
  grid.before(setup);
  grid.className = "reloaded-gamepad-configuration";
  grid.append(tuning, behavior);
  const tester = document.createElement("section");
  tester.className = "card reloaded-gamepad-tester";
  tester.innerHTML = '<h3>Test Gamepad</h3><p role="status">Press a button on your controller to begin.</p><div class="tester-signals"></div>';
  grid.after(tester);
  tester.after(actions);

  let frame = 0;
  const testerStatus = tester.querySelector("p");
  const signals = tester.querySelector(".tester-signals");
  let lastSignals = "";
  function readGamepads() {
    if (!tester.isConnected || tester.hidden || tester.closest("#workspace").classList.contains("hidden")) return;
    let gamepads;
    try { gamepads = Array.from(navigator.getGamepads()).filter(Boolean); }
    catch (_) {
      testerStatus.textContent = "The browser does not expose controller input on this page.";
      signals.replaceChildren();
      return;
    }
    const signature = JSON.stringify(gamepads.map((pad) => [pad.id, pad.axes.map((axis) => axis.toFixed(2)),
      pad.buttons.map((button) => [button.value.toFixed(2), button.pressed])]));
    if (signature !== lastSignals) {
      lastSignals = signature;
      testerStatus.textContent = gamepads.length
        ? "Controller input reported by the browser."
        : "Press a button on a connected controller to show its input.";
      signals.innerHTML = gamepads.map((pad) => `<section class="tester-device"><strong>${esc(pad.id || "Gamepad")}</strong>
        <div class="tester-axes">${pad.axes.map((axis, index) => `<label>Axis ${index + 1}<meter min="-1" max="1" value="${axis}"></meter><span>${axis.toFixed(2)}</span></label>`).join("")}</div>
        <div class="tester-buttons">${pad.buttons.map((button, index) => `<span class="${button.pressed ? "pressed" : ""}">B${index + 1} · ${button.value.toFixed(2)}</span>`).join("")}</div>
      </section>`).join("");
    }
    frame = requestAnimationFrame(readGamepads);
  }
  function showView() {
    setup.hidden = reloadedGamepadView !== "setup";
    grid.hidden = reloadedGamepadView !== "configuration";
    tester.hidden = reloadedGamepadView !== "tester";
    heading.querySelectorAll("[data-gamepad-view]").forEach((button) =>
      button.setAttribute("aria-pressed", String(button.dataset.gamepadView === reloadedGamepadView)));
    cancelAnimationFrame(frame);
    if (!tester.hidden) readGamepads();
  }
  heading.addEventListener("click", (event) => {
    const view = event.target.closest("[data-gamepad-view]")?.dataset.gamepadView;
    if (view) { reloadedGamepadView = view; showView(); }
  });

  const dragType = "application/x-ae64-gamepad-control";
  picker.addEventListener("pointerdown", (event) => {
    const action = event.target.closest("[data-control]");
    if (action) action.draggable = true;
  });
  picker.addEventListener("dragstart", (event) => {
    const action = event.target.closest("[data-control]");
    if (action) event.dataTransfer.setData(dragType, action.dataset.control);
  });
  keyboard.addEventListener("dragover", (event) => {
    if (event.dataTransfer.types.includes(dragType) && event.target.closest("[data-key]")) event.preventDefault();
  });
  keyboard.addEventListener("drop", (event) => {
    const key = event.target.closest("[data-key]");
    if (!key || !event.dataTransfer.types.includes(dragType)) return;
    event.preventDefault();
    component.assignControl(event.dataTransfer.getData(dragType), Number(key.dataset.key));
  });
  keyboard.addEventListener("contextmenu", (event) => {
    const key = event.target.closest("[data-key].bound");
    if (!key) return;
    event.preventDefault();
    component.removeAssignment(Number(key.dataset.key));
  });
  showView();
}

function bindReloadedPalette(palette) {
  const native = palette.querySelector('input[type="color"]');
  if (!native) return;
  const hsv = rgbToHsv(hexToRgb(native.value));
  const picker = document.createElement("div");
  picker.className = "reloaded-palette-picker";
  picker.innerHTML = `<div class="reloaded-color-plane" role="slider" tabindex="${native.disabled ? -1 : 0}"
    aria-label="Colour brightness and saturation" aria-valuemin="0" aria-valuemax="100" aria-disabled="${native.disabled}"
    data-keyboard-input="allow"><i></i></div>
    <input type="range" class="reloaded-hue" aria-label="Hue" min="0" max="360" step="1"
    value="${Math.round(hsv.h)}" data-keyboard-input="allow" ${native.disabled ? "disabled" : ""}>`;
  palette.querySelector(".palette-editor").prepend(picker);
  const surface = picker.querySelector(".reloaded-color-plane");
  const hue = picker.querySelector(".reloaded-hue");
  function preview() {
    surface.style.setProperty("--hue", hue.value);
    surface.style.setProperty("--saturation", `${hsv.s * 100}%`);
    surface.style.setProperty("--value", `${(1 - hsv.v) * 100}%`);
    surface.setAttribute("aria-valuenow", String(Math.round(hsv.v * 100)));
    surface.setAttribute("aria-valuetext", `Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`);
  }
  function commit() {
    native.value = hsvToHex(Number(hue.value), hsv.s, hsv.v);
    native.dispatchEvent(new Event("change", { bubbles: true }));
  }
  preview();
  if (native.disabled) return;
  function updatePointer(event) {
    const rect = surface.getBoundingClientRect();
    hsv.s = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    hsv.v = 1 - clamp((event.clientY - rect.top) / rect.height, 0, 1);
    preview();
  }
  surface.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    surface.setPointerCapture(event.pointerId);
    updatePointer(event);
  });
  surface.addEventListener("pointermove", (event) => {
    if (surface.hasPointerCapture(event.pointerId)) updatePointer(event);
  });
  surface.addEventListener("pointerup", (event) => {
    if (!surface.hasPointerCapture(event.pointerId)) return;
    updatePointer(event);
    commit();
  });
  surface.addEventListener("keydown", (event) => {
    const directions = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowRight: [1, 0], ArrowLeft: [-1, 0] };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    hsv.s = clamp(hsv.s + direction[0] * 0.05, 0, 1);
    hsv.v = clamp(hsv.v + direction[1] * 0.05, 0, 1);
    commit();
    document.querySelector(".reloaded-color-plane")?.focus();
  });
  hue.addEventListener("input", preview);
  hue.addEventListener("change", commit);
}

function paintReloadedLighting(page) {
  const layout = page.querySelector(".lighting-page");
  const preview = layout.querySelector(".unified-lighting-preview");
  const command = layout.querySelector(".lighting-command");
  const nav = layout.querySelector(".lighting-section-nav");
  const top = document.createElement("div");
  top.className = "reloaded-lighting-board";
  const layers = document.createElement("div");
  layers.className = "reloaded-rgb-layers";
  layers.innerHTML = "<h3>Layers</h3>";
  const tabs = nav.querySelector(".lighting-tabs");
  const labels = { main: "Main Layer", perKey: "Per-key Colours", strip: "Light Strip", fn1: "Fn Layer 1", fn2: "Fn Layer 2", fn3: "Fn Layer 3" };
  tabs.querySelectorAll("[data-lighting-tab]").forEach((button) => {
    button.textContent = labels[button.dataset.lightingTab] || button.textContent;
  });
  layers.append(tabs);
  top.append(layers, preview);
  layout.prepend(top);
  const title = document.createElement("h2");
  title.className = "reloaded-rgb-title";
  title.textContent = "RGB Settings";
  top.after(title);
  layout.append(command, nav);
  command.querySelector(".lighting-command-copy h2").textContent =
    layout.classList.contains("fn-lighting-context") ? labels[state.lightingTab] : "Lighting controls";

  const palette = layout.querySelector(".lighting-palette-panel");
  const modes = layout.querySelector(".lighting-mode-panel");
  const tune = layout.querySelector(".lighting-tune-panel");
  if (!palette || !modes || !tune) return;
  const editor = palette.parentElement;
  editor.classList.add("reloaded-rgb-editors");
  palette.querySelector("h2").textContent = "Colours";
  bindReloadedPalette(palette);
  const effects = document.createElement("section");
  effects.className = "panel reloaded-effects";
  effects.innerHTML = `<h2>Effects</h2><div class="reloaded-effect-header">
      <label class="field"><span>Effect preset</span><select aria-label="Effect preset" data-keyboard-input="allow"></select></label>
    </div><div class="reloaded-effect-columns"><div class="reloaded-base-effect"><h3>Base Layer</h3><strong></strong></div></div>`;
  palette.after(effects);
  const modeButtons = Array.from(modes.querySelectorAll("[data-lighting-mode]"));
  const active = modeButtons.find((button) => button.classList.contains("active"));
  const preset = effects.querySelector("select");
  for (const button of modeButtons)
    preset.add(new Option(button.querySelector("span").textContent, button.dataset.lightingMode, false, button === active));
  preset.addEventListener("change", () => modeButtons.find((button) => button.dataset.lightingMode === preset.value)?.click());
  effects.querySelector(".reloaded-base-effect strong").textContent = active?.querySelector("span").textContent || "Custom effect";
  modes.querySelector("h2").textContent = "Effect Selection";
  tune.querySelector("h2").textContent = "Effect Parameters";
  const brightness = tune.querySelector('[id$="Brightness"]')?.closest("label");
  if (brightness) {
    if (state.lightingTab === "main") brightness.querySelector("b").textContent = "Global Brightness";
    effects.querySelector(".reloaded-effect-header").append(brightness);
  }
  effects.querySelector(".reloaded-effect-columns").append(modes, tune);
}
