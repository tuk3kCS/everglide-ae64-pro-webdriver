"use strict";

// Wootility's categories, populated with AE64 keycodes that this driver can write.
const reloadedRemapIsExtended = ({ code }) => code === 50 || code === 100;
const reloadedRemapIsProfile = ({ code }) => code >= 0xf205 && code <= 0xf208;
const reloadedRemapGroups = [
  { id: "basic", label: "Basic Characters", keys: KEYCODE_GROUPS.keyboard.filter((key) => !reloadedRemapIsExtended(key)) },
  { id: "extended", label: "Extended Characters", keys: KEYCODE_GROUPS.keyboard.filter(reloadedRemapIsExtended) },
  { id: "functions", label: "Functions", keys: [...KEYCODE_GROUPS.firmware.filter((key) => !reloadedRemapIsProfile(key)), ...KEYCODE_GROUPS.lighting] },
  { id: "profiles", label: "Profiles", keys: KEYCODE_GROUPS.firmware.filter(reloadedRemapIsProfile) },
  { id: "media", label: "Media and Audio Control", keys: KEYCODE_GROUPS.media },
  { id: "mouse", label: "Mouse", keys: KEYCODE_GROUPS.mouse },
];
const reloadedRemapCodes = new Set(reloadedRemapGroups.flatMap(({ keys }) => keys.map(({ code }) => code)));
const reloadedRemapGlyphs = new Map([
  [79, "arrow-right"], [80, "arrow-left"], [81, "arrow-down"], [82, "arrow-up"],
  [0x206f, "display-brightness-up"], [0x2070, "display-brightness-down"],
  [0x20b5, "next-track"], [0x20b6, "previous-track"], [0x20b7, "stop-track"], [0x20cd, "play-pause"],
  [0x20e2, "mute"], [0x20e9, "volume-up"], [0x20ea, "volume-down"],
  [0x2183, "music"], [0x218a, "mail"], [0x2192, "calculator"], [0x2194, "computer"], [0x2223, "browser"],
  [0x4100, "mouse-left"], [0x4200, "mouse-right"], [0x4300, "mouse-middle"],
  [0x4400, "mouse-forward"], [0x4500, "mouse-back"],
  [0xf302, "lighting-brightness-up"], [0xf303, "lighting-brightness-down"],
]);
const reloadedRemapExpanded = new Set(["basic"]);
let reloadedRemapSearch = "";
let reloadedRemapScrollTop = 0;

function reloadedRemapIcon(name) {
  return name ? `<svg class="reloaded-remap-icon" aria-hidden="true" focusable="false"><use href="v2/remap-icons.svg#${name}"></use></svg>` : "";
}

