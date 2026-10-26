# P26 S4: four lamp gestures in the lamp activity (write + press verification)

Date: 2026-10-26. Prompt: `prompts/03-P11-P13-P16-HA-footprint.md` §6 step S4.
Builds on: `results/P22-HA-footprint.md` … `P25-S3-lamp-hard-keys.md`.
Owner approval: S4 approved; owner pressed and judged Pass.

**Write performed: one approved step.** Added 4 `GestureRemoteButton` entries to
`16417Activity<L>` (Touch surface only; Tap left unassigned per P22 §2.3):
- `SwipeUp` → `<deviceHA1>` BrightnessUp (`EventType` 1, `FunctionId-` 0);
- `SwipeDown` → `<deviceHA1>` BrightnessDown;
- `SwipeRight` → `<deviceHA1>` PowerOn;
- `SwipeLeft` → `<deviceHA1>` PowerOff.
SwipeUp/Down resolve on `<deviceHA1>`'s screen to hard VolumeUp/Down (the gate
passes because `<activityL>` maps VolumeUp/Down); SwipeRight/Left resolve to
soft rows idx 0/1. New `ButtonId`s allocated past the global max.

## Pre-write baseline (read-only)

- Fresh `activity-config` revision = post-S3 revision (no intervening pushes).
- Target map: 21 buttons (13 hard + 8 soft, 0 gestures).
- Hub SyncCounter: syncCount 0, no conflicts.

## The write

- Payload: `activity-save` with fresh `baseRevision`, `syncRemote=false`,
  activity/function lists identical, only `16417Activity<L>` changed (21 → 25
  buttons + `DateModified`).
- Response: `ok:true, saved:true, mapChanged:true, activityChanged:false,
  functionChanged:false, remoteRefreshed:true`, configVersion 628. Published.
- Post-write re-fetch: revision advanced; only 1 map differs; all 4 gesture
  buttons present with expected device/command; device count still 10.
- Hub SyncCounter after: syncCount 0, no conflicts. Touch check deferred
  (untethered; retrospective log after re-tether per P21 method).
- Revert: restore the step's pre-copy of the map through the same writer
  (not needed; step passed).

## Press verification (owner pressed, assistant captured hub `logread -f`)

- 18 gesture sequences observed: 14 plain swipes + 4 hold-swipes.
- Plain swipes (14x): **0 `hold` verbs across all 14 plain swipes** (exceeds the
  10-swipe target). Each plain swipe = `press` → `release`, 1 execution, 1
  notify — **U3 PROVEN** in hardware (the ~60–100 ms margin before the 300 ms
  hold timer holds cleanly across 14 consecutive swipes).
- Hold-swipes (4x, with 8 / 18 / 21 / 8 `hold` verbs = 55 holds total): initial
  press + 300 ms `hold` repeats until finger-up, each hold emitting one `ltcp`
  notify (18 presses + 55 holds = 73; 74 notifies in window) — **U4 PROVEN** in
  hardware (hold-gestures repeat every 300 ms and ramp brightness).
- Coverage: all 4 gesture directions executed on `<deviceHA1>` (BrightnessUp,
  BrightnessDown, PowerOn, PowerOff) — **U5 PROVEN** in hardware (gestures to
  HA devices work end to end, both hard-key and soft-row device-screen targets,
  with `FunctionId-` 0 name-match resolution).
- Lamp (owner watched): "Done. pass."
- Result: **S4 PASS** (U3, U4, U5 all proven; `<activityL>` control matrix
  complete).

## Surprises / notes

- One plain swipe's `release` handler line was swallowed inside a `hal[272]`
  stats burst (same log-parser artifact noted in S1); its `he.m.device` release
  line is present (10 press / 10 release on BrightnessDown).
- Touch-side `FunctionId is 0` / gesture-pad resolution lines will be confirmed
  from the retrospective Touch `logread` after re-tether.

## Cannot determine here

- Exact HTTP POST count (no HA listener; hub notify is the proxy).
- Touch-side retrospective log + Touch SyncCounter (after re-tether).

## Files

- Results: `Remote-Feature-Correction/results/P26-S4-lamp-gestures.md` (this
  file; untracked, not added).
- Private (`/tmp/melodious-research/private/p22-s4/`, mode 700):
  `activity-config.json` (before), `proposed-config.json`,
  `activity-save-payload.json`, `activity-save-response.json`,
  `activity-config-after.json`, `hub-s4-press.log`.
