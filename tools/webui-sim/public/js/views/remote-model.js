/* Remote model: which command each remote key sends, for an activity or a
   single device. Pure (no DOM, no network), ported from the Melodious app
   (ActivityGraphBuilder.resolveActivityButtons / resolveActivitySoftButtons,
   FixIt, DomainIcons) so both remotes behave the same. */

import { BUTTON_KEY_BY_LABEL, REMOTE_BUTTONS, commandKey, matchCommand } from "../remote-layout.js";
import { readDeviceSettings } from "./device-settings-model.js";

/* Firmware ButtonKey for every key on the keypad, with the label people see.
   The physical remote's Back key is stored as PrevChannel in real MapLists. */
export const KEY_LABELS = Object.freeze({
  Rewind: "Rewind",
  Play: "Play",
  Pause: "Pause",
  FastForward: "Fast forward",
  Record: "Record",
  Stop: "Stop",
  Red: "Red",
  Green: "Green",
  Yellow: "Yellow",
  Blue: "Blue",
  Dvr: "DVR",
  Guide: "Guide",
  Info: "Info",
  Exit: "Exit",
  Menu: "Menu",
  DirectionUp: "Up",
  DirectionDown: "Down",
  DirectionLeft: "Left",
  DirectionRight: "Right",
  Select: "OK",
  VolumeUp: "Volume up",
  VolumeDown: "Volume down",
  VolumeMute: "Mute",
  PrevChannel: "Back",
  ChannelUp: "Channel up",
  ChannelDown: "Channel down",
  Number1: "1",
  Number2: "2",
  Number3: "3",
  Number4: "4",
  Number5: "5",
  Number6: "6",
  Number7: "7",
  Number8: "8",
  Number9: "9",
  Number0: "0",
  Dash: "–",
  Enter: "Enter",
});

const CANONICAL = new Map(Object.keys(KEY_LABELS).map((k) => [k.toLowerCase(), k]));

/** Stored ButtonKey -> keypad key ("DVR" and "Dvr" both appear in real maps). */
export function canonicalKey(buttonKey) {
  return CANONICAL.get(String(buttonKey ?? "").toLowerCase()) ?? null;
}

function actionOf(raw) {
  if (!raw || !raw.CommandName || raw["DeviceId-"] == null) return null;
  return {
    deviceId: String(raw["DeviceId-"]),
    command: String(raw.CommandName),
    functionId: raw["FunctionId-"] ?? null,
  };
}

const mapsOf = (config) => config?.mapList?.ButtonMaps ?? [];

const MAP_TYPES = ["DeviceButtonMap", "ActivityButtonMap", "RootButtonMap"];
const BUTTON_TYPES = ["HardRemoteButton", "SoftRemoteButton", "GestureRemoteButton"];
const ACTION_FIELDS = ["ButtonAction", "ButtonLongPressAction", "ButtonDoublePressAction"];

/**
 * Check a MapList against the shapes the hub's and the Touch's stock
 * button-map reader can load, mirroring the hub's validateGraph in
 * payload/activity/codexactivity.lua. Returns error strings; an empty
 * list means the MapList is safe to save. Device and activity references
 * are the hub's job and are not checked here. Duplicate on-screen slots
 * are rejected in activity maps only: device maps keep their existing
 * slots until the device screen editor sets their rule, and the number
 * pad (FunctionGroupType 2) is keyed separately from other soft buttons.
 */
