# AE64 Pro Control

An unofficial, local-first WebHID driver for the Everglide AE64 Pro magnetic keyboard. It replaces the slow manufacturer-hosted web app with a static site that talks directly to the keyboard; there is no account, cloud dependency, analytics, or firmware updater.

## How to use

Online version of this webdriver available [here](https://tuk3kcs.github.io/everglide-ae64-pro-webdriver/).

Or you can run this on your own machine by cloning this repository and run the following command in the terminal to start the server:

```terminal
git clone https://github.com/tuk3kCS/everglide-ae64-pro-webdriver
cd everglide-ae64-pro-webdriver
python -m http.server 4173
```

Open `http://localhost:4173` then choose **Connect keyboard** and enjoy.

## Basic release scope

Implemented now:

- Device identity, firmware/protocol version, feature bitmap, and diagnostics
- Four onboard profiles (switching and names)
- Four keymap layers with keyboard, media, mouse, and internal function groups
- Per-key actuation distance, Rapid Trigger first-touch actuation, intuitive synchronized/independent RT press/release sensitivity, and an experimental fixed `normalRelease` editor
- Toggleable per-key top and bottom dead zones; disabling them writes `0.00 mm` to both fields
- Magnetic switch selector backed by all 82 AE64 profiles captured from the manufacturer API, with editable display grouping and automatic axis-ID image discovery
- Hall calibration and toggleable live press distance: a 0.0–4.0 mm switch gauge, millimeter readout, and simultaneous per-key travel fill
- Device-reported `L1–L20` keyboard effects plus explicitly experimental catalog values `L21–L23`, independent north/south LED switches, and one 24 fps live preview combining the keyboard with 38 addressable perimeter LEDs
- Independent keyboard/strip palettes, 0–100 brightness and speed, forward/backward direction, and complete custom-color matrix handling
- Captured rainbow palette behavior plus firmware-rendered Fn overlays with transparent-layer inheritance and remapped Fn-trigger detection
- Mint, graphite Dark, and cool Light appearances with browser-local persistence
- Drag selection plus Ctrl-click add/remove editing for keyboard keys and light-strip LEDs, with each mode restricted to its own physical region
- Windows/macOS system mode, 250–8,000 Hz polling rate, RGB sleep timer, and shake optimization
- Local profiles plus JSON import/export
- Optional experimental auto apply with a short edit debounce and verified device writes
- XML-driven English/Vietnamese language selection through `languages.xml`
- A standalone, author-editable About Us page in `about.html`
- Capture-verified four-mode SOCD editor with reciprocal writes/read-back verification, plus visible/read-only inspection for DKS, MPT, MT, TGL, END, RS, and macro capacity
- Built-in advanced-feature information dialogs, including the captured SOCD tutorial text and four local videos

Deliberately deferred to the advanced release:

- Editors/writers for DKS, MPT, MT, TGL, END, RS, macros, and key combinations
- Destructive factory restore (visible but disabled pending physical-device verification)
- Decorative/secondary-light editors beyond the discovered read surface

Firmware update and bootloader commands are intentionally excluded from both the UI and protocol API.

## Contributing

We are putting a lot of resources to speed up this project. This project is changing extensively day by day, so please don't fork this just yet!
But we'd love to have other people to test the webdriver. If you find any bugs, please open a new issue and let us know!
