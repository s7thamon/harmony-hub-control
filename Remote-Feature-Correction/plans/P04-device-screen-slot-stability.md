# P04 Stable device-screen slots

Status: Proposed · Tier T2 · Area: `payload/activity/codexactivity.lua` (`touchScreenMap`) · Depends on: — · Blocks: P17

## Problem

Hub-built Touch device screens (`16417Device<id>`, used by every HA device and by IR devices
rebuilt through ⋮ Make/Rebuild screen) number their on-screen buttons `0..n−1` **in command
order on every rebuild** (`codexactivity.lua:1486-1516`).

The Touch sends a soft press as **only an index**, and the hub resolves it against its
current map. So when a command is added, removed or reordered, every later button shifts.
Until the Touch syncs, a label runs its neighbour's command.

The integration makes this frequent: its merge puts current commands first, so a media player
that drops features while off reorders its commands (`ha-melodious devices.py:147-149`, D3 in
P10).

## Evidence

- Proven in source:
  - `touchScreenMap` assigns `IndexInMenu` sequentially;
  - ButtonIds are kept by `soft:<command>` (`:1440-1456`), but slots aren't.
- The stale window is proven (`docs/TOUCH_EDITOR.md`; corpus §04). Its length is normally
  seconds (publish → pull), longer if the Touch is asleep.

## Goal / Non-goals

- **Goal:** a command keeps its slot for as long as it exists on the device, which matches
  the activity-screen rule "saving never renumbers".
- **Non-goals:** user reordering of device screens (a future per-button editor); changing
  hard-key assignment (P05 owns that).

## Design

When `touchScreenMap(device, oldMap, template)` rebuilds:

1. Build `oldSlot[commandKey] = IndexInMenu` from the old map's `SoftRemoteButton`s with
   FGT 0, keyed by the lower-cased `CommandName`, the same key as the existing
   `soft:<command>` ButtonId reuse.
2. For each command that becomes a soft button:
   - if it has an `oldSlot`, keep that slot;
   - otherwise put it in the lowest index not used by any kept button.
3. A removed command leaves a gap. Gaps are valid.
4. **Compaction** happens only on explicit request (a future "Tidy screen" action), never
   implicitly.
5. Hard-key buttons are unaffected.
6. Order buttons in the `Buttons` array by slot, for readability. Neither the Touch nor the
   engine depends on array order for soft buttons, except that the later of two duplicates
   wins, and this design prevents duplicates.

Edge: the Touch's renderer puts soft buttons in a sparse Lua table and iterates with
`pairs()` (`LD/appscommon/harmony.lua:388-440`), so the order over **gaps** is not
guaranteed [INF].

- Option 1: accept gaps, and verify rendering order on hardware (gate step 2).
- Option 2: compact only when the Touch is known to be synced. That is not knowable on the
  hub.

Recommendation: Option 1, plus a hardware check. If gaps render out of order, add an
explicit owner-triggered compaction that is safe because the owner sees the result.

## Work breakdown

1. `codexactivity.lua`: in `touchScreenMap`, add `oldSlots(oldMap)` and change the slot
   assignment loop (`:1486-1506`).
2. Tests:
   - extend `tools/touch-validator/codexactivity-device-screens-test.lua`;
   - add fixture cases in `fixtures/synthetic-graph.json`.
3. Docs: `docs/TOUCH_EDITOR.md` "Device screens" paragraph (slots are now fixed);
   `docs/API.md` device-screen section.

## Local tests

- Rebuild with an unchanged set: byte-identical map (already covered).
- Add a command at the front: existing commands keep their indexes, and the new one takes
  the first free index.
- Remove a middle command: a gap appears, and the others don't move.
- Reorder the command list: no index changes.
- Validator still green; no duplicate indexes.

## Hardware gate (approval required)

This is P21 G8.
1. Pick an HA test device with at least 3 on-screen buttons. Add one command to its set
   through `tools/ha_devices.mjs apply`.
2. After the Touch pulls: the old buttons are in the same places and each sends its own
   command; the new one appears in a free slot. Note the rendering order if there's a gap.
3. Revert the set.

Stop if a label sends a different command after the pull.

## Risks & rollback

- Gap rendering order is the only unknown. The rollback is a set revert, then a PR revert
  (reboot needed for the plugin).

## Definition of done

- The tests are green, the gate has passed, and the docs are updated.

## Open questions

- Should the same rule apply to Melodious-made IR device screens rebuilt from ⋮? Yes. It is
  the same function.

## Decisions

—
