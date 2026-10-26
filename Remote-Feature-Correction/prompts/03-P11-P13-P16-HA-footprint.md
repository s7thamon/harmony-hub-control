# Prompt 03: HA footprint maximization — map every Home Assistant entity to Touch controls

Issued: 2026-10-26 · Builds on: `results/P21-G1-G4.md` (G1–G4 verified) · Plans: P11, P13, P16

**Owner authorization.** This prompt authorizes research and proposals only. Every
hardware write step (resource edits, publishes, syncs, activity runs, button sends)
needs the owner's explicit approval **for that step**, one step at a time, stopping at
the first surprise. The standing P21 preparation rules (fresh `logread -f` captures per
step, Touch wake discipline, SyncCounter before/after) apply to any press step.

## Objective

Maximize what the Harmony Touch can do through Home Assistant instead of IR:
map any HA entity to any Touch control (on-screen button, hard key, gesture, number
pad), prefer LAN-routed HA commands over IR for devices that support both (e.g. the
LAN-capable TV currently driven by IR), and cover media devices (e.g. Chromecast Audio:
play, pause, volume, and whatever else the protocol exposes). Do NOT scope this to HA
button knowledge alone: the design must respect the Touch↔hub interface constraints
found during reverse engineering (listed below), or the mappings will silently drop.

## Read first

1. `results/P21-G1-G4.md` in full (do not re-run G1–G4; cite it).
2. `plans/P21-hardware-validation-programme.md` (G5–G10 still open).
3. Corpus: `02-touch-input-and-ui.md`, `03-touch-to-hub-transport.md`,
   `04-hub-button-resolution.md`, `05-press-semantics.md`, `07-ip-devices.md` (§7),
   `23-open-questions.md`, `25-safety-and-operating-rules.md`.

## Validated facts you must build on (not re-prove)

- Hard key: `press` → `hold` every ~300 ms → `release`. On-screen tap: `press`→`release`,
  no `hold` under ~300 ms. Number pad: single `fire`. Swipe: Touch resolves locally to a
  device-map button (name + FunctionId); hub sees an ordinary device-map press.
- Shared index (FGT 0 vs 1006): both rows run the later-in-map button.
- Long-press-armed key: short fires at release, long fires exactly once on the 2nd hold
  (~600 ms effective); later holds are heartbeats; release after long does nothing.
- Plain (non-armed) HA button: press + one identical action per 300 ms hold, nothing on
  release. Only idempotent commands (or strict tap-only use) are safe on plain buttons.
- Hub emits `pressType` broadcasts, but only for long-armed keys; the Touch log shows
  zero notify-receipt lines — never design around the Touch *displaying* feedback.
- Payload fields (`indexInMenu`, `deviceId`, `buttonKey`) are logged nowhere; correlate
  cross-device events by sequence (Touch clock wobbles seconds vs the steady hub clock).

## Interface constraints (violating these silently drops presses)

1. **Root-only home control:** `ButtonHomeControlAction` is honored only when the map
   identifier contains `Root`. In activity/device maps it logs "Device not found" and
   does nothing (corpus §04). HA control from activity/device screens must therefore
   ride `ButtonCommandAction` → device-command routing (the G4-verified path), never
   home-control actions.
2. **Stale filter:** any press dequeued >1000 ms after its Touch timestamp is discarded.
   Queue-blocking work (sequences, activity starts, 2 s home-control sleeps) kills
   presses queued behind it.
3. **Action-queue blocking:** one slow handler (sequence, activity start, slow HA plugin
   call) stalls every later message on that LTCP connection.
4. **500 ms webhook/queue deadline** on the HA path (corpus §25): slow or non-200
   endpoints trigger failure paths. `CommitHaDevices` dry run is the only verified
   side-effect-free probe (and it still takes the writer lock).
5. **Storage rules:** a soft button with no executable action is not stored; duplicate
   index → later wins; FGT 2 → `numPadButtons` (digits must parse as numbers);
   FGT 1006 unordered head; string `IndexInMenu` never matches; missing map = silent drop.
6. **Gesture limits:** gestures resolve Touch-side against `GestureRemoteButton`s of the
   *current activity's* map only; hard-key resolutions must pass the activity hard-key
   gate; IP steps in `holdaction`-started sequences are dropped.
