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
    if (event.device === state.knownDevice) state.knownDevice = null;
    if (event.device === state.transport?.device) {
      state.transport = null;
      state.livePressDistance = false;
      stopTravelPolling(true);
      stopLightingPolling();
      stopProfilePolling();
      resetCalibrationSession();
      log("Keyboard disconnected");
      render();
      showToast("AE64 Pro disconnected.", true);
    }
  });
  navigator.hid.addEventListener("connect", (event) => {
    if (isAe64Device(event.device)) {
      state.knownDevice = event.device;
      log("Authorized keyboard detected");
    }
  });
}
mountHero();
Promise.allSettled([loadLanguages(), loadSwitchCatalog()]).finally(
  detectKnownKeyboard,
);
