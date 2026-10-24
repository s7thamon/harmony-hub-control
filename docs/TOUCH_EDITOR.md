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
  staged copy when the sync finishes. This pull runs locally against
  the hub; the owner's hardware confirms it.
- The Touch starts that pull by itself when the hub publishes a new
  configuration revision, which every save does.
- Its own Sync menu checks for internet first. It asks the hub for
  `wifi.status`, which the hub's hardware daemon answers by resolving
  `ping.myharmony.com` and connecting to it on ports 80 and 443, and it
  goes on only if both connect. With the cloud blocked they can't, and
  after a few tries the Touch reports "Unable to connect to MyHarmony. A
  time out error occurred." without asking the hub for anything else.
  So while the blocker is on, `codex_webui` points that name at
  `127.0.0.1` in `/etc/hosts` and accepts connections on loopback ports
  80 and 443. Nothing else on the hub resolves that name: its own
  online check resolves its discovery server. Turning the blocker off
  removes the line.
- Once that check passes, the Touch checks its own firmware (a
  `sus://` resource the offline guard refuses), asks the hub to check
  for hub firmware (`setup.firmware?check`), asks it to sync
  (`setup.sync`, answered locally), pulls every resource, and asks for
  the time (`harmony.engine?getTime`). While the blocker is on,
  `netservicestarter.lua` answers the time from the hub's own NTP-set
  clock (once that clock is past 2026-01-01), which sets the Touch's
  clock.
- The hub firmware check is left to the stock handler, which fails
  offline, and the menu Sync then stops partway with every resource
  already pulled. Answering that check with "up to date" was tried:
  the Touch then went on to judge its own update status, which the
  refused `sus://` answer leaves empty, and stopped on a
  "myharmony.com" screen that needed a forced restart. A full menu
  Sync needs a local answer for the Touch's own firmware check first,
  proven on hardware, before the README lists it.
- After the resources, every pull also fetches a content record,
  `CD_<device>`, for some devices, and the Touch aborts the whole pull
  (error 553) unless that answer is 200 or 304. It then retries on every
  button press and never takes a new setup. Devices made on the hub have
  no content record, so while the blocker is on the offline guard
  answers a missing one with the record Logitech kept for a device with
  no content services. A record the hub does have is served as it is.
  The Touch's own sync log, `/data/loggly/SyncCounter.json` on the
  Touch, lists each aborted pull with its error code.
- The hub resolves a Touch press against its current maps. An on-screen
  press arrives as a menu index; the Touch draws labels from its own
  synced copy. Until the Touch syncs after a save, a slot whose action
  changed or moved runs the new action under the old label. This is the
  stale-Touch window.
- Saves go through the existing activity save: `POST /api/activity-save`
  writes ActivityList, MapList and FunctionList with new etags, reloads
  the engine, and publishes a new configuration revision. There is no
  separate Touch write path.

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

The activity wizard (web and Android) owns each activity's
`16414Activity<id>` map and the hard buttons of its `16417Activity<id>`
map. The Touch answers its hard keys from its own map only; Logitech's
configs carry the same hard buttons on both maps, minus the number keys,
which are on screen on the Touch, and with `Dvr` spelled `DVR`.

- When the Touch map has no hard buttons (activities made in Melodious),
  a wizard save copies all of them.
- When it already has some, a save copies only the keys that the edit
  changed. A Touch-only mapping made in MyHarmony survives.
- A hub with a Touch surface gets a `16417Activity<id>` map for each
  activity the wizard saves.

An on-screen button is a `SoftRemoteButton` whose `FunctionGroupType`
is not 2 (the number pad). Its editable fields are its label
(`TextOnRemote`, text only), its press, long-press and double-press
actions, and its menu slot. Actions an editor can assign are a device
command or a sequence in the same map. Buttons that switch to another
activity, and home control and program actions, keep working and pass
through; an editor does not create them.

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
unproven, so no slot rule is written for editing such maps. The screens
the hub builds (`POST /api/device-screen`, see API.md) don't need one:
every on-screen button is in function group 0 with a slot of its own,
like Logitech's own simplest device maps.

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

## The web editor

