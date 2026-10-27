/* Harmony Touch screen model: an activity's on-screen buttons, hard keys and
   gestures, read from and written back to its 16417Activity<id> map.
   Pure (no DOM, no network).
   The contract is docs/TOUCH_EDITOR.md: slots stay fixed unless the owner
   moves a button, and everything the editor doesn't own (number pad,
   Touch-only actions, sequences, unknown fields, key order) is carried
   through untouched.
   Press modes (P11, proven G3/G4/S1/S3/S5/S6):
   - standard: ButtonAction only (EventType 0), hold repeats (ramp/idempotent).
   - oneShot: ButtonLongPressAction == ButtonAction (EventType 2), fires
     exactly once at release (<600ms) or once at 2nd hold (>=600ms).
   - custom: ButtonLongPressAction is a distinct command (EventType 2). */

import { cloneJsonResource, createAllocator } from "../wizard-model.js";
import {
  GESTURE_KEYS,
  isOneShotCommand,
  recommendedPressMode,
  simulateGestureLookup,
  validateMapList,
} from "./remote-model.js";

export { GESTURE_KEYS, isOneShotCommand, recommendedPressMode, simulateGestureLookup };

/** Long labels truncate on the Touch's screen (the Android editor's limit). */
export const LABEL_MAX = 24;

const NUMPAD_GROUP = 2;
const OWNED_ACTIONS = ["ButtonCommandAction", "ButtonSequenceAction", "ButtonActivityAction"];

/** Hard keys the Touch answers (16417 spelling; no number keys, Dvr is DVR). */
export const TOUCH_HARD_KEYS = Object.freeze([
  "Blue", "ChannelDown", "ChannelUp", "DVR", "DirectionDown", "DirectionLeft",
  "DirectionRight", "DirectionUp", "Exit", "FastForward", "Green", "Guide",
  "Info", "Menu", "Pause", "Play", "PrevChannel", "Record", "Red", "Rewind",
  "Select", "Stop", "VolumeDown", "VolumeMute", "VolumeUp", "Yellow",
]);

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

function isHardButton(button) {
  return typeOf(button) === "HardRemoteButton";
}

