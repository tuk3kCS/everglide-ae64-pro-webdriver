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

document
  .querySelectorAll("#connectButton,#heroConnect")
  .forEach((button) =>
    button.addEventListener("click", () => connectKeyboard()),
  );
document.querySelector("#backHomeButton").addEventListener("click", returnHome);
document
  .querySelector("#applyButton")
  .addEventListener("click", requestApplyChanges);
document
  .querySelector("#revertButton")
  .addEventListener("click", revertChanges);
document
  .querySelector("#autoApplyToggle")
  .addEventListener("change", (event) => setAutoApply(event.target.checked));
document.querySelector("#sideNav").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-page]");
  if (button) {
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
  .querySelector("#profileRenameForm")
  .addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    if (await renameProfile(document.querySelector("#quickProfileName").value))
      closeDialog(document.querySelector("#profileRenameDialog"));
  });
document
  .querySelector("#layerSelect")
  .addEventListener("change", async (event) => {
    state.profile.layer = Number(event.target.value);
    if (connected()) {
      showProgress(
        `Reading layer ${state.profile.layer + 1}`,
        "Loading all 64 physical key assignments from the keyboard.",
      );
      try {
        await readKeymapLayer(state.profile.layer);
        await readSelectedKey();
      } catch (error) {
        showToast(error.message, true);
      } finally {
        hideProgress();
      }
    }
    render();
  });
document
  .querySelectorAll(".language-select")
  .forEach((select) =>
    select.addEventListener("change", (event) =>
      setLanguage(event.target.value),
    ),
  );
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
      stopPolling();
      log("Keyboard disconnected");
      renderStatus();
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
loadLanguages().finally(detectKnownKeyboard);
