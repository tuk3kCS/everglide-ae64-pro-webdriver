# AE64 Pro Control

An unofficial, local-first WebHID driver for the Everglide AE64 Pro magnetic keyboard. It replaces the slow manufacturer-hosted web app with a static site that talks directly to the keyboard; there is no account, cloud dependency, analytics, or firmware updater.

The protocol implementation was reconstructed from the two captured manufacturer HAR files in `xsyd.top HAR files/`. The HE30 alternative driver was used as a safety and interaction reference only—the AE64 packet protocol is different.

## Deploy on GitHub Pages

The repository includes an automated GitHub Pages workflow. Before its first run, open **Settings → Pages** in the GitHub repository and set **Source** to **GitHub Actions**. Pushes to `main` then test and deploy the driver automatically at:

[Open the GitHub Pages driver](https://tuk3kcs.github.io/everglide-ae64-pro-webdriver/)

You can also run it manually from **Actions → Deploy GitHub Pages → Run workflow**. The published artifact contains only `index.html`, `styles.css`, `protocol.js`, `app.js`, and `languages.xml`; protocol notes, task files, source captures, and hosting metadata are not made public by Pages.

## Run locally

WebHID needs a secure context. Desktop Chrome or Edge accepts `localhost`:

```powershell
python -m http.server 4173
```

Open `http://localhost:4173`, then choose **Connect keyboard**. The picker is restricted to `1CA6:300A`, usage `FFB0:0001`. **Open demo** lets you inspect the complete interface without hardware.

Run the offline verification suite with:

```powershell
node smoke-test.cjs
```

## Basic release scope

Implemented now:

- Device identity, firmware/protocol version, feature bitmap, and diagnostics
- Four onboard profiles (switching and names)
- Four keymap layers with keyboard, media, mouse, and internal function groups
- Per-key normal press/release, Rapid Trigger, RT first touch, and independent RT press/release distances
- Per-key top and bottom dead zones; switch-axis metadata is preserved during writes
- Hall calibration and live raw-travel test
- Device-reported `L1–L23` main RGB modes, 0–100 brightness/speed, forward/backward direction, an editable eight-color palette, and complete `6 × 21` custom-light matrix handling
- Windows/macOS system mode, 250–8,000 Hz polling rate, RGB sleep timer, and shake optimization
- Local profiles plus JSON import/export
- XML-driven English/Vietnamese language selection through `languages.xml`
- Visible/read-only inspection for DKS, MPT, MT, TGL, END, SOCD, RS, and macro capacity

Deliberately deferred to the advanced release:

- Editors/writers for DKS, MPT, MT, TGL, END, SOCD, RS, and macros
- Destructive factory restore (visible but disabled pending physical-device verification)
- Decorative/secondary-light editors beyond the discovered read surface

Firmware update and bootloader commands are intentionally excluded from both the UI and protocol API.

## Write safety

Changes stay staged until **Apply changes**. For performance records, the driver first reads the current key and preserves axis/calibration fields owned by the firmware. It then writes the staged fields, reads them back, and only then commits the matching flash group. Key mappings and lighting use the same explicit commit/read-back pattern. An unexpected board ID stops the connection before configuration writes.

See [AE64_PROTOCOL.md](AE64_PROTOCOL.md) for the recovered command map and confidence boundary.

## Adding a language

Copy either `<language>` section in `languages.xml`, give it a unique `code` and display `name`, and translate its `<string>` values. Missing keys fall back to English. Keep the file well-formed XML and serve the site through HTTP(S); opening `index.html` directly cannot load the XML.
