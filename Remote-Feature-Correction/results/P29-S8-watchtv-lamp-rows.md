# P29 S8: three lamp rows at the gap indices in the TV activity (write + press verification)

Date: 2026-10-26. Prompt: `prompts/03-P11-P13-P16-HA-footprint.md` §6 step S8.
Builds on: `results/P22-HA-footprint.md` … `P28-S6-cast-rows.md`.
Owner approval: S8 approved; owner switched to `<activityA>`, pressed, and
confirmed completion.

**Write performed: one approved step.** Added 3 soft rows (FGT 0) at the
existing gap indices `1, 2, 3` in `16417Activity<A>` (Touch surface only), all
targeting `<deviceHA1>` (non-member of `<activityA>`):
- idx 1 `L1 On` → PowerOn (`EventType` 0, plain);
- idx 2 `L1 Off` → PowerOff (`EventType` 0, plain);
- idx 3 `L1 Dim` → BrightnessDown (`EventType` 0, plain).
Existing main-space rows at idx 0 (`<cmdHome>` on `<deviceSTB>`) and idx 4
(`<cmdSleep>` on `<deviceSTB>`), the 10 number-pad rows (FGT 2), and all 19 hard
keys were left untouched. Filling `1–3` makes the main soft-row sequence
contiguous `[0, 1, 2, 3, 4]`, removing the index gap noted in P22 §5.

## Pre-write baseline (read-only)

- Fresh `activity-config` revision = post-S6 revision (no intervening pushes).
- Target map (`16417Activity<A>`): 31 buttons (2 main soft rows at idx `[0, 4]`,
  10 FGT 2 pad rows, 19 hard keys).
- Hub SyncCounter: syncCount 0, no conflicts.

## The write

- Payload: `activity-save` with fresh `baseRevision`, `syncRemote=false`,
  activity/function lists identical, only `16417Activity<A>` changed (31 → 34
  buttons + `DateModified`).
- Response: `ok:true, saved:true, mapChanged:true, activityChanged:false,
  functionChanged:false, remoteRefreshed:true`, configVersion 631. Published.
- Post-write re-fetch: revision advanced; only 1 map differs; main FGT 0 soft
  rows are now contiguous `0..4` (`<cmdHome>`, `L1 On`, `L1 Off`, `L1 Dim`,
  `<cmdSleep>`); device count still 10.
- Hub SyncCounter after: syncCount 0, no conflicts. Touch check deferred
  (untethered; retrospective log after re-tether per P21 method).
- Revert: restore the step's pre-copy of the map through the same writer
  (not needed; step passed).

## Press verification (owner pressed, assistant captured via hub `logread`)

- Activity switch `<activityM>` → `<activityA>` observed (`<deviceRCV>` poweroff
  fire on leave; `<deviceTV>`, `<deviceAMP>`, `<deviceSTB>` enter commands — no
  `<deviceHA1>` power command ran at `<activityA>` start, confirming non-member
  isolation).
- All 3 new gap-filling rows in `<activityA>` executed cleanly on `<deviceHA1>`:
  - idx 1 `L1 On` (`PowerOn`, 2x): `press` → `release`, 1 execution + 1 `ltcp`
    notify each;
  - idx 2 `L1 Off` (`PowerOff`, 1x): `press` → `release`, 1 execution + 1
    notify;
  - idx 3 `L1 Dim` (`BrightnessDown`, 7x): `press` → `release`, 1 execution + 1
    notify per tap.
- Existing `<deviceSTB>` BT HID navigation (`DirectionLeft`, 2x) worked
  normally alongside the new rows.
- Result: **S8 PASS** (gap `[1, 2, 3]` closed in `16417Activity<A>`; all 3
  non-member lamp rows verified in `<activityA>`).

## Surprises / notes

- An earlier window (`18:19:19–27`) recorded 6 websocket `holdAction` calls on
  `<deviceHA2>` (`id: <wsId>`, `transport: websocket`, 0 `ltcp` notifies) from a
  connected web/websocket client; unrelated to the Touch presses in `18:23`.

## Cannot determine here

- Exact HTTP POST count (no HA listener; hub notify is the proxy).
- Touch-side retrospective log + Touch SyncCounter (after re-tether).

## Files

- Results: `Remote-Feature-Correction/results/P29-S8-watchtv-lamp-rows.md`
  (this file; untracked, not added).
- Private (`/tmp/melodious-research/private/p22-s8/`, mode 700):
  `activity-config.json` (before), `proposed-config.json`,
  `activity-save-payload.json`, `activity-save-response.json`,
  `activity-config-after.json`, `hub-s8-press*.log`, `hub-s8-full.log`,
  `hub-s8-latest.log`, `hub-s8-final.log`.
