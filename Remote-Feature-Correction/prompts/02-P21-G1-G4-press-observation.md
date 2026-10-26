# Prompt 02: P21 G1–G4, read-only press observation

Issued: 2026-10-25 · Plan: `plans/P21-hardware-validation-programme.md` (G1–G4) · Validator: the research agent

**Owner authorization.** By issuing this prompt the owner authorizes **only** this: the
owner presses physical buttons on the Harmony Touch, one at a time, when you ask. You (the
agent) perform **no writes and no sends of any kind**. Those presses do operate real household
devices; the owner picks harmless ones.

---

You are working with the Melodious / Harmony Hub Control project. Repository:
`~/Repos/harmony/harmony-hub-control`. Your task: **observe, read-only, how real Harmony Touch
presses reach the hub and what the hub executes**. This settles questions the later plans
depend on.

## Read first

1. `Remote-Feature-Correction/plans/P21-hardware-validation-programme.md`: steps G1–G4.
2. `Remote-Feature-Correction/corpus/02-touch-input-and-ui.md` §5, §7, §10;
   `corpus/03-touch-to-hub-transport.md`; `corpus/04-hub-button-resolution.md`;
   `corpus/05-press-semantics.md`; `corpus/23-open-questions.md` (rows 1–6).
3. `Remote-Feature-Correction/corpus/25-safety-and-operating-rules.md`.

## Access (read-only is always allowed)

| Device | Command | Notes |
|---|---|---|
| Hub | `ssh -i ~/.ssh/harmony_owner_ed25519 root@<hub>` | BusyBox: no `head`/`df` |
| Touch | `ssh -i ~/.ssh/harmony_owner_ed25519 -o UserKnownHostsFile=/tmp/melodious-touch-usb/known_hosts root@192.168.2.1` | USB Ethernet; the Mac interface is configured as 192.168.2.2/24 (en10 earlier); no `tar` |

- **Allowed:** `logread`, `logread -f` (as a stream into a local file), `cat` of
  `/data/resources/*.json` and `/data/loggly/SyncCounter.json`, `ps`, `ls`, `md5sum`.
- **Not allowed:**
  - any write, upload, edit, install, reboot, process restart or kill (other than your own
    SSH/`logread` sessions);
  - debug or log-level changes (no `-ltcplog`, no log-level toggles);
  - sync triggers;
  - hub HTTP endpoints that act (activity start, `holdaction`, IR or HA sends, `/import`,
    any `/api/*` POST);
  - Home Assistant calls.
- "GET", "status" and "dryRun" labels don't prove an operation is side-effect-free. If unsure,
  don't call it.
- If the Touch's SSH goes quiet, it is probably **asleep**:
  - ask the owner to **tap the screen once** to wake it. The first tap after sleep is
    swallowed and sends nothing;
  - never use a hard key to wake it, since that would send a command;
  - never reboot.
- Note in every result whether the Touch is on USB. On USB it still sleeps (about 29 s screen
  timeout) and only receives notifies while awake.

## Data handling

- Raw logs and resource copies go in `/tmp/melodious-research/private/g1-g4/` (`mkdir -p`,
  `chmod 700`). They contain household IDs and names: **never** put them in the repository or
  in your report.
- Your report and the results file use **placeholders** only: `<activityA>`, `<deviceTV>`,
  `<deviceHA1>`, `<idx>`. Don't include device, activity or entity names, IDs, URLs or webhook
  IDs.
- Write the results file to
  `~/Repos/harmony/harmony-hub-control/Remote-Feature-Correction/results/P21-G1-G4.md`
  (create `results/`). This folder is untracked by design; **don't `git add` anything**.

## What the logs can show (source-verified)

- **Hub:**
  - `cs.c.engine … processMessage(req): [ transport: … ] [ id: … ] [ cmd: control.button?press|hold|release|fire ]`
    (`connectserver/core/engine.lua:135`);
  - `he.m.device … device: [ id: … ] [ name: … ] [ command: … ] [ modifier: press|hold|release|fire ] [ transport: … ]`
    for each executed command (`harmonyengine/model/device.lua:178`);
  - `Button map not found: <id>` / `Button: <name> not found in buttonmap: <id>`
    (`apihandler/activity.lua` buttonPress).
- **Touch:**
  - hal `libhal_hbus_command` lines for `hot.1.*` requests;
  - gesture-pad lines `Gesture Callback Event =`, `FunctionId is`,
    `Sending press command for <ButtonKey>` (`luadraws/juniper/gesturepad.lua`);
  - notify-related lines.
