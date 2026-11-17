"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const saved = new Map(), notices = [];
let quota = false, nextId = 0;
const browser = {
  TextEncoder, TextDecoder, console,
  AE64_STORAGE_PREFIX: "ae64-reloaded:",
  AE64_PAGES_RELEASE: { id: "test-release" },
  localStorage: {
    getItem: (key) => saved.get(key) ?? null,
    setItem(key, value) {
      if (quota) throw new Error("Storage quota exceeded.");
      saved.set(key, value);
    },
  },
  crypto: { randomUUID: () => "profile-" + ++nextId },
  document: { querySelector: () => null },
  addEventListener() {},
  render() {},
  showToast(message) { notices.push(message); },
};
browser.window = browser;
vm.createContext(browser);
function run(source) { return vm.runInContext(source, browser); }
for (const file of [
  "protocol.js", "js/gamepad/model.js", "js/gamepad/protocol.js", "js/app/foundation.js",
  "js/app/macro.js", "js/app/fn-lighting.js", "js/app/profile-files.js", "v2/inactive-profiles.js",
]) run(fs.readFileSync(path.join(__dirname, "../..", file), "utf8"));

(async () => {
  run(`
    const matrix = Array.from({ length: 126 }, () => ({ r: 12, g: 34, b: 56, custom: true }));
    const bundleData = { format: "ae64-control-profile", version: 2, device: { vendorId: "1CA6", productId: "300A" },
      name: "Gaming", firmware: { family: "custom", version: "0.10.0.0", baseVersion: "0.1.0.0" }, systemMode: 0,
      profile: defaultProfile(), native: { advanced: [], macros: [] },
      custom: { fnLighting: Array.from({ length: 3 }, () => ({ enabled: true, colors: Array(126).fill("#123456") })),
        mainRgb: matrix, gamepad: AE64GamepadModel.emptyProfile() } };
    const custom = parseProfileBundle(bundleData);
    const factory = parseProfileBundle({ ...bundleData, name: "Typing", firmware: { family: "factory", version: "0.1.0.0", baseVersion: "0.1.0.0" }, sharedMain: matrix });
  `);
  const portable = run("profileImportPolicy(custom, factory)");
  assert.deepEqual(Object.keys(portable.custom), []);
  assert.equal(portable.sharedMain, undefined);
  assert.deepEqual(Array.from(portable.skipped), ["Fn RGB", "per-profile Main RGB", "gamepad"]);
  assert.deepEqual(Object.keys(portable.native), ["advanced", "macros"]);
  assert.deepEqual(Object.keys(run("profileImportPolicy(custom, custom).custom")), ["fnLighting", "mainRgb", "gamepad"]);
  assert.throws(() => run("profileImportPolicy(custom, factory, { swap: true })"), /same firmware family/);
  assert.throws(() => run("parseProfileBundle({ ...bundleData, device: { ...bundleData.device, productId: 'FFFF' } })"), /AE64 Pro/);
  assert.throws(() => run("parseProfileBundle({ ...bundleData, custom: { fnLighting: [{ enabled: true, colors: ['#fff'] }] } })"), /incomplete/);

  run(`
    state.transport = { connected: true };
    state.hardware.info = { firmware: "0.1.0.0" };
    const incoming = addInactiveProfile(factory);
    const outgoing = parseProfileBundle({ ...factory, name: "Outgoing" });
    let attempts = 0, succeeded = false;
    withOnboardProfileRead = (_, slot, operation) => operation(state.transport);
    readOnboardProfileBundle = async () => ({ bundle: outgoing });
    stageProfileBundle = async (_, target, transport, slot, { beforeStage }) => beforeStage();
    globalThis.pendingChangeCount = () => 1;
    globalThis.applyChanges = async () => { attempts++; return succeeded; };
  `);
  assert.equal(run("driverStorage.getItem(inactiveProfileStorageKey)"), null, "Hosted release storage remains isolated from the library");
  quota = true;
  await run("swapInactiveProfile(incoming.id, 1)");
  assert.equal(run("attempts"), 0, "Never write to the board when the outgoing backup cannot be saved");
  assert.equal(run("inactiveProfiles().length"), 1);
  quota = false;
  await run("swapInactiveProfile(incoming.id, 1)");
  assert.equal(run("attempts"), 1);
  assert.deepEqual(Array.from(run("inactiveProfiles().map(({ bundle }) => bundle.name)")), ["Typing", "Outgoing"]);
  assert.match(notices.at(-1), /Both profiles are saved/);
  run("removeInactiveProfile(inactiveProfiles().at(-1).id); succeeded = true;");
  await run("swapInactiveProfile(incoming.id, 1)");
  assert.deepEqual(Array.from(run("inactiveProfiles().map(({ bundle }) => bundle.name)")), ["Outgoing"]);
  console.log("PASS: versioned profile format, firmware isolation, release-independent library, backup-before-write, and failed-swap retention.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
