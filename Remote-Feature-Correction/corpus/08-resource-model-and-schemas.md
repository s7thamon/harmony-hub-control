# 08 Resource model and schemas

## 1. The resources

All live in `/data/resources/` on the hub; their etags live in `index.json`.

| Resource | Root shape | Touch pulls? | Used by |
|---|---|---|---|
| `ActivityList` | `{Activities:[…]}` | yes | engine, Touch, editors |
| `DeviceList` | `{DevicesWithFeatures:[{Device, Commands, DeviceFeatures}]}` | yes | engine, Touch |
| `MapList` | `{ButtonMaps:[…]}` | yes (`?excludeFunctionMaps=true`) | engine, Touch |
| `FunctionList` | `{FunctionMaps:[…]}` | **no** | `harmony.engine?config` (app, HA Harmony integration), config hash, `holdaction` labels |
| `ProtocolList` | `{Protocols:[…]}` | yes | engine (IR encoding, IP `ControlSection`) |
| `CapabilityList` | `{Capabilities, DisplayName, MaxActivities, MaxDevices}` | yes (mode 3/4) | limits |
| `Settings` | `{DefaultImageBucketUri, RemoteName, Settings, UserImageBucketUri}` | yes | remote settings |
| `Context` | account and household context | yes | account |
| `AutomationConfig` | `{gateways, devices, groups, scenes, scenes2, programs, maps, unknownDevices, id, account_uri, enableXMPP}` | yes | automation task, Touch Home Control |
| `ContentUser`, `CD_<deviceId>` | content records | in menu Sync only | Touch content step (missing → 553 abort unless the guard serves an empty record) |
| `index.json` | `name → JSON string {etag, hetag, type, maxAge?}` | Touch keeps its own | resource manager (cached in RAM) |

## 2. Relationships

```text
Activity.Id- ──► "16414Activity<Id>", "16417Activity<Id>", ("16420Activity<Id>" if keyboard role)
             └─► exactly one ActivityFunctionMap{ActivityId-}
Activity.Roles[].DeviceId- ──► Device.Id-
Activity.Roles[].SelectedInput.Name ──► Device InputFeature.Inputs[].InputName
Device.Id- ──► "16417Device<Id>" (Touch screen; optional), DeviceFunctionMap (optional; Logitech only)
Device.Commands[].ProtocolId ──► Protocol.Id-
ButtonCommandAction{DeviceId-, CommandName} ──► Device.Commands[Name] (case-insensitive on the hub)
ButtonSequenceAction{SequenceId} ──► same map's Sequences[SequenceId]
PowerFeature/InputFeature actions{IRCommandName} ──► Device.Commands[Name]
AutomationConfig ── separate ID space (gateways/devices/groups/scenes2/programs[activityId])
```

## 3. MapList

### Map

