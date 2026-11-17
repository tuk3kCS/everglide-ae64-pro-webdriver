# Magnetic switch catalog and updater

The webdriver reads [one local catalog](../assets/hall-effect-switches/catalog.json) for AE64 Pro board `0030000a`, USB VID `1ca6`, PID `300a`. Reloaded and Legacy use the same file.

## Check and import

Run these commands from the repository root with Node.js 22 or newer.

```text
node scripts/sync-switch-catalog.cjs --check
node scripts/sync-switch-catalog.cjs
```

The first command reports what would be added. The second downloads the same board-specific catalog and adds missing detail axis IDs. Existing values, names, aliases, groups, and explicit images stay in place. If the manufacturer gives a known ID a different range or coefficient, the tool prints both values for review. Profiles omitted upstream remain available for keyboards that already use them. The tool validates the full response before saving and replaces the catalog in one write. A repeat with the same data leaves the file byte-for-byte unchanged.

The command reads the [factory driver's public entry](https://www.xsyd.top/v2-app), uses the anonymous application header from its current bundle, and queries its `getAxisListV3` endpoint. It uses no account session and saves neither the header nor the downloaded bundle. For offline input, load the Magnetic Switch Selector on the connected AE64 Pro in the factory driver, save a network HAR with response content, then run:

```text
node scripts/sync-switch-catalog.cjs --from-har path/to/capture.har --check
node scripts/sync-switch-catalog.cjs --from-har path/to/capture.har
```

The HAR importer selects a successful GET response matching the factory API, board ID, VID, and PID.

## Edit names and artwork

Find the switch by `axisV2Id` in the catalog. Add a `display` object only when a switch needs a local name, brand, alias list, hex color, or exceptional image path.

```json
{
  "name": "Gateron Qilin HE",
  "aliases": ["Qilin", "Kirin"],
  "image": "assets/hall-effect-switches/images/gateron-qilin-he.webp"
}
```

For ordinary photos, put a PNG, JPG, JPEG, or WebP named for its detail axis ID in `assets/images/he_switch_images`, such as `4352.png`. Run `node scripts/sync-switch-catalog.cjs --refresh-images` to index photos offline. Run `node scripts/sync-switch-catalog.cjs --validate` to check the catalog and artwork paths. Cards without a local photo use the switch thumbnail. The live response checked for this rewrite did not supply image URLs.

## Comparison with the previous database

| Area | Previous database | Rewritten catalog |
| --- | --- | --- |
| Browser startup | Read a profile snapshot, an entire override file, and an image manifest. | One local JSON request. The stored record holds firmware values and optional display edits. |
| Images | Probed multiple file extensions when the manifest was absent. | One resolved local path per photo. Profiles without a photo use a generated thumbnail. |
| Maintenance | Replace a HAR and run an extractor with an 82-record requirement. It generated JSON, CSV, Markdown, and placeholder overrides. | Run one command to check the live catalog and append valid profiles. The historical raw response and provenance remain for comparison. |
| Validation | Browser code coerced values and skipped entries failing basic numeric checks. | Rejects duplicate detail IDs, out-of-range firmware values, mismatched HAR board identity, and invalid local artwork paths before replacing the catalog. |

The migration preserved all 82 detail axis IDs, travel limits, and coefficients, plus 38 curated records and 38 indexed photos. The new JSON is 26,131 bytes, about 31% smaller than the previous two JSON files combined, before counting their separate image manifest.

On November 14, 2026, the live factory driver returned 76 profiles. All 76 matched local firmware values. The six omitted local IDs were `12336`, `12352`, `14240`, `14256`, `14656`, and `14672`. The updater retained all 82 profiles. The append path was verified separately with a test capture containing a new profile.
