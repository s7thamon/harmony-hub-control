/* Power and timing settings for one device (the P1 settings editor).
   Pure data shaping, importable under node:test. The checks mirror
   codexactivity's CommitDeviceSettings so the UI refuses what the hub would;
   the hub re-checks everything against the device's own commands. */

export const SETTINGS_LIMITS = Object.freeze({
  interKeyDelayMs: [0, 5000],
  interDeviceDelayMs: [0, 10000],
  repeats: [0, 10],
  powerOnDelayMs: [0, 60000],
});

export const POWER_TYPES = Object.freeze([
  { value: "discrete", label: "Separate On and Off commands" },
  { value: "toggle", label: "One power button (toggle)" },
  { value: "none", label: "No power control (always on, or switched by hand)" },
]);

// PowerFeature.PowerTypeId: 0 not specified and 3 manual both mean the engine
// sends no power commands.
const TYPE_BY_ID = { 0: "none", 1: "discrete", 2: "toggle", 3: "none" };
const TYPE_ID = { none: 0, discrete: 1, toggle: 2 };

function powerFeature(entry) {
  const features = Array.isArray(entry?.DeviceFeatures) ? entry.DeviceFeatures : [];
  return features.find((f) => String(f?.__type ?? "").includes("PowerFeature")) ?? null;
}

function firstCommand(actions) {
  const action = (Array.isArray(actions) ? actions : []).find((a) => a?.IRCommandName);
  return action ? String(action.IRCommandName) : "";
}

