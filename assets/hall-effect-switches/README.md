# AE64 Pro Hall-effect switches

- [catalog.json](catalog.json) is the webdriver database. It contains the firmware values used for switch assignment, vendor metadata, optional display edits, and resolved local image paths.
- [raw-api-response.json](raw-api-response.json) and [source-metadata.json](source-metadata.json) retain the August 2026 factory-driver capture as historical evidence.

The imported English names and WebP photos come from [NovaSeele/ae64-driver at `f37c2bd`](https://github.com/NovaSeele/ae64-driver/tree/f37c2bdc68ae08eac567d49db75bcd0722033dd7/src). The import matched the AE64 Pro detail axis ID, travel limit, and coefficient. Previous names remain searchable as aliases. The photos and [upstream MIT notice](../images/he_switch_images/NOVASEELE-LICENSE.txt) are in `assets/images/he_switch_images`. Where an existing WebP already used the numeric filename, the imported copy ends in `-extracted.webp` and is selected by the catalog’s `display.image` field.

Read the [catalog comparison and updater instructions](../../docs/SWITCH_CATALOG_OVERRIDES.md) for live synchronization, offline HAR import, and local artwork.
