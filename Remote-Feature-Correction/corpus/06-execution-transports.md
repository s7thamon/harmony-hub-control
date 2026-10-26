# 06 Execution transports and activities

## 1. Execution model (`LW/`) [SRC]

- One Lua VM with cooperative tasks. `sendMessage` goes to the first listener and has no
  timeout.
- **The loops that crash on an uncaught error have no `pcall`:**
  - `tasks/eventqueue/queuehandler.lua:5-8` (buttons and activities);
  - `ipqueuehandler.lua:4-8` (IP);
  - `haqueuehandler.lua:6-11`;
  - the harmonyengine main loop (`main.lua:516-585`, `config_new`).

  A dead task stays registered as a listener, so later messages to it hang or queue forever.
- Handlers reached through `engine.processMessage` are wrapped (`safeCall`,
  `tasks/connectserver/core/engine.lua:103`).
- **Three serial queues:**

  | Queue | Task | Carries |
  |---|---|---|
  | `actionQueue` | `queuehandler` | presses, `holdaction`, `harmony.engine?startactivity`, `getCurrentActivity`, `changechannel` |
  | `ipActionQueue` | `ipqueuehandler` | every IP HTTP request |
  | `haActionQueue` | `haqueuehandler` | rockers, home control |

  The Touch's `runactivity` runs in the **activity-engine task** (`activityengine/core/activitymanager.lua:251`),
  concurrently with buttons.
- The sandbox replaces `socket.http` with `works/http.lua` for tasks loaded after the first
  (`works/sandbox.lua:46`).

## 2. Dispatch by command transport (`tasks/harmonyengine/model/device.lua:176-283`)

| `TransportType` | Path |
|---|---|
| 8 | classic Bluetooth (`sendBluetoothCommand`, with retries) |
| 32 or 2 | BT-HID / RF-HID report: `(press)(code)(release)`; release = first byte + `000000` |
| 64 | IP: `sendIpCommand` → `ipManagerQueue`, which **returns `true,200` at once** (`:230-236`) |
| other | IR through `irManager` |

- **Device `Transport`** must be a number (bit operations on nil throw). With
  `Transport & 65 == 65`, duplicate command names are stored as `1name`/`64name`; IP is
  preferred, with IR fallback (`getCommand`, `:298-301`).
- **IR:**
  - `startIr(…, keyLatency)` → HAL `ir_send {enable=true, keyLatency, ports}`;
  - repeats continue until `{enable=false}` or HAL expiry, and heartbeats refresh them
    (`core/irsender.lua:40-113`);
  - `ports == 0` with `mode == 3` → the remote's blaster over RF.

## 3. Loader requirements per command (`loader/userconfigreader.lua:505-546`)

- `Name` is a string (lower-cased as the key).
- **`Raw` is present, as `null` or a string** (`item.Raw ~= json.null and string.sub(item.Raw, …)`;
  an absent key throws, `:520`).
- `KeyCode`: required for IR; may be null or `""` for IP. `""` logs a harmless "Invalid
  command" (`:523-525`).
- `Parameters` is copied only if it is a table. The `Command()` default `parameters = {}`
  makes `params.parameters` always truthy (`model/command.lua:16`).
- Device fields: `AutoDetectedDevice.Id` → `properties.uId` (`:633-635`); `Tokens` →
  `device.tokens` (`:646-648`); `RegisterSection` → local tokens with a cookie, in mode 3
  only.

## 4. Protocol loading (`model/protocol.lua:28-55`)

- `ControlSection` is read **only** when `__type == "IrProtocol"`, an exact match.
- In that branch:
  - `CarrierFrequency` must be numeric (it is divided by);
  - `IRSegments` and `CodeSegments` must be arrays (`ipairs(nil)` throws).
- A throw here propagates into the `config_new` loop, which **kills the harmonyengine task**
  [SRC + INF on the hang].
- `BluetoothProtocol` → transport 8; `HidProtocol` → 2.

## 5. Activities (`loader/userconfigreader.lua:168-434`; `apihandler/activity.lua:1063-1442`)

- **Roles:** `activity.roles[<role __type up to ":#">] = deviceId`, so **one device per role
  type**; a second role of the same type overwrites (`:253-260`).

  | Role | Hub consumer |
  |---|---|
  | `KeyboardTextEntry`, `ControlsMediaPlayer`, `PlayMovie` | HID target |
  | `ControlsRoku`, `ControlsSonos`, `ControlsApp`, `ControlsSpeaker`, `ChannelChanging`, `Default` | channel target |
  | `SmartTVActivityRole` | smart input |
  | **`VolumeActivityRole`** | **only reported in `harmony.engine?config`**. Volume keys resolve purely through MapList buttons (`apihandler/config.lua:256-258`). |

- **Power:**
  - `PowerOnOrder` orders `SetValue Power On` actions, plus `NextDevicePowerOnDelay`;
  - `PowerOffOrder` is appended to the leave list.

  | `PowerTypeId` | Meaning |
  |---|---|
  | 0 / 3 | manual: no power commands |
  | 1 | discrete: `PowerOnActions`/`PowerOffActions` by `IRCommandName`; sent only when the state differs |
  | 2 | toggle: `PowerToggleActions`, with the relative state walked the shortest way (`state.lua:186-265`) |

  The initial state is Off. **State is updated while the plan is built** (optimistic).
- **Inputs:** `InputFeature.Inputs[]` (`InputName`, `InputOrder`, `Actions[]`
  (IR*Action by `IRCommandName`), `ActionSetTypeId` (2 = change-only), `InputType`).
  - The role's `SelectedInput.Name` → `SetValue Input`.
  - `SelectedInput.ChannelNumber` → `SetChannel`, which **fails for transport 64**.
- **Order:**
  1. power list, then leave list (BT first), then inputs, interleaved by device delays;
  2. then enter actions, the automation scene, **then `currentActivityId = id` (`:1437`)**;
  3. then the default channel and `updateActivityStatus(2)`.
- **Concurrency:**
  - `runactivity` while the status is 1 or 3 → **202**;
  - starting the running activity → help-discretes;
  - Off and Start overlap in the stock engine, so a late power-off can land after the next
    power-on [HW, 2026-10-24].
- **Errors:** IR 500/503 aborts; the status still goes to 2 (on). IP failures never abort,
  because they are async.
- **IP pitfalls in activities:**
  - non-power `LeaveActions` are fired without protocols (`:1209-1214`), so IP steps get
    **592**;
  - `SetChannel`/`DefaultChannel` on IP → 592 (`model/device.lua:451-457`);
  - an HID role on IP → 592.

## 6. Activity and state feedback

- `updateActivityStatus` bumps `stateVersion`, saves, and broadcasts `connect.stateDigest?notify`
  for status 1, 3 and 2 (`activity.lua:912-930`).
- `connect.statedigest?get` answers **304** unless the requester's version ≠ `stateVersion`
  (`connectserver/apihandler/statedigest.lua:9-20`).
- `stateVersion` is random 50–100 at boot and isn't persisted. `configVersion` and
  `contentVersion` are persisted (`core/statedigest.lua:54-111`).
- `harmony.engine?getCurrentActivity` is queued in `actionQueue`, so it answers after pending
  presses.
