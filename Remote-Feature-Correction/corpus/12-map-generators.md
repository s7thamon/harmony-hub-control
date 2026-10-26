# 12 Map generators and what they preserve

Prefixes as in §11. `wz` = `MEL/tools/webui-sim/public/js/views/wizard.js`,
`tsg` = Android `TouchScreenGraph.kt`.

## 1. Web activity wizard (`buildActivityGraph`, `wm:759-823`)

- **Activity:**
  - an edit mutates the cloned activity in place (unknown keys survive);
  - a new activity comes from `blankActivity`, with `Id-` from the button-ID band and
    `ActivityOrder = count`.
- **Roles:** rebuilt every save; every role and `SelectedInput` gets a **new `Id-`**
  (`wm:314-335`).
- **16414Activity** (`composeButtonMap`, `wm:464-507`):
  - reuses the map shell (ID, surfaces, `Sequences`);
  - **re-allocates every ButtonId**;
  - hard buttons only; `EventType` 1 for press, 2 for hold;
  - FGT 2 for `Number\d`, else 0; `ButtonState` 1;
  - double press carried from the draft.
- **Surface totality:** clones an **empty** map for every remote surface any other activity
  has, including 16417 (`wm:569-653`).
- **16417Activity hard keys** (`mirrorTouchHardButtons`, PR #56, `wm:669-756`):
  - `Dvr` becomes `DVR`; number keys are skipped;
  - the Touch ButtonId is kept or allocated; FGT 0;
  - if the Touch map has **no** hard buttons, all are copied; otherwise only keys whose
    action shape changed compared with the previous 16414 map.
- **16420Activity:** created when a keyboard role exists, removed when not.
- **FunctionList:** an **empty** `ActivityFunctionMap` for new activities.
- **No** soft buttons, `IndexInMenu`, number pad or sequences are generated.
- **Membership filter** (`wm:181-211`):
  - mappings whose press device isn't a role device are **dropped**;
  - `source=default` entries are refreshed;
  - on open, **unmapped keys are filled with defaults** (`wz:892`), so a rename adds mappings
    and mirrors them to the Touch.

## 2. Android wizard (`agb`)

- The same floors and allocator.
- 16414: **`ButtonDoublePressAction` is always `JsonNull`** (`agb:871`; draft model
  `HubModels.kt:143-151`). The mirror then copies that change to the Touch key
  (`agb:516-532`).
- No surface-totality cloning. Instead, the mirror creates a missing 16417Activity map from a
  16417 sibling (`agb:480-512`).
- The edit draft is read from **all** of the activity's maps (16414, then 16417, then 16420),
  first raw `ButtonKey` wins (`agb:240-285`; `vm:1316`). So `DVR` and `Dvr` and the keyboard
  keys land in 16414.
- Distinct power orders per device; `EnterActions`/`LeaveActions` writable (`agb:736-790`).

## 3. Web Touch on-screen editor (`tm:73-352`; `docs/TOUCH_EDITOR.md`)

- **Owns:** soft buttons with FGT ≠ 2 whose press is a command, sequence or activity action.
  Everything else is carried through byte for byte.
- **New button:**
  - lowest free slot over all non-number-pad soft rows, including locked ones;
  - `EventType` 0, `MenuName "Activity.<id>"`, FGT 0;
  - ButtonId from the allocator.
- Slots are never renumbered; reorder swaps.
- A new 16417 map copies surface and remote IDs from a 16417 sibling, with
  `DateModified null`.
- Validates before saving. It refuses to save without a FunctionList.
- Offers commands from **any** device, members ranked first (`views/touch-screen.js:67-69`).

## 4. Android Touch editor (`tsg:135-206`)

- Editable: soft buttons with FGT ≠ 2 whose press is a command or sequence.
- **Every editable button is renumbered** into consecutive free slots (`tsg:160-183`).
- `Sequences` is replaced by the draft's; steps are limited to command and delay.
- A command button missing `DeviceId-`/`CommandName` is silently deleted.
- **No validator.**

## 5. Advanced editor (`au`)

- Edits one selected map at a time; **no 16414 → 16417 mirror** (`au:1449-1470`).
- Press `EventType` 1, even for soft buttons; 2 hold; 3 double.
- `reconcileActivityMaps` on load and save (`au:748-915`):
  - drops maps of unknown activities and devices;
  - clears orphan activity actions;
  - clones missing surfaces;
  - back-fills null press/hold/double slots from same-identity buttons in sibling maps or
    device maps;
  - creates and removes 16420;
  - prunes action-less buttons;
  - allocates missing IDs; forces `ButtonState` 1;
  - adds a keyboard role for BT keyboards;
  - creates `ActivityFunctionMap`s **populated from DeviceFunctionMaps**.
- Its validator is stricter than the hub's (unique names, ButtonIds, surfaces).

## 6. Hub device-screen builder (`touchScreenMap`, `cx:1269-1529`)

Used by `CommitDeviceScreen` (⋮ Make/Rebuild/Remove) and `CommitHaDevices`.
- `16417Device<id>`, `DeviceButtonMap`. Surface and remote IDs come from the old map, else a
  template (preferring another 16417Device map). **No template → no screen.**
- **Hard keys:** the first command whose **exact** normalized name is an alias in
  `TOUCH_SCREEN_KEYS`, with brightness → volume (`cx:1286-1315, 1368-1387, 1468-1484`);
  `EventType` 1, FGT 0.
- **Every other command → `SoftRemoteButton`**, `IndexInMenu = 0..n−1` **in command order**,
  `MenuName "Device.<id>"`, `EventType` 0, FGT 0. Digits are plain buttons: **no number pad,
  no `123` row** (`cx:1485-1506`).
- ButtonIds are kept by `hard:<key>` / `soft:<lowercased command>`; the map ID is kept;
  `Sequences = null`.
- **Slots are recomputed every rebuild**, so adding or removing a command shifts later slots
  (plan P04).
- Logitech-made maps (ID ≤ 52944089) are never rebuilt or removed.
- Proven on hardware 2026-10-24/25: a `16417Device` map alone (no DeviceFunctionMap) gives a
  working screen; soft and hard both send [HW].

## 7. HA writer (`CommitHaDevices`, `cx:2046-2319`)

See §15. It builds or removes screens for HA devices whenever the set changes. A raw IR command
edit doesn't rebuild a local screen; it stays stale until the owner rebuilds it.

## 8. Bluetooth bridge

Clone mode copies the template device's **first** DeviceButtonMap only; new map ID and
ButtonIds are max + 1 (not floor-aware); command IDs are max + 1.

## 9. Preservation matrix

| Generator | IDs | User actions | Slots | Long / double | Touch-only keys | Cross-refs |
|---|---|---|---|---|---|---|
| Web wizard | 16414 ButtonIds and role ids re-issued | non-member mappings dropped; defaults added on open | n/a | kept / kept | kept | mirror for changed keys only |
| Android wizard | same | same | n/a | kept / **dropped** | **imported into 16414** | mirror propagates the double-press drop |
| Web Touch editor | kept | kept | never renumbered | kept | kept | sequences kept |
| Android Touch editor | kept | malformed rows dropped | **renumbered** | kept | kept | sequences replaced |
| Advanced editor | allocates missing | back-fills | n/a | kept | **no mirror** | clears orphans |
| Device screen | map and ButtonIds kept | owned (rebuilt) | **recomputed** | none | n/a | Logitech maps untouched |
| HA writer | device and command IDs kept | power edits **revert** each push | via screen | — | — | removal guards |
| IR command delete/rename | — | **dangling references** | — | — | — | none |

## 10. The "16414 but not 16417" claim

- **False** for the current web and Android wizards (PR #56, commit `57b0b54`).
- **True** for the advanced editor.
- The mirror repairs only keys an edit changes.
- Live data: 5/5 activities have both maps, with hard keys equal after `Dvr`→`DVR` and
  excluding `Number0-9`, and 0 action differences on shared keys [RT].
