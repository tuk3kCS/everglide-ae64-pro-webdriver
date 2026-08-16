/*
 * AE64 Pro vendor-HID protocol.
 *
 * Recovered from the manufacturer WebHID bundle referenced by webhid.har.
 * It uses report ID 0 and zero-padded 64-byte output reports on the vendor
 * collection (usage page 0xffb0, usage 0x01). Multi-byte fields are LE.
 */
(function () {
  const REPORT_ID = 0;
  const REPORT_LENGTH = 64;
  const DEVICE = 1;
  const GLOBAL = 2;
  const LAYOUT_AND_KEY = 3;
  const PERFORMANCE = 4;

  const toUint16 = (value, field) => {
    const result = Math.round(Number(value));
    if (!Number.isInteger(result) || result < 0 || result > 0xffff) throw new RangeError(`${field} must be a uint16`);
    return result;
  };
  const le16 = (value, field = "value") => {
    const number = toUint16(value, field);
    return [number & 0xff, number >> 8];
  };
  const read16 = (data, offset) => (data[offset] || 0) | ((data[offset + 1] || 0) << 8);
  const millimeters = (value, field) => le16(Number(value) * 1000, field);

  class AE64HidTransport {
    static filters = [{ vendorId: 0x1ca6, productId: 0x300a, usagePage: 0xffb0, usage: 0x01 }];

    constructor(device) {
      this.device = device;
      this.pending = null;
      this.queue = Promise.resolve();
      this.onInputReport = this.onInputReport.bind(this);
    }

    get connected() { return Boolean(this.device?.opened); }

    async open() {
      if (!this.device) throw new Error("No HID device selected.");
      const vendorCollection = this.device.collections?.some((collection) => collection.usagePage === 0xffb0 && collection.usage === 0x01);
      if (!vendorCollection) throw new Error("The selected AE64 Pro device does not expose the FFB0:0001 configuration collection.");
      if (!this.device.opened) await this.device.open();
      this.device.addEventListener("inputreport", this.onInputReport);
    }

    async close() {
      this.device?.removeEventListener("inputreport", this.onInputReport);
      if (this.device?.opened) await this.device.close();
    }

    onInputReport(event) {
      // The manufacturer client accepts every report from the dedicated vendor
      // collection. Some firmware variants reply with a non-zero input report ID
      // even though all requests use output report ID 0.
      if (!this.pending) return;
      const bytes = new Uint8Array(event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength));
      const pending = this.pending;
      this.pending = null;
      clearTimeout(pending.timer);
      pending.resolve(bytes);
    }

    frame(payload) {
      const data = Array.from(payload);
      if (data.length > REPORT_LENGTH || data.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 0xff)) throw new RangeError("Invalid HID packet.");
      const frame = new Uint8Array(REPORT_LENGTH);
      frame.set(data);
      return frame;
    }

    transact(payload, timeout = 1200) {
      const run = async () => {
        if (!this.connected) throw new Error("Keyboard is not connected.");
        return new Promise(async (resolve, reject) => {
          const timer = setTimeout(() => {
            if (this.pending?.timer === timer) this.pending = null;
            reject(new Error("AE64 Pro did not answer the HID request."));
          }, timeout);
          this.pending = { resolve, reject, timer };
          try {
            await this.device.sendReport(REPORT_ID, this.frame(payload));
          } catch (error) {
            if (this.pending?.timer === timer) this.pending = null;
            clearTimeout(timer);
            reject(error);
          }
        });
      };
      const result = this.queue.then(run, run);
      this.queue = result.catch(() => undefined);
      return result;
    }

    async getDeviceInfo() {
      const data = await this.transact([DEVICE, 2]);
      return { type: data[2], subType: data[3], boardId: data[4] | (data[5] << 8) | (data[6] << 16) | (data[7] << 24), firmware: Array.from(data.slice(8, 12)).join("."), serial: Array.from(data.slice(17, 29)).filter(Boolean).join("") };
    }

    async getDeviceFeature() {
      const data = await this.transact([DEVICE, 3]);
      return { magnetic: Boolean(data[2] & 2), usb: Boolean(data[3] & 1), rgb: Boolean(data[4] & 1) };
    }

    async getRtPrecision() {
      const data = await this.transact([GLOBAL, 12, 0]);
      return data[3] / 1000;
    }

    // Global / SaveParam. The firmware keeps edits in its active parameter bank
    // until this command commits the specified group to non-volatile memory.
    async saveParameters(group) {
      if (!Number.isInteger(group) || group < 0 || group > 0xff) throw new RangeError("Invalid parameter group.");
      await this.transact([GLOBAL, 2, group]);
    }

    async getPerformance(position) {
      const data = await this.transact([PERFORMANCE, 1, position.row, position.col]);
      return {
        mode: data[4], normalPress: read16(data, 5) / 1000, normalRelease: read16(data, 7) / 1000,
        rtFirstTouch: read16(data, 9) / 1000, rtPress: read16(data, 11) / 1000, rtRelease: read16(data, 13) / 1000,
        pressDeadStroke: read16(data, 15) / 1000, releaseDeadStroke: read16(data, 17) / 1000,
        axis: data[19], calibrate: data[20], axisV2Id: read16(data, 21), axisRangeMax: read16(data, 23), axisCoefficient: read16(data, 25)
      };
    }

    async setPerformance(position, setting) {
      const data = [PERFORMANCE, 2, position.row, position.col, setting.mode,
        ...millimeters(setting.normalPress, "normalPress"), ...millimeters(setting.normalRelease || 0, "normalRelease"),
        ...millimeters(setting.rtFirstTouch || 0, "rtFirstTouch"), ...millimeters(setting.rtPress || 0, "rtPress"), ...millimeters(setting.rtRelease || 0, "rtRelease"),
        ...millimeters(setting.pressDeadStroke || 0, "pressDeadStroke"), ...millimeters(setting.releaseDeadStroke || 0, "releaseDeadStroke"),
        setting.axis || 0, setting.calibrate || 0, ...le16(setting.axisV2Id || 0, "axisV2Id"), ...le16(setting.axisRangeMax || 0, "axisRangeMax"), ...le16(setting.axisCoefficient || 0, "axisCoefficient")];
      await this.transact(data);
    }

    async getKeyCode(position, layer = 0) {
      const data = await this.transact([LAYOUT_AND_KEY, 3, layer, position.row, position.col]);
      return { layer: data[2], row: data[3], col: data[4], keycode: read16(data, 5) };
    }

    async setKeyCode(position, keycode, layer = 0) {
      await this.transact([LAYOUT_AND_KEY, 4, layer, position.row, position.col, ...le16(keycode, "keycode")]);
    }
  }

  window.AE64HidTransport = AE64HidTransport;
})();
