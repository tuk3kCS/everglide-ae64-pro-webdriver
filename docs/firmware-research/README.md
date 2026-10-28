# AE64 Pro firmware research

This directory incorporates the earlier firmware investigation into the web-driver repository:

- `CHANGELOG_RECONSTRUCTED.md`: differences inferred from the five factory binaries, separated from unavailable manufacturer patch notes.
- `DEVELOPMENT_PIPELINE.md`: architecture, reconstruction, build and flashing workflow.
- `protocol/`: container/flash protocol reconstruction, original host snippets, native dispatch tables and offline container tooling.
- `hardware/`: startup memory maps, MCU-family evidence and source references.
- `gamepad/`: portable mapper, physical adapter, configuration and XUSB research notes.
- `tools/`: scripts for reconstructing binary analysis and checking evidence.
- `full-research.zip`: the complete original research bundle, including disassemblies, analysis data, symbols, evidence and original binary archive. Extract it into a separate folder to use its original relative paths.

These are historical research reports and include the uncertainties known at their creation. Their statements that an integrated image was not yet available describe that earlier stage. The current implementation and later hardware observations are documented in `../../firmware/custom/ae64-xinput/README.md`; the current flasher is in `../../js/firmware/flasher.js` and the integrated controls are under `../../js/gamepad/`.

Factory binaries and their original API metadata are retained in `../../firmware/`. No original factory binary was modified. The custom image is a separately named file with source, build evidence and tests.
