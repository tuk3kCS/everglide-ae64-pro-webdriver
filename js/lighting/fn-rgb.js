/* FNR1 static Fn layer RGB client. SPDX-License-Identifier: MIT */
(function (root) {
  "use strict";
  const MAGIC = [70, 78, 82, 49], BYTES = 378, BOARD = 0x0030000a;
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
    if (!Number.isInteger(profile) || profile < 0 || profile > 3 || !Number.isInteger(layer) || layer < 1 || layer > 3) throw new RangeError("Choose profile 1–4 and Fn layer 1–3.");
  }
  function encode(colors) {
    if (!Array.isArray(colors) || colors.length !== 126 || colors.some((c) => !/^#[0-9a-f]{6}$/i.test(c))) throw new RangeError("Fn lighting requires 126 RGB matrix colors.");
    return Uint8Array.from(colors.flatMap((c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))));
  }
  function decode(bytes) {
    if (bytes.length !== BYTES) throw new RangeError("Invalid Fn lighting size.");
    return Array.from({ length: 126 }, (_, i) => "#" + Array.from(bytes.slice(i * 3, i * 3 + 3), (v) => v.toString(16).padStart(2, "0")).join(""));
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
      if (b.length !== 20 || view(b).getUint32(0, true) !== BOARD || b[4] !== 4 || b[5] !== 3 || b[6] !== 6 || b[7] !== 21 || !(b[8] & 2) || b[8] & ~3 || b[9] > 1 || b[10] !== profile || b[11] !== layer) throw new UnsupportedFirmwareError();
      return { verified: true, profiles: 4, layers: 3, rows: 6, cols: 21, persistent: Boolean(b[8] & 1), enabled: Boolean(b[9]), profile, layer, revision: view(b).getUint32(12, true), crc32: view(b).getUint32(16, true) };
    }
    async read(profile, layer) {
      const caps = await this.capabilities(profile, layer), bytes = new Uint8Array(BYTES);
      for (let offset = 0; offset < BYTES; offset += 48) {
        const count = Math.min(48, BYTES - offset), p = new Uint8Array(9); p.set([profile, layer]); view(p).setUint32(2, caps.revision, true); view(p).setUint16(6, offset, true); p[8] = count;
        const b = await request(this.transport, 0x35, p);
        if (b.length !== count + 6 || view(b).getUint32(0, true) !== caps.revision || view(b).getUint16(4, true) !== offset) throw new Error("Fn lighting changed while reading. Read again.");
        bytes.set(b.slice(6), offset);
      }
      if (crc32(bytes) !== caps.crc32) throw new Error("Fn lighting read-back checksum mismatch.");
      return { ...caps, colors: decode(bytes) };
    }
    async write(profile, layer, input) {
      selector(profile, layer);
      const encoded = encode(input.colors);
      if (typeof input.enabled !== "boolean" || !Number.isInteger(input.revision) || input.revision < 0 || input.revision > 0xffffffff) throw new RangeError("Read this Fn profile before applying it.");
      if (locks.has(this.transport)) throw new Error("A Fn lighting transfer is already running.");
      locks.add(this.transport); let begun = false, committed = false;
      const token = new Uint8Array(8);
      try {
        if (!root.crypto?.getRandomValues) throw new Error("Secure transaction identifiers are unavailable.");
        do { root.crypto.getRandomValues(token); } while (!token.some(Boolean));
        if (typeof this.transport.getCurrentConfig !== "function" || await this.transport.getCurrentConfig() !== profile) throw new Error("Switch the onboard keyboard profile to this profile before applying Fn colors.");
        const begin = new Uint8Array(20); begin.set([profile, layer, Number(input.enabled), 0]); view(begin).setUint32(4, input.revision, true); view(begin).setUint32(8, crc32(encoded), true); begin.set(token, 12);
        await request(this.transport, 0x31, begin); begun = true;
        for (let offset = 0; offset < BYTES; offset += 44) {
          const chunk = encoded.slice(offset, offset + 44), p = new Uint8Array(10 + chunk.length); p.set(token); view(p).setUint16(8, offset, true); p.set(chunk, 10); await request(this.transport, 0x32, p);
        }
        const reply = await request(this.transport, 0x33, token); committed = true;
        if (reply.length !== 4) throw new Error("Fn lighting save response was invalid. Read the keyboard before retrying.");
        const result = await this.read(profile, layer);
        if (result.revision !== view(reply).getUint32(0, true) || result.enabled !== input.enabled || crc32(encode(result.colors)) !== crc32(encoded)) throw new Error("Fn lighting save read-back did not match. Read the keyboard before retrying.");
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
