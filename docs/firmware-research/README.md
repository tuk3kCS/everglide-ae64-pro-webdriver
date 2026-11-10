# AE64 Pro firmware research

This directory incorporates the earlier firmware investigation into the web-driver repository:

- `CHANGELOG_RECONSTRUCTED.md`: differences inferred from the five factory binaries, separated from unavailable manufacturer patch notes.
- `DEVELOPMENT_PIPELINE.md`: architecture, reconstruction, build and flashing workflow.
- `protocol/`: container/flash protocol reconstruction, original host snippets, native dispatch tables and offline container tooling.
- `hardware/`: startup memory maps, MCU-family evidence and source references.
- `gamepad/`: portable mapper, physical adapter, configuration and XUSB research notes.
- `tools/`: scripts for reconstructing binary analysis and checking evidence.
- `full-research.zip`: the complete original research bundle, including disassemblies, analysis data, symbols, evidence and original binary archive. Extract it into a separate folder to use its original relative paths.

Research reports record the evidence and uncertainties at the time of each investigation. For the current release, see the [custom firmware guide](../../firmware/custom/ae64-xinput/README.md), [physical keyboard testing](VALIDATION.md#physical-keyboard-testing), and [firmware library](../../firmware/README.md).

Factory binaries and their original API metadata are retained in `../../firmware/`. No original factory binary was modified. The custom image is a separately named file with source, build evidence and tests.
