# Editing the magnetic-switch catalog

`assets/hall-effect-switches/catalog-overrides.json` is the human-edited layer for the AE64 Pro switch selector. It contains one record for each of the 82 firmware switch profiles captured from the original driver.

The file is deliberately separate from `supported-switches.json`:

- `supported-switches.json` is captured firmware data. Its IDs, range, and coefficient are used when assigning a switch and must not be translated or guessed.
- `catalog-overrides.json` contains display-only names, search aliases, groups, colors, and exceptional image paths. Editing it cannot change which firmware switch profile is written.

## Record format

Each top-level key is the decimal `detail_axis_id` from the captured catalog. Never renumber or replace this key.

```json
{
  "4352": {
    "name": "Gateron Qilin HE",
    "aliases": ["Qilin", "Kirin"],
    "image": "assets/hall-effect-switches/images/gateron-qilin-he.webp",
    "_captured_name": "麒麟轴",
    "_captured_brand": "GATERON"
  }
}
```

Fields:

| Field | Purpose | Safe to edit? |
|---|---|---|
| `name` | English or alphabetic name displayed in the catalog and on virtual keys. Blank uses the captured name. | Yes |
| `aliases` | Extra search terms. These are not displayed as the primary name. | Yes |
| `image` | Optional exceptional repo-relative path or HTTPS URL. Blank uses automatic axis-ID image discovery. | Yes |
| `brand` | Optional display brand override. Omit it to use the captured group. | Yes |
| `color` | Optional CSS color such as `#73f0c0` for the generated placeholder. | Yes |
| `_captured_name` | Original name from the HAR, included so editors can identify the switch. The app ignores it. | No need |
| `_captured_brand` | Original brand from the HAR. The app ignores it. | No need |

Blank `name` and `image` values are intentional. They let all 82 records exist before every translation and photograph is ready. Missing pictures fall back to a generated thumbnail.

## Add an English name

1. Find the switch by `_captured_name`, `_captured_brand`, or its ID.
2. Put the verified English product name in `name`.
3. Add common spellings or transliterations to `aliases` if they help search.
4. Keep the top-level numeric ID unchanged.

For example:

```json
"4352": {
  "name": "Gateron Qilin HE",
  "aliases": ["Qilin", "Kirin"],
  "image": "",
  "_captured_name": "麒麟轴",
  "_captured_brand": "GATERON"
}
```

## Add a local image

1. Put a square or near-square image in `assets/images/he_switch_images`.
2. Name the file with the switch's decimal `detail_axis_id`, for example `4352.png`.
3. Use PNG, JPG, JPEG, or WebP. GitHub Pages indexes those extensions automatically.
4. Do not edit `catalog-overrides.json` for a conventionally named picture.

For an exceptional filename or remote image, the explicit override still works:

```json
"image": "assets/hall-effect-switches/images/gateron-qilin-he.webp"
```

The GitHub Pages build copies and indexes `assets/images/he_switch_images` automatically. It also preserves support for the older optional `assets/hall-effect-switches/images` folder. Do not use a Windows filesystem path such as `G:\\...`; browsers need a repo-relative path.

## Refresh the captured catalog

Run `assets/hall-effect-switches/extract-switches.ps1` after replacing the root `xsyd.top.har` capture. The script:

1. Requires exactly 82 captured switch profiles.
2. Rebuilds the raw, JSON, CSV, Markdown, and metadata outputs.
3. Keeps existing `name`, `aliases`, `image`, `brand`, and `color` edits.
4. Adds missing IDs and refreshes `_captured_name` and `_captured_brand`.

After editing, run `node smoke-test.cjs`. A malformed JSON file will prevent the catalog from loading, so keep commas between records and do not add JSON comments.
