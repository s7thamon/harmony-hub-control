# P10 HA integration robustness

Status: Proposed · Tier T3 · Area: `schlambos/ha-melodious` (`custom_components/melodious/`) · Depends on: — · Blocks: P15

All defects are proven by reading code at `c6d137b` (v0.1.0). IDs follow the research
(corpus §15). Hold behaviour (D6) is P11; setup and feedback (D8, D9) are P12.

## Problem and design, per defect

| ID | Problem | Evidence | Fix |
|---|---|---|---|
| **D1** | Python limits names to 64 and values to 96 *characters*; the hub limits them to 64 and 96 *bytes*. One long non-ASCII name or source makes the hub refuse the **entire** set (422). | `devices.py:31-35, 116-123`; `codexactivity.lua:1714, 1723` | Measure `len(s.encode("utf-8"))`; truncate on a UTF-8 boundary; mirror the hub limits in `tests/test_devices.py::assert_hub_accepts`. |
| **D2** | After a refusal, `sent` isn't updated, so every state change of any tracked entity re-pushes the full set about 5 s later, indefinitely, holding the hub's shared writer lock. Transient refusals ("sync in progress", "cloud blocker not active") are never retried without a state change. | `__init__.py:102-110, 136-140` | Remember the last refused set and don't resend it unchanged; retry transient refusals with backoff (30 s → 10 min). Hub side: add `"retryable":true` to plugin refusals that are transient (`codexactivity.lua:2047-2064`), so the integration doesn't parse strings. Raise a repair issue for permanent refusals. |
| **D3** | `_merge` puts current commands first and appends previous-only ones. A player that drops features while off reorders its commands, which rewrites DeviceList and MapList, shifts screen slots and triggers a Touch sync on every power cycle. | `devices.py:137-161`; order-sensitive equality `__init__.py:99`, `codexactivity.lua:2185-2186` | Merge in **previous order first**, then append new commands; the same for inputs. With P04 (slot stability) this is belt-and-braces. |
| **D4** | Options store raw entity_ids. After an HA rename the entity has no state, so its device is renamed to the entity_id string, and calls go to the dead entity. | `config_flow.py:86-90`; `__init__.py:69-86`; `devices.py:263, 276` | Store entity-registry IDs (`async_resolve_entity_id`), follow registry updates, and keep the previous name when state is missing. The hub device is matched by the entity in `{d}`, so a rename must be sent as an update: same device, new token. Hub check: `CommitHaDevices` matches owned devices by entity (`codexactivity.lua:2098-2109`), so the hub would see remove-old plus add-new. **Add a hub-side `previousEntity` field** to rename in place, keeping the device ID, its screen and its activity references. |
| **D5** | Device names follow `state.name`, and duplicate suffixes (` 2`) depend on entity_id sort order, so adding an entity can rename an existing device | `devices.py:262-270` | Persist the assigned name per entity in the Store; compute only for new entities. |
| **D7** | Commands removed in HA are never removed on the hub | `devices.py:137-161` | Add a "Prune unused commands" button or service. The hub dry run returns references (P12 adds `refs` to the dry-run reply), so only unreferenced commands are dropped. |
| **D10** | Deleting the integration while an activity uses a device only logs a warning, then drops the Store. The hub keeps a protocol aimed at an unregistered webhook, and HA still answers 200. | `__init__.py:200-206` | On refusal: a persistent notification naming the blocking activities, plus a documented revert (`tools/ha_devices.mjs revert`). Optionally block removal through a repair flow until the references are cleared. |
| **D11** | Devices beyond 64 (sorted by entity_id) and sources beyond 32 are dropped silently. Adding an entity can push another one out, and that one is removed on the hub if unused. | `devices.py:196-197, 262` | Reject in the options flow over 64; log skipped sources once (including those skipped for quotes, `%` or braces). |
| **D13** | A source label whose case changes replaces the old input. The hub's `inputsInUse` matches exactly, so an activity's selected input "disappears", the set is refused, and D2 follows. | `devices.py:151-156`; `codexactivity.lua:1043-1052` | When labels are equal ignoring case, keep the previous spelling. |
| **D16** | Minor issues: fan power offered regardless of TURN_ON/TURN_OFF bits; media players without TURN_ON/OFF get no power; `mute` without `is_volume_muted` always mutes; toggle-only entities never offered `power.toggle`; duplicate config entries for one hub under different host strings; no reconfigure flow | `devices.py:202-205, 220-222, 297-299`; `config_flow.py:31-32` | Feature-gate the fan; offer `power.toggle` for toggle-only entities (the hub accepts it, `codexactivity.lua:1805-1809`); add a reconfigure flow; a unique ID from the hub's `hub_id`. |

## Goal / Non-goals

- **Goal:** the integration never makes the hub churn, never locks itself out with a
  permanent 422, and keeps devices stable across renames and power cycles.
- **Non-goal:** new domains (P15) or state (P19).

## Work breakdown

1. `devices.py`: D1, D3, D5, D11, D13, D16.
2. `__init__.py`: D2, D4, D10.
3. `config_flow.py`: D11, D16 (reconfigure, unique ID).
4. Hub (Melodious):
   - `retryable` in `CommitHaDevices` refusals;
   - optional `previousEntity` rename support (with a Lua test in
     `codexactivity-ha-devices-test.lua`).
5. README and `docs/HOME_ASSISTANT.md` ("How it stays in step").

## Local tests

All in `tests/` (they run locally with plain `python3 -m unittest`, no installs):
- byte-length vectors (CJK, accented, emoji);
- merge-order stability;
- case-only source rename;
- the refused-set memo;
- the retry policy (fake clock);
- the name persistence table;
- the 64-device boundary.

Hub: `luajit tools/touch-validator/codexactivity-ha-devices-test.lua` gains `retryable` and
`previousEntity` cases.

## Hardware gate (approval required, on the owner's HA server, never on the Mac)

1. Install the integration build on the owner's HA.
2. Power-cycle a media player twice. Expect **no** hub write (`changed:false` in the HA debug
   log; no Touch pull in hub `logread`).
3. Rename a test entity's entity_id in HA. Expect the hub device to keep its ID and screen,
   and the webhook to target the new entity.
4. Revert the rename.

## Risks & rollback

- D4's hub-side rename is new writer behaviour. Ship it after the integration-only fixes.
- Rollback: HACS reinstall of the previous release; hub revert.

## Definition of done

- The tests are green; the gate has passed; the integration release notes list each fixed
  defect.

## Decisions

—
