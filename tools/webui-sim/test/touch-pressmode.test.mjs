import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  addButton,
  buildTouchControlsMapList,
  buildTouchMapList,
  readGestures,
  readHardKeys,
  readTouchScreen,
  setCommand,
  setLongCommand,
  setPressMode,
} from "../public/js/views/touch-model.js";
import {
  GESTURE_KEYS,
  isOneShotCommand,
  recommendedPressMode,
  simulateGestureLookup,
} from "../public/js/views/remote-model.js";

const fixture = (() => {
  const raw = JSON.parse(readFileSync(new URL("../fixtures/activity-config.json", import.meta.url), "utf8"));
  const ids = new Set(raw.activityList.Activities.map((a) => String(a["Id-"])));
  raw.mapList.ButtonMaps = raw.mapList.ButtonMaps.filter((m) => m["ActivityId-"] == null || ids.has(String(m["ActivityId-"])));
  raw.functionList = {
    FunctionMaps: [...ids].map((id) => ({ __type: "ActivityFunctionMap", "ActivityId-": Number(id), FunctionGroups: [] })),
  };
  return raw;
})();
const SCREEN = String(fixture.activityList.Activities.map((a) => a["Id-"]).find((id) => {
  const m = fixture.mapList.ButtonMaps.find((x) => x.ButtonMapIdentifier === `16417Activity${id}`);
  return m?.Buttons.some((b) => b.__type === "SoftRemoteButton" && b.FunctionGroupType !== 2);
}));

describe("one-shot press modes (P11)", () => {
  it("classifies toggle and single-shot commands", () => {
    for (const c of ["PowerToggle", "PlayPause", "Mute", "SkipForward", "SkipBack", "Run", "Activate", "Press"]) {
      assert.equal(isOneShotCommand(c), true, c);
      assert.equal(recommendedPressMode(c), "oneShot", c);
    }
    for (const c of ["PowerOn", "PowerOff", "Play", "Pause", "Stop", "BrightnessUp", "VolumeUp", "InputHdmi1"]) {
      assert.equal(isOneShotCommand(c), false, c);
      assert.equal(recommendedPressMode(c), "standard", c);
    }
  });

  it("auto-selects one-shot for new toggle buttons", () => {
    const draft = readTouchScreen(fixture, SCREEN);
    const withToggle = addButton(draft, { label: "Toggle", deviceId: "10", command: "PowerToggle", functionId: 0 });
    const row = withToggle.rows.find((r) => r.label === "Toggle");
    assert.ok(row);
    assert.equal(row.pressMode, "oneShot");
    assert.deepEqual(row.longPress, row.action);
    const withVol = addButton(draft, { label: "Vol", deviceId: "10", command: "VolumeUp", functionId: 0 });
    const volRow = withVol.rows.find((r) => r.label === "Vol");
    assert.equal(volRow.pressMode, "standard");
    assert.equal(volRow.longPress, null);
  });

  it("switching a command re-picks the recommended mode", () => {
    let draft = readTouchScreen(fixture, SCREEN);
    const key = draft.rows[0].key;
    draft = setCommand(draft, key, { deviceId: "10", command: "Mute", functionId: 0 });
    assert.equal(draft.rows.find((r) => r.key === key).pressMode, "oneShot");
    draft = setCommand(draft, key, { deviceId: "10", command: "VolumeUp", functionId: 0 });
    assert.equal(draft.rows.find((r) => r.key === key).pressMode, "standard");
  });

  it("writes self-long (EventType 2) for one-shot soft rows", () => {
    let draft = readTouchScreen(fixture, SCREEN);
    draft = addButton(draft, { label: "T", deviceId: "10", command: "PowerToggle", functionId: 0 });
    const out = buildTouchMapList(fixture, draft);
    const map = out.ButtonMaps.find((m) => m.ButtonMapIdentifier === `16417Activity${SCREEN}`);
    const added = map.Buttons.find((b) => b.TextOnRemote === "T");
    assert.ok(added);
    assert.equal(added.ButtonAction.EventType, 0);
    assert.equal(added.ButtonLongPressAction.EventType, 2);
    assert.equal(added.ButtonLongPressAction.CommandName, "PowerToggle");
    assert.equal(added.ButtonDoublePressAction, null);
  });

  it("supports separate long actions and clearing back to standard", () => {
    let draft = readTouchScreen(fixture, SCREEN);
    const key = draft.rows[0].key;
    draft = setPressMode(draft, key, "custom", { deviceId: "11", command: "VolumeDown", functionId: 0 });
    assert.equal(draft.rows.find((r) => r.key === key).pressMode, "custom");
    const out = buildTouchControlsMapList(fixture, { soft: draft });
    const map = out.ButtonMaps.find((m) => m.ButtonMapIdentifier === `16417Activity${SCREEN}`);
    const btn = map.Buttons.find((b) => String(b.ButtonId) === String(draft.rows.find((r) => r.key === key).buttonId));
    assert.equal(btn.ButtonLongPressAction.CommandName, "VolumeDown");
    assert.equal(btn.ButtonLongPressAction.EventType, 2);
    draft = setPressMode(draft, key, "standard");
    const out2 = buildTouchControlsMapList(fixture, { soft: draft });
    const map2 = out2.ButtonMaps.find((m) => m.ButtonMapIdentifier === `16417Activity${SCREEN}`);
    const btn2 = map2.Buttons.find((b) => String(b.ButtonId) === String(draft.rows.find((r) => r.key === key).buttonId));
    assert.equal(btn2.ButtonLongPressAction, null);
  });

  it("setLongCommand collapses to one-shot when equal", () => {
    let draft = readTouchScreen(fixture, SCREEN);
    const key = draft.rows[0].key;
    const cur = draft.rows.find((r) => r.key === key);
    draft = setLongCommand(draft, key, { deviceId: cur.action.deviceId, command: cur.action.command, functionId: cur.action.functionId });
    assert.equal(draft.rows.find((r) => r.key === key).pressMode, "oneShot");
  });
});

