"use strict";

const firmwareView = {
  catalog: null, catalogLoading: false, catalogError: "", selectedId: "", prepared: null,
  loading: false, loadGeneration: 0, selectionError: "", phase: "idle", percent: 0, detail: "",
  written: 0, total: 0, waiting: null, updater: null,
};
const FIRMWARE_FILTERS = [{ vendorId: 0x1ca6, usagePage: 0xffb0, usage: 1 }, { vendorId: 0x1ca6, usagePage: 0xff80 }];
function firmwareFileUrl(file) {
  if (typeof file !== "string" || !file.toLowerCase().endsWith(".bin") || file.split(/[\\/]/).some((part) => !part || part === "." || part === "..") || /[:?#]/.test(file)) throw new Error("The catalog contains an invalid firmware path.");
  return new URL("firmware/" + file.split("/").map(encodeURIComponent).join("/"), document.baseURI).href;
}
function firmwarePage() {
  const v = firmwareView, p = v.prepared, catalog = v.catalog?.firmwares || [];
  const options = ["custom", "stock"].map((kind) => `<optgroup label="${kind === "stock" ? "Factory firmware" : "Custom firmware"}">${catalog.filter((e) => e.kind === kind).map((e) => `<option value="${esc(e.id)}" ${v.selectedId === e.id ? "selected" : ""}>${esc(e.name)} · ${esc(e.date)}</option>`).join("")}</optgroup>`).join("");
  return `<div class="firmware-page">
    <section class="panel firmware-intro"><div><span class="eyebrow">KEYBOARD FIRMWARE</span><h2>Choose the firmware for your AE64 Pro</h2><p>Install a factory release or the experimental XInput build. Files are served from this project's firmware folder.</p></div><span class="badge">AE64 PRO ONLY</span></section>
    <div class="page-grid">
      <section class="panel"><div class="panel-head"><div><h2>1. Choose an image</h2><p>File integrity and keyboard compatibility are checked before writing.</p></div></div>
        <label class="field"><span>Firmware in /firmware</span><select id="firmwareSelect" ${v.loading || state.firmwareBusy ? "disabled" : ""}><option value="">${v.catalogLoading ? "Loading firmware list…" : "Choose a firmware release"}</option>${options}${v.selectedId === "local" ? '<option value="local" selected>Selected local binary</option>' : ""}</select></label>
        <div class="apply-row"><button class="button ghost" type="button" id="reloadFirmwareCatalog" ${v.loading || state.firmwareBusy ? "disabled" : ""}>Refresh list</button><label class="button ghost firmware-file-label">Choose local .bin<input id="firmwareFileInput" type="file" accept=".bin,application/octet-stream" ${v.loading || state.firmwareBusy ? "disabled" : ""}></label></div>
        <p class="form-hint">Choose a bundled release, or select a local binary file.</p>
        <p class="firmware-error" role="alert">${esc(v.catalogError || v.selectionError)}</p>
        ${p ? `<article class="firmware-selection"><div><span class="badge ${p.entry.experimental ? "experimental" : "ready"}">${p.entry.experimental ? "EXPERIMENTAL" : "FILE CHECKS PASSED"}</span><h3>${esc(p.name)}</h3><p>${esc(p.entry.description || "A locally selected, checksum-verified AE64 Pro container.")}</p></div><dl><div><dt>File</dt><dd>${esc(p.entry.file || p.name)}</dd></div><div><dt>Size</dt><dd>${(p.info.bytes / 1024).toFixed(1)} KiB</dd></div><div><dt>Board</dt><dd>0030000A</dd></div><div><dt>SHA-256</dt><dd class="firmware-hash">${p.sha256}</dd></div></dl>${p.entry.experimental ? '<p class="firmware-note">Experimental custom firmware. Native Windows enumeration has been observed; complete hardware behavior and recovery remain unverified. Export your gamepad profile to keep session-only assignments.</p>' : ""}</article>` : `<div class="empty-state">${v.loading ? "Checking the selected firmware…" : "Choose a release to see its details."}</div>`}
      </section>
      <section class="panel"><div class="panel-head"><div><h2>2. Flash the keyboard</h2><p>Keep the keyboard connected until writing, validation and restart finish.</p></div></div>
        <div class="firmware-device"><span class="badge ${state.transport?.connected ? "ready" : ""}">${state.transport?.connected ? state.bootloaderConnected ? "BOOTLOADER CONNECTED" : "KEYBOARD CONNECTED" : "CONNECT A KEYBOARD"}</span><p>${state.hardware.info ? `Current firmware: ${esc(state.hardware.info.firmware)}` : "Select the physical keyboard you intend to update."}</p><button class="button ghost" type="button" id="firmwareConnect" ${state.firmwareBusy ? "disabled" : ""}>${state.transport?.connected ? "Choose another keyboard" : "Connect keyboard / bootloader"}</button></div>
        ${dirtyCount() ? '<p class="firmware-note">Keyboard edits are still staged. Apply or revert them before flashing. <button class="text-button" data-goto="settings" type="button">Review device settings →</button></p>' : ""}
        <button class="button primary firmware-start" type="button" id="reviewFirmware" ${!p || !state.transport?.connected || v.loading || toolOperationBusy() || dirtyCount() ? "disabled" : ""}>Review and flash firmware →</button>
        <div class="firmware-progress" aria-live="polite"><strong id="firmwarePhase"></strong><progress id="firmwareProgress" max="100" value="${v.percent}" aria-label="Firmware update progress"></progress><p id="firmwareDetail"></p><button class="button ghost hidden" type="button" id="selectBootDevice">Select keyboard bootloader</button></div>
        <p class="form-hint">A failed validation leaves the keyboard in bootloader mode. Select an intact image and start a fresh update. USB recovery is not guaranteed if the bootloader is unavailable.</p>
      </section>
    </div>
    <dialog class="app-dialog" id="firmwareReviewDialog"><div class="dialog-copy"><span class="eyebrow">REVIEW FIRMWARE UPDATE</span><h2>Flash ${esc(p?.name || "selected firmware")}?</h2><p>This writes the selected image to the connected AE64 Pro and restarts it. Keep USB power connected. Close other keyboard-driver tabs and mapping apps before starting.</p><p class="firmware-review-file">${esc(p?.entry.file || p?.name || "")}</p>${p?.entry.experimental ? '<p class="firmware-note">This is an experimental custom build. It may leave the keyboard unusable.</p>' : ""}</div><div class="dialog-actions"><button class="button ghost" type="button" id="cancelFirmwareReview">Cancel</button><button class="button primary" type="button" id="startFirmwareUpdate">Start firmware update</button></div></dialog>
  </div>`;
}
function firmwareProgress(update) {
  if (update.phase && update.phase !== firmwareView.phase) firmwareView.detail = "";
  Object.assign(firmwareView, update);
  const labels = { idle: "Ready when you are", identity: "Checking keyboard identity", entering: "Entering bootloader", awaitingBoot: "Waiting for the keyboard bootloader", writing: "Writing firmware", validating: "Validating the complete image", restarting: "Restarting the keyboard", awaitingApp: "Waiting for the application", complete: "Firmware installed and application reconnected", error: "Update stopped" };
  const phase = document.querySelector("#firmwarePhase"), progress = document.querySelector("#firmwareProgress"), detail = document.querySelector("#firmwareDetail"), choose = document.querySelector("#selectBootDevice");
  if (!phase) return;
  phase.textContent = labels[firmwareView.phase] || firmwareView.phase;
  progress.value = firmwareView.percent;
  detail.textContent = firmwareView.detail || (firmwareView.phase === "writing" ? `${firmwareView.written.toLocaleString()} / ${firmwareView.total.toLocaleString()} bytes · ${firmwareView.percent}%` : firmwareView.phase === "complete" ? "Reconnects and file validation passed. Recalibrate if the keyboard requests it." : firmwareView.phase === "idle" ? "No firmware commands are sent until you confirm Start." : "Keep USB connected. The browser may ask you to select the keyboard again.");
  choose?.classList.toggle("hidden", !firmwareView.waiting);
  if (choose) choose.textContent = firmwareView.waiting?.mode === 0 ? "Select restarted keyboard" : "Select keyboard bootloader";
}
async function loadFirmwareCatalog() {
  if (firmwareView.catalogLoading) return;
  firmwareView.catalogLoading = true; firmwareView.catalogError = "";
  try {
    const response = await fetch(new URL("firmware/catalog.json", document.baseURI), { cache: "no-store" });
    if (!response.ok) throw new Error("Firmware catalog is unavailable. Build the catalog, then refresh the list.");
    const catalog = await response.json();
    if (catalog.schema !== 1 || catalog.boardId !== "0030000A" || !Array.isArray(catalog.firmwares)) throw new Error("Unsupported firmware catalog.");
    catalog.firmwares.forEach((e) => firmwareFileUrl(e.file)); firmwareView.catalog = catalog;
  } catch (error) { firmwareView.catalogError = error.message; }
  finally { firmwareView.catalogLoading = false; if (state.page === "firmware" && !state.firmwareBusy) render(); }
}
async function selectCatalogFirmware(id) {
  const entry = firmwareView.catalog?.firmwares.find((e) => e.id === id);
  firmwareView.selectedId = id; firmwareView.prepared = null; firmwareView.selectionError = "";
  if (!entry) { render(); return; }
  const generation = ++firmwareView.loadGeneration;
  firmwareView.loading = true; render();
  try {
    const response = await fetch(firmwareFileUrl(entry.file), { cache: "no-store" });
    if (!response.ok) throw new Error("Selected firmware file could not be loaded.");
    const prepared = await window.AE64Firmware.prepare(await response.arrayBuffer(), entry);
    if (generation === firmwareView.loadGeneration) firmwareView.prepared = prepared;
  } catch (error) { if (generation === firmwareView.loadGeneration) firmwareView.selectionError = error.message; }
  finally { if (generation === firmwareView.loadGeneration) firmwareView.loading = false; if (state.page === "firmware" && !state.firmwareBusy) render(); }
}
async function inspectFirmwareDevice(device) {
  const transport = new AE64HidTransport(device, { allowBootloader: true }); let lease;
  try { await transport.open(); lease = await transport.acquireExclusive(); const info = await window.AE64Firmware.identity(lease); return { transport, info }; }
  catch (error) { await transport.close().catch(() => {}); throw error; }
  finally { if (lease) await lease.release(); }
}
async function connectFirmwareDevice() {
  if (toolOperationBusy()) return;
  try {
    if (!navigator.hid?.requestDevice) throw new Error("Use desktop Chrome or Edge on HTTPS or localhost.");
    const [device] = await navigator.hid.requestDevice({ filters: FIRMWARE_FILTERS }); if (!device) return;
    stopPolling(); stopProfilePolling(); if (state.transport) await state.transport.close();
    const found = await inspectFirmwareDevice(device);
    if (found.info.boardId !== window.AE64Firmware.BOARD || ![0, 255].includes(found.info.runMode)) { await found.transport.close(); throw new Error("The selected device is not a supported AE64 Pro application or bootloader."); }
    if (found.info.runMode === 0) { await found.transport.close(); state.bootloaderConnected = false; await connectKeyboard(device); }
    else { state.transport = found.transport; state.bootloaderConnected = true; state.hardware.info = { ...found.info, boardIdHex: "0030000A" }; render(); }
  } catch (error) { showToast(error.message, true); if (state.page === "firmware") render(); }
}
async function reconnectFirmwareDevice({ mode, original, preferred }) {
  let chosen = null;
  const waiting = { mode, choose: (device) => { chosen = device; } }; firmwareView.waiting = waiting;
  firmwareProgress({ phase: mode === 255 ? "awaitingBoot" : "awaitingApp" });
  const end = Date.now() + 90000;
  try {
    while (Date.now() < end) {
      const explicit = chosen; chosen = null;
      const authorized = explicit ? [explicit] : await navigator.hid.getDevices();
      const candidates = authorized.filter((d) => d.vendorId === 0x1ca6 && d.collections?.some((c) => c.usagePage === 0xff80 || (c.usagePage === 0xffb0 && c.usage === 1)));
      candidates.sort((a, b) => Number(b === preferred) - Number(a === preferred));
      for (const device of candidates) {
        let found;
        try {
          found = await inspectFirmwareDevice(device);
          const matchedSerial = Boolean(original.serial && found.info.serial === original.serial);
          if (!explicit && device !== preferred && !matchedSerial) { await found.transport.close(); continue; }
          window.AE64Firmware.checkIdentity(found.info, mode, original, Boolean(explicit));
          state.transport = found.transport; return { transport: found.transport, explicit: Boolean(explicit) };
        } catch (error) { if (found?.transport.connected) await found.transport.close().catch(() => {}); if (explicit) showToast(error.message, true); }
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(mode === 255 ? "Bootloader reconnect timed out. Choose the keyboard bootloader and start a new update." : "The image validated, but the application did not reconnect. Reconnect the keyboard to inspect it.");
  } finally { if (firmwareView.waiting === waiting) firmwareView.waiting = null; firmwareProgress({}); }
}
async function chooseFirmwareReconnect() {
  const waiting = firmwareView.waiting; if (!waiting) return;
  try { const [device] = await navigator.hid.requestDevice({ filters: FIRMWARE_FILTERS }); if (device && firmwareView.waiting === waiting) waiting.choose(device); }
  catch (error) { showToast(error.message, true); }
}
async function startFirmwareUpdate(reviewed = firmwareView.prepared) {
  if (toolOperationBusy() || !firmwareView.prepared || !state.transport?.connected || dirtyCount()) return;
  if (reviewed !== firmwareView.prepared) return showToast("The selected image changed. Review it again before starting.", true);
  const selected = firmwareView.prepared, transport = state.transport;
  state.firmwareBusy = true; stopPolling(); stopProfilePolling(); clearTimeout(state.timers.autoApply); disposeGamepadPage();
  document.querySelectorAll(".firmware-page button,.firmware-page input,.firmware-page select").forEach((n) => { n.disabled = true; });
  const reconnectButton = document.querySelector("#selectBootDevice"); if (reconnectButton) reconnectButton.disabled = false;
  renderStatus();
  try {
    firmwareView.updater = new window.AE64Firmware.Updater({ reconnect: reconnectFirmwareDevice, progress: firmwareProgress });
    const result = await firmwareView.updater.run(selected, transport);
    state.firmwareBusy = false; state.bootloaderConnected = false;
    await result.transport.close(); state.transport = null;
    const connectedAgain = await connectKeyboard(result.transport.device, { silent: true });
    if (!connectedAgain) throw new Error("Firmware validated and restarted, but loading its settings failed. Connect the keyboard again.");
    showToast("Firmware updated. Recalibrate if requested.");
  } catch (error) {
    state.firmwareBusy = false; if (!state.transport?.connected) state.transport = null;
    firmwareProgress({ phase: "error", detail: error.message }); log("Firmware update stopped", error.message); showToast(error.message, true);
  } finally {
    state.firmwareBusy = false; firmwareView.waiting = null; firmwareView.updater = null;
    if (state.page === "firmware") render(); else renderStatus();
  }
}
function bindFirmwarePage() {
  document.querySelector("#firmwareSelect")?.addEventListener("change", (e) => selectCatalogFirmware(e.target.value));
  document.querySelector("#reloadFirmwareCatalog")?.addEventListener("click", () => { firmwareView.catalog = null; loadFirmwareCatalog(); });
  document.querySelector("#firmwareConnect")?.addEventListener("click", connectFirmwareDevice);
  document.querySelector("#selectBootDevice")?.addEventListener("click", chooseFirmwareReconnect);
  document.querySelector("#firmwareFileInput")?.addEventListener("change", async (event) => {
    const [file] = event.target.files; if (!file || state.firmwareBusy) return;
    if (!file.name.toLowerCase().endsWith(".bin")) return showToast("Choose a .bin firmware file.", true);
    const generation = ++firmwareView.loadGeneration; firmwareView.prepared = null; firmwareView.selectedId = "local"; firmwareView.loading = true; firmwareView.selectionError = ""; render();
    try { const prepared = await window.AE64Firmware.prepare(await file.arrayBuffer(), { name: file.name, file: file.name, experimental: true }); if (generation === firmwareView.loadGeneration) firmwareView.prepared = prepared; }
    catch (error) { if (generation === firmwareView.loadGeneration) firmwareView.selectionError = error.message; }
    finally { if (generation === firmwareView.loadGeneration) firmwareView.loading = false; if (state.page === "firmware") render(); }
  });
  const dialog = document.querySelector("#firmwareReviewDialog");
  document.querySelector("#reviewFirmware")?.addEventListener("click", () => dialog.showModal());
  document.querySelector("#cancelFirmwareReview")?.addEventListener("click", () => dialog.close());
  const reviewedImage = firmwareView.prepared;
  document.querySelector("#startFirmwareUpdate")?.addEventListener("click", () => { dialog.close(); startFirmwareUpdate(reviewedImage); });
  firmwareProgress({});
  if (!firmwareView.catalog && !firmwareView.catalogLoading && !firmwareView.catalogError) loadFirmwareCatalog();
  else if (firmwareView.selectedId && firmwareView.selectedId !== "local" && !firmwareView.prepared && !firmwareView.loading && !firmwareView.selectionError && firmwareView.catalog) selectCatalogFirmware(firmwareView.selectedId);
}
