# v0.2 normal RGB investigation

Reviewed October 29, 2026 in response to a report that all 20 normal RGB effects look alike. **The user subsequently clarified that this meant the web preview only.** The firmware portion is a static source/image investigation. It did not run or write the keyboard, and it does not establish the behavior of the installed image on hardware.

## Result

No change to the 20 factory effect implementations, their dispatch table, their configuration handler, or their normal timing loop was found in the distributed v0.2 image. The custom Fn hook can intentionally mask the composed key-LED frame while an enabled Fn layer is held. Persisted ordinary per-key overrides can also mask effects. The browser's non-live preview intentionally uses the same static palette for all effect modes.

For the clarified browser-only symptom, the fixed-palette preview is the source-level cause. Incoming live frames could additionally repaint a staged mode with the hardware's still-active effect. This did not establish a defect in the custom firmware's normal effect engine.

## Implemented browser correction

`js/app/lighting-preview.js` now samples 20 distinct illustrative spatial/time patterns. `lighting-preview.css` animates those samples using CSS, without new polling timers or device commands. Main brightness, speed, direction and palette affect the preview. Ordinary per-key custom colors remain static overrides, including all five Space LEDs. Unlisted L21–L23 are explicitly excluded from simulation.

A staged main effect/palette takes priority over received live frames and is labeled **Draft effect preview · approximate**. Paused/offline/initial previews say **Effect preview · approximate**. A clean connected profile with a received frame continues to display actual hardware RGB, removes the illustrative animation, and labels it as live. The note explicitly distinguishes illustrative animation from the physical Fn overlay and demonstrates reactive patterns automatically.

Validation includes `tests/lighting/effect-preview-tests.cjs`: distinct fingerprints for all 20 modes with both rainbow and single-color palettes; brightness/off behavior; direction and speed; priority and unsupported-mode decisions; static per-key overrides; and the actual live painter's protection of staged previews. Headless Edge checks also exercised all 20 rendered modes, five animated Space cells, changing computed colors over time, immediate brightness updates and transition from a protected draft back to exact live RGB. These checks did not access a physical keyboard.

## Pinned artifacts and method

- Factory container: `firmware/XS117_C048P010_AE64Pro_App_v0.1.0.0_20260930a.bin`, SHA-256 `3f99093d07426db7c0a4329f3b171eafe2544c92cf5d1e1c99faa358e5b61a1d`.
- Shipped custom container: `firmware/AE64-Pro-XInput-FnRGB-EXPERIMENTAL-v0.2.bin`, SHA-256 `0a10429b593fec1b70648f2379ec0f9ac01f71238c4c179c1e7d77b18951469c`.
- Container prefix length: `0x1000`. All offsets below are payload offsets; CPU code base is `0x80021000`.
- Byte comparisons used the actual checked-in binary files. The retained original disassembly is in the earlier research workspace's `work/native/0.1.0.0-disasm.json`. The rendering excerpts already retained under `fn-rgb/` provide the same native paths. This ledger uses local investigation IDs, not REA engine Evidence IDs.

## Evidence ledger

| ID | Direct observation | Implication / limit |
| --- | --- | --- |
| RGB-01 | Range `0x6E6E..0xA536` is byte-identical between factory and v0.2. | The original effect implementations and effect dispatcher were not replaced. This is static identity, not execution evidence. |
| RGB-02 | Main LED descriptor at `0x1B020` has 15 columns, six rows, dispatch pointer `0x8003C0B0`, and count `20`. Both LED descriptors and the main table are byte-identical. | The factory advertises 20 main effects. Catalog entries 20–22 have no callbacks within that table. |
| RGB-03 | All 20 render callback addresses are distinct and preserved, listed below. | A table rewrite sending every mode to one renderer is ruled out for this shipped file. |
| RGB-04 | Lighting base-write handler `0xC442..0xC544` is byte-identical. It stores the request's mode byte at settings offset `+6`. | Normal mode-setting is still the factory path. The browser's `setLightingBase()` sends that mode in request byte 5, matching this handler. |
| RGB-05 | Native normal-lighting loop `0xA9C0..0xAA36` is byte-identical. It calls effect update at `0xA258` and composition at `0xA536` on their normal schedules. | v0.2 does not replace the normal effect loop. Added gamepad work may affect timing in practice, which is not quantified here. |
| RGB-06 | The sole RGB integration patch changes the call at `0xA594` to `board_fn_render_hook`. The original target was `0x1456A`; the original function body `0x1456A..0x14906` is preserved. | The C wrapper delegates to the existing native Fn/status renderer before its own overlay. |
| RGB-07 | Custom wrapper writes only composed frame `0x8D084..0x8D1EB`, conditional on held flag `0x8D2D0 & 0x20`, layer 1–3, loaded profile, and enabled layer flag. | Enabled custom Fn colors replace normal key colors while Fn is held. They do not intentionally modify the effect/live buffer `0x8CC4C`. |
| RGB-08 | Factory composition tests alpha/override words before copying effect colors; native effect update also preserves override cells. | Ordinary per-key custom colors can intentionally obscure the selected effect, independently of the custom Fn extension. |
| RGB-09 | `keyboardHtml()` chooses a fixed `RAINBOW_PREVIEW` or selected palette when live hardware RGB data is unavailable. Its choice does not branch on effect mode. | All effect selections can look alike in an offline/paused web preview even when hardware effect modes differ. |

