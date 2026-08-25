# Hall-effect switch compatibility evidence

This folder contains the 82 Hall-effect switch profiles returned for the Everglide AE64 Pro by the XingShanYueDong web driver capture.

## Files

- `supported-switches.md` — readable inventory of all 82 switches.
- `supported-switches.csv` — spreadsheet-friendly normalized data.
- `supported-switches.json` — machine-readable normalized data.
- `raw-api-response.json` — the unmodified parsed API response payload.
- `source-metadata.json` — capture URL, board identifiers, timestamp, counts, and groups.
- `extract-switches.ps1` — reproducible extraction and validation script.

## Provenance

The data comes from the populated `getAxisListV3` response in `xsyd.top HAR files/xsyd.top.har`. The request identifies board `0030000a`, VID `1ca6`, and PID `300a`. The extraction deliberately preserves switch and brand names exactly as supplied by the API; it does not guess English translations for Chinese product names.

To regenerate the derived files, run `./extract-switches.ps1` from this folder. The script stops with an error unless it extracts exactly 82 entries.
