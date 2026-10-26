# P27 S5: six cast transport keys in the audio activity (write + press verification)

Date: 2026-10-26. Prompt: `prompts/03-P11-P13-P16-HA-footprint.md` §6 step S5.
Builds on: `results/P22-HA-footprint.md` … `P26-S4-lamp-gestures.md`.
Owner approval: S5 approved with FastForward/Rewind included (since
`SkipForward`/`SkipBack` are now live on `<deviceCCA>`); owner pressed and
judged Pass.

**Write performed: one approved step.** Added 6 hard keys to `16417Activity<M>`
and its `16414Activity<M>` mirror, all targeting `<deviceCCA>` (non-member of
`<activityM>`):
- plain idempotent (`EventType` 1, no long): `Play` → Play, `Pause` → Pause,
  `Stop` → Stop;
- self-long (`EventType` 1 + `ButtonLongPressAction` `EventType` 2, same
  device/command): `Select` → PlayPause, `FastForward` → SkipForward,
  `Rewind` → SkipBack (self-long on Skip prevents accidental double-track skips
  on slow taps).
Existing IR volume keys (`VolumeUp`/`VolumeDown`/`VolumeMute` → `<deviceRCV>`)
were left unchanged. New `ButtonId`s allocated past the global max.

## Pre-write baseline (read-only)

- Fresh `activity-config` revision = post-S4 revision (no intervening pushes).
- Target maps (`16414Activity<M>` and `16417Activity<M>`): 3 hard keys each
  (IR volume on `<deviceRCV>`).
- `<deviceCCA>` verified to hold all 11 commands (`PowerOn`, `PowerOff`,
  `VolumeUp`, `VolumeDown`, `Mute`, `Play`, `Pause`, `PlayPause`, `Stop`,
  `SkipForward`, `SkipBack`).
- Hub SyncCounter: syncCount 0, no conflicts.

## The write

- Payload: `activity-save` with fresh `baseRevision`, `syncRemote=false`,
  activity/function lists identical, only the two `<activityM>` maps changed
  (3 → 9 buttons + `DateModified` each).
- Response: `ok:true, saved:true, mapChanged:true, activityChanged:false,
  functionChanged:false, remoteRefreshed:true`, configVersion 629. Published.
- Post-write re-fetch: revision advanced; only the 2 maps differ; all 6 new
  hard keys present with expected device/command/long; device count still 10.
- Hub SyncCounter after: syncCount 0, no conflicts. Touch check deferred
  (untethered; retrospective log after re-tether per P21 method).
- Revert: restore the step's pre-copy of the two maps through the same writer
  (not needed; step passed).

## Press verification (owner pressed, assistant captured hub `logread -f`)

- Activity switch `<activityL>` → `<activityM>` observed at the start of the
  capture (`<deviceHA1>` `poweroff` fire on leave, `<deviceRCV>` `poweron` fire
  on enter — `<deviceCCA>` is a non-member, so no cast power command ran at
  activity start, confirming the P22 §2.4 design).
- All 6 new `<deviceCCA>` hard keys executed cleanly as a non-member of
  `<activityM>`:
  - `Play` (2x), `Pause` (1x), `Stop` (1x): plain `press` → `release`, 1
    execution + 1 `ltcp` notify each, no holds, no `pressType`;
  - `Select` → `PlayPause` (2x, held with 4 and 3 `hold` verbs): self-long
    fired once at the 2nd hold (`modifier: fire`, `pressType` 58 long, 1 notify
    each; later holds heartbeats; release nothing);
  - `FastForward` → `SkipForward` (6x taps) and `Rewind` → `SkipBack` (2x
    taps): self-long fired once at release (`modifier: fire`, `pressType` 59
    short, 1 notify each).
- Total `<deviceCCA>` executions: 14 (4 plain press + 10 self-long fire), each
  paired with 1 `ltcp` notify (plus the 1 `<deviceHA1>` leave-activity notify =
  15 IP notifies; 18 total in window).
- Existing IR `VolumeUp` on `<deviceRCV>` (transport 1) also continued to work
  alongside the non-member HA keys (19 presses).
- Audio / cast behavior (owner watched): "Pass. Done."
- Result: **S5 PASS** (all 6 cast hard keys verified in `<activityM>`,
  non-member media-player routing + self-long on PlayPause and SkipForward/Back
  proven).

## Surprises / notes

- First background `logread -f` exited before the presses (SSH disconnect right
  after publish); a fresh `logread -f` was started before the owner pressed and
  captured the entire activity switch and press run cleanly.

## Cannot determine here

- Exact HTTP POST count (no HA listener; hub notify is the proxy).
- Touch-side retrospective log + Touch SyncCounter (after re-tether).

## Files

- Results: `Remote-Feature-Correction/results/P27-S5-cast-hard-keys.md` (this
  file; untracked, not added).
- Private (`/tmp/melodious-research/private/p22-s5/`, mode 700):
  `activity-config.json` (before), `proposed-config.json`,
  `activity-save-payload.json`, `activity-save-response.json`,
  `activity-config-after.json`, `hub-s5-press.log`, `hub-s5-full.log`,
  `hub-s5-press2.log`.