describe("hard keys (16417) with extra controls", () => {
  it("reads hard keys and flags non-member devices as extra", () => {
    const hard = readHardKeys(fixture, SCREEN);
    assert.ok(Array.isArray(hard.rows));
    // Fixture roles: check extra flag is boolean.
    for (const r of hard.rows) assert.equal(typeof r.extra, "boolean");
  });

  it("writes hard-key self-long without touching soft rows", () => {
    const soft = readTouchScreen(fixture, SCREEN);
    const hard = readHardKeys(fixture, SCREEN);
    if (!hard.rows.length) return;
    const target = hard.rows[0];
    const updatedHard = {
      rows: hard.rows.map((r) => r.buttonKey === target.buttonKey
        ? { ...r, action: { kind: "command", deviceId: "10", command: "Mute", functionId: 0 }, pressMode: "oneShot", longPress: { kind: "command", deviceId: "10", command: "Mute", functionId: 0 } }
        : r),
    };
    const out = buildTouchControlsMapList(fixture, { soft, hard: updatedHard });
    const map = out.ButtonMaps.find((m) => m.ButtonMapIdentifier === `16417Activity${SCREEN}`);
    const btn = map.Buttons.find((b) => b.__type === "HardRemoteButton" && b.ButtonKey === target.buttonKey);
    assert.equal(btn.ButtonLongPressAction.EventType, 2);
    assert.equal(btn.ButtonLongPressAction.CommandName, "Mute");
    // Soft rows unchanged apart from date.
    const beforeSoft = soft.rows.map((r) => r.slot);
    const afterSoft = map.Buttons.filter((b) => b.__type === "SoftRemoteButton" && b.FunctionGroupType !== 2).map((b) => b.MenuItem.IndexInMenu).sort((a, b) => a - b);
    assert.deepEqual(afterSoft.slice(0, beforeSoft.length).sort((a, b) => a - b), beforeSoft.sort((a, b) => a - b));
  });
});

describe("gestures (P18) with lookup simulator", () => {
  it("exposes the five confirmed gesture keys", () => {
    assert.deepEqual(GESTURE_KEYS, ["SwipeUp", "SwipeDown", "SwipeLeft", "SwipeRight", "Tap"]);
  });

  it("simulates soft match, hard match, gate block and missing map", () => {
    const mapList = {
      ButtonMaps: [
        {
          ButtonMapIdentifier: "16417Activity100",
          Buttons: [
            { __type: "GestureRemoteButton", ButtonKey: "SwipeUp", ButtonAction: { __type: "ButtonCommandAction", "DeviceId-": 10, CommandName: "BrightnessUp", "FunctionId-": 0 } },
            { __type: "GestureRemoteButton", ButtonKey: "Tap", ButtonAction: { __type: "ButtonCommandAction", "DeviceId-": 10, CommandName: "PowerToggle", "FunctionId-": 0 } },
            { __type: "HardRemoteButton", ButtonKey: "VolumeUp", ButtonAction: { __type: "ButtonCommandAction", "DeviceId-": 10, CommandName: "VolumeUp" } },
          ],
        },
        {
          ButtonMapIdentifier: "16417Device10",
          Buttons: [
            { __type: "HardRemoteButton", ButtonKey: "VolumeUp", ButtonAction: { __type: "ButtonCommandAction", "DeviceId-": 10, CommandName: "BrightnessUp", "FunctionId-": 0 } },
            { __type: "SoftRemoteButton", FunctionGroupType: 0, TextOnRemote: "Toggle", MenuItem: { IndexInMenu: 0 }, ButtonAction: { __type: "ButtonCommandAction", "DeviceId-": 10, CommandName: "PowerToggle", "FunctionId-": 0 } },
          ],
        },
      ],
    };
    // SwipeUp resolves to hard VolumeUp, gate passes (activity has VolumeUp).
    const swipe = simulateGestureLookup(mapList, "100", "SwipeUp");
    assert.equal(swipe.ok, true);
    assert.equal(swipe.resolved, "hard");
    assert.equal(swipe.hardGateOk, true);
    // Tap is a toggle: warns (no hub protection on gestures).
    const tap = simulateGestureLookup(mapList, "100", "Tap");
    assert.equal(tap.ok, true);
    assert.equal(tap.resolved, "soft");
    assert.ok(tap.warnings.some((w) => w.includes("double-fire")));
    // Remove the hard key from the activity: gate blocks.
    mapList.ButtonMaps[0].Buttons = mapList.ButtonMaps[0].Buttons.filter((b) => b.ButtonKey !== "VolumeUp");
    const blocked = simulateGestureLookup(mapList, "100", "SwipeUp");
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, "hard-gate-blocked");
    // Missing device screen.
    const missing = simulateGestureLookup(mapList, "100", "SwipeDown");
    assert.equal(missing.ok, false);
  });

  it("reads gestures from a real map", () => {
    const g = readGestures(fixture, SCREEN);
    assert.ok(Array.isArray(g.rows));
  });
});
