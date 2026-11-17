"use strict";

const inactiveProfileStorageKey = (globalThis.AE64_STORAGE_PREFIX || "") + "inactive-profiles-v1";
const inactiveProfileDragType = "application/x-ae64-inactive-profile";

function inactiveProfiles() {
  const encoded = localStorage.getItem(inactiveProfileStorageKey);
  const entries = encoded === null ? [] : JSON.parse(encoded);
  if (!Array.isArray(entries) || entries.some((entry) => typeof entry?.id !== "string" || !entry.bundle?.firmware))
    throw new Error("The inactive profile library could not be read.");
  return entries;
}

function updateInactiveProfiles(edit) {
  localStorage.setItem(inactiveProfileStorageKey, JSON.stringify(edit(inactiveProfiles())));
}

function addInactiveProfile(bundle) {
  const record = { id: crypto.randomUUID(), bundle };
  updateInactiveProfiles((entries) => [...entries, record]);
  return record;
}

function removeInactiveProfile(id) {
  updateInactiveProfiles((entries) => entries.filter((entry) => entry.id !== id));
}

function inactiveProfileCanSwap(bundle) {
  const current = profileFirmwareIdentity();
  return current.family !== "unknown" && bundle.firmware.family === current.family &&
    bundle.firmware.baseVersion === current.baseVersion &&
    bundle.systemMode === Number(state.profile.settings.systemMode) &&
    (current.family !== "custom" || (profileHasCurves(current.version) && fnLightingAvailable() && profileMainRgbAvailable() &&
      Boolean(bundle.custom?.fnLighting && bundle.custom?.mainRgb && bundle.custom?.gamepad)));
}

async function saveInactiveProfile() {
  const slot = Number(state.profile.profileIndex);
  try {
    await withOnboardProfileRead("Saving inactive profile", slot, async (transport) => {
      const { bundle } = await readOnboardProfileBundle(transport, slot);
      addInactiveProfile(bundle);
      showToast(bundle.name + " saved in Inactive profiles.");
    });
  } catch (error) { showToast("Could not save the inactive profile. " + error.message, true); }
}

async function importInactiveProfile(file) {
  try {
    const bundle = parseProfileBundle(await readProfileFile(file));
    addInactiveProfile(bundle);
    render();
    showToast(bundle.name + " saved in Inactive profiles.");
  } catch (error) { showToast(error.message, true); }
}

async function swapInactiveProfile(id, slot) {
  if (!state.hardware.configIndexes.includes(slot)) return;
  let backup;
  try {
    const record = inactiveProfiles().find((entry) => entry.id === id);
    if (!record) throw new Error("That inactive profile is no longer in the library.");
    const incoming = parseProfileBundle(record.bundle);
    if (!inactiveProfileCanSwap(incoming)) throw new Error("This profile cannot swap onto the connected firmware in its current system mode.");
    await withOnboardProfileRead("Preparing profile swap", slot, async (transport) => {
      const target = await readOnboardProfileBundle(transport, slot);
      await stageProfileBundle(incoming, target, transport, slot, { swap: true, beforeStage: () => {
        if (!inactiveProfiles().some((entry) => entry.id === id)) throw new Error("That inactive profile was removed in another tab.");
        backup = addInactiveProfile(target.bundle);
      } });
    }, { switchSlot: true });
    if (pendingChangeCount() && !await applyChanges())
      throw new Error("The keyboard did not verify the swap. Both profiles are saved in the library.");
    removeInactiveProfile(id);
    showToast(incoming.name + " loaded in slot " + (slot + 1) + ". " + backup.bundle.name + " is now inactive.");
  } catch (error) {
    showToast(error.message, true);
  } finally { render(); }
}

