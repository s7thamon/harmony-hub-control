# 16 AutomationConfig and Home Control (the stock state path)

## 1. Structure

```text
AutomationConfig {
  id, account_uri, enableXMPP,
  gateways{ <gwId>: {type, udn, name, product, status, secret, urlBase, callbackUrl, manufacturer, model} },
  devices{ <devId>: {gatewayId, gatewayDeviceId, type, name, manufacturer, model, capabilities, data, ts} },
  groups{ <gid>: {type, groupType, name, deviceIds[], sceneIds[], all, auto} },
  scenes[] (legacy; emptied at boot),
  scenes2{ <sid>: {name, type, sceneDeviceType} },
  programs{ <activityId>: {activityId, disabled, devices, "start-end-1": {start, end}} },
  maps[] (rocker maps for other remotes), unknownDevices[]
}
```

- Device `type` vocabulary: `lamp`, `plug`, `thermostat`, `alarm`, `lock`, `bsensor`,
  `asensor`, `nsensor`, `covering`, `waterheater`, `extScene`, `keypad`, `multi`
  (`LW/tasks/automation/main.lua:16-29`; `apihandler/automation.lua:731-744`).
- Lamp capabilities seen: `battery`, `class`, `dimLevel`, `dimUpDown`, `edit`, `hueSat`,
  `temp`, `xy`.
- Lamp state shape (LIFX reference): `{on, brightness 0-254, color{mode,temp,xy}, status,
  statusMsg}`. Covering: `{position, command}`. Thermostat: `{mode, heatTargetTemp,
  coolTargetTemp, fanMode, hold, …}`.

## 2. Engine use (`LW/tasks/automation/`) [SRC]

- On every `init_activity_engine`/`init_plugins`:
  1. re-read AutomationConfig;
  2. **`upgradeAutomationConfig` once per boot:**
     - removes devices whose `gatewayId` isn't in `gateways`;
     - empties legacy `scenes`;
     - creates the `all-*` groups;
     - **PUTs AutomationConfig through the stock `processPutResource`**: offline-queue entry,
       `configVersion`/`stateVersion` bumps, `hub_sync_conflict` broadcast;
  3. `initPlugins` starts `plugin:monitor()` for each gateway type, in a task (`main.lua:42-303`).
- The task is skipped on hostname `juniper` (the Touch).
- **Provider resolution:** `gateways[gw].type` → `packageMgr.getPlugInInstance(type, …)`, which
  tries `/pkg/<type>/manifest.json` + `<plugin>.lua` **first**, then `/opt/…/plugins`, then a
  cloud download (`LW/tasks/connectserver/transport/packagemgr.lua:517-589`).
  - Stock `/opt` plugins: august, ecobee, honeywell, hue, hunterdouglas, insteon, lifx.
  - `/pkg` on this hub: caseta, nest, qivicon, smartthings, heos, plus Melodious's
    codexactivity and codexmqtt.
- **Provider contract:**
  - `instance()`;
  - **`monitor()`** (required, or `getstate` answers `notrdy`);
  - `getState(gatewayId|nil, deviceId|nil, force)`;
  - `setState(deviceId, state)`;
  - optional: `setMultiState`, `status`, `refresh`, `exit`, `discover`, `pair`, `remove`,
    `addDevice`/`removeDevice`, `identify`, `getUtilityMenu`.
- **Push:** `connectUtils.broadcastEvent("automation.state?notify", json{<devId>:state}, nil,
  {noHttpResponse=true})` (for example `plugins/hue.lua:488-504`, `lifx.lua:182-197`). The
  activity engine caches it for programs.
- **`harmony.automation?getstate`:**
  - no arguments → every gateway's `getState`;
  - `{deviceIds}` or `{groupId}` → those devices;
  - an uninitialized plugin → `{status:2, statusMsg:"notrdy"}`;
  - empty state → `nocon` (`automation.lua:127-257`).
- **`harmony.automation?setstate {state:{<devId>:{…}}}`:** grouped per plugin; returns 200 or
  584 **synchronously, after the plugin call** (`:287-331`).
  - It re-reads AutomationConfig from disk and broadcasts `process_activity` on each call
    (`:720-729`).
  - **It runs in the requesting LTCP connection task**, so a slow plugin stalls the Touch's
    whole link.