function paintReloadedRemapCatalog(intro, board) {
  for (const key of board.querySelectorAll("[data-key]")) {
    const physical = keys[Number(key.dataset.key)];
    const code = displayedKeycode(physical);
    const glyph = reloadedRemapGlyphs.get(code);
    const mapped = key.querySelector(".mapped");
    if (glyph && mapped) {
      mapped.classList.add("reloaded-mapped-icon");
      mapped.innerHTML = reloadedRemapIcon(glyph);
      key.setAttribute("aria-label", `${physical.n}, ${keycodeLabel(code)}`);
    }
  }

  const catalog = document.createElement("section");
  catalog.className = "panel reloaded-key-catalog";
  catalog.innerHTML = `
    <div class="reloaded-remap-search">
      <input type="search" id="reloadedRemapSearch" placeholder="Search for a character" aria-label="Search keybinds" autocomplete="off">
      <button type="button" class="button ghost small" data-clear-catalog aria-label="Clear search" data-keyboard-input="allow">×</button>
    </div>
    <div class="reloaded-catalog-entries">
      ${reloadedRemapGroups.map(({ id, label, keys: bindings }) => `
        <section class="reloaded-remap-group" data-catalog-group="${id}">
          <h3><button type="button" data-keyboard-input="allow" data-expand-catalog aria-expanded="false" aria-controls="reloaded-catalog-${id}">
            <span class="reloaded-category-icon">${reloadedRemapIcon(id)}</span>${label}<span class="reloaded-catalog-chevron" aria-hidden="true"></span>
          </button></h3>
          <div id="reloaded-catalog-${id}" class="reloaded-group-body"><div>
            <div class="reloaded-keycodes">${bindings.map(({ code, label: name }) => {
              const icon = reloadedRemapIcon(reloadedRemapGlyphs.get(code));
              return `<button type="button" draggable="true" data-keyboard-input="allow" data-catalog-code="${code}" aria-label="${esc(name)}" title="${esc(name)}">${icon || esc(name)}</button>`;
            }).join("")}</div>
          </div></div>
        </section>`).join("")}
      <p class="reloaded-catalog-empty" role="status" hidden>No matching keys.</p>
    </div>`;
  intro.after(catalog);
  const input = catalog.querySelector("input");
  const clear = catalog.querySelector("[data-clear-catalog]");
  const entries = catalog.querySelector(".reloaded-catalog-entries");
  const groups = Array.from(entries.querySelectorAll("[data-catalog-group]"));
  input.value = reloadedRemapSearch;

  function updateCatalog() {
    const query = input.value.trim().toLowerCase();
    clear.hidden = !input.value;
    for (const group of groups) {
      const header = group.querySelector("[data-expand-catalog]");
      const matchesCategory = header.textContent.trim().toLowerCase().includes(query);
      const choices = Array.from(group.querySelectorAll("[data-catalog-code]"));
      for (const button of choices)
        button.hidden = Boolean(query) && !matchesCategory && !button.title.toLowerCase().includes(query);
      group.hidden = !choices.some((button) => !button.hidden);
      const expanded = Boolean(query) || reloadedRemapExpanded.has(group.dataset.catalogGroup);
      header.setAttribute("aria-expanded", String(expanded));
      header.setAttribute("aria-disabled", String(Boolean(query)));
      group.classList.toggle("expanded", expanded);
      group.querySelector(".reloaded-group-body").inert = !expanded;
    }
    entries.querySelector(".reloaded-catalog-empty").hidden = groups.some((group) => !group.hidden);
  }
  function assign(code, id) {
    if (toolOperationBusy() || !keys[id] || !reloadedRemapCodes.has(code)) return;
    state.profile.selected = id;
    state.selectedKeys = new Set([id]);
    applyMappingPickerKeycode(code);
  }
  function search() {
    reloadedRemapSearch = input.value;
    updateCatalog();
    entries.scrollTop = reloadedRemapScrollTop = 0;
  }
  input.addEventListener("input", search);
  clear.addEventListener("click", () => { input.value = ""; search(); input.focus(); });
  entries.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-expand-catalog]");
    if (toggle) {
      if (input.value.trim()) return;
      const id = toggle.closest("[data-catalog-group]").dataset.catalogGroup;
      if (reloadedRemapExpanded.has(id)) reloadedRemapExpanded.delete(id);
      else reloadedRemapExpanded.add(id);
      updateCatalog();
      return;
    }
    const code = event.target.closest("[data-catalog-code]")?.dataset.catalogCode;
    if (code !== undefined) assign(Number(code), selectedKey().id);
  });

  const dragType = "application/x-ae64-reloaded-keycode";
  let dropTarget = null;
  function highlight(target) {
    if (dropTarget === target) return;
    dropTarget?.classList.remove("remap-drop-target");
    dropTarget = target;
    dropTarget?.classList.add("remap-drop-target");
  }
  entries.addEventListener("dragstart", (event) => {
    const button = event.target.closest("[data-catalog-code]");
    if (!button || toolOperationBusy()) return;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(dragType, button.dataset.catalogCode);
    button.classList.add("dragging");
  });
  entries.addEventListener("dragend", () => {
    entries.querySelector(".dragging")?.classList.remove("dragging");
    highlight(null);
  });
  board.addEventListener("dragover", (event) => {
    if (!event.dataTransfer.types.includes(dragType)) return;
    const key = event.target.closest("[data-key]");
    highlight(key);
    if (!key) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  board.addEventListener("dragleave", (event) => {
    if (!board.contains(event.relatedTarget)) highlight(null);
  });
  board.addEventListener("drop", (event) => {
    const key = event.target.closest("[data-key]");
    const code = event.dataTransfer.getData(dragType);
    highlight(null);
    if (!key || code === "") return;
    event.preventDefault();
    assign(Number(code), Number(key.dataset.key));
  });
  updateCatalog();
  entries.scrollTop = reloadedRemapScrollTop;
  entries.addEventListener("scroll", () => { reloadedRemapScrollTop = entries.scrollTop; });
}