export function validateMapList(mapList) {
  if (!mapList || !Array.isArray(mapList.ButtonMaps)) {
    return ["MapList.ButtonMaps must be an array"];
  }
  const errors = [];
  for (const map of mapList.ButtonMaps) {
    if (!map || typeof map !== "object" || Array.isArray(map)) {
      errors.push("MapList contains a non-object button map");
      continue;
    }
    const mapLabel = String(map.ButtonMapIdentifier ?? map["ButtonMapId-"] ?? "unknown");
    const mapType = typeof map.__type === "string" ? map.__type : "";
    const isActivityMap = mapType.includes("ActivityButtonMap");
    if (!MAP_TYPES.some((t) => mapType.includes(t))) {
      errors.push(`MapList map ${mapLabel} has an unknown or missing __type`);
    }
    if (!Array.isArray(map.Buttons)) {
      errors.push(`MapList map ${mapLabel} is missing its Buttons array`);
      continue;
    }
    const sequenceIds = new Set();
    if (map.Sequences !== undefined && map.Sequences !== null) {
      if (!Array.isArray(map.Sequences)) {
        errors.push(`MapList map ${mapLabel} has an invalid Sequences value`);
      } else {
        for (const sequence of map.Sequences) {
          if (!sequence || typeof sequence !== "object" || sequence.SequenceId == null) {
            errors.push(`MapList map ${mapLabel} has a sequence without a SequenceId`);
            continue;
          }
          const sequenceLabel = String(sequence.SequenceId);
          sequenceIds.add(sequenceLabel);
          if (!Array.isArray(sequence.Actions)) {
            errors.push(`MapList map ${mapLabel} sequence ${sequenceLabel} is missing its Actions array`);
            continue;
          }
          for (const step of sequence.Actions) {
            const stepType = step && typeof step === "object" && typeof step.__type === "string" ? step.__type : "";
            if (stepType.includes("ButtonCommandAction")) continue;
            if (stepType.includes("ButtonDelayAction")) {
              if (typeof step.Duration !== "number") {
                errors.push(`MapList map ${mapLabel} sequence ${sequenceLabel} has a delay step without a numeric Duration`);
              }
              continue;
            }
            errors.push(`MapList map ${mapLabel} sequence ${sequenceLabel} has a step with an unknown or missing __type`);
          }
        }
      }
    }
    const seenSlots = new Set();
    for (const button of map.Buttons) {
      if (!button || typeof button !== "object" || Array.isArray(button)) {
        errors.push(`MapList map ${mapLabel} contains a non-object button`);
        continue;
      }
      const buttonType = typeof button.__type === "string" ? button.__type : "";
      const isSoft = buttonType.includes("SoftRemoteButton");
      if (!BUTTON_TYPES.some((t) => buttonType.includes(t))) {
        errors.push(`MapList map ${mapLabel} has a button with an unknown or missing __type`);
        continue;
      }
      if (!isSoft && (typeof button.ButtonKey !== "string" || button.ButtonKey === "")) {
        errors.push(`MapList map ${mapLabel} button is missing ButtonKey`);
      }
      if (isSoft) {
        const index = button.MenuItem && typeof button.MenuItem === "object" ? button.MenuItem.IndexInMenu : undefined;
        if (!Number.isSafeInteger(index) || index < 0) {
          errors.push(`MapList map ${mapLabel} soft button has an invalid MenuItem.IndexInMenu`);
        } else if (isActivityMap) {
          const slotKey = `${button.FunctionGroupType === 2 ? "pad" : "soft"}:${index}`;
          if (seenSlots.has(slotKey)) {
            errors.push(`MapList map ${mapLabel} has duplicate IndexInMenu ${index} for on-screen buttons`);
          }
          seenSlots.add(slotKey);
        }
      }
      for (const field of ACTION_FIELDS) {
        const action = button[field];
        if (!action || typeof action !== "object") continue;
        const actionType = typeof action.__type === "string" ? action.__type : "";
        if (actionType.includes("ButtonSequenceAction") && !sequenceIds.has(String(action.SequenceId))) {
          errors.push(`MapList map ${mapLabel} button references missing sequence ${String(action.SequenceId)}`);
        }
      }
    }
  }
  return errors;
}

/** The activity's button maps, its own 16414 map first (as the app does). */
export function activityButtonMaps(config, activityId) {
  const id = String(activityId);
  const own = `16414Activity${id}`;
  return mapsOf(config)
    .filter((m) => m?.__type === "ActivityButtonMap" && String(m["ActivityId-"]) === id)
    .sort((a, b) => (a.ButtonMapIdentifier === own ? 0 : 1) - (b.ButtonMapIdentifier === own ? 0 : 1));
}

