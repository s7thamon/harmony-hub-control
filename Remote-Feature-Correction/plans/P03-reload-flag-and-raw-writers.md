# P03 Reload-flag race and raw writers

Status: Proposed · Tier T1 · Area: `payload/mqtt/codexmqtt.lua`, `payload/activity/codexactivity.lua`, `payload/source/codex_webui.c` · Depends on: — · Blocks: P08, P20

## Problem

The IR device and command forms, IR and catalog imports, protocol repair and `/import` write
resource files directly and then drop a reload flag. Whether the Touch then picks up the
change depends on **which hub task notices the flag first**:

- `codexactivity` reloads the engine **and publishes** a revision, so the Touch syncs
  (`codexactivity.lua:2352-2383`);
- `codexmqtt` reloads **without publishing** and without the stock-sync guard
  (`codexmqtt.lua:54-71`, polled every second even when MQTT is off), so the Touch keeps
  its old copy until some later publish.

Raw writes also keep the old etag and take no lock. A raw DeviceList edit racing
`CommitHaDevices` or `CommitDeviceSettings` loses one side.

## Evidence

- Proven in source (see the citations above). Commit `c6b7663` moved IR reloads to
  codexactivity but left codexmqtt's consumer in place.
- With the blocker on, the hub's resource override always serves the disk file
  (`netservicestarter.lua:574-619`; `resourcemanager.lua:427-462`), so **etags are not the
  gate**. The publish is (corpus §10).

## Goal / Non-goals

- **Goal:**
  - every resource change publishes exactly once and reaches the Touch;
  - no resource write happens outside the writer lock;
  - in the end, no raw resource writes at all.
- **Non-goal:** redesigning IR editing UX.

## Design

Two stages.

**Stage 1 (small, immediate):**
- remove `checkResourceReload` from `codexmqtt.lua`, so codexactivity is the only consumer;
- take the writer `flock` around every raw write in C, so raw writes stop racing plugin
  ops.

**Stage 2 (structural):**
1. Add a plugin op `CommitDeviceList` (and `CommitProtocolList`) that takes a full new
   DeviceList and ProtocolList text, validates it (references from maps and activities
   still resolve; P08), and saves through `resMgr.saveResource` with new etags. It then
   reloads and publishes.
2. Port each raw C writer to build the new text and submit it through that op instead of
   `write_file_atomic`.
3. `/import` becomes a multi-resource plugin transaction:
   - validate the whole graph;
   - save each list;
   - roll back all of them on failure.

   It is then the same transaction shape as an activity save.

## Work breakdown

1. Stage 1:
   - delete `checkResourceReload` and its call site in `codexmqtt.lua` (`:54-71`, `:657-662`,
     `:720-721`);
   - add `offline_writer_lock()` around `write_file_atomic` callers in
     `codex_webui.c:3604-3902, 4230-4840, 7627-7794`.
2. Stage 2:
   - add `commitDeviceList` and `commitProtocolList` in `codexactivity.lua`, reusing
     `saveDeviceListText` and the restore helpers from `CommitDeviceSettings`;
   - add the `/import` transaction op;
   - port the C writers one family at a time (IR device, IR command, imports, protocol
     repair, `/import`).
3. Docs: the corrections from P01; `docs/API.md` notes that IR edits now publish.

## Local tests

- **Lua:** extend `netservicestarter-guards-test.lua`, or add `codexactivity-reload-test.lua`,
  to assert that the flag handler always calls `publishLocalRevision` after `config_new`.
- **Lua:** an MQTT plugin test asserting that it never touches `/data/codex/reload_resources`.
- **hub-emu:**
  - an IR command rename through the form produces a new `index.json` etag (Stage 2) and a
    bumped `configVersion` and `stateVersion` (both stages);
  - `/import` of a broken bundle leaves every file unchanged.

## Hardware gate (approval required)

This is P21 G5.
1. With the blocker on and Stage 1 deployed, rename one IR command label through the IR
   form.
2. Expect the Touch to pull (hub log `proxy.resource?get`) and its device screen or label
   to change.
3. Rename it back.

Stop if the Touch shows any sync abort in SyncCounter.

## Risks & rollback

- Stage 1 is low risk. If something depended on codexmqtt reloading (nothing found), the
  flag is still consumed by codexactivity.
- Stage 2 changes many C paths. Land it family by family, each with its own hub-emu test.
- Rollback: revert the PR, redeploy, and reboot if `codexactivity.lua` changed (the engine
  keeps the old plugin loaded until reboot).

## Definition of done

- Stage 1: codexmqtt no longer reads the flag, and all raw writers hold the lock.
- Stage 2: no `write_file_atomic` onto `/data/resources/*.json` remains outside the plugin.

## Open questions

- Should `/import` be limited to whole-bundle restore (all lists) to keep the transaction
  simple? Recommendation: yes.

## Decisions

—
