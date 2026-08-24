"use strict";

/*
 * Everglide AE64 Pro WebHID protocol.
 *
 * Packet layouts were reconstructed from the captured manufacturer driver and
 * checked against the keyboard's USB HID descriptor. Firmware-update and
 * bootloader commands are deliberately absent.
 */
(function exposeAE64Protocol(global) {
  const REPORT_ID = 0;
  const REPORT_LENGTH = 64;
  const MATRIX_ROWS = 6;
  const MATRIX_COLS = 21;
  const DECORATIVE_ROWS = 1;
  const DECORATIVE_COLS = 38;

  const FAMILY = Object.freeze({ DEVICE: 1, GLOBAL: 2, LAYOUT: 3, PERFORMANCE: 4, LIGHTING: 5, ADVANCED: 6, MACRO: 7, CUSTOM: 10 });
  const SAVE_GROUP = Object.freeze({ ALL: 0, CALIBRATION: 1, PERFORMANCE: 2, LIGHTING: 3, LAYOUT: 4, ADVANCED: 5, MACRO: 6, AXIS: 7 });
  const AXIS_DATA = Object.freeze({ adc: 0, route: 1, calibration: 2, keyStatus: 3 });
  const ADVANCED_MODE = Object.freeze({ NONE: 0, DKS: 1, MPT: 2, MT: 3, TGL: 4, END: 5, SOCD: 6, RS: 7 });
  const LIGHTING_OPEN_MODE = Object.freeze({ OFF: 0, LOWER: 1, UPPER: 2, BOTH: 3 });
  const DEVICE_FILTERS = Object.freeze([Object.freeze({ vendorId: 0x1ca6, productId: 0x300a, usagePage: 0xffb0, usage: 0x01 })]);

  function clampByte(value, field = "value") {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0 || number > 0xff) throw new RangeError(`${field} must be an integer from 0 to 255.`);
    return number;
  }

  function uint16(value, field = "value") {
    const number = Math.round(Number(value));
    if (!Number.isInteger(number) || number < 0 || number > 0xffff) throw new RangeError(`${field} must be an unsigned 16-bit integer.`);
    return number;
  }

  function le16(value, field) {
    const number = uint16(value, field);
    return [number & 0xff, number >>> 8];
  }

  function read16(data, offset) {
    return Number(data[offset] || 0) | (Number(data[offset + 1] || 0) << 8);
  }

  function millimetres(value, field) {
    return le16(Math.round(Number(value || 0) * 1000), field);
  }

  function decodeSerial(bytes) {
    const values = Array.from(bytes).filter((value) => value !== 0 && value !== 0xff);
    if (values.length && values.every((value) => value <= 9)) return values.join("");
    return new TextDecoder().decode(Uint8Array.from(values)).replace(/\0+$/g, "");
  }

  function decodeColors(bytes, start = 4) {
    const colors = [];
    for (let offset = start; offset + 3 < bytes.length; offset += 4) {
      colors.push({ r: bytes[offset + 2], g: bytes[offset + 1], b: bytes[offset], custom: bytes[offset + 3] === 0xff });
    }
    return colors;
  }

  function encodeColors(colors, capacity = 15) {
    const payload = [];
    for (let index = 0; index < capacity; index += 1) {
      const color = colors[index] || { r: 0, g: 0, b: 0, custom: false };
      payload.push(clampByte(color.b || 0, "blue"), clampByte(color.g || 0, "green"), clampByte(color.r || 0, "red"), color.custom ? 0xff : 0);
    }
    return payload;
  }

  function decodeAdvanced(bytes) {
    const mode = bytes[4] || 0;
    const base = { row: bytes[2], col: bytes[3], mode, type: Object.keys(ADVANCED_MODE).find((key) => ADVANCED_MODE[key] === mode) || "UNKNOWN" };
    if (mode === ADVANCED_MODE.NONE) return base;
    if (mode === ADVANCED_MODE.DKS) return { ...base, keycodes: [read16(bytes, 5), read16(bytes, 7), read16(bytes, 9), read16(bytes, 11)], travels: Array.from(bytes.slice(13, 17)), deadzones: [read16(bytes, 17) / 1000, read16(bytes, 19) / 1000] };
    if (mode === ADVANCED_MODE.MPT) return { ...base, keycodes: [read16(bytes, 5), read16(bytes, 7), read16(bytes, 9)], depths: [read16(bytes, 11) / 1000, read16(bytes, 13) / 1000, read16(bytes, 15) / 1000] };
    if (mode === ADVANCED_MODE.MT) return { ...base, keycodes: [read16(bytes, 5), read16(bytes, 7)], time: read16(bytes, 9) };
    if (mode === ADVANCED_MODE.TGL) return { ...base, keycode: read16(bytes, 5), time: read16(bytes, 7) };
    if (mode === ADVANCED_MODE.END) return { ...base, keycodes: [read16(bytes, 5), read16(bytes, 7)], delay: read16(bytes, 9) };
    if (mode === ADVANCED_MODE.SOCD) return { ...base, pairedRow: bytes[5], pairedCol: bytes[6], keycodes: [read16(bytes, 7), read16(bytes, 9)], delay: read16(bytes, 11), socdMode: bytes[13] };
    if (mode === ADVANCED_MODE.RS) return { ...base, pairedRow: bytes[5], pairedCol: bytes[6], keycodes: [read16(bytes, 7), read16(bytes, 9)], delay: read16(bytes, 11) };
    return { ...base, raw: Array.from(bytes.slice(5)) };
  }

  class AE64HidTransport {
    static filters = DEVICE_FILTERS;

    static supported() { return Boolean(global.navigator?.hid); }

    static async request() {
      if (!AE64HidTransport.supported()) throw new Error("WebHID is unavailable. Use desktop Chrome or Edge on HTTPS or localhost.");
      const devices = await global.navigator.hid.requestDevice({ filters: DEVICE_FILTERS });
      if (!devices.length) throw new Error("No AE64 Pro was selected.");
      const transport = new AE64HidTransport(devices[0]);
      await transport.open();
      return transport;
    }

    constructor(device) {
      this.device = device;
      this.pending = null;
      this.queue = Promise.resolve();
      this.reportSubscribers = new Set();
      this.onInputReport = this.onInputReport.bind(this);
    }

    get connected() { return Boolean(this.device?.opened); }

    async open() {
      if (!this.device) throw new Error("No HID device was selected.");
      const collection = this.device.collections?.some((item) => item.usagePage === 0xffb0 && item.usage === 0x01);
      if (!collection) throw new Error("The selected device does not expose the AE64 FFB0:0001 configuration collection.");
      if (!this.device.opened) await this.device.open();
      this.device.removeEventListener?.("inputreport", this.onInputReport);
      this.device.addEventListener("inputreport", this.onInputReport);
    }

    async close() {
      this.device?.removeEventListener?.("inputreport", this.onInputReport);
      if (this.pending) {
        clearTimeout(this.pending.timer);
        this.pending.reject(new Error("Keyboard connection closed."));
        this.pending = null;
      }
      if (this.device?.opened) await this.device.close();
    }

    subscribeReports(listener) {
      this.reportSubscribers.add(listener);
      return () => this.reportSubscribers.delete(listener);
    }

    onInputReport(event) {
      const bytes = new Uint8Array(event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength));
      if (this.pending && this.pending.matcher(bytes)) {
        const pending = this.pending;
        this.pending = null;
        clearTimeout(pending.timer);
        pending.resolve(bytes);
        return;
      }
      this.reportSubscribers.forEach((listener) => {
        try { listener(bytes); } catch (error) { console.warn("AE64 report listener failed", error); }
      });
    }

    frame(payload) {
      const values = Array.from(payload, (value, index) => clampByte(value ?? 0, `packet byte ${index}`));
      if (values.length > REPORT_LENGTH) throw new RangeError(`HID packet exceeds ${REPORT_LENGTH} bytes.`);
      const frame = new Uint8Array(REPORT_LENGTH);
      frame.set(values);
      return frame;
    }

    transact(payload, options = {}) {
      const settings = typeof options === "number" ? { timeout: options } : options;
      const timeout = settings.timeout || 1500;
      const request = Array.from(payload);
      const matcher = settings.matcher || ((reply) => reply[0] === request[0] && reply[1] === request[1]);
      const run = async () => {
        if (!this.connected) throw new Error("AE64 Pro is not connected.");
        return new Promise(async (resolve, reject) => {
          const timer = setTimeout(() => {
            if (this.pending?.timer === timer) this.pending = null;
            reject(new Error(`AE64 Pro did not answer command ${request[0].toString(16).padStart(2, "0")}:${request[1].toString(16).padStart(2, "0")}.`));
          }, timeout);
          this.pending = { resolve, reject, timer, matcher };
          try {
            await this.device.sendReport(REPORT_ID, this.frame(request));
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

    raw(payload, options) { return this.transact(payload, options); }

    async getProtocolVersion() {
      const data = await this.transact([FAMILY.DEVICE, 1]);
      return { main: data[2], sub: data[3], hardware: data[4], software: data[5] };
    }

    async getDeviceInfo() {
      const data = await this.transact([FAMILY.DEVICE, 2]);
      const boardId = ((data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7]) >>> 0;
      return {
        type: data[2], subType: data[3], boardId,
        boardIdHex: boardId.toString(16).padStart(8, "0"),
        firmware: Array.from(data.slice(8, 12)).join("."),
        pcb: Array.from(data.slice(12, 16)).join("-"),
        runMode: data[16], serial: decodeSerial(data.slice(17, 29)),
        timestamp: new TextDecoder().decode(data.slice(29, 41)).replace(/\0+$/g, ""),
      };
    }

    async getDeviceFeature() {
      const data = await this.transact([FAMILY.DEVICE, 3]);
      return {
        axis: { mechanical: Boolean(data[2] & 1), magnetic: Boolean(data[2] & 2), optical: Boolean(data[2] & 4), inductive: Boolean(data[2] & 8), magnetic3D: Boolean(data[2] & 16) },
        connection: { usb: Boolean(data[3] & 1), wireless24: Boolean(data[3] & 2), bluetooth: Boolean(data[3] & 4), usb3: Boolean(data[3] & 8) },
        basic: { rgb: Boolean(data[4] & 1), knob: Boolean(data[4] & 2) },
        extended: { smallScreen: Boolean(data[5] & 1), fullScreen: Boolean(data[5] & 2), haptic: Boolean(data[5] & 4), voicePlayback: Boolean(data[5] & 8), voiceRecognition: Boolean(data[5] & 16), gamepad: Boolean(data[5] & 32), dotMatrix: Boolean(data[5] & 64) },
        raw: Array.from(data.slice(2, 6)),
      };
    }

    async saveParameters(group) { await this.transact([FAMILY.GLOBAL, 2, clampByte(group, "save group")]); }

    async getRtPrecision() {
      const data = await this.transact([FAMILY.GLOBAL, 12, 0]);
      return data[3] / 1000;
    }

    async getConfigList() {
      const data = await this.transact([FAMILY.GLOBAL, 3, 0]);
      return Array.from({ length: data[3] || 0 }, (_, index) => index);
    }

    async getCurrentConfig() {
      const data = await this.transact([FAMILY.GLOBAL, 3, 1]);
      return data[3] || 0;
    }

    async switchConfig(index) {
      const data = await this.transact([FAMILY.GLOBAL, 3, 2, clampByte(index, "config index")]);
      return data[3];
    }

    async getConfigName(index) {
      const data = await this.transact([FAMILY.GLOBAL, 3, 3, clampByte(index, "config index")]);
      return new TextDecoder().decode(Uint8Array.from(data.slice(4, 36).filter((value) => value !== 0 && value !== 0xff)));
    }

    async setConfigName(index, name) {
      const encoded = Array.from(new TextEncoder().encode(String(name))).slice(0, 32);
      await this.transact([FAMILY.GLOBAL, 3, 4, clampByte(index, "config index"), ...encoded]);
    }

    async getSystemModes() {
      const data = await this.transact([FAMILY.GLOBAL, 4, 0]);
      return Array.from(data.slice(4, 4 + (data[3] || 0)));
    }

    async getSystemMode() {
      const data = await this.transact([FAMILY.GLOBAL, 4, 1]);
      return data[3];
    }

    async setSystemMode(mode) { await this.transact([FAMILY.GLOBAL, 4, 2, clampByte(mode, "system mode")]); }

    async getReportRates() {
      const data = await this.transact([FAMILY.GLOBAL, 5, 0]);
      return Array.from(data.slice(4, 4 + (data[3] || 0)));
    }

    async getReportRate() {
      const data = await this.transact([FAMILY.GLOBAL, 5, 1]);
      return data[3];
    }

    async setReportRate(rate) { await this.transact([FAMILY.GLOBAL, 5, 2, clampByte(rate, "report rate")]); }
    async setCalibration(enabled) { await this.transact([FAMILY.GLOBAL, 6, enabled ? 0 : 1]); }

    async getAxisLibrary() {
      const data = await this.transact([FAMILY.GLOBAL, 7, 0]);
      const ids = [];
      for (let offset = 4; offset < 4 + (data[3] || 0) * 2; offset += 2) ids.push(read16(data, offset));
      return ids;
    }

    async getLightingAreas() {
      const data = await this.transact([FAMILY.GLOBAL, 8, 0]);
      const areas = [];
      for (let index = 0; index < (data[3] || 0); index += 1) {
        const offset = 4 + index * 4;
        areas.push({ index: data[offset], count: data[offset + 1], rows: data[offset + 2], cols: data[offset + 3] });
      }
      return areas;
    }

    async getDefaultAxis() {
      const data = await this.transact([FAMILY.GLOBAL, 9, 1]);
      return data[3];
    }

    async setDefaultAxis(axisId) { await this.transact([FAMILY.GLOBAL, 9, 0, clampByte(axisId, "axis ID")]); }

    async getDoubleLighting() {
      const data = await this.transact([FAMILY.GLOBAL, 10, 0]);
      return data[3];
    }

    async getSpecialLighting() {
      const data = await this.transact([FAMILY.GLOBAL, 11, 0]);
      return [1, 3, 5][data[3]] || 1;
    }

    async getLightingSleepTime() {
      const data = await this.transact([FAMILY.GLOBAL, 13, 1]);
      return read16(data, 3);
    }

    async setLightingSleepTime(minutes) { await this.transact([FAMILY.GLOBAL, 13, 0, ...le16(minutes, "sleep time")]); }

    async getMacroSpaceInfo() {
      const data = await this.transact([FAMILY.GLOBAL, 14, 0]);
      return { count: data[3], capacity: read16(data, 4) };
    }

    async getShakeOptimization() {
      const data = await this.transact([FAMILY.GLOBAL, 16, 1]);
      return data[3] === 1;
    }

    async setShakeOptimization(enabled) { await this.transact([FAMILY.GLOBAL, 16, 0, enabled ? 1 : 0]); }
    async openWebDriver() { await this.transact([FAMILY.CUSTOM, 1, 1, 2, 0]); }

    async getKeyLayoutStyle(row) {
      const data = await this.transact([FAMILY.LAYOUT, 5, clampByte(row, "row")]);
      const style = [];
      for (let offset = 3; offset + 1 < data.length; offset += 2) {
        const packed = read16(data, offset);
        style.push({ row: ((packed >>> 11) & 31) / 4, col: ((packed >>> 4) & 127) / 4, ratio: packed & 15 });
      }
      return style;
    }

    async getKeyLayout(layer, row) {
      const data = await this.transact([FAMILY.LAYOUT, 1, clampByte(layer, "layer"), clampByte(row, "row")]);
      const keycodes = [];
      for (let offset = 4; offset + 1 < data.length; offset += 2) keycodes.push(read16(data, offset));
      return { layer: data[2], row: data[3], keycodes };
    }

    async setKeyLayout(layer, row, keycodes) {
      if (!Array.isArray(keycodes) || keycodes.length > 30) throw new RangeError("A layout row may contain at most 30 keycodes.");
      await this.transact([FAMILY.LAYOUT, 2, clampByte(layer, "layer"), clampByte(row, "row"), ...keycodes.flatMap((code) => le16(code, "keycode"))]);
    }

    async getKeyCode(position, layer = 0) {
      const data = await this.transact([FAMILY.LAYOUT, 3, clampByte(layer, "layer"), clampByte(position.row, "row"), clampByte(position.col, "column")]);
      return { layer: data[2], row: data[3], col: data[4], keycode: read16(data, 5) };
    }

    async setKeyCode(position, keycode, layer = 0) {
      await this.transact([FAMILY.LAYOUT, 4, clampByte(layer, "layer"), clampByte(position.row, "row"), clampByte(position.col, "column"), ...le16(keycode, "keycode")]);
    }

    async getDefaultKeyLayout(system, layer, row) {
      const systemLayer = (clampByte(system, "system") << 4) | (clampByte(layer, "layer") & 15);
      const data = await this.transact([FAMILY.LAYOUT, 6, systemLayer, clampByte(row, "row")]);
      const keycodes = [];
      for (let offset = 4; offset + 1 < data.length; offset += 2) keycodes.push(read16(data, offset));
      return { system: data[2] >>> 4, layer: data[2] & 15, row: data[3], keycodes };
    }

    async getPerformance(position) {
      const data = await this.transact([FAMILY.PERFORMANCE, 1, clampByte(position.row, "row"), clampByte(position.col, "column")]);
      return {
        mode: data[4], normalPress: read16(data, 5) / 1000, normalRelease: read16(data, 7) / 1000,
        rtFirstTouch: read16(data, 9) / 1000, rtPress: read16(data, 11) / 1000, rtRelease: read16(data, 13) / 1000,
        pressDeadStroke: read16(data, 15) / 1000, releaseDeadStroke: read16(data, 17) / 1000,
        axis: data[19], calibrate: data[20], axisV2Id: read16(data, 21), axisRangeMax: read16(data, 23), axisCoefficient: read16(data, 25),
      };
    }

    async setPerformance(position, setting) {
      const payload = [
        FAMILY.PERFORMANCE, 2, clampByte(position.row, "row"), clampByte(position.col, "column"), clampByte(setting.mode || 0, "mode"),
        ...millimetres(setting.normalPress, "normal press"), ...millimetres(setting.normalRelease, "normal release"),
        ...millimetres(setting.rtFirstTouch, "RT first touch"), ...millimetres(setting.rtPress, "RT press"), ...millimetres(setting.rtRelease, "RT release"),
        ...millimetres(setting.pressDeadStroke, "top dead zone"), ...millimetres(setting.releaseDeadStroke, "bottom dead zone"),
        clampByte(setting.axis || 0, "axis"), clampByte(setting.calibrate || 0, "calibration"),
        ...le16(setting.axisV2Id || 0, "axis v2 ID"), ...le16(setting.axisRangeMax || 0, "axis range"), ...le16(setting.axisCoefficient || 0, "axis coefficient"),
      ];
      await this.transact(payload);
    }

    async getAxisData(type, row) {
      const kind = typeof type === "string" ? AXIS_DATA[type] : type;
      if (!Number.isInteger(kind)) throw new RangeError("Unknown axis-data type.");
      const data = await this.transact([FAMILY.PERFORMANCE, 3, kind, clampByte(row, "row")]);
      const values = [];
      for (let offset = 4; offset + 1 < data.length; offset += 2) values.push(read16(data, offset));
      return { type: data[2], row: data[3], values };
    }

    async getLightingBase(area = 0) {
      const data = await this.transact([FAMILY.LIGHTING, 1, clampByte(area, "lighting area"), 0]);
      return { area: data[2], open: data[4] !== 0, openMode: data[4], mode: data[5], brightness: data[6], speed: data[7], direction: data[8], paletteIndex: data[9] };
    }

    async setLightingBase(setting, area = 0) {
      await this.transact([FAMILY.LIGHTING, 2, clampByte(area, "lighting area"), 0, setting.open ? (setting.openMode || 1) : 0, clampByte(setting.mode || 0, "lighting mode"), clampByte(setting.brightness || 0, "brightness"), clampByte(setting.speed || 0, "speed"), clampByte(setting.direction || 0, "direction"), clampByte(setting.paletteIndex || 0, "palette index")]);
    }

    async getLightingPalette(area = 0) {
      const data = await this.transact([FAMILY.LIGHTING, 1, clampByte(area, "lighting area"), 1]);
      const colors = [];
      for (let offset = 4; offset + 3 < 36; offset += 4) colors.push({ r: data[offset + 2], g: data[offset + 1], b: data[offset], hue: data[offset + 3] });
      return colors;
    }

    async setLightingPalette(colors, area = 0) {
      if (!Array.isArray(colors) || colors.length !== 8) throw new RangeError("The lighting palette requires exactly eight colors.");
      const payload = colors.flatMap((color) => [clampByte(color.b, "blue"), clampByte(color.g, "green"), clampByte(color.r, "red"), clampByte(color.hue || 0, "hue")]);
      await this.transact([FAMILY.LIGHTING, 2, clampByte(area, "lighting area"), 1, ...payload]);
    }

    async getCustomLightingPacket(packet, area = 0) {
      const data = await this.transact([FAMILY.LIGHTING, 3, clampByte(area, "lighting area"), clampByte(packet, "packet")]);
      return decodeColors(data, 4);
    }

    async setCustomLightingPacket(packet, colors, area = 0) {
      await this.transact([FAMILY.LIGHTING, 4, clampByte(area, "lighting area"), clampByte(packet, "packet"), ...encodeColors(colors)]);
    }

    async readCustomLighting(rows = MATRIX_ROWS, cols = MATRIX_COLS, area = 0) {
      const count = rows * cols;
      const colors = [];
      for (let packet = 0; packet < Math.ceil(count / 15); packet += 1) colors.push(...await this.getCustomLightingPacket(packet, area));
      return colors.slice(0, count);
    }

    // Command 05:03 is also the firmware's live LED framebuffer read. During
    // dynamic effects the RGB bytes change even when the custom flag is zero.
    async readLiveLighting(rows = MATRIX_ROWS, cols = MATRIX_COLS, area = 0) {
      return this.readCustomLighting(rows, cols, area);
    }

    async writeCustomLighting(colors, rows = MATRIX_ROWS, cols = MATRIX_COLS, area = 0) {
      const count = rows * cols;
      const normalized = Array.from({ length: count }, (_, index) => colors[index] || { r: 0, g: 0, b: 0, custom: false });
      for (let packet = 0; packet < Math.ceil(count / 15); packet += 1) await this.setCustomLightingPacket(packet, normalized.slice(packet * 15, packet * 15 + 15), area);
    }

    async getAdvancedKey(position) {
      const data = await this.transact([FAMILY.ADVANCED, 1, clampByte(position.row, "row"), clampByte(position.col, "column"), 0]);
      return decodeAdvanced(data);
    }

    async clearAdvancedKey(position) { await this.transact([FAMILY.ADVANCED, 2, clampByte(position.row, "row"), clampByte(position.col, "column"), ADVANCED_MODE.NONE]); }

    async getMacroMode(macroId) {
      const data = await this.transact([FAMILY.MACRO, 1, clampByte(macroId, "macro ID")]);
      return { macroId: data[2], valid: data[3] === 1, actionCount: read16(data, 4), repeatCount: read16(data, 6), mode: data[8] };
    }

    async getMacroData(macroId, offset = 0) {
      const data = await this.transact([FAMILY.MACRO, 3, clampByte(macroId, "macro ID"), clampByte(offset, "macro offset")]);
      const actions = [];
      for (let index = 4; index + 3 < data.length; index += 4) {
        const packed = (data[index] | (data[index + 1] << 8) | (data[index + 2] << 16) | (data[index + 3] << 24)) >>> 0;
        actions.push({ pressed: Boolean(packed >>> 31), delay: (packed >>> 16) & 0x7fff, keycode: packed & 0xffff });
      }
      return actions;
    }
  }

  const api = Object.freeze({ AE64HidTransport, DEVICE_FILTERS, REPORT_ID, REPORT_LENGTH, MATRIX_ROWS, MATRIX_COLS, DECORATIVE_ROWS, DECORATIVE_COLS, FAMILY, SAVE_GROUP, AXIS_DATA, ADVANCED_MODE, LIGHTING_OPEN_MODE, le16, read16, decodeAdvanced, encodeColors, decodeColors });
  global.AE64Protocol = api;
  global.AE64HidTransport = AE64HidTransport;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