function isGestureButton(button) {
  return typeOf(button) === "GestureRemoteButton";
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

function describeCommandAction(action) {
  if (!action || !typeOf(action).includes("ButtonCommandAction")) return null;
  if (action["DeviceId-"] == null || !action.CommandName) return null;
  return {
    kind: "command",
    deviceId: String(action["DeviceId-"]),
    command: String(action.CommandName ?? ""),
    functionId: action["FunctionId-"] ?? 0,
  };
}

function owns(button) {
  return OWNED_ACTIONS.some((t) => typeOf(button.ButtonAction).includes(t));
}

function sameCommandValue(a, b) {
  if (!a || !b || a.kind !== "command" || b.kind !== "command") return false;
  return String(a.deviceId) === String(b.deviceId)
    && String(a.command) === String(b.command)
    && String(a.functionId ?? 0) === String(b.functionId ?? 0);
}

function sameButtonAction(action, wanted) {
  return typeOf(action).includes("ButtonCommandAction")
    && String(action["DeviceId-"]) === String(wanted.deviceId)
    && String(action.CommandName) === String(wanted.command)
    && String(action["FunctionId-"] ?? 0) === String(wanted.functionId ?? 0);
}

/** Derive press mode from stored actions. Missing mode (old drafts) is undefined. */
function pressModeFromActions(shortAction, longAction) {
  const shortCmd = describeCommandAction(shortAction);
  const longCmd = describeCommandAction(longAction);
  if (!longCmd) return "standard";
  if (shortCmd && sameCommandValue(shortCmd, longCmd)) return "oneShot";
  return "custom";
}

/**
 * The activity's screen as an editor draft. `rows` are its on-screen
 * buttons in slot order; rows with `locked` (Touch-only actions such as
 * the number-pad toggle) keep their slot and can't be changed here.
 * Each editable row carries `pressMode` ('standard'|'oneShot'|'custom')
 * and `longPress` (command for custom, same-as-short for oneShot).
 */
export function readTouchScreen(config, activityId) {
  const id = String(activityId);
  const map = touchMap(config, id);
  const buttons = Array.isArray(map?.Buttons) ? map.Buttons : [];
  const rows = buttons
    .filter(isScreenButton)
    .map((button) => {
      const action = describeAction(button.ButtonAction, map);
      const locked = !owns(button);
      let pressMode;
      let longPress = null;
      if (!locked && action.kind === "command") {
        pressMode = pressModeFromActions(button.ButtonAction, button.ButtonLongPressAction);
        if (pressMode === "custom") {
          longPress = describeCommandAction(button.ButtonLongPressAction);
        } else if (pressMode === "oneShot") {
          longPress = { ...action };
        }
      } else if (!locked) {
        pressMode = button.ButtonLongPressAction ? "custom" : "standard";
        longPress = describeCommandAction(button.ButtonLongPressAction);
      }
      return {
        key: `b${button.ButtonId}`,
        buttonId: button.ButtonId,
        slot: button.MenuItem?.IndexInMenu,
        label: String(button.TextOnRemote ?? ""),
        action,
        pressMode,
        longPress,
        doublePress: button.ButtonDoublePressAction ?? null,
        locked,
      };
    })
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
  return {
    ...draft,
    rows: draft.rows.map((r) => ({
      ...r,
      action: { ...r.action },
      longPress: r.longPress ? { ...r.longPress } : null,
    })),
  };
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

function applyCommandWithMode(row, deviceId, command, functionId) {
  const action = {
    kind: "command",
    deviceId: String(deviceId),
    command: String(command),
    functionId: functionId ?? 0,
  };
  // Auto-select press mode: one-shot toggles default to self-long.
  if (row.pressMode === "custom") {
    row.action = action;
    // Keep the custom long as-is; if it now equals short, collapse to oneShot.
    if (row.longPress && sameCommandValue(row.longPress, action)) {
      row.pressMode = "oneShot";
    }
  } else if (isOneShotCommand(command)) {
    row.action = action;
    row.pressMode = "oneShot";
    row.longPress = { ...action };
  } else {
    row.action = action;
    row.pressMode = "standard";
    row.longPress = null;
  }
}

export function setCommand(draft, key, { deviceId, command, functionId }) {
  const next = copy(draft);
  const row = editable(next, key);
  if (row.action.kind !== "command" && row.locked !== true) {
    // Switching a sequence/activity button to a command resets press mode.
    row.action = { kind: "command", deviceId: String(deviceId), command: String(command), functionId: functionId ?? 0 };
    if (isOneShotCommand(command)) {
      row.pressMode = "oneShot";
      row.longPress = { ...row.action };
    } else {
      row.pressMode = "standard";
      row.longPress = null;
    }
    return next;
  }
  applyCommandWithMode(row, deviceId, command, functionId);
  return next;
}

/** Set press mode: 'standard' (repeats), 'oneShot' (self-long), 'custom' (separate long). */
export function setPressMode(draft, key, mode, longAction) {
  const next = copy(draft);
  const row = editable(next, key);
  if (row.action.kind !== "command") throw new Error("Press mode needs a device command first.");
  if (mode === "standard") {
    row.pressMode = "standard";
    row.longPress = null;
  } else if (mode === "oneShot") {
    row.pressMode = "oneShot";
    row.longPress = { ...row.action };
  } else if (mode === "custom") {
    if (!longAction?.deviceId || !longAction?.command) throw new Error("A long-press command needs a device and command.");
    row.pressMode = "custom";
    row.longPress = {
      kind: "command",
      deviceId: String(longAction.deviceId),
      command: String(longAction.command),
      functionId: longAction.functionId ?? 0,
    };
  } else {
    throw new Error(`Unknown press mode ${mode}.`);
  }
  return next;
}

/** Set a distinct long-press command (implies custom mode, or oneShot when equal). */
export function setLongCommand(draft, key, { deviceId, command, functionId }) {
  const next = copy(draft);
  const row = editable(next, key);
  if (row.action.kind !== "command") throw new Error("Press mode needs a device command first.");
  const long = { kind: "command", deviceId: String(deviceId), command: String(command), functionId: functionId ?? 0 };
  if (sameCommandValue(long, row.action)) {
    row.pressMode = "oneShot";
  } else {
    row.pressMode = "custom";
  }
  row.longPress = long;
  return next;
}

/** Clear a custom long-press back to standard (hold repeats). */
export function clearLongCommand(draft, key) {
  return setPressMode(draft, key, "standard");
}

/** A new button sending one command, in the lowest free slot.
 *  One-shot commands default to self-long (P11). */
export function addButton(draft, { label, deviceId, command, functionId, pressMode, longPress }) {
  const text = cleanLabel(label);
  if (!text) throw new Error("A button needs a label.");
  const next = copy(draft);
  const action = { kind: "command", deviceId: String(deviceId), command: String(command), functionId: functionId ?? 0 };
  let mode = pressMode ?? recommendedPressMode(command);
  let long = null;
  if (mode === "oneShot") long = { ...action };
  else if (mode === "custom" && longPress) {
    long = {
      kind: "command",
      deviceId: String(longPress.deviceId),
      command: String(longPress.command),
      functionId: longPress.functionId ?? 0,
    };
    if (sameCommandValue(long, action)) mode = "oneShot";
  } else if (mode === "custom") {
    // Custom without a long is just one-shot to the same command.
    mode = "oneShot";
    long = { ...action };
  }
  next.rows.push({
    key: `n${next.nextKey}`,
    buttonId: null,
    slot: freeSlot(next.rows),
    label: text,
    action,
    pressMode: mode,
    longPress: long,
    doublePress: null,
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

function rowShape({ buttonId, slot, label, action, pressMode, longPress }) {
  // Old drafts without pressMode compare equal to a standard row with no long.
  return { buttonId, slot, label, action, pressMode: pressMode ?? "standard", longPress: longPress ?? null };
}

/* New buttons get their ids on save, so compare what the screen shows. */
function screenShape({ slot, label, action, pressMode, longPress }) {
  return { slot, label, action, pressMode: pressMode ?? "standard", longPress: longPress ?? null };
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

/* -- Hard keys (16417Activity hard buttons, mirrored from 16414) ------------- */

export function readHardKeys(config, activityId) {
  const id = String(activityId);
  const map = touchMap(config, id);
  const buttons = Array.isArray(map?.Buttons) ? map.Buttons : [];
  const roleIds = new Set(
    (config?.activityList?.Activities ?? [])
      .find((a) => String(a?.["Id-"]) === id)?.Roles
      ?.map((r) => String(r?.["DeviceId-"])) ?? [],
  );
  const rows = buttons
    .filter(isHardButton)
    .map((button) => {
      const action = describeCommandAction(button.ButtonAction);
      const pressMode = pressModeFromActions(button.ButtonAction, button.ButtonLongPressAction);
      let longPress = describeCommandAction(button.ButtonLongPressAction);
      if (pressMode === "oneShot" && action) longPress = { ...action };
      if (pressMode === "standard") longPress = null;
      return {
        key: String(button.ButtonKey ?? ""),
        buttonId: button.ButtonId,
        buttonKey: String(button.ButtonKey ?? ""),
        action: action ?? { kind: "touch", type: typeOf(button.ButtonAction) },
        pressMode: action ? pressMode : undefined,
        longPress,
        doublePress: button.ButtonDoublePressAction ?? null,
        extra: action ? !roleIds.has(String(action.deviceId)) : false,
        locked: !action,
      };
    })
    .sort((a, b) => String(a.buttonKey).localeCompare(String(b.buttonKey)));
  return { activityId: id, exists: Boolean(map), rows, base: JSON.stringify(map) };
}

export function hardKeyIsExtra(config, activityId, deviceId) {
  const roles = (config?.activityList?.Activities ?? [])
    .find((a) => String(a?.["Id-"]) === String(activityId))?.Roles ?? [];
  const ids = new Set(roles.map((r) => String(r?.["DeviceId-"])));
  return !ids.has(String(deviceId));
}

/* -- Gestures (GestureRemoteButton in 16417Activity) -------------------------- */

export function readGestures(config, activityId) {
  const id = String(activityId);
  const map = touchMap(config, id);
  const buttons = Array.isArray(map?.Buttons) ? map.Buttons : [];
  const rows = buttons
    .filter(isGestureButton)
    .map((button) => ({
      key: String(button.ButtonKey ?? ""),
      gestureKey: String(button.ButtonKey ?? ""),
      buttonId: button.ButtonId,
      action: describeCommandAction(button.ButtonAction) ?? describeAction(button.ButtonAction, map),
      longPress: describeCommandAction(button.ButtonLongPressAction),
      doublePress: button.ButtonDoublePressAction ?? null,
      rawLong: button.ButtonLongPressAction ?? null,
      rawDouble: button.ButtonDoublePressAction ?? null,
    }))
    .sort((a, b) => GESTURE_KEYS.indexOf(a.gestureKey) - GESTURE_KEYS.indexOf(b.gestureKey));
  return { activityId: id, exists: Boolean(map), rows, base: JSON.stringify(map) };
}

export function gestureSimulation(config, activityId, gestureKey) {
  return simulateGestureLookup(config?.mapList, activityId, gestureKey);
}

/* -- Writing the MapList ------------------------------------------------------ */

function harmonyDate(now) {
  return `/Date(${now}+0000)/`;
}

/* Logitech's key order for an on-screen command action. */
function commandAction({ deviceId, command, functionId }, eventType = 0) {
  return {
    "DeviceId-": Number(deviceId),
    __type: "ButtonCommandAction",
    "FunctionId-": Number(functionId) || 0,
    Order: 0,
    CommandName: command,
    EventType: eventType,
    Id: 0,
  };
}

function sameCommand(action, wanted) {
  return typeOf(action).includes("ButtonCommandAction")
    && String(action["DeviceId-"]) === wanted.deviceId
    && String(action.CommandName) === wanted.command
    && String(action["FunctionId-"] ?? 0) === String(wanted.functionId ?? 0);
}

function longActionFor(row) {
  if (row.pressMode == null) return undefined; // old draft: leave hub value alone
  if (row.pressMode === "standard") return null;
  if (row.pressMode === "oneShot") return commandAction(row.action, 2);
  if (row.pressMode === "custom" && row.longPress) return commandAction(row.longPress, 2);
  return null;
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
    ButtonAction: commandAction(row.action, 0),
    TextOnRemote: row.label,
    __type: "SoftRemoteButton",
    ButtonImagePath: null,
    ButtonDoublePressAction: row.doublePress ?? null,
    ButtonLongPressAction: longActionFor(row) ?? null,
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
 * Hard keys and gestures pass through untouched here; use
 * buildTouchControlsMapList to write all three together.
 */
export function buildTouchMapList(config, draft, { now = Date.now() } = {}) {
  return buildTouchControlsMapList(config, { soft: draft }, { now });
}

/**
 * Write soft rows, hard keys and gestures together.
 * `edits` may contain { soft, hard, gestures } drafts; missing sections pass through.
 * - soft: draft from readTouchScreen (rows with pressMode/longPress).
 * - hard: { rows: [{ buttonKey, action, pressMode, longPress }] } or array; null buttonId adds.
 * - gestures: { rows: [{ gestureKey, action, longPress, doublePress }] }.
 * Hard-key edits stay in sync for the Touch map; the 16414 mirror is the
 * wizard's job (mirrorTouchHardButtons). Never writes ButtonHomeControlAction.
 */
export function buildTouchControlsMapList(config, edits, { now = Date.now() } = {}) {
  const softDraft = edits?.soft ?? edits;
  const hardEdits = edits?.hard ?? null;
  const gestureEdits = edits?.gestures ?? null;
  const activityId = softDraft.activityId ?? hardEdits?.activityId ?? gestureEdits?.activityId;
  if (!activityId) throw new Error("No activity for this Touch screen.");
  if (!(config?.activityList?.Activities ?? []).some((a) => String(a?.["Id-"]) === activityId)) {
    throw new Error("This activity isn't on the hub any more.");
  }
  const baseMap = touchMap(config, activityId);
  const baseText = softDraft.base ?? hardEdits?.base ?? gestureEdits?.base ?? JSON.stringify(baseMap);
  if (JSON.stringify(baseMap) !== baseText) {
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
  // --- soft rows ---
  if (softDraft?.rows) {
    const rowsById = new Map(softDraft.rows.filter((r) => r.buttonId != null).map((r) => [String(r.buttonId), r]));
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
          button.ButtonAction.EventType = 0;
        } else {
          button.ButtonAction = commandAction(row.action, 0);
        }
      } else if (row.action.kind === "command" && typeOf(button.ButtonAction).includes("ButtonCommandAction")) {
        button.ButtonAction.EventType = 0;
      }
      // Press mode: old drafts (pressMode == null) leave the hub value alone.
      if (row.pressMode != null) {
        button.ButtonLongPressAction = longActionFor(row);
        if (row.doublePress !== undefined && row.action.kind === "command") {
          // Preserve double-press unless the draft explicitly changed it.
          // Soft rows rarely use double-press; carry through.
        }
      }
      buttons.push(button);
    }
    for (const row of softDraft.rows) {
      if (row.buttonId == null) buttons.push(newButton(row, activityId, alloc.id()));
    }
    map.Buttons = buttons;
  }
  // --- hard keys ---
  if (hardEdits?.rows) {
    const byKey = new Map(hardEdits.rows.map((r) => [String(r.buttonKey || r.key), r]));
    const buttons = [];
    const seen = new Set();
    for (const button of map.Buttons) {
      if (!isHardButton(button)) {
        buttons.push(button);
        continue;
      }
      const key = String(button.ButtonKey ?? "");
      const row = byKey.get(key);
      if (!row) {
        // Removed hard key: drop it (explicit remove leaves no gap; keys are fixed).
        continue;
      }
      seen.add(key);
      if (row.action?.kind === "command") {
        if (typeOf(button.ButtonAction).includes("ButtonCommandAction")) {
          button.ButtonAction["DeviceId-"] = Number(row.action.deviceId);
          button.ButtonAction.CommandName = row.action.command;
          button.ButtonAction["FunctionId-"] = Number(row.action.functionId) || 0;
          button.ButtonAction.EventType = 1;
        } else {
          button.ButtonAction = commandAction(row.action, 1);
        }
        if (row.pressMode != null) {
          if (row.pressMode === "standard") button.ButtonLongPressAction = null;
          else if (row.pressMode === "oneShot") button.ButtonLongPressAction = commandAction(row.action, 2);
          else if (row.pressMode === "custom" && row.longPress) button.ButtonLongPressAction = commandAction(row.longPress, 2);
          if (row.doublePress !== undefined) button.ButtonDoublePressAction = row.doublePress;
        }
      }
      buttons.push(button);
    }
    for (const row of hardEdits.rows) {
      const key = String(row.buttonKey || row.key);
      if (seen.has(key) || !row.action || row.action.kind !== "command") continue;
      // New hard key: check if map already had it (should have been seen); else add.
      const exists = map.Buttons.some((b) => isHardButton(b) && String(b.ButtonKey) === key);
      if (exists) continue;
      buttons.push({
        ButtonId: alloc.id(),
        __type: "HardRemoteButton",
        ButtonAction: commandAction(row.action, 1),
        ButtonDoublePressAction: row.doublePress ?? null,
        FunctionGroupType: 0,
        ButtonState: 1,
        ButtonKey: key,
        ButtonLongPressAction: row.pressMode === "oneShot"
          ? commandAction(row.action, 2)
          : row.pressMode === "custom" && row.longPress
            ? commandAction(row.longPress, 2)
            : null,
      });
    }
    map.Buttons = buttons;
  }
  // --- gestures ---
  if (gestureEdits?.rows) {
    const byKey = new Map(gestureEdits.rows.map((r) => [String(r.gestureKey || r.key), r]));
    const buttons = [];
    const seen = new Set();
    for (const button of map.Buttons) {
      if (!isGestureButton(button)) {
        buttons.push(button);
        continue;
      }
      const key = String(button.ButtonKey ?? "");
      const row = byKey.get(key);
      if (!row) continue; // removed
      seen.add(key);
      if (row.action?.kind === "command") {
        if (typeOf(button.ButtonAction).includes("ButtonCommandAction")) {
          button.ButtonAction["DeviceId-"] = Number(row.action.deviceId);
          button.ButtonAction.CommandName = row.action.command;
          button.ButtonAction["FunctionId-"] = Number(row.action.functionId) || 0;
          button.ButtonAction.EventType = 0;
        } else {
          button.ButtonAction = commandAction(row.action, 0);
        }
      }
      if (row.longPress) button.ButtonLongPressAction = commandAction(row.longPress, 2);
      else if (row.longPress === null) button.ButtonLongPressAction = null;
      if (row.doublePress !== undefined) button.ButtonDoublePressAction = row.doublePress;
      // Gesture ButtonKey never changes; EventType stays 0 for press.
      buttons.push(button);
    }
    for (const row of gestureEdits.rows) {
      const key = String(row.gestureKey || row.key);
      if (seen.has(key)) continue;
      const exists = map.Buttons.some((b) => isGestureButton(b) && String(b.ButtonKey) === key);
      if (exists) continue;
      if (!row.action || row.action.kind !== "command") continue;
      buttons.push({
        ButtonId: alloc.id(),
        __type: "GestureRemoteButton",
        ButtonAction: commandAction(row.action, 0),
        ButtonDoublePressAction: row.doublePress ?? null,
        FunctionGroupType: 0,
        ButtonState: 1,
        ButtonKey: key,
        ButtonLongPressAction: row.longPress ? commandAction(row.longPress, 2) : null,
      });
    }
    map.Buttons = buttons;
  }
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
  const edits = draft?.soft || draft?.rows ? { soft: draft.rows ? draft : draft } : draft;
  return {
    baseRevision: config.revision,
    activityList: cloneJsonResource(config.activityList),
    mapList: buildTouchControlsMapList(config, edits, options),
    functionList: cloneJsonResource(config.functionList),
  };
}
