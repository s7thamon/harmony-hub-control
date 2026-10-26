# P13 HA action devices on activity keys without membership

Status: Proposed · Tier T3 · Area: web wizard, Android wizard, Touch editors · Depends on: P05, P06 · Blocks: —

## Problem

To put an HA action on a hard key in an activity today, the HA device must be an activity
**member** (it must have a role). The wizard drops any key mapping whose device isn't a member
(`tools/webui-sim/public/js/wizard-model.js:181-200`).

Membership means the activity powers the device:
- an HA light added just so a key can toggle it is switched **on** at activity start and
  **off** at the end;
- scripts, scenes and buttons have no power (`PowerTypeId 0`, `codexactivity.lua:1802`), so
  for them membership is harmless but conceptually wrong.

The Touch's on-screen editor already offers commands from **any** device, members ranked first
(`views/touch-screen.js:67-69`).

## Evidence

- The hub validator only requires that referenced devices exist; it doesn't require
  membership (corpus §14).
- The engine resolves `ButtonCommandAction` by `DeviceId-` and `CommandName` with no
  membership check (corpus §04).
- The live data has no non-member mappings, so stock acceptance by
  `harmony.engine?config` consumers (the app, HA's Harmony integration) is **unverified**
  (hypothesis H4).

## Goal / Non-goals

- **Goal:** any HA command (and any native device command) can be put on an activity hard
  key, on-screen button or sequence step **without** making its device a member.
- **Non-goal:** changing how members are powered.

## Design

1. **Wizard "Extra controls" section:** a key may map to any device's command.
   - Non-member mappings are stored like any other `ButtonCommandAction`.
   - The UI labels them "not part of this activity's power-on".
   - P06's change keeps them on later edits.
2. **Defaults** never pick non-member devices.
3. **Mirror:** extra-control hard keys mirror to 16417 like any other key.
4. **Gestures** (Touch only): a gesture to a non-member device works only if that device has a
   `16417Device` screen containing the command (corpus §02). The editor warns if not (P07).
5. **HA-side presentation:** the integration's README explains "HA action devices" (scripts,
   scenes, buttons) as the main use.

## Work breakdown

1. `wizard-model.js`:
   - `reconcileWizardButtons` keeps non-member mappings marked `extra`;
   - the draft model gets an `extra` flag.
2. `views/wizard.js`: the Extra controls picker (all devices; HA action devices first).
3. Android `ActivityGraphBuilder.kt` and wizard UI: the same.
4. Docs: `docs/HOME_ASSISTANT.md` "What the Touch shows"; `docs/TOUCH_EDITOR.md`.

## Local tests

- The wizard model keeps an extra mapping across edits, mirrors it to 16417, and never powers
  it (no role added).
- The hub validator accepts it (already true; add a fixture).
- Android parity vectors.

## Hardware gate (approval required)

This is P21 G9.
1. Map an HA script (`Run`) to a hard key, and an HA light toggle to an on-screen button, in a
   test activity, without membership.
2. Start the activity: the light is **not** powered.
3. Press the key: the script runs once (with P11). Tap the button: the light toggles.
4. Check that `harmony.engine?config` (web UI diagnostics, or HA's Harmony integration
   reload) still lists the activity and doesn't error.
5. Delete the test activity.

## Risks & rollback

- H4: a stock consumer may assume every activity command belongs to a member. Gate step 4
  checks this.
- Rollback: revert; the extra mappings remain valid data.

## Definition of done

- Extra controls can be created and survive edits on web and Android; the gate has passed.

## Decisions

—
