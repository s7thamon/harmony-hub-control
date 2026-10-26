# P17 Touch number pad on hub-built screens

Status: Proposed · Tier T4 · Area: `codexactivity.lua` `touchScreenMap`, activity screens · Depends on: P04 · Blocks: —

## Problem

Logitech device and activity screens give the Touch a number pad:
- a `123` row opens a 12-key pad;
- digits fire as `fire` with `functionGroupType 2`.

Hub-built screens instead put digits on ordinary on-screen buttons (`codexactivity.lua:1468-1506`),
and no Melodious generator creates the number pad (Track C H5). So IR devices made in
Melodious (and future HA `number`/channel-like entities) have no number pad.

## How the stock number pad works (source)

- **The `123` row:**
  - a `SoftRemoteButton` with `TextOnRemote` exactly `123`, FGT 36;
  - `ButtonAction: {"__type":"ButtonClientAction","ActionName":"Numpad","EventType":0,"Order":0,"Id":<n>}`;
  - no `DeviceId-`.
  - The Touch keys on the **label** (`LD/juniper/devicemode.lua:428`;
    `activitycommands.lua:404`).
  - The hub doesn't store this button (no executable action).
  - It shares the main index space with FGT 0 buttons on the hub.
- **Digit keys:** `SoftRemoteButton`, FGT **2**, their own index space, `ButtonCommandAction`
  whose **`CommandName` must parse as a number** (`tonumber`) for 0–9.
  - `-`, `.`, `*` and `NumberPlus` go to the bottom-left key.
  - `Enter`, `NumberEnter`, `#` and `ENT` go to the bottom-right key
    (`LD/juniper/numpad.lua:67-91`).
- **Press:** `fire`, `indexInMenu`, `functionGroupType 2`, plus `deviceId` on device screens
  (`numpad.lua:45-47`). The hub looks in `numPadButtons[index]`.
- **Constraint:** the hub runs the command by `CommandName`, so the **device command itself
  must be named `"1"`…** for both sides to agree. Logitech devices name digit commands that
  way. Melodious IR imports may not (for example `Number1`).

## Goal / Non-goals

- **Goal:** a hub-built device screen gets a working number pad when the device has digit
  commands.
- **Non-goal:** number pads for HA devices (no digits), unless P15 adds digit presets.

## Design

1. **Detection:** the device has commands whose normalized names are digits 0–9 (any of `1`,
   `Number1`, `Digit1`, …), using a P05 synonym class.
2. **Naming bridge:**
   - if the command is already named `"1"`, use it;
   - otherwise the screen needs a command literally named `"1"`. Options:
     - **a.** P08's rename-everywhere renames `Number1` → `1` (owner-confirmed per device);
     - **b.** the writer adds alias commands named `"1"` duplicating `Number1`'s code. This is
       invasive and duplicates data, so it isn't recommended.
3. **Generation:**
   - one FGT 2 button per digit, `IndexInMenu` = its own 0..n space (stable per P04 rules);
   - one FGT 36 `123` row at a stable main-space slot;
   - digits are removed from the ordinary on-screen list.
4. **Activities:** the wizard/Touch editor can add the `123` row and FGT 2 buttons for the
   activity's channel device (the Logitech pattern).

## Work breakdown

1. `codexactivity.lua` `touchScreenMap`: the number-pad branch.
2. The validator accepts and checks the number-pad shape (FGT 2 index space; `123` row
   structure).
3. Web Touch editor: carry-through already exists; add creation for activities.
4. Fixtures and docs.

## Local tests

- The screen for a device with commands `0`–`9` + `Enter` gets 11 FGT 2 buttons and one `123`
  row, with no index clashes.
- A device with `Number0..9` and no rename gets the old behaviour (digits on screen).
- Run the stock-reader check over the fixtures.

## Hardware gate (approval required)

1. Rebuild the screen of a test IR device that has `0`–`9` commands.
2. On the Touch: `123` opens the pad, and each digit fires its own command (watch the IR
   receiver or hub log).
3. Revert by rebuilding the old screen (P04 keeps slots).

Stop if the `123` row does nothing or the pad shows blank keys.

## Risks & rollback

- The `123` row's index shares the hub's main space. Generation must avoid every soft slot
  (P04 allocator).
- Rollback: rebuild without the number pad.

## Decisions

—
