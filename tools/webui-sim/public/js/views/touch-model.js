/* Harmony Touch screen model: an activity's on-screen buttons, read from and
   written back to its 16417Activity<id> map. Pure (no DOM, no network).
   The contract is docs/TOUCH_EDITOR.md: slots stay fixed unless the owner
   moves a button, and everything the editor doesn't own (number pad, hard
   buttons, gestures, Touch-only actions, sequences, unknown fields, key
   order) is carried through untouched. */

import { cloneJsonResource, createAllocator } from "../wizard-model.js";
import { validateMapList } from "./remote-model.js";

/** Long labels truncate on the Touch's screen (the Android editor's limit). */
export const LABEL_MAX = 24;

const NUMPAD_GROUP = 2;
const OWNED_ACTIONS = ["ButtonCommandAction", "ButtonSequenceAction", "ButtonActivityAction"];

export function touchMapIdentifier(activityId) {
  return `16417Activity${activityId}`;
}

const mapsOf = (config) => config?.mapList?.ButtonMaps ?? [];
const typeOf = (value) => (value && typeof value.__type === "string" ? value.__type : "");

function touchMap(config, activityId) {
  const identifier = touchMapIdentifier(activityId);
  return mapsOf(config).find((m) => m?.ButtonMapIdentifier === identifier) ?? null;
}

/* The map a new screen copies its surface and remote ids from: another
   activity's touch screen first, then any touch screen. */
function siblingMap(config) {
  const maps = mapsOf(config);
  return maps.find((m) => String(m?.ButtonMapIdentifier ?? "").startsWith("16417Activity"))
    ?? maps.find((m) => String(m?.ButtonMapIdentifier ?? "").startsWith("16417"))
    ?? null;
}

function isScreenButton(button) {
  return typeOf(button) === "SoftRemoteButton" && button.FunctionGroupType !== NUMPAD_GROUP;
}

/** What a button's press does, in the editor's terms. */
export function describeAction(action, map) {
  const type = typeOf(action);
  if (type.includes("ButtonCommandAction")) {
    return {
      kind: "command",
      deviceId: String(action["DeviceId-"]),
      command: String(action.CommandName ?? ""),
      functionId: action["FunctionId-"] ?? 0,
    };
  }
  if (type.includes("ButtonSequenceAction")) {
    const sequence = (Array.isArray(map?.Sequences) ? map.Sequences : [])
      .find((s) => String(s?.SequenceId) === String(action.SequenceId));
    return { kind: "sequence", sequenceId: String(action.SequenceId), name: String(sequence?.Name ?? "") };
  }
  if (type.includes("ButtonActivityAction")) {
    return { kind: "activity", activityId: String(action["ActivityId-"]) };
  }
  return { kind: "touch", type };
}

function owns(button) {
  return OWNED_ACTIONS.some((t) => typeOf(button.ButtonAction).includes(t));
}

/**
 * The activity's screen as an editor draft. `rows` are its on-screen
 * buttons in slot order; rows with `locked` (Touch-only actions such as
 * the number-pad toggle) keep their slot and can't be changed here.
 */
export function readTouchScreen(config, activityId) {
  const id = String(activityId);
  const map = touchMap(config, id);
  const buttons = Array.isArray(map?.Buttons) ? map.Buttons : [];
  const rows = buttons
    .filter(isScreenButton)
    .map((button) => ({
      key: `b${button.ButtonId}`,
      buttonId: button.ButtonId,
      slot: button.MenuItem?.IndexInMenu,
      label: String(button.TextOnRemote ?? ""),
      action: describeAction(button.ButtonAction, map),
      locked: !owns(button),
    }))
    .sort((a, b) => a.slot - b.slot);
  return {
    activityId: id,
    exists: Boolean(map),
    canCreate: Boolean(map || siblingMap(config)),
    rows,
    kept: {
      numberPad: buttons.filter((b) => typeOf(b) === "SoftRemoteButton" && b.FunctionGroupType === NUMPAD_GROUP).length,
      hardButtons: buttons.filter((b) => typeOf(b) === "HardRemoteButton").length,
      gestures: buttons.filter((b) => typeOf(b) === "GestureRemoteButton").length,
      sequences: Array.isArray(map?.Sequences) ? map.Sequences.length : 0,
    },
    base: JSON.stringify(map),
    nextKey: 1,
  };
}

/* -- Edits: each returns a new draft --------------------------------------- */

function copy(draft) {
  return { ...draft, rows: draft.rows.map((r) => ({ ...r, action: { ...r.action } })) };
}

