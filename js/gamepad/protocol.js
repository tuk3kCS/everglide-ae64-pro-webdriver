/* Original AGP1 configuration protocol. SPDX-License-Identifier: MIT */
(function (root) {
  "use strict";
  const Model = root.AE64GamepadModel || (typeof require === "function" ? require("./model.js") : null);
  const MAGIC = [65, 71, 80, 49], CONFIG_MAGIC = [65, 71, 67, 49];
  const FAMILY = 0x10, VERSION = 1, BOARD = 0x0030000a, CONFIG_BYTES = 208;
  const CMD = Object.freeze({ INFO: 0x20, BEGIN: 0x21, WRITE: 0x22, COMMIT: 0x23, ABORT: 0x24, READ: 0x25 });
  const MODES = ["off", "controller", "mixed"], OPPOSITION = ["difference", "neutral", "deeper"];
  const STATUS = ["ok", "unsupported operation", "invalid packet", "configuration conflict", "invalid configuration", "transfer incomplete", "checksum mismatch", "backend unavailable", "storage failure"];
  let sequence = 0;
  class UnsupportedFirmwareError extends Error { constructor(message = "This keyboard is running firmware without the verified custom gamepad protocol.") { super(message); this.name = "UnsupportedFirmwareError"; } }
  class KeyboardRejectedError extends Error {
    constructor(status, command) { super(`Keyboard rejected ${command === CMD.COMMIT ? "profile" : "request"}: ${STATUS[status] || "unknown error"}.`); this.name = "KeyboardRejectedError"; this.status = status; this.command = command; this.rejected = true; }
  }
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const value of bytes) { crc ^= value; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    return (crc ^ 0xffffffff) >>> 0;
  }
  const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  function encode(input) {
    const config = Model.validate(input), bytes = new Uint8Array(CONFIG_BYTES), data = view(bytes);
    bytes.set(CONFIG_MAGIC); bytes[4] = VERSION; bytes[5] = MODES.indexOf(config.mode); bytes[6] = config.transport === "hid" ? 1 : 2;
    config.sticks.forEach((stick, i) => { bytes[7 + i] = Number(stick.circular) | (OPPOSITION.indexOf(stick.opposition) << 1); data.setUint16(10 + i * 2, Math.round(stick.deadzone * 10000), true); });
    data.setUint16(14, 24, true);
    config.bindings.forEach((binding, i) => {
      const offset = 16 + i * 8; bytes[offset] = binding.key === null ? 255 : binding.key; bytes[offset + 1] = binding.curve === "smooth" ? 1 : 0;
      data.setUint16(offset + 2, Model.um(binding.startMm), true); data.setUint16(offset + 4, Model.um(binding.endMm), true); data.setUint16(offset + 6, Model.um(binding.maxTravelMm), true);
    });
    return bytes;
  }
  function decode(bytes, name = "Keyboard gamepad profile") {
    if (!(bytes instanceof Uint8Array) || bytes.length !== CONFIG_BYTES || !CONFIG_MAGIC.every((v, i) => bytes[i] === v) || bytes[4] !== VERSION || bytes[9] !== 0 || view(bytes).getUint16(14, true) !== 24) throw new Error("Unsupported or damaged gamepad configuration.");
    if (bytes[5] > 2 || ![1, 2].includes(bytes[6]) || [bytes[7], bytes[8]].some((v) => (v & ~7) || (v >> 1) > 2)) throw new Error("Invalid gamepad mode settings.");
    const data = view(bytes), config = Model.defaults(); config.name = name; config.mode = MODES[bytes[5]]; config.transport = bytes[6] === 1 ? "hid" : "xinput";
    config.sticks = [0, 1].map((i) => ({ circular: Boolean(bytes[7 + i] & 1), opposition: OPPOSITION[bytes[7 + i] >> 1], deadzone: data.getUint16(10 + i * 2, true) / 10000 }));
    config.bindings = Model.CONTROLS.map(({ id }, i) => { const o = 16 + i * 8; if (bytes[o + 1] > 1) throw new Error("Unknown response curve."); return { control: id, key: bytes[o] === 255 ? null : bytes[o], curve: bytes[o + 1] ? "smooth" : "linear", startMm: data.getUint16(o + 2, true) / 1000, endMm: data.getUint16(o + 4, true) / 1000, maxTravelMm: data.getUint16(o + 6, true) / 1000 }; });
    return Model.validate(config);
  }
  function packet(command, payload = [], seq = (++sequence & 255)) {
    if (payload.length > 54) throw new RangeError("AGP1 payload exceeds 54 bytes.");
    const bytes = new Uint8Array(64); bytes.set([FAMILY, command, VERSION, seq, ...MAGIC, 0, payload.length]); bytes.set(payload, 10); return bytes;
  }
  async function request(transport, command, payload = []) {
    if (!transport?.raw) throw new Error("A connected AE64 transport is required.");
    const outgoing = packet(command, payload);
    const reply = await transport.raw(outgoing, { timeout: 1500, matcher: (b) => (b[0] === FAMILY && b[1] === 255) || (b[0] === FAMILY && b[1] === command && b[3] === outgoing[3] && MAGIC.every((v, i) => b[4 + i] === v)) });
    if (reply[0] === FAMILY && reply[1] === 255) throw new UnsupportedFirmwareError();
    if (reply.length !== 64 || reply[0] !== FAMILY || reply[1] !== command || reply[2] !== VERSION || reply[3] !== outgoing[3] || !MAGIC.every((v, i) => reply[4 + i] === v) || reply[9] > 54) throw new Error("Invalid custom-firmware reply.");
    if (reply[8] !== 0) throw new KeyboardRejectedError(reply[8], command);
    return reply.slice(10, 10 + reply[9]);
  }
  async function probe(transport) {
    const bytes = await request(transport, CMD.INFO);
    if (bytes.length !== 20 || view(bytes).getUint32(0, true) !== BOARD || bytes[5] !== 24 || bytes[6] !== VERSION || bytes[7] !== 0 || view(bytes).getUint16(14, true) !== CONFIG_BYTES) throw new UnsupportedFirmwareError("The keyboard did not identify the supported AE64 gamepad firmware.");
    const data = view(bytes);
    return { verified: true, protocolVersion: VERSION, boardId: BOARD, transports: { hid: Boolean(bytes[4] & 1), xinput: Boolean(bytes[4] & 2) }, persistent: Boolean(bytes[4] & 4), revision: data.getUint32(8, true), maxTravelUm: data.getUint16(12, true), configBytes: CONFIG_BYTES, crc32: data.getUint32(16, true) };
  }
  const locks = new WeakSet();
  async function readTravelLimits(transport, input) {
    const config = Model.validate(input);
    if (typeof transport?.getPerformance !== "function") throw new Error("This connection cannot read switch travel limits.");
    const limits = [];
    for (const key of new Set(config.bindings.filter((b) => b.key !== null).map((b) => b.key))) {
      const physical = Model.KEYS[key], info = await transport.getPerformance(physical);
      const maximum = Number(info.axisRangeMax);
      if (!Number.isInteger(maximum) || maximum < 10 || maximum > 10000) throw new Error(`${physical.label}: the keyboard did not report a usable switch travel range. Check its switch settings and calibration.`);
      limits.push({ key, maxTravelUm: maximum, calibration: info.calibrate });
    }
    return limits;
  }
  function validateTravelLimits(input, limits) {
    const config = Model.validate(input), byKey = new Map(limits.map((limit) => [limit.key, limit]));
    const problems = [];
    for (const b of config.bindings) {
      if (b.key === null) continue;
      const maximum = byKey.get(b.key)?.maxTravelUm;
      if (!Number.isInteger(maximum) || maximum < 10 || maximum > 10000) throw new Error(`${Model.KEYS[b.key].label}: switch travel range is unavailable. Read keyboard travel limits again.`);
      if (Model.CONTROL.get(b.control).kind !== "button" && Model.um(b.endMm) > maximum)
        problems.push(`${Model.KEYS[b.key].label} (${b.control}): full output ${b.endMm.toFixed(2)} mm exceeds the keyboard's ${(maximum / 1000).toFixed(2)} mm range.`);
    }
    if (problems.length) throw new RangeError(problems.join("\n") + "\nUse keyboard travel limits, or lower full output for every affected assignment.");
    return config;
  }
  function fitTravelLimits(input, limits) {
    const config = Model.validate(input), byKey = new Map(limits.map((limit) => [limit.key, limit]));
    const next = { ...config, bindings: config.bindings.map((b) => {
      if (b.key === null) return { ...b };
      const maximum = byKey.get(b.key)?.maxTravelUm;
      if (!Number.isInteger(maximum) || maximum < 10 || maximum > 10000) throw new Error(`${Model.KEYS[b.key].label}: switch travel range is unavailable.`);
      if (Model.um(b.startMm) >= maximum) throw new RangeError(`${Model.KEYS[b.key].label} (${b.control}): lower Start below the keyboard's ${(maximum / 1000).toFixed(2)} mm range first.`);
      return { ...b, maxTravelMm: maximum / 1000, endMm: Math.min(b.endMm, maximum / 1000) };
    }) };
    return Model.validate(next);
  }
  async function read(transport) {
    const caps = await probe(transport), bytes = new Uint8Array(CONFIG_BYTES);
    for (let offset = 0; offset < CONFIG_BYTES; offset += 48) {
      const length = Math.min(48, CONFIG_BYTES - offset), payload = new Uint8Array(7), data = view(payload);
      data.setUint32(0, caps.revision, true); data.setUint16(4, offset, true); payload[6] = length;
      const reply = await request(transport, CMD.READ, payload);
      if (reply.length !== length + 6 || view(reply).getUint32(0, true) !== caps.revision || view(reply).getUint16(4, true) !== offset) throw new Error("Gamepad configuration changed while reading. Read again.");
      bytes.set(reply.slice(6), offset);
    }
    if (crc32(bytes) !== caps.crc32) throw new Error("Gamepad configuration read-back checksum mismatch.");
    return { config: decode(bytes), ...caps, bytes };
  }
  async function upload(transport, input) {
    const config = Model.validate(input), encoded = encode(config);
    if (locks.has(transport)) throw new Error("A gamepad transfer is already running.");
    locks.add(transport); let staging = false, committed = false, commitStarted = false;
    const token = new Uint8Array(8);
    if (!root.crypto?.getRandomValues) { locks.delete(transport); throw new Error("Secure random transaction identifiers are unavailable."); }
    do { root.crypto.getRandomValues(token); } while (!token.some(Boolean));
    try {
      const caps = await probe(transport);
      if (config.mode !== "off" && !caps.transports[config.transport]) throw new Error(`The connected firmware does not provide ${config.transport === "xinput" ? "native Xbox/XInput" : "USB HID gamepad"} output.`);
      // The native firmware validates against keyboard settings, not the draft's
      // editable switch-travel field. Check before staging any configuration.
      if (config.mode !== "off" && typeof transport.getPerformance === "function") validateTravelLimits(config, await readTravelLimits(transport, config));
      const begin = new Uint8Array(18); view(begin).setUint32(0, caps.revision, true); view(begin).setUint32(4, crc32(encoded), true); view(begin).setUint16(8, CONFIG_BYTES, true); begin.set(token, 10);
      await request(transport, CMD.BEGIN, begin); staging = true;
      for (let offset = 0; offset < CONFIG_BYTES; offset += 40) { const payload = new Uint8Array(10 + Math.min(40, CONFIG_BYTES - offset)); payload.set(token); view(payload).setUint16(8, offset, true); payload.set(encoded.slice(offset, offset + 40), 10); await request(transport, CMD.WRITE, payload); }
      const commit = new Uint8Array(16); commit.set(token); view(commit).setUint32(8, crc32(encoded), true); view(commit).setUint32(12, caps.revision, true); commitStarted = true;
      const result = await request(transport, CMD.COMMIT, commit); committed = true;
      if (result.length !== 5 || view(result).getUint32(0, true) !== ((caps.revision + 1) >>> 0)) throw new Error("Gamepad commit reply was not confirmed. Re-read the keyboard before retrying.");
      const verified = await read(transport);
      if (verified.revision !== view(result).getUint32(0, true) || verified.bytes.some((b, i) => b !== encoded[i])) throw new Error("The keyboard's gamepad configuration differs from the upload.");
      return { revision: verified.revision, persistent: Boolean(result[4]), verified: true };
    } catch (error) {
      if (staging && !committed) { try { await request(transport, CMD.ABORT, token); } catch (_) { /* Original error remains; abandoned transfers expire on the keyboard. */ } }
      if (commitStarted && !committed && !error.rejected) throw new Error(`Profile commit could not be confirmed. Read the keyboard before retrying. ${error.message}`);
      throw error;
    } finally { locks.delete(transport); }
  }
  const api = Object.freeze({ probe, upload, read, encode, decode, crc32, packet, CMD, CONFIG_BYTES, UnsupportedFirmwareError, KeyboardRejectedError, readTravelLimits, validateTravelLimits, fitTravelLimits });
  root.AE64GamepadProtocol = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
