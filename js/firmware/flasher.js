/* Original AE64 updater reconstructed from the factory driver. SPDX-License-Identifier: MIT */
(function (root) {
  "use strict";
  const BOARD = 0x0030000a, HEADER = 4096, CHUNK = 56, MAX_IMAGE = 262144;
  const COMMAND = Object.freeze({ ENTER: 1, WRITE: 2, VALIDATE: 3, RESTART: 4 });
  const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
    let c = i; for (let n = 0; n < 8; n++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0); return c >>> 0;
  });
  function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = (c >>> 8) ^ crcTable[(c ^ b) & 255]; return (c ^ 0xffffffff) >>> 0; }
  function bytesOf(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    throw new TypeError("Choose a binary firmware file.");
  }
  function inspect(input) {
    const bytes = bytesOf(input);
    if (bytes.length <= HEADER || bytes.length > MAX_IMAGE) throw new Error("Firmware size is outside the supported AE64 Pro application region.");
    const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (d.getUint32(0, true) !== 0xbeaf5aa5) throw new Error("This file is not an AE64 firmware container.");
    if (d.getUint32(4, true) !== BOARD) throw new Error("This firmware belongs to a different keyboard board.");
    if (d.getUint32(8, true) !== HEADER || d.getUint32(12, true) !== bytes.length - HEADER) throw new Error("Firmware header or payload length is damaged.");
    const crc = crc32(bytes.subarray(HEADER));
    if (d.getUint32(16, true) !== crc) throw new Error("Firmware checksum failed. Choose an intact binary file.");
    return Object.freeze({ boardId: BOARD, bytes: bytes.length, payloadBytes: bytes.length - HEADER, crc32: crc });
  }
  async function digest(bytes) {
    if (!root.crypto?.subtle) throw new Error("Secure file checks require HTTPS or localhost.");
    return Array.from(new Uint8Array(await root.crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  async function prepare(input, entry = {}) {
    const bytes = bytesOf(input).slice(), info = inspect(bytes), sha256 = await digest(bytes);
    if (entry.bytes !== undefined && entry.bytes !== info.bytes) throw new Error("Firmware size differs from its catalog entry.");
    if (entry.sha256 && entry.sha256.toLowerCase() !== sha256) throw new Error("Firmware hash differs from its catalog entry. Reload the firmware list.");
    return { bytes, info, sha256, name: entry.name || entry.file || "Local firmware", entry: { ...entry } };
  }
  function packet(command, offset = 0, data = new Uint8Array()) {
    if (!Object.values(COMMAND).includes(command)) throw new Error("Unknown firmware command.");
    const p = new Uint8Array(64); p[0] = 8; p[1] = command;
    if (command === COMMAND.WRITE) {
      if (!Number.isInteger(offset) || offset < 0 || offset > 0xffffffff || !data.length || data.length > CHUNK) throw new RangeError("Invalid firmware chunk.");
      const v = new DataView(p.buffer); v.setUint32(2, offset, true); v.setUint16(6, data.length, true); p.set(data, 8);
    }
    return p;
  }
  function decodeInfo(reply) {
    if (!(reply instanceof Uint8Array) || reply.length !== 64 || reply[0] !== 1 || reply[1] !== 2) throw new Error("Keyboard identity response was incomplete.");
    return {
      boardId: ((reply[4] << 24) | (reply[5] << 16) | (reply[6] << 8) | reply[7]) >>> 0,
      runMode: reply[16], firmware: Array.from(reply.slice(8, 12)).join("."),
      serial: reply.slice(17, 29).some((x) => x !== 0 && x !== 255) ? Array.from(reply.slice(17, 29), (x) => x.toString(16).padStart(2, "0")).join("") : "",
    };
  }
  async function identity(lease) { return decodeInfo(await lease.request([1, 2], { timeout: 2000 })); }
  function checkIdentity(info, mode, original, explicit = false) {
    if (info.boardId !== BOARD) throw new Error("The selected keyboard has the wrong board ID; no firmware was written.");
    if (info.runMode !== mode) throw new Error(mode === 255 ? "The selected keyboard is still running its app. Select its bootloader to continue." : "The keyboard has not restarted into its application.");
    if (original?.serial && info.serial && original.serial !== info.serial && !explicit) throw new Error("A different keyboard appeared. Select the intended physical keyboard explicitly.");
  }
  async function command(lease, kind, offset, data, timeout = 3000) {
    const reply = await lease.request(packet(kind, offset, data), { timeout });
    if (!(reply instanceof Uint8Array) || reply.length !== 64 || reply[0] !== 8 || reply[1] !== kind) throw new Error("The keyboard returned an unrelated or incomplete firmware response.");
    return reply;
  }
  class Updater {
    constructor({ reconnect, progress = () => {}, delay = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
      if (typeof reconnect !== "function") throw new TypeError("A bootloader/application reconnection handler is required.");
      this.reconnect = reconnect; this.progress = progress; this.delay = delay; this.running = false;
    }
    async run(prepared, transport) {
      if (this.running) throw new Error("A firmware transfer is already running.");
      this.running = true;
      let lease = null, active = transport, original = null, reconnectIdentity = null, validated = false, wrote = false, completed = false, owned = false;
      const image = prepared.bytes.slice();
      try {
        // Revalidate a private copy immediately before any device operation.
        const info = inspect(image);
        if (await digest(image) !== prepared.sha256) throw new Error("The selected image changed after validation.");
        if (!active?.connected) throw new Error("Connect the intended keyboard or its bootloader first.");
        this.progress({ phase: "identity", percent: 0, written: 0, total: image.length });
        lease = await active.acquireExclusive(); owned = true; original = await identity(lease); reconnectIdentity = original;
        if (original.boardId !== BOARD || ![0, 255].includes(original.runMode)) throw new Error("The connected device did not identify a supported AE64 Pro application or bootloader.");
        if (original.runMode === 0) {
          this.progress({ phase: "entering", percent: 0, written: 0, total: image.length });
          try { await command(lease, COMMAND.ENTER, undefined, undefined, 10000); }
          catch (error) { this.progress({ phase: "awaitingBoot", percent: 0, detail: "Waiting for the bootloader after the application disconnected.", entryError: error.message }); }
          await lease.release(); lease = null; await active.close().catch(() => {});
          this.progress({ phase: "awaitingBoot", percent: 0, written: 0, total: image.length });
          const found = await this.reconnect({ mode: 255, original, preferred: active.device });
          active = found.transport; lease = await active.acquireExclusive();
          const bootInfo = await identity(lease);
          checkIdentity(bootInfo, 255, original, Boolean(found.explicit));
          if (found.explicit && bootInfo.serial !== original.serial) reconnectIdentity = bootInfo;
        } else checkIdentity(original, 255);
        const ackStatuses = new Set();
        for (let off = 0; off < image.length; off += CHUNK) {
          const data = image.subarray(off, off + CHUNK);
          wrote = true; // A timed-out ACK does not prove the write was absent.
          const reply = await command(lease, COMMAND.WRITE, off, data);
          ackStatuses.add(new DataView(reply.buffer, reply.byteOffset, reply.byteLength).getUint32(2, true));
          this.progress({ phase: "writing", written: off + data.length, total: image.length, percent: Math.floor((off + data.length) / image.length * 95) });
        }
        // The factory's per-chunk byte/4095 comparison is invalid. An ACK means
        // receipt only; success is gated by the separate image-validation reply.
        this.progress({ phase: "validating", percent: 96, written: image.length, total: image.length });
        const result = await command(lease, COMMAND.VALIDATE, undefined, undefined, 10000);
        if (result[2] !== 1) throw new Error("The keyboard rejected the complete image. It has been left in bootloader mode; select an intact stock image and start a new update.");
        validated = true;
        this.progress({ phase: "restarting", percent: 98, written: image.length, total: image.length });
        try { await command(lease, COMMAND.RESTART); } catch (_) { /* Reset can remove USB before its response. */ }
        await lease.release(); lease = null; await active.close().catch(() => {});
        this.progress({ phase: "awaitingApp", percent: 99, written: image.length, total: image.length });
        // Reconnect to the device actually written, including an explicitly
        // selected bootloader. Never fall back to an untouched original keyboard.
        const found = await this.reconnect({ mode: 0, original: reconnectIdentity, preferred: active.device });
        active = found.transport; lease = await active.acquireExclusive();
        const app = await identity(lease); checkIdentity(app, 0, reconnectIdentity, Boolean(found.explicit));
        if (prepared.entry.appVersion && app.firmware !== prepared.entry.appVersion) throw new Error(`An application reconnected, but reports ${app.firmware} instead of ${prepared.entry.appVersion}.`);
        completed = true; this.progress({ phase: "complete", percent: 100, written: image.length, total: image.length });
        return { transport: active, info: app, image: info, validated: true, chunkAckWords: Array.from(ackStatuses) };
      } catch (error) {
        error.firmwareStage = { wrote, validated };
        this.progress({ phase: "error", detail: error.message, wrote, validated }); throw error;
      } finally {
        if (lease) await lease.release();
        if (!completed && owned && active?.connected) await active.close().catch(() => {});
        this.running = false;
      }
    }
  }
  const api = Object.freeze({ BOARD, HEADER, CHUNK, MAX_IMAGE, COMMAND, crc32, inspect, prepare, packet, decodeInfo, checkIdentity, identity, Updater });
  root.AE64Firmware = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
