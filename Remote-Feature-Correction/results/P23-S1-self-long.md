# P23 S1: self-long on the lamp activity VolumeMute (write + press verification)

Date: 2026-10-26. Prompt: `prompts/03-P11-P13-P16-HA-footprint.md` §6 step S1.
Builds on: `results/P22-HA-footprint.md`. Owner approval: S1 approved after S0.

**Write performed: one approved step.** Added `ButtonLongPressAction` (self-long:
same device, same command, `EventType` 2) to the VolumeMute hard key in two maps:
`16417Activity<L>` and its `16414Activity<L>` mirror. Nothing else touched.

## Pre-write baseline (read-only)

- Fresh `activity-config` revision: `<revBefore>`; 5 activities, 21 maps, 10 devices.
- Both `<activityL>` maps: VolumeMute → PowerToggle (`EventType` 1), long `null`.
- Hub SyncCounter: syncCount 0, no conflicts.
- Incidental finding (not caused by the agent): the cast device grew from 9 to 11
  commands since P22 (`SkipForward`, `SkipBack` added by a writer push). Its device
  screen grew 9 → 11 buttons as hard Rewind/FastForward; soft rows unchanged —
  exactly the P22 §3.4/§5 prediction. Baseline was re-taken after this; S1 built on
  the new revision.

## The write

- Payload: `activity-save` with `baseRevision=<revBefore>`, `syncRemote=false`,
  activity/function lists identical, only the two `<activityL>` maps changed
  (one added long action + `DateModified` each).
- Pre-POST local diff: only `16414Activity<L>` and `16417Activity<L>` differ, only
  on VolumeMute's long action (+ date bump). Activity/function identical.
- Response: `ok:true, saved:true, mapChanged:true, activityChanged:false,
  functionChanged:false, remoteRefreshed:true, synced:false`, new revision
  `<revAfter>`, configVersion 625. Publish confirmed.
- Post-write re-fetch: revision advanced; exactly the 2 intended maps differ;
  VolumeMute long = PowerToggle `EventType` 2 in both; device count still 10.
- Hub SyncCounter after: syncCount 0, no conflicts. Touch SyncCounter check is
  deferred (Touch untethered; retrospective log after re-tether per P21 method).
- Revert: restore the step's pre-copy of the two maps through the same writer,
  then publish (not needed; step passed).

## Press verification (owner pressed, assistant captured hub `logread -f`)

Method: one continuous hub capture across the presses; verbs counted on
single-per-verb handler lines; each execution = one `fire` + one `pressType` +
one `ltcp` notify.

- 13 press sequences: 10 short + 3 long. 13 fires, 13 `pressType`, 13 notifies.
- Short (10x): `press` → `release` (no `hold`s, ~150–200 ms) → one `fire`
  PowerToggle + one `pressType` short (59 B) + one notify. Nothing runs on press.
- Long (3x): `press` → `hold`s at ~300 ms cadence → one `fire` at the 2nd hold +
  one `pressType` long (58 B); later holds are heartbeats (no fire, no notify);
  `release` runs nothing.
- Exactly 1 fire per sequence in all 13 cases. No double-fire, no missing fire.
- Lamp (owner watched): toggled exactly once per press — each tap once, each long
  hold once, never twice.
- Log artifact (not behavior): one `press` handler line is absent inside a
  `hal[272]` stats burst (~15:24:00.7); its engine req/res (200) and all later
  verbs are present and the sequence behaves identically. Parser-level only.
- Result: **S1 PASS** for both (a) tap and (b) hold. U1 (P22 §7) is now PROVEN
  for IP: a self-long gives exactly one send per press, tap or hold.

## Surprises / notes

1. Cast `SkipForward`/`SkipBack` arrived via writer push before S1 (see baseline).
   No action needed; S5/S7 bindings for them remain as designed (hard FF/Rew).
2. The Touch pulled the pre-S1 publish on its own after S0 (owner confirmed normal
   use + cast control). It pulls the S1 publish the same way; no menu Sync used.
3. The old double-toggle hazard on this key is gone: a ≥300 ms press can no
   longer double-fire.

## Cannot determine here

- Exact HTTP POST count (no HA listener; hub fire+notify is the proxy, per P22).
- Touch-side retrospective log + Touch SyncCounter (after re-tether).

## Files

- Results: `Remote-Feature-Correction/results/P23-S1-self-long.md` (this file;
  untracked, not added).
- Private (`/tmp/melodious-research/private/p22-s1/`, mode 700):
  `activity-config.json` (before), `proposed-config.json`,
  `activity-save-payload.json`, `activity-save-response.json`,
  `activity-config-after.json`, `hub-s1-press.log`.