function wholeNumber(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export function commandNames(entry) {
  return (Array.isArray(entry?.Commands) ? entry.Commands : [])
    .map((c) => String(c?.Name ?? ""))
    .filter(Boolean);
}

/* Best guesses for a device without a power feature, by command name. */
export function suggestPowerCommands(names) {
  const key = (name) => name.toLowerCase().replace(/[\s_-]+/g, "");
  const pick = (candidates) => {
    for (const candidate of candidates) {
      const hit = names.find((name) => key(name) === candidate);
      if (hit) return hit;
    }
    return "";
  };
  return {
    on: pick(["poweron", "discreteon", "on"]),
    off: pick(["poweroff", "discreteoff", "off"]),
    toggle: pick(["powertoggle", "power", "poweronoff", "onoff", "standby"]),
  };
}

function defaultPowerOnDelay(device) {
  return /television|projector/i.test(String(device?.DeviceTypeDisplayName ?? "")) ? 10000 : 2000;
}

export function readDeviceSettings(entry) {
  const device = entry?.Device ?? {};
  const feature = powerFeature(entry);
  const suggested = suggestPowerCommands(commandNames(entry));
  let type;
  if (feature) type = TYPE_BY_ID[Number(feature.PowerTypeId)] ?? "none";
  else if (suggested.on && suggested.off) type = "discrete";
  else type = suggested.toggle ? "toggle" : "none";
  return {
    hasPowerFeature: Boolean(feature),
    interKeyDelayMs: wholeNumber(device.InterKeyDelay, 100),
    interDeviceDelayMs: wholeNumber(device.InterDeviceDelay, 500),
    // The engine repeats 3 times when PressMinRepeats is missing.
    repeats: wholeNumber(device.PressMinRepeats, 3),
    power: {
      type,
      on: firstCommand(feature?.PowerOnActions) || suggested.on,
      off: firstCommand(feature?.PowerOffActions) || suggested.off,
      toggle: firstCommand(feature?.PowerToggleActions) || suggested.toggle,
      delayMs: wholeNumber(feature?.PowerOnDelay, defaultPowerOnDelay(device)),
      alwaysOn: feature?.IsPowerAlwaysOn === true,
      onBetweenActivities: feature?.IsPoweredOnBetweenActivities === true,
    },
  };
}

export function validateDeviceSettings(settings, names) {
  const errors = [];
  const has = new Set(names.map((n) => n.toLowerCase()));
  const range = (label, value, [low, high]) => {
    if (!Number.isInteger(value) || value < low || value > high) {
      errors.push(`${label} must be a whole number from ${low} to ${high}.`);
    }
  };
  range("Delay between commands (ms)", settings.interKeyDelayMs, SETTINGS_LIMITS.interKeyDelayMs);
  range("Inter-device delay (ms)", settings.interDeviceDelayMs, SETTINGS_LIMITS.interDeviceDelayMs);
  range("Repeats", settings.repeats, SETTINGS_LIMITS.repeats);
  const power = settings.power ?? {};
  const [, maxDelay] = SETTINGS_LIMITS.powerOnDelayMs;
  if (!Number.isInteger(power.delayMs) || power.delayMs < 0 || power.delayMs > maxDelay) {
    errors.push(`Power-on delay must be from 0 to ${maxDelay / 1000} seconds.`);
  }
  if (!(power.type in TYPE_ID)) errors.push("Choose how the device is powered.");
  if (power.type === "discrete") {
    if (!has.has(String(power.on ?? "").toLowerCase()) || !has.has(String(power.off ?? "").toLowerCase())) {
      errors.push("Choose an On and an Off command that the device has.");
    } else if (String(power.on).toLowerCase() === String(power.off).toLowerCase()) {
      errors.push("On and Off are the same command; choose one power button instead.");
    }
  }
  if (power.type === "toggle" && !has.has(String(power.toggle ?? "").toLowerCase())) {
    errors.push("Choose the device's power command.");
  }
  return errors;
}

/* Body for POST /api/device-settings. deviceId leads: the hub finds it by
   the first "deviceId" key. */
export function deviceSettingsRequest(deviceId, settings) {
  const power = settings.power;
  return {
    deviceId: String(deviceId),
    settings: {
      interKeyDelayMs: settings.interKeyDelayMs,
      interDeviceDelayMs: settings.interDeviceDelayMs,
      repeats: settings.repeats,
      power: {
        type: power.type,
        on: power.type === "discrete" ? power.on : null,
        off: power.type === "discrete" ? power.off : null,
        toggle: power.type === "toggle" ? power.toggle : null,
        delayMs: power.delayMs,
        alwaysOn: Boolean(power.alwaysOn),
        onBetweenActivities: Boolean(power.onBetweenActivities),
      },
    },
  };
}

/* What the hub writes: a copy of the DeviceList entry with the settings
   applied (the sim uses this; codexactivity does the same in Lua). */
export function applyDeviceSettings(entry, settings) {
  const next = structuredClone(entry);
  const names = commandNames(next);
  const stored = (name) => names.find((n) => n.toLowerCase() === String(name ?? "").toLowerCase()) ?? null;
  const press = (name) => (name ? [{ __type: "IRPressAction", IRCommandName: name, Order: 0, Duration: null, ActionId: 0 }] : []);
  const power = settings.power;
  next.Device.InterKeyDelay = settings.interKeyDelayMs;
  next.Device.InterDeviceDelay = settings.interDeviceDelayMs;
  next.Device.PressMinRepeats = settings.repeats;
  if (!Array.isArray(next.DeviceFeatures)) next.DeviceFeatures = [];
  let feature = powerFeature(next);
  if (!feature) {
    feature = { __type: "PowerFeature", "DeviceId-": next.Device["Id-"], Id: 0, State: 1 };
    next.DeviceFeatures.push(feature);
  }
  feature.PowerTypeId = TYPE_ID[power.type];
  feature.PowerOnActions = press(power.type === "discrete" ? stored(power.on) : null);
  feature.PowerOffActions = press(power.type === "discrete" ? stored(power.off) : null);
  feature.PowerToggleActions = press(power.type === "toggle" ? stored(power.toggle) : null);
  feature.PowerOnDelay = power.delayMs;
  if (typeof feature.DefaultPowerOnDelay !== "number") feature.DefaultPowerOnDelay = power.delayMs;
  feature.IsPowerAlwaysOn = Boolean(power.alwaysOn);
  feature.IsPoweredOnBetweenActivities = Boolean(power.onBetweenActivities);
  return next;
}
