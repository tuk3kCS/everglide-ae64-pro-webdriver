# v0.8: scan workload and Fn lighting optimization

Date: October 31, 2026. Based on the pinned factory v0.1.0.0 image.

The user compared stock with custom v0.6/v0.7 and found both default and custom Fn1 lighting much slower on the custom firmware. v0.8 removes confirmed repeated work in the shared input path and corrects physical Fn detection. It is built and verified offline. It has not been flashed in this work, so a stock-equivalent physical response time is not established.

## Findings and corrections

1. **Every scan forced keyboard releases.** v0.7 restored saved scanner history, scanned, then replaced each controller-bound key's event with release 11, marked its record pending and requested native input processing. Even unchanged keys repeatedly triggered this work. This had been added to prevent normal letters sticking, before exact-source output gates existed. v0.8 keeps native scanner history intact and relies on those gates to block controller-only sources. When a mapping/policy changes, it removes newly blocked physical owners from the working keyboard ledger once. Other keys, aliases, modifiers and macro owner 240 are preserved. Reinstalling a mapping also reconciles a brief round trip through mixed mode between scans.

2. **Controller setup was rebuilt and validated repeatedly.** The old physical adapter rebuilt normalized ranges and curves and ran overlapping configuration validations every frame. v0.8 caches validated range endpoints and digital/bound masks. It rebuilds after configuration identity/revision/mode or relevant measured-stroke changes. Per-frame sensor validity, travel bounds, neutral-on-fault and release-before-rearm checks remain. Integer quantization, curves, opposite-direction policy, circular stick limits and trigger output preserve the previous evaluator's results. The fully validating reference API remains available for unversioned mutable inputs.

3. **Controller math ran with interrupts disabled.** The old board wrapper masked interrupts throughout controller evaluation. v0.8 snapshots the mapping/context under a short lock, evaluates with interrupts enabled, then publishes under another short lock. A generation counter rejects a result if a USB reset, suspension or mapping installation invalidated the snapshot. Vendor validation uses separate maximum-travel storage so it cannot overwrite a frame being evaluated. This reduces interrupt-disabled work; its exact duration has not been measured.

4. **The physical matrix is sparse.** The old adapter treated each row as consecutive columns. The factory layout has holes in rows 3–5: Space is row 5 column 6 and the default Fn key is row 5 column 10. v0.8 uses the actual factory layout for travel, calibration, output ownership and Fn press/release tracking. Image verification checks this table against the pinned stock bytes, rather than relying on a second copy of the assumption.

5. **Unneeded sensor passes are skipped.** Empty, disabled and hidden-controller mappings skip the extra controller sensor sweep. Active mappings read sensor records only for assigned physical keys. The normal factory scanner still runs.

These are software regressions/inefficiencies, not evidence that the MCU or flash storage has reached a hardware limit. Fn colors are normally cached in RAM; no flash erase/program or profile reload was added to ordinary Fn transitions. The native RGB effect engine, timing loop, default Fn renderer and twenty effect callback pairs remain byte-for-byte stock. v0.7's request for a fresh Fn frame remains, but requesting a frame alone does not guarantee that the lighting task receives processing time promptly.

## Work comparison

Both versions were compiled as portable test programs and run with the same six-bound-key fixture and a stubbed native scanner. Over 10,000 unchanged scans:

| Count | v0.7 | v0.8 |
| --- | ---: | ---: |
| Simulated native-RAM accesses | 3,630,000 | 310,000 |
| Forced native input-processing passes | 10,000 | 0 |
| Forced pending key records | 60,000 | 0 |

This is **91.5% fewer counted native-RAM accesses** in that fixture. It is not a CPU utilization, cycle, throughput or physical LED latency measurement. The factory scanner's own cost is excluded. The empty-mapping v0.8 path counted 10,000 accesses over 10,000 scans. See `firmware/custom/ae64-xinput/v0.8/scan-work-comparison.json` and the retained comparison harness.

## Verification

- Cached/reference evaluators: 145,604 differential frames and 3,150,151 checks, including curves, quantization, randomized mappings, faults, calibration changes, revision changes, watchdogs and timer wrap.
- Input/scanner models: all WASD ordering/diagonal/release cases; 6,000 rapid WASD/T cycles through native append paths; alias/modifier ownership; consumed-event cleanup; normal/mixed/off modes and lost-report recovery.
- Fn models: Fn1–Fn3 origins and release, default Fn physical position, lower-row gaps, default-renderer fallback, custom colors and layer-frame requests.
- Concurrency model: reset/suspend during evaluation discards stale output and requires release/rearm. This is simulated interruption, not a hardware stress capture.
- Working-ledger filter: 12,434 checks covering full capacity, ownership collisions, aliases, macro preservation, invalid counts and guard bytes.
- Linked RV32 trampolines: register preservation, original instructions, stack alignment and continuation addresses checked against actual emitted bytes.
- Full-image audit: exact stock SHA, CRC/container, permitted patch locations, ELF/image agreement, ABI, flash helpers, physical matrix, RAM reservation and 2,552-packet reconstruction.
- All 20 web-driver regression suites pass. The Gamepad firmware shortcut and generated catalog now select/list v0.8.

Persistent extension state remains **3,920 / 4,096 bytes**, the same total as v0.7; the cache is offset by removing scanner-history storage. The controller target remains one fresh report per millisecond with the existing DMA-ownership guards. Saved gamepad/Fn formats and session-only USB visibility behavior are unchanged.

## Release and remaining hardware check

Image: `firmware/AE64-Pro-XInput-FnRGB-EXPERIMENTAL-v0.8.bin`, **142,888 bytes**.

SHA-256: `753feeafd003de913c394a7b7c0e74a8e33dfa2ab633b8ef572bddb5ad43935b`.

The connected keyboard was left on stock firmware. No flash, factory reset or configuration write was performed. After a user-controlled upgrade, compare direct Fn1 press/release against stock with custom Fn colors disabled, then enabled, and repeat with WASD/T controller mappings active and with the controller disabled. Also repeat rapid key presses into a text field to check for normal-letter leakage. Physical LED timing, sustained input throughput and device stability remain hardware validation items; offline passing tests do not establish those results.

The build, verification, comparison and web-driver records are retained in `firmware/custom/ae64-xinput/v0.8/`. Earlier binaries/evidence remain available. The prior source archive is text-equivalent to the pre-v0.8 committed tree; historical mixed line endings prevent four files from reproducing their old release's raw-byte hashes, and no binary reconstruction claim is made for that archive.
