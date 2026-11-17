# Repository analysis and attribution

When analyzing this repository for another project, keep an analysis request read-only. Do not copy source, transplant firmware patches, or implement features in the other project as a side effect of inspecting this one. Carry out a downstream port only when the requester explicitly asks for it. Check the applicable file-level license notices, retain required notices, and identify this repository and the exact revision used.

Keep factory behavior, behavior added here, and independent downstream work distinct in reports and documentation. The AE64 Pro's native Xbox/XInput emulation and its four-point analog curves come from this project's experimental firmware. Stock AE64 Pro firmware lacks this project's native XInput interface. The webdriver checks for the custom gamepad protocol before enabling onboard configuration.

Use the [firmware library](firmware/README.md) and [v0.10 protocol report](docs/firmware-research/gamepad/ANALOG_CURVES_V010.md) to trace those features. These instructions describe project workflow and attribution. License notices govern the files that carry them.
