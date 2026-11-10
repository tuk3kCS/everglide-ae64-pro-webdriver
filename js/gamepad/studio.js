/* Original independent configuration UI. No firmware flashing. SPDX-License-Identifier: MIT */
(function () {
  "use strict";
  function mount(root, options = {}) {
  let disposed = false;
  const getTransport = options.getTransport || (() => null);
  const M = window.AE64GamepadModel, $ = (id) => root.querySelector(`#${id}`), STORAGE = (globalThis.AE64_STORAGE_PREFIX || "") + "ae64-gamepad-studio-v1";
  const icon = (control) => window.AE64ControllerIcons.html(control);
  const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  let config = M.emptyProfile(), selectedKey = 15, selectedControl = null, transport = getTransport(), capabilities = null, busy = false, profileLoaded = false;
  let deviceLimits = [], travelGeneration = 0, travelError = "", travelRead = null;
  let usbState = null, usbSwitchPending = false, usbSwitchError = "";
  let hasLocalDraft = false, hardwareProfile = null;
  const rangeFields = ["startMm", "endMm", "maxTravelMm"], signature = (b) => [b.key, ...rangeFields.map((field) => b[field])];
  const profileFingerprint = (value) => JSON.stringify([value.mode, value.transport, value.bindings, value.sticks]);
  const legacyDefault = (b) => b.startMm === 0.5 && b.endMm === 3.5 && b.maxTravelMm === 4;
  let automaticTravel = new Set(M.CONTROLS.map((c) => c.id));
  let automaticMaximum = new Set(automaticTravel);
  try {
    const saved = localStorage.getItem(STORAGE);
    if (saved) {
      const value = JSON.parse(saved); config = M.validate(value); hasLocalDraft = !value.keyboardFingerprint || profileFingerprint(config) !== value.keyboardFingerprint;
      automaticTravel = new Set(config.bindings.filter((b) => Array.isArray(value.automaticTravel)
        ? value.automaticTravel.some((item) => item?.control === b.control && JSON.stringify(item.values) === JSON.stringify(signature(b)))
        : legacyDefault(b)).map((b) => b.control));
      automaticMaximum = new Set(config.bindings.filter((b) => Array.isArray(value.automaticMaximum)
        ? value.automaticMaximum.some((item) => item?.control === b.control && item.key === b.key && item.maxTravelMm === b.maxTravelMm)
        : b.maxTravelMm === 4 || automaticTravel.has(b.control)).map((b) => b.control));
    }
  } catch (_) { /* Keep a safe local default when an old draft is invalid. */ }
  function notify(message, error = false) { if (!disposed) options.notify?.(message, error); }
  function setBusy(value) { busy = value; if (!disposed) options.onBusy?.(value); }

  function persist() { try { localStorage.setItem(STORAGE, JSON.stringify({ ...config, keyboardFingerprint: hardwareProfile ? profileFingerprint(hardwareProfile) : null, automaticTravel: config.bindings.filter((b) => automaticTravel.has(b.control)).map((b) => ({ control: b.control, values: signature(b) })), automaticMaximum: config.bindings.filter((b) => automaticMaximum.has(b.control)).map((b) => ({ control: b.control, key: b.key, maxTravelMm: b.maxTravelMm })) })); } catch (_) { notify("This browser could not save the draft. Export a profile file to keep it.", true); } }
  function keyTravel(key) {
    if (key === null) return null;
    const selected = options.getKeyTravel?.(M.KEYS[key]), known = deviceLimits.find((item) => item.key === key) || selected;
    return Number.isInteger(known?.maxTravelUm) && known.maxTravelUm >= 10 && known.maxTravelUm <= 10000 ? known : null;
  }
  function useAutomaticTravel() {
    const next = M.validate(config);
    for (const b of next.bindings) {
      const known = keyTravel(b.key);
      if (automaticTravel.has(b.control) && known) Object.assign(b, M.defaultTravel(known.maxTravelUm / 1000));
      else if (known) {
        const maximum = known.maxTravelUm / 1000;
        if (b.startMm >= maximum) throw new Error(`${M.KEYS[b.key].label}: lower Start below the keyboard's ${maximum.toFixed(2)} mm travel limit.`);
        if (automaticMaximum.has(b.control) || b.maxTravelMm > maximum) b.maxTravelMm = maximum;
        b.endMm = Math.min(b.endMm, b.maxTravelMm);
      }
    }
    config = M.validate(next);
  }
  async function refreshTravelDefaults(force = false) {
    if (travelRead && !force) return travelRead;
    const pending = readTravelDefaults(force); travelRead = pending;
    try { return await pending; }
    finally { if (travelRead === pending) travelRead = null; }
  }
  async function readTravelDefaults(force) {
    const connection = getTransport(), token = ++travelGeneration;
    const canRead = connection?.connected && (options.readKeyTravel || connection.getPerformance);
    if (canRead) {
      $("travelSyncStatus").textContent = "Reading keyboard travel limits automatically…";
      const missing = M.KEYS.filter((key) => force || !deviceLimits.some((item) => item.key === key.id));
      const results = await Promise.allSettled(missing.map(async (key) => {
        const value = options.readKeyTravel ? await options.readKeyTravel(key, connection) : { key: key.id, maxTravelUm: (await connection.getPerformance(key)).axisRangeMax };
        if (!Number.isInteger(value?.maxTravelUm) || value.maxTravelUm < 10 || value.maxTravelUm > 10000) throw new Error(`${key.label}: switch travel is unavailable.`);
        return value;
      }));
      if (disposed || token !== travelGeneration || connection !== getTransport() || !connection.connected) return;
      for (const result of results) if (result.status === "fulfilled") {
        deviceLimits = deviceLimits.filter((item) => item.key !== result.value.key);deviceLimits.push(result.value);
      }
      travelError = results.find((result) => result.status === "rejected")?.reason?.message || "";
    }
    if (disposed || token !== travelGeneration) return;
    try { useAutomaticTravel(); } catch (error) { travelError = error.message; }
    persist(); render();
    $("travelSyncStatus").textContent = travelError ? `Some travel limits need attention: ${travelError} Use Refresh travel limits to retry.`
      : canRead ? `Travel limits read automatically · ${deviceLimits.length} keys. Adjusted ranges are a local draft until Apply.`
      : connection?.connected ? "Using available switch settings; this connection cannot read travel limits." : "Travel limits will be read automatically when the keyboard connects.";
  }
  const binding = () => config.bindings.find((b) => b.control === selectedControl);
  function compatible() { return Boolean(!usbSwitchPending && transport?.connected && capabilities?.verified === true && capabilities.protocolVersion === 1 && capabilities.boardId === 0x0030000A && (config.mode === "off" || capabilities.transports?.[config.transport] === true)); }
  function usbSwitchSupported() { return Boolean(transport?.connected && capabilities?.verified === true && capabilities.protocolVersion === 1 && capabilities.boardId === 0x0030000a && capabilities.usbDeviceSwitch === true); }
  function draftDiffersFromKeyboard() { return Boolean(hardwareProfile && profileFingerprint(config) !== profileFingerprint(hardwareProfile)); }
  function updateUsbSwitch() {
    const supported = usbSwitchSupported(), toggle = $("usbDeviceEnabled");
    $("usbDeviceHint").textContent = capabilities?.usbDevicePersistent
      ? "The keyboard saves this choice across unplugging, restarts and power loss. Changing it briefly reconnects the whole keyboard over USB. Output mode “Gamepad off” mutes controller input."
      : "Changing this briefly reconnects the whole keyboard over USB. Older custom firmware keeps this choice until power is disconnected. Output mode “Gamepad off” mutes controller input.";
    toggle.checked = Boolean(usbState && (usbSwitchPending ? usbState.targetEnabled : usbState.enabled));
    toggle.disabled = busy || usbSwitchPending || !supported || !usbState || usbState.phase !== 0;
    $("usbDeviceStatus").textContent = usbSwitchPending ? "USB reconnecting… Xbox device change is not confirmed yet."
      : usbSwitchError ? `Xbox device state unavailable: ${usbSwitchError}`
      : !supported ? transport?.connected ? "Requires custom firmware with Xbox USB device switching support." : "Connect compatible custom firmware to change Xbox device visibility."
      : !usbState ? "Reading Xbox USB device state…"
      : usbState.enabled ? "Enabled · Xbox controller device is exposed over USB." : "Disabled · Xbox controller device is absent from the active USB connection.";
  }
  function updateCompatibility() {
    updateUsbSwitch();
    $("connect").textContent = transport?.connected ? "Read keyboard profile" : "Connect keyboard";
    $("deviceStatus").classList.toggle("connected", Boolean(transport?.connected));
    $("apply").disabled = !compatible() || busy;
    $("matchTravel").disabled = !transport?.connected || busy;
    const banner = $("compatibility"); banner.classList.remove("warning");
    let title = "Ready to design your profile", text = "Connect to read the keyboard profile and switch travel limits automatically.";
    if (transport?.connected && !capabilities?.verified) { title = "Keyboard connected"; text = "This firmware does not provide the custom gamepad interface. You can read travel, design mappings and export a profile; controller output and Apply are unavailable."; banner.classList.add("warning"); }
    else if (capabilities?.verified && !compatible()) { title = "This controller type is unavailable on the connected firmware"; text = config.transport === "xinput" ? "Native Xbox / XInput support is required for this profile. A USB HID gamepad is a separate fallback." : "The connected firmware does not advertise a USB HID gamepad output."; banner.classList.add("warning"); }
    else if (compatible()) {
      title = "Compatible custom gamepad firmware detected";
      text = capabilities.persistent ? "Apply writes your mappings to the keyboard. The profile is retained after reconnecting." : "Apply activates mappings for this session. Export a file to retain them; this firmware does not advertise persistent storage.";
      if (draftDiffersFromKeyboard()) {
        title = "Local draft differs from keyboard";
        text = "Your local assignments are preserved. Apply to keyboard to activate this draft, or choose Read keyboard profile to replace it with the keyboard's settings. " + text;
        banner.classList.add("warning");
      }
    }
    banner.querySelector("strong").textContent = title; banner.querySelector("p").textContent = text;
  }
  function renderKeyboard() {
    const assignments = new Map(config.bindings.filter((b) => b.key !== null).map((b) => [b.key, b.control]));
    $("keyboard").innerHTML = M.ROWS.map((_, row) => `<div class="keyboard-row">${M.KEYS.filter((k) => k.uiRow === row).map((k) => `<button class="key${assignments.has(k.id) ? " bound" : ""}${selectedKey === k.id ? " selected" : ""}" style="--u:${k.width}" data-key="${k.id}" aria-label="${escape(k.label)}${assignments.has(k.id) ? `, ${escape(assignments.get(k.id))}` : ", unassigned"}" aria-pressed="${selectedKey === k.id}"><span>${escape(k.label)}</span><small>${assignments.has(k.id) ? icon(assignments.get(k.id)) : " "}</small></button>`).join("")}</div>`).join("");
    $("mappedCount").textContent = `${assignments.size} assigned`;
  }
  function renderControls() {
    const groups = [["TRIGGERS", M.CONTROLS.filter((c) => c.kind === "trigger")], ["THUMBSTICKS", M.CONTROLS.filter((c) => c.kind === "stick")], ["BUTTONS", M.CONTROLS.filter((c) => c.kind === "button")]];
    $("controlPicker").innerHTML = groups.map(([title, entries]) => `<div class="control-group"><span>${title}</span>${entries.map((entry) => { const b = config.bindings.find((item) => item.control === entry.id), key = b.key !== null ? M.KEYS[b.key] : null; return `<button data-control="${entry.id}" class="control-action${selectedControl === entry.id ? " active" : ""}${key ? " assigned" : ""}" title="${escape(entry.label)}" aria-label="${escape(entry.label)}${key ? `, assigned to ${escape(key.label)}` : ""}" aria-pressed="${selectedControl === entry.id}">${icon(entry.id)}${key ? `<small>${escape(key.label)}</small>` : ""}</button>`; }).join("")}</div>`).join("");
  }
  function renderEditor() {
    const b = binding(), control = M.CONTROL.get(selectedControl), key = M.KEYS[selectedKey];
    $("selectedKeyName").textContent = key.label;
    $("clearBinding").disabled = !config.bindings.some((item) => item.key === selectedKey);
    const limit = keyTravel(selectedKey);
    $("deviceTravel").textContent = limit ? limit.switchName ? `${limit.switchName} · using ${(limit.maxTravelUm / 1000).toFixed(2)} mm available switch travel.` : `Keyboard reports ${(limit.maxTravelUm / 1000).toFixed(2)} mm for ${key.label}.` : "Choose a switch in Performance or connect the keyboard to detect its travel.";
    $("editorError").textContent = travelError;
    if (!b || !control) {
      $("selectedAction").textContent = "Choose a controller action";
      $("selectedHint").textContent = `Choose a control below to assign it to ${key.label}.`;
      $("analogEditor").hidden = $("digitalEditor").hidden = true;
      $("tuningControl").textContent = "—";
      $("tuningLead").textContent = "Select an assigned key or choose a controller action to edit its travel window.";
      for (const id of rangeFields) $(id).value = "";
      return;
    }
    const digital = control.kind === "button";
    $("selectedAction").textContent = b.key === selectedKey ? control.label : `Assign ${control.label}`;
    $("selectedHint").textContent = b.key === selectedKey ? (digital ? "Follows this key’s actuation and Rapid Trigger" : "Analog travel mapping") : `Choose a control below to assign it to ${key.label}.`;
    $("analogEditor").hidden = digital; $("digitalEditor").hidden = !digital;
    $("tuningControl").textContent = selectedControl;
    $("tuningLead").textContent = digital ? "A digital controller button follows the keyboard’s own press and release state." : `Below the start is zero. At full output, ${control.kind === "trigger" ? "your trigger reaches 255" : "this direction reaches maximum deflection"}.`;
    ["startMm", "endMm", "maxTravelMm"].forEach((id) => { $(id).value = b[id].toFixed(2); });
    $("startMm").max = $("endMm").max = String(b.maxTravelMm);
    root.querySelectorAll("[data-curve]").forEach((button) => button.classList.toggle("active", button.dataset.curve === b.curve));
    $("curveDescription").textContent = b.curve === "linear" ? "A proportional response across your selected travel range." : "A gentle start and finish, with a more responsive middle.";
    drawCurve();
  }
  function renderSticks() {
    $("stickSettings").innerHTML = config.sticks.map((s, i) => `<div class="stick-setting"><strong>${i ? "Right" : "Left"} stick</strong><label><input type="checkbox" data-stick-circle="${i}" ${s.circular ? "checked" : ""}>Circular gate</label><label class="setting-policy">Opposing directions<select data-stick-policy="${i}"><option value="difference" ${s.opposition === "difference" ? "selected" : ""}>Subtract travel levels</option><option value="neutral" ${s.opposition === "neutral" ? "selected" : ""}>Neutral when both pressed</option><option value="deeper" ${s.opposition === "deeper" ? "selected" : ""}>Higher output wins</option></select></label><label class="setting-deadzone">Radial dead zone<input type="range" data-stick-deadzone="${i}" min="0" max="0.94" step="0.01" value="${s.deadzone}" ${!s.circular ? "disabled" : ""}><output>${Math.round(s.deadzone * 100)}%</output></label></div>`).join("");
  }
  function drawCurve() {
    const b = binding(), active = { ...b, key: b.key === null ? selectedKey : b.key }, points = [];
    for (let i = 0; i <= 100; i += 1) { const x = b.maxTravelMm * i / 100, y = M.level(active, x) / 10000; points.push(`${20 + 292 * i / 100},${130 - 118 * y}`); }
    $("curveLine").setAttribute("points", points.join(" ")); $("curveArea").setAttribute("d", `M20 130 L${points.join(" L")} L312 130 Z`); $("curveMax").textContent = `${b.maxTravelMm.toFixed(2)} mm`;
  }
  function render() {
    $("profileName").value = config.name; $("outputMode").value = config.mode; $("transportMode").value = config.transport;
    renderKeyboard(); renderControls(); renderEditor(); renderSticks(); updateCompatibility();
  }
  function change(mutator, fullRender = false) {
    const next = JSON.parse(JSON.stringify(config)); mutator(next);
    try { config = M.validate(next); hasLocalDraft = true; persist(); if (fullRender) render(); else { renderKeyboard(); renderControls(); renderEditor(); updateCompatibility(); } return true; }
    catch (error) { $("editorError").textContent = error.message; return false; }
  }
  function stopLive() {} // Retained for the shared connection handoff API.
  async function refreshCapabilities() {
    transport = getTransport(); capabilities = null; profileLoaded = false; usbState = null; usbSwitchPending = false; usbSwitchError = ""; hardwareProfile = null;
    if (!transport?.connected) { options.onCapabilities?.(null); updateCompatibility(); return; }
    const connection = transport;
    try {
      const found = await window.AE64GamepadProtocol.probe(connection);
      if (disposed || connection !== getTransport()) return;
      capabilities = found?.verified ? found : null;
    } catch (_) { if (disposed || connection !== getTransport()) return; capabilities = null; }
    if (!disposed) {
      if (usbSwitchSupported() && typeof window.AE64GamepadProtocol.readUsbState === "function") {
        try {
          const found = await window.AE64GamepadProtocol.readUsbState(connection);
          if (disposed || connection !== getTransport()) return;
          usbState = found; usbSwitchPending = found.phase !== 0;
        } catch (error) { if (disposed || connection !== getTransport()) return; usbSwitchError = error.message; }
      }
      options.onCapabilities?.(capabilities); $("deviceStatus").textContent = "Shared AE64 Pro connection"; updateCompatibility();
      if (!usbSwitchPending && capabilities?.verified && capabilities.protocolVersion === 1 && capabilities.boardId === 0x0030000a && capabilities.transports?.xinput) await readKeyboardProfile(true);
    }
  }
  async function connect() {
    if (busy || disposed) return;
    if (!getTransport()?.connected) { await options.onConnect?.(); if (!disposed) { await refreshCapabilities(); if (!profileLoaded) await refreshTravelDefaults(); } return; }
    await readKeyboardProfile();
  }
  async function changeUsbDevice() {
    if (disposed || busy || usbSwitchPending || !usbSwitchSupported() || !usbState || usbState.phase !== 0) { updateCompatibility(); return; }
    const enabled = Boolean($("usbDeviceEnabled").checked), connection = transport, previousCaps = capabilities, revision = usbState.revision;
    usbState = { ...usbState, targetEnabled: enabled }; usbSwitchPending = true; usbSwitchError = "";
    stopLive(true); setBusy(true); updateCompatibility();
    try {
      if (typeof options.onUsbDeviceChange === "function") {
        const result = await options.onUsbDeviceChange(enabled);
        if (disposed) return;
        if (result?.verified !== true || result.enabled !== enabled || !getTransport()?.connected) throw new Error("USB reconnect did not confirm the requested Xbox device state. Reconnect and read it again.");
        transport = getTransport(); capabilities = previousCaps;
        usbState = { enabled, targetEnabled: enabled, phase: 0, revision: Number.isInteger(result.revision) ? result.revision : revision };
        usbSwitchPending = false;
        notify(`Xbox controller device ${enabled ? "enabled" : "disabled"} and verified after USB reconnect. This setting lasts until power is disconnected.`);
      } else {
        const result = await window.AE64GamepadProtocol.setUsbEnabled(connection, enabled, revision);
        if (disposed) return;
        usbState = result;
        if (result.phase === 0 && result.enabled === enabled && connection === getTransport() && connection.connected) {
          const verified = await window.AE64GamepadProtocol.readUsbState(connection);
          if (disposed) return;
          if (connection !== getTransport() || !connection.connected || verified.phase !== 0 || verified.enabled !== enabled) throw new Error("Xbox device state could not be verified.");
          usbState = verified; usbSwitchPending = false;
          notify(`Xbox controller device is already ${enabled ? "enabled" : "disabled"}.`);
        } else notify("Xbox device change accepted. Waiting for USB reconnect; the new state has not been verified.");
      }
    } catch (error) {
      if (!disposed) {
        usbState = null; usbSwitchPending = false; usbSwitchError = error.message;
        transport = getTransport(); capabilities = transport?.connected ? previousCaps : null;
        notify(`Xbox device change was not confirmed: ${error.message}`, true);
      }
    } finally { setBusy(false); if (!disposed) updateCompatibility(); }
  }
  async function readKeyboardProfile(automatic = false) {
    if (busy || disposed || !getTransport()?.connected) return;
    setBusy(true); stopLive(true); updateCompatibility();
    const fingerprint = JSON.stringify(config), connection = getTransport();
    try {
      transport = getTransport();
      const result = await window.AE64GamepadProtocol.read(transport);
      if (disposed || connection !== getTransport() || !connection.connected) return;
      const changedWhileReading = JSON.stringify(config) !== fingerprint;
      if (!automatic && changedWhileReading) throw new Error("Your draft changed while reading. Read the keyboard profile again.");
      const observed = M.validate(result.config), preserveDraft = automatic && (hasLocalDraft || changedWhileReading);
      options.onRead?.(observed, transport);
      hardwareProfile = observed; capabilities = result; deviceLimits = [];
      options.onCapabilities?.(capabilities);
      if (!preserveDraft) {
        config = M.validate(observed); automaticTravel = new Set(config.bindings.filter(legacyDefault).map((b) => b.control)); automaticMaximum = new Set(config.bindings.filter((b) => b.maxTravelMm === 4).map((b) => b.control));
      }
      hasLocalDraft = draftDiffersFromKeyboard();
      if (usbSwitchSupported() && typeof window.AE64GamepadProtocol.readUsbState === "function" && (!automatic || !usbState)) {
        try {
          const found = await window.AE64GamepadProtocol.readUsbState(connection);
          if (disposed || connection !== getTransport() || !connection.connected) return;
          usbState = found; usbSwitchPending = found.phase !== 0; usbSwitchError = "";
        } catch (error) { if (disposed || connection !== getTransport()) return; usbState = null; usbSwitchError = error.message; }
      }
      const original = JSON.stringify(config); await refreshTravelDefaults(); if (disposed || connection !== getTransport() || !connection.connected) return;
      profileLoaded = true; $("deviceStatus").textContent = preserveDraft ? "Keyboard profile read · local draft preserved" : "Keyboard gamepad profile loaded";
      if (preserveDraft && draftDiffersFromKeyboard()) notify("Keyboard profile read. Your local draft differs and was preserved. Apply to keyboard to activate it, or Read keyboard profile to replace it.");
      else if (!automatic || original !== JSON.stringify(config)) notify(original === JSON.stringify(config) ? "Keyboard gamepad profile read. Your local draft now matches the keyboard." : "Keyboard profile read. Default travel windows now match your switches; Apply to activate the adjusted draft.");
    } catch (error) { if (!disposed && connection === getTransport()) notify(automatic ? `Could not read the gamepad profile automatically. Use Read keyboard profile to retry. ${error.message}` : error.message, true); }
    finally { setBusy(false); if (!disposed) updateCompatibility(); }
  }
  $("keyboard").addEventListener("click", (event) => { const key = event.target.closest("[data-key]"); if (!key) return; selectedKey = Number(key.dataset.key); const current = config.bindings.find((b) => b.key === selectedKey); selectedControl = current?.control || null; renderKeyboard(); renderControls(); renderEditor(); });
  function assignControl(control, key = selectedKey) {
    if (disposed || !M.KEYS[key] || !M.CONTROL.has(control)) return;
    selectedKey = key;
    selectedControl = control;
    change((next) => {
      next.bindings.forEach((item) => { if (item.key === key) item.key = null; });
      const nextBinding = next.bindings.find((item) => item.control === control);
      const known = keyTravel(key);
      nextBinding.key = key;
      if (!known) return;
      const maximum = known.maxTravelUm / 1000;
      if (automaticTravel.has(control)) Object.assign(nextBinding, M.defaultTravel(maximum));
      else {
        nextBinding.maxTravelMm = maximum;
        nextBinding.endMm = Math.min(nextBinding.endMm, maximum);
        nextBinding.startMm = Math.min(nextBinding.startMm, Math.max(0, nextBinding.endMm - 0.001));
      }
    });
    refreshTravelDefaults();
  }
  function removeAssignment(key = selectedKey) {
    if (disposed || !M.KEYS[key] || !config.bindings.some((item) => item.key === key)) return;
    selectedKey = key;
    selectedControl = null;
    change((next) => next.bindings.forEach((item) => { if (item.key === key) item.key = null; }));
  }
  $("controlPicker").addEventListener("click", (event) => assignControl(event.target.closest("[data-control]")?.dataset.control));
  $("clearBinding").addEventListener("click", () => removeAssignment());
  for (const id of ["startMm", "endMm", "maxTravelMm"]) $(id).addEventListener("change", () => {
    if (!binding()) return;
    const values = Object.fromEntries(["startMm", "endMm", "maxTravelMm"].map((field) => [field, Number($(field).value)]));
    if (change((next) => Object.assign(next.bindings.find((b) => b.control === selectedControl), values))) { automaticTravel.delete(selectedControl); if (id === "maxTravelMm") automaticMaximum.delete(selectedControl); persist(); }
  });
  $("curveSelector").addEventListener("click", (event) => { const button = event.target.closest("[data-curve]"); if (button && binding()) change((next) => { next.bindings.find((b) => b.control === selectedControl).curve = button.dataset.curve; }); });
  $("stickSettings").addEventListener("change", (event) => { const el = event.target; if (el.dataset.stickCircle !== undefined) change((next) => { const s = next.sticks[Number(el.dataset.stickCircle)]; s.circular = el.checked; if (!s.circular) s.deadzone = 0; }, true); else if (el.dataset.stickPolicy !== undefined) change((next) => { next.sticks[Number(el.dataset.stickPolicy)].opposition = el.value; }, true); else if (el.dataset.stickDeadzone !== undefined) change((next) => { next.sticks[Number(el.dataset.stickDeadzone)].deadzone = Number(el.value); }, true); });
  $("stickSettings").addEventListener("input", (event) => { const el = event.target; if (el.dataset.stickDeadzone !== undefined) el.nextElementSibling.textContent = `${Math.round(Number(el.value) * 100)}%`; });
  $("profileName").addEventListener("change", () => change((next) => { next.name = $("profileName").value.trim(); }));
  $("outputMode").addEventListener("change", () => { stopLive(true); change((next) => { next.mode = $("outputMode").value; }); });
  $("transportMode").addEventListener("change", () => change((next) => { next.transport = $("transportMode").value; }));
  $("connect").addEventListener("click", connect);
  $("usbDeviceEnabled").addEventListener("change", changeUsbDevice);
  $("matchTravel").addEventListener("click", async () => {
    if (!transport?.connected || busy) return;
    stopLive(true); setBusy(true); updateCompatibility();
    try { await refreshTravelDefaults(true); }
    finally { setBusy(false); if (!disposed) updateCompatibility(); }
  });
  $("apply").addEventListener("click", async () => {
    if (!compatible() || busy || !window.AE64GamepadProtocol?.upload) return;
    stopLive(true); setBusy(true); updateCompatibility();
    const snapshot = M.validate(config), fingerprint = JSON.stringify(snapshot);
    try { const result = await window.AE64GamepadProtocol.upload(transport, snapshot, options.getUploadOptions?.()); if (result?.verified === true) { hardwareProfile = M.validate(snapshot); hasLocalDraft = draftDiffersFromKeyboard(); persist(); options.onApplied?.(snapshot, transport); } notify(JSON.stringify(config) !== fingerprint ? "The earlier profile was applied. Your newer edits remain a local draft." : (result?.persistent === true ? "Profile applied and saved to the keyboard." : "Profile applied for this session. Keep an exported copy.")); }
    catch (error) { $("editorError").textContent = error.message; notify(error.rejected ? error.message : `Profile not applied or confirmed: ${error.message}`, true); }
    finally { setBusy(false); if (!disposed) updateCompatibility(); }
  });
  $("export").addEventListener("click", () => { const blob = new Blob([JSON.stringify(M.validate(config), null, 2) + "\n"], { type: "application/json" }), url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = `${config.name.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 50) || "ae64-gamepad"}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
  $("import").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", async () => { const file = $("importFile").files[0]; try { if (!file) return; if (file.size > 65536) throw new Error("Choose a profile file smaller than 64 KB."); const next = M.validate(JSON.parse(await file.text())); stopLive(true); config = next; hasLocalDraft = true; automaticTravel.clear(); automaticMaximum.clear(); persist(); render(); await refreshTravelDefaults(); notify("Profile imported. Nothing was written to the keyboard."); } catch (error) { notify(error.message, true); } finally { $("importFile").value = ""; } });
  $("restoreDefaults").addEventListener("click", async () => { stopLive(true); config = M.defaults(); hasLocalDraft = true; automaticTravel = new Set(M.CONTROLS.map((c) => c.id)); automaticMaximum = new Set(automaticTravel); useAutomaticTravel(); selectedKey = 15; selectedControl = null; persist(); render(); await refreshTravelDefaults(); notify("Example profile restored using your switches' travel limits. Nothing was written to the keyboard."); });
  const onDisconnect = (event) => {
    if (disposed || event.device !== transport?.device) return;
    stopLive(true); transport = null; capabilities = null; profileLoaded = false; deviceLimits = []; travelGeneration++; usbState = null; options.onCapabilities?.(null); updateCompatibility();
    if (!usbSwitchPending) notify("Keyboard disconnected. Profile and travel limits will be read after reconnecting.");
  };
  navigator.hid?.addEventListener("disconnect", onDisconnect);
  root.querySelectorAll("[data-gamepad-performance]").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); options.onNavigate?.("performance"); }));
  try { useAutomaticTravel(); } catch (error) { travelError = error.message; } render();
  const ready = (async () => { await refreshCapabilities(); if (!disposed && !profileLoaded) await refreshTravelDefaults(); })();
  return {
    ready,
    assignControl,
    removeAssignment,
    isBusy: () => busy,
    stopLive: () => { if (!disposed) stopLive(true); },
    dispose() {
      if (disposed) return;
      if (busy) setBusy(false);
      disposed = true; travelGeneration++;
      navigator.hid?.removeEventListener("disconnect", onDisconnect);
      // The main application owns and retains the shared HID transport.
    },
  };
  }
  window.AE64GamepadStudio = Object.freeze({ mount });
})();
