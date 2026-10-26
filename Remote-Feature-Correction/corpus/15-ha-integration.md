# 15 Home Assistant integration (ha-melodious)

Repository `schlambos/ha-melodious` @ `c6d137b` (v0.1.0), installed through HACS on the owner's
HA (Docker on their server). Paths are relative to `custom_components/melodious/`.

## 1. Flow

1. **Options:** the user picks entities (an `EntitySelector` limited to supported domains);
   the options store **entity_id strings** (`config_flow.py:84-91`).
2. **Discovery:** `MelodiousRuntime.entities()` reads each entity's `State`: `name`,
   `available` (≠ `unavailable`), `supported_features`, attributes. An entity with no state
   becomes `Entity(entity_id, name=entity_id, available=False)` (`__init__.py:69-86`).
3. **Commands per domain** (`devices.py:164-223`):

   | Domain | Command → value | Gate |
   |---|---|---|
   | media_player | PowerOn/Off → `turn_on`/`turn_off` | features 128/256 |
   | | VolumeUp/Down → `volume_up`/`volume_down` | VOLUME_STEP or VOLUME_SET |
   | | Mute → `mute` | VOLUME_MUTE |
   | | Play / Pause / PlayPause / Stop / SkipForward / SkipBack | per feature bit |
   | | `Input <label>` → `select_source:<source>` | SELECT_SOURCE |
   | light, switch, input_boolean, fan | PowerOn/Off/Toggle → `turn_on`/`turn_off`/`toggle` | always |
   | light | BrightnessUp/Down → `brightness_up`/`brightness_down` (±10 %) | not on/off-only |
   | fan | SpeedUp/Down → `increase_speed`/`decrease_speed` | SET_SPEED |
   | cover | Open/Close/Stop → `open_cover`/`close_cover`/`stop_cover` | per bit |
   | script | Run → `turn_on` | always |
   | scene | Activate → `turn_on` | always |
   | button, input_button | Press → `press` | always |

   - `power = {on, off}` only when both exist; `power.toggle` is never offered.
   - Sources are skipped if `clean_label(source) != source`, the value fails, or the label is
     a case-insensitive duplicate.
   - Input command names: `Input <label>` cut to 44 characters, made unique with ` 2`, ` 3`.
   - **Limits:** 64 devices (sorted by entity_id, **silently truncated**), 128 commands, 32
     inputs, 64-character names, 96-character values.
4. **Set:**
   - names from `clean_label(state.name)`;
   - a clash with a non-HA hub device appends ` (HA)`; a clash among HA devices appends
     ` 2`… in sort order;
   - `_merge` keeps every previous command and input (current first, then previous-only);
   - an unavailable entity reuses its previous spec with the new name (`devices.py:137-161,
     245-280`).
5. **Push:** `POST /api/ha-devices` (aiohttp `json=`, so it has a Content-Length; optional
   Basic auth) with `{webhook, devices[], dryRun}`. Before each push it GETs
   `/api/activity-config` to learn the non-HA names (`hub.py:30-72`). It pushes at HA start,
   on option change, and 5 s after an entity change that changes the set.
