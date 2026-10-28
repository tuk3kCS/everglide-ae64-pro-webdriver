# Independent AGP1 protocol review

The reviewed implementation is the original C staging engine in `include/ae64_gamepad_protocol.h` and `src/ae64_gamepad_protocol.c`, together with the browser client `C:/GitHub/everglide-ae64-pro-webdriver/gamepad/protocol.js`. This review is bounded to offline configuration encoding, transfer/state handling, and integration contracts. It does not test USB or keyboard hardware.

## Result

After the transaction-token correction, no blocking correctness defect was found in the reviewed transfer path. The independent C test suite passed **236,254 always-evaluated checks**. A separately rebuilt C stdin/stdout harness also passed the current browser client's **37 cross-language codec/identity/atomic-transfer checks**.

Independent test source: `tests/test_gamepad_protocol_review.c`.

The review covered:

- Exact and one-byte-overlapping request/reply buffers, including untouched guard bytes.
- Read/write offsets at the end of the 208-byte configuration and a 65535 offset.
- Incomplete uploads, malformed frame lengths, wrong CRCs, invalid physical geometry, stale active revisions, and callback failure.
- Same-owner BEGIN retries preserving received data.
- Rejection of a second owner while a transaction is live.
- Wrong-owner WRITE, COMMIT, and ABORT operations leaving the live transaction intact.
- Explicit COMMIT binding to the owner token, staged CRC, and active revision.
- Expiry and owner-write refresh across 32-bit timer wraparound.
- A stale owner's commands not affecting a new owner after expiry.
- 3,000 deterministic malformed packets with reply guards and unchanged active configuration.

## Defect found and corrected during review

The initial staging protocol had no transaction ownership: another client's BEGIN could replace the staging buffer, and the first client's subsequent COMMIT could install the second client's configuration. Read-back could detect that only after installation. The revised protocol adds an eight-byte random transaction token to every mutating operation, rejects a foreign BEGIN while busy, binds COMMIT to expected CRC/revision, makes matching BEGIN retries idempotent, and expires abandoned transactions. The independent tests exercise those corrected interleavings.

The client also now permits an OFF profile without requiring that profile's selected output backend, matching the C decoder's behavior. This makes disabling output possible even when the selected XInput/HID backend is unavailable.

## Integration boundaries

- The C entry point requires actual 64-byte request/reply storage. The board's USB callback must validate the received report length before calling it.
- Calls must run in a serialized, non-reentrant control-task context as documented. The staging engine is not an interrupt/thread synchronization primitive.
- The install callback owns atomic installation, neutral output/rearming, and any advertised persistent storage. C only updates its active wire bytes/revision after callback success; it cannot prove that a hardware callback obeys the no-partial-change-on-failure contract.
- Transaction identifiers prevent accidental cross-client ownership confusion. They are not device authentication or access control. CRC-32 detects corruption; it is not a cryptographic signature.
- The context stores a measured-maximum calibration snapshot at initialization. A board recalibration path must refresh that snapshot coherently with mapping validation/installation; the browser's declared per-binding maximum is not physical calibration.
- The configuration wire policy rejects duplicate physical-key assignments, even though the lower physical adapter can support deliberate duplicates. This is an explicit profile/schema policy, not a hardware limitation.
- Capability handshake/read-back checks establish protocol/board metadata and byte agreement, not working USB gamepad or XInput enumeration.

## Small edges corrected after review

1. Model deadzone validation now quantizes to the same integer used on the wire and rejects values that round to 9500 or above, matching the C decoder.
2. `gp_vendor_init` now locally preserves the initial blob and maximum-travel array before clearing its context. This permits reinitialization from its own active/calibration storage. This is separate from request/reply aliases, which passed the independent tests.

## Reproduction

```powershell
& 'work/toolchains/zig-x86_64-windows-0.17.0/zig.exe' cc -std=c11 -Wall -Wextra -Werror -O2 -I outputs/AE64-Pro-research/gamepad/include outputs/AE64-Pro-research/gamepad/src/ae64_gamepad.c outputs/AE64-Pro-research/gamepad/src/ae64_gamepad_physical.c outputs/AE64-Pro-research/gamepad/src/ae64_gamepad_protocol.c outputs/AE64-Pro-research/gamepad/tests/test_gamepad_protocol_review.c -o work/gamepad-protocol-review.exe
& './work/gamepad-protocol-review.exe'
```

The separately rebuilt harness used the same C sources and `tests/protocol_harness.c`; Node ran the repository's `gamepad/protocol-tests.cjs` against that executable. No live transport was opened.
