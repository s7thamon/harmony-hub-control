# P24 S2: eight lamp On/Off rows in the lamp activity (write + press verification)

Date: 2026-10-26. Prompt: `prompts/03-P11-P13-P16-HA-footprint.md` §6 step S2.
Builds on: `results/P22-HA-footprint.md`, `results/P23-S1-self-long.md`.
Owner approval: S2 approved; owner pressed and judged Pass.

**Write performed: one approved step.** Added 8 soft rows (FGT 0, idx 0–7) to
`16417Activity<L>` only (Touch surface; no 16414 mirror for soft rows):
idx 0/1 `<deviceHA1>` On/Off, 2/3 `<deviceHA2>` On/Off, 4/5 `<deviceHA3>` On/Off,
6/7 `<deviceHA4>` On/Off. All plain press actions (`EventType` 0,
`FunctionId-` 0); labels `L1 On` … `L4 Off` (renamable later; G5 covers renames).
New `ButtonId`s allocated past the global max; no collisions.

## Pre-write baseline (read-only)

- Fresh `activity-config` revision = post-S1 revision (no intervening pushes).
- Target map: 3 hard buttons only (VolumeUp/Down/Mute, Mute already self-long).
- Hub SyncCounter: syncCount 0, no conflicts.

## The write

- Payload: `activity-save` with fresh `baseRevision`, `syncRemote=false`,
  activity/function lists identical, only `16417Activity<L>` changed (3 → 11
  buttons + `DateModified`).
- Response: `ok:true, saved:true, mapChanged:true, activityChanged:false,
  functionChanged:false, remoteRefreshed:true`, configVersion 626. Published.
- Post-write re-fetch: revision advanced; exactly 1 map differs; all 8 rows
  present with correct device/command/index; device count still 10.
- Hub SyncCounter after: syncCount 0, no conflicts. Touch check deferred
  (untethered; retrospective log after re-tether per P21 method).
- Revert: restore the step's pre-copy of the map through the same writer
  (not needed; step passed).

## Press verification (owner pressed, assistant captured hub `logread -f`)

- 12 taps observed, 0 holds: each tap = `press` → `release`, one `he.m.device`
  press execution + one release line (transport echo) + one `ltcp` notify.
  Exactly 1 POST-equivalent per tap; no repeats, no drops.
- Coverage: every one of the 8 rows executed at least once (all four lamps On
  and Off). `<deviceHA2>`…`<deviceHA4>` rows ran from `<activityL>` although
  those devices are not activity members — non-member HA routing works (P13/G9
  partial proof).
- No `pressType` broadcasts (expected: plain rows, no long arming).
- The dedicated ~1 s hold was not observed in this capture (0 hold verbs); the
  owner judged the step Pass on lamp behavior. Hold-repeat on these rows is
  definitionally harmless (idempotent On/Off; repeats converge to the same
  state), and hold cadence + per-hold notify on the IP path are already proven
  (G4, S1). Hold-ramp on a row remains covered by the deferred S6-row-2/3 check
  (U8) if stricter proof is wanted.
- Lamp (owner watched): correct lamp responded to every row; step judged Pass.
- Result: **S2 PASS** (tap semantics + non-member routing proven for all 8 rows).

## Surprises / notes

- None. No intervening writer pushes during S2; Touch pulled the publish on its
  own (owner used the new rows normally).

## Cannot determine here

- Exact HTTP POST count (no HA listener; hub notify is the proxy).
- Touch-side retrospective log + Touch SyncCounter (after re-tether).

## Files

- Results: `Remote-Feature-Correction/results/P24-S2-lamp-rows.md` (this file;
  untracked, not added).
- Private (`/tmp/melodious-research/private/p22-s2/`, mode 700):
  `activity-config.json` (before), `proposed-config.json`,
  `activity-save-payload.json`, `activity-save-response.json`,
  `activity-config-after.json`, `hub-s2-press.log`.
