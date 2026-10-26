# P16 HA input selection and multi-device activity timing

Status: Proposed · Tier T3 · Area: hardware validation, HA writer delays · Depends on: P21 (G6, G7) · Blocks: —

## Problem

Two HA behaviours are written in code but unproven on hardware:

1. **Input selection.** `CommitHaDevices` writes a discrete `InputFeature` whose inputs run
   `select_source:<src>` commands (`codexactivity.lua:1071-1110, 2012-2017`). No activity has
   yet selected an HA input on hardware (`docs/HOME_ASSISTANT.md:225-227`).
2. **Multi-device timing (hypothesis D12/H3).**
   - The engine has one serial IP queue.
   - Each POST may take a TCP connect plus a round trip, with DNS if the URL is a hostname.
   - A command that waits more than **500 ms in the IP queue** is discarded with 595, which is
     silent (`ipmanager.lua:20, 278-285`).
   - IP sends return immediately to the activity scheduler, so the scheduler spaces only the
     *enqueues*, by device delays (`device.lua:232-234`).
   - An activity with several HA devices (power plus input each) could therefore lose later
     commands.

## Goal / Non-goals

- **Goal:** prove input selection; measure loss; if loss exists, prevent it in data.
- **Non-goal:** changing the engine queue.

## Design

1. **Measure** (P21 G6, G7):
   - a test activity with one HA media player and an input → `turn_on` then
     `select_source:<A>` arrive;
   - a test activity with three HA devices → count the arrivals vs expected.
2. **If loss is seen:**
   1. **Delays in data:** the HA writer sets `DefaultInterDeviceDelay`/`InterDeviceDelay` and
      `PowerOnDelay` on HA devices to space enqueues (for example 150–250 ms, measured from
      the observed round trip). The engine already honours them (`device:delayRequired`,
      `device.lua:105-139`).
   2. **URL guidance:** use an IP address in the webhook URL (no DNS per request).
   3. **Fast webhook:** the integration already answers before calling services. Keep its
      handler minimal (no awaits before the response).
3. **Ordering note:** overlapping Off and Start run side by side in the stock engine, so a
   late power-off can land after the next start's power-on. This was observed 2026-10-24 and
   affects IR too. Document it; don't fix it.

## Work breakdown

1. Run G6 and G7 (approval).
2. If needed: `codexactivity.lua` `haDeviceEntry` sets delay fields on new devices (and keeps
   user edits on existing ones; see also P10's note that power settings currently revert
   on every push).
3. Docs: `docs/HOME_ASSISTANT.md` "Activities".

## Local tests

- If delays are added: a Lua test that new HA devices get the default delays, and that an
  existing device keeps its edited delays across pushes.

## Hardware gate (approval required)

G6 and G7 in P21.

## Risks & rollback

- Delays lengthen activity start slightly. Choose the minimum that removes the loss.

## Definition of done

- Input selection is proven; loss is measured; mitigation is applied if needed; the results
  are documented.

## Decisions

—
