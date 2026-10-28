"use strict";
const fs = require("node:fs"), path = require("node:path");
const { generate } = require("./build-firmware-catalog.cjs");
function packageFirmware(destination) {
  const root = path.resolve(__dirname, ".."), catalog = generate(), target = path.resolve(destination, "firmware");
  fs.mkdirSync(target, { recursive: true });fs.copyFileSync(path.join(root, "firmware/catalog.json"), path.join(target, "catalog.json"));
  for (const entry of catalog.firmwares) {
    const source = path.resolve(root, "firmware", entry.file), output = path.resolve(target, entry.file);
    if (!source.startsWith(path.join(root, "firmware") + path.sep) || !output.startsWith(target + path.sep)) throw new Error("Firmware path escapes its directory.");
    fs.mkdirSync(path.dirname(output), { recursive: true });fs.copyFileSync(source, output);
  }
  return catalog.firmwares.length;
}
if (require.main === module) console.log(`Packaged ${packageFirmware(process.argv[2] || "_site")} firmware images.`);
module.exports = { packageFirmware };
