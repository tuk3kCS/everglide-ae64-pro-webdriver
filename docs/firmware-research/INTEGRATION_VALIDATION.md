# Main-driver integration — October 28, 2026

The firmware source, custom binary, five factory binaries, controller components, travel-limit fix, earlier research reports and full research archive are now incorporated in this repository. The standalone `/gamepad` directory is removed. The main application exposes `/#gamepad` and `/#firmware`.

## Verification

- Main driver smoke/regression checks pass, including language parity, ordered scripts, deployment packaging and no firmware commands during ordinary configuration.
- 25,732 firmware checks pass with fake transports: all six real image hashes/CRC/chunk streams, complete update lifecycle, exclusive transport ownership, wrong-board/mode rejection, write and validation failure, automatic restart gating, serial/physical-device association and deployment copying.
- Firmware UI tests pass: selection and review send no firmware commands; only Start invokes the updater. Stale image selection/review races and the hardware-firmware shortcut are covered.
- 8,038 gamepad model/integrated-UI checks pass. The editor uses a shared connection, removes its listeners/timers on unmount, preserves the existing local-storage profile key and never closes the main app's transport.
- 51 configuration/transaction checks pass against the compiled C harness. The standalone JavaScript subset also passes in CI without a C compiler.
- The 3.31 mm connected-UI fixture checks that all six default bindings are fitted locally before any upload. Explicit firmware rejection is distinguished from an uncertain commit response.
- Portable core tests pass: 120,591 mapper checks, 140,737 physical-adapter checks, 236,254 AGP1 checks, plus XUSB descriptors/control/transfer-lifetime tests.
- Rebuilding from `firmware/custom/ae64-xinput/source/` reproduces the original 131,464-byte image exactly: SHA-256 `fa97bcfef4cffe1fb8f2309ba537d2491dbc0fe7162eaec1db2c3d1ea220d69a`.
- The rebuilt image passes the static image audit and 7,629 synthetic board checks. The additional range regression passes 8,824 checks, rejecting 3.50 mm and committing 3.00 mm with a 3.31 mm switch-range fixture.
- Browser inspection confirms both solution cards, the embedded hardware editor, six selectable firmware images and successful selected-image file checks. The hardware shortcut selects the custom binary rather than retaining a prior factory selection.
- HTTP checks confirm all 29 runtime script/style resources, all six binary downloads and their catalog hashes. The retired `/gamepad/` route returns 404 under the local static server.

The new integrated flasher was **not run against hardware** during this work. All transfer tests used simulated devices. The earlier user-performed factory-site flash and later Windows/AGP1 observations establish that the custom image starts and enumerates on that keyboard; they do not validate the newly integrated updater or every analog behavior/recovery path.

Run the commands in the root README to repeat the offline tests. GitHub Pages runs those checks, regenerates the firmware catalog and packages the actual binaries plus the new UI assets. No deployment, commit or push was performed by this integration task.
