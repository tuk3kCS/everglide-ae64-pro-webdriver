"use strict";

/**
 * AE64 Pro Control — captured magnetic-switch catalog.
 *
 * Keeps immutable HAR-derived firmware metadata separate from hand-edited
 * names and local image paths in catalog-overrides.json.
 */

function normalizeSwitchCatalogEntry(entry, overrides = {}) {
  const axisV2Id = Number(entry.detail_axis_id),
    custom = overrides[String(axisV2Id)] || {},
    sourceImage =
      entry.image_url && entry.image_url !== "#" ? entry.image_url : "";
  return {
    apiId: Number(entry.axis_id),
    axisV2Id,
    axisRangeMax: Number(entry.axis_range_max),
    axisCoefficient: Number(entry.axis_coefficient),
    magneticFlux: Number(entry.magnetic_flux),
    brand: String(custom.brand || entry.group_name || entry.brand || "Other"),
    originalName: String(entry.switch_name || `Axis ${axisV2Id}`),
    name: String(
      custom.name ||
        entry.display_name ||
        entry.switch_name ||
        `Axis ${axisV2Id}`,
    ),
    aliases: Array.isArray(custom.aliases) ? custom.aliases.map(String) : [],
    color: String(custom.color || entry.axis_color || ""),
    image: String(custom.image || entry.image_path || sourceImage),
  };
}

async function loadSwitchCatalog() {
  state.switchCatalogStatus = "loading";
  state.switchCatalogError = "";
  try {
    const [catalogResponse, overrideResponse] = await Promise.all([
      fetch("assets/hall-effect-switches/supported-switches.json"),
      fetch("assets/hall-effect-switches/catalog-overrides.json"),
    ]);
    if (!catalogResponse.ok)
      throw new Error(`Switch catalog HTTP ${catalogResponse.status}`);
    const source = await catalogResponse.json(),
      overrides = overrideResponse.ok ? await overrideResponse.json() : {};
    if (!Array.isArray(source))
      throw new Error("Switch catalog is not an array.");
    state.switchCatalog = source
      .map((entry) => normalizeSwitchCatalogEntry(entry, overrides))
      .filter(
        (entry) =>
          Number.isInteger(entry.axisV2Id) &&
          entry.axisV2Id > 0 &&
          Number.isInteger(entry.axisRangeMax) &&
          entry.axisRangeMax > 0 &&
          Number.isInteger(entry.axisCoefficient) &&
          entry.axisCoefficient > 0,
      );
    if (!state.switchCatalog.length)
      throw new Error("Switch catalog contains no usable firmware profiles.");
    state.switchCatalogStatus = "ready";
  } catch (error) {
    state.switchCatalog = [];
    state.switchCatalogStatus = "error";
    state.switchCatalogError = error.message;
  }
  if (state.page === "performance") render();
  return state.switchCatalog;
}
