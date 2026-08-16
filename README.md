# Everglide AE64 Pro Web Driver

Landing page and browser-based control panel made with plain HTML, CSS and JavaScript.

## Run locally

Use Chrome or Edge and serve the folder through localhost:

```powershell
python -m http.server 4173
```

Open `http://localhost:4173`.

## Current scope

- AE64 Pro layout visualizer (64-key ANSI-style layout, proportional key widths)
- Per-key travel-distance UI
- Per-key Rapid Trigger UI
- Basic key mapping UI
- Local browser persistence and JSON export
- WebHID read/write support for the vendor collection `1CA6:300A / FFB0:0001`

The WebHID report protocol has been recovered from the manufacturer bundle referenced by `webhid.har`. The app uses report ID `0`, zero-padded 64-byte packets, reads the current per-key performance before editing it, and preserves hardware fields that the UI does not expose. See [AE64_PROTOCOL.md](AE64_PROTOCOL.md) for the packet map.
