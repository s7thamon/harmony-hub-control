# P28 S6: five cast on-screen rows in the audio activity (write + press verification)

Date: 2026-10-26. Prompt: `prompts/03-P11-P13-P16-HA-footprint.md` §6 step S6.
Builds on: `results/P22-HA-footprint.md` … `P27-S5-cast-hard-keys.md`.
Owner approval: S6 approved; owner pressed and judged Pass.

**Write performed: one approved step.** Added 5 soft rows (FGT 0, idx 0–4) to
`16417Activity<M>` (Touch surface only), all targeting `<deviceCCA>` (non-member
of `<activityM>`):
- idx 0 `Cast On` → PowerOn (`EventType` 0, plain);
- idx 1 `Cast Off` → PowerOff (`EventType` 0, plain);
- idx 2 `Cast Vol +` → VolumeUp (`EventType` 0, plain);
- idx 3 `Cast Vol -` → VolumeDown (`EventType` 0, plain);
- idx 4 `Cast Mute` → Mute (`EventType` 0 + `ButtonLongPressAction` `EventType` 2,
  same device/command — self-long on a soft row, testing U2).
New `ButtonId`s allocated past the global max; no index collisions or gaps.

## Pre-write baseline (read-only)

- Fresh `activity-config` revision = post-S5 revision (no intervening pushes).
- Target map (`16417Activity<M>`): 9 hard buttons (3 IR volume + 6 cast transport),
  0 soft rows.
- Hub SyncCounter: syncCount 0, no conflicts.

## The write

- Payload: `activity-save` with fresh `baseRevision`, `syncRemote=false`,
  activity/function lists identical, only `16417Activity<M>` changed (9 → 14
  buttons + `DateModified`).
- Response: `ok:true, saved:true, mapChanged:true, activityChanged:false,
  functionChanged:false, remoteRefreshed:true`, configVersion 630. Published.
- Post-write re-fetch: revision advanced; only 1 map differs; all 5 soft rows
  present with expected index/device/command/long; device count still 10.
- Hub SyncCounter after: syncCount 0, no conflicts. Touch check deferred
  (untethered; retrospective log after re-tether per P21 method).
- Revert: restore the step's pre-copy of the map through the same writer
  (not needed; step passed).

## Press verification (owner pressed, assistant captured hub `logread -f`)

- 30 executions on `<deviceCCA>` across all 5 rows, paired 1:1 with 30 `ltcp`
  notifies:
  - idx 0 `Cast On` (`PowerOn`, 2x) and idx 1 `Cast Off` (`PowerOff`, 1x):
    plain `press` → `release`, 1 execution + 1 notify each (**U9 confirmed** in
    hardware);
  - idx 2 `Cast Vol +` (`VolumeUp`, 16x) and idx 3 `Cast Vol -` (`VolumeDown`,
    9x): plain `press` → `release`, 1 execution + 1 notify per tap (**U8 tap
    stepping confirmed**);
  - idx 4 `Cast Mute` (`Mute` with self-long, 2x):
    - **U2 short-leg PROVEN on a soft row:** on `press`, the hub armed the
      long-press state and executed **nothing**; at `release` (~97 ms and ~62 ms
      later), the hub emitted `pressType` 59 (short) and executed `mute` once
      with `modifier: fire` + 1 notify. This proves `SoftRemoteButton` entries
      with `ButtonLongPressAction` enter the exact same hub long-press state
      machine (`activity.lua:1937-1963`) as `HardRemoteButton` entries.
    - Both Mute presses in this capture had 0 `hold` verbs (press→release <100 ms);
      either both were quick taps or the Touch UI released the soft row before
      300 ms. Because the hub long-press state machine is shared and already
      armed on `press` (proven by `modifier: fire` + `pressType` 59 at release),
      any `hold` verbs that do arrive on a soft row take the identical 2nd-hold
      long branch proven in G4/S1/S3/S5; if the Touch does not emit holds on a
      soft row in this screen, the row is single-shot at release regardless.
      Either way, row 4 cannot repeat or double-toggle.
- Audio / cast behavior (owner watched): "Done. Pass."
- Result: **S6 PASS** (all 5 cast rows verified; U2 short-arming on a soft row,
  U8 tap stepping, and U9 power rows confirmed).

## Surprises / notes

- One `volumedown` press handler line was swallowed inside a `hal[272]` stats
  burst (same log-parser artifact noted in S1/S4); its engine req/res and
  `he.m.device` press/release lines are present (9 press / 9 release).

## Cannot determine here

- Exact HTTP POST count (no HA listener; hub notify is the proxy).
- Whether the 2nd Mute press was a quick finger tap or a held soft row whose
  hold timer was not armed by the Touch UI — the retrospective Touch `logread`
  (`touchPress`→`touchRelease` delta) after re-tether will show which.

## Files

- Results: `Remote-Feature-Correction/results/P28-S6-cast-rows.md` (this file;
  untracked, not added).
- Private (`/tmp/melodious-research/private/p22-s6/`, mode 700):
  `activity-config.json` (before), `proposed-config.json`,
  `activity-save-payload.json`, `activity-save-response.json`,
  `activity-config-after.json`, `hub-s6-press.log`.
