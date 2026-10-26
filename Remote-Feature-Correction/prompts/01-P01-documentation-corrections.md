# Prompt 01: P01 Documentation corrections

Issued: 2026-10-25 · Plan: `plans/P01-documentation-corrections.md` · Validator: the research agent

---

You are working in the Melodious / Harmony Hub Control repository at
`~/Repos/harmony/harmony-hub-control`. Your task is **plan P01: documentation corrections**.
It is documentation only. No code, no devices.

## Background (read these first, in order)

1. `Remote-Feature-Correction/README.md` explains what this folder is.
2. `Remote-Feature-Correction/plans/00-framework.md` sets the rules every plan follows.
3. `Remote-Feature-Correction/plans/P01-documentation-corrections.md` is **your task**. Its
   Evidence table lists every statement to correct.
4. The supporting corpus pages: `corpus/05-press-semantics.md`,
   `corpus/07-ip-device-engine-reference.md`, `corpus/10-sync-and-publication.md`,
   `corpus/12-map-generators.md`, `corpus/14-validators.md`,
   `corpus/21-contradictions-resolved.md`.

The `Remote-Feature-Correction/` folder is **untracked on purpose**. Read it, but never
`git add` it.

## Hard rules

- **No device access of any kind.** Don't SSH to the hub (`<hub>`) or the Touch
  (192.168.2.1), and don't call any hub HTTP endpoint or Home Assistant.
- Documentation only: don't change code, tests, payload files or the Android project.
- **Verify before you write.** For every correction, open the cited source lines yourself
  and confirm the claim before editing. The source trees are read-only references:
  - hub engine: `~/Repos/harmony/re/luaworks/`;
  - Touch UI: `~/Repos/harmony/re/touch-fw/cs/rootfs/opt/luadraws/`. That is a mounted
    case-sensitive sparsebundle; if it isn't mounted, say so and verify only what you can.
    Don't try to mount, extract or modify it.
  - Touch engine: `~/Repos/harmony/re/touch-fw/luaworks-dec/luaworks/`;
  - Melodious code in this repository.

  If a claim doesn't hold up, **don't make that edit**; report it instead.
- Keep each document's voice, structure and level of detail. Make minimal edits. Where a doc
  records a dated hardware result (for example "Results, 2026-10-24"), don't rewrite history:
  add a short dated "Later finding (2026-10-25): …" line that points at the newer fact.
- Never add household data: device, activity or entity names, IDs, emails, URLs, webhook
  IDs. Don't copy example values out of `docs/SESSION_HANDOFF.md`, which contains household
  details.
- Git:
  - you are on `main` and must not commit there. Create the branch
    `docs/p01-documentation-corrections` from `main` and check you are on it before
    committing;
  - stage files **by explicit path only**; never `git add -A` or `git add .`. The untracked
    `Android/HANDOFF.md`, `UI_Redesign_Gemini.md` and `Remote-Feature-Correction/` must stay
    untracked and untouched;
  - make one commit, with a conventional message such as
    `docs: correct HA, handoff and Touch editor notes against current source`;
  - **don't push and don't open a PR.** The owner and validator review first.
- `~/Repos/harmony/re/` is **not** a git repository. Before editing the two files there,
  copy each to `/tmp/p01-backup/` (create it) so the edit can be undone, and list the
  backups in your report.

## What to change

### 1. `docs/HOME_ASSISTANT.md`

