# P12 HA setup validation and failure feedback (D8, D9)

Status: Proposed · Tier T3 · Area: ha-melodious, `codexactivity.lua` dry-run reply · Depends on: — · Blocks: P19

## Problem

- **D8, setup validates nothing useful.**
  - The config flow dry-runs an **empty** set, so the webhook URL is never checked (the hub
    requires it only when devices are non-empty, `codexactivity.lua:1847-1850`).
  - The flow treats **any 422** as success, including "unknown local operation" (an outdated
    hub plugin), "cloud blocker not active" and "sync in progress"
    (`config_flow.py:36-44`).
- **D9, failures are invisible.**
  - The webhook answers 200 before the service call, which runs as an unawaited task
    (`__init__.py:148-155, 163-171`).
  - HA core also answers 200 for an unregistered webhook, a non-local caller or a handler
    crash (`homeassistant/components/webhook/__init__.py:177-231`).
  - A failed service call reaches only HA's generic task log. The hub sees 200, and the
    remote shows nothing.

## Goal / Non-goals

- **Goal:**
  - setup fails with a clear message when the hub can't take HA devices or the URL is
    unusable;
  - every failed action is visible in HA (an event, a counter, a log line with context).
- **Non-goal:** showing per-press results on the Touch. That isn't possible with stock
  software (corpus §03).

## Design

1. **Setup:**
   1. Validate the HA URL locally with the hub's own rules: `^http://host(:port)?/path`, host
      `[A-Za-z0-9.-]`, no userinfo, no IPv6 literal, ≤256 bytes.
   2. Dry-run a synthetic one-device set (`button.melodious_setup_probe`, one `Press`
      command) **with** the real webhook URL. Expect `200 {changed:true, dryRun:true}`.
   3. Map refusal strings, or better a new machine-readable `code` field from the hub:
      `unknown_op` → "Update the hub"; `blocker_off` → "Turn the cloud blocker on";
      `sync_busy` → retry.
   4. Optional: a hub endpoint `POST /api/ha-devices/test-webhook` that has the hub make one
      POST with a `{"device":"probe","command":"probe"}` body. This proves reachability
      **from the hub**, which is the real constraint (plain http, a reachable address, no
      Docker-internal names). The integration's webhook logs the probe and ignores it.
2. **Runtime feedback:**
   1. Wrap the service call in a task that catches `ServiceNotFound`, `HomeAssistantError`
      and `vol.Invalid`. On error:
      - log one structured warning (entity, value, error);
      - fire event `melodious_command_failed`;
      - increment a per-entity failure counter exposed as a diagnostic sensor.
   2. Fire `melodious_command` `{entity, value}` for successful calls too, behind an option,
      for automations and debugging.
   3. Use `entry.async_create_background_task` so tasks are tied to the entry's lifetime.
3. **Hub dry-run reply adds `refs`:** for each device, the list of in-use commands and inputs
   (from `haReferences`). P10's D7 uses it.

## Work breakdown

1. `config_flow.py`: URL validation; probe set; error mapping.
2. `__init__.py`: wrapped calls, events, counters, the diagnostic sensor platform.
3. Hub (Melodious):
   - `codexactivity.lua`: a `code` field on refusals, and `refs` in the dry-run reply;
   - optional `test-webhook` route in `codex_webui.c` through a new plugin op that queues
     one IP request using the stock IP path (so it tests the real engine path) and returns
     the HTTP code from the callback.

## Local tests

- **Integration:** URL validator vectors; error mapping; the failure path fires the event
  and increments the counter (mock `hass.services.async_call`).
- **Hub:** Lua tests for `code`, and for `refs` in the dry run.

## Hardware gate (approval required)

On the owner's HA server:
1. Re-run setup with a deliberately wrong URL. Expect a clear error.
2. Run setup correctly.
3. Trigger a command for an entity whose service will fail (for example a gate-only script
   that raises). Expect the event and counter.
4. Test-webhook (if built): one POST arrives; the hub reports 200.

## Risks & rollback

- The test-webhook endpoint makes the hub send a request on demand. Keep it POST-only and
  authenticated, like other writer routes.
- Rollback: the integration release; hub revert.

## Definition of done

- Setup can't succeed against a hub that will refuse real sets; failures are visible in HA.

## Decisions

—