7. **Transport reality:** verified transports are 1 (IR), 32 (BT HID), 64 (HA/IP). The
   box's commands execute over BT HID, not IR — audit every assumed-IR path.
8. **Tethered Touch is deaf and mute:** plugged in = locked screen, no live traffic;
   logs are retrospective ring-buffer only; USB gadget MAC changes per plug-in (Mac
   route must be re-set); dropbear comes up minutes after plug-in.

## Access (read-only is always allowed)

Same devices/commands as Prompt 02. Allowed: `logread`, `logread -f`, `cat` of
`/data/resources/*.json` + SyncCounter, `ps`, `ls`, `md5sum`. Not allowed: any write,
upload, edit, install, reboot, restart/kill, debug/level changes, sync triggers, any
hub endpoint that acts, Home Assistant calls. "GET"/"status"/"dryRun" labels prove
nothing — read the implementation first. Touch asleep ⇒ tap screen once to wake (never a
hard key); first tap after sleep is swallowed.

## Data handling

Raw logs/resources → `/tmp/melodious-research/private/` (mode 700), never the repo.
Reports/results use placeholders only
(`<activityA>`, `<deviceTV>`, `<deviceHA1>`, `<idx>`, …). Results folder is untracked;
**don't `git add` anything**. Sanitization check per corpus §25 before writing.

## Tasks

1. **Inventory (read-only).** From hub `DeviceList`/`AutomationConfig`/HA surface:
   enumerate every HA entity with its commands and classify each command as idempotent
   (safe to repeat), toggle (exactly-once required), or momentary. Note uids, transports,
   and which plugin path each takes (verify against corpus §07, not assumptions).
2. **Control matrix.** For each entity, specify the Touch controls it gets (on-screen
   rows with indexes, hard keys, gestures, number-pad digits where applicable) and the
   verb semantics of each (tap / hold-repeat / long-once), applying the G3/G4 rules so
   toggles can never double-fire from a hold.
3. **Chromecast Audio deep-dive.** Determine exactly which media operations the hub↔HA
   path exposes (play/pause/volume/others), which are idempotent, and bind each to the
   safest control shape. If an operation is unavailable through the current path, say so
   and name the blocking constraint — do not invent verbs.
4. **LAN migration design.** For each device currently IR-driven that HA reaches over
   LAN, design the replacement device-map bindings (activity + device screens), showing
   the before/after command routing per button and which IR bindings can be retired.
   Keep IR as fallback where HA coverage is partial; say exactly where.
5. **Map-ordering audit.** For every touched map, list index collisions, gap behavior,
   and FGT placement per the storage rules, so nothing renders wrong or drops.
6. **Implementation staging.** Propose the smallest ordered write sequence (per-map
   publishes), each step independently revertible, each with its own press-verification
   step reusing the G1–G4 capture method. Write NOTHING until the owner approves steps
   individually.

## Stop conditions

Stop and report at once if: any press/execution contradicts the G1–G4 baseline; a map
fails to load; SyncCounter moves without explanation; any press is silently dropped and
the cause is not one of the listed constraints; the Touch shows error/link-lost/sync
screens.

## Finish

Write results to `Remote-Feature-Correction/results/P22-HA-footprint.md` (create
`results/` if missing; untracked, don't add). Sanitized: counts, verbs, field names,
pass/fail — no IDs or names.

## Report back (exact format)

```text
PREFLIGHT: hub ssh OK/FAIL, touch ssh OK/FAIL, touch tethered: yes/no
INVENTORY: <# HA entities> (<# idempotent> / <# toggle> / <# momentary commands>) (no names)
MATRIX: <entity placeholder> → <controls + verb semantics> | …
CHROMECAST: <operations exposed> | <binding per operation> | <gaps + blocking constraint>
LAN-MIGRATION: <device placeholder>: <buttons rerouted IR→HA> | <IR retained where + why>
UNVERIFIED: <claims needing a press step, with step design>
SURPRISES: <anything contradicting G1–G4 or corpus>
CANNOT DETERMINE: <…>
RESULTS FILE: <path>
PRIVATE FILES: <paths>
WRITES PERFORMED: none   (if anything else, explain)
```

Stop after the report. Don't start any other step or plan.
