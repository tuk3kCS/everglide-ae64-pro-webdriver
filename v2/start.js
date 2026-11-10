"use strict";

const welcomeContent = document.querySelector("#welcomeContent");
const initializeDevice = document.querySelector("#initializeDevice");
const initializeButton = document.querySelector("#heroConnect");
const initializeStatus = document.querySelector("#initializeStatus");

function showInitialization(active) {
  welcomeContent.hidden = active;
  initializeDevice.hidden = !active;
  if (active) {
    initializeButton.disabled = !navigator.hid;
    document.querySelector("#initializeTitle").focus();
  }
  else document.querySelector("#startInitialization").focus();
}

document.querySelector("#startInitialization").addEventListener("click", () => showInitialization(true));
document.querySelector("#cancelInitialization").addEventListener("click", () => showInitialization(false));
if (!navigator.hid) {
  initializeStatus.textContent = "WebHID is unavailable here. Open Reloaded in Chrome or Edge on localhost or HTTPS.";
  initializeButton.disabled = true;
}

const connectFromDriver = connectKeyboard;
connectKeyboard = async (...args) => {
  if (initializeDevice.hidden || document.querySelector("#welcome").classList.contains("hidden"))
    return connectFromDriver(...args);
  const [setupStep, connectStep] = initializeDevice.querySelectorAll(".initialize-steps li");
  setupStep.removeAttribute("aria-current");
  connectStep.setAttribute("aria-current", "step");
  initializeStatus.textContent = "Select your keyboard in the browser’s device chooser.";
  const connectedDevice = await connectFromDriver(...args);
  connectStep.removeAttribute("aria-current");
  setupStep.setAttribute("aria-current", "step");
  initializeStatus.textContent = connectedDevice
    ? "Keyboard connected."
    : "Connection wasn’t completed. Check the USB cable and try again.";
  return connectedDevice;
};

const returnToWelcome = returnHome;
returnHome = async () => {
  await returnToWelcome();
  if (!document.querySelector("#workspace").classList.contains("hidden")) return;
  history.replaceState(null, "", location.pathname + location.search);
  showInitialization(false);
};

document.querySelector("#tryWorkspace").addEventListener("click", () => {
  state.page = "performance";
  state.selectedKeys.clear();
  openWorkspace();
  document.querySelector('.sidebar [data-view="quick"]').click();
});

if (document.querySelector("#workspace").classList.contains("hidden")) {
  state.page = toolRoute === "profiles" ? "settings" : "performance";
  state.selectedKeys.clear();
  if (["profiles", "quick-settings", "actuation-point", "rapid-trigger", "magnetic-switches"].includes(toolRoute)) openWorkspace();
}

document.querySelectorAll("#heroKeyboard .keyboard-row").forEach((row) => {
  let offset = 0;
  row.querySelectorAll(".key").forEach((key) => {
    const width = Number(key.style.getPropertyValue("--u"));
    key.style.setProperty("--welcome-key", `hsl(${225 + 105 * (offset + width / 2) / 15} 80% 55%)`);
    offset += width;
  });
});