function editable(draft, key) {
  const row = draft.rows.find((r) => r.key === key);
  if (!row) throw new Error("That button is no longer on this screen.");
  if (row.locked) throw new Error("That button runs on the Touch and can't be changed here.");
  return row;
}

export function cleanLabel(label) {
  return String(label ?? "").replace(/\s+/g, " ").trim().slice(0, LABEL_MAX);
}

/** The lowest slot no on-screen button uses (the number pad is separate). */
export function freeSlot(rows) {
  const used = new Set(rows.map((r) => r.slot));
  let slot = 0;
  while (used.has(slot)) slot += 1;
  return slot;
}

export function setLabel(draft, key, label) {
  const next = copy(draft);
  const text = cleanLabel(label);
  if (!text) throw new Error("A button needs a label.");
  editable(next, key).label = text;
  return next;
}

export function setCommand(draft, key, { deviceId, command, functionId }) {
  const next = copy(draft);
  editable(next, key).action = {
    kind: "command",
    deviceId: String(deviceId),
    command: String(command),
    functionId: functionId ?? 0,
  };
  return next;
}

/** A new button sending one command, in the lowest free slot. */
export function addButton(draft, { label, deviceId, command, functionId }) {
  const text = cleanLabel(label);
  if (!text) throw new Error("A button needs a label.");
  const next = copy(draft);
  next.rows.push({
    key: `n${next.nextKey}`,
    buttonId: null,
    slot: freeSlot(next.rows),
    label: text,
    action: { kind: "command", deviceId: String(deviceId), command: String(command), functionId: functionId ?? 0 },
    locked: false,
  });
  next.nextKey += 1;
  next.rows.sort((a, b) => a.slot - b.slot);
  return next;
}

/** Removing a button leaves its slot empty; no other button moves. */
export function removeButton(draft, key) {
  editable(draft, key);
  const next = copy(draft);
  next.rows = next.rows.filter((r) => r.key !== key);
  return next;
}

/** The nearest button the owner can move, `step` (-1 or 1) away in slot order. */
export function neighbourOf(draft, key, step) {
  const at = draft.rows.findIndex((r) => r.key === key);
  if (at < 0 || draft.rows[at].locked) return null;
  for (let i = at + step; i >= 0 && i < draft.rows.length; i += step) {
    if (!draft.rows[i].locked) return draft.rows[i];
  }
  return null;
}

/** Explicit reorder: the button and its movable neighbour swap slots. */
export function moveButton(draft, key, step) {
  const other = neighbourOf(draft, key, step);
  if (!other) return draft;
  const next = copy(draft);
  const row = next.rows.find((r) => r.key === key);
  const swap = next.rows.find((r) => r.key === other.key);
  [row.slot, swap.slot] = [swap.slot, row.slot];
  next.rows.sort((a, b) => a.slot - b.slot);
  return next;
}

/** Whether the draft differs from the screen it was read from. */
export function isChanged(config, draft) {
  const before = readTouchScreen(config, draft.activityId).rows;
  return JSON.stringify(before.map(rowShape)) !== JSON.stringify(draft.rows.map(rowShape));
}

function rowShape({ buttonId, slot, label, action }) {
  return { buttonId, slot, label, action };
}

/* New buttons get their ids on save, so compare what the screen shows. */
function screenShape({ slot, label, action }) {
  return { slot, label, action };
}

/**
 * After a save the hub didn't confirm, what the hub has now:
 * "saved" (the draft is on the hub), "unchanged" (the screen is as the
 * draft found it) or "changed" (something else). A save can land even when
 * the hub reports a failure, so the editor asks rather than assumes.
 */
export function saveOutcome(config, draft) {
  if (JSON.stringify(touchMap(config, draft.activityId)) === draft.base) return "unchanged";
  const now = readTouchScreen(config, draft.activityId).rows.map(screenShape);
  return JSON.stringify(now) === JSON.stringify(draft.rows.map(screenShape)) ? "saved" : "changed";
}

/* -- Writing the MapList ------------------------------------------------------ */

function harmonyDate(now) {
  return `/Date(${now}+0000)/`;
}

/* Logitech's key order for an on-screen command action. */
function commandAction({ deviceId, command, functionId }) {
  return {
    "DeviceId-": Number(deviceId),
    __type: "ButtonCommandAction",
    "FunctionId-": Number(functionId) || 0,
    Order: 0,
    CommandName: command,
    EventType: 0,
    Id: 0,
  };
}

function sameCommand(action, wanted) {
  return typeOf(action).includes("ButtonCommandAction")
    && String(action["DeviceId-"]) === wanted.deviceId
    && String(action.CommandName) === wanted.command
    && String(action["FunctionId-"] ?? 0) === String(wanted.functionId ?? 0);
}

