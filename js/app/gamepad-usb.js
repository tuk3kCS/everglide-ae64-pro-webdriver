"use strict";

// USB visibility is independent of the mapping's output mode. A SET reply only
// acknowledges a queued transition; success requires identity and state readback.
async function changeGamepadUsbDevice(enabled) {
  const connection = state.transport;
  if (typeof enabled !== "boolean" || !connection?.connected || state.usbSwitchBusy ||
      state.firmwareBusy || state.fnLightingBusy || state.writeInFlight)
    throw new Error("The keyboard is not ready to change its Xbox device state.");
  state.usbSwitchBusy = true;
  stopPolling(); stopProfilePolling(); clearTimeout(state.timers.autoApply);
  showProgress("Changing Xbox controller device", "The keyboard's USB connection will reconnect briefly. Waiting to verify the same keyboard.");
  try {
    const original = window.AE64Firmware.decodeInfo(await connection.raw([1, 2]));
    window.AE64Firmware.checkIdentity(original, 0);
    if (!original.serial) throw new Error("The keyboard did not provide a unique USB identity. Its device state was not changed.");
    const current = await window.AE64GamepadProtocol.readUsbState(connection);
    if (current.phase !== 0) throw new Error("A USB device change is already pending. Reconnect and read its state again.");
    if (current.enabled === enabled) return { enabled, verified: true, revision: current.revision };
    await window.AE64GamepadProtocol.setUsbEnabled(connection, enabled, current.revision);
    await new Promise((resolve) => setTimeout(resolve, 400));
    await connection.close().catch(() => {});
    if (state.transport === connection) state.transport = null;
    const reconnector = new window.AE64FirmwareReconnect.Reconnector({
      getDevices: () => navigator.hid.getDevices(),
      checkIdentity: window.AE64Firmware.checkIdentity,
      timeout: 15000, interval: 250,
      inspect: async (device) => {
        const found = await inspectFirmwareDevice(device);
        try {
          window.AE64Firmware.checkIdentity(found.info, 0, original);
          const usb = await window.AE64GamepadProtocol.readUsbState(found.transport);
          if (usb.phase !== 0 || usb.enabled !== enabled || usb.targetEnabled !== enabled)
            throw new Error("The requested Xbox device state has not been confirmed.");
          return { ...found, usb };
        } catch (error) { await found.transport.close().catch(() => {}); throw error; }
      },
    });
    let found;
    try { found = await reconnector.wait({ mode: 0, original, preferred: connection.device }); }
    catch (_) { throw new Error("USB reconnection did not confirm the Xbox device state. Reconnect the keyboard and read its state before trying again."); }
    state.transport = found.transport; state.knownDevice = found.transport.device;
    // The MCU did not restart. Keep local drafts and rebind their protocol client.
    if (fnLightingView.transport === connection && fnLightingView.caps?.verified) {
      fnLightingView.generation++;
      fnLightingView.transport = found.transport;
      fnLightingView.client = new window.AE64FnRgb.Client(found.transport);
    }
    if (gamepadOverview.transport === connection && gamepadOverview.config)
      rememberGamepadProfile(gamepadOverview.config, found.transport);
    log("Xbox USB device visibility verified", { enabled, revision: found.usb.revision });
    return { enabled, verified: true, revision: found.usb.revision };
  } catch (error) {
    log("Xbox USB device change not confirmed", error.message);
    throw error;
  } finally {
    state.usbSwitchBusy = false; hideProgress(); renderStatus();
  }
}