| Field | Required | Notes |
|---|---|---|
| `ButtonMapIdentifier` | **yes** (the hub's key) | `16417Activity<id>`, `16417Device<id>`, `16414Activity<id>`, `16414Root`, `16420Activity<id>`. Touch maps **must** use `16417`. Duplicates: the last one wins. |
| `__type` | **yes** | `ActivityButtonMap` / `DeviceButtonMap` / `RootButtonMap` (nil throws) |
| `ButtonMapId-` | identity | Melodious: ≤ 52944089 means Logitech-made; never rebuilt |
| `ActivityId-` / `DeviceId-` | yes for those types | validators and editors; not used for lookup |
| `SurfaceId-`, `RemoteId-`, `ButtonMapSurfaceId-` | carried | not read by the hub; new maps copy them from a 16417 sibling |
| `DateModified` | optional | `/Date(ms+0000)/`, or null on new maps |
| `Sequences` | `null` or array | `{SequenceId, Name, Actions:[{__type, Order, …}]}`; steps `ButtonCommandAction` or `ButtonDelayAction {Duration s}`; **`Order` required** |
| `Buttons` | **yes** | below |

### Buttons

| Field | Hard | Soft | Gesture |
|---|---|---|---|
| `__type` | `HardRemoteButton` | `SoftRemoteButton` | `GestureRemoteButton` |
| `ButtonId` | identity | identity | identity |
| `ButtonKey` | **required** | — | **required**: `SwipeUp`, `SwipeDown`, `SwipeLeft`, `SwipeRight`, `Tap` |
| `MenuItem` | — | **required** `{IndexInMenu: number ≥ 0, MenuName: "Activity.<id>"\|"Device.<id>"}` | — |
| `FunctionGroupType` | 0 (2 for `Number*` on 16414) | 0; 2 = number pad; 36 = `123` row; 1006 etc. | 0 |
| `TextOnRemote` | — | label (`123` is magic) | — |
| `ButtonState` | 1 | 1; 4 = hidden (Touch only) | 1 |
| `ButtonImagePath` | — | ignored (Touch bug) | — |
| `ButtonImageKey`, `ImageId-` | — | carried (not read for command rows) | read by the gesture pad |
| `ButtonAction` | press | press | short |
| `ButtonLongPressAction` | long | long | hold |
| `ButtonDoublePressAction` | carried, never executed | carried, never executed | double tap (resolved on the Touch) |

### Actions

```text
ButtonCommandAction  {__type, DeviceId-, CommandName, FunctionId-, EventType, Order, Id}
ButtonSequenceAction {__type, SequenceId, EventType, …}
ButtonActivityAction {__type, ActivityId-, …}
ButtonClientAction   {__type, ActionName ("Numpad" | "PLAY_PAUSE_TOGGLE" | …), EventType, Order, Id}   Touch-local
ButtonHomeControlAction / ButtonProgramAction                                                       Root maps only
ButtonChannelAction / ButtonBookmarkAction                                                          not executed
```

- `FunctionId-`: the Touch's gesture lookup uses it when > 0. Melodious maps write 0, so
  matching falls back to `CommandName`.
- Note both spellings in DeviceList commands: `FunctionId` and `FunctionId-`.

### Index spaces (on-screen buttons, per map)

| Space | Members | Key |
|---|---|---|
| main | every soft button with FGT ≠ 2 (0, 36, 1006, …) | `IndexInMenu` |
| number pad | FGT 2 | `IndexInMenu` |

- On the hub, a press with FGT ≠ 2 that misses the main space falls back to the number-pad
  space.
- Hidden buttons occupy their index on the hub.

## 4. DeviceList

```text
DevicesWithFeatures[]: {
  Device: { Id-, Name, Manufacturer, Model, Transport (int), DeviceType, DeviceTypeDisplayName,
            Icon, ControlPort (0 = IR from the remote), AutoDetectedDevice{Id}?, Tokens{Parameters[{Key,Value}]}?,
            InterDeviceDelay, InterKeyDelay, DefaultInterDeviceDelay, DefaultInterKeyDelay,
            HoldInterDeviceDelay, HoldInterKeyDelay, PressMinRepeats, HoldMinRepeats,
            ActivityIds (unmaintained), DeviceOrder, … ~55 stock keys },
  Commands: [ { Id-, Name, TransportType, ProtocolId, KeyCode, Raw (present), Parameters,
                FunctionId | FunctionId-, FunctionGroupId, CommandTypeId, IsLearned, DateTaught } ],
  DeviceFeatures: [ PowerFeature | InputFeature | ChannelTuningFeature | OutputFeature ]
}
```

- **PowerFeature:**
  - `PowerTypeId` (0 manual, 1 discrete, 2 toggle, 3 manual);
  - `PowerOnActions[]`, `PowerOffActions[]`, `PowerToggleActions[]`, each
    `{__type:"IRPressAction"|"IRHoldAction"|"IRDelayAction"|"IRDevAction", IRCommandName, Order, Duration, ActionId}`;
  - `IsPowerAlwaysOn`, `IsPoweredOnBetweenActivities`, `PowerOnDelay`,
    `ConnectedAppPowerOnDelay` (CAPOD).
- **InputFeature:** `Inputs[]` `{InputName, InputOrder, Actions[], IsOnline, …}`, `InputType`,
  `ActionSetTypeId`, `CanSkipInputs`, `InputDelay`.
- `CommandTypeId` holds a semantic name (`VolumeUp`, `Number1`, …) on Logitech commands and
  `""` on Melodious ones.

## 5. ActivityList

```text
Activities[]: { Id-, Name, ActivityOrder, Type, Icon, IsDefault, IsMultiZone, Zones[],
                Roles[ { __type (…ActivityRole), Id-, DeviceId-, SelectedInput{…}?, PowerOnOrder?, PowerOffOrder?, NextDevicePowerOnDelay? } ],
                EnterActions[], LeaveActions[], Alternatives?, StartScreen, … }
```

- Leave and enter action types: `CommandActivityAction`, `ChannelActivityAction`,
  `DelayActivityAction`.
- `Alternatives` is removed by the remote's "Did the activity start correctly?" confirmation
  (the PUT handled in `MEL/payload/scripts/netservicestarter.lua:654-678`).

## 6. ProtocolList

```text
Protocols[]: { Id-, Name, __type ("IrProtocol" | "HidProtocol" | "BluetoothProtocol"),
               CarrierFrequency, IRSegments[], CodeSegments[], KeyCode, Flags, HoldDelay,
               HoldMinimumRepeats, PressMinimumRepeats, SendingType, IsFullSequence, IsPadded,
               ControlSection? {Url, Method, Header (JSON string), Body (string), Timeout (string s)} }
```

## 7. FunctionList

```text
FunctionMaps[]:
  ActivityFunctionMap { ActivityId-, UIModeName, FunctionGroups[{Name, Functions[FunctionAction{DeviceId-, Name, Label, CommandName, FunctionId-, TransportType}]}] }
  DeviceFunctionMap   { DeviceId-, UIModeName, FunctionGroups[…] }
```

Function-group names seen include `NumericBasic` (with `CommandName` `"0".."9"`), `Volume` and
others.

## 8. Invariants (what must hold)

| # | Invariant | Enforced by |
|---|---|---|
| 1 | Every referenced activity, device, protocol and sequence exists | hub validator (except command names, protocol refs) |
| 2 | `IndexInMenu` is a number, unique per index space per map | hub validator for activity maps only |
| 3 | Exactly one `ActivityFunctionMap` per activity | hub validator |
| 4 | Each activity has a `16417Activity` map if the hub has any 16417 map | editors only (advanced editor) |
| 5 | The 16414 and 16417 hard keys agree (Dvr↔DVR, numbers 16414-only) | the wizards' mirror (not the advanced editor) |
| 6 | Command names referenced by actions exist | **nobody** |
| 7 | Sequence steps have numeric `Order` | **nobody** (the loader throws) |
| 8 | IP devices meet §07 §7 | `CommitHaDevices` only |
| 9 | A gesture target has a device screen containing the command | **nobody** |

## 9. Synthetic example

`../fixtures/synthetic-graph.json` is an internally consistent graph:
- an IR TV, an HA light and an HA script;
- one activity with 16414 and 16417 maps (hard keys, an on-screen HA toggle, a sequence, a
  number-pad digit, a gesture);
- device screens for the TV and the light;
- one `ActivityFunctionMap`.

The Touch-side outcome of each press is tabulated in
`re/reports/button-mapping-ha-deep-dive.md` §4.4.
