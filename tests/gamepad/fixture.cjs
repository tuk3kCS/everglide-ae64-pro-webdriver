"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const Model = require("../../js/gamepad/model.js"), Protocol = require("../../js/gamepad/protocol.js");
function fixture({ transport = null, connectTarget = transport } = {}) {
  const templates = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../js/gamepad/template.js"), "utf8"), templates);
  const html = templates.window.AE64GamepadTemplate, ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const events = { document: new Map(), window: new Map(), hid: new Map() }, intervals = new Set(), notices = [];
  let current = transport, nextInterval = 0, busy = false;
  function node(id = "") { return { id, listeners: {}, value: "", hidden: false, disabled: false, textContent: "", innerHTML: "", dataset: {}, className: "", files: [], style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} }, addEventListener(name, fn) { this.listeners[name] = fn; }, setAttribute() {}, querySelector() { return node(); } }; }
  const nodes = new Map(ids.map((id) => [id, node(id)]));
  const root = { querySelector(selector) { const id = selector.slice(1); assert.ok(nodes.has(id), `Template supplies ${selector}`); return nodes.get(id); }, querySelectorAll() { return []; } };
  const add = (target) => (name, fn) => { if (!events[target].has(name)) events[target].set(name, new Set()); events[target].get(name).add(fn); };
  const remove = (target) => (name, fn) => events[target].get(name)?.delete(fn);
  let saved;
  const sandbox = {
    window: null, document: { hidden: false, addEventListener: add("document"), removeEventListener: remove("document") },
    navigator: { hid: { addEventListener: add("hid"), removeEventListener: remove("hid") } },
    localStorage: { getItem() { return null; }, setItem(key, value) { saved = JSON.parse(value); } },
    setTimeout() {}, clearTimeout() {}, setInterval() { const id = ++nextInterval; intervals.add(id); return id; }, clearInterval(id) { intervals.delete(id); },
    console, Blob, URL, AE64GamepadModel: Model, AE64GamepadProtocol: Protocol,
    addEventListener: add("window"), removeEventListener: remove("window"),
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../js/gamepad/studio.js"), "utf8"), sandbox, { timeout: 1000 });
  const component = sandbox.AE64GamepadStudio.mount(root, { getTransport: () => current, onConnect: async () => { current = connectTarget; }, notify: (text, error) => notices.push({ text, error }), onBusy: (value) => { busy = value; } });
  return { html, nodes, component, root, notices, events, intervals, saved: () => saved, busy: () => busy, setTransport: (value) => { current = value; } };
}
module.exports = { fixture, Model, Protocol };
