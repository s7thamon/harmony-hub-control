import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SETTINGS_LIMITS,
  commandNames,
  suggestPowerCommands,
  readDeviceSettings,
  validateDeviceSettings,
  deviceSettingsRequest,
  applyDeviceSettings,
} from "../public/js/views/device-settings-model.js";

const FIXTURE = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../fixtures/activity-config.json"), "utf8"));
const device = (id) => structuredClone(
  FIXTURE.deviceList.DevicesWithFeatures.find((e) => String(e.Device["Id-"]) === id));
const LG = "74521691";
const AMP = "81897247";
const SHIELD = "66690268";
const BARE = "93111391";

function valid(over = {}) {
  return {
    interKeyDelayMs: 100,
    interDeviceDelayMs: 500,
    repeats: 1,
    ...over,
    power: {
      type: "discrete", on: "PowerOn", off: "PowerOff", toggle: "",
      delayMs: 10000, alwaysOn: false, onBetweenActivities: false,
      ...(over.power ?? {}),
    },
  };
}

describe("readDeviceSettings", () => {
  it("reads discrete power, delays and repeats from a cloud-made TV", () => {
    assert.deepEqual(readDeviceSettings(device(LG)), {
      hasPowerFeature: true,
      interKeyDelayMs: 100,
      interDeviceDelayMs: 500,
      repeats: 1,
      power: {
        type: "discrete", on: "PowerOn", off: "PowerOff", toggle: "PowerToggle",
        delayMs: 10000, alwaysOn: false, onBetweenActivities: false,
      },
    });
  });

  it("reads toggle power from the amp", () => {
    const s = readDeviceSettings(device(AMP));
    assert.equal(s.power.type, "toggle");
    assert.equal(s.power.toggle, "PowerToggle");
    assert.equal(s.power.delayMs, 2000);
  });

  it("keeps non-IR power actions (the console powers on with Home)", () => {
    const s = readDeviceSettings(device(SHIELD));
    assert.equal(s.power.type, "discrete");
    assert.equal(s.power.on, "Home");
    assert.equal(s.power.off, "Sleep");
    assert.equal(s.interKeyDelayMs, 0);
  });

  it("suggests settings for a device without a power feature", () => {
    const s = readDeviceSettings(device(BARE));
    assert.equal(s.hasPowerFeature, false);
    assert.equal(s.power.type, "toggle");
    assert.equal(s.power.toggle, "Power");
    assert.equal(s.repeats, 3);
  });

  it("defaults the repeats to the engine's 3 when the device has none", () => {
    const entry = device(BARE);
    delete entry.Device.PressMinRepeats;
    assert.equal(readDeviceSettings(entry).repeats, 3);
  });
});

describe("suggestPowerCommands", () => {
  it("matches common spellings, preferring the explicit power names", () => {
    assert.deepEqual(suggestPowerCommands(["POWER ON", "Power_Off", "POWER"]),
      { on: "POWER ON", off: "Power_Off", toggle: "POWER" });
    assert.deepEqual(suggestPowerCommands(["On", "Off", "Standby"]),
      { on: "On", off: "Off", toggle: "Standby" });
    assert.deepEqual(suggestPowerCommands(["VolumeUp"]), { on: "", off: "", toggle: "" });
  });
});

describe("validateDeviceSettings", () => {
  const names = commandNames(device(LG));

  it("accepts settings the hub would accept", () => {
    assert.deepEqual(validateDeviceSettings(valid(), names), []);
    assert.deepEqual(validateDeviceSettings(valid({ power: { type: "toggle", toggle: "powertoggle" } }), names), []);
    assert.deepEqual(validateDeviceSettings(valid({ power: { type: "none", on: "", off: "" } }), names), []);
  });

  it("rejects commands the device lacks and On equal to Off", () => {
    assert.match(validateDeviceSettings(valid({ power: { on: "Nope" } }), names)[0], /On and an Off/);
    assert.match(validateDeviceSettings(valid({ power: { off: "poweron" } }), names)[0], /same command/);
    assert.match(validateDeviceSettings(valid({ power: { type: "toggle", toggle: "" } }), names)[0], /power command/);
    assert.match(validateDeviceSettings(valid({ power: { type: "sometimes" } }), names)[0], /how the device is powered/);
  });

  it("enforces the hub's ranges and whole numbers", () => {
    const [, maxKey] = SETTINGS_LIMITS.interKeyDelayMs;
    assert.equal(validateDeviceSettings(valid({ interKeyDelayMs: maxKey + 1 }), names).length, 1);
    assert.equal(validateDeviceSettings(valid({ interDeviceDelayMs: -1 }), names).length, 1);
    assert.equal(validateDeviceSettings(valid({ repeats: 1.5 }), names).length, 1);
    assert.equal(validateDeviceSettings(valid({ repeats: Number.NaN }), names).length, 1);
    assert.match(validateDeviceSettings(valid({ power: { delayMs: 60001 } }), names)[0], /0 to 60 seconds/);
  });
});

describe("deviceSettingsRequest", () => {
  it("leads with deviceId and only sends the commands the power type uses", () => {
    const body = deviceSettingsRequest(81897247, valid({ power: { type: "toggle", toggle: "PowerToggle" } }));
    assert.deepEqual(Object.keys(body), ["deviceId", "settings"]);
    assert.equal(body.deviceId, "81897247");
    assert.deepEqual(body.settings.power, {
      type: "toggle", on: null, off: null, toggle: "PowerToggle",
      delayMs: 10000, alwaysOn: false, onBetweenActivities: false,
    });
  });
});

describe("applyDeviceSettings", () => {
  it("adds a power feature to a bare device, using the stored command spelling", () => {
    const before = device(BARE);
    const after = applyDeviceSettings(before, valid({ power: { type: "toggle", toggle: "power", delayMs: 3000 } }));
    const feature = after.DeviceFeatures.find((f) => f.__type === "PowerFeature");
    assert.equal(feature.PowerTypeId, 2);
    assert.deepEqual(feature.PowerToggleActions.map((a) => a.IRCommandName), ["Power"]);
    assert.deepEqual(feature.PowerOnActions, []);
    assert.equal(feature.PowerOnDelay, 3000);
    assert.equal(before.DeviceFeatures.length, 0, "input entry is not mutated");
  });

  it("round-trips through readDeviceSettings", () => {
    const settings = valid({ repeats: 2, power: { alwaysOn: true, onBetweenActivities: true, delayMs: 8000 } });
    const read = readDeviceSettings(applyDeviceSettings(device(LG), settings));
    assert.equal(read.repeats, 2);
    assert.equal(read.power.delayMs, 8000);
    assert.equal(read.power.alwaysOn, true);
    assert.equal(read.power.onBetweenActivities, true);
    assert.equal(read.power.on, "PowerOn");
  });

  it("keeps the cloud feature's other fields", () => {
    const after = applyDeviceSettings(device(AMP), valid({ power: { type: "toggle", toggle: "PowerToggle" } }));
    const feature = after.DeviceFeatures.find((f) => f.__type === "PowerFeature");
    assert.equal(feature["GlobalDeviceVersionId-"], 625762);
    assert.equal(feature.DefaultPowerOnDelay, 2000);
    assert.equal(after.DeviceFeatures.length, 4);
  });
});
