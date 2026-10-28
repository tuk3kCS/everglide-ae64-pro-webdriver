"use strict";
// Static hosting cannot list a directory. Rebuild this catalog whenever .bin files change.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const F = require("../js/firmware/flasher.js");
const repository = path.resolve(__dirname, ".."), directory = path.join(repository, "firmware");
function list(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? list(path.join(dir, e.name)) : e.isFile() && e.name.toLowerCase().endsWith(".bin") ? [path.join(dir, e.name)] : []); }
function generate() {
  const original = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
  const records = original.firmwares || original.firmware || original.files || [];
  const known = Array.isArray(records) ? records : [];
  const firmwares = list(directory).map((file) => {
    const bytes = new Uint8Array(fs.readFileSync(file)), info = F.inspect(bytes), basename = path.basename(file);
    const source = known.find((r) => r.firmware_name === basename) || {};
    const relative = path.relative(directory, file).split(path.sep).join("/");
    const version = source.firmware_version || basename.match(/_v([0-9.]+)_/)?.[1] || "Custom";
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    if (source.sha256 && sha256 !== source.sha256) throw new Error(`Factory image ${basename} differs from its original hash. Give custom builds their own filename.`);
    const custom = !source.sha256, fnRgb = basename === "AE64-Pro-XInput-FnRGB-EXPERIMENTAL-v0.2.bin", xinput = fnRgb || basename === "AE64-Pro-XInput-EXPERIMENTAL-v0.1.bin";
    const appVersion = xinput ? "0.1.0.0" : String(version).replace(/^v/, "");
    return {
      id: relative, file: relative, name: fnRgb ? "Experimental XInput + Fn RGB v0.2" : xinput ? "Experimental XInput v0.1" : custom ? basename : `Factory ${String(version).startsWith("v") ? version : "v" + version}`,
      kind: custom ? "custom" : "stock", experimental: custom, version,
      appVersion: /^\d+\.\d+\.\d+\.\d+$/.test(appVersion) ? appVersion : undefined,
      date: source.firmware_time ? String(source.firmware_time).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3") : (basename.match(/_(20\d{6})/)?.[1] || (xinput ? "2026-10-28" : "")).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3"),
      bytes: info.bytes, sha256, boardId: "0030000A",
      payloadCrc32: info.crc32.toString(16).padStart(8, "0"),
      description: fnRgb ? "Native Xbox/XInput plus persistent per-key static Fn colors across 4 profiles × 3 layers. Gamepad mappings remain session-only. New build has not been tested on hardware." : xinput ? "Native Xbox/XInput controller with configurable analog keys. Experimental; mappings are session-only." : custom ? "Locally supplied custom AE64 Pro firmware. Review its documentation before flashing." : "Untouched manufacturer application for AE64 Pro.",
      changelog: source.remark ? [String(source.remark)] : [],
    };
  }).sort((a, b) => Number(b.experimental) - Number(a.experimental) || b.date.localeCompare(a.date) || b.file.localeCompare(a.file));
  const catalog = { schema: 1, boardId: "0030000A", firmwareDirectory: "firmware/", firmwares };
  const output = path.join(directory, "catalog.json");fs.writeFileSync(output, JSON.stringify(catalog, null, 2) + "\n");
  console.log(`Firmware catalog: ${firmwares.length} verified images.`);return catalog;
}
if (require.main === module) generate();
module.exports = { generate, list };
