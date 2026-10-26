# P25 S3: six brightness keys and four colour toggles in the lamp activity (write + press verification)

Date: 2026-10-26. Prompt: `prompts/03-P11-P13-P16-HA-footprint.md` §6 step S3.
Builds on: `results/P22-HA-footprint.md`, `results/P23-S1-self-long.md`,
`results/P24-S2-lamp-rows.md`. Owner approval: S3 approved; owner judged Pass
after a paced retest.

**Write performed: one approved step.** Added 10 hard keys to `16417Activity<L>`
and its `16414Activity<L>` mirror:
- plain brightness (`EventType` 1, no long): ChannelUp/Down → `<deviceHA2>`
  BrightnessUp/Down, DirectionUp/Down → `<deviceHA3>` BrightnessUp/Down,
  DirectionRight/Left → `<deviceHA4>` BrightnessUp/Down;
- self-long toggles (`EventType` 1 + `ButtonLongPressAction` `EventType` 2,
  same device/command): Red/Green/Yellow/Blue → `<deviceHA1>`/`<deviceHA2>`/
  `<deviceHA3>`/`<deviceHA4>` PowerToggle.
New `ButtonId`s allocated past the global max; no duplicate keys.

## Pre-write baseline (read-only)

- Fresh `activity-config` revision = post-S2 revision (no intervening pushes).
- Target maps: `16414Activity<L>` had 3 hard keys; `16417Activity<L>` had 3 hard
  keys + 8 soft rows (11 total).
- Hub SyncCounter: syncCount 0, no conflicts.

## The write

- Payload: `activity-save` with fresh `baseRevision`, `syncRemote=false`,
  activity/function lists identical, only the two `<activityL>` maps changed
  (16414: 3→13 buttons, 16417: 11→21 buttons + `DateModified`).
- Response: `ok:true, saved:true, mapChanged:true, activityChanged:false,
  functionChanged:false, remoteRefreshed:true`, configVersion 627. Published.
- Post-write re-fetch: revision advanced; only the 2 maps differ; all 10 keys
  present with expected device/command/long; device count still 10.
- Hub SyncCounter after: syncCount 0, no conflicts. Touch check deferred
  (untethered; retrospective log after re-tether per P21 method).
- Revert: restore the step's pre-copy of the two maps through the same writer
  (not needed; step passed).

## Press verification (two hub `logread -f` captures: initial + paced retest)

### Run 1 (rapid presses right after publish)
- The Touch first pulled the new revision (`proxy.resource?get` burst at the top
  of the capture).
- All 10 new keys then executed on the hub with ~70–100 ms execution→notify
  deltas across all 4 lamps (143 notifies total; both `pressType` 59 short and
  `pressType` 58 long observed on colour keys).
- 3 rapid-burst messages hit the 1000 ms stale filter
  (`request discarded due to timestamp`, ~1.0–1.3 s delay) — direct hardware
  confirmation of constraint #2 under rapid mashing.
- Owner initially reported only Red seemed to act, likely from watching `<deviceHA1>`
  while the other 9 keys target `<deviceHA2>`…`<deviceHA4>` (plus rapid bursts).
  Triggered a paced retest per the stop-at-surprise rule.

### Run 2 (paced retest, ~2 s between presses, watching the matching lamp)
- An activity transition (`<activityA>` → `<activityL>`) appears at the start of
  the capture (`fire` leave/enter commands), then clean S3 key presses.
- Every one of the 10 new keys executed: all 6 brightness keys (with 80 `hold`
  verbs proving hold-to-ramp on the plain brightness keys) and all 4 colour
  toggles (10 `fire` executions, `pressType` 59 short on taps; long-hold single
  fire already proven in Run 1 with `pressType` 58). 188 notifies total; 1 stale
  discard during a fast ramp.
- Non-member hard keys (`<deviceHA2>`…`<deviceHA4>` in `<activityL>`) worked end
  to end — P13/G9 hard-key leg proven in hardware.
- Lamps (owner watched each matching lamp): "All works. Pass."
- Result: **S3 PASS** (all 6 brightness keys + ramp, all 4 self-long colour
  toggles short + long, non-member hard-key routing).

## Surprises / notes

1. Stale-filter discards (`>1000 ms`) appear in-log under fast key mashing /
   ramps (3 in Run 1, 1 in Run 2) — expected per corpus constraint #2, not a
   defect.
2. No other surprises; Touch pulled the publish automatically at the start of
   Run 1.

## Cannot determine here

- Exact HTTP POST count (no HA listener; hub notify is the proxy).
- Touch-side retrospective log + Touch SyncCounter (after re-tether).

## Files

- Results: `Remote-Feature-Correction/results/P25-S3-lamp-hard-keys.md` (this
  file; untracked, not added).
- Private (`/tmp/melodious-research/private/p22-s3/`, mode 700):
  `activity-config.json` (before), `proposed-config.json`,
  `activity-save-payload.json`, `activity-save-response.json`,
  `activity-config-after.json`, `hub-s3-press.log`, `hub-s3-retest.log`.
