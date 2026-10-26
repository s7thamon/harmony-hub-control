# P06 Activity map mirror and editor parity

Status: Proposed · Tier T2 · Area: web advanced editor, web wizard, Android wizard and Touch editor · Depends on: P05 (soft) · Blocks: P13

## Problem

The same edit gives different MapLists depending on which editor made it.

| # | Defect | Where | Effect |
|---|---|---|---|
| 1 | The advanced editor (`#editor`) edits only the selected map and has **no 16414 → 16417 hard-key mirror** | `payload/web/activity-ui.js:1449-1470` | A hard-key edit doesn't reach the Touch. This is the original "16414 only" bug, still alive here. |
| 2 | The advanced editor writes soft-button presses with `EventType 1` | `activity-ui.js:1432-1470` | Genuine soft presses use 0. Harmless to the engine (it ignores `EventType` for commands), but not faithful. |
| 3 | The Android wizard always writes `ButtonDoublePressAction: null`, and its mirror then copies the null onto the Touch key | `ActivityGraphBuilder.kt:871, 516-532` | Double presses are destroyed on both maps |
| 4 | The Android wizard drafts from **all** activity maps (16414, then 16417, then 16420), first key wins | `ActivityGraphBuilder.kt:240-285`; `MelodiousViewModel.kt:1316` | Touch-only and keyboard keys (`DVR` and `Dvr` both) are written into 16414 |
| 5 | The Android Touch editor renumbers editable on-screen buttons into consecutive slots | `TouchScreenGraph.kt:160-183` | Breaks "saving never renumbers"; creates a stale-Touch window |
| 6 | The Android Touch editor silently deletes a command button that lacks `DeviceId-` or `CommandName` | `TouchScreenGraph.kt:92-100, 161, 181` | data loss |
| 7 | The web and Android wizards **drop mappings whose device is not an activity member**, and **fill unmapped keys with defaults on open** | `wizard-model.js:181-211`; `views/wizard.js:892` | A rename adds new mappings and mirrors them to the Touch. HA action devices can't sit on hard keys (P13). |
| 8 | The wizards re-issue every 16414 `ButtonId` and role `Id-` on every save | `wizard-model.js:314-335, 464-507` | Churn. Harmless to the engine [INF], but noisy for diffs and for any future ID-based tooling. |
| 9 | The mirror copies only keys changed by the current edit | `wizard-model.js:723-738` | An old 14/17 divergence is never repaired. Not seen in the live data (5/5 consistent). |

## Evidence

- All proven in source (Track C; corpus §12).
- Live data is consistent today, so these are latent until the affected editor is used.

## Goal / Non-goals

- **Goal:** every editor applies the same mirror, carry-through and slot rules, enforced by
  shared tests.
- **Non-goal:** merging the editors into one.

## Design

1. **One mirror function per platform**, with identical semantics. It is ported from the
   web wizard's `mirrorTouchHardButtons` (`wizard-model.js:669-756`):
   - `Dvr` becomes `DVR`;
   - number keys are skipped;
   - the Touch's ButtonId is kept;
   - long and double presses are carried.

   It should become part of P05's shared spec, so Android and the advanced editor match.
2. **Advanced editor:**
   - after `setButtonAction` on a 16414 hard key, apply the mirror to the sibling 16417 map;
   - soft presses get `EventType 0`.
3. **Android:**
   - add `doublePress` to the draft model (`HubModels.kt:143-151`) and carry it through;
   - draft only from the 16414 map, falling back to 16417 hard keys (mapped `DVR` → `Dvr`)
     only when 16414 is missing;
   - adopt the web Touch editor's slot rules (lowest free slot, swaps, gaps kept, never
     renumber);
   - keep malformed buttons as untouchable carried-through rows, the way the web editor
     treats Touch-only actions.
4. **Wizard membership and defaults:**
   - keep existing (`source=existing`) mappings even when their device isn't a member. Show
     them flagged as "extra control", and let P13 add the creation path;
   - apply defaults only on **new** activities, or on explicit "Reset keys", never silently
     on open.
5. **ID churn:** reuse ButtonIds by `ButtonKey` when rebuilding 16414, and role IDs by
   `(DeviceId-, role type)`.
6. **Optional repair:** a one-shot "Re-sync Touch hard keys" action in the activity ⋮ menu
   that mirrors every key. It is owner-triggered, never automatic.

## Work breakdown

1. `payload/web/activity-ui.js`: the mirror after a hard-key edit; soft `EventType 0`.
2. `tools/webui-sim/public/js/wizard-model.js`:
   - keep non-member existing mappings;
   - ButtonId reuse;
   - role ID reuse.
3. `tools/webui-sim/public/js/views/wizard.js`: no defaults on open for existing activities.
4. Android:
   - `ActivityGraphBuilder.kt` (double press, draft source, ID reuse);
   - `HubModels.kt` (draft model);
   - `TouchScreenGraph.kt` (slot rules, carry malformed rows);
   - `MelodiousViewModel.kt:1316`.
5. Shared fixture: `fixtures/synthetic-graph.json` plus a Logitech-style activity with a
   double press, `DVR`/`Dvr` and number keys.

## Local tests

- **Web:**
  - `wizard-model.test.mjs`: an unchanged save is byte-identical apart from intended fields;
    non-member mappings are kept; no defaults on open;
  - `touch-model.test.mjs` unchanged.
  - New `advanced-editor-mirror.test.mjs`.
- **Android:**
  - `TouchHardButtonsTest.kt` with a fixture that has a 16417 double press and `DVR` (it
    currently uses only the 16414 map, so it can't see defect 4);
  - a new `TouchScreenGraphSlotsTest.kt`;
  - a new `ActivityGraphDoublePressTest.kt`.
- **Cross-platform:** a shared JSON vector of "edit → expected MapList", run by both the web
  and Android tests.

## Hardware gate (approval required)

1. In a test activity created for the gate, edit one hard key in the advanced editor. The
   Touch key changes after the pull.
2. On a copy of a Logitech-style activity with a double press, make an Android wizard save.
   The double press survives on both maps (read the hub's MapList over SSH).
3. Revert or delete the test activities.

## Risks & rollback

- Defect 7's change alters wizard UX. Gate it behind the owner's agreement.
- Rollback: revert the PRs. Each platform is a separate PR.

## Definition of done

- The shared vectors pass on web and Android; the gate has passed; `docs/TOUCH_EDITOR.md`
  "What each editor owns" lists the advanced editor too.

## Open questions

- Should the advanced editor be retired in favour of the wizard plus the Touch editor?
  Owner decision. If yes, defects 1–2 become "remove".

## Decisions

—
