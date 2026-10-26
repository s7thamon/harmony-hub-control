# 04 Hub button resolution

All citations are under `LW/tasks/harmonyengine/` and are [SRC] unless tagged.

## 1. `processButtonCommand` (`apihandler/activity.lua:352-420`)

- `buttonName = params.buttonKey or tonumber(params.indexInMenu)` (`:394`). **Hard keys and
  gestures are strings; soft keys are numbers.**
- `params.sequenceId = tostring(params.sequenceId)`, so a missing value becomes `"nil"`
  (`:396`):
  - the "Insufficient Arguments" check never fires;
  - a nameless press looks up `sequences["nil"]` and gets 563.

| Verb | Handling |
|---|---|
| `hold` | queue `holdCommand`, reply 200 (`:372-379`) |
| `release` on a rocker | HA queue (`:380-393`) |
| any name containing "Activity" that is already queued or in progress | **404** (`:404-406`) |
| `press`/`fire` | queue `buttonPress`, reply 200 (`:408-411`) |
| `release` | `clearHoldEvents()` (drops queued holds), then queue `buttonPress` (`:412-416`) |

The reply means **accepted (queued)**, never executed.

## 2. `buttonPress` (`activity.lua:1831-2058`)

1. **Stale filter.** For anything except `release`: `filterButtonTimestamp(clientId,
   timestamp, tsTimeout)` keeps a per-clientId moving average of (hub ms − client ms) over 5
   samples. It discards a press whose lag exceeds `tsTimeout` (default **1000 ms**)
   (`:73-107, 1835`).
   - This runs **at dequeue time**, so queue delay counts.
   - Presses behind a sequence, an `actionQueue` activity start, or a home-control press (2 s
     sleep, `automation/core/hamanager.lua:589-591`) can be dropped.
2. **HID:** `hidCode` → keyboard role device (`:1844-1847, 1751-1771`).
3. **Map choice** (`:1848-1858`):
   - `deviceId` → `"<equadId>Device<deviceId>"`;
   - else, if the current activity ≠ −1 → `"<equadId>Activity<account.currentActivityId>"`;
   - else → `"<equadId>Root"`.
   - **If that map is missing: silent return (`:1856`).** The fallback to bare
     `Device<id>`/`Activity<id>`/`Root` (`:1859-1885`) is unreachable.
