"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { SWITCH_CATALOG_PATH, SWITCH_CATALOG_DEVICE, validateSwitchCatalog } = require("../js/app/switches.js");
const { parseVendorResponse } = require("../scripts/sync-switch-catalog.cjs");

const root = path.resolve(__dirname, "..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const catalog = validateSwitchCatalog(read(SWITCH_CATALOG_PATH));
const historical = parseVendorResponse(read("assets/hall-effect-switches/raw-api-response.json")).switches;
const byId = new Map(catalog.switches.map((entry) => [entry.axisV2Id, entry]));
for (const entry of historical) {
  const current = byId.get(entry.axisV2Id);
  assert.ok(current, `Missing preserved switch ${entry.axisV2Id}`);
  assert.equal(current.axisRangeMax, entry.axisRangeMax);
  assert.equal(current.axisCoefficient, entry.axisCoefficient);
}
assert.equal(byId.get(12432).display.name, "UR Ice HE-Ex");
assert.ok(byId.get(12432).display.aliases.includes("UR Ice Magnetic"));
assert.equal(byId.get(8208).display.image, "assets/images/he_switch_images/8208.webp");
assert.equal(byId.get(8208).image, "assets/images/he_switch_images/8208.png");
assert.equal(byId.get(13088).display.image, "assets/images/he_switch_images/13088-extracted.webp");
assert.equal(byId.get(13088).image, "assets/images/he_switch_images/13088.webp");
assert.throws(() => validateSwitchCatalog({ ...catalog, switches: [...catalog.switches, catalog.switches[0]] }), /duplicate/);

const tempRoot = fs.realpathSync(os.tmpdir());
const workspace = fs.mkdtempSync(path.join(tempRoot, "ae64-switch-test-"));
const script = "scripts/sync-switch-catalog.cjs";
const local = { ...catalog, switches: [byId.get(4352), byId.get(12432)] };
const destination = path.join(workspace, SWITCH_CATALOG_PATH);
const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: workspace, encoding: "utf8" });
const write = (name, data) => fs.writeFileSync(path.join(workspace, name), `${JSON.stringify(data, null, 2)}\n`);
const upstream = { code: 200, data: [{ type_name_en: "Test", list: [
  { axis_id: 272, axis_name: "Changed name", aixsDetail: [{ axis_id: 4352, axis_range_max: 3450, axis_coefficient: 19101 }] },
  { axis_id: 9000, axis_name: "New switch", axis_range_max: 5000, aixsDetail: [
    { axis_id: 20000, axis_range_max: 3600, axis_coefficient: 22001 },
    { axis_id: 20001, axis_range_max: 3700, axis_coefficient: 22002 },
  ] },
] }] };
const request = new URL("https://api.sparklinkplayjoy.com/api/v1/getAxisListV3");
request.search = new URLSearchParams({ board_id: SWITCH_CATALOG_DEVICE.boardId, vid: SWITCH_CATALOG_DEVICE.vendorId, pid: SWITCH_CATALOG_DEVICE.productId });
const har = (data, url = request.href) => ({ log: { entries: [{
  request: { method: "GET", url }, response: { status: 200, content: { encoding: "base64", text: Buffer.from(JSON.stringify(data)).toString("base64") } },
}] } });

try {
  for (const name of [script, "js/app/switches.js"]) {
    fs.mkdirSync(path.dirname(path.join(workspace, name)), { recursive: true });
    fs.copyFileSync(path.join(root, name), path.join(workspace, name));
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.mkdirSync(path.join(workspace, "assets/images/he_switch_images"), { recursive: true });
  const images = new Set(local.switches.flatMap((entry) => [entry.image, entry.display?.image]).filter(Boolean));
  for (const image of images) {
    const target = path.join(workspace, image);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, image), target);
  }
  write(SWITCH_CATALOG_PATH, local);
  const initial = fs.readFileSync(destination, "utf8");
  write("upstream.har", har(upstream));
  const check = run("--check", "--from-har", "upstream.har");
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /New profiles: 1/);
  assert.match(check.stdout, /Retained 1 local profiles omitted upstream: 12432/);
  assert.match(check.stdout, /Review switch 4352/);
  assert.equal(fs.readFileSync(destination, "utf8"), initial);
  const apply = run("--from-har", "upstream.har");
  assert.equal(apply.status, 0, apply.stderr);
  assert.match(apply.stdout, /Additional detail records: 1/);
  const updated = fs.readFileSync(destination, "utf8");
  assert.deepEqual(JSON.parse(updated).switches.slice(0, 2), local.switches);
  assert.deepEqual(JSON.parse(updated).switches[2], {
    axisV2Id: 20000, axisRangeMax: 3600, axisCoefficient: 22001, vendor: { id: 9000, name: "New switch", brand: "Test" },
  });
  assert.match(run("--from-har", "upstream.har").stdout, /up to date/);

  const wrongBoard = new URL(request);
  wrongBoard.searchParams.set("board_id", "0030000d");
  write("upstream.har", har(upstream, wrongBoard.href));
  assert.match(run("--from-har", "upstream.har").stderr, /no successful AE64 Pro/);
  upstream.data[0].list[1].aixsDetail[0].axis_coefficient = 65536;
  write("upstream.har", har(upstream));
  assert.match(run("--from-har", "upstream.har").stderr, /Invalid or duplicate firmware values/);
  assert.equal(fs.readFileSync(destination, "utf8"), updated);
  assert.equal(run("--validate").status, 0);
} finally {
  if (path.dirname(fs.realpathSync(workspace)) === tempRoot) fs.rmSync(workspace, { recursive: true, force: true });
}
console.log("PASS: historical tuples, live-format append, dry run, repeat, legacy retention, malformed data and board isolation.");