/** "PreviousTrack" -> "Previous Track"; labels with a space are left alone. */
export function humanizeLabel(raw) {
  const text = String(raw ?? "");
  return text.includes(" ") ? text : text.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/* On-screen (touch screen) buttons that send one command, in menu order.
   Sequences are skipped: the web does not run them yet. */
function touchButtons(config, activityId) {
  const id = String(activityId);
  const out = [];
  const seen = new Set();
  for (const map of mapsOf(config)) {
    if (String(map?.["ActivityId-"]) !== id) continue;
    if (!String(map?.ButtonMapIdentifier ?? "").startsWith("16417")) continue;
    for (const button of map.Buttons ?? []) {
      if (button?.__type !== "SoftRemoteButton") continue;
      if (button.ButtonAction?.__type !== "ButtonCommandAction") continue;
      const action = actionOf(button.ButtonAction);
      if (!action) continue;
      const dedupe = `${action.deviceId}:${action.command}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      out.push({
        label: humanizeLabel(String(button.TextOnRemote || action.command).trim()),
        action,
        order: Number(button.MenuItem?.IndexInMenu ?? Number.MAX_SAFE_INTEGER),
        digit: /^\d$/.test(action.command.trim()) ? action.command.trim() : null,
      });
    }
  }
  return out.sort((a, b) => a.order - b.order);
}

/** On-screen buttons for the "This activity" row (digits feed the number pad). */
export function softButtons(config, activityId) {
  return touchButtons(config, activityId)
    .filter((b) => b.digit === null)
    .map(({ label, action }) => ({ label, action }));
}

/**
 * Every keypad key an activity maps: key -> { key, label, press, hold }.
 * The first map that sets a key wins, own map first. Number keys fall back to
 * the activity's on-screen digit buttons, which many activities use instead.
 */
export function activityKeys(config, activityId) {
  const keys = new Map();
  for (const map of activityButtonMaps(config, activityId)) {
    for (const button of map.Buttons ?? []) {
      const key = canonicalKey(button?.ButtonKey);
      if (!key || keys.has(key)) continue;
      const press = actionOf(button.ButtonAction);
      if (!press) continue;
      keys.set(key, { key, label: KEY_LABELS[key], press, hold: actionOf(button.ButtonLongPressAction) });
    }
  }
  for (const button of touchButtons(config, activityId)) {
    const key = button.digit === null ? null : `Number${button.digit}`;
    if (!key || keys.has(key)) continue;
    keys.set(key, { key, label: KEY_LABELS[key], press: button.action, hold: null });
  }
  return keys;
}

/* Keypad keys for driving one device directly, matched by command name
   through the remote-layout aliases, as the hub's own IR page does, except
   that an exact name wins (see matchCommand). */
const DEVICE_KEY_BY_LABEL = { ...BUTTON_KEY_BY_LABEL, Dash: "Dash", Enter: "Enter" };

/** key -> { key, label, press } for a device from state.devices(). */
export function deviceKeys(device) {
  const keys = new Map();
  if (!device) return keys;
  for (const hotspot of REMOTE_BUTTONS) {
    const key = DEVICE_KEY_BY_LABEL[hotspot.label];
    if (!key || keys.has(key)) continue;
    const command = matchCommand(device.commands, hotspot.aliases);
    if (!command) continue;
    keys.set(key, {
      key,
      label: KEY_LABELS[key],
      press: { deviceId: device.id, command: command.name, functionId: command.functionId ?? null },
      hold: null,
    });
  }
  return keys;
}

/** True when a key really sends Home (activities often map Menu or Exit to it). */
export function sendsHome(keys, key) {
  return /home/i.test(keys.get(key)?.press?.command ?? "");
}

/* -- Activities and devices, as the app shows them ----------------------- */

/** An activity's roles in power-on order. */
export function activityRoles(activity) {
  return (activity?.Roles ?? [])
    .filter((r) => r?.["DeviceId-"] != null)
    .map((r) => ({
      deviceId: String(r["DeviceId-"]),
      roleType: String(r.__type || "DisplayActivityRole"),
      input: r.SelectedInput?.Name ? String(r.SelectedInput.Name) : null,
      powerOnOrder: Number(r.PowerOnOrder ?? 1),
    }))
    .sort((a, b) => a.powerOnOrder - b.powerOnOrder);
}

/** Device names taking part in an activity, in power-on order, no repeats. */
export function deviceNamesFor(activity, devices) {
  const byId = new Map(devices.map((d) => [d.id, d.name]));
  const names = [];
  for (const role of activityRoles(activity)) {
    const name = byId.get(role.deviceId);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

const ROLE_LABELS = {
  DisplayActivityRole: "Screen",
  VolumeActivityRole: "Sound / volume",
  PlayMovieActivityRole: "Plays movies & shows",
  PlayGameActivityRole: "Plays games",
  PlayMediaActivityRole: "Plays music",
  ChannelChangingActivityRole: "Changes channels",
  KeyboardTextEntryActivityRole: "Keyboard / typing",
};

/** The job a role does, phrased the way the app does. */
export function roleLabel(roleType) {
  return ROLE_LABELS[roleType] ?? String(roleType ?? "").replace(/ActivityRole$/, "");
}

/** Material icon name for an activity (DomainIcons.activityIcon). */
export function activityIconName(activity) {
  const name = String(activity?.Name ?? "").toLowerCase();
  if (name.includes("pc") || name.includes("computer")) return "computer";
  switch (Number(activity?.Type)) {
    case 1: return "tv";
    case 2: return "movie";
    case 3: return "sports_esports";
    case 4: return "music_note";
    default: return "play_arrow";
  }
}

const STREAMER_HINTS = ["shield", "google tv", "chromecast", "apple tv", "roku", "fire tv", "firestick"];

/** Material icon name for a device (DomainIcons.deviceIcon). */
export function deviceIconName(device) {
  const type = String(device?.typeLabel ?? device?.type ?? "").toLowerCase();
  const name = `${device?.name ?? ""} ${device?.model ?? ""}`.toLowerCase();
  if (STREAMER_HINTS.some((hint) => name.includes(hint))) return "cast";
  if (/television|tv|projector/.test(type)) return "tv";
  if (/amplifier|receiver|sound|speaker/.test(type)) return "speaker";
  if (/game|console/.test(type)) return "sports_esports";
  if (/computer|pc/.test(type)) return "computer";
  if (/media|stream/.test(type)) return "cast";
  if (/switch/.test(type)) return "settings_input_hdmi";
  if (/camera/.test(type)) return "videocam";
  if (device?.isBluetooth) return "bluetooth";
  return "tv";
}

/* -- Fix it -------------------------------------------------------------- */

const POWER_ON_KEYS = new Set(["poweron", "on"]);
const POWER_TOGGLE_KEYS = new Set(["powertoggle", "power"]);

/* "HDMI 2" -> the command that selects it: the device's own InputFeature
   mapping first, then the "Input" + name convention. */
function inputCommandFor(device, inputName) {
  const inputs = (device.entry?.DeviceFeatures ?? [])
    .flatMap((f) => (Array.isArray(f?.Inputs) ? f.Inputs : []));
  const actions = inputs.find((i) => i?.InputName === inputName)?.Actions;
  const mapped = (Array.isArray(actions) ? actions : []).find((a) => a?.IRCommandName)?.IRCommandName;
  const byName = (name) => device.commands.find((c) => c.name === name);
  if (mapped && byName(mapped)) return byName(mapped);
  const wanted = commandKey(inputName);
  if (!wanted) return null;
  return device.commands.find((c) => commandKey(c.name) === `input${wanted}`)
    ?? device.commands.find((c) => commandKey(c.name) === wanted)
    ?? null;
}

/**
 * Fix it: per device in an activity, the one command that turns it on and the
 * one that selects the activity's input. Configured power commands (the
 * device's PowerFeature) beat name guessing; a toggle is offered separately
 * because resending it can turn the device off.
 */
export function fixItDevices(activity, devices) {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const out = [];
  const seen = new Set();
  for (const role of activityRoles(activity)) {
    if (seen.has(role.deviceId)) continue;
    seen.add(role.deviceId);
    const device = byId.get(role.deviceId);
    if (!device) continue;
    const roles = activityRoles(activity).filter((r) => r.deviceId === role.deviceId);
    const named = (name) =>
      name ? device.commands.find((c) => c.name.toLowerCase() === String(name).toLowerCase()) ?? null : null;
    const settings = device.entry ? readDeviceSettings(device.entry) : null;
    const configured = settings?.hasPowerFeature ? settings.power : null;
    let powerOn = null;
    let powerToggle = null;
    if (configured) {
      if (configured.type === "discrete") powerOn = named(configured.on);
      if (configured.type === "toggle") powerToggle = named(configured.toggle);
    } else {
      powerOn = device.commands.find((c) => POWER_ON_KEYS.has(commandKey(c.name))) ?? null;
      powerToggle = device.commands.find((c) => POWER_TOGGLE_KEYS.has(commandKey(c.name))) ?? null;
    }
    const inputName = roles.find((r) => r.input)?.input ?? null;
    const inputCommand = inputName ? inputCommandFor(device, inputName) : null;
    if (!powerOn && !powerToggle && !inputCommand) continue;
    out.push({
      device,
      roles: [...new Set(roles.map((r) => roleLabel(r.roleType)))],
      powerOn,
      powerToggle: powerOn ? null : powerToggle,
      inputName,
      inputCommand,
    });
  }
  return out;
}
