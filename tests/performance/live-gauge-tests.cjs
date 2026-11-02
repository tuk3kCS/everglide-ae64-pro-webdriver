"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { AE64HidTransport, SOCD_MODE } = require("../../protocol.js");
function fixture(firmware) {
  const keys = [{ id: 0, n: "Q", row: 2, col: 1 }, { id: 1, n: "W", row: 2, col: 2 }, { id: 2, n: "Enter", row: 3, col: 13 }], packets = [], routes = new Map();
  const transport = new AE64HidTransport({ opened: true, firmware });
  transport.transact = async (packet) => {
    packets.push([...packet]);assert.deepEqual([...packet.slice(0, 3)], [4, 3, 1], "Gauge only uses the stock Route read command");
    const reply = new Uint8Array(64);reply.set(packet);
    for (let col = 0; col < 21; col++) new DataView(reply.buffer).setUint16(4 + col * 2, routes.get(`${packet[3]}:${col}`) || 0, true);
    return reply;
  };
  function node() { const props = new Map(), classes = new Set();return { textContent: "", innerHTML: "", dataset: {}, style: { setProperty: (key, value) => props.set(key, value) }, props,
    classList: { add: (key) => classes.add(key), remove: (key) => classes.delete(key), toggle: (key, on) => on ? classes.add(key) : classes.delete(key) }, setAttribute() {}, querySelectorAll: () => [], insertAdjacentHTML() {} }; }
  const nodes = new Map(["livePressPanel", "livePressValue", "livePressRaw", "livePressKey", "livePressActuation", "liveActuationMarkerLabel", "livePressScope", "livePressStatus", "pressedKeyList"].map((id) => [id, node()]));
  const scale = node();scale.dataset.travelMax = "3.310";nodes.get("livePressPanel").querySelector = (selector) => selector === ".axis-gauge-scale" ? scale : node();
  const keyNodes = keys.map((key) => ({ ...node(), dataset: { key: String(key.id) } }));
  const state = { page: "performance", transport, livePressDistance: true, livePressSelectionOnly: false, selectedKeys: new Set([0]), switchCatalog: [],
    profile: { selected: 0, performance: Object.fromEntries(keys.map((key) => [key.id, { axisRangeMax: key.id === 1 ? 4000 : 3310, mode: 0, normalPress: 2 }])) },
    hardware: { travelValues: new Map() }, timers: { travelGeneration: 0 } };
  const c = { state, keys, SOCD_MODE, MATRIX_ROWS: 6, console, connected: () => transport.connected, position: (key) => ({ row: key.row, col: key.col }),
    selectedKeyIds: () => [...state.selectedKeys], esc: String, log() {}, setTimeout: () => 1, clearTimeout() {},
    document: { querySelectorAll: () => keyNodes, querySelector: (selector) => nodes.get(selector.slice(1)) || null } };
  vm.createContext(c);
  for (const file of ["pages.js", "live.js"]) {
    const source = fs.readFileSync(path.join(__dirname, "../../js/app", file), "utf8");
    // The later page declarations initialize unrelated advanced tutorial data.
    vm.runInContext(file === "pages.js" ? source.slice(0, source.indexOf("function layerBar(")) : source, c);
  }
  return { state, routes, nodes, keyNodes, packets, scale, c, run: (code) => vm.runInContext(code, c) };
}
async function main() {
  for (const firmware of ["stock 0.1.0.0", "custom 0.8"]) {
    const f = fixture(firmware);f.routes.set("2:2", 2500);await f.run("startTravel()");
    assert.deepEqual(f.packets.map((p) => p[3]), [0, 1, 2, 3, 4, 5]);
    assert.equal(f.nodes.get("livePressKey").textContent, "W", "A selected idle Q must not freeze the gauge for W");
    assert.match(f.nodes.get("livePressValue").innerHTML, /^2.500/);assert.equal(f.nodes.get("livePressPanel").props.get("--press-distance"), "62.50%");
    assert.equal(f.nodes.get("livePressScope").textContent, "All keys");assert.match(f.nodes.get("pressedKeyList").innerHTML, /W.*2.500/);
    f.state.livePressSelectionOnly = true;f.run("updateTravelVisuals()");assert.equal(f.nodes.get("livePressKey").textContent, "Q");assert.match(f.nodes.get("livePressValue").innerHTML, /^0.000/);
    f.routes.set("2:1", 1500);await f.run("startTravel()");assert.match(f.nodes.get("livePressValue").innerHTML, /^1.500/);assert.equal(f.nodes.get("livePressScope").textContent, "1 selected");
    f.state.livePressSelectionOnly = false;f.routes.set("3:13", 4000);await f.run("startTravel()");assert.equal(f.nodes.get("livePressKey").textContent, "Enter");
    assert.equal(f.nodes.get("livePressPanel").props.get("--press-distance"), "100.00%");assert.match(f.nodes.get("livePressValue").innerHTML, /^3.310/);
    f.routes.clear();await f.run("startTravel()");assert.match(f.nodes.get("livePressValue").innerHTML, /^0.000/);assert.equal(f.nodes.get("livePressKey").textContent, "Q");assert.match(f.nodes.get("pressedKeyList").innerHTML, /Press any key/);
    f.state.selectedKeys.clear();f.state.livePressSelectionOnly = true;assert.equal(f.run("liveTravelTarget().selectedCount"), 0, "Empty selection falls back to all keys");
    f.run("stopTravelPolling(true)");assert.equal(f.state.hardware.travelValues.size, 0);
  }
  console.log("PASS: stock/custom native Route decoding, idle-selection regression, explicit selection scope, simultaneous reads, sparse Enter position, exact travel clamping, release and all-key fallback. No custom commands or writes.");
}
main().catch((error) => { console.error(error);process.exitCode = 1; });
