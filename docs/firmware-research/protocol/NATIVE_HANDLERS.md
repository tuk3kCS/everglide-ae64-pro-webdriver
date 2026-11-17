# Native WebHID command handlers across the five app images

This is a static reconstruction from the original payload bytes and the Capstone RV32 disassembly in the analysis bundle. It does not claim original source recovery or hardware-tested behavior. Names come from cross-checking the shipped driver's command encodings with the native pointer tables; unlabeled runtime flags remain numeric rather than being assigned invented feature names.

All offsets below are **payload offsets**. Add `0x1000` for the offset in the original downloaded container, or add `0x80021000` for the instruction's linked virtual address. For example, v0.0.5.0's DeviceInfo handler at payload `0xC54C` is container `0xD54C`, VMA `0x8002D54C`.

## How the mapping was recovered

The central parser clears 62 response bytes, initializes its two leading bytes to `FF FF`, reads request byte 0 as a family, and rejects families greater than `0x12`. It indexes an array of 19 eight-byte entries. Each entry contains a command-count word and a pointer to a command-handler pointer array. After checking request byte 1 against that count, it calls the corresponding pointer. This structure is present in every version.

The decoder and all recovered mappings are preserved in [native-dispatch-tables.json](native-dispatch-tables.json). Relevant instruction intervals are retained in [native-handler-excerpts](native-handler-excerpts/index.json). Those excerpt ends use the next distinct table-handler start as a convenient boundary; they are evidence intervals, not a claim that every interval is exactly one source function. A linear disassembly can decode embedded data as instructions outside established code paths; conclusions here are restricted to the dispatch/table-anchored paths.

| Version | Central parser entry | Family table |
| --- | --- | --- |
| 0.0.5.0 | `0xCF6C` | `0x18D28` |
| 0.0.6.0 | `0xCF82` | `0x18DA0` |
| 0.0.7.0 | `0xD0EC` | `0x18F10` |
| 0.0.8.0 | `0xD570` | `0x193B8` |
| 0.1.0.0 | `0xD776` | `0x195BC` |

## Core handler addresses

| Request | Driver meaning | 0.0.5.0 | 0.0.6.0 | 0.0.7.0 | 0.0.8.0 | 0.1.0.0 |
| --- | --- | --- | --- | --- | --- | --- |
| `01 01` | Protocol version | `B462` | `B440` | `B56A` | `B8CC` | `BAD2` |
| `01 02` | Device information | `C54C` | `C554` | `C67E` | `C83C` | `CA42` |
| `01 03` | Device feature bitmap | `C1B0` | `C18E` | `C2B8` | `C45A` | `C660` |
| `02 01` | Reset factory | `CBEE` | `CBF6` | `CD28` | `CE28` | `D02E` |
| `02 02` | Save parameters | `B476` | `B454` | `B57E` | `B8E0` | `BAE6` |
| `02 03` | Configuration switch / names | `C1C8` | `C1A6` | `C2D0` | `C472` | `C678` |
| `02 04` | Windows/Mac system mode | `B4A4` | `B482` | `B5AC` | `B90E` | `BB14` |
| `02 05` | Report rate | `CD52` | `CD68` | `CED2` | `D356` | `D55C` |
| `02 10` | Shake optimization (`0x10` = decimal 16) | `B7F2` | `B7D0` | `B8FA` | `BC72` | `BE78` |
| `03 01` | Read key layout | `B84E` | `B82C` | `B956` | `BCEC` | `BEF2` |
| `03 02` | Write key layout | `B8C0` | `B89E` | `B9C8` | `BD5E` | `BF64` |
| `04 01` | Read per-key performance | `BB28` | `BB06` | `BC30` | `BFC6` | `C1CC` |
| `04 02` | Write per-key performance | `C614` | `C61C` | `C746` | `C904` | `CB0A` |
| `04 03` | ADC/travel/calibration/status queries | `BC32` | `BC10` | `BD3A` | `C0D0` | `C2D6` |
| `08 01` | Application to bootloader | `CF00` | `CF16` | `D080` | `D504` | `D70A` |

Rows without a `0x` prefix still show hexadecimal offsets. The pointer tables, including additional commands, are in the JSON.

## Changes established in these handlers

### 0.0.5.0 baseline

The baseline already contains the global, layout, per-key Hall-performance, and boot-entry protocol families. Its `01 02` handler constructs the same board-identification and version response layout as later releases. The four payload bytes at response offset 4 are `00 30 00 0A`; at offset 8 its app version is `00 00 05 00`; its normal app run-mode byte at offset 16 is zero.

