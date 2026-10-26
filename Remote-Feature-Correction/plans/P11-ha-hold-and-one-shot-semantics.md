# P11 HA hold and one-shot semantics (D6)

Status: Proposed · Tier T3 · Area: ha-melodious (Option A), hub map generation (Option B) · Depends on: — · Blocks: P15

## Problem

On the Touch, any press held for 300 ms or more sends `hold` messages every 300 ms
(`LD/appscommon/harmony.lua:2435-2441`). For an IP device, the hub turns **each hold into
another POST with an identical body** (`activity.lua:697-699`; `ipmanager.lua:306-323`).
Release sends nothing (`ipmanager.lua:109-110`).

So a slightly slow tap on a soft button, or any held hard key, runs the HA action again:
- `toggle` flips twice;
- a script runs twice;
- `media_play_pause` and `mute` flip back;
- `press` presses twice.

Step actions (volume, brightness, speed) *want* repeats.

## Evidence

- Proven in source on both sides (corpus §05, §07).
- The 2026-10-24 spike saw held-key repeats arrive, confirming repeats on hardware. The exact
  count per hold from the Touch is unmeasured (P21 G4).

## Goal / Non-goals

- **Goal:** one-shot actions run once per press; step actions keep repeating while held.
- **Non-goal:** distinguishing press from hold inside HA (impossible: the bodies are
  identical, and there is no release).

## Design

**Option A, recommended first: debounce in HA.** No hub change, and it fixes every client
(Touch, web, app).
- Classify each command value:
  - **one-shot:** `toggle`, `turn_on`/`turn_off` for scripts and scenes, `press`,
    `media_play_pause`, `mute`, `open_cover`, `close_cover`, `select_source:*`, presets
    (P15);
  - **step:** `volume_up`/`down`, `brightness_up`/`down`, `increase_speed`/`decrease_speed`.
- For one-shot values, ignore a repeat of the same `(entity, value)` within a window that is
  re-armed by each repeat (700 ms; the Touch sends holds 300 ms apart). The press after a real
  release more than 700 ms later runs normally.
- `turn_on` and `turn_off` on lights and switches are idempotent; repeats are harmless but
  can be debounced too, to save calls.

**Option B, to evaluate: generate a self long-press for one-shot buttons.** This is a data
trick using stock hub logic (`activity.lua:1937-1963, 709-746`; `ipmanager.lua:306-309`):
- A button whose `ButtonLongPressAction` is set sends **nothing on press** and **no IP
  repeats**.
- Released before 550 ms, it runs the short action once as `fire`.
- Held, it runs the long action once.
- If the long action equals the short action, the effect is exactly one POST per press,
  however long it's held.

Costs:
- The action runs at **release**, which adds latency.
- If the release is lost (dropped while the Touch shows an activity-start popup, or RF loss),
  it never runs.
- The hub's long-press state is global, shared by all remotes.

Use it only for generated HA one-shot buttons (device screens, P13 activity controls),
behind a flag, after hardware measurement.

Recommendation:
- ship A;
- measure with P21 G4;
- evaluate B as an option for users who want one-shot behaviour enforced at the hub, for
  example for non-HA consumers of the same webhook.

## Work breakdown

1. Option A: `__init__.py` `run()` gets a debounce table keyed by `(entity, value)` with
   monotonic timestamps, and the classification in `devices.py`.
2. Option B (later): in `codexactivity.lua` `touchScreenMap`, a flag
   `oneShotLongPress=true` adds `ButtonLongPressAction` (EventType 2) equal to the press for
   commands the integration marks `oneShot` (a new optional field per command in the set).

## Local tests

- **A:** a fake clock: a 1 s hold at 300 ms cadence runs a one-shot once and a step 4 times;
  two taps 1 s apart run twice.
- **B:** a Lua test that the screen gets the self long press only for flagged commands, and
  the validator accepts it.

## Hardware gate (approval required)

1. P21 G4 first: measure the POST count for a 1 s hold on an HA soft button, before the fix.
2. After A: the same hold produces one service call (HA debug log), and a volume hold still
   ramps.
3. (B only) A flagged button: one POST per tap and per hold; the tap runs at release; check
   that latency is acceptable to the owner.

## Risks & rollback

- A: a rare deliberate double tap within 700 ms is merged. Acceptable for one-shots.
- Rollback: the integration release.

## Definition of done

- One-shots run once per press from the Touch; steps still repeat; documented in the README.

## Decisions

—
