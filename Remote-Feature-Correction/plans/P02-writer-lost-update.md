# P02 Writer lost update and read-back race

Status: Proposed · Tier T1 · Area: `payload/source/codex_webui.c`, `payload/activity/codexactivity.lua` · Depends on: — · Blocks: P09

## Problem

Two saves started from the same configuration can both succeed, and the later one silently
erases the earlier one.

Example:
1. The web wizard is open.
2. Home Assistant pushes a device set that rebuilds a device screen in MapList.
3. The wizard saves. Its MapList, loaded before the HA push, replaces the hub's.
4. The HA device is now listed on the Touch with no screen until the next HA push.

## Evidence

- **Proven by code reading:**
  - `/api/activity-save` computes `activity_revision()` (FNV over ActivityList, MapList and
    FunctionList) and compares it with the client's `baseRevision` **before** the writer
    lock is taken (`codex_webui.c:3241-3266`).
  - The lock is taken later, inside `offline_writer_request` (`:2765`).
  - The hub plugin never checks a base (`codexactivity.lua:594-645`).
- **Proven:** the C read-back after a save runs **after** the lock is released
  (`codex_webui.c:2802-2806`, `3287-3361`). A different writer committing in that gap makes
  the C side see a "mismatch" and roll back by re-committing the old text, which also
  reverts the other writer [INF: small window].
- Not reproduced on hardware.

## Goal / Non-goals

- **Goal:**
  - a save whose base is stale fails with 409 even if it waited on the lock;
  - the read-back can't observe another writer's commit.
- **Non-goal:** merging concurrent edits. A conflict is reported, not merged.

## Design

Option A is recommended: **check under the lock in C.**

1. Split `offline_writer_request` into `offline_writer_lock()` → work → `unlock`, so a
   handler can hold the lock across: check base → submit → wait → read back.
2. In the activity-save handler:
   1. take the lock first;
   2. then read the three files and compare `baseRevision` (409 on mismatch);
   3. then submit;
   4. then read back and compare;
   5. then release.
3. Device settings, HA and device-screen ops already read-modify-write inside the plugin, so
   they don't need a base. They only need the lock, which they already take.

Option B: **base in the plugin.** C passes the base etags (from `index.json`, as the client
saw them), and the plugin compares them with `resMgr.getEtag` before saving. That is more
robust if anything else ever writes outside C, but it needs clients to send etags rather
than the FNV revision. Consider it once P03 removes the raw writers.

## Work breakdown

1. `codex_webui.c`:
   - refactor `offline_writer_request(…)` into `offline_writer_submit(lock_fd, …)` plus
     explicit lock and unlock;
   - update every caller: activity save, activity sync, device settings, HA devices, device
     screen.
2. Activity-save handler (`:3200-3361`): reorder as in Design; keep the 409 body
   (`{"ok":false,"error":…,"revision":…}`).
3. Keep the 50 s lock wait. The 45 s reply wait now counts inside the held lock; that is
   unchanged in effect.
4. `docs/API.md`: say that `409` can now also come after a wait.

## Local tests

- **hub-emu** (real binary under qemu, required for POST paths):
  1. load a config (record its revision);
  2. start an HA dry-run-off push that changes MapList (or use a fixture writer op);
  3. send an activity save with the old revision;
  4. expect 409.
- **webui-sim server:** mirror the ordering in `server.mjs`, so sim-based tests see the same
  409 rule (`hub-routes.test.mjs`).
- **Regression:** the existing activity-save, Touch-editor and wizard suites stay green.

## Hardware gate (approval required)

1. Deploy, then confirm with the owner's web UI that an ordinary wizard save still works.
2. Owner-observed race:
   1. open the wizard on an existing test activity;
   2. run `tools/ha_devices.mjs apply` with an unchanged set plus one harmless screen change
      (or a device-screen rebuild);
   3. save the wizard;
   4. expect 409, with the UI asking to reload.
3. Revert the test change.

Stop if any ordinary save returns 409 without a concurrent writer.

## Risks & rollback

- Holding the lock across the read-back extends lock time by a few hundred ms. That is
  acceptable.
- Rollback: revert the PR and redeploy `codex_webui`. No data migration.

## Definition of done

- The race test is green on hub-emu, the gate has passed, and the docs are updated.

## Open questions

- Should the web editor auto-reload and re-apply its draft on 409? It's a later UX nicety;
  keep this plan to correctness.

## Decisions

—
