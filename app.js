"use strict";

/**
 * AE64 Pro Control — application bootstrap.
 *
 * Loaded as an ordered classic script. Top-level declarations are shared
 * with the other application files; keep the order in index.html intact.
 * Binds permanent shell controls and starts language/device discovery.
 */

function mountHero() {
  document.querySelector("#heroKeyboard").innerHTML = keyboardHtml({
    hero: true,
  });
}

const FIRMWARE_SHOWCASE_RELEASE_KEY = "ae64-control-firmware-showcase-last-release";
const FIRMWARE_SHOWCASE_OPT_OUT_KEY = "ae64-control-firmware-showcase-opt-out";
let firmwareShowcaseSeen = false;

function maybeShowFirmwareShowcase() {
  if (firmwareShowcaseSeen) return false;
  const release = globalThis.AE64_PAGES_RELEASE?.id ?? "local";
  try {
    if (localStorage.getItem(FIRMWARE_SHOWCASE_OPT_OUT_KEY) === "true" ||
        localStorage.getItem(FIRMWARE_SHOWCASE_RELEASE_KEY) === release) return false;
  } catch {
    // Keep the in-page preference if browser storage is unavailable.
  }

  const dialog = document.createElement("dialog");
  dialog.id = "firmwareShowcaseDialog";
  dialog.className = "app-dialog firmware-showcase-dialog";
  dialog.setAttribute("aria-labelledby", "firmwareShowcaseTitle");
  dialog.setAttribute("data-keyboard-input", "allow");
  dialog.innerHTML = `
    <form method="dialog">
      <div class="dialog-heading-row">
        <div class="dialog-copy">
          <h2 id="firmwareShowcaseTitle">Unleashing AE64 Pro's full potential using custom firmware</h2>
        </div>
        <button class="dialog-close-button" type="submit" value="close" aria-label="Close firmware showcase" autofocus>×</button>
      </div>
      <div class="firmware-showcase-content">
        <section>
          <h3>Controller emulation mode</h3>
          <img src="assets/showcase/gamepad.gif" width="664" height="412" alt="Assigning keyboard keys to controller inputs in the Gamepad editor">
        </section>
        <section>
          <h3>Per-key FN layer RGB effect (from Wooting)</h3>
          <img src="assets/showcase/fn_rgb1.png" width="1909" height="643" loading="lazy" alt="The keyboard preview with custom colors assigned on an Fn layer">
          <img src="assets/showcase/fn_rgb2.gif" width="800" height="349" loading="lazy" alt="Lighting changes when an Fn layer is active">
        </section>
        <section>
          <h3>Independent per-key LED effect for each profile</h3>
          <img src="assets/showcase/profile_rgb.gif" width="600" height="447" loading="lazy" alt="Switching onboard profiles restores each profile's per-key colors">
        </section>
      </div>
      <div class="dialog-actions">
        <button class="button ghost" type="submit" value="opt-out">Understand and do not show again</button>
        <button class="button ghost" type="submit" value="close">Continue to driver</button>
        <button class="button primary" type="submit" value="firmware">View firmware</button>
      </div>
    </form>`;
  dialog.addEventListener("close", () => {
    dialog.remove();
    if (dialog.returnValue === "opt-out") {
      try {
        localStorage.setItem(FIRMWARE_SHOWCASE_OPT_OUT_KEY, "true");
      } catch {
        showToast("This browser could not save your preference.", true);
      }
    }
    if (dialog.returnValue === "firmware")
      document.querySelector('#sideNav button[data-page="firmware"]')?.click();
    maybeShowCalibrationRecommendation();
  });
  document.body.append(dialog);
  openDialog(dialog);
  firmwareShowcaseSeen = true;
  try {
    localStorage.setItem(FIRMWARE_SHOWCASE_RELEASE_KEY, release);
  } catch {
    // The prompt has already been shown in this page.
  }
  return true;
}

function keyboardInputAllowed(target) {
  return Boolean(
    target?.closest?.('input[type="search"], [data-keyboard-input="allow"]'),
  );
}

function suppressPageKeyboardInput(event) {
  if (keyboardInputAllowed(event.target)) return;
  event.preventDefault();
  if (typeof event.stopImmediatePropagation === "function")
    event.stopImmediatePropagation();
  else event.stopPropagation?.();
}

// The physical keyboard is the device under test. Do not let its reports
// activate focused controls, scroll the page, or trigger page shortcuts.
["keydown", "keypress", "keyup"].forEach((type) =>
  document.addEventListener(type, suppressPageKeyboardInput, true),
);

document.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !event.target.closest('#pageContent input[type="range"], #keyColorSurface')) return;
  autoApplyPointer = event.pointerId;
  scheduleAutoApply();
}, true);
for (const type of ["pointerup", "pointercancel"]) {
  document.addEventListener(type, (event) => {
    if (autoApplyPointer !== event.pointerId) return;
    autoApplyPointer = null;
    scheduleAutoApply();
  }, true);
}
document.addEventListener("close", () => scheduleAutoApply(), true);

document
  .querySelectorAll("#connectButton,#heroConnect")
  .forEach((button) =>
    button.addEventListener("click", () => connectKeyboard()),
  );
document.querySelector("#backHomeButton").addEventListener("click", () => returnHome());
document
  .querySelector("#applyButton")
  .addEventListener("click", requestApplyChanges);
