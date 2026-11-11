"use strict";

(() => {
  const stage = document.querySelector("#desktopWindows");
  const windows = [...stage.querySelectorAll("[data-window]")];
  const startButton = document.querySelector("#startButton");
  const startMenu = document.querySelector("#startMenu");
  const announcement = document.querySelector("#desktopAnnouncement");
  const compact = matchMedia("(max-width: 640px)");
  let topLayer = 10;
  let activeWindow = document.querySelector(".xp-window.active");

  function setStartMenu(open) {
    startMenu.hidden = !open;
    startButton.setAttribute("aria-expanded", String(open));
  }

  function updateTaskbar() {
    for (const button of document.querySelectorAll("[data-task]")) {
      const window = document.getElementById(button.dataset.task);
      const active = !window.hidden && window === activeWindow;
      button.hidden = window.dataset.closed === "true";
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  function focusWindow(window) {
    activeWindow = window;
    window.style.zIndex = ++topLayer;
    for (const other of windows) other.classList.toggle("active", other === window);
    updateTaskbar();
  }

  function openWindow(id) {
    const window = document.getElementById(id);
    if (!windows.includes(window)) return;
    window.hidden = false;
    delete window.dataset.closed;
    focusWindow(window);
    setStartMenu(false);
    window.querySelector("[data-minimize]").focus({ preventScroll: true });
    if (compact.matches) window.scrollIntoView({ block: "nearest" });
  }

  function hideWindow(window, closed) {
    window.hidden = true;
    window.dataset.closed = String(closed);
    if (activeWindow === window) {
      activeWindow = windows.filter((other) => !other.hidden).sort((a, b) => Number(b.style.zIndex) - Number(a.style.zIndex))[0] || null;
      if (activeWindow) focusWindow(activeWindow);
    }
    updateTaskbar();
    const restore = document.querySelector(`[${closed ? "data-open" : "data-task"}="${window.id}"]`);
    restore?.focus({ preventScroll: true });
  }

  function maximizeWindow(window) {
    const maximized = window.classList.toggle("maximized");
    window.querySelector("[data-maximize]").setAttribute("aria-label", `${maximized ? "Restore" : "Maximize"} ${window.dataset.taskLabel}`);
    focusWindow(window);
  }

  document.addEventListener("click", (event) => {
    const opener = event.target.closest("[data-open]");
    if (opener) openWindow(opener.dataset.open);
    const task = event.target.closest("[data-task]");
    if (task) {
      const window = document.getElementById(task.dataset.task);
      if (!window.hidden && activeWindow === window) hideWindow(window, false);
      else openWindow(window.id);
    }
    const window = event.target.closest("[data-window]");
    if (window && event.target.closest("[data-minimize]")) hideWindow(window, false);
    if (window && event.target.closest("[data-close]")) hideWindow(window, true);
    if (window && event.target.closest("[data-maximize]")) maximizeWindow(window);
    if (!event.target.closest("#startMenu, #startButton")) setStartMenu(false);
  });

  for (const window of windows) {
    window.addEventListener("pointerdown", () => focusWindow(window));
    window.addEventListener("focusin", () => { if (activeWindow !== window) focusWindow(window); });
    const titlebar = window.querySelector("[data-drag]");
    titlebar.addEventListener("dblclick", (event) => {
      if (!event.target.closest("button")) maximizeWindow(window);
    });
    titlebar.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || compact.matches || window.classList.contains("maximized") || event.target.closest("button")) return;
      event.preventDefault();
      const startX = event.clientX, startY = event.clientY;
      const left = window.offsetLeft, top = window.offsetTop;
      titlebar.setPointerCapture(event.pointerId);
      function move(pointer) {
        if (pointer.pointerId !== event.pointerId) return;
        window.style.left = `${Math.max(0, Math.min(stage.clientWidth - window.offsetWidth, left + pointer.clientX - startX))}px`;
        window.style.top = `${Math.max(0, Math.min(stage.clientHeight - 34, top + pointer.clientY - startY))}px`;
        window.style.right = "auto";
      }
      function end(pointer) {
        if (pointer.pointerId !== event.pointerId) return;
        titlebar.removeEventListener("pointermove", move);
        titlebar.removeEventListener("pointerup", end);
        titlebar.removeEventListener("pointercancel", end);
        titlebar.removeEventListener("lostpointercapture", end);
        if (titlebar.hasPointerCapture(event.pointerId)) titlebar.releasePointerCapture(event.pointerId);
      }
      titlebar.addEventListener("pointermove", move);
      titlebar.addEventListener("pointerup", end);
      titlebar.addEventListener("pointercancel", end);
      titlebar.addEventListener("lostpointercapture", end);
    });
  }

  function restoreDesktop() {
    for (const window of windows) {
      window.hidden = false;
      window.classList.remove("maximized");
      window.style.removeProperty("left");
      window.style.removeProperty("top");
      window.style.removeProperty("right");
      delete window.dataset.closed;
      window.querySelector("[data-maximize]").setAttribute("aria-label", `Maximize ${window.dataset.taskLabel}`);
    }
    focusWindow(document.querySelector("#profile"));
    setStartMenu(false);
  }

  compact.addEventListener("change", restoreDesktop);
  addEventListener("resize", () => {
    if (compact.matches) return;
    for (const window of windows) {
      if (window.hidden || window.classList.contains("maximized")) continue;
      if (window.style.left) window.style.left = `${Math.max(0, Math.min(window.offsetLeft, stage.clientWidth - window.offsetWidth))}px`;
      if (window.style.top) window.style.top = `${Math.max(0, Math.min(window.offsetTop, stage.clientHeight - 34))}px`;
    }
  });
  startButton.addEventListener("click", () => setStartMenu(startMenu.hidden));
  document.querySelector("#restoreDesktop").addEventListener("click", restoreDesktop);
  document.querySelector("#showDesktop").addEventListener("click", () => {
    const visible = windows.filter((window) => !window.hidden);
    if (!visible.length) return restoreDesktop();
    for (const window of visible) hideWindow(window, false);
    document.querySelector("#showDesktop").focus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !startMenu.hidden) { setStartMenu(false); startButton.focus(); }
  });

  document.querySelector("#copyDiscord").addEventListener("click", async () => {
    const hint = document.querySelector("#copyHint");
    try {
      await navigator.clipboard.writeText("hmtchokeking");
      hint.textContent = "Username copied. Say hello!";
      announcement.textContent = "Discord username hmtchokeking copied to clipboard.";
    } catch {
      const selection = getSelection();
      const range = document.createRange();
      range.selectNodeContents(document.querySelector("#copyDiscord").previousElementSibling.querySelector("strong"));
      selection.removeAllRanges();
      selection.addRange(range);
      hint.textContent = "Username selected. Press Ctrl/Cmd+C to copy.";
      announcement.textContent = hint.textContent;
    }
  });

  document.querySelector("#backToKeyboard").addEventListener("click", () => {
    if (parent === window) location.href = new URL("./#quick-settings", document.baseURI).href;
    else parent.document.querySelector('button[data-page="performance"]').click();
  });

  function updateClock() {
    const now = new Date();
    const clock = document.querySelector("#desktopClock");
    clock.dateTime = now.toISOString();
    clock.textContent = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    clock.title = now.toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  }
  updateClock();
  setInterval(updateClock, 30000);
  focusWindow(activeWindow);
})();
