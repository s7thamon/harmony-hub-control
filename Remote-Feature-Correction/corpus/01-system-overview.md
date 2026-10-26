# 01 System overview

## Components

| Component | Hardware / OS | Runtime | Role |
|---|---|---|---|
| **Harmony Hub** | MIPS, Linux 2.6.31, fw 4.15.600 | `lua main.lua --syslog --datadir=/data tasks/` (luaworks engine), `hal` (radio, IR, hbus), Melodious (`codex_webui` on :8080, the `/pkg/codexactivity` and `/pkg/codexmqtt` plugins, `netservicestarter.lua` override) | Owns the configuration, resolves every press, executes IR/BT/HID/IP, publishes revisions |
| **Harmony Touch** | ARM TI DA850, Linux 2.6.37, fw 4.15.330, skin 99, USB 046D:C12B | `luajit` in `/opt/luadraws` (UI), `lua` in `/opt/luaworks` (engine: sync, proxy, logging), `hal` (RF, IR, USB) | Draws from its synced copy; decides locally whether to send; sends presses over RF |
| **Melodious** | repo `harmony-hub-control` | C web server, Lua plugins, web UI, Android app, tools | Local writers, editors, generators, validators, offline guards |
| **ha-melodious** | Home Assistant custom integration | Python | Turns HA entities into hub devices; answers the webhook; calls services |
| **HA core Harmony integration** | HA built-in | websocket :8088 | HA controls the hub's activities and commands (uses FunctionList through `harmony.engine?config`) |

Process names: the Touch runs `lua` (cwd `/opt/luaworks`) and `luajit-2.0.0-beta10` (cwd
`/opt/luadraws`). No process is *named* luaworks or luadraws.

## Who resolves what

```text
            Touch (UI)                         Hub (engine)                        Target
 draws labels from its synced MapList   resolves the press against ITS MapList   IR blaster (hub or Touch)
 decides IF a press is sent             (16417Device / 16417Activity / Root)    BT / HID
 resolves gestures to device buttons    looks up DeviceList command + protocol   IP (HTTP) → HA webhook
 handles Home, Favorites, Off locally   runs sequences, long press, activities   AutomationConfig plugins
```

- **The Touch never executes commands itself.** Even IR "from the remote" is sent by the hub
  over RF to the Touch's blaster (`/rf/hot/1/ir/ir_send`, `TLW/…/core/irsender.lua:32-60`)
  [SRC].
- **The Touch sends indexes, not commands, for on-screen buttons.** Until it syncs, a moved or
  changed slot runs the new command under the old label: the **stale-Touch window**.

## Directions of control

| Direction | Mechanism | State? |
|---|---|---|
| Touch/hub → HA (B) | IP device (transport 64) → HTTP POST → ha-melodious webhook → service call | none returned |
| HA → hub (A) | HA's Harmony integration (8088); codexmqtt (activity select, power off, command, raw hbus) | activity-level only |
| HA state → remote (C) | **none today.** Possible only through AutomationConfig (Home Control screens) | live, for AutomationConfig types |

## Configuration flow

```text
editor / HA integration → codex_webui (flock) → codexactivity plugin
  → resMgr.saveResource (new etag + hetag) → config_new (engine reload)
  → publishLocalRevision (configVersion++, stateVersion++, notify)
  → Touch sees the digest change → pulls 9 resources (never FunctionList) → screens refresh
```

Details: §10, §11.

## Key facts at a glance

- `16417` is the Touch's surface ID (EquadID). Touch maps are `16417Activity<id>` and
  `16417Device<id>`. `16414` maps serve another remote type; the Touch ignores them.
- The hub reads a map's `ButtonMapIdentifier` and `__type` only. Surface and remote IDs are
  carried, not read.
- On-screen button `IndexInMenu` is both display order and the hub's lookup key, and must be a
  JSON number.
- FunctionList isn't needed by the Touch. The hub uses it for app and API command lists only.
- HA devices need `AutoDetectedDevice.Id`, `Raw: null`, an `IrProtocol` shape and transport 64,
  or the engine breaks (§07).
- A 200 anywhere means *received* or *accepted*, never *executed*.