document
  .querySelector("#revertButton")
  .addEventListener("click", revertChanges);
document
  .querySelector("#autoApplyToggle")
  .addEventListener("change", (event) => setAutoApply(event.target.checked));
document.querySelector("#sideNav").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-page]");
  if (button) {
    if (toolOperationBusy()) return;
    if (state.calibrationActive && button.dataset.page !== "performance") await stopCalibration(true);
    state.page = button.dataset.page;
    render();
  }
});
document
  .querySelector("#quickProfileSelect")
  .addEventListener("change", (event) =>
    switchProfile(Number(event.target.value)),
  );
document
  .querySelector("#quickProfileRename")
  .addEventListener("click", openProfileRename);
document.querySelector("#confirmApplyButton").addEventListener("click", () => {
  closeDialog(document.querySelector("#applyReviewDialog"));
  applyChanges();
});
document
  .querySelector("#advancedInfoDialog")
  .addEventListener("close", (event) => {
    event.currentTarget.querySelectorAll?.("video").forEach((video) => video.pause());
  });
document
  .querySelector("#confirmCalibrationRecommendation")
  .addEventListener("click", () => {
    closeDialog(document.querySelector("#calibrationRecommendationDialog"));
    state.page = "performance";
    render();
    document.querySelector("#calibrationToggle")?.focus();
  });
document
  .querySelector("#profileRenameForm")
  .addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    if (await renameProfile(document.querySelector("#quickProfileName").value))
      closeDialog(document.querySelector("#profileRenameDialog"));
  });
document
  .querySelectorAll(".language-select")
  .forEach((select) =>
    select.addEventListener("change", (event) =>
      setLanguage(event.target.value),
    ),
  );
document
  .querySelector("#sidebarThemeSelect")
  .addEventListener("change", (event) => setTheme(event.target.value));
document
  .querySelector("#profileFileInput")
  .addEventListener("change", (event) => {
    const [file] = event.target.files;
    if (file) importProfile(file);
    event.target.value = "";
  });
if (navigator.hid) {
  navigator.hid.addEventListener("disconnect", (event) => {
    if (state.usbSwitchBusy) { log("USB reconnect during Xbox device change"); return; }
    if (event.device === state.knownDevice) state.knownDevice = null;
    if (event.device === state.transport?.device) {
      const disconnected = state.transport;
      state.transport = null;
      disconnected.close().catch(() => {});
      resetFnLightingCapability();
      state.livePressDistance = false;
      stopTravelPolling(true);
      stopLightingPolling();
      stopProfilePolling();
      resetCalibrationSession();
      if (state.firmwareBusy) { log("Keyboard USB transition during firmware update"); return; }
      if (state.bootloaderConnected) noteFirmwareRecoveryDisconnect();
      log("Keyboard disconnected");
      render();
      showToast(state.bootloaderConnected ? "Recovery keyboard disconnected. Reconnect it to finish the firmware update." : "AE64 Pro disconnected.", true);
    }
  });
  navigator.hid.addEventListener("connect", (event) => {
    if (state.usbSwitchBusy) return;
    if (window.AE64FirmwareReconnect.eligible(event.device)) {
      state.knownDevice = event.device;
      log("Authorized keyboard detected");
      if (!state.firmwareBusy) detectFirmwareRecovery(event.device);
    }
  });
}
mountHero();
Promise.allSettled([loadLanguages(), loadSwitchCatalog()]).finally(
  detectKnownKeyboard,
);

document.querySelector("#openFirmwareTools")?.addEventListener("click", () => { state.page = "firmware"; openWorkspace(); });
window.addEventListener("beforeunload", (event) => { if (state.firmwareBusy || state.fnLightingBusy || state.writeInFlight) { event.preventDefault(); event.returnValue = ""; } });
const toolRoute = window.location?.hash?.slice(1);
if (["overview", "keymap", "performance", "advanced", "lighting", "settings", "diagnostics", "about", "gamepad", "firmware"].includes(toolRoute)) { state.page = toolRoute; openWorkspace(); }

function watchPagesRelease(current) {
  let checking = false;
  let warnedAboutDraft = false;
  async function check() {
    if (document.hidden || checking) return;
    checking = true;
    try {
      const manifest = new URL(current.manifest);
      manifest.searchParams.set("check", Date.now().toString(36));
      const response = await fetch(manifest, { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!response.ok) return;
      const { release } = await response.json();
      if (typeof release !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,95}$/.test(release) || release === current.id) return;
      const hasDraft = pendingChangeCount();
      if (hasDraft || toolOperationBusy() || state.calibrationActive || state.calibrationBusy || document.querySelector("dialog[open]")) {
        if (hasDraft && !warnedAboutDraft) {
          showToast("A driver update is ready. Apply or export your changes before refreshing.");
          warnedAboutDraft = true;
        }
        return;
      }
      window.location.reload();
    } catch {
      // Keep the running release available if the update check fails.
    } finally {
      checking = false;
    }
  }
  window.addEventListener("pageshow", (event) => { if (event.persisted) check(); });
  document.addEventListener("visibilitychange", check);
  setInterval(check, 60_000);
}
if (globalThis.AE64_PAGES_RELEASE) watchPagesRelease(globalThis.AE64_PAGES_RELEASE);
