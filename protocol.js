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
  const SOCD_MODE = Object.freeze({ LAST_OVERRIDE: 0, A_PRIORITY: 1, B_PRIORITY: 2, NEUTRAL: 3 });
  const SOCD_PAIR_MODES = Object.freeze([
    Object.freeze([0, 0]),
    Object.freeze([1, 2]),
    Object.freeze([2, 1]),
    Object.freeze([3, 3]),
  ]);
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

    // SOCD is a reciprocal relationship. The original driver writes one
    // record to each physical key, reverses the output keycodes in the second
    // record, and encodes A/B priority as complementary per-key mode bytes.
    async setSocdPair({ first, second, keycodes, delay = 0, mode = SOCD_MODE.LAST_OVERRIDE }) {
      if (!first || !second) throw new TypeError("SOCD requires two physical key positions.");
      if (first.row === second.row && first.col === second.col) throw new RangeError("SOCD keys must be different.");
      if (!Array.isArray(keycodes) || keycodes.length !== 2) throw new RangeError("SOCD requires exactly two output keycodes.");
      const resolvedMode = clampByte(mode, "SOCD mode"),
        pairModes = SOCD_PAIR_MODES[resolvedMode];
      if (!pairModes) throw new RangeError("SOCD mode must be 0, 1, 2, or 3.");
      const shared = {
        first: [
          FAMILY.ADVANCED, 2,
          clampByte(first.row, "key A row"), clampByte(first.col, "key A column"), ADVANCED_MODE.SOCD,
          clampByte(second.row, "key B row"), clampByte(second.col, "key B column"),
          ...le16(keycodes[0], "key A output"), ...le16(keycodes[1], "key B output"),
          ...le16(delay, "SOCD delay"), pairModes[0],
        ],
        second: [
          FAMILY.ADVANCED, 2,
          clampByte(second.row, "key B row"), clampByte(second.col, "key B column"), ADVANCED_MODE.SOCD,
          clampByte(first.row, "key A row"), clampByte(first.col, "key A column"),
          ...le16(keycodes[1], "key B output"), ...le16(keycodes[0], "key A output"),
          ...le16(delay, "SOCD delay"), pairModes[1],
        ],
      };
      const firstReply = await this.transact(shared.first),
        secondReply = await this.transact(shared.second);
      return [decodeAdvanced(firstReply), decodeAdvanced(secondReply)];
    }

    // Rappy Snappy uses the same reciprocal pair layout as SOCD, but mode 7
    // has no priority byte. Firmware compares the two physical travel values;
    // the output keycodes are reversed in the partner record.
    async setRappySnappyPair({ first, second, keycodes, delay = 0 }) {
      if (!first || !second) throw new TypeError("Rappy Snappy requires two physical key positions.");
      if (first.row === second.row && first.col === second.col) throw new RangeError("Rappy Snappy keys must be different.");
      if (!Array.isArray(keycodes) || keycodes.length !== 2) throw new RangeError("Rappy Snappy requires exactly two output keycodes.");
      const packets = [
        [FAMILY.ADVANCED, 2, clampByte(first.row, "key A row"), clampByte(first.col, "key A column"), ADVANCED_MODE.RS, clampByte(second.row, "key B row"), clampByte(second.col, "key B column"), ...le16(keycodes[0], "key A output"), ...le16(keycodes[1], "key B output"), ...le16(delay, "RS delay")],
        [FAMILY.ADVANCED, 2, clampByte(second.row, "key B row"), clampByte(second.col, "key B column"), ADVANCED_MODE.RS, clampByte(first.row, "key A row"), clampByte(first.col, "key A column"), ...le16(keycodes[1], "key B output"), ...le16(keycodes[0], "key A output"), ...le16(delay, "RS delay")],
      ];
      const firstReply = await this.transact(packets[0]),
        secondReply = await this.transact(packets[1]);
      return [decodeAdvanced(firstReply), decodeAdvanced(secondReply)];
    }

    // Multi-Point Trigger is one mode-2 record. The firmware always stores
    // three output/depth slots; a two-stage setup uses keycode 0 in slot 3
    // while retaining three strictly ordered depth values.
    async setMultipointTrigger({ position, keycodes, depths }) {
      if (!position) throw new TypeError("MPT requires one physical host key.");
      if (!Array.isArray(keycodes) || keycodes.length !== 3) throw new RangeError("MPT requires exactly three keycode slots.");
      if (!Array.isArray(depths) || depths.length !== 3) throw new RangeError("MPT requires exactly three depth slots.");
      const active = keycodes.map(Number).filter((keycode) => keycode > 0);
      if (keycodes[0] <= 0 || keycodes[1] <= 0 || active.length < 2) throw new RangeError("MPT requires key values in its first two stages.");
      if (new Set(active).size !== active.length) throw new RangeError("MPT stage key values must be different.");
      const millimeters = depths.map(Number), encodedDepths = millimeters.map((depth) => Math.round(depth * 1000));
      if (millimeters.some((depth) => !Number.isFinite(depth) || depth <= 0) || !(millimeters[0] < millimeters[1] && millimeters[1] < millimeters[2])) throw new RangeError("MPT depths must be positive and strictly increasing.");
      const reply = await this.transact([
        FAMILY.ADVANCED, 2, clampByte(position.row, "host row"), clampByte(position.col, "host column"), ADVANCED_MODE.MPT,
        ...keycodes.flatMap((keycode, index) => le16(keycode, `stage ${index + 1} keycode`)),
        ...encodedDepths.flatMap((depth, index) => le16(depth, `stage ${index + 1} depth`)),
      ]);
      return decodeAdvanced(reply);
    }

    async setDynamicKeystroke({ position, keycodes, travels, dbs = [0, 4] }) {
      if (!position) throw new TypeError("DKS requires one physical host key.");
      if (!Array.isArray(keycodes) || keycodes.length !== 4) throw new RangeError("DKS requires exactly four keycode slots.");
      if (!Array.isArray(travels) || travels.length !== 4) throw new RangeError("DKS requires exactly four trigger-point slots.");
      if (!Array.isArray(dbs) || dbs.length !== 2) throw new RangeError("DKS requires min/max travel values.");
      const reply = await this.transact([
        FAMILY.ADVANCED, 2, clampByte(position.row, "host row"), clampByte(position.col, "host column"), ADVANCED_MODE.DKS,
        ...keycodes.flatMap((keycode, index) => le16(keycode, `DKS keycode ${index + 1}`)),
        ...travels.map((travel, index) => clampByte(travel, `DKS trigger ${index + 1}`)),
        ...dbs.flatMap((db, index) => le16(Math.round(Number(db) * 1000), `DKS travel ${index + 1}`)),
      ]);
      return decodeAdvanced(reply);
    }

    // The three remaining captured higher-key modes share the AE64 family-06
    // record format.  MT uses two tap/hold outputs, TGL one latched output,
    // and END two outputs fired at the press/release edges.
    async setModTap({ position, keycodes, delay = 200 }) {
      if (!position) throw new TypeError("Mod-Tap requires one physical host key.");
      if (!Array.isArray(keycodes) || keycodes.length !== 2) throw new RangeError("Mod-Tap requires tap and hold keycodes.");
      const reply = await this.transact([
        FAMILY.ADVANCED, 2, clampByte(position.row, "host row"), clampByte(position.col, "host column"), ADVANCED_MODE.MT,
        ...le16(keycodes[0], "Mod-Tap tap keycode"), ...le16(keycodes[1], "Mod-Tap hold keycode"), ...le16(delay, "Mod-Tap delay"),
      ]);
      return decodeAdvanced(reply);
    }

    async setToggleKey({ position, keycode, delay = 200 }) {
      if (!position) throw new TypeError("Toggle Key requires one physical host key.");
      const reply = await this.transact([
        FAMILY.ADVANCED, 2, clampByte(position.row, "host row"), clampByte(position.col, "host column"), ADVANCED_MODE.TGL,
        ...le16(keycode, "Toggle Key output"), ...le16(delay, "Toggle Key delay"),
      ]);
      return decodeAdvanced(reply);
    }

    async setEndKey({ position, keycodes, delay = 0 }) {
      if (!position) throw new TypeError("End Key requires one physical host key.");
      if (!Array.isArray(keycodes) || keycodes.length !== 2) throw new RangeError("End Key requires press and release keycodes.");
      const reply = await this.transact([
        FAMILY.ADVANCED, 2, clampByte(position.row, "host row"), clampByte(position.col, "host column"), ADVANCED_MODE.END,
        ...le16(keycodes[0], "End Key press keycode"), ...le16(keycodes[1], "End Key release keycode"), ...le16(delay, "End Key delay"),
      ]);
      return decodeAdvanced(reply);
    }

    async getMacroMode(macroId) {
      const data = await this.transact([FAMILY.MACRO, 1, clampByte(macroId, "macro ID")]);
      return { macroId: data[2], valid: data[3] === 1, actionCount: read16(data, 4), repeatCount: read16(data, 6), mode: data[8] };
    }

    async setMacroMode({ macroId, valid = true, actionCount = 0, repeatCount = 1, mode = 0 }) {
      const reply = await this.transact([
        FAMILY.MACRO, 2, clampByte(macroId, "macro ID"), valid ? 1 : 0,
        ...le16(actionCount, "macro action count"), ...le16(repeatCount, "macro repeat count"),
        clampByte(mode, "macro playback mode"),
      ]);
      return { macroId: reply[2], valid: reply[3] === 1, actionCount: read16(reply, 4), repeatCount: read16(reply, 6), mode: reply[8] };
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

    async setMacroData({ macroId, offset = 0, actions = [] }) {
      if (!Array.isArray(actions)) throw new TypeError("Macro actions must be an array.");
      const bytes = actions.flatMap((action, index) => {
        const delay = Math.max(0, Math.min(0x7fff, Number(action.delay) || 0)),
          packed = ((action.pressed ? 0x80000000 : 0) | (Math.round(delay) << 16) | (Number(action.keycode) & 0xffff)) >>> 0;
        if (!Number.isInteger(Number(action.keycode)) || Number(action.keycode) <= 0) throw new RangeError(`Macro action ${index + 1} needs a keycode.`);
        return [packed & 0xff, (packed >>> 8) & 0xff, (packed >>> 16) & 0xff, (packed >>> 24) & 0xff];
      });
      return this.transact([FAMILY.MACRO, 4, clampByte(macroId, "macro ID"), clampByte(offset, "macro offset"), ...bytes]);
    }
  }

  const api = Object.freeze({ AE64HidTransport, DEVICE_FILTERS, REPORT_ID, REPORT_LENGTH, MATRIX_ROWS, MATRIX_COLS, DECORATIVE_ROWS, DECORATIVE_COLS, FAMILY, SAVE_GROUP, AXIS_DATA, ADVANCED_MODE, SOCD_MODE, SOCD_PAIR_MODES, LIGHTING_OPEN_MODE, le16, read16, decodeAdvanced, encodeColors, decodeColors });
  global.AE64Protocol = api;
  global.AE64HidTransport = AE64HidTransport;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