/* Logitech's key order for an on-screen button. */
function newButton(row, activityId, buttonId) {
  return {
    FunctionGroupType: 0,
    ButtonImageKey: null,
    "ImageId-": 0,
    MenuItem: { IndexInMenu: row.slot, MenuName: `Activity.${activityId}` },
    ButtonId: buttonId,
    ButtonState: 1,
    ButtonAction: commandAction(row.action),
    TextOnRemote: row.label,
    __type: "SoftRemoteButton",
    ButtonImagePath: null,
    ButtonDoublePressAction: null,
    ButtonLongPressAction: null,
  };
}

/* A new screen copies the surface and remote ids from a sibling screen. */
function newMap(config, activityId, alloc) {
  const sibling = siblingMap(config);
  if (!sibling) throw new Error("This hub has no Harmony Touch screen to add buttons to.");
  return {
    "ButtonMapId-": alloc.mapId(),
    "ActivityId-": Number(activityId),
    Buttons: [],
    "ButtonMapSurfaceId-": sibling["ButtonMapSurfaceId-"] ?? null,
    __type: "ActivityButtonMap",
    "RemoteId-": sibling["RemoteId-"] ?? null,
    ButtonMapIdentifier: touchMapIdentifier(activityId),
    DateModified: null,
    Sequences: [],
    "SurfaceId-": sibling["SurfaceId-"] ?? null,
  };
}

/**
 * The hub's MapList with the draft written into the activity's touch map.
 * Every other map, and every button the editor doesn't own, is copied as
 * is; changed buttons keep their key order and unknown fields. Throws when
 * the screen changed on the hub since the draft was read, or when the
 * result would not pass validation.
 */
export function buildTouchMapList(config, draft, { now = Date.now() } = {}) {
  const activityId = draft.activityId;
  if (!(config?.activityList?.Activities ?? []).some((a) => String(a?.["Id-"]) === activityId)) {
    throw new Error("This activity isn't on the hub any more.");
  }
  if (JSON.stringify(touchMap(config, activityId)) !== draft.base) {
    throw new Error("This screen changed on the hub since you opened it. Reopen it to see the latest.");
  }
  const mapList = cloneJsonResource(config.mapList);
  const alloc = createAllocator(config);
  const identifier = touchMapIdentifier(activityId);
  let map = mapList.ButtonMaps.find((m) => m?.ButtonMapIdentifier === identifier);
  if (!map) {
    map = newMap(config, activityId, alloc);
    mapList.ButtonMaps.push(map);
  }
  const rowsById = new Map(draft.rows.filter((r) => r.buttonId != null).map((r) => [String(r.buttonId), r]));
  const buttons = [];
  for (const button of map.Buttons) {
    if (!isScreenButton(button) || !owns(button)) {
      buttons.push(button);
      continue;
    }
    const row = rowsById.get(String(button.ButtonId));
    if (!row) continue; // removed
    button.TextOnRemote = row.label;
    button.MenuItem.IndexInMenu = row.slot;
    if (row.action.kind === "command" && !sameCommand(button.ButtonAction, row.action)) {
      if (typeOf(button.ButtonAction).includes("ButtonCommandAction")) {
        button.ButtonAction["DeviceId-"] = Number(row.action.deviceId);
        button.ButtonAction.CommandName = row.action.command;
        button.ButtonAction["FunctionId-"] = Number(row.action.functionId) || 0;
      } else {
        button.ButtonAction = commandAction(row.action);
      }
    }
    buttons.push(button);
  }
  for (const row of draft.rows) {
    if (row.buttonId == null) buttons.push(newButton(row, activityId, alloc.id()));
  }
  map.Buttons = buttons;
  map.DateModified = harmonyDate(now);
  const errors = validateMapList(mapList);
  if (errors.length) throw new Error(`The new screen would not load on the Touch: ${errors[0]}`);
  return mapList;
}

/** The three resources for /api/activity-save; only MapList changes. The
    other two go back exactly as the hub sent them, never made up. */
export function touchSavePayload(config, draft, options) {
  if (!Array.isArray(config?.activityList?.Activities) || !Array.isArray(config?.functionList?.FunctionMaps)) {
    throw new Error("The hub's setup didn't load completely. Reload and try again.");
  }
  return {
    baseRevision: config.revision,
    activityList: cloneJsonResource(config.activityList),
    mapList: buildTouchMapList(config, draft, options),
    functionList: cloneJsonResource(config.functionList),
  };
}
