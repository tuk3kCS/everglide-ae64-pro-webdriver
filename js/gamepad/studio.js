/* Original independent configuration UI. No firmware flashing. SPDX-License-Identifier: MIT */
(function () {
  "use strict";
  function mount(root, options = {}) {
  let disposed = false;
  const getTransport = options.getTransport || (() => null);
  const storage = options.storage || localStorage;
  const M = window.AE64GamepadModel, $ = (id) => root.querySelector(`#${id}`), STORAGE = (globalThis.AE64_STORAGE_PREFIX || "") + "ae64-gamepad-studio-v1";
  const icon = (control) => window.AE64ControllerIcons.html(control);
  const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  let config = M.emptyProfile(), selectedKey = 15, selectedControl = null, transport = getTransport(), capabilities = null, busy = false, profileLoaded = false;
  let deviceLimits = [], travelGeneration = 0, travelError = "", travelRead = null;
  let usbState = null, usbSwitchPending = false, usbSwitchError = "";
  let hasLocalDraft = false, hardwareProfile = null;
  let selectedPoint = 0, curveDrag = null;
  const rangeFields = ["startMm", "endMm", "maxTravelMm"], signature = (b) => [b.key, ...rangeFields.map((field) => b[field])];
  const graph = $("curveGraph"), chart = { left: 33, bottom: 145, width: 279, height: 130 };
  const coordinates = ([x, y]) => [chart.left + x * chart.width / M.CURVE_MAX, chart.bottom - y * chart.height / M.CURVE_MAX];
  const plotPoints = (points) => [[0, 0], [points[0][0], 0], ...points, [M.CURVE_MAX, points[3][1]]];
  const formatTravel = (mm) => mm.toFixed(3);
  const pointTravel = (binding, x) => binding.startMm + (binding.endMm - binding.startMm) * x / M.CURVE_MAX;
  const travelBounds = (points, i) => [i === 0 ? 0 : points[i - 1][0] + 1, i === 3 ? M.CURVE_MAX : points[i + 1][0] - 1];
  const profileFingerprint = (value) => JSON.stringify([value.mode, value.transport, value.bindings, value.sticks]);
  const legacyDefault = (b) => b.startMm === 0.5 && b.endMm === 3.5 && b.maxTravelMm === 4;
  let automaticTravel = new Set(M.CONTROLS.map((c) => c.id));
  let automaticMaximum = new Set(automaticTravel);
  try {
    const saved = storage.getItem(STORAGE);
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
  const selection = options.selection;
  if (selection && M.KEYS[selection.key]) {
    selectedKey = selection.key;
    selectedControl = config.bindings.find((b) => b.key === selectedKey)?.control || null;
    if (selectedControl === selection.control) selectedPoint = selection.point;
  }
  function notify(message, error = false) { if (!disposed) options.notify?.(message, error); }
  function setBusy(value) { busy = value; if (!disposed) options.onBusy?.(value); }

  function persist() { try { storage.setItem(STORAGE, JSON.stringify({ ...config, keyboardFingerprint: hardwareProfile ? profileFingerprint(hardwareProfile) : null, automaticTravel: config.bindings.filter((b) => automaticTravel.has(b.control)).map((b) => ({ control: b.control, values: signature(b) })), automaticMaximum: config.bindings.filter((b) => automaticMaximum.has(b.control)).map((b) => ({ control: b.control, key: b.key, maxTravelMm: b.maxTravelMm })) })); } catch (_) { notify("This browser could not save the gamepad draft.", true); } }
  function keyTravel(key) {
    if (key === null) return null;
    const selected = options.getKeyTravel?.(M.KEYS[key]), known = deviceLimits.find((item) => item.key === key) || selected;
    return Number.isInteger(known?.maxTravelUm) && known.maxTravelUm >= 10 && known.maxTravelUm <= 10000 ? known : null;
  }
  function useAutomaticTravel() {
    const next = M.validate(config);
    for (const b of next.bindings) {
      if (!b.curve) continue;
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
  async function refreshTravelDefaults() {
    if (travelRead) return travelRead;
    const pending = readTravelDefaults(); travelRead = pending;
    try { return await pending; }
    finally { if (travelRead === pending) travelRead = null; }
  }
  async function readTravelDefaults() {
    const connection = getTransport(), token = ++travelGeneration;
    const canRead = connection?.connected && (options.readKeyTravel || connection.getPerformance);
    if (canRead) {
      $("travelSyncStatus").textContent = "Reading keyboard travel limits automatically…";
      const missing = M.KEYS.filter((key) => !deviceLimits.some((item) => item.key === key.id));
      const results = await Promise.allSettled(missing.map(async (key) => {
        const value = options.readKeyTravel ? await options.readKeyTravel(key, connection) : { key: key.id, maxTravelUm: (await connection.getPerformance(key)).axisRangeMax };
        if (!Number.isInteger(value?.maxTravelUm) || value.maxTravelUm < 10 || value.maxTravelUm > 10000) throw new Error(`${key.label}: switch travel is unavailable.`);
        return value;
      }));
      if (disposed || token !== travelGeneration || connection !== getTransport() || !connection.connected) return;
      for (const result of results) if (result.status === "fulfilled") {
        deviceLimits = deviceLimits.filter((item) => item.key !== result.value.key);deviceLimits.push(result.value);
      }
      if (missing.length) travelError = results.find((result) => result.status === "rejected")?.reason?.message || "";
    }
    if (disposed || token !== travelGeneration) return;
    try { useAutomaticTravel(); } catch (error) { travelError = error.message; }
    if (options.sharedApply && hardwareProfile && draftDiffersFromKeyboard()) hasLocalDraft = true;
    persist(); render();
    $("travelSyncStatus").textContent = travelError ? `Some travel limits need attention: ${travelError}`
      : canRead ? `Travel limits read automatically · ${deviceLimits.length} keys. Adjusted ranges are a local draft until Apply.`
      : connection?.connected ? "Using available switch settings; this connection cannot read travel limits." : "Travel limits will be read automatically when the keyboard connects.";
  }
  const binding = () => config.bindings.find((b) => b.control === selectedControl);
  function compatible() { return Boolean(!usbSwitchPending && transport?.connected && capabilities?.verified === true && capabilities.curvePoints === true && capabilities.protocolVersion === 1 && capabilities.boardId === 0x0030000A && (config.mode === "off" || capabilities.transports?.[config.transport] === true)); }
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
    $("connect").hidden = Boolean(transport?.connected);
    $("deviceStatus").classList.toggle("connected", Boolean(transport?.connected));
    if (!options.sharedApply) $("apply").disabled = !compatible() || busy;
    const banner = $("compatibility"); banner.classList.remove("warning");
    let title = "Ready to design your profile", text = "Connect to read the keyboard profile and switch travel limits automatically.";
    if (transport?.connected && !capabilities?.verified) { title = "Keyboard connected"; text = "You can preview switch travel and design mappings. Controller output requires compatible custom firmware."; banner.classList.add("warning"); }
    else if (capabilities?.verified && capabilities.curvePoints !== true) { title = "Four-point curves require custom firmware v0.10"; text = "Flash v0.10 or later to read and apply onboard gamepad profiles."; banner.classList.add("warning"); }
    else if (capabilities?.verified && !compatible()) { title = "This controller type is unavailable on the connected firmware"; text = config.transport === "xinput" ? "Native Xbox / XInput support is required for this profile. A USB HID gamepad is a separate fallback." : "The connected firmware does not advertise a USB HID gamepad output."; banner.classList.add("warning"); }
    else if (compatible()) {
      title = "Compatible custom gamepad firmware detected";
      text = capabilities.persistent ? "Apply saves your mappings to the onboard profile. Use My Profiles for JSON backups." : "Apply activates mappings for the current powered session.";
      if (draftDiffersFromKeyboard()) {
        title = "Local draft differs from keyboard";
        text = options.sharedApply ? "Use Apply changes to save this draft or Revert to restore the onboard assignments." : "Apply to keyboard to save this draft.";
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
    $("tuningLead").textContent = digital ? "A digital controller button follows the keyboard’s own press and release state." : "Set the travel window and shape its controller output.";
    if (digital) return;
    rangeFields.forEach((id) => { $(id).value = formatTravel(b[id]); });
    const maximum = limit ? Math.min(b.maxTravelMm, limit.maxTravelUm / 1000) : b.maxTravelMm;
    $("startMm").max = $("endMm").max = String(maximum);
    if (b.endMm > maximum) $("editorError").textContent = `Lower full output to ${formatTravel(maximum)} mm or less to fit this switch.`;
    drawCurve(b, curveDrag?.control === b.control ? curveDrag.points : b.curve);
  }
  function renderSticks() {
    $("stickSettings").innerHTML = config.sticks.map((s, i) => `<div class="stick-setting"><strong>${i ? "Right" : "Left"} stick</strong><label><input type="checkbox" data-stick-circle="${i}" ${s.circular ? "checked" : ""}>Circular gate</label><label class="setting-policy">Opposing directions<select data-stick-policy="${i}"><option value="difference" ${s.opposition === "difference" ? "selected" : ""}>Subtract travel levels</option><option value="neutral" ${s.opposition === "neutral" ? "selected" : ""}>Neutral when both pressed</option><option value="deeper" ${s.opposition === "deeper" ? "selected" : ""}>Higher output wins</option></select></label><label class="setting-deadzone">Radial dead zone<input type="range" data-stick-deadzone="${i}" min="0" max="0.94" step="0.01" value="${s.deadzone}" ${!s.circular ? "disabled" : ""}><output>${Math.round(s.deadzone * 100)}%</output></label></div>`).join("");
  }
  function drawCurve(b, points) {
    const preset = M.curvePreset(points), plot = plotPoints(points).map(coordinates);
    $("curveDescription").textContent = preset?.label || "Custom";
    $("curveLine").setAttribute("points", plot.join(" "));
    $("curveArea").setAttribute("d", `M${plot.join(" L")} L312 145 Z`);
    $("curveMin").textContent = `${formatTravel(b.startMm)} mm`;
    $("curveMax").textContent = `${formatTravel(b.endMm)} mm`;
    for (const button of root.querySelectorAll("[data-curve]")) {
      const active = button.dataset.curve === preset?.id;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    for (const handle of root.querySelectorAll("[data-curve-point]")) {
      const i = Number(handle.dataset.curvePoint), [x, y] = coordinates(points[i]);
      const depth = formatTravel(pointTravel(b, points[i][0]));
      const label = `Point ${i + 1}, ${depth} mm, output ${points[i][1]} of ${M.CURVE_MAX}`;
      handle.setAttribute("cx", x);
      handle.setAttribute("cy", y);
      handle.setAttribute("aria-label", label);
      handle.classList.toggle("active", i === selectedPoint);
      handle.querySelector("title").textContent = label;
    }
    const [x, y] = points[selectedPoint], [min, max] = travelBounds(points, selectedPoint), travel = $("curvePointTravel");
    $("curvePoint").value = String(selectedPoint);
    travel.min = formatTravel(pointTravel(b, min));
    travel.max = formatTravel(pointTravel(b, max));
    travel.value = formatTravel(pointTravel(b, x));
    $("curvePointOutput").value = String(y);
  }
  function moveCurvePoint(points, i, x, y) {
    const [left, right] = travelBounds(points, i);
    points[i] = [M.clamp(Math.round(x), left, right), M.clamp(Math.round(y), 0, M.CURVE_MAX)];
  }
  function setCurve(points) {
    const b = binding();
    if (b?.curve && JSON.stringify(points) !== JSON.stringify(b.curve))
      change((next) => { next.bindings.find((item) => item.control === b.control).curve = points; });
    else if (b?.curve) drawCurve(b, b.curve);
  }
  function render() {
    $("profileName").value = config.name; $("outputMode").value = config.mode; $("transportMode").value = config.transport;
    renderKeyboard(); renderControls(); renderEditor(); renderSticks(); updateCompatibility();
  }
  function change(mutator, fullRender = false) {
    if (options.canEdit?.() === false) { notify("Revert the draft for the previous keyboard or profile before editing this one.", true); render(); return false; }
    const previous = config, next = JSON.parse(JSON.stringify(config)); mutator(next);
    try { config = M.validate(next); hasLocalDraft = true; persist(); options.onDraft?.(config, previous); if (fullRender) render(); else { renderKeyboard(); renderControls(); renderEditor(); updateCompatibility(); } return true; }
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
      if (!usbSwitchPending && capabilities?.verified && capabilities.curvePoints === true && capabilities.protocolVersion === 1 && capabilities.boardId === 0x0030000a && capabilities.transports?.xinput) await readKeyboardProfile();
    }
  }
  async function connect() {
    if (busy || disposed || getTransport()?.connected) return;
    await options.onConnect?.();
    if (disposed) return;
    await refreshCapabilities();
    if (!profileLoaded) await refreshTravelDefaults();
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
  async function readKeyboardProfile() {
    if (busy || disposed || !getTransport()?.connected) return;
    setBusy(true); stopLive(true); updateCompatibility();
    const fingerprint = JSON.stringify(config), connection = getTransport();
    try {
      transport = getTransport();
      const result = await window.AE64GamepadProtocol.read(transport);
      if (disposed || connection !== getTransport() || !connection.connected) return;
      const observed = M.validate(result.config), preserveDraft = hasLocalDraft || JSON.stringify(config) !== fingerprint;
      options.onRead?.(observed, transport);
      hardwareProfile = observed; capabilities = result; deviceLimits = [];
      options.onCapabilities?.(capabilities);
      if (!preserveDraft) {
        config = M.validate(observed); automaticTravel = new Set(config.bindings.filter(legacyDefault).map((b) => b.control)); automaticMaximum = new Set(config.bindings.filter((b) => b.maxTravelMm === 4).map((b) => b.control));
        if (selectedControl) selectedControl = config.bindings.find((b) => b.key === selectedKey)?.control || null;
      }
      hasLocalDraft = draftDiffersFromKeyboard();
      if (usbSwitchSupported() && typeof window.AE64GamepadProtocol.readUsbState === "function" && !usbState) {
        try {
          const found = await window.AE64GamepadProtocol.readUsbState(connection);
          if (disposed || connection !== getTransport() || !connection.connected) return;
          usbState = found; usbSwitchPending = found.phase !== 0; usbSwitchError = "";
        } catch (error) { if (disposed || connection !== getTransport()) return; usbState = null; usbSwitchError = error.message; }
      }
      const original = JSON.stringify(config); await refreshTravelDefaults(); if (disposed || connection !== getTransport() || !connection.connected) return;
      profileLoaded = true; $("deviceStatus").textContent = preserveDraft ? "Keyboard profile read · local draft preserved" : "Keyboard gamepad profile loaded";
      if (preserveDraft && draftDiffersFromKeyboard()) notify("Keyboard profile read. Your local draft was preserved.");
      else if (original !== JSON.stringify(config)) notify("Default travel windows now match your switches. Apply to activate the adjusted draft.");
      if (options.sharedApply && draftDiffersFromKeyboard() && !preserveDraft)
        options.onDraft?.(config, hardwareProfile, { automatic: false });
    } catch (error) { if (!disposed && connection === getTransport()) notify(`Could not read the onboard gamepad profile. The next settings refresh can retry. ${error.message}`, true); }
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
      if (!known || !nextBinding.curve) return;
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
  $("curveSelector").innerHTML = M.CURVE_PRESETS.map(({ id, label, points }) =>
    `<button type="button" data-curve="${id}" aria-pressed="false"><svg viewBox="0 0 44 24" aria-hidden="true"><polyline points="${plotPoints(points).map(([x, y]) => [2 + 40 * x / M.CURVE_MAX, 22 - 20 * y / M.CURVE_MAX]).join(" ")}"></polyline></svg><span>${label}</span></button>`).join("");
  $("curveSelector").addEventListener("click", (event) => {
    const preset = M.CURVE_PRESETS.find(({ id }) => id === event.target.closest("[data-curve]")?.dataset.curve);
    if (preset) setCurve(preset.points);
  });
  $("curvePoint").addEventListener("change", (event) => {
    selectedPoint = Number(event.target.value);
    const b = binding();
    if (b?.curve) drawCurve(b, b.curve);
  });
  for (const id of ["curvePointTravel", "curvePointOutput"]) $(id).addEventListener("change", (event) => {
    const b = binding(), value = event.target.valueAsNumber;
    if (!b?.curve) return;
    if (!Number.isFinite(value)) { drawCurve(b, b.curve); return; }
    const points = b.curve.slice(), [x, y] = points[selectedPoint], travelEdit = id === "curvePointTravel";
    if (travelEdit && value === Number(formatTravel(pointTravel(b, x)))) { drawCurve(b, b.curve); return; }
    const anchorX = travelEdit ? (M.um(value) - M.um(b.startMm)) * M.CURVE_MAX / (M.um(b.endMm) - M.um(b.startMm)) : x;
    moveCurvePoint(points, selectedPoint, anchorX, travelEdit ? y : value);
    setCurve(points);
  });
  $("curvePointTravel").addEventListener("keydown", (event) => {
    const b = binding();
    if (!b?.curve || busy || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const points = b.curve.slice(), [x, y] = points[selectedPoint];
    moveCurvePoint(points, selectedPoint, x + (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1), y);
    setCurve(points);
  });
  graph.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest("[data-curve-point]"), b = binding();
    if (!handle || event.button !== 0 || curveDrag || busy || !b?.curve || options.canEdit?.() === false) return;
    selectedPoint = Number(handle.dataset.curvePoint);
    curveDrag = { pointer: event.pointerId, control: b.control, point: selectedPoint, points: b.curve.slice() };
    graph.setPointerCapture(event.pointerId);
    drawCurve(b, b.curve);
  });
  graph.addEventListener("pointermove", (event) => {
    if (!curveDrag || curveDrag.pointer !== event.pointerId) return;
    const b = binding(), matrix = graph.getScreenCTM();
    if (!matrix || b?.control !== curveDrag.control) return;
    const point = graph.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const { x, y } = point.matrixTransform(matrix.inverse());
    moveCurvePoint(curveDrag.points, curveDrag.point, (x - chart.left) * M.CURVE_MAX / chart.width, (chart.bottom - y) * M.CURVE_MAX / chart.height);
    drawCurve(b, curveDrag.points);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) graph.addEventListener(type, (event) => {
    if (!curveDrag || curveDrag.pointer !== event.pointerId) return;
    const { points, control } = curveDrag, b = binding();
    curveDrag = null;
    if (b?.control !== control) return;
    if (type === "pointerup") setCurve(points);
    else drawCurve(b, b.curve);
  });
  graph.addEventListener("keydown", (event) => {
    const handle = event.target.closest("[data-curve-point]"), b = binding();
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowDown: [0, -1], ArrowUp: [0, 1] }[event.key];
    if (!handle || !direction || !b?.curve || busy) return;
    event.preventDefault();
    selectedPoint = Number(handle.dataset.curvePoint);
    const points = b.curve.slice(), [x, y] = points[selectedPoint], step = event.shiftKey ? 10 : 1;
    moveCurvePoint(points, selectedPoint, x + direction[0] * step, y + direction[1] * step);
    setCurve(points);
  });
  $("stickSettings").addEventListener("change", (event) => { const el = event.target; if (el.dataset.stickCircle !== undefined) change((next) => { const s = next.sticks[Number(el.dataset.stickCircle)]; s.circular = el.checked; if (!s.circular) s.deadzone = 0; }, true); else if (el.dataset.stickPolicy !== undefined) change((next) => { next.sticks[Number(el.dataset.stickPolicy)].opposition = el.value; }, true); else if (el.dataset.stickDeadzone !== undefined) change((next) => { next.sticks[Number(el.dataset.stickDeadzone)].deadzone = Number(el.value); }, true); });
  $("stickSettings").addEventListener("input", (event) => { const el = event.target; if (el.dataset.stickDeadzone !== undefined) el.nextElementSibling.textContent = `${Math.round(Number(el.value) * 100)}%`; });
  $("profileName").addEventListener("change", () => change((next) => { next.name = $("profileName").value.trim(); }));
  $("outputMode").addEventListener("change", () => { stopLive(true); change((next) => { next.mode = $("outputMode").value; }); });
  $("transportMode").addEventListener("change", () => change((next) => { next.transport = $("transportMode").value; }));
  $("connect").addEventListener("click", connect);
  $("usbDeviceEnabled").addEventListener("change", changeUsbDevice);
  if (options.sharedApply) $("apply").parentElement?.remove();
  else $("apply").addEventListener("click", async () => {
    if (!compatible() || busy || !window.AE64GamepadProtocol?.upload) return;
    stopLive(true); setBusy(true); updateCompatibility();
    const snapshot = M.validate(config), fingerprint = JSON.stringify(snapshot);
    try { const result = await window.AE64GamepadProtocol.upload(transport, snapshot, options.getUploadOptions?.()); if (result?.verified === true) { hardwareProfile = M.validate(snapshot); hasLocalDraft = draftDiffersFromKeyboard(); persist(); options.onApplied?.(snapshot, transport); } notify(JSON.stringify(config) !== fingerprint ? "The earlier profile was applied. Your newer edits remain a local draft." : (result?.persistent === true ? "Profile applied and saved to the keyboard." : "Profile applied for this session. Keep an exported copy.")); }
    catch (error) { $("editorError").textContent = error.message; notify(error.rejected ? error.message : `Profile not applied or confirmed: ${error.message}`, true); }
    finally { setBusy(false); if (!disposed) updateCompatibility(); }
  });
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
    getSelection: () => ({ key: selectedKey, control: selectedControl, point: selectedPoint }),
    isBusy: () => busy,
    acceptSettingsRefresh(result, usb, connection) {
      if (disposed || busy || !connection?.connected || connection !== getTransport() || curveDrag) return;
      const previousLimits = deviceLimits, previousError = travelError, priorUsb = usbState;
      const before = profileFingerprint(config), previousHardware = hardwareProfile && profileFingerprint(hardwareProfile);
      if (options.getKeyTravel) {
        travelGeneration++;
        deviceLimits = M.KEYS.map((key) => options.getKeyTravel(key)).filter((limit) =>
          Number.isInteger(limit?.maxTravelUm) && limit.maxTravelUm >= 10 && limit.maxTravelUm <= 10000);
        travelError = deviceLimits.length === M.KEYS.length ? "" : "Some switch travel limits are unavailable.";
        $("travelSyncStatus").textContent = travelError || `Travel limits read automatically · ${deviceLimits.length} keys.`;
      }
      if (result) {
        const observed = M.validate(result.config);
        if (!hasLocalDraft && !draftDiffersFromKeyboard() && before !== profileFingerprint(observed)) {
          config = observed;
          automaticTravel = new Set(config.bindings.filter(legacyDefault).map((b) => b.control));
          automaticMaximum = new Set(config.bindings.filter((b) => b.maxTravelMm === 4).map((b) => b.control));
          selectedControl = config.bindings.find((b) => b.key === selectedKey)?.control || null;
        }
        transport = connection;
        hardwareProfile = observed;
        capabilities = result;
        profileLoaded = true;
        hasLocalDraft = draftDiffersFromKeyboard();
        options.onCapabilities?.(capabilities);
        $("deviceStatus").textContent = hasLocalDraft ? "Keyboard profile read · local draft preserved" : "Keyboard gamepad profile loaded";
      }
      if (usb) { usbState = usb; usbSwitchPending = usb.phase !== 0; usbSwitchError = ""; }
      const profileChanged = result && (before !== profileFingerprint(config) || previousHardware !== profileFingerprint(hardwareProfile));
      if (profileChanged) persist();
      if (profileChanged || previousError !== travelError || JSON.stringify(priorUsb) !== JSON.stringify(usbState) ||
          JSON.stringify(previousLimits) !== JSON.stringify(deviceLimits)) render();
      else updateCompatibility();
    },
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
