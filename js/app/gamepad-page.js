"use strict";

let activeGamepadStudio = null;
function disposeGamepadPage() {
  activeGamepadStudio?.dispose(); activeGamepadStudio = null;
}
function toolOperationBusy() { return Boolean(state.firmwareBusy || state.gamepadBusy || state.fnLightingBusy || state.writeInFlight); }
function updateToolShell() {
  const busy = toolOperationBusy();
  document.querySelectorAll("#sideNav button,#quickProfileSelect,#quickProfileRename,#backHomeButton,#sidebarThemeSelect,.language-select,#connectButton,#heroConnect").forEach((node) => { node.disabled = busy; });
  document.querySelector(".work-actions")?.classList.toggle("hidden", ["gamepad", "firmware"].includes(state.page));
  if (!document.querySelector("#workspace")?.classList.contains?.("hidden") && window.location && window.location.hash !== `#${state.page}`)
    window.history?.replaceState(null, "", `#${state.page}`);
}
function gamepadPage() {
  return `<div class="gamepad-mode-page">
    <section class="solution-intro"><span class="eyebrow">PLAY YOUR WAY</span><h2>Choose how your keyboard becomes a controller</h2><p>Use native controller output from custom firmware, or keep factory firmware and run a Windows mapper.</p></section>
    <div class="solution-grid">
      <button type="button" class="solution-card selected" data-gamepad-hardware aria-pressed="true"><span class="solution-icon">⌨</span><span class="badge experimental">CUSTOM FIRMWARE</span><h3 data-i18n="hardwareSolution">Hardware Solution</h3><p>Native Xbox / XInput from the keyboard. Configure analog travel and controller assignments below.</p><strong>Configure hardware →</strong></button>
      <a class="solution-card" href="https://github.com/z750sasr/he-kb-analog-mapper" target="_blank" rel="noopener noreferrer"><span class="solution-icon">◈</span><span class="badge">WINDOWS APP</span><h3 data-i18n="softwareSolution">Software Solution</h3><p>Use Hall Analog Mapper to turn keyboard travel into a virtual Xbox 360 controller while keeping factory firmware.</p><strong>Open the GitHub project ↗</strong></a>
    </div>
    <section class="panel hardware-solution-info"><div><h2>Hardware Solution</h2><p>Requires the experimental AE64 XInput firmware. Read the keyboard's travel limits before applying a profile. Assignments last for the current powered session.</p></div><button class="button ghost" type="button" id="openHardwareFirmware">Choose hardware firmware</button></section>
    <section class="gamepad-studio" id="gamepadHardware" aria-label="Hardware Solution controller configuration">${window.AE64GamepadTemplate}</section>
  </div>`;
}
function bindGamepadPage() {
  document.querySelector("[data-gamepad-hardware]")?.addEventListener("click", () => document.querySelector("#gamepadHardware")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  document.querySelector("#openHardwareFirmware")?.addEventListener("click", () => {
    firmwareView.selectedId = "AE64-Pro-XInput-FnRGB-EXPERIMENTAL-v0.2.bin";
    firmwareView.loadGeneration++; firmwareView.loading = false; firmwareView.prepared = null; firmwareView.selectionError = "";
    state.page = "firmware"; render();
  });
  activeGamepadStudio = window.AE64GamepadStudio.mount(document.querySelector("#gamepadHardware"), {
    getTransport: () => state.firmwareBusy || state.bootloaderConnected ? null : state.transport,
    onConnect: () => connectKeyboard(),
    onNavigate: (page) => { if (!toolOperationBusy()) { state.page = page; render(); } },
    notify: showToast,
    onBusy: (busy) => {
      state.gamepadBusy = busy;
      if (busy) { stopPolling(); stopProfilePolling(); clearTimeout(state.timers.autoApply); }
      else if (connected()) startProfilePolling();
      renderStatus();
    },
  });
}