4. **Button choice** (`:1886-1935`):
   - a named press with FGT ≠ 2: `buttons[name]`, then `numPadButtons[name]`; `DVR` ↔ `Dvr`;
   - FGT 2, or a name matching `^Number` → `numPadButtons[name]`;
   - not found → retry `<equadId>Root`, then `Root`, using `buttons[name]` only;
   - **with no `16417Root` (the household's shape), the press is silently dropped.** A
     synthetic `Root` is created only when no Root map exists at all (`16414Root` exists, so
     it isn't) (`loader/userconfigreader.lua:839-848, 894-904`);
   - no name → `sequences[sequenceId]`.
5. **Home-control actions** go to `haManager.haButtonHandler` **only if** the map identifier
   contains `Root` (`:1979-1984`). In an activity or device map they log "Device not found"
   and do nothing.

## 3. Map loading (`loader/userconfigreader.lua:820-906`)

- Maps are keyed **only** by `ButtonMapIdentifier`. `__type` must contain `DeviceButtonMap`,
  `ActivityButtonMap` or `RootButtonMap`; a nil `__type` throws.
- **Not read on the hub:** `RemoteId-`, `SurfaceId-`, `ButtonMapSurfaceId-`, `ButtonState`,
  `TextOnRemote`, `MenuName`, images, `ButtonId`, `EventType` (for commands).
- Buttons:
  - `HardRemoteButton` → `ButtonKey`;
  - `SoftRemoteButton` → `MenuItem.IndexInMenu` stored as-is (**must be a JSON number**);
  - `GestureRemoteButton` → `ButtonKey`;
  - FGT 2 → `numPadButtons`, else `buttons`.
- **A button is stored only if it has at least one executable action** (`:875`).
- A duplicate key means **the later one wins** (`:849, 879`). A duplicate identifier means the
  last map wins (`:892`).
- Sequence actions are ordered by `Order`. A duplicate `Order` overwrites; **a missing `Order`
  throws in the loader**, which kills the engine task (`:676`).

## 4. Action types (`getButtonActions`, `userconfigreader.lua:780-818`)

| `__type` | Engine action |
|---|---|
| `ButtonCommandAction` | `SendCommand` (`DeviceId-`, **lower-cased** `CommandName`) |
| `ButtonActivityAction` | `handleActivityButton` → `run_activity` (help-discretes if it is the same activity) |
| `ButtonSequenceAction` | inlines `map.Sequences[SequenceId]`; sets `sequenceName` |
| `ButtonClientAction` | **none** → button not stored |
| `ButtonChannelAction` | **none** |
| `ButtonBookmarkAction` | **none** |
| `ButtonHomeControlAction` | `HomeControlPressAction` (`EventType` 1/2/3 → short/long/double; `ChangeType`, `Property`, `Value`, `Targets[1..3]`) |
| `ButtonProgramAction` | `runactivity {activityId=ProgramId, rule start / end(long)}` |
| other | debug log, no action |

- `EventType` is honoured only for home-control and program actions. For commands, the slot
  decides: `ButtonAction`, `ButtonLongPressAction` or `ButtonDoublePressAction`.
- A button with only a long action uses it as the short action (`:870-874`).
- `ButtonDoublePressAction` is parsed (`:867-869`), but used only for Root `HomeControlPlus/Minus`
  rockers (`activity.lua:1802-1833`).

## 5. Collisions and misses

| Case | Result |
|---|---|
| Two soft buttons with the same index (any FGT except 2) | same key `buttons[n]`; the later one wins. The Touch shows both rows (for FGT 0 vs 1006), and **both run the later button**. |
| Hidden (`ButtonState 4`) button | still occupies its index on the hub |
| String `IndexInMenu` | never matches the numeric lookup |
| Map missing | silent return |
| Button missing in map and Root | `log.notice` + return |
| Unknown device | "Device not found", nothing sent, `fireCommandsList` returns 200 (`model/action.lua:25-27`) |
| Unknown command name | `device:getCommand` returns nil; nothing sent (`model/device.lua:298-305`) |
| `holdaction` API with an unknown device or command | 565 / 566 |

## 6. FunctionList is not on the press path

- No reference exists in `buttonPress` or the loader, and `loadResource` has no FunctionList
  branch (`main.lua:444-508`).
- It is used for `harmony.engine?config` control groups (`apihandler/config.lua:180-259`), the
  config hash (`:94-108`), and `holdaction` label lookups (`activity.lua:275-311`).

## 7. Resources each Touch input needs on the hub

| Input | Needs |
|---|---|
| Hard key, activity | `16417Activity<current>` → DeviceList command → ProtocolList |
| Hard key, device screen | `16417Device<id>` → DeviceList → ProtocolList |
| Soft key | the same map, `buttons[IndexInMenu]` (or `numPadButtons` for FGT 2) |
| Gesture | the device map of the gesture's target (the Touch resolves it) |
| Long press | the same button's `ButtonLongPressAction` **and** `hold` messages ≥ 550 ms |
| Activity button | ActivityList and the activity engine |
| Home-control button | AutomationConfig, **Root map only** |
| `holdaction` without `deviceId` (apps) | FunctionList label lookup |

## 8. Timing hazard during activity start

- `account.currentActivityId` is set only at the **end** of an activity start
  (`activity.lua:1437`), after all IR.
- During a start triggered elsewhere (app, HA, codexmqtt), Touch presses resolve against the
  **old** activity's map, or against `16417Root`, which is missing, so they drop.
- During a Touch-triggered start, the Touch blocks keys itself.
