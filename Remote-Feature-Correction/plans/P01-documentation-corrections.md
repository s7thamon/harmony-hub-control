# P01 Documentation corrections

Status: Proposed · Tier T0 · Area: docs · Depends on: — · Blocks: nothing (do first)

## Problem

Several repo and research documents state things the current code contradicts. Future work
built on them would chase the wrong cause, for example etags instead of the publish trigger,
or `SwipeUp` instead of device-map presses.

## Evidence

| Document | Statement | Reality | Corpus |
|---|---|---|---|
| `docs/HOME_ASSISTANT.md:59-66` | Raw writes don't reach the Touch because the hub answers 304 on matching etags | True only with the cloud blocker **off**. With it on, `netservicestarter.lua:574-619` always answers 200 with the file from disk. The gate is the publish trigger and the reload-flag race (P03). | [10](../corpus/10-sync-and-publication.md) |
| `docs/HOME_ASSISTANT.md:23-24` | Held key repeats about every 250 ms | The Touch sends `hold` every 300 ms (`LD/appscommon/harmony.lua:2435-2441`). The web UI uses a 200 ms lease heartbeat. | [05](../corpus/05-press-semantics.md) |
| `docs/HOME_ASSISTANT.md:49-51` | A 404 or no answer makes the engine run an SSDP rescan | Only with a uid, also on no reply, at most once per 24 h, and it blocks the IP task for 10–35 s | [07](../corpus/07-ip-device-engine-reference.md) |
| `docs/HOME_ASSISTANT.md:25-26` | Plain http only because of LuaSocket | TLS exists (`works/http.lua`). The limit is the certificate bundle (no ISRG Root X1). | 07 |
| `docs/HOME_ASSISTANT.md:203-206` | The writer has no lock | PR #57 added `flock` (`codex_webui.c:2734-2748`) | [11](../corpus/11-melodious-writers.md) |
| `docs/HOME_ASSISTANT.md:213-214, 226-230` | Tapping the device on the Touch does nothing; the editor writes only 16414 | Superseded by PR #61 (device screens) and PR #56 (wizard mirror). Still true for the advanced editor. | [12](../corpus/12-map-generators.md) |
| `docs/HOME_ASSISTANT.md:43-47` | `KeyCode: ""` is required | Not required; null works too (`userconfigreader.lua:514-516`) | 07 |
| `docs/AI_HANDOFF.md:86-92` | Every activity must have two surface maps, plus a 16420 map for keyboard roles | The hub enforces only "exactly one ActivityFunctionMap". The 16420 rule contradicts `docs/SESSION_HANDOFF.md:216-219`. | 12, [14](../corpus/14-validators.md) |
| `re/reports/touch-hot.md` §1.3 | Gestures are sent as `buttonKey:"SwipeUp"`; the engine falls back to `Device<id>`/`Activity<id>`/`Root` | The Touch resolves gestures to device-map presses (`LD/juniper/gesturepad.lua:732-750`). The engine returns at `activity.lua:1856`; the fallback is dead code. | [02](../corpus/02-touch-input-and-ui.md), [04](../corpus/04-hub-button-resolution.md) |
| `re/touch-fw/notes/ui-devices.md` | The activity list excludes `ButtonState 4` | It moves them into an unordered head, and the renderer hides them | 02 |

## Goal / Non-goals

- **Goal:** every statement above corrected, with a source reference, in the docs that
  carry it.
- **Non-goal:** rewriting docs wholesale, or changing behaviour.

## Design

- Edit in place. Keep each doc's voice and structure.
- Where a doc records a historical hardware result (for example the 2026-10-24 gate),
  leave the result and add a dated "Later finding" line rather than rewriting history.

## Work breakdown

1. `docs/HOME_ASSISTANT.md`:
   - the saving section (publish trigger, with the blocker-off 304 as the stock case);
   - hold cadence;
   - SSDP qualifiers;
   - the TLS mechanism;
   - writer lock;
   - "What the Touch shows" and the results notes;
   - the `KeyCode` rule.
2. `docs/AI_HANDOFF.md`: the activity-transaction bullet. Distinguish what the hub enforces
   from what the editors create, and drop the 16420 requirement or mark it "only when a
   keyboard role exists; not present in Logitech configs".
3. `docs/TOUCH_EDITOR.md`:
   - add the gesture finding (gestures need the target device's `16417Device` map to
     contain the command);
   - correct "unproven whether gestures reach the hub as presses" to "the Touch resolves
     them; wire confirmation pending (P21 G1)".
4. `docs/API.md`: check the device-screen and FunctionList statements against corpus §08.
5. `re/reports/touch-hot.md` and `re/touch-fw/notes/ui-devices.md`: add a dated correction
   block pointing at `re/reports/button-mapping-ha-deep-dive.md`.

## Local tests

- None, beyond `tools/shipped_copy_hygiene.mjs` if the docs are embedded anywhere.

## Hardware gate

- None.

## Risks & rollback

- Low. The docs PR is revertable.

## Definition of done

- Every row above is fixed, and grepping for "250 ms", "no lock" and "304" in `docs/`
  finds only correct statements.

## Open questions

- Should the G1 wire capture (P21) land before the gesture wording, or should the docs say
  "pending confirmation"? Recommendation: say "pending", then update after G1.

## Decisions

—
