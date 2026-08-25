# Hall-effect switch compatibility evidence

This folder contains the 82 Hall-effect switch profiles returned for the Everglide AE64 Pro by the XingShanYueDong web driver capture.

## Files

- `supported-switches.md` — readable inventory of all 82 switches.
- `supported-switches.csv` — spreadsheet-friendly normalized data.
- `supported-switches.json` — machine-readable normalized data.
- `catalog-overrides.json` — 82 hand-editable records for English names, aliases, colors, and local images, keyed by firmware detail-axis ID.
- `raw-api-response.json` — the unmodified parsed API response payload.
- `source-metadata.json` — capture URL, board identifiers, timestamp, counts, and groups.
- `extract-switches.ps1` — reproducible extraction and validation script.

## Provenance

The data comes from the populated `getAxisListV3` response in the root `xsyd.top.har` capture. The request identifies board `0030000a`, VID `1ca6`, and PID `300a`. The extraction deliberately preserves switch and brand names exactly as supplied by the API; it does not guess English translations for Chinese product names. Firmware ranges come from `aixsDetail[0]`, matching the original driver's write path rather than the API's occasionally stale outer summary.

To regenerate the derived files, run `./extract-switches.ps1` from this folder. The script stops with an error unless it extracts exactly 82 entries. It also refreshes the two `_captured_*` reference fields in every override while preserving the author-edited `name`, `aliases`, `image`, `brand`, and `color` fields.

## Renaming switches and adding images

Keep captured firmware values in `supported-switches.json` unchanged. Put editorial changes in `catalog-overrides.json`, keyed by `detail_axis_id`. This keeps English names and image paths safe when the captured data is regenerated.

Example:

```json
{
  "4352": {
    "name": "Gateron Qilin HE",
    "aliases": ["Qilin", "Kirin"],
    "image": "assets/hall-effect-switches/images/gateron-qilin-he.webp"
  }
}
```

The selector falls back to the captured name and a generated switch thumbnail when an override is blank or absent. `name`, `aliases`, `brand`, `color`, and `image` are optional. `_captured_name` and `_captured_brand` are reference-only fields and are ignored by the app. Do not change the axis ID, range, or coefficient unless a new device capture proves different firmware values.

See [`../../docs/SWITCH_CATALOG_OVERRIDES.md`](../../docs/SWITCH_CATALOG_OVERRIDES.md) for the complete editing and image workflow.
