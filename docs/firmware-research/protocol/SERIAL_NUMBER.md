# Device serial-number display

The device-information response (`01 02`) supplies 12 serial/UID bytes at offsets 17 through 28. The original manufacturer web driver's retained decoder, [`evidence/P12.js.txt`](evidence/P12.js.txt), displays them using `sn: t.slice(17,29).join("")`: it concatenates the decimal value of every byte.

The previous replacement driver removed all zero and `0xff` bytes and decoded the remainder as UTF-8. The UID field is not UTF-8 text, so that produced replacement glyphs and control characters, and omitted meaningful identity bytes. `protocol.js` now mirrors the factory display format without removing bytes. The Overview and Diagnostics pages already render the returned `info.serial`, so both receive the corrected string.

This establishes the format used by the factory driver. It does not establish an equivalence to a printed packaging/sticker number, which was not supplied for comparison.

Firmware-update reconnection separately uses the complete 12-byte, fixed-width hexadecimal identifier in `js/firmware/flasher.js`. That machine identity representation remains unchanged so reconnect matching is independent of human-facing serial formatting.

Validation: `node tests/device-serial-tests.cjs` checks the manufacturer source expression and synthetic device replies containing zero, `0xff`, non-UTF-8 bytes, and leading zero digits. It performs no HID access or writes.