- Payload fields such as `indexInMenu` or `deviceId` are **not** logged at the default level.
  Infer them from *which map and command executed*, and say when something can't be
  determined. Don't enable extra logging to get them.

## Preparation (read-only)

1. Confirm hub SSH and Touch SSH work. Record each device's `uname -r` and the current hub
   time.
2. Copy the hub's `MapList.json`, `DeviceList.json` and `ActivityList.json` to the private
   directory. From them, work out (privately) the candidates below, and tell the owner
   **in chat** exactly what to press. Names are fine in chat; keep them out of files.
   - **G1:**
     - an activity the owner is happy to have running (or already running);
     - one hard key mapped in its `16417Activity` map;
     - one on-screen button on its activity page;
     - one number-pad digit (only if that activity's 16417 map has FGT 2 buttons);
     - one swipe gesture (only if that map has `GestureRemoteButton`s; prefer a
       volume-type action).
   - **G2:** the Logitech-made device screen whose `16417Device` map has a FGT 0 and a FGT
     1006 soft button at the **same** `IndexInMenu`. Identify both rows' labels and the
     command each would run, and predict the result. Corpus §04 predicts **both rows run the
     button that comes later in the map's array**.
   - **G3:** a hard key with a `ButtonLongPressAction` in an activity the owner is happy to
     use. Record its short and long commands.
   - **G4:** an HA device's on-screen button whose command is **idempotent** (for example
     `PowerOn`). Repeats are then harmless, and the hub's `he.m.device` lines with modifier
     `hold` can be counted. Confirm the choice with the owner.
3. Read the Touch's `/data/loggly/SyncCounter.json` (baseline).

## Procedure (one step at a time)

For **each** step:
1. start fresh `logread -f` captures on the hub and on the Touch, into separate private files;
2. tell the owner the single action;
3. wait for the owner to say "done";
4. stop the captures;
5. extract the relevant lines.

Restart the captures every step, because the hub stream stalls after a few minutes.

| Step | Owner action | What to determine | Prediction to confirm or contradict |
|---|---|---|---|
| G1a | press the hard key once (short) | verb sequence on the hub; map used; command executed | `press` then `release`; `16417Activity<cur>`; the mapped command |
| G1b | tap the on-screen button once (quick tap) | verbs; executed command; any `hold` | `press`, `release`; no `hold` for a tap under 300 ms |
| G1c | press one number-pad digit | verb; command | a single `fire`; no `release` |
| G1d | one swipe on the gesture pad | Touch gesture lines (event, FunctionId, "Sending press command for …"); hub map and command | the Touch resolves it to a device-map button; the hub executes on the **device** map (`deviceId` present); no `SwipeUp` key reaches the hub |
| G2 | tap row 1 of the shared-index pair, then (as a separate step) row 2 | the executed command for each | both run the later-in-array button |
| G3a/b/c | hold the long-press key for about 0.4 s, 0.7 s and 1.5 s (three separate steps) | hub verbs; which command ran; any `pressType` notify in the Touch log; holds' timing | 0.4 s → short at release; 0.7 s and 1.5 s → long once (threshold about 600 ms) |
| G4 | hold the HA on-screen button for about 1 s | count the hub `he.m.device` lines for that command by modifier | 1 `press` + about 2–3 `hold`; `release` sends no HTTP |

## Stop conditions

Stop and report at once if:
- any device behaves unexpectedly;
- the Touch shows an error, link-lost or sync screen;
- SyncCounter shows a new abort;
- a log shows anything that looks like a write or sync triggered by you.

## Finish

Read SyncCounter again; it should be unchanged unless a sync happened on its own (report
it). Write the results file, using the template below as its body.

## Report back (exact format)

```text
PREFLIGHT: hub ssh OK/FAIL (kernel), touch ssh OK/FAIL (kernel), touch tethered: yes/no
SYNCCOUNTER before/after: <same | changed: how>  (no IDs)
STEP RESULTS:
  [G1a] action | hub verbs seen | map+command (placeholders) | CONFIRMED/CONTRADICTED/INCONCLUSIVE | evidence (sanitized log excerpt)
  [G1b] …
  [G1c] … (or SKIPPED: no number pad in that map)
  [G1d] … (include the Touch gesture lines, sanitized)
  [G2]  row1 → <command placeholder>, row2 → <command placeholder> | …
  [G3a/b/c] …
  [G4]  press:N hold:N release:N fire:N | …
SURPRISES: <anything not predicted>
CANNOT DETERMINE: <which fields or questions the default logs can't answer>
RESULTS FILE: <path>
PRIVATE FILES: <paths>
WRITES PERFORMED: none   (if anything else, explain)
```

Stop after the report. Don't start any other step or plan.
