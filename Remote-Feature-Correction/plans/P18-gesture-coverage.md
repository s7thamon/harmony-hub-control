# P18 Gesture coverage

Status: Proposed · Tier T4 · Area: validators, device-screen builder, Touch editor (gestures slice) · Depends on: P07 · Blocks: —

## Problem

The Touch never sends a gesture to the hub as `SwipeUp`. It turns each gesture into a press of
a button in the **target device's** `16417Device<id>` map
(`LD/juniper/gesturepad.lua:121-139, 732-750`):

1. It reads the gesture's action from `16417Activity<cur>`. A hold falls back to the short
   action when no long action exists; a double tap uses `ButtonDoublePressAction`.
2. It looks up the action's device map, matching `FunctionId-` when that is above 0, else
   `CommandName` or `ButtonKey`.
3. If it finds a soft button, it sends `indexInMenu` plus `deviceId`. If it finds a hard
   button, it sends `buttonKey` plus `deviceId`, but only if that key is **also a hard key in
   the activity map** (the Touch's key gate, `harmony.lua:2400-2404`).
4. If nothing is found, nothing is sent. If the device has no map at all, a Lua error is
   likely [INF].

So a gesture works only if:
- the target device has a screen;
- the screen contains the command;
- for hard-key resolutions, the activity maps the same key.

The hub's stored `GestureRemoteButton` entries are never used by the Touch.

## Goal / Non-goals

- **Goal:**
  - every gesture Melodious lets a user assign actually works on the Touch;
  - existing gestures are checked.
- **Non-goal:** changing the Touch gesture code.

## Design

1. **Validator rule (P07, warning):** for each `GestureRemoteButton` action, simulate the
   Touch's lookup over the target device map. Warn on:
   - no map;
   - no matching button;
   - a hard-key resolution not present in the activity's hard keys.
2. **Builder:** the device-screen builder ensures that every command referenced by any
   activity gesture exists on that device's hub-built screen. It already includes every
   command, so this matters only for Logitech maps, which are never rebuilt. Report those
   instead.
3. **Touch editor gestures slice** (`docs/TOUCH_EDITOR.md` slice (c)):
   - offer only `SwipeUp/Down/Left/Right` and `Tap` (confirmed keys);
   - offer only commands that pass the simulation;
   - offer long (hold) and double (double tap), noting that the hub never runs
     `ButtonDoublePressAction` itself; the Touch resolves it locally.
4. **First prove the wire form** (P21 G1): a swipe arrives as a device-map press plus
   `deviceId`.

## Work breakdown

1. A shared simulation function (Lua and JS) implementing the lookup above.
2. The validator warning; a builder report for Logitech maps.
3. The gestures part of the Touch editor (after G1).

## Local tests

- Simulation vectors:
  - soft match by name;
  - `FunctionId-` > 0 match;
  - hard-key resolution blocked by the activity gate;
  - missing map.

## Hardware gate (approval required)

G1 in P21, then an editor round trip: assign SwipeUp to an HA light's BrightnessUp in a test
activity; the swipe runs it; revert.

## Decisions

—
