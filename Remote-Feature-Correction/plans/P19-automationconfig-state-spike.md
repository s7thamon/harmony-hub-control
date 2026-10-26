# P19 AutomationConfig live-state spike

Status: Proposed (design spike; needs its own design approval before any code) · Tier T4 · Area: new `/pkg` plugin, hub writer op, ha-melodious · Depends on: P12, P21 · Blocks: —

## Problem

The remote shows no Home Assistant state. IP devices carry none, and nothing flows back. The
only state path in stock software is **AutomationConfig**:
- the Touch's Home Control screens (lights, plugs, blinds, locks, sensors, thermostat, water
  heater, scenes) pull `harmony.automation?getstate` on open and on wake;
- they merge `automation.state?notify` pushes;
- they send absolute `harmony.automation?setstate` values.

That path is backed by gateway plugins (hue, smartthings, …) and has never been wired to HA.

## Evidence (source; corpus §16)

- **Provider contract.** A plugin loaded from `/pkg/<type>/` (manifest plus Lua), resolved
  before stock `/opt` plugins (`packagemgr.lua:549-559`). It implements:
  - `instance`;
  - **`monitor`** (required, otherwise `getstate` answers `notrdy`);
  - `getState(gatewayId|nil, deviceId|nil, force)`;
  - `setState(deviceId, state)`;
  - optionally `setMultiState`, `status`, `refresh`, `exit`, `discover`, `pair`, `remove`.
- The stock automation task starts `monitor()` for every gateway type in AutomationConfig at
  boot (`LW/tasks/automation/main.lua:228-303`). The task is skipped on the Touch itself.
- Plugins push state with
  `connectUtils.broadcastEvent("automation.state?notify", json{<devId>:state})`.
- **Hazards:**
  - `upgradeAutomationConfig` runs once per boot. It **deletes devices whose gateway is
    missing** and **PUTs AutomationConfig through the stock path**: offline queue and cloud
    replay, `hub_sync_conflict` (`main.lua:42-226`; `resource.lua:287-386`).
  - `setstate` runs **synchronously on the requesting LTCP connection**, so a slow plugin
    stalls all Touch traffic (`ltcpserverconnector.lua:67-100`; `automation.lua:287-331`).
- The Touch renders auto groups of `lamp/lock/sensor/plug/covering`, `thermostat` and
  `waterheater` rows, and a `scenes2` list (`LD/juniper/homeautomationdevices.lua:172-419`).
  Alarm is a hub type but isn't rendered.
- The live AutomationConfig already has 2 stock gateways and 57 devices (structure only), so
  the Touch's Home Control section is populated today.

## Goal / Non-goals

- **Goal (spike):** prove or disprove, on hardware and with minimum risk, that a local provider
  can show **read-only** HA lamp/plug state on the Touch's Home Control screens without
  disturbing the existing gateways.
- **Non-goals:** AV entities (they stay on the IP path); replacing the Touch UI; locks or
  alarms.

## Design (spike scope)

1. **Plugin** `/pkg/melodiousha/` implementing the contract with a state cache:
   - `getState` answers from the cache only (never blocks);
   - `setState` is **read-only in the spike** (returns false). Write support comes later, as
     fire-and-forget to the webhook with typed values (P15 grammar).
2. **State feed:**
   - preferred: HA pushes to a new hub endpoint `POST /api/ha-state` (Content-Length body,
     authenticated), and C hands it to the plugin through the writer channel or a volatile
     file the plugin watches;
   - alternative: codexmqtt subscribes to HA `mqtt_statestream`. The owner dislikes MQTT, so
     this stays the fallback only.
3. **AutomationConfig writer op** `CommitHaAutomation`:
   - adds or replaces **one** gateway (`type: "melodiousha"`) plus its devices (`udn`
     `melodious-ha-<entity>`, type `lamp` or `plug`) and auto groups;
   - saves through `resMgr.saveResource` with a new hetag, then reload and publish;
   - **never** uses the stock PUT;
   - never touches other gateways' entries;
   - a full backup of AutomationConfig is taken first, with a tested restore.
4. **Open unknowns, tested in order with stop points:**
   1. Does the Touch tolerate an unknown gateway `type`? It keys icons and errors on known
      types (`homeautomationdevices.lua:162-176, 669`).
   2. Does `upgradeAutomationConfig` at boot keep the gateway and devices? It deletes devices
      only if their gateway is missing.
   3. Do `getstate` and `notify` from the plugin render?

## Work breakdown (after design approval only)

1. A design doc expanding the above, with the exact AutomationConfig shapes from the stock
   plugins (LIFX is the cleanest reference: `lifx.lua:62-90, 888-1031`).
2. The plugin skeleton and local Lua tests with a stubbed engine (`connectUtils`,
   `packageMgr`).
3. The writer op plus tests; the backup and restore tool.
4. HA side: a state push for selected lamp/plug entities (a new options section).

## Hardware gate (separate approval; this is P21 G10)

1. Back up AutomationConfig, and verify the restore on hub-emu first.
2. Install the plugin; add one gateway with one HA lamp (read-only).
3. Reboot (needed for the boot-time `monitor` start), with approval.
4. Observe:
   - the Touch's Home Control shows the lamp with its state;
   - toggling it in HA updates the Touch within seconds;
   - the stock gateways are unchanged (diff AutomationConfig, structure only).
5. Restore the backup; reboot; confirm the original state.

Stop on any Touch error screen, sync abort, or change to the stock gateways.

## Risks & rollback

- **Highest-risk plan.** It shares AutomationConfig with stock providers, involves the boot
  upgrade, and involves Touch rendering of an unknown type.
- Rollback: the restore tested in step 1.

## Decisions

—