function paintInactiveProfiles(panel) {
  const section = document.createElement("section");
  section.className = "panel reloaded-inactive-profiles";
  section.innerHTML = '<div class="panel-head"><div><h2>Inactive profiles</h2><p>Stored in this browser. Drag a compatible profile onto an onboard slot to swap it.</p></div>' +
    '<div class="inactive-profile-actions"><button class="button ghost small" type="button" data-save-inactive data-keyboard-input="allow">Save active profile</button>' +
    '<button class="button ghost small" type="button" data-import-inactive data-keyboard-input="allow">Add JSON</button>' +
    '<input type="file" accept=".json,application/json" data-inactive-file hidden></div></div>' +
    '<div class="inactive-profile-list"></div>';
  panel.after(section);
  const list = section.querySelector(".inactive-profile-list"), save = section.querySelector("[data-save-inactive]"), file = section.querySelector("[data-inactive-file]");
  save.disabled = !connected() || toolOperationBusy() || Boolean(pendingChangeCount());
  if (connected() && pendingChangeCount()) save.title = "Apply or revert your changes first.";
  save.addEventListener("click", saveInactiveProfile);
  section.querySelector("[data-import-inactive]").addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const [selected] = file.files;
    file.value = "";
    if (selected) await importInactiveProfile(selected);
  });

  let entries;
  try { entries = inactiveProfiles(); }
  catch (error) {
    list.textContent = error.message;
    return;
  }
  if (!entries.length) {
    list.innerHTML = '<p class="inactive-profile-empty">Save the active onboard profile or add a profile JSON to start your library.</p>';
    return;
  }
  const slots = reloadedProfileSlots(), names = state.hardware.configNames;
  for (const { id, bundle } of entries) {
    const eligible = inactiveProfileCanSwap(bundle);
    const enabled = eligible && !toolOperationBusy() && !pendingChangeCount();
    const card = document.createElement("article");
    card.className = "reloaded-profile-card inactive-profile-card";
    card.dataset.inactiveProfile = id;
    card.draggable = enabled;
    card.innerHTML = '<span class="reloaded-profile-icon" aria-hidden="true">⌨</span>' +
      '<span class="reloaded-profile-label"><b>' + esc(bundle.name) + '</b><small class="profile-firmware">' + esc(profileFirmwareLabel(bundle.firmware)) + '</small></span>' +
      '<div class="inactive-profile-actions">' +
      (eligible ? '<select data-inactive-slot data-keyboard-input="allow" aria-label="Destination for ' + esc(bundle.name) + '" ' + (enabled ? '' : 'disabled') + '>' +
        slots.map((slot) => '<option value="' + slot + '"' + (slot === Number(state.profile.profileIndex) ? ' selected' : '') + '>Slot ' + (slot + 1) +
          ' · ' + esc(names[slot] || 'Profile ' + (slot + 1)) + '</option>').join("") +
        '</select><button class="button ghost small" type="button" data-inactive-swap data-keyboard-input="allow" ' + (enabled ? '' : 'disabled') + '>Swap</button>'
        : '<small class="inactive-profile-compat">' + (connected() ? "Unavailable for this firmware or system mode" : "Connect a compatible keyboard to swap") + '</small>') +
      '<button class="button ghost small" type="button" data-inactive-download data-keyboard-input="allow" aria-label="Download ' + esc(bundle.name) + ' as JSON">Download JSON</button>' +
      '<button class="button ghost small inactive-profile-delete" type="button" data-inactive-delete data-keyboard-input="allow" aria-label="Delete ' + esc(bundle.name) + '">Delete</button></div>' +
      (enabled ? '<span class="reloaded-profile-grip" aria-hidden="true">⠿</span>' : "");
    card.querySelector("[data-inactive-download]").addEventListener("click", () => downloadJson(profileFileName(bundle.name), bundle));
    card.querySelector("[data-inactive-delete]").addEventListener("click", () => {
      if (toolOperationBusy()) return;
      try { removeInactiveProfile(id); render(); showToast(bundle.name + " removed from Inactive profiles."); }
      catch (error) { showToast(error.message, true); }
    });
    card.querySelector("[data-inactive-swap]")?.addEventListener("click", () => swapInactiveProfile(id, Number(card.querySelector("[data-inactive-slot]").value)));
    card.addEventListener("dragstart", (event) => {
      if (!enabled || toolOperationBusy() || event.target.closest("button, select")) return event.preventDefault();
      event.dataTransfer.setData(inactiveProfileDragType, id);
      event.dataTransfer.effectAllowed = "move";
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      panel.querySelector(".drop-target")?.classList.remove("drop-target");
    });
    list.append(card);
  }
}

window.addEventListener("storage", (event) => {
  if ((event.key === inactiveProfileStorageKey || event.key === null) &&
      document.querySelector('[data-view="profiles"] .reloaded-inactive-profiles') && !toolOperationBusy()) render();
});
