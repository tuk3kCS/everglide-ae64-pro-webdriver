"use strict";
// Offline portable-C test runner. No USB, filesystem preopens or network imports.
const fs = require("node:fs"), { WASI } = require("node:wasi");
(async () => {
  const file = process.argv[2];
  if (!file) throw new Error("Supply a compiled wasm32-wasi test module.");
  const wasi = new WASI({ version: "preview1", args: [file], env: {}, preopens: {} });
  const { instance } = await WebAssembly.instantiate(fs.readFileSync(file), { wasi_snapshot_preview1: wasi.wasiImport });
  wasi.start(instance);
})().catch((error) => { console.error(error); process.exitCode = 1; });
