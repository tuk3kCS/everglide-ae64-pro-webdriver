/* Original independent configuration UI. No firmware flashing. SPDX-License-Identifier: MIT */
(function () {
  "use strict";
  function mount(root, options = {}) {
  let disposed = false;
  const getTransport = options.getTransport || (() => null);
  const M = window.AE64GamepadModel, $ = (id) => root.querySelector(`#${id}`), STORAGE = "ae64-gamepad-studio-v1";
  const icon = (control) => window.AE64ControllerIcons.html(control);
  const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  let config = M.defaults(), selectedKey = 15, selectedControl = "LT", transport = getTransport(), capabilities = null, live = false, generation = 0, busy = false, toastTimer, profileLoaded = false;
  let travels = Array(64).fill(0), pressed = Array(64).fill(false), source = "simulator", lastRead = 0, deviceLimits = [];
  const rangeFields = ["startMm", "endMm", "maxTravelMm"], signature = (b) => [b.key, ...rangeFields.map((field) => b[field])];
  const legacyDefault = (b) => b.startMm === 0.5 && b.endMm === 3.5 && b.maxTravelMm === 4;
  let automaticTravel = new Set(M.CONTROLS.map((c) => c.id));
  let automaticMaximum = new Set(automaticTravel);
  try {
    const saved = localStorage.getItem(STORAGE);
    if (saved) {
      const value = JSON.parse(saved); config = M.validate(value);
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

  function persist() { try { localStorage.setItem(STORAGE, JSON.stringify({ ...config, automaticTravel: config.bindings.filter((b) => automaticTravel.has(b.control)).map((b) => ({ control: b.control, values: signature(b) })), automaticMaximum: config.bindings.filter((b) => automaticMaximum.has(b.control)).map((b) => ({ control: b.control, key: b.key, maxTravelMm: b.maxTravelMm })) })); } catch (_) { notify("This browser could not save the draft. Export a profile file to keep it.", true); } }
  function keyTravel(key) {
    if (key === null) return null;
    const selected = options.getKeyTravel?.(M.KEYS[key]), known = selected || deviceLimits.find((item) => item.key === key);
    return Number.isInteger(known?.maxTravelUm) && known.maxTravelUm >= 10 && known.maxTravelUm <= 10000 ? known : null;
  }
  function useAutomaticTravel() {
    for (const b of config.bindings) {
      const known = keyTravel(b.key);
      if (automaticTravel.has(b.control) && known) Object.assign(b, M.defaultTravel(known.maxTravelUm / 1000));
      else if (automaticMaximum.has(b.control) && known) {
        b.maxTravelMm = known.maxTravelUm / 1000;b.endMm = Math.min(b.endMm, b.maxTravelMm);b.startMm = Math.min(b.startMm, Math.max(0, b.endMm - 0.001));
      }
    }
    config = M.validate(config);
  }
  async function refreshTravelDefaults() {
    const connection = getTransport();
    if (connection?.connected) {
      const missing = [...new Set(config.bindings.filter((b) => b.key !== null && !keyTravel(b.key)).map((b) => b.key))];
      const results = await Promise.allSettled(missing.map(async (key) => {
        if (options.readKeyTravel) return options.readKeyTravel(M.KEYS[key]);
        if (!connection.getPerformance) return null;
        const performance = await connection.getPerformance(M.KEYS[key]);return { key, maxTravelUm: performance.axisRangeMax };
      }));
      if (disposed || connection !== getTransport()) return;
      for (const result of results) if (result.status === "fulfilled" && result.value) {
        deviceLimits = deviceLimits.filter((item) => item.key !== result.value.key);deviceLimits.push(result.value);
      }
    }
    if (!disposed) { useAutomaticTravel(); persist(); render(); }
  }
  const binding = () => config.bindings.find((b) => b.control === selectedControl);
  function compatible() { return Boolean(transport?.connected && capabilities?.verified === true && capabilities.protocolVersion === 1 && capabilities.boardId === 0x0030000A && (config.mode === "off" || capabilities.transports?.[config.transport] === true)); }
  function updateCompatibility() {
    $("connect").textContent = transport?.connected ? "Read keyboard profile" : "Connect keyboard";
    $("deviceStatus").classList.toggle("connected", Boolean(transport?.connected));
    $("liveTravel").disabled = !transport?.connected || busy;
    $("liveTravel").textContent = live ? "Stop live preview" : "Read key travel";
    $("apply").disabled = !compatible() || busy;
    $("matchTravel").disabled = !transport?.connected || busy;
    const banner = $("compatibility"); banner.classList.remove("warning");
    let title = "Ready to design your profile", text = "Connect for real key-travel previews. Applying a profile becomes available when compatible firmware is detected.";
    if (transport?.connected && !capabilities?.verified) { title = "Keyboard connected · preview available"; text = "This firmware does not provide the custom gamepad interface. You can read travel, design mappings and export a profile; controller output and Apply are unavailable."; banner.classList.add("warning"); }
    else if (capabilities?.verified && !compatible()) { title = "This controller type is unavailable on the connected firmware"; text = config.transport === "xinput" ? "Native Xbox / XInput support is required for this profile. A USB HID gamepad is a separate fallback." : "The connected firmware does not advertise a USB HID gamepad output."; banner.classList.add("warning"); }
    else if (compatible()) { title = "Compatible custom gamepad firmware detected"; text = capabilities.persistent ? "Apply writes your mappings to the keyboard. The profile is retained after reconnecting." : "Apply activates mappings for this session. Export a file to retain them; this firmware does not advertise persistent storage."; }
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
    const b = binding(), control = M.CONTROL.get(selectedControl), digital = control.kind === "button", key = M.KEYS[selectedKey];
    $("selectedKeyName").textContent = key.label; $("selectedAction").textContent = b.key === selectedKey ? control.label : `Assign ${control.label}`;
    $("selectedHint").textContent = b.key === selectedKey ? (digital ? "Follows this key’s actuation and Rapid Trigger" : "Analog travel mapping") : `Choose a control below to assign it to ${key.label}.`;
    $("clearBinding").disabled = !config.bindings.some((item) => item.key === selectedKey);
    $("analogEditor").hidden = digital; $("digitalEditor").hidden = !digital;
    $("tuningControl").textContent = selectedControl;
    $("tuningLead").textContent = digital ? "A digital controller button follows the keyboard’s own press and release state." : `Below the start is zero. At full output, ${control.kind === "trigger" ? "your trigger reaches 255" : "this direction reaches maximum deflection"}.`;
    ["startMm", "endMm", "maxTravelMm"].forEach((id) => { $(id).value = b[id].toFixed(2); });
    $("startMm").max = $("endMm").max = String(b.maxTravelMm);
    root.querySelectorAll("[data-curve]").forEach((button) => button.classList.toggle("active", button.dataset.curve === b.curve));
    $("curveDescription").textContent = b.curve === "linear" ? "A proportional response across your selected travel range." : "A gentle start and finish, with a more responsive middle.";
    $("simulationKey").textContent = `Try ${key.label}`; $("simulateTravel").max = String(b.maxTravelMm); $("simulateTravel").value = String(travels[selectedKey] || 0); $("simulatePressed").checked = Boolean(pressed[selectedKey]);
    $("simulateTravel").disabled = live; $("simulatePressed").disabled = live;
    $("editorError").textContent = ""; drawCurve();
    const limit = keyTravel(b.key);
    $("deviceTravel").textContent = limit ? limit.switchName ? `${limit.switchName} · using ${(limit.maxTravelUm / 1000).toFixed(2)} mm available switch travel.` : `Keyboard reports ${(limit.maxTravelUm / 1000).toFixed(2)} mm for ${M.KEYS[b.key].label}.` : "Choose a switch in Performance or connect the keyboard to detect its travel.";
  }
  function renderSticks() {
    $("stickSettings").innerHTML = config.sticks.map((s, i) => `<div class="stick-setting"><strong>${i ? "Right" : "Left"} stick</strong><label><input type="checkbox" data-stick-circle="${i}" ${s.circular ? "checked" : ""}>Circular gate</label><label class="setting-policy">Opposing directions<select data-stick-policy="${i}"><option value="difference" ${s.opposition === "difference" ? "selected" : ""}>Subtract travel levels</option><option value="neutral" ${s.opposition === "neutral" ? "selected" : ""}>Neutral when both pressed</option><option value="deeper" ${s.opposition === "deeper" ? "selected" : ""}>Higher output wins</option></select></label><label class="setting-deadzone">Radial dead zone<input type="range" data-stick-deadzone="${i}" min="0" max="0.94" step="0.01" value="${s.deadzone}" ${!s.circular ? "disabled" : ""}><output>${Math.round(s.deadzone * 100)}%</output></label></div>`).join("");
  }
  function drawCurve() {
    const b = binding(), active = { ...b, key: b.key === null ? selectedKey : b.key }, points = [];
    for (let i = 0; i <= 100; i += 1) { const x = b.maxTravelMm * i / 100, y = M.level(active, x) / 10000; points.push(`${20 + 292 * i / 100},${130 - 118 * y}`); }
    $("curveLine").setAttribute("points", points.join(" ")); $("curveArea").setAttribute("d", `M20 130 L${points.join(" L")} L312 130 Z`); $("curveMax").textContent = `${b.maxTravelMm.toFixed(2)} mm`;
  }
  function updatePreview() {
    const output = M.evaluate(config, travels, pressed);
    for (const [prefix, name] of [["l", "left"], ["r", "right"]]) { $(name + "Dot").style.transform = `translate(${output[prefix + "x"] * 43}px,${-output[prefix + "y"] * 43}px)`; $(name + "Values").textContent = `X ${output[prefix + "x"].toFixed(2)} · Y ${output[prefix + "y"].toFixed(2)}`; }
    for (const trigger of ["lt", "rt"]) { $(trigger + "Fill").style.width = `${output[trigger] / 255 * 100}%`; $(trigger + "Value").textContent = String(output[trigger]); }
    root.querySelectorAll("[data-preview-button]").forEach((button) => button.classList.toggle("on", output.buttons.includes(button.dataset.previewButton) || output.dpad.includes(button.dataset.previewButton)));
    $("simulationValue").textContent = `${Number(travels[selectedKey] || 0).toFixed(2)} mm`;
    $("previewMode").textContent = source === "keyboard" ? "Key travel" : "Simulator";
    root.querySelectorAll("[data-key]").forEach((button) => { const key = Number(button.dataset.key), b = config.bindings.find((item) => item.key === key), max = b?.maxTravelMm || 4; button.style.setProperty("--travel", `${M.clamp((travels[key] || 0) / max * 100, 0, 100)}%`); button.classList.toggle("pressed", Boolean(pressed[key])); });
  }
  function render() {
    $("profileName").value = config.name; $("outputMode").value = config.mode; $("transportMode").value = config.transport;
    renderKeyboard(); renderControls(); renderEditor(); renderSticks(); updatePreview(); updateCompatibility();
  }
  function change(mutator, fullRender = false) {
    const next = JSON.parse(JSON.stringify(config)); mutator(next);
    try { config = M.validate(next); persist(); if (fullRender) render(); else { renderKeyboard(); renderControls(); renderEditor(); updatePreview(); updateCompatibility(); } return true; }
    catch (error) { $("editorError").textContent = error.message; return false; }
  }
  function stopLive(clear = false) { live = false; generation += 1; if (clear) { travels.fill(0); pressed.fill(false); } source = "simulator"; renderEditor(); updateCompatibility(); updatePreview(); }
  async function refreshCapabilities() {
    transport = getTransport(); capabilities = null; profileLoaded = false;
    if (!transport?.connected) { options.onCapabilities?.(null); updateCompatibility(); return; }
    const connection = transport;
    try {
      const found = await window.AE64GamepadProtocol.probe(connection);
      if (disposed || connection !== getTransport()) return;
      capabilities = found?.verified ? found : null;
    } catch (_) { if (disposed || connection !== getTransport()) return; capabilities = null; }
    if (!disposed) {
      options.onCapabilities?.(capabilities); $("deviceStatus").textContent = "Shared AE64 Pro connection"; updateCompatibility();
      if (capabilities?.verified && capabilities.protocolVersion === 1 && capabilities.boardId === 0x0030000a && capabilities.transports?.xinput) await readKeyboardProfile(true);
    }
  }
  async function connect() {
    if (busy || disposed) return;
    if (!getTransport()?.connected) { await options.onConnect?.(); if (!disposed) { await refreshCapabilities(); if (!profileLoaded) await refreshTravelDefaults(); } return; }
    await readKeyboardProfile();
  }
  async function readKeyboardProfile(automatic = false) {
    if (busy || disposed || !getTransport()?.connected) return;
    setBusy(true); stopLive(true); updateCompatibility();
    const fingerprint = JSON.stringify(config), connection = getTransport();
    try {
      transport = getTransport();
      const result = await window.AE64GamepadProtocol.read(transport);
      if (disposed || connection !== getTransport() || !connection.connected) return;
      if (JSON.stringify(config) !== fingerprint) throw new Error("Your draft changed while reading. Read the keyboard profile again.");
      options.onRead?.(result.config, transport);
      config = M.validate(result.config); automaticTravel = new Set(config.bindings.filter(legacyDefault).map((b) => b.control)); automaticMaximum = new Set(config.bindings.filter((b) => b.maxTravelMm === 4).map((b) => b.control)); capabilities = result; deviceLimits = [];
      const original = JSON.stringify(config); await refreshTravelDefaults(); if (disposed || connection !== getTransport() || !connection.connected) return;
      profileLoaded = true; $("deviceStatus").textContent = "Keyboard gamepad profile loaded";
      if (!automatic || original !== JSON.stringify(config)) notify(original === JSON.stringify(config) ? "Keyboard gamepad profile read. Your local draft now matches the keyboard." : "Keyboard profile read. Default travel windows now match your switches; Apply to activate the adjusted draft.");
    } catch (error) { if (!disposed && connection === getTransport()) notify(automatic ? `Could not read the gamepad profile automatically. Use Read keyboard profile to retry. ${error.message}` : error.message, true); }
    finally { setBusy(false); if (!disposed) updateCompatibility(); }
  }
  async function pollTravel(token) {
    if (disposed || !live || token !== generation || !transport?.connected) return;
    try {
      const ids = new Set([selectedKey, ...config.bindings.filter((b) => b.key !== null).map((b) => b.key)]), rows = [...new Set([...ids].map((id) => M.KEYS[id].row))];
      const samples = await Promise.all(rows.map(async (row) => ({ row, route: await transport.getAxisData("route", row), status: await transport.getAxisData("keyStatus", row) })));
      if (disposed || !live || token !== generation) return;
      const nextTravel = Array(64).fill(0), nextPressed = Array(64).fill(false);
      for (const id of ids) { const k = M.KEYS[id], sample = samples.find((s) => s.row === k.row), value = Number(sample?.route.values[k.col]), status = Number(sample?.status.values[k.col]); if (!Number.isFinite(value) || !Number.isFinite(status)) throw new Error("The keyboard returned an incomplete key sample."); nextTravel[id] = Math.max(0, value / 1000); nextPressed[id] = status > 0 && status < 8; }
      travels = nextTravel; pressed = nextPressed; source = "keyboard"; lastRead = Date.now(); updatePreview();
    } catch (error) { if (token !== generation) return; stopLive(true); notify(`Live preview stopped: ${error.message}`, true); return; }
    setTimeout(() => pollTravel(token), 70);
  }
  $("keyboard").addEventListener("click", (event) => { const key = event.target.closest("[data-key]"); if (!key) return; selectedKey = Number(key.dataset.key); const current = config.bindings.find((b) => b.key === selectedKey); if (current) selectedControl = current.control; renderKeyboard(); renderControls(); renderEditor(); updatePreview(); });
  $("controlPicker").addEventListener("click", (event) => { const control = event.target.closest("[data-control]"); if (!control) return; selectedControl = control.dataset.control; change((next) => {
    next.bindings.forEach((b) => { if (b.key === selectedKey) b.key = null; });
    const b = next.bindings.find((b) => b.control === selectedControl), known = keyTravel(selectedKey);b.key = selectedKey;
    if (known) Object.assign(b, automaticTravel.has(b.control) ? M.defaultTravel(known.maxTravelUm / 1000) : { maxTravelMm: known.maxTravelUm / 1000, endMm: Math.min(b.endMm, known.maxTravelUm / 1000), startMm: Math.min(b.startMm, Math.max(0, Math.min(b.endMm, known.maxTravelUm / 1000) - 0.001)) });
  }); refreshTravelDefaults(); });
  $("clearBinding").addEventListener("click", () => change((next) => { next.bindings.forEach((b) => { if (b.key === selectedKey) b.key = null; }); }));
  for (const id of ["startMm", "endMm", "maxTravelMm"]) $(id).addEventListener("change", () => {
    const values = Object.fromEntries(["startMm", "endMm", "maxTravelMm"].map((field) => [field, Number($(field).value)]));
    if (change((next) => Object.assign(next.bindings.find((b) => b.control === selectedControl), values))) { automaticTravel.delete(selectedControl); if (id === "maxTravelMm") automaticMaximum.delete(selectedControl); persist(); }
  });
  $("curveSelector").addEventListener("click", (event) => { const button = event.target.closest("[data-curve]"); if (button) change((next) => { next.bindings.find((b) => b.control === selectedControl).curve = button.dataset.curve; }); });
  $("stickSettings").addEventListener("change", (event) => { const el = event.target; if (el.dataset.stickCircle !== undefined) change((next) => { const s = next.sticks[Number(el.dataset.stickCircle)]; s.circular = el.checked; if (!s.circular) s.deadzone = 0; }, true); else if (el.dataset.stickPolicy !== undefined) change((next) => { next.sticks[Number(el.dataset.stickPolicy)].opposition = el.value; }, true); else if (el.dataset.stickDeadzone !== undefined) change((next) => { next.sticks[Number(el.dataset.stickDeadzone)].deadzone = Number(el.value); }, true); });
  $("stickSettings").addEventListener("input", (event) => { const el = event.target; if (el.dataset.stickDeadzone !== undefined) el.nextElementSibling.textContent = `${Math.round(Number(el.value) * 100)}%`; });
  $("profileName").addEventListener("change", () => change((next) => { next.name = $("profileName").value.trim(); }));
  $("outputMode").addEventListener("change", () => { stopLive(true); change((next) => { next.mode = $("outputMode").value; }); });
  $("transportMode").addEventListener("change", () => change((next) => { next.transport = $("transportMode").value; }));
  $("simulateTravel").addEventListener("input", () => { if (live) return; source = "simulator"; travels[selectedKey] = Number($("simulateTravel").value); updatePreview(); });
  $("simulatePressed").addEventListener("change", () => { if (live) return; source = "simulator"; pressed[selectedKey] = $("simulatePressed").checked; updatePreview(); });
  $("resetPreview").addEventListener("click", () => { stopLive(true); });
  $("connect").addEventListener("click", connect);
  $("matchTravel").addEventListener("click", async () => {
    if (!transport?.connected || busy) return;
    stopLive(true); setBusy(true); updateCompatibility();
    const snapshot = M.validate(config), fingerprint = JSON.stringify(snapshot);
    try {
      const limits = await window.AE64GamepadProtocol.readTravelLimits(transport, snapshot);
      if (disposed) return;
      if (JSON.stringify(config) !== fingerprint) throw new Error("Your profile changed while reading the keyboard. Use keyboard travel limits again.");
      const next = window.AE64GamepadProtocol.fitTravelLimits(snapshot, limits);
      config = next; deviceLimits = limits; persist(); render();
      notify("Switch limits read. Oversized ranges were shortened in this draft. Review them, then Apply. Nothing was written yet.");
    } catch (error) { $("editorError").textContent = error.message; notify(error.message, true); }
    finally { setBusy(false); if (!disposed) updateCompatibility(); }
  });
  $("liveTravel").addEventListener("click", () => { if (live) { stopLive(true); return; } if (!transport?.connected) return; live = true; lastRead = Date.now(); generation += 1; const token = generation; travels.fill(0); pressed.fill(false); renderEditor(); updateCompatibility(); pollTravel(token); });
  $("apply").addEventListener("click", async () => {
    if (!compatible() || busy || !window.AE64GamepadProtocol?.upload) return;
    stopLive(true); setBusy(true); updateCompatibility();
    const snapshot = M.validate(config), fingerprint = JSON.stringify(snapshot);
    try { const result = await window.AE64GamepadProtocol.upload(transport, snapshot); if (result?.verified === true) options.onApplied?.(snapshot, transport); notify(JSON.stringify(config) !== fingerprint ? "The earlier profile was applied. Your newer edits remain a local draft." : (result?.persistent === true ? "Profile applied and saved to the keyboard." : "Profile applied for this session. Keep an exported copy.")); }
    catch (error) { $("editorError").textContent = error.message; notify(error.rejected ? error.message : `Profile not applied or confirmed: ${error.message}`, true); }
    finally { setBusy(false); if (!disposed) updateCompatibility(); }
  });
  $("export").addEventListener("click", () => { const blob = new Blob([JSON.stringify(M.validate(config), null, 2) + "\n"], { type: "application/json" }), url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = `${config.name.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 50) || "ae64-gamepad"}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
  $("import").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", async () => { const file = $("importFile").files[0]; try { if (!file) return; if (file.size > 65536) throw new Error("Choose a profile file smaller than 64 KB."); const next = M.validate(JSON.parse(await file.text())); stopLive(true); config = next; automaticTravel.clear(); automaticMaximum.clear(); persist(); render(); notify("Profile imported. Nothing was written to the keyboard."); } catch (error) { notify(error.message, true); } finally { $("importFile").value = ""; } });
  $("restoreDefaults").addEventListener("click", async () => { stopLive(true); config = M.defaults(); automaticTravel = new Set(M.CONTROLS.map((c) => c.id)); automaticMaximum = new Set(automaticTravel); useAutomaticTravel(); selectedKey = 15; selectedControl = "LT"; persist(); render(); await refreshTravelDefaults(); notify("Example profile restored using your switches' travel limits. Nothing was written to the keyboard."); });
  const onDisconnect = (event) => {
    if (disposed || event.device !== transport?.device) return;
    stopLive(true); transport = null; capabilities = null; profileLoaded = false; deviceLimits = []; options.onCapabilities?.(null); updateCompatibility();
    notify("Keyboard disconnected. Preview released.");
  };
  const onPageHide = () => { generation += 1; live = false; };
  const onVisibility = () => { if (!disposed && document.hidden && live) stopLive(true); };
  navigator.hid?.addEventListener("disconnect", onDisconnect);
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("visibilitychange", onVisibility);
  const watchdog = setInterval(() => {
    if (!disposed && live && lastRead && Date.now() - lastRead > 1500) { stopLive(true); notify("Live preview stopped after the keyboard stopped responding.", true); }
  }, 500);
  root.querySelectorAll("[data-gamepad-performance]").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); options.onNavigate?.("performance"); }));
  $("previewButtons").innerHTML = M.CONTROLS.filter((c) => c.kind === "button").map((c) => `<span class="preview-button" data-preview-button="${c.id}" role="img" aria-label="${escape(c.label)}" title="${escape(c.label)}">${icon(c.id)}</span>`).join("");
  root.querySelectorAll("[data-controller-icon]").forEach((node) => { node.innerHTML = icon(node.dataset.controllerIcon); });
  useAutomaticTravel(); render();
  const ready = (async () => { await refreshCapabilities(); if (!disposed && !profileLoaded) await refreshTravelDefaults(); })();
  return {
    ready,
    isBusy: () => busy,
    stopLive: () => { if (!disposed) stopLive(true); },
    dispose() {
      if (disposed) return;
      if (busy) setBusy(false);
      disposed = true; generation += 1; live = false; clearInterval(watchdog); clearTimeout(toastTimer);
      navigator.hid?.removeEventListener("disconnect", onDisconnect);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
      // The main application owns and retains the shared HID transport.
    },
  };
  }
  window.AE64GamepadStudio = Object.freeze({ mount });
})();
