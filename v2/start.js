"use strict";

document.querySelector("#tryWorkspace").addEventListener("click", openWorkspace);
if (!toolRoute || document.querySelector("#workspace").classList.contains("hidden")) {
  state.page = toolRoute === "profiles" ? "settings" : "performance";
  state.selectedKeys.clear();
  openWorkspace();
}
