# AE64 Pro Control

An unofficial, local-first WebHID driver for the Everglide AE64 Pro magnetic keyboard. It replaces the manufacturer-hosted web app with a static site that talks directly to the keyboard, including local firmware updates and gamepad configuration. No account, cloud dependency or analytics is required.

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
- Hall calibration and toggleable live press distance: a switch-specific travel gauge, millimeter readout, and simultaneous per-key travel fill
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
- Capture-verified DKS lifecycle, MPT, four-mode SOCD, and Rappy Snappy editors with read-back verification, Hall-tuning preservation, removable assignments, plus proof-of-concept macro and eight-modifier key-combination editors
- Built-in advanced-feature information dialogs, including the captured MPT, SOCD, and RS tutorial text and local videos

Deliberately deferred to the advanced release:

- Editors/writers for MT, TGL, and END, plus a polished macro recorder
- Destructive factory restore (visible but disabled pending physical-device verification)
- Decorative/secondary-light editors beyond the discovered read surface

## Firmware updates

Open the **Firmware** tab, choose a release from `/firmware`, connect the intended keyboard, and select **Review and flash firmware**. The final **Start firmware update** button is the only action that begins a transfer. Five untouched factory releases and the experimental XInput binary are included. A local `.bin` picker is also available.

The updater checks the image header, board ID, payload length, CRC-32 and catalog SHA-256 before requesting the bootloader. It streams the complete container in 56-byte chunks, requires the keyboard's separate image-validation result, restarts it, then verifies application reconnection. Normal configuration traffic is paused and excluded from the transport while updating. If USB permission changes during the restart, use **Select keyboard bootloader** or **Select restarted keyboard** when prompted.

The updater's lifecycle, failures, packets and six image streams are tested with simulated devices. The new integrated updater has not been exercised on physical hardware. The custom image was flashed separately by the user; Windows subsequently enumerated the keyboard as an Xbox 360 controller. A successful Windows driver binding does not establish every analog mapping or a recovery guarantee.

After adding or replacing a `.bin` anywhere under `firmware/`, run `node scripts/build-firmware-catalog.cjs`. Static hosting uses the generated `firmware/catalog.json`; GitHub Pages regenerates it and packages the binary files automatically. See [firmware/README.md](firmware/README.md).

## Gamepad mode

The **Gamepad mode** tab offers two solutions:

- **Hardware Solution** contains the former Gamepad Studio controls directly inside the main app: analog triggers and both sticks, digital controller buttons, adjustable travel windows, response curves, stick settings, simulation, live travel, JSON profiles and capability-gated configuration uploads. It shares the main keyboard connection and stops its polling when you leave the tab.
- **Software Solution** opens [Hall Analog Mapper](https://github.com/z750sasr/he-kb-analog-mapper), a Windows application that creates a virtual Xbox controller from Hall travel with factory firmware.

The standalone `/gamepad` page has been removed. Use `/#gamepad` for a direct link into the main app; `/#firmware` opens the flasher. Existing browser-local gamepad drafts use the same storage key and remain available.

Custom mappings are session-only. Click **Use keyboard travel limits** before applying: the tested keyboard reports **3.31 mm**, so a **3.50 mm** full-output setting is rejected. The button adjusts every oversized assignment in the local draft; Apply performs the device upload. Lower valid ranges, such as **1–3 mm**, are preserved. A confirmed rejection is shown separately from an uncertain/lost commit reply.

Firmware source, linker/patch builder, verification results, original compiled image and portable component tests are in [firmware/custom/ae64-xinput](firmware/custom/ae64-xinput). Reconstructed version changes, protocol evidence and the development pipeline are in [docs/firmware-research](docs/firmware-research).

## Offline checks

```powershell
node scripts/build-firmware-catalog.cjs
node smoke-test.cjs
node tests/firmware/flasher-tests.cjs
node tests/firmware/ui-tests.cjs
node tests/gamepad/tests.cjs
node tests/gamepad/protocol-tests.cjs
node tests/gamepad/travel-limits-tests.cjs
```

These tests use fake transports and do not send firmware or configuration commands to a real keyboard. The optional compiled-C protocol harness can be passed to `protocol-tests.cjs` for cross-language transfer verification.

## Contributing

We are putting a lot of resources to speed up this project. This project is changing extensively day by day, so please don't fork this just yet!
But we'd love to have other people to test the webdriver. If you find any bugs, please open a new issue and let us know!

### Custom Fn lighting

The experimental XInput + Fn RGB v0.2 image adds persistent per-key static colors for four onboard profiles and three Fn layers each. After flashing and reconnecting, Lighting shows an additional Fn layers editor only after a verified FNR1 capability response. Factory firmware keeps its existing controls. See [native evidence, storage accounting, setup and validation](docs/firmware-research/fn-rgb/README.md). The new build has not been hardware-tested.
