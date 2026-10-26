# P09 Save timeouts and honest outcomes

Status: Proposed · Tier T1 · Area: `codex_webui.c`, `codexactivity.lua`, Android REST client · Depends on: P02 · Blocks: —

## Problem

Clients are sometimes told that a save failed when it succeeded, or are left unsure:

| # | Case | Evidence |
|---|---|---|
| 1 | Android's read timeout is **20 s**, but the plugin's engine barrier can take **25 s** and the writer lock wait **50 s**. Android reports failure for saves that succeed. | `CodexHubRestClient.kt:54-57`; `codexactivity.lua:22, 704`; `codex_webui.c:2742` |
| 2 | Device-settings, HA-device and device-screen requests return **503 "did not answer"** on the C side's 45 s timeout, with no rollback and no way to learn whether the plugin committed | `codex_webui.c:2908-2926, 2980-2997, 3032-3049` |
| 3 | [INF] The plugin worker may be up to 25 s into a raw-reload barrier (`reloadRequestedResources`) before it reads a new request, so request + barrier can pass 45 s. C then rolls back an activity save the engine already loaded. | `codexactivity.lua:2353-2415, 763-779` |
| 4 | Android always sends `syncRemote=true`, so every save re-publishes and makes the Touch re-pull all three lists even when nothing changed | `MelodiousViewModel.kt:1132, 1432, 1456`; `codex_webui.c:3278` |

## Goal / Non-goals

- **Goal:**
  - every writer request has an ID whose final outcome (committed, refused or rolled back)
    can be queried after a timeout;
  - client timeouts exceed the server's worst case;
  - no spurious rollbacks.
- **Non-goal:** making saves faster.

## Design

1. **Outcome journal.** The plugin records `{id, op, outcome, configVersion, time}` for the
   last 20 requests in `/var/volatile/codex-writer-journal.json`. It writes the record
   **before** answering, and also when it finishes after C has given up.
2. **`GET /api/writer-outcome?id=`** returns that record, or `pending`/`unknown`. On a
   timeout, C answers `503 {"ok":false,"id":…,"pending":true}` instead of guessing, and
   clients poll the outcome endpoint.
3. **No C-side rollback on timeout** for activity saves either. The plugin owns rollback; C
   only rolls back when the read-back proves a mismatch *inside the lock* (P02).
4. **Worker scheduling:** the plugin checks for a pending request between barrier polling
   steps of `reloadRequestedResources`, or runs the raw-reload barrier after answering
   pending requests. This removes case 3.
5. **Client timeouts:** Android uses 110 s (50 s lock + 45 s wait + margin) for writer
   routes; the HA client already uses 120 s.
6. **Android no-op:** send `syncRemote=true` only on explicit "Refresh remote".

## Work breakdown

1. `codexactivity.lua`: the journal writer; interleaved worker loop.
2. `codex_webui.c`:
   - `id` in every writer reply;
   - the `/api/writer-outcome` route;
   - remove the timeout rollback in activity save.
3. Android:
   - `CodexHubRestClient.kt` timeouts;
   - outcome polling on 503 pending;
   - the `syncRemote` fix.
4. Web: poll outcome on 503 pending (`api.js`).
5. `docs/API.md`.

## Local tests

- Lua: the barrier test with a fake clock (`codexactivity-barrier-test.lua`) extended with a
  request arriving during a raw-reload barrier.
- hub-emu: force a slow barrier; C returns 503 pending; the outcome endpoint later reports
  committed.
- Android unit test: the timeout values and the polling path.

## Hardware gate (approval required)

1. Start an activity from the Touch.
2. While it is starting, rename one on-screen button from Android.
3. Android shows success (or pending, then success), and the label lands.
4. Rename it back.

(This is the owner check already described in `docs/TOUCH_EDITOR.md` "Saves while the engine
is busy", run from Android.)

## Risks & rollback

- The journal lives in volatile memory and is lost on reboot, which is acceptable.
- Rollback: revert.

## Definition of done

- No client reports failure for a committed save; the outcome can be queried after any 503.

## Decisions

—
