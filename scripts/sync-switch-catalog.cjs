"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { parseArgs } = require("node:util");
const { SWITCH_CATALOG_PATH, SWITCH_CATALOG_DEVICE: device, switchColor, validateSwitchCatalog } = require("../js/app/switches.js");

const root = path.resolve(__dirname, "..");
const driver = new URL("https://www.xsyd.top/v2-app/device");
const api = new URL("https://api.sparklinkplayjoy.com/api/v1/getAxisListV3");
const parameters = { board_id: device.boardId, vid: device.vendorId, pid: device.productId };
const firmwareFields = ["axisRangeMax", "axisCoefficient"];
const imageDirectory = "assets/images/he_switch_images";
const imageExtensions = ["png", "jpg", "jpeg", "webp"];
const parseJson = (text) => JSON.parse(text.replace(/^\uFEFF/, ""));
const textField = (value) => typeof value === "string" ? value.trim() : "";

function parseVendorResponse(response) {
  if (response?.code !== 200 || !Array.isArray(response.data) || !response.data.length)
    throw new Error("The manufacturer response contains no successful switch catalog.");
  const switches = [];
  let extraDetails = 0;
  for (const group of response.data) {
    if (!Array.isArray(group?.list)) throw new Error("A manufacturer switch group is missing its list.");
    for (const item of group.list) {
      const detail = item?.aixsDetail?.[0];
      if (!Array.isArray(item?.aixsDetail) || !detail)
        throw new Error(`Manufacturer switch ${Number(item?.axis_id) || "unknown"} is missing its firmware detail.`);
      extraDetails += item.aixsDetail.length - 1;
      const groupName = textField(group.type_name_en) || textField(group.type_name);
      const vendor = { id: item.axis_id, name: textField(item.axis_name), brand: textField(item.brand) || groupName || "Other" };
      if (groupName && groupName !== vendor.brand) vendor.group = groupName;
      if (Number.isFinite(item.magnetic_flux)) vendor.magneticFlux = item.magnetic_flux;
      if (switchColor(item.axis_color)) vendor.color = item.axis_color;
      const imageUrl = URL.canParse(item.image_url) ? new URL(item.image_url) : null;
      if (imageUrl?.protocol === "https:" && !imageUrl.username && !imageUrl.password) vendor.imageUrl = imageUrl.href;
      switches.push({
        axisV2Id: detail.axis_id, axisRangeMax: detail.axis_range_max, axisCoefficient: detail.axis_coefficient,
        vendor,
      });
    }
  }
  validateSwitchCatalog({ schema: 1, device, switches });
  return { switches, extraDetails };
}

function mergeSwitches(catalog, upstream) {
  const current = new Map(catalog.switches.map((entry) => [entry.axisV2Id, entry]));
  const added = [], conflicts = [], seen = new Set();
  for (const incoming of upstream) {
    const id = incoming.axisV2Id, existing = current.get(id);
    seen.add(id);
    if (!existing) { current.set(id, incoming); added.push(incoming); continue; }
    const changes = firmwareFields.filter((key) => existing[key] !== incoming[key])
      .map((key) => `${key} ${existing[key]} → ${incoming[key]}`);
    if (changes.length) conflicts.push({ id, changes });
  }
  const absent = catalog.switches.filter((entry) => !seen.has(entry.axisV2Id)).map((entry) => entry.axisV2Id);
  const switches = [...current.values()].sort((a, b) => a.axisV2Id - b.axisV2Id);
  return { catalog: { ...catalog, switches }, added, conflicts, absent };
}

function indexImages(catalog) {
  const images = new Map();
  const files = fs.readdirSync(path.join(root, imageDirectory), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const extension of imageExtensions)
    for (const file of files) {
      const match = file.isFile() && /^(\d+)\.([a-z]+)$/i.exec(file.name);
      if (match && match[2].toLowerCase() === extension && !images.has(Number(match[1])))
        images.set(Number(match[1]), `${imageDirectory}/${file.name}`);
    }
  const switches = catalog.switches.map(({ image: previous, ...entry }) => {
    const image = images.get(entry.axisV2Id);
    return image ? { ...entry, image } : entry;
  });
  return { ...catalog, switches };
}

function validateImages(catalog) {
  for (const entry of catalog.switches)
    for (const image of [entry.image, entry.display?.image].filter(Boolean))
      if (!fs.existsSync(path.join(root, image)) || !fs.statSync(path.join(root, image)).isFile())
        throw new Error(`Switch ${entry.axisV2Id} artwork is missing: ${image}`);
}