- **Programs:**
  - `programs[activityId]` ties automation state to activity start and end;
  - `extScene` devices become `scenes2` + `programs` (start → `{on=true}`, end →
    `{on=false}`);
  - a scene tap on the Touch is `harmony.activityengine?runactivity {activityId:sceneId,
    rule:"start"}` [the program runner was not traced].
- **Home-control buttons in MapList** (`ButtonHomeControlAction`, `ButtonProgramAction`) work
  **only from a `…Root` map** (`apihandler/activity.lua:1979-1984`). The household has no
  `16417Root`, so they are unusable on the Touch. The Touch has no HomeControl hard keys
  anyway.
- `harmonyengine` `loadAutomationConfig` (`main.lua:71-84`):
  - sets `hasHomeControlDevice`;
  - maps `scenes` to `activity.automationScene` (fired at the end of an activity start);
  - builds rocker buttons for 16422/16423 remotes into `<equad>Root`.

## 3. Touch Home Control UI (`LD/juniper/`) [SRC]

- **Gate:** `AutomationConfig.gateways` non-empty (`homeautomationdevices.lua:264-271`).
- **Rows:**
  - one per **auto** group with `groupType` ∈ {lamp, lock, sensor, plug, covering}
    (`:332-366`);
  - individual rows for `thermostat` and `waterheater` (`devicemode.lua:995-1045`);
  - a scene list from `scenes2` (`:179-209`).
  - Alarm is a hub type that **isn't** rendered.
- **Screens:** `devicegroup.lua`, `alllights.lua`, `blinds.lua`, `lampScenesMode.lua`,
  `blindScenesMode.lua`, `thermostatinfo.lua`, `waterheater.lua`, `lockscreen.lua`,
  `devicestatus.lua`, `haerror.lua`.
- **Commands sent:** `harmony.automation?setstate {state:{<devId>:{…}}}` (`hainterface.lua:82-105`):

  | Field | Screen |
  |---|---|
  | `on` (toggle), `brightness` (slider) | lights, plugs |
  | `position` | blinds |
  | `locked` | locks |
  | `heatTargetTemp`, `coolTargetTemp` (sent 2 s after the last change), `fanMode`, `hold`, `mode` | thermostat |
  | `heatTargetTemp`, `vacation`, `mode` | water heater |

  Group actions send one `state` map covering every member.
- **State in:**
  - `getstate {forceUpdate}` on window activate and **on wake** **replaces** the list;
  - lock screen polls `getstate {deviceIds}` every 60 s;
  - `automation.state?notify` **merges** (`appscommon/harmony.lua:4663-4673`).
- **Runtime [RT]:** after its resume check, the Touch boot log shows
  `hot.1.harmony.automation?getstate`, answered 200.

## 4. Live structure [RT, structural]

- 2 gateways (types hue and smartthings);
- 57 devices (19 `lamp`, 38 `extScene`);
- 3 groups (lamp, plug and extScene group types);
- 38 `scenes2` (all `external`), 38 `programs`;
- `scenes`, `maps` and `unknownDevices` empty.

So the Touch already renders a populated Home Control section from cloud-era providers. Their
current runtime health wasn't checked.

## 5. Feasibility of a local HA provider

| Need | Status |
|---|---|
| A `/pkg/<type>/` plugin implementing the contract with a cache | feasible (plugins already load from `/pkg`) |
| HA → hub state feed | new hub endpoint (`POST /api/ha-state`), or codexmqtt statestream (the owner dislikes MQTT) |
| Hub → HA writes | `setState` → webhook with typed values (needs the P15 grammar) |
| AutomationConfig writer | a `resMgr.saveResource` + publish op; **must avoid the stock PUT**; must keep its gateway entry (the boot upgrade deletes devices of missing gateways); must not touch stock gateways |
| The Touch accepts an unknown gateway `type` | **unproven**: it keys icons and errors on known types (`homeautomationdevices.lua:162-176, 669`) |
| Answer fast | `getState` from the cache; `setState` fire-and-forget |

Tradeoffs, compared with the IP-device path:

| | IP device | AutomationConfig provider |
|---|---|---|
| Gains | AV semantics (power, inputs), keys, activities, sequences, gestures | live state, sliders, absolute values (no hold duplication), groups, activity programs |
| Losses | no state, duplicate POSTs on hold | no AV semantics; shares data with stock providers; a new long-running hub task |

Plan P19 is the gated spike.
