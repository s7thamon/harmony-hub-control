# Harmony Touch screen editor

The Harmony Touch draws its screens from button maps in the hub's MapList.
This document is the contract for editing those maps locally: what an
editor may change, what it must carry through untouched, and the checks
every save must pass.

The hard rule: never leave the Touch unusable. The Touch loads its own
copy of the MapList with the same stock reader the hub uses. A map that
reader cannot load leaves the Touch without a screen until the next good
sync, and a Touch cannot be re-provisioned without the cloud. Every
MapList an editor produces must pass the validation rules below before
it is saved.

## How the Touch gets its screens

- The hub never pushes config to the Touch. The Touch pulls it: it asks
  the hub for each resource, then reads the large files, and commits the
  staged copy when the sync finishes. A no-change sync on the owner's
  hardware confirms this pull runs locally against the hub.
- The hub resolves a Touch press against its current maps. An on-screen
  press arrives as a menu index; the Touch draws labels from its own
  synced copy. Until the Touch syncs after a save, a slot whose action
  changed or moved runs the new action under the old label. This is the
  stale-Touch window.
- Saves go through the existing activity save: `POST /api/activity-save`
  writes ActivityList, MapList and FunctionList with new etags, reloads
  the engine, and publishes a new configuration revision. There is no
  separate Touch write path.
- After a save, the editor tells the owner to sync the Touch from its
  menu. It does not claim the revision notice starts a sync by itself;
  that is unproven on hardware.

## The MapList contract

MapList holds one map per remote surface and activity or device. The
Touch's screens are the `16417` maps; the `16414` maps hold hard buttons
only. Editors work to these rules:

- Never delete or rename a map the Touch resolves.
- Never change `SurfaceId-`, `RemoteId-` or `ButtonMapSurfaceId-` on an
  existing map. A new map copies those fields from a sibling `16417`
  map, and is refused when the hub has no such sibling.
- Carry through untouched everything the editor does not own: hard
  buttons, the number pad, client, channel and bookmark actions, image
  fields, unknown fields, and key order.
- Labels are text only. Custom icons need the cloud and are out of scope.
- New `ButtonId`, `ButtonMapId-` and `SequenceId` values are allocated
  above every existing value in the MapList and are never reused while
  live.

### What each editor owns

| Map | Owned | Carried through |
| --- | --- | --- |
| `16417Activity<id>` | On-screen buttons, their sequences, gestures | Number pad, hard buttons, Touch-only actions |
| `16417Device<id>` | On-screen buttons (device screens slice) | Everything else on the map |
| `16414*`, any root map | Nothing | The whole map |

An on-screen button is a `SoftRemoteButton` whose `FunctionGroupType`
is not 2 (the number pad). Its editable fields are its label
(`TextOnRemote`, text only), its press, long-press and double-press
actions, and its menu slot. Actions an editor can assign are a device
command, a sequence in the same map, or starting an activity. Home
control and program actions keep working and pass through; an editor
does not create them.

A sequence lives in its map's `Sequences`. Its steps are device
commands and delays only, run in `Order`. Deleting a sequence deletes
the buttons that run it.

Gestures are `GestureRemoteButton` entries keyed by `ButtonKey`. The
keys confirmed in real maps are `SwipeUp`, `SwipeDown`, `SwipeLeft`,
`SwipeRight` and `Tap`. An editor offers only confirmed keys. Whether
gestures reach the hub as optimized presses or full commands is
unproven on hardware, so the gestures slice starts with that check.

### Menu slots

The stock reader keys on-screen buttons by `MenuItem.IndexInMenu`
alone, within each map; the number pad is keyed separately. Slots are
fixed:

- An existing button keeps its slot. Saving never renumbers.
- Reorder is explicit: the owner moves a button, and two buttons swap
  slots.
- A new button takes the lowest free slot in its map. Removing a button
  leaves a gap, and gaps are valid.
- Two non-number-pad buttons in one activity map never share a slot.
  Across function groups a shared slot still collides, because the
  reader keys by the index alone.

Device screens follow the same reader, but real device maps exist with
two soft buttons at one slot in different function groups, where one
shadows the other on the hub. How the Touch numbers slots per group is
unproven, so no slot rule is written for device maps until that is
probed on hardware. The device screens slice starts with that probe.

## Validation

Two copies of the same rules run before any save: the hub's
`validateGraph`, which is authoritative and protects every client, and
a mirror in the web UI's remote model, which reports problems before
the save is sent. A MapList is rejected when:

- a map is not an object, its `__type` is missing or is not a device,
  activity or root button map, or its `Buttons` array is missing;
- a button is not an object or its `__type` is missing or is not a
  hard, soft or gesture button;
- a hard or gesture button has no `ButtonKey`;
- a soft button has no `MenuItem.IndexInMenu`, or the index is not a
  non-negative integer;
- two non-number-pad soft buttons in one activity map share an index;
- a button runs a sequence that is not in the same map's `Sequences`;
- a sequence has no `SequenceId` or no `Actions` array, a step is not
  a command or delay step, or a delay has no numeric `Duration`.

The hub also keeps its existing checks: activity and device references
must exist, in buttons and in sequence steps alike.

These rules come from the stock reader's behaviour, verified by running
that reader, out of tree, over every test fixture: the shapes marked as
throwing fail there, and the shapes it loads but misreads (a shared
slot, a missing sequence) are the ones validation rejects anyway.

Fixtures are synthetic and live in
`tools/webui-sim/fixtures/touch-maplist.json`. They cover a full
activity screen with a number pad, gestures and a sequence, gap slots,
an empty touch map, an activity with no touch map, the device-screen
slot clash, and each rejected shape. The web tests run the mirror and,
when LuaJIT is available, the hub validator over the same fixtures, so
the two copies cannot drift.

## Slices

Each slice is one branch from `main` and one pull request, and ends
with an owner deploy and an on-Touch check before the next slice
starts.

- (a) Validation: the hub and web validators, the fixtures, this
  document. No editor UI yet.
- (b) The web editor for activity on-screen buttons: label, action,
  explicit reorder, add and remove.
- (c) Sequences in the editor, then gestures.
- (d) Device screens, including creating a screen for a device that has
  none, after the slot probe.
- (e) Android parity: the fixed-slot policy in its touch screen graph,
  tests for it, and the shared rules above.

## Hardware gate for slice (a)

The owner runs these after deploying the slice. Nobody else touches
the Touch or the hub's save routes.

1. With hub logging running, sync the Touch from its menu with no
   edits. Expect the resource pull to complete as before.
2. Use Activities, Refresh remote locally, with no edits. Watch whether
   the Touch syncs on its own or only from its menu.
3. On the device screen with two buttons at one slot, press each and
   note which command the hub runs.
4. Make one reversible edit: change one on-screen button's label in
   the advanced editor, save, sync the Touch, confirm the new label,
   revert, and sync again.

A failure at step 1 stops the programme: the Touch is not on the local
pull this design assumes.