The five DeviceInfo handlers are each 200 bytes long. Version/date constants change in later versions, while the observed response fields remain in the same positions. This is a useful compatibility anchor, not a claim that the whole firmware otherwise stayed unchanged.

### 0.0.5.0 → 0.0.6.0: configuration-switch event scheduling

The `02 03` handler grows from the interval `C1C8–C2B6` to `C1A6–C2BE`. When the selected configuration actually changes, both versions store the new configuration and set the existing dirty/event bits. Version 0.0.6.0 additionally reads a second event word at RAM `0x0008D174` and sets a distinct bit according to the requested profile: profile 0 sets `0x08`, profile 1 sets `0x10`, profile 2 sets `0x20`, and profile 3 sets `0x40`.

The new block is v0.0.6.0 payload `0xC220–0xC252`. Version 0.0.5.0 has no corresponding block between its configuration store and response generation. This establishes additional scheduling/state notification on profile changes. The downstream consumer has not been tied to a specific user-facing effect in this focused analysis, so it should not be described as a particular bug fix.

The custom-command family count also increases from 3 to 4, but its added slot is a placeholder as discussed below.

### 0.0.6.0 → 0.0.7.0: invalidate calibration when axis ID changes

The driver encodes `axisV2Id` in request bytes 21–22 of `04 02`. The native handler decodes those bytes, compares the resulting ID to the per-key axis record's first halfword, and updates it if different. In version 0.0.7.0 that change path also executes:

```text
payload 0xC890: sh a1, 0(a2)     # store new axisV2Id
payload 0xC894: sb zero, 8(a2)   # new: clear the per-key calibration/status byte
```

The byte at per-key axis-record offset 8 is copied back into performance response byte 20 later in the same handler, which the driver names `calibrate`. Version 0.0.6.0 updates the ID and dirty flags without that byte reset. Thus **changing the selected axis ID now invalidates/resets that calibration status**. The precise effect on sensor readings still requires a hardware test; this static result does not establish a latency or accuracy improvement.

The custom-command family count grows from 4 to 8, again through placeholder slots rather than identified new working functionality.

### 0.0.7.0 → 0.0.8.0: mode checking and runtime-state reset

The `04 02` write-performance handler adds an explicit check that request byte 4 (`mode`) is at most 2. Values above 2 produce `FF` in response byte 4 and leave the normal update path. The driver's enum names those three accepted values Normal (0), RT (1), and IntervalRT (2).

If an accepted mode differs from the stored per-key mode, version 0.0.8.0 clears `0x0004` in a halfword of that key's runtime record before storing the new mode. The new check and comparison begin at payload `0xC93A`, and the bit clear occurs at `0xC99C–0xC9A2`. Version 0.0.7.0 lacks both the explicit mode limit and that change-triggered runtime-bit reset in this handler. This supports the statement **mode changes now reset a piece of per-key runtime state**, without assigning the unlabeled bit a more specific meaning.

### 0.0.7.0 → 0.0.8.0: shake optimization is mirrored into configuration state

In `02 10` (decimal command 16), the older implementation changes bit 11 (`0x800`) of a runtime flag word. Version 0.0.8.0 adds extraction of that bit, stores its boolean value in a separate configuration byte, and sets `0x08` in the configuration dirty/event word.

The new block is payload `0xBCAA–0xBCC8`; specifically the boolean store uses RAM `0x00082B69`, and the dirty/event word is at `0x0008D284`. This is **new configuration-state and save-notification handling for the shake-optimization switch**. It makes persistence plausible, but reboot persistence is not claimed as tested or conclusively proven without following the full save/load path.

### Other localized 0.0.8.0 changes

- `02 04` system-mode switching gains a clear of mask `0x0010` in a parameter halfword on one branch (payload `B99C–B9AA`). The exact feature represented by that bit is not assigned here.
- The central parser gains a per-command reply-suppression flag: it clears RAM byte `0x0008D25D` before invoking a handler, and skips the ordinary reply path if that byte is nonzero afterward (`D590–D5D0`). A source of nonzero writes and the exact triggering commands have not been established in this focused pass.
- The reset-factory handler adds a call after its reset/dirty-state work. The callee's full side effects were not established, so a specific reset-behavior claim is withheld.

### 0.0.8.0 → 0.1.0.0

The tables retain the same supported family/command counts, the same core response layout, the newly added mode check and runtime reset, the axis-change calibration reset, and the shake-optimization configuration mirror. DeviceInfo changes its app version to bytes `00 01 00 00` and its build date/time constants. The confirmed keyboard-report descriptor and send-path changes for this release are documented by the main binary analysis; they should not be confused with additions to this command family table.

