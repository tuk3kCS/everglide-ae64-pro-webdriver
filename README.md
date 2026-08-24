# AE64 Pro Control

An unofficial, local-first WebHID driver for the Everglide AE64 Pro magnetic keyboard. It replaces the slow manufacturer-hosted web app with a static site that talks directly to the keyboard; there is no account, cloud dependency, analytics, or firmware updater.

The protocol implementation was reconstructed from the two captured manufacturer HAR files in `xsyd.top HAR files/`. The HE30 alternative driver was used as a safety and interaction reference only—the AE64 packet protocol is different.

## Deploy on GitHub Pages

The repository includes an automated GitHub Pages workflow. Before its first run, open **Settings → Pages** in the GitHub repository and set **Source** to **GitHub Actions**. Pushes to `main` then test and deploy the driver automatically at:

[Open the GitHub Pages driver](https://tuk3kcs.github.io/everglide-ae64-pro-webdriver/)

You can also run it manually from **Actions → Deploy GitHub Pages → Run workflow**. The published artifact contains only the runtime entry files, `languages.xml`, `about.html`, the switch-axis image, and the modules under `js/app/`; protocol notes, task files, source captures, and hosting metadata are not made public by Pages.

## Run locally

WebHID needs a secure context. Desktop Chrome or Edge accepts `localhost`:

```powershell
python -m http.server 4173
```

Open `http://localhost:4173`, then choose **Connect keyboard**. The picker is restricted to `1CA6:300A`, usage `FFB0:0001`. Once Chrome or Edge has authorized the keyboard for this site, later visits keep the landing page visible and the **Connect keyboard** button opens the detected keyboard directly, without the picker.

Run the offline verification suite with:

```powershell
node smoke-test.cjs
```

## Project structure

The driver stays dependency-free and uses ordered classic browser scripts, matching the simple deployment model that worked well in the HE30 reference driver. The AE64 application is divided by responsibility under `js/app/`, while `app.js` only binds the permanent shell and starts device discovery. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the module map and rules for extending it.

## Basic release scope

Implemented now:

- Device identity, firmware/protocol version, feature bitmap, and diagnostics
- Four onboard profiles (switching and names)
- Four keymap layers with keyboard, media, mouse, and internal function groups
- Per-key normal press/release, Rapid Trigger, RT first touch, and independent RT press/release distances
- Per-key top and bottom dead zones; switch-axis metadata is preserved during writes
- Hall calibration and toggleable live press distance: a 0.0–4.0 mm switch gauge, millimeter readout, and simultaneous per-key travel fill
- Device-reported `L1–L20` keyboard effects plus explicitly experimental catalog values `L21–L23`, independent north/south LED switches, and one approximately 10 Hz live preview combining the keyboard with 38 addressable perimeter LEDs
- Independent keyboard/strip palettes, 0–100 brightness and speed, forward/backward direction, and complete custom-color matrix handling
- Captured rainbow palette index behavior, live Fn-layer status, and firmware-rendered Fn lighting readback
- Mint, graphite Dark, and cool Light appearances with browser-local persistence
- Drag selection plus Ctrl-click add/remove editing for keyboard keys and light-strip LEDs, with each mode restricted to its own physical region
- Windows/macOS system mode, 250–8,000 Hz polling rate, RGB sleep timer, and shake optimization
- Local profiles plus JSON import/export
- Optional experimental auto apply with a short edit debounce and verified device writes
- XML-driven English/Vietnamese language selection through `languages.xml`
- A standalone, author-editable About Us page in `about.html`
- Visible/read-only inspection for DKS, MPT, MT, TGL, END, SOCD, RS, and macro capacity

Deliberately deferred to the advanced release:

- Editors/writers for DKS, MPT, MT, TGL, END, SOCD, RS, and macros
- Destructive factory restore (visible but disabled pending physical-device verification)
- Decorative/secondary-light editors beyond the discovered read surface

Firmware update and bootloader commands are intentionally excluded from both the UI and protocol API.

## Write safety

By default, changes stay staged until **Apply changes** opens a review dialog. The experimental **Auto apply** toggle instead writes a completed edit after a short debounce and turns itself off if verification fails. A disconnected workspace cannot be mistaken for an onboard save. For performance records, the driver first reads the current key and preserves axis/calibration fields owned by the firmware. It then writes the staged fields, reads them back, and only then commits the matching flash group. Key mappings and lighting use the same explicit commit/read-back pattern. Experimental `L21–L23` values are retained only when the keyboard reads the same index back. An unexpected board ID stops the connection before configuration writes.

See [AE64_PROTOCOL.md](AE64_PROTOCOL.md) for the recovered command map and confidence boundary.

## Adding a language

Copy either `<language>` section in `languages.xml`, give it a unique `code` and display `name`, and translate its `<string>` values. Missing keys fall back to English. Keep the file well-formed XML and serve the site through HTTP(S); opening `index.html` directly cannot load the XML.

## Editing About Us

Edit `about.html` directly. It is a normal trusted HTML document shown inside the About Us workspace page, so authors can add headings, images, links, credits, or custom styling without changing the application JavaScript.
