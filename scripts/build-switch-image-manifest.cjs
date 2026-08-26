"use strict";

const fs = require("fs");
const path = require("path");

const sourceDirectory = path.resolve(
    process.argv[2] || "assets/images/he_switch_images",
  ),
  outputPath = path.resolve(
    process.argv[3] || path.join(sourceDirectory, "manifest.json"),
  ),
  extensionPriority = new Map([
    [".png", 0],
    [".jpg", 1],
    [".jpeg", 2],
    [".webp", 3],
  ]),
  manifest = {};

for (const file of fs.readdirSync(sourceDirectory).sort((left, right) => {
  const leftExtension = path.extname(left).toLowerCase(),
    rightExtension = path.extname(right).toLowerCase();
  return (
    (extensionPriority.get(leftExtension) ?? 99) -
      (extensionPriority.get(rightExtension) ?? 99) ||
    left.localeCompare(right)
  );
})) {
  const extension = path.extname(file).toLowerCase(),
    axisId = path.basename(file, extension);
  if (!extensionPriority.has(extension) || !/^\d+$/.test(axisId)) continue;
  manifest[axisId] ||= `assets/images/he_switch_images/${file}`;
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Indexed ${Object.keys(manifest).length} switch images.`);