### Preserved render callbacks

The table begins at payload `0x1B0B0` and contains pairs of initializer and render pointers. These are the render pointer values, indexed by the wire mode byte, rather than the UI's L1-based label:

| Mode | Render CPU address | Mode | Render CPU address |
| ---: | --- | ---: | --- |
| 0 | `80028772` | 10 | `80029BD8` |
| 1 | `80028810` | 11 | `80029DBA` |
| 2 | `800289CA` | 12 | `80029E50` |
| 3 | `80028B8A` | 13 | `80029F86` |
| 4 | `80028D3C` | 14 | `8002A19C` |
| 5 | `80028EB4` | 15 | `8002A35C` |
| 6 | `800290AC` | 16 | `8002A84C` |
| 7 | `8002936A` | 17 | `8002AA4E` |
| 8 | `80029844` | 18 | `8002AC78` |
| 9 | `80029A18` | 19 | `8002AF52` |

## Heap investigation

The extension reserves 4,100 bytes from the native heap, reducing `0x87964..0x8B964` (16,384 bytes) to `0x87964..0x8A960` (12,284 bytes). Its BSS is linked in the excluded reservation. That reduction is a real resource constraint and needs runtime headroom testing.

The native effect initializer at `0xA1EA` and update dispatcher at `0xA258` use existing descriptor/framebuffer pointers and a fixed context supplied by the main loop (`gp+0x108` for the main area, `gp+0x330` for the strip). On a mode change, initialization clears the existing frame/context and invokes the selected table initializer. No direct allocation call was found in the effect implementations or switch/dispatch paths.

The native heap allocation wrapper is at `0x1144A`; free is at `0x11474`. The recovered direct allocation callers are object allocation at `0x119B0` and thread-stack allocation at `0x12010`. The two recovered dynamic thread-creation call sites, `0x107E2` and `0xD98E`, each request a 4,096-byte stack. This is not a complete heap high-water proof, and indirect/runtime allocation remains outside this bounded search. However, the evidence does not support a claim that changing RGB modes allocates a new effect buffer, or that a failed effect allocation explains all modes looking the same.

## Useful guards for the next revision

1. Always call the original renderer once, including when custom colors are disabled, because the function also draws native status indications.
2. Before decoding/loading custom color data, return to the native frame when no valid Fn1–3 layer is held. This avoids unnecessary custom storage work during ordinary effects.
3. Snapshot the profile/layer/held state, validate the loaded cache belongs to that exact profile, and recheck the snapshot before applying the custom frame. On a profile or layer transition, retain the factory frame for that pass. This addresses a possible mixed-state boundary without guessing at normal effect behavior.
4. Keep custom writes confined to the composed frame. Never write a custom Fn overlay into the effect/live buffer merely to make the browser preview resemble it.
5. Add a build invariant that the two LED descriptors, complete 20-entry effect table, factory effect code, mode handler and timing loop remain byte-identical to the pinned factory image, except for the documented compositor hook.
6. Add synthetic tests with different seeded normal frames for all 20 modes and prove the no-Fn/disabled/invalid-state wrapper preserves each seed. This tests delegation and guard boundaries, not the actual factory algorithms.

## Actionable driver diagnostics

- Show whether the preview is live, paused, or a palette illustration. A palette illustration cannot be used to compare effect animations.
- Read back the normal effect mode after Apply, which the existing driver already does. A highlighted selection alone only proves the local draft changed.
- Read ordinary custom-color flags and expose their count. An explicit user action to clear the main area's per-key overrides can restore visibility of normal effects without changing the selected effect.
- Keep this distinct from Fn custom colors: they should apply only while a mapped Fn layer is actually held. A read-only extension status report can expose raw held flag, active layer/profile and applied custom-overlay status for diagnosis.
- If the physical LEDs still render identically with normal mode readback correct, no override flags, and no Fn held, compare live effect frames for several modes, including reactive effects with a controlled key press. The actual installed binary identity and hardware timing/heap behavior then remain necessary evidence.

There is no authorization or recommendation in this report to flash, reset settings or silently clear a user's colors. The report records implementation evidence and proposed guarded behavior only.