6. **Hub** (`codexactivity.lua` `CommitHaDevices`, `:2046-2319`):
   - **guards:** cloud blocker on; set valid; no stock sync;
   - **validation:**
     - entity `^[a-z0-9_]+%.[a-z0-9_]+$` ≤ 128;
     - name and model 1–64 **bytes**, no control characters, `"` or `\`;
     - commands 1–128, names `^[%w][%w _.+-]*$` ≤ 48, unique ignoring case;
     - values 1–96 bytes with no control characters, `" \ % { }`;
     - power on/off or toggle referencing the device's commands;
     - inputs ≤ 32, each naming a command;
     - entities and names unique;
     - webhook `^http://host(:port)?/path` ≤ 256, required only when devices are non-empty
       (`:1711-1868`).
   - **ownership:** `AutoDetectedDevice.Id` starts `melodious-ha-` and `Tokens.Parameters`
     has `{d}`; matched by entity.
   - **shapes:** §07 §7 plus `DeviceType`/`Icon` 44, `ControlPort` 7,
     `ParentDeviceManufacturer "Home Assistant"`, a PowerFeature rewritten from the spec on
     every push (`PowerTypeId` 0 none, 1 discrete, 2 toggle), and a discrete InputFeature
     from the spec.
   - **one shared protocol** "Melodious Home Assistant": `IrProtocol`, `ControlSection` POST,
     header `{"Content-Type":"application/json"}`, body `{"device":"{d}","command":"{c}"}`,
     `Timeout "2"`. It is always re-appended last and removed when the set is empty.
   - **removal guards:** refuse when a removed device, command or input is still referenced
     in Activity/Map/Function lists (the device's own hub-built screen is excluded).
   - **save:** Protocol → Device → Map (changed lists only), `config_new`, publish; restore
     on failure; **no-op when unchanged**; dry run side-effect-free.
   - **reply:** `{ok, changed, dryRun, screensChanged, added, updated, removed, unchanged,
     devices[{entity, deviceId, name}], reloaded, configVersion}`.
7. **Screens:** a `16417Device<id>` for each HA device (§12 §6).
8. **Execution:** §07.
9. **Webhook** (`__init__.py:143-176`):
   - registered with `local_only=True` and POST only;
   - parses JSON and always answers 200;
   - `run()` refuses values not in `allowed[entity]` (the last set the hub accepted) with a
     WARNING;
   - otherwise maps them to `(domain, service, data)` and schedules
     `hass.services.async_call(…, blocking=False)` without awaiting.
   - Special mappings:
     - `select_source:<src>` → `media_player.select_source`;
     - `mute` → `volume_mute` with `not current`;
     - `brightness_up/down` → `light.turn_on {brightness_step_pct: ±10}`;
     - any other `:arg` is refused (`devices.py:288-304`).
   - **HA core itself** answers 200 for an unregistered webhook, a non-local caller, or a
     handler exception.
10. **Removal:** deleting the integration commits `{"devices":[]}`. On refusal it only logs a
    WARNING, then drops the Store.

## 2. Constraints vs code

| Constraint | Verdict |
|---|---|
| `AutoDetectedDevice.Id` required | verified |
| Transport 64 not 65 | verified |
| `IrProtocol` shape | verified |
| `Raw: null` present | verified |
| `KeyCode: ""` | not required |
| `{d}`/`{c}` via gsub; escaping | verified; the bans make it safe; **byte vs character mismatch with Python** |
| Plain http; Host without port | true in practice; the TLS mechanism exists, but the bundle doesn't trust Let's Encrypt |
| Fast 200, 500 ms queue | verified (the deadline counts from enqueue on the hub) |
| 404 → SSDP rescan | qualified (also no reply; uid needed; at most daily; blocks 10–35 s) |
| Hold ~250 ms | the Touch repeats every **300 ms** |
| No writer lock | stale (PR #57) |
| Dry run proves the writer | weak (empty set; any 422 accepted) |
| Webhook secret | in ProtocolList, so in exports, on the Touch, and in clear |

## 3. Three capabilities

| | What exists | Proves |
|---|---|---|
| A. HA → Harmony | HA's Harmony integration (8088); codexmqtt (activity select, Power Off button, sensors, `<base>/activity/set`, `<base>/command` → `holdaction`, **unrestricted `<base>/hbus`**) | activity-level state only |
| B. Harmony → HA | ha-melodious IP devices | **received**, not executed |
| C. HA state → remote | **none** for IP devices; AutomationConfig only (§16) | — |

## 4. Defects (all proven by code reading unless marked)

| ID | Defect | Plan |
|---|---|---|
| D1 | Character vs byte limits → a whole set refused | P10 |
| D2 | A refused set is re-pushed on every state change; transient refusals never retried | P10 |
| D3 | Merge order churn → DeviceList/MapList rewrites, slot shifts, Touch syncs on power cycles | P10, P04 |
| D4 | An entity_id rename breaks the link; the device is renamed to the entity_id | P10 |
| D5 | Name drift (`state.name`, sort-order suffixes) | P10 |
| D6 | Holds repeat one-shot actions | P11 |
| D7 | Stale commands never pruned | P10 |
| D8 | Setup dry run validates nothing | P12 |
| D9 | No failure feedback | P12 |
| D10 | Deleting the integration in use orphans devices silently | P10 |
| D11 | Silent truncation (64 devices, 32 sources) | P10 |
| D12 | [hypothesis] multi-device activity starts lose commands to the 500 ms deadline | P16 |
| D13 | Case-only source rename → refused set | P10 |
| D14 | Webhook ID exposure | P20 |
| D15 | Doc drift | P01 |
| D16 | Minor (fan power gating, mute without state, no `power.toggle`, duplicate entries, no reconfigure) | P10 |

## 5. Hardware history [HW]

- 2026-10-24 spike (`tools/ha_ip_spike.mjs`): taps, repeats and held-key repeats arrive. A
  uid-less device killed the IP task. A 404 triggered rescans.
- 2026-10-24 writer gate (PR #55):
  - the Touch synced the IP device and listed it;
  - hub sends worked;
  - Touch-started activities sent `turn_on`/`turn_off`;
  - the in-use guard refused removal;
  - revert was clean.
- 2026-10-24/25: four HA lights work from the hub and the Touch. HA device screens work (soft
  and hard). An activity with volume → brightness works.
- **Still untested:**
  - input selection;
  - multi-device activity timing;
  - gestures to HA devices;
  - long press on HA buttons.
