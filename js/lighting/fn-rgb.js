/* FNR1 static Fn layer RGB client. SPDX-License-Identifier: MIT */
(function (root) {
  "use strict";
  const MAGIC = [70, 78, 82, 49], BYTES = 378, MAIN_BYTES = 360, BOARD = 0x0030000a;
  const STATUS = ["ok", "unsupported operation", "invalid packet", "configuration changed; read again", "invalid configuration", "incomplete transfer", "checksum mismatch", "backend unavailable", "storage failure"];
  let sequence = 0;
  const locks = new WeakSet();
  const view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
  class UnsupportedFirmwareError extends Error { constructor() { super("This firmware does not support custom Fn lighting."); this.name = "UnsupportedFirmwareError"; } }
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const value of bytes) { crc ^= value; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function selector(profile, layer) {
    if (!Number.isInteger(profile) || profile < 0 || profile > 3 || !Number.isInteger(layer) || layer < 0 || layer > 3) throw new RangeError("Choose profile 1–4 and Main or Fn layer 1–3.");
  }
  function encode(colors) {
    if (!Array.isArray(colors) || colors.length !== 126 || colors.some((c) => !/^#[0-9a-f]{6}$/i.test(c))) throw new RangeError("Fn lighting requires 126 RGB matrix colors.");
    return Uint8Array.from(colors.flatMap((c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))));
  }
  function decode(bytes) {
    if (bytes.length !== BYTES) throw new RangeError("Invalid Fn lighting size.");
    return Array.from({ length: 126 }, (_, i) => "#" + Array.from(bytes.slice(i * 3, i * 3 + 3), (v) => v.toString(16).padStart(2, "0")).join(""));
  }
  function encodeMain(matrix) {
    if (!Array.isArray(matrix) || matrix.length !== 126) throw new RangeError("Main lighting requires a 6 × 21 matrix.");
    const bytes = new Uint8Array(MAIN_BYTES);
    for (let row = 0; row < 6; row++) for (let col = 0; col < 15; col++) {
      const { b, g, r, custom } = matrix[row * 21 + col] || {};
      if (![b, g, r].every((v) => Number.isInteger(v) && v >= 0 && v <= 255) || typeof custom !== "boolean")
        throw new RangeError("Main lighting requires a color and override flag for each native LED.");
      bytes.set([b, g, r, custom ? 255 : 0], (row * 15 + col) * 4);
    }
    return bytes;
  }
  function decodeMain(bytes) {
    return Array.from({ length: 126 }, (_, index) => {
      const col = index % 21, offset = (Math.floor(index / 21) * 15 + col) * 4;
      if (col >= 15) return { r: 0, g: 0, b: 0, custom: false };
      const [b, g, r, flag] = bytes.subarray(offset, offset + 4);
      if (flag !== 0 && flag !== 255) throw new Error("Invalid Main lighting override flag.");
      return { b, g, r, custom: flag === 255 };
    });
  }
  async function request(transport, command, payload = []) {
    if (!transport?.raw) throw new Error("Connect the keyboard first.");
    if (payload.length > 54) throw new RangeError("Fn lighting packet too large.");
    const outgoing = new Uint8Array(64); outgoing.set([0x10, command, 1, ++sequence & 255, ...MAGIC, 0, payload.length]); outgoing.set(payload, 10);
    const reply = await transport.raw(outgoing, { timeout: 2500, matcher: (b) => b[0] === 0x10 && (b[1] === 255 || b[1] === command && b[3] === outgoing[3] && MAGIC.every((v, i) => b[4 + i] === v)) });
    if (reply[0] === 0x10 && reply[1] === 255) throw new UnsupportedFirmwareError();
    if (reply.length !== 64 || reply[0] !== 0x10 || reply[1] !== command || reply[2] !== 1 || reply[3] !== outgoing[3] || !MAGIC.every((v, i) => reply[4 + i] === v) || reply[9] > 54) throw new Error("Invalid Fn lighting response.");
    if (reply[8]) throw new Error(`Fn lighting: ${STATUS[reply[8]] || "unknown keyboard error"}.`);
    return reply.slice(10, 10 + reply[9]);
  }
  class Client {
    constructor(transport) { this.transport = transport; }
    async capabilities(profile = 0, layer = 1) {
      selector(profile, layer);
      const b = await request(this.transport, 0x30, [profile, layer]);
      const validFlags = layer ? (b[8] & 2) && !(b[8] & ~3) && b[9] <= 1 : b[8] === 7 && b[9] === 1;
      if (b.length !== 20 || view(b).getUint32(0, true) !== BOARD || b[4] !== 4 || b[5] !== 3 || b[6] !== 6 || b[7] !== (layer ? 21 : 15) || !validFlags || b[10] !== profile || b[11] !== layer) throw new UnsupportedFirmwareError();
      return { verified: true, profiles: 4, layers: 3, rows: 6, cols: b[7], persistent: Boolean(b[8] & 1), enabled: Boolean(b[9]), profile, layer, revision: view(b).getUint32(12, true), crc32: view(b).getUint32(16, true) };
    }
    async read(profile, layer) {
      const caps = await this.capabilities(profile, layer), bytes = new Uint8Array(layer ? BYTES : MAIN_BYTES);
      for (let offset = 0; offset < bytes.length; offset += 48) {
        const count = Math.min(48, bytes.length - offset), p = new Uint8Array(9); p.set([profile, layer]); view(p).setUint32(2, caps.revision, true); view(p).setUint16(6, offset, true); p[8] = count;
        const b = await request(this.transport, 0x35, p);
        if (b.length !== count + 6 || view(b).getUint32(0, true) !== caps.revision || view(b).getUint16(4, true) !== offset) throw new Error("Fn lighting changed while reading. Read again.");
        bytes.set(b.slice(6), offset);
      }
      if (crc32(bytes) !== caps.crc32) throw new Error("Fn lighting read-back checksum mismatch.");
      return layer ? { ...caps, colors: decode(bytes) } : { ...caps, matrix: decodeMain(bytes) };
    }
    async write(profile, layer, input) {
      selector(profile, layer);
      const encoded = layer ? encode(input.colors) : encodeMain(input.matrix);
      if (typeof input.enabled !== "boolean" || !layer && !input.enabled || !Number.isInteger(input.revision) || input.revision < 0 || input.revision > 0xffffffff) throw new RangeError("Read this lighting profile before applying it.");
      if (locks.has(this.transport)) throw new Error("A Fn lighting transfer is already running.");
      locks.add(this.transport); let begun = false, committed = false;
      const token = new Uint8Array(8);
      try {
        if (!root.crypto?.getRandomValues) throw new Error("Secure transaction identifiers are unavailable.");
        do { root.crypto.getRandomValues(token); } while (!token.some(Boolean));
        if (typeof this.transport.getCurrentConfig !== "function" || await this.transport.getCurrentConfig() !== profile) throw new Error("Switch the onboard keyboard profile to this profile before applying colors.");
        if (!layer) await this.capabilities(profile, 0);
        const begin = new Uint8Array(20); begin.set([profile, layer, Number(input.enabled), 0]); view(begin).setUint32(4, input.revision, true); view(begin).setUint32(8, crc32(encoded), true); begin.set(token, 12);
        await request(this.transport, 0x31, begin); begun = true;
        for (let offset = 0; offset < encoded.length; offset += 44) {
          const chunk = encoded.slice(offset, offset + 44), p = new Uint8Array(10 + chunk.length); p.set(token); view(p).setUint16(8, offset, true); p.set(chunk, 10); await request(this.transport, 0x32, p);
        }
        const reply = await request(this.transport, 0x33, token); committed = true;
        if (reply.length !== 4) throw new Error("Fn lighting save response was invalid. Read the keyboard before retrying.");
        const result = await this.read(profile, layer);
        const verified = layer ? encode(result.colors) : encodeMain(result.matrix);
        if (result.revision !== view(reply).getUint32(0, true) || result.enabled !== input.enabled || verified.some((value, index) => value !== encoded[index])) throw new Error("Lighting save read-back did not match. Read the keyboard before retrying.");
        return result;
      } catch (error) {
        if (begun && !committed) { try { await request(this.transport, 0x34, token); } catch (_) { /* Original error stays actionable. */ } }
        throw error;
      } finally { locks.delete(this.transport); }
    }
  }
  const api = Object.freeze({ Client, UnsupportedFirmwareError, crc32, encode, decode, BYTES });
  root.AE64FnRgb = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