No additional named behavior change in these native request handlers was established in this focused pass. Relocated RAM, code and constant addresses are not counted as feature changes.

## Custom-command count increases are not feature implementations

Family `0A` has these command counts, including slot 0:

| Version | Count | Newly admitted command indices |
| --- | ---: | --- |
| 0.0.5.0 | 3 | baseline 0–2 |
| 0.0.6.0 | 4 | 3 |
| 0.0.7.0 | 8 | 4–7 |
| 0.0.8.0 | 10 | 8–9 |
| 0.1.0.0 | 10 | none |

The new handlers in these app images only set request/response argument pointers and tail-jump to an immediate-return hook. For example, v0.0.6.0 command `0A 03` at payload `0xCC76` sets `a1` to response+2, `a0` to request+2, then jumps from `0xCC7E` to `0xCC74`, a `c.jr ra`. There is no substantive implementation at that hook. Similar return hooks exist for the later extra slots. These are compatibility/extension slots or placeholders; an increased table size does **not** establish that animation, game, sound, or other features were added to this keyboard.

## Updater boundary: the application does not implement flash writes

In every original app, family `08` has six slots. Slot 1 points to a real boot-entry handler; slots 2, 3, and 4 all point to the shared immediate-return stub. Therefore the actual `08 02` image writer, `08 03` validator, and `08 04` application-entry implementation are not recovered from these five app images. The host's update loop changes to boot mode before calling them.

The app's boot-entry handler does substantially more than a direct reset. In the latest image (`D70A–D776`) it first queues its response and waits for output/queue state, clears the machine interrupt-enable bit of `mstatus`, ORs `0x1000` into RAM word `0x0008D2CC`, calls helper `B3F4` and then helper `B452`, writes `0x0A` to MMIO address `0xF410001C`, and spins.

The latest helper calls establish these address/length operations:

1. `B3F4` calls the page-operation wrapper at payload `12A18` with address `0x80060000`, length `0x40000`.
2. It loops in `0x100`-byte blocks over source addresses `0x80020000` through `0x8005FF00`, obtaining bytes through wrapper `12A6E` and passing the same temporary buffer to wrapper `12A42` at destination `source + 0x40000`. The source range is 256 KiB; the destination range is `0x80060000–0x8009FFFF`.
3. `B452` calls wrapper `12A18` on `0x80020000` with length `0x1000`, then calls wrapper `12A42` at `0x80020000` for eight bytes: `D6 C7 B8 A9 00 00 00 00`.
4. `12A18` divides length into 4096-byte pages and calls native leaf `DD08` for each. That leaf invokes linked address `0x00000FE2` with a 4096-byte length. `12A42` rounds its length into words before leaf `DD5C`, which invokes linked address `0x00000F98`. Read wrapper `12A6E` reaches leaf `DD4A`, invoking linked address `0x00000F6C`. The leaves mask the flash-style addresses down to 20-bit offsets before the low-address calls. These are **not established ROM addresses**: startup copies payload `0x1BE98–0x1BFF8` to ILM `0xED8–0x1038`. Thus execution address `0xF6C` maps back to payload `0x1BF2C`, `0xF98` to `0x1BF58`, and `0xFE2` to `0x1BFA2`. The read routine loads bytes directly from mapped flash. The program and page-operation routines call through function pointers obtained from the platform table rooted at MMIO `0x2001FF00` (indirect table offsets `0x28` and `0x18` respectively). The service implementations behind those pointers remain unresolved.

The control flow, buffers, addresses and marker bytes are direct static observations. The roles **erase-page, program and read** for those services are a strong inference from their calling patterns, address handling and the copy loop; startup copies these low-address wrappers into ILM, and their indirect platform service implementations were not fully recovered. Together this supports a staged-backup/header-marker boot transition: copy the active 256 KiB region into a second region, replace its first 4 KiB with a marker, then request reset. It does not prove the bootloader's subsequent recovery policy.

The relevant extra excerpts are `latest-boot-staging-helpers.txt`, `latest-flash-wrappers.txt`, and `latest-flash-low-address-wrappers.txt` and `latest-flash-ilm-code.txt` in the native-handler-excerpts directory. None of these operations was run on the keyboard.

A custom firmware must preserve or deliberately reimplement a compatible boot-entry route, including any staging/marker contract required by the existing bootloader. Simply ACKing `08 01`, or resetting without understanding that contract, would not reproduce this transition. A separately verified physical recovery path remains necessary for development because broken custom USB/HID code can make software boot entry unavailable.

This boundary is why a working host-side packet plan and an app payload do not by themselves establish a usable custom-firmware flashing and recovery system.