| Lines (approx.) | Current claim | Correct statement | Verify at |
|---|---|---|---|
| ~23-24 | a held key repeats about every 250 ms | the Harmony Touch sends `hold` every **300 ms**, and the hub sends one more identical POST per hold. Other clients differ: the web UI keeps a hub-side hold alive with a 200 ms heartbeat. | `luadraws/appscommon/harmony.lua:2435-2441`; `luaworks/tasks/harmonyengine/apihandler/activity.lua:697-699`; `luaworks/tasks/harmonyengine/core/ipmanager.lua:306-323`; `tools/webui-sim/public/js/views/key-repeat.js:1-20` |
| ~25-26 | plain http only because of LuaSocket 2.0.2 | the engine's HTTP client can do TLS with certificate checking, but the hub's certificate bundle lacks the Let's Encrypt root (ISRG Root X1), so in practice the webhook must be plain `http://`. Keep "Host has no port". | `luaworks/works/http.lua:20-68`; `luaworks/works/sandbox.lua:46`; `luaworks/tasks/connectserver/core/rcmgr.lua:63-100`; `luaworks-share/socket/http.lua:206-219` |
| ~43-47 (rule 3) | `KeyCode: ""` is required | `KeyCode` may be `""` or null for IP commands (`""` only logs a harmless "Invalid command" at load); `Raw: null` **must** be present | `luaworks/tasks/harmonyengine/loader/userconfigreader.lua:514-525` |
| ~49-51 (rule 4) | a 404 or no answer makes the engine run an SSDP rescan | add: only for a device with an `AutoDetectedDevice.Id`, on a 404 **or no answer**, at most **once per 24 h**, and the scan blocks the IP task for about 10-35 s, so queued IP commands expire | `ipmanager.lua:578-608` |
| ~59-77 ("Saving: why only the writer reaches the Touch") | raw writes keep the old etag, so the hub answers 304 and the Touch keeps its copy | rewrite the explanation. **With the cloud blocker on** (the normal Melodious setting), `netservicestarter.lua`'s override always answers 200 with the file on disk, so the etag isn't what stops the Touch. The Touch syncs only when a publish bumps both `stateVersion` and `configVersion`. Raw writes depend on which hub task picks up the reload flag: `codexactivity` reloads **and publishes**; `codexmqtt` reloads **without** publishing. The 304 explanation holds only with the blocker **off** (stock handler). The conclusion is unchanged: write through `resMgr.saveResource` + publish. | `payload/scripts/netservicestarter.lua:574-619`; `luaworks/tasks/harmonywebservices/core/resourcemanager.lua:427-462`; `luaworks/tasks/harmonywebservices/apihandler/resource.lua:18-24`; `luadraws/appscommon/harmony.lua:4268-4283`; `payload/activity/codexactivity.lua:2352-2383, 763-780`; `payload/mqtt/codexmqtt.lua:54-71` |
| ~203-206 | the writer has no lock; overlapping requests make one wait 45 s and answer 503 | requests now queue on a writer lock (`flock`, up to 50 s); 503 means the lock or the 45 s reply wait timed out | `payload/source/codex_webui.c:2734-2807` |
| ~213-214 ("Results, 2026-10-24") | tapping the device on the Touch does nothing | keep the line; add "Later finding (2026-10-25): PR #61 builds a `16417Device<id>` screen for every HA device; tapping it now opens a working screen." | `payload/activity/codexactivity.lua:1269-1529`; `docs/API.md` "Touch device screens" |
| ~226-230 ("Not tested") | the web activity editor writes hard buttons only to 16414 | keep the line; add a later finding: the web and Android **wizards** mirror hard keys into `16417Activity<id>` (PR #56), but the **advanced editor** (`#editor`, `payload/web/activity-ui.js`) still writes only the map it edits | `tools/webui-sim/public/js/wizard-model.js:669-756`; `payload/web/activity-ui.js:1449-1470` |

### 2. `docs/AI_HANDOFF.md` (~lines 86-92, the activity-transaction bullet)

Rewrite the sentence so it states what is **enforced** and what is **created**:

- **The hub validator enforces** that references resolve and that each activity has exactly
  one `ActivityFunctionMap` (`payload/activity/codexactivity.lua:540-590`).
- **The editors create** a `16414Activity<id>` and a `16417Activity<id>` map per activity on
  hubs with those surfaces. Only the advanced editor checks that every surface exists.
- **A `16420Activity<id>` map** is created only when a `KeyboardTextEntryActivityRole`
  exists. Genuine Logitech configs have none (`docs/SESSION_HANDOFF.md` ~216-221). Don't call
  it required.

### 3. `docs/TOUCH_EDITOR.md`

- **~121-125 (gestures):** replace "Whether gestures reach the hub as optimized presses or
  full commands is unproven on hardware" with the source finding:
  - the Touch never sends `SwipeUp`/`Tap` to the hub;
  - it resolves each gesture through the target device's `16417Device<id>` map (matching
    `FunctionId-` when above 0, otherwise `CommandName`/`ButtonKey`) and sends that button's
    index or key plus `deviceId`;
  - so a gesture works only if that device has a screen containing the command, and a
    gesture that resolves to a hard key must also be a hard key in the activity map;
  - wire confirmation on hardware is still pending.

  Verify at `luadraws/juniper/gesturepad.lua:121-139, 732-750` and
  `luadraws/appscommon/harmony.lua:2400-2404`. The Touch loads `juniper/`, not `hops/`
  (`luadraws/main.lua:135-142`).
- Leave the slices section alone, apart from noting that the gesture slice should first
  confirm this on hardware.

### 4. `docs/API.md` (check only)

- Confirm that the "Touch device screens" section (~299-303) and the FunctionList statements
  (~90, ~190) agree with: the Touch never pulls FunctionList, and FunctionList is used only
  for `harmony.engine?config` and app/API command lists.
- Edit only if something contradicts that. Report what you found either way.

### 5. Research notes outside git (back them up first, see Hard rules)

- `~/Repos/harmony/re/reports/touch-hot.md`: near §1.3, add a dated "Correction
  (2026-10-25)" block:
  - gestures are resolved on the Touch, as above;
  - the engine's fallback to bare `Device<id>`/`Activity<id>`/`Root` maps is unreachable,
    because `buttonPress` returns at `luaworks/tasks/harmonyengine/apihandler/activity.lua:1856`
    when the `16417…` map is missing;
  - point to `re/reports/button-mapping-ha-deep-dive.md`.
- `~/Repos/harmony/re/touch-fw/notes/ui-devices.md`: where it says the activity list
  excludes `ButtonState 4` buttons, add a dated correction:
  - they are moved into an unordered head (`luadraws/appscommon/harmony.lua:388-414`) and
    then hidden by the renderer (`luadraws/juniper/style.lua:1870-1872`).

## Checks to run

1. `cd tools/webui-sim && node --test` (it includes `shipped-copy-hygiene`). All tests must
   still pass. Report the counts.
2. `grep -n -E "250 ms|no lock|answers 304" docs/HOME_ASSISTANT.md`: what remains must be
   correct in context.
3. `git status --short` and `git diff --stat main...HEAD` after committing.

## Report back (exact format; the validator checks each item)

```text
BRANCH: <name>   COMMIT: <sha>   PUSHED: no
FILES CHANGED (git): <list>
FILES CHANGED (outside git): <list> — backups: <paths>
CORRECTIONS:
  [n] <file>:<line range>  claim → new text (one line)  | verified at <source file:line> | VERIFIED / NOT VERIFIED (why)
SKIPPED / DISAGREED: <any row you didn't apply, with the source you read>
API.md CHECK: <result>
TESTS: node --test → <pass>/<total>
GREP CHECK: <output, with a one-line judgement>
GIT STATUS: <output>
QUESTIONS: <anything ambiguous>
```

Stop after the report. Don't start any other plan.
