import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildTouchControlsMapList,
  controlsSaveOutcome,
  readGestures,
  readHardKeys,
  readTouchScreen,
  setLabel,
} from "../public/js/views/touch-model.js";

const load = () => {
  const raw = JSON.parse(readFileSync(new URL("../fixtures/activity-config.json", import.meta.url), "utf8"));
  const ids = new Set(raw.activityList.Activities.map((a) => String(a["Id-"])));
  raw.mapList.ButtonMaps = raw.mapList.ButtonMaps.filter((m) => m["ActivityId-"] == null || ids.has(String(m["ActivityId-"])));
  raw.functionList = {
    FunctionMaps: [...ids].map((id) => ({ __type: "ActivityFunctionMap", "ActivityId-": Number(id), FunctionGroups: [] })),
  };
  return raw;
};
const fixture = load();
const touchMapOf = (mapList, id) => mapList.ButtonMaps.find((m) => m.ButtonMapIdentifier === `16417Activity${id}`);
const isSoft = (b) => b.__type === "SoftRemoteButton" && b.FunctionGroupType !== 2;

/* An activity whose Touch map has on-screen rows, hard keys and gestures. */
const ACTIVITY = String(fixture.activityList.Activities.map((a) => a["Id-"]).find((id) => {
  const m = touchMapOf(fixture.mapList, id);
  return m?.Buttons.some(isSoft)
    && m.Buttons.some((b) => b.__type === "HardRemoteButton")
    && m.Buttons.some((b) => b.__type === "GestureRemoteButton");
}));

/* What the studio sends on Save: every tab's rows, as read. */
function studioEdits(config, soft) {
  return {
    soft: soft ?? readTouchScreen(config, ACTIVITY),
    hard: { rows: readHardKeys(config, ACTIVITY).rows },
    gestures: { rows: readGestures(config, ACTIVITY).rows },
  };
}

function withoutDate(map) {
  const { DateModified, ...rest } = map;
  void DateModified;
  return rest;
}

describe("studio save leaves untouched controls as they are", () => {
  it("has a fixture activity with rows, hard keys and gestures", () => {
    assert.notEqual(ACTIVITY, "undefined");
  });

  it("a save with no edits changes nothing but the date", () => {
    const before = touchMapOf(fixture.mapList, ACTIVITY);
    const after = touchMapOf(buildTouchControlsMapList(fixture, studioEdits(fixture)), ACTIVITY);
    assert.deepEqual(withoutDate(after), withoutDate(before));
  });

  it("renaming a row keeps every gesture's EventType and actions", () => {
    const before = touchMapOf(fixture.mapList, ACTIVITY);
    const soft = readTouchScreen(fixture, ACTIVITY);
    const row = soft.rows.find((r) => !r.locked);
    const edited = setLabel(soft, row.key, "Renamed");
    const after = touchMapOf(buildTouchControlsMapList(fixture, studioEdits(fixture, edited)), ACTIVITY);
    const gestures = (map) => map.Buttons.filter((b) => b.__type === "GestureRemoteButton");
    assert.ok(gestures(before).length > 0);
    assert.deepEqual(gestures(after), gestures(before));
    assert.ok(gestures(after).every((b) => b.ButtonAction.EventType === 1));
  });

  it("re-pointing a gesture keeps its EventType; a new gesture uses EventType 1", () => {
    const edits = studioEdits(fixture);
    const first = edits.gestures.rows[0];
    edits.gestures.rows = edits.gestures.rows.map((r) => (r === first
      ? { ...r, action: { kind: "command", deviceId: r.action.deviceId, command: "PowerOn", functionId: 0 } }
      : r));
    const map = touchMapOf(fixture.mapList, ACTIVITY);
    const missing = ["SwipeUp", "SwipeDown", "SwipeLeft", "SwipeRight", "Tap"]
      .find((k) => !map.Buttons.some((b) => b.__type === "GestureRemoteButton" && b.ButtonKey === k));
    if (missing) {
      edits.gestures.rows.push({ gestureKey: missing, buttonId: null, action: { kind: "command", deviceId: first.action.deviceId, command: "PowerOff", functionId: 0 }, longPress: null, doublePress: null });
    }
    const after = touchMapOf(buildTouchControlsMapList(fixture, edits), ACTIVITY);
    const changed = after.Buttons.find((b) => b.__type === "GestureRemoteButton" && b.ButtonKey === first.gestureKey);
    assert.equal(changed.ButtonAction.CommandName, "PowerOn");
    assert.equal(changed.ButtonAction.EventType, 1);
    if (missing) {
      const added = after.Buttons.find((b) => b.__type === "GestureRemoteButton" && b.ButtonKey === missing);
      assert.equal(added.ButtonAction.EventType, 1);
    }
  });

  it("keeps a long action the editor can't show (a sequence) on rows and hard keys", () => {
    const config = load();
    const map = touchMapOf(config.mapList, ACTIVITY);
    const sequenceLong = { __type: "ButtonSequenceAction", SequenceId: 4242, Order: 0 };
    map.Sequences = [...(map.Sequences ?? []), { SequenceId: 4242, Name: "Seq", Actions: [] }];
    const soft = map.Buttons.find((b) => isSoft(b) && b.ButtonAction?.__type === "ButtonCommandAction");
    const hard = map.Buttons.find((b) => b.__type === "HardRemoteButton" && b.ButtonAction?.__type === "ButtonCommandAction");
    soft.ButtonLongPressAction = { ...sequenceLong };
    hard.ButtonLongPressAction = { ...sequenceLong };
    const draft = readTouchScreen(config, ACTIVITY);
    const row = draft.rows.find((r) => r.buttonId === soft.ButtonId);
    const edited = setLabel(draft, row.key, "Renamed");
    const after = touchMapOf(buildTouchControlsMapList(config, studioEdits(config, edited)), ACTIVITY);
    assert.deepEqual(after.Buttons.find((b) => b.ButtonId === soft.ButtonId).ButtonLongPressAction, sequenceLong);
    assert.deepEqual(after.Buttons.find((b) => b.ButtonId === hard.ButtonId).ButtonLongPressAction, sequenceLong);
  });
});

describe("controlsSaveOutcome", () => {
  const sent = () => {
    const soft = readTouchScreen(fixture, ACTIVITY);
    const row = soft.rows.find((r) => !r.locked);
    return { base: soft.base, mapList: buildTouchControlsMapList(fixture, studioEdits(fixture, setLabel(soft, row.key, "Renamed"))) };
  };

  it("is unchanged when the hub still has the map the editor read", () => {
    const { base, mapList } = sent();
    assert.equal(controlsSaveOutcome(fixture, ACTIVITY, base, mapList), "unchanged");
  });

  it("is saved when the hub has what was sent, whatever its date", () => {
    const { base, mapList } = sent();
    const now = { ...fixture, mapList: JSON.parse(JSON.stringify(mapList)) };
    touchMapOf(now.mapList, ACTIVITY).DateModified = "/Date(1+0000)/";
    assert.equal(controlsSaveOutcome(now, ACTIVITY, base, mapList), "saved");
  });

  it("is changed when the hub has something else", () => {
    const { base, mapList } = sent();
    const now = load();
    touchMapOf(now.mapList, ACTIVITY).Buttons.find(isSoft).TextOnRemote = "Someone else";
    assert.equal(controlsSaveOutcome(now, ACTIVITY, base, mapList), "changed");
  });
});
