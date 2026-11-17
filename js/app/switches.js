"use strict";

const SWITCH_CATALOG_PATH = "assets/hall-effect-switches/catalog.json";
const SWITCH_CATALOG_DEVICE = Object.freeze({ boardId: "0030000a", vendorId: "1ca6", productId: "300a" });
const switchUInt16 = (value) => Number.isInteger(value) && value > 0 && value <= 0xffff;
const switchColor = (value) => typeof value === "string" && /^#(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(value);
const switchImagePath = (value) => typeof value === "string" &&
  /^assets\/(?:images\/he_switch_images|hall-effect-switches\/images)\/(?:[a-z\d_. -]+\/)*[a-z\d_. -]+\.(?:png|jpe?g|webp)$/i.test(value) &&
  !value.split("/").some((part) => part === "." || part === "..");

function validateSwitchCatalog(catalog) {
  if (catalog?.schema !== 1 || !Object.entries(SWITCH_CATALOG_DEVICE).every(([key, value]) => catalog.device?.[key] === value) ||
    !Array.isArray(catalog.switches) || !catalog.switches.length)
    throw new Error("Invalid AE64 Pro switch catalog.");
  const ids = new Set();
  for (const entry of catalog.switches) {
    const { axisV2Id, axisRangeMax, axisCoefficient, vendor, display, image } = entry || {};
    if (![axisV2Id, axisRangeMax, axisCoefficient].every(switchUInt16) || ids.has(axisV2Id))
      throw new Error(`Invalid or duplicate firmware values for switch ${axisV2Id}.`);
    ids.add(axisV2Id);
    if (!Number.isSafeInteger(vendor?.id) || vendor.id <= 0 || typeof vendor.name !== "string" || !vendor.name.trim() ||
      typeof vendor.brand !== "string" || !vendor.brand.trim() || (vendor.group !== undefined && typeof vendor.group !== "string") ||
      (vendor.color !== undefined && !switchColor(vendor.color)) || (image !== undefined && !switchImagePath(image)))
      throw new Error(`Invalid vendor or artwork data for switch ${axisV2Id}.`);
    if (display !== undefined && (!display || typeof display !== "object" || Array.isArray(display) ||
      Object.keys(display).some((key) => !["name", "brand", "aliases", "color", "image"].includes(key)) ||
      ["name", "brand"].some((key) => display[key] !== undefined && (typeof display[key] !== "string" || !display[key].trim())) ||
      (display.aliases !== undefined && (!Array.isArray(display.aliases) || !display.aliases.every((item) => typeof item === "string" && item.trim()))) ||
      (display.color !== undefined && !switchColor(display.color)) || (display.image !== undefined && !switchImagePath(display.image))))
      throw new Error(`Invalid display data for switch ${axisV2Id}.`);
  }
  return catalog;
}

function switchCatalogEntries(catalog) {
  return validateSwitchCatalog(catalog).switches.map(({ vendor, display = {}, image, ...firmware }) => ({
    ...firmware,
    originalName: vendor.name,
    name: display.name || vendor.name,
    brand: display.brand || vendor.group || vendor.brand,
    aliases: display.aliases || [],
    color: display.color || vendor.color || "",
    image: display.image || image || "",
  }));
}

async function loadSwitchCatalog() {
  state.switchCatalogStatus = "loading";
  state.switchCatalogError = "";
  try {
    const response = await fetch(SWITCH_CATALOG_PATH);
    if (!response.ok) throw new Error(`Switch catalog HTTP ${response.status}`);
    state.switchCatalog = switchCatalogEntries(await response.json());
    state.switchCatalogStatus = "ready";
  } catch (error) {
    state.switchCatalog = [];
    state.switchCatalogStatus = "error";
    state.switchCatalogError = error.message;
  }
  if (state.page === "performance") render();
  return state.switchCatalog;
}

if (typeof module !== "undefined" && module.exports)
  module.exports = { SWITCH_CATALOG_PATH, SWITCH_CATALOG_DEVICE, switchColor, validateSwitchCatalog };