Activities, ⋮, On-screen buttons (`#touch/<activityId>`) opens one
activity's Touch screen. Its model is
`tools/webui-sim/public/js/views/touch-model.js`; it reads the
activity's `16417Activity<id>` map and writes the whole MapList back
through `POST /api/activity-save`, with ActivityList and FunctionList
sent exactly as the hub returned them.

- The list shows the on-screen buttons in slot order, numbered by slot,
  so gaps stay visible.
- A button that sends a device command can be renamed, pointed at
  another command, moved or removed. A button that runs a sequence or
  switches to another activity can be renamed, moved, removed, or
  changed to send a command. The editor doesn't create sequence buttons
  yet (the sequences slice adds them) and never creates activity ones.
- Buttons with Touch-only actions (such as the number-pad toggle) are
  shown, keep their slot and can't be changed.
- Move swaps slots with the nearest button that can move. Add takes the
  lowest free slot. Remove leaves a gap. Nothing else is renumbered.
- An activity without a screen gets one on its first added button, its
  surface and remote ids copied from another activity's screen. On a
  hub with no Touch screen at all, the editor says so and offers
  nothing to add.
- Labels are plain text, trimmed, at most 24 characters, and required.
- Before sending, the editor checks that the activity's map hasn't
  changed on the hub since the screen opened, and runs the validation
  rules above. It refuses to save a config without its FunctionList
  rather than send an empty one.
- After a save it says the Touch picks up the change by itself, and
  that until it does, a moved or changed button can run its new action
  under its old label.
- When the hub reports a failed save, the editor reloads and compares:
  if the hub has the edits, it says they were saved; if the screen is as
  the editor found it, it says nothing changed and keeps the edits; if
  the screen changed some other way, it shows what the hub has now.

Tests: `tools/webui-sim/test/touch-model.test.mjs` covers each edit,
byte-identical carry-through of every other map and button, key order,
id allocation and the new-screen path, and runs the hub's Lua validator
over a graph for every kind of edit.

## Slices

Each slice is one branch from `main` and one pull request, and ends
with an owner deploy and an on-Touch check before the next slice
starts.

- (a) Validation: the hub and web validators, the fixtures, this
  document. No editor UI yet.
- (b) The web editor for activity on-screen buttons: label, action,
  explicit reorder, add and remove.
- (c) Sequences in the editor, then gestures.
- (d) Device screens. The hub builds a screen for a device that has none
  from its commands, and keeps Home Assistant devices' screens with the
  device set. Proven on 2026-10-24 with an IR device and a Home
  Assistant light: a `16417Device<id>` map alone, with no
  `DeviceFunctionMap` (the Touch never pulls FunctionList), opens the
  device, and its on-screen buttons and hard keys both send. Editing a
  device screen button by button is still to come.
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

This gate is kept as it was run. Its "sync from the menu" steps were
written before it was known that the menu Sync fails offline; the Touch
picked the edit up by itself.

## Hardware gate for slice (b)

After deploying, on an activity whose screen has at least two buttons,
with hub logging running. After each save, wait for the Touch to pull
the change (the `proxy.resource?get` lines in the log) rather than
using its Sync menu.

1. In On-screen buttons, rename one button and save. The new label
   shows; pressing it sends the same command as before.
2. Move that button one place and save. Before the Touch pulls, note
   what it shows. Once it has, check the two buttons sit in their new
   places and each sends its own command.
3. Add a button that sends a harmless command and save. It appears in
   the lowest free slot and sends that command.
4. Remove the added button, undo the move and the rename, and save.
   The screen matches how it started.

Stop and report if the Touch shows no screen or an error after any
pull.

## Saves while the engine is busy

A save writes the resources, reloads the engine, then waits for the
activity engine before it answers. An activity that is starting can
hold the engine for a long time. `codex_webui` gives the whole save 45 s
and, without an answer, reports a failure and asks the plugin to put
the old resources back, though the reloaded engine already runs the new
ones; when that request also goes unanswered, the save stays. So the
plugin's wait ends by the clock after 25 s, leaving room for the writes
and the reload, and then answers; a slow engine is reported, not
treated as a failure. `tools/touch-validator/codexactivity-barrier-test.lua`
checks the wait against a fake clock and against the limit in
`codex_webui.c`.

Owner check after deploying a change to this path: start an activity
from the Touch, and while it is still starting, rename one on-screen
button and save. The save succeeds; once the Touch has pulled the
change, confirm the label; rename it back and save.
