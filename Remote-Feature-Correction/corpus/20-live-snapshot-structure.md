# 20 Live snapshot structure (2026-10-25, sanitized)

Read-only copies were taken with `cat` over SSH from the hub (`/data/resources/*.json`) and the
Touch (`/data/resources`, `/data/luadraws/*.json`, `/data/loggly/SyncCounter.json`). The raw
copies stay in `/tmp/melodious-research/private/` (mode 700) and are **never** committed. Only
counts and field names appear here.

## Equality (Touch vs hub)

| Resource | Result |
|---|---|
| MapList, DeviceList, ActivityList, CapabilityList, ContentUser | byte-identical |
| ProtocolList, Settings, Context, AutomationConfig | identical after JSON normalization |
| index.json | the Touch has the hub's etag/hetag for each synced list (fewer entries; no FunctionList) |
| SyncCounter | last sync success recorded; no abort counters |

## MapList

- **Maps: 20**
  - `16414Root` ×1;
  - `16414Activity` ×5 and `16417Activity` ×5 (one pair per activity);
  - `16417Device` ×9: 4 Logitech-made (ID ≤ floor), 2 Melodious IR, 4 HA (hub-built);
  - **no `16417Root`, no `16420`** maps.
- **Buttons:** 205 hard, 201 soft, 5 gesture.
  - Soft FGT: 0 ×145, 2 ×42, 1006 ×12, 36 ×2.
  - Actions: `ButtonCommandAction` ×406, `ButtonClientAction` ×2 (`Numpad`).
  - Press `EventType`: 0 on soft, 1 on hard and gesture. Long press ×10 (`EventType 2`).
    Double press ×1 (`EventType 3`, on a `Tap` gesture).
  - Sequences: 0. `ButtonImagePath` set on 0 soft buttons.
- **One duplicate soft slot:** a Logitech BT device map has an FGT 1006 and an FGT 0 button
  at the same `IndexInMenu`.
- **References:** no dangling references; `ButtonId`s and `ButtonMapId-`s are unique.
- **Activity pairs:** 5 of 5 activities have both maps. Hard keys agree after `Dvr`→`DVR` and
  excluding `Number0-9` (the one Logitech-made activity has those on 16414 only). 0 action
  differences on shared keys.
- **Membership:** no activity-map action references a device outside that activity's roles.
- **FunctionId:** 148 actions on hub-made maps point at commands with `FunctionId null` and
  carry `FunctionId- 0`.

## DeviceList

- **Devices: 9:**
  - IR transport 1 ×4 (2 Logitech catalog, 2 Melodious learned/imported);
  - BT-HID transport 32 ×1;
  - HA IP transport 64 ×4.
- **Commands:** 252 in total. Keys seen: `CommandTypeId`, `DateTaught`, `FunctionGroupId`,
  `FunctionId` (137) or `FunctionId-` (115), `Id-`, `IsLearned`, `KeyCode`, `Name`,
  `Parameters`, `ProtocolId`, `Raw`, `TransportType`.
- **HA devices:**
  - `AutoDetectedDevice` present;
  - `Tokens.Parameters` key `{d}`;
  - 5 commands each, with `{c}` parameters, `Raw:null`, `KeyCode:""`;
  - **PowerFeature only (no InputFeature)**;
  - `DeviceType` 44, "Home Appliance".
- `Device.ActivityIds` is empty in all 9 (unmaintained).
- DeviceFeatures types: `PowerFeature`, `InputFeature`, `ChannelTuningFeature`,
  `OutputFeature`.

## FunctionList

- `ActivityFunctionMap` ×5 (one per activity);
- `DeviceFunctionMap` ×3 (Logitech devices only);
- hub-made devices have none, and their screens work.

## ActivityList

- 5 activities.
- Roles: `DisplayActivityRole` ×3, `VolumeActivityRole` ×5 (one on an HA device),
  `PlayMediaActivityRole` ×1, `PlayMovieActivityRole` ×1.
- `EnterActions`/`LeaveActions` are empty everywhere.

## ProtocolList

- 7 protocols: 6 `IrProtocol` (one with a `ControlSection`: http, `Timeout "2"`, carrier
  38000, empty segments), 1 `HidProtocol`.

## AutomationConfig

See §16 §4:
- 2 gateways;
- 57 devices (19 lamp, 38 extScene);
- 3 groups, 38 `scenes2`, 38 `programs`.

## Logs (passive)

- **Hub `logread`:** web-UI `holdaction`s over websocket for a BT device. Format:
  `he.m.device … [ command: … ] [ modifier: press ] [ transport: 32 ]`. No Touch presses were
  buffered.
- **Touch `logread`:**
  - boot shows the engine loading device, activity, button-map, protocol and automation
    resources;
  - the UI subscribes to `control.button?press/release/fire/pressType`, `sequenceFinished`,
    `setup.sync*`, `proxy.resource?ready`, `automation.state?notify`;
  - after the resync check it requests `hot.1.harmony.automation?getstate` (200).
