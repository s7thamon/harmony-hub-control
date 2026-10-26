# P14 Guards for engine paths that drop IP commands

Status: Proposed · Tier T3 · Area: validators, wizard role picker, hub writer · Depends on: P07 · Blocks: —

## Problem

The stock engine silently drops IP (transport 64) commands on several paths. Fixing the engine
isn't in scope (stock software), so Melodious must stop **generating** data that uses these
paths for HA devices.

| Path | What happens | Evidence |
|---|---|---|
| Activity `LeaveActions` other than Power Off | the leave list is fired without protocols → plugin branch → 592 | `LW/…/apihandler/activity.lua:1134-1135, 1209-1214` |
| A sequence started through `harmony.engine?holdaction` with `sequenceId` (app/API path; codexmqtt `<base>/command` can reach `holdaction`) | `fireCommandsList(commandsList, account.devices)` without protocols → 592 | `activity.lua:598-606` |
| `ChannelActivityAction`, `DefaultChannel`, `SelectedInput.ChannelNumber`, `harmony.engine?changechannel` on a transport-64 device | `ipManager.setChannel` → no plugin → 592 | `LW/…/model/device.lua:451-457` |
| HA device in a `KeyboardTextEntry`/`ControlsMediaPlayer`/`PlayMovie` role (HID target) | HID through the IP plugin path → 592 | `activity.lua:1342-1364, 1524-1527`; `ipmanager.lua:204-271` |

Paths that **do** pass protocols, and so work for HA:
- button presses and long presses;
- **button-bound sequences** (activity map `Sequences` run from a Touch press);
- activity power and input scheduling;
- enter actions and Power Off;
- `helpSync`.

## Goal / Non-goals

- **Goal:** no Melodious editor can create a graph that puts an HA command on a dropping path,
  and existing graphs are flagged.
- **Non-goal:** patching the stock engine.

## Design

1. **Validator (P07 rules, promoted to errors for HA devices):**
   - an IP command in a non-power `LeaveActions`;
   - an IP device in a channel or keyboard role;
   - `SelectedInput.ChannelNumber` or `DefaultChannel` on an IP device.
2. **Wizard and Android role pickers:** don't offer HA devices for channel or keyboard roles.
   The HA writer already gives them `DeviceType 44` "Home Appliance".
3. **Sequence runners in Melodious UIs:** check whether web or Android "Run sequence" uses
   `holdaction` with `sequenceId`. If so, run sequences that contain IP steps by expanding
   them client-side into individual `holdaction` commands with delays, or refuse them with a
   message.
4. **codexmqtt `<base>/command`:** document that it's single-command only.

## Work breakdown

1. `codexactivity.lua` `validateGraph`: the rules (with P07 severity).
2. Web `wizard-model.js` and `views/wizard.js`; Android role pickers.
3. Audit: grep web, Android and C for `holdaction` with `sequenceId`; fix or guard.
4. Docs: `docs/HOME_ASSISTANT.md` "What doesn't work for HA devices".

## Local tests

- Validator fixtures for each rule.
- The wizard doesn't offer HA devices for those roles.
- If a sequence runner exists: a unit test that IP-step sequences are expanded or refused.

## Hardware gate

- Optional, approval required: one test sequence with an HA step, run from a Touch button
  (works) and through the API (dropped before the fix, expanded after). Confirms the
  source reading.

## Risks & rollback

- None to data. Rollback: revert.

## Definition of done

- The rules are in both validators, the role pickers are filtered, and the sequence runners
  are safe.

## Decisions

—
