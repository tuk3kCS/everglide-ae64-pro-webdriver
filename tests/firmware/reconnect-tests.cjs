"use strict";
const assert = require("node:assert/strict");
const F = require("../../js/firmware/flasher.js"), R = require("../../js/firmware/reconnect.js");
const device = (serial, mode = 255, boardId = F.BOARD) => ({ vendorId: 0x1ca6, productId: 0x300a, collections: [{ usagePage: 0xff80 }], info: { serial, runMode: mode, boardId }, opened: false, probes: 0 });
function fixture(getDevices, overrides = {}) {
  let time = 0, polls = 0;
  const reconnect = new R.Reconnector({
    getDevices: async () => { polls++;return getDevices(polls); }, now: () => time, delay: async (ms) => { time += ms; }, timeout: 1000, interval: 100,
    checkIdentity: F.checkIdentity,
    inspect: async (d) => {
      d.probes++;if (d.failures) { d.failures--;throw new Error("Device is still starting"); }
      d.opened = true;return { info: d.info, transport: { device: d, connected: true, close: async () => { d.opened = false; } } };
    }, ...overrides,
  });
  return { reconnect, elapsed: () => time };
}
async function main() {
  const original = { serial: "target" }, stale = device("target", 0), boot = device("target"), other = device("other");
  const test = fixture((poll) => poll < 3 ? [other, stale] : [other, boot]);
  const found = await test.reconnect.wait({ mode: 255, original, preferred: stale });
  assert.equal(found.transport.device, boot);assert.equal(found.explicit, false);assert.equal(test.elapsed(), 200);assert.equal(other.opened, false);assert.equal(stale.opened, false);
  await found.transport.close();
  const app = device("target", 0), appTest = fixture(() => [other, app]);
  const finished = await appTest.reconnect.wait({ mode: 0, original, preferred: boot });assert.equal(finished.transport.device, app);await finished.transport.close();
  const transient = device("target");transient.failures = 2;
  const retry = fixture(() => [transient]);assert.equal((await retry.reconnect.wait({ mode: 255, original, preferred: stale })).transport.device, transient);assert.equal(retry.elapsed(), 200);
  const wrongBoard = device("target", 255, 123), rejected = fixture(() => [other, wrongBoard]);
  await assert.rejects(rejected.reconnect.wait({ mode: 255, original, preferred: stale }), (e) => e.name === "FirmwareReconnectError" && e.mode === 255 && /Reconnect keyboard/.test(e.message));
  assert.equal(other.opened, false);assert.equal(wrongBoard.opened, false);
  const serialChanged = device("other"), wrongSameObject = fixture(() => [serialChanged]);
  await assert.rejects(wrongSameObject.reconnect.wait({ mode: 255, original, preferred: serialChanged }), /could not reconnect/);assert.equal(serialChanged.opened, false);
  const a = device("target"), b = device("target"), ambiguous = fixture(() => [a, b]);
  await assert.rejects(ambiguous.reconnect.wait({ mode: 255, original, preferred: stale }), (e) => /same identity/.test(e.cause.message));assert.equal(a.opened, false);assert.equal(b.opened, false);
  const missingSerial = device(""), unknown = fixture(() => [missingSerial]);
  await assert.rejects(unknown.reconnect.wait({ mode: 255, original: { serial: "" }, preferred: stale }), /could not reconnect/);
  const sameObject = fixture(() => [missingSerial]);assert.equal((await sameObject.reconnect.wait({ mode: 255, original: { serial: "" }, preferred: missingSerial })).transport.device, missingSerial);
  const denied = fixture(() => { throw new Error("Browser permission unavailable"); });await assert.rejects(denied.reconnect.wait({ mode: 0, original, preferred: stale }), /firmware validated/);
  assert.equal(R.eligible({ ...boot, vendorId: 123 }), false);assert.equal(R.eligible({ ...boot, collections: [{ usagePage: 1 }] }), false);
  assert.equal(R.eligible({ ...boot, productId: 0x1234 }), true); // Boot collection may use a different PID.
  assert.equal(R.eligible({ ...boot, productId: 0x1234, collections: [{ usagePage: 0xffb0, usage: 1 }] }), false);
  console.log("PASS: automatic app/boot reconnect, changed HID objects, transient errors, two-keyboard identity isolation, duplicate identities and permission failure. No chooser or hardware accessed.");
}
main().catch((e) => { console.error(e);process.exitCode = 1; });
