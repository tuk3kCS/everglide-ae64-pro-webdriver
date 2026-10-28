/* Automatic reconnect of an already authorized physical keyboard. */
(function (root) {
  "use strict";
  function eligible(device) {
    return device?.vendorId === 0x1ca6 && device.collections?.some((c) =>
      c.usagePage === 0xff80 || device.productId === 0x300a && c.usagePage === 0xffb0 && c.usage === 1);
  }
  class Reconnector {
    constructor({ getDevices, inspect, checkIdentity, now = Date.now,
      delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), timeout = 90000, interval = 250 }) {
      this.getDevices = getDevices; this.inspect = inspect; this.checkIdentity = checkIdentity;
      this.now = now; this.delay = delay; this.timeout = timeout; this.interval = interval;
    }
    async wait({ mode, original, preferred }) {
      const deadline = this.now() + this.timeout;
      let lastError;
      while (this.now() < deadline) {
        let candidates = [];
        try { candidates = (await this.getDevices()).filter(eligible); }
        catch (error) { lastError = error; }
        candidates.sort((a, b) => Number(b === preferred) - Number(a === preferred));
        const matches = [];
        for (const device of candidates) {
          let found;
          try {
            found = await this.inspect(device);
            const sameSerial = Boolean(original.serial && found.info.serial === original.serial);
            // USB mode changes can replace the HIDDevice object. A stable serial
            // identifies it; an unrelated same-model device is never a fallback.
            if (device !== preferred && !sameSerial) continue;
            this.checkIdentity(found.info, mode, original);
            if (device === preferred) { const accepted = found; found = null; return { ...accepted, explicit: false }; }
            matches.push(found); found = null;
          } catch (error) { lastError = error; }
          finally { if (found?.transport) await found.transport.close().catch(() => {}); }
        }
        if (matches.length === 1) return { ...matches[0], explicit: false };
        for (const found of matches) await found.transport.close().catch(() => {});
        if (matches.length > 1) lastError = new Error("More than one keyboard reported the same identity.");
        await this.delay(this.interval);
      }
      const error = new Error(mode === 255
        ? "The keyboard bootloader could not reconnect automatically. Unplug and reconnect the keyboard, then use Reconnect keyboard to finish recovery."
        : "The firmware validated, but the keyboard application could not reconnect automatically. Reconnect the keyboard to check its state.");
      error.name = "FirmwareReconnectError"; error.mode = mode;
      if (lastError) error.cause = lastError;
      throw error;
    }
  }
  root.AE64FirmwareReconnect = Object.freeze({ Reconnector, eligible });
  if (typeof module !== "undefined" && module.exports) module.exports = root.AE64FirmwareReconnect;
})(typeof globalThis !== "undefined" ? globalThis : this);