async function readText(url, limit, headers) {
  let response;
  try { response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(15000) }); }
  catch (error) { throw new Error(`Could not fetch ${url.hostname}${url.pathname}: ${error.cause?.code || error.name}.`); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Manufacturer returned HTTP ${response.status} for ${url.pathname}.`);
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > limit) throw new Error(`Manufacturer response exceeded the size limit for ${url.pathname}.`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function fetchVendorResponse() {
  const html = await readText(driver, 512 * 1024);
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1/gi)]
    .map((match) => new URL(match[2], driver))
    .filter((url) => url.origin === driver.origin && /^\/v2-app\/js\/index-[\w-]+\.js$/.test(url.pathname));
  if (scripts.length !== 1) throw new Error("Could not find the manufacturer's public webdriver bundle.");
  const bundle = await readText(scripts[0], 4 * 1024 * 1024);
  // Use the anonymous application header distributed to every visitor. It stays in memory.
  const appKey = bundle.match(/\.headers\[\s*["']Xs-API-Key["']\s*\]\s*=\s*(["'])([\w+\/=-]{8,256})\1/i)?.[2];
  if (!appKey || !bundle.includes(api.origin) || !bundle.includes("/getAxisListV3"))
    throw new Error("The manufacturer webdriver changed its public catalog request.");
  const url = new URL(api);
  url.search = new URLSearchParams({ ...parameters, t: String(Date.now()) });
  return parseJson(await readText(url, 2 * 1024 * 1024, {
    "Xs-API-Key": appKey, Origin: driver.origin, Referer: driver.href, Accept: "application/json",
  }));
}

function readHar(file) {
  const entries = parseJson(fs.readFileSync(file, "utf8")).log?.entries;
  const entry = Array.isArray(entries) && entries.find(({ request, response }) => {
    if (request?.method !== "GET" || response?.status !== 200 || !response.content?.text || !URL.canParse(request.url)) return false;
    const url = new URL(request.url);
    return url.origin === api.origin && url.pathname === api.pathname &&
      Object.entries(parameters).every(([key, value]) => url.searchParams.get(key)?.toLowerCase() === value);
  });
  if (!entry) throw new Error("The HAR has no successful AE64 Pro getAxisListV3 response with content.");
  const { text, encoding } = entry.response.content;
  return parseJson(encoding === "base64" ? Buffer.from(text, "base64").toString("utf8") : text);
}

function writeCatalog(file, original, catalog) {
  const next = `${JSON.stringify(catalog, null, 2)}\n`;
  if (next === original) return false;
  const lock = `${file}.lock`, temp = `${file}.${randomUUID()}.tmp`;
  fs.closeSync(fs.openSync(lock, "wx"));
  try {
    if (fs.readFileSync(file, "utf8") !== original) throw new Error("The switch catalog changed during synchronization. Run the command again.");
    fs.writeFileSync(temp, next, { flag: "wx" });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
    fs.unlinkSync(lock);
  }
  return true;
}

async function main() {
  const { values } = parseArgs({ options: {
    check: { type: "boolean" }, validate: { type: "boolean" }, "refresh-images": { type: "boolean" },
    "from-har": { type: "string" }, help: { type: "boolean", short: "h" },
  } });
  if (values.help) {
    console.log("Usage: node scripts/sync-switch-catalog.cjs [--check] [--from-har FILE | --refresh-images | --validate]");
    return;
  }
  if ([values.validate, values["refresh-images"], values["from-har"]].filter(Boolean).length > 1)
    throw new Error("Choose only one of --validate, --refresh-images or --from-har.");
  const file = path.join(root, SWITCH_CATALOG_PATH);
  if (values.validate) {
    const catalog = validateSwitchCatalog(parseJson(fs.readFileSync(file, "utf8")));
    validateImages(catalog);
    console.log(`Validated ${catalog.switches.length} switch profiles and their local artwork.`);
    return;
  }
  let upstream;
  if (!values["refresh-images"]) {
    const response = values["from-har"] ? readHar(values["from-har"]) : await fetchVendorResponse();
    upstream = parseVendorResponse(response);
  }
  const original = fs.readFileSync(file, "utf8");
  let catalog = validateSwitchCatalog(parseJson(original));
  if (upstream) {
    const merged = mergeSwitches(catalog, upstream.switches);
    catalog = merged.catalog;
    console.log(`Manufacturer profiles: ${upstream.switches.length}. New profiles: ${merged.added.length}. Local total: ${catalog.switches.length}.`);
    for (const entry of merged.added) console.log(`  + ${entry.axisV2Id} ${JSON.stringify(entry.vendor.name)}`);
    if (merged.absent.length) console.log(`Retained ${merged.absent.length} local profiles omitted upstream: ${merged.absent.join(", ")}.`);
    for (const { id, changes } of merged.conflicts) console.log(`Review switch ${id}: ${changes.join(", ")}. Kept existing values.`);
    if (upstream.extraDetails) console.log(`Used each switch's first detail record, matching the factory selector. Additional detail records: ${upstream.extraDetails}.`);
  }
  catalog = validateSwitchCatalog(indexImages(catalog));
  validateImages(catalog);
  if (values.check) console.log("Check complete. Catalog left unchanged.");
  else console.log(writeCatalog(file, original, catalog) ? `Updated ${SWITCH_CATALOG_PATH}.` : "The catalog is up to date.");
}

if (require.main === module) main().catch((error) => {
  console.error(`Switch catalog update stopped: ${error.message}`);
  process.exitCode = 1;
});
module.exports = { parseVendorResponse, mergeSwitches, indexImages, readHar };
