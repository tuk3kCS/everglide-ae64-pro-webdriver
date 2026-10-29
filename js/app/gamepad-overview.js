"use strict";

const gamepadOverview = { transport: null, config: null, pending: false, generation: 0, error: "" };
function gamepadDraft() {
  try { const value = localStorage.getItem("ae64-gamepad-studio-v1");return value ? window.AE64GamepadModel.validate(JSON.parse(value)) : null; }
  catch (_) { return null; }
}
function gamepadConfigurationEqual(a, b) {
  if (!a || !b) return false;
  const fields = (c) => [c.mode, c.transport, c.bindings, c.sticks];
  return JSON.stringify(fields(a)) === JSON.stringify(fields(b));
}
function gamepadOverviewSnapshot() {
  const active = connected() && gamepadOverview.transport === state.transport ? gamepadOverview.config : null,
    draft = gamepadDraft(), config = draft || active,
    source = active && (!draft || gamepadConfigurationEqual(draft, active)) ? "active" : draft ? "draft" : "none";
  return { config, source, disabled: config?.mode === "off" };
}
function rememberGamepadProfile(config, transport) {
  if (transport !== state.transport || !transport?.connected) return;
  gamepadOverview.generation++;gamepadOverview.pending = false;gamepadOverview.transport = transport;
  gamepadOverview.config = window.AE64GamepadModel.validate(config);gamepadOverview.error = "";
}
async function refreshGamepadOverview(force = false) {
  const transport = state.transport;
  if (!connected() || state.firmwareBusy || state.gamepadBusy || state.fnLightingBusy || state.writeInFlight || gamepadOverview.pending || !force && gamepadOverview.transport === transport) return;
  const generation = ++gamepadOverview.generation;
  gamepadOverview.pending = true;gamepadOverview.transport = transport;gamepadOverview.config = null;gamepadOverview.error = "";
  try {
    const result = await window.AE64GamepadProtocol.read(transport);
    if (generation === gamepadOverview.generation && transport === state.transport && transport.connected)
      gamepadOverview.config = window.AE64GamepadModel.validate(result.config);
  } catch (error) { if (generation === gamepadOverview.generation) gamepadOverview.error = error.message; }
  finally {
    if (generation === gamepadOverview.generation) {
      gamepadOverview.pending = false;
      if (state.page === "overview" && transport === state.transport) render();
    }
  }
}
function overviewGamepadKeyBadge(key) {
  const snapshot = gamepadOverviewSnapshot(), model = window.AE64GamepadModel,
    physical = model.KEYS.find((item) => item.uiRow === key.uiRow && item.col === key.col),
    binding = snapshot.config?.bindings.find((item) => item.key === physical?.id);
  if (!binding) return "";
  const label = `${model.CONTROL.get(binding.control).label} · ${snapshot.disabled ? "gamepad off" : snapshot.source === "active" ? "active controller assignment" : "local controller draft"}`;
  return `<span class="overview-controller-badge ${snapshot.disabled ? "inactive" : ""}" title="${esc(label)}">${window.AE64ControllerIcons.html(binding.control)}<span class="sr-only">${esc(label)}</span></span>`;
}
function gamepadOverviewPanel() {
  const snapshot = gamepadOverviewSnapshot(), config = snapshot.config,
    modes = { controller: "Controller assignment only", mixed: "Keyboard + Controller", off: "Gamepad off" },
    label = snapshot.source === "active" ? "READ FROM KEYBOARD" : snapshot.source === "draft" ? "LOCAL DRAFT" : gamepadOverview.pending ? "READING KEYBOARD" : "NO CONTROLLER PROFILE",
    explanation = snapshot.source === "active" ? "These controller assignments were read or confirmed on the connected keyboard." : snapshot.source === "draft" ? "Icons show your saved local draft. Open Gamepad mode and Apply to activate it on the keyboard." : "Connect compatible custom firmware or create a controller profile in Gamepad mode.",
    assigned = config?.bindings.filter((b) => b.key !== null) || [];
  return `<section class="panel full-span gamepad-overview"><div class="panel-head"><div><h2>Controller keymaps</h2><p>${explanation}</p></div><span class="badge ${snapshot.source === "active" ? "ready" : ""}">${label}</span></div>${config ? `<div class="gamepad-overview-mode"><strong>${modes[config.mode]}</strong><span>${assigned.length} assignments${snapshot.disabled ? " · output disabled" : ""}</span></div><div class="gamepad-overview-assignments ${snapshot.disabled ? "inactive" : ""}">${assigned.map((binding) => `<span title="${esc(window.AE64GamepadModel.CONTROL.get(binding.control).label)}">${window.AE64ControllerIcons.html(binding.control)}<b>${esc(window.AE64GamepadModel.KEYS[binding.key].label)}</b><small>${esc(binding.control)}</small></span>`).join("") || '<span>No keys assigned</span>'}</div>` : ""}<div class="apply-row"><button class="button ghost" data-goto="gamepad" type="button">Configure gamepad</button>${connected() ? `<button class="button ghost" data-gamepad-overview-refresh type="button" ${gamepadOverview.pending ? "disabled" : ""}>Read controller assignments</button>` : ""}</div></section>`;
}
function bindGamepadOverview() {
  if (state.page !== "overview") return;
  document.querySelector("[data-gamepad-overview-refresh]")?.addEventListener("click", () => refreshGamepadOverview(true));
  if (connected() && gamepadOverview.transport !== state.transport) refreshGamepadOverview();
}
