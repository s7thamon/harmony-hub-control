# 24 Glossary

| Term | Meaning |
|---|---|
| **Accepted** | The hub engine queued a press and replied 200. Not proof of execution. |
| **ActivityFunctionMap / DeviceFunctionMap** | FunctionList entries grouping commands into function groups. Used by `harmony.engine?config` (app, HA Harmony integration), not by the Touch. |
| **AutomationConfig** | The hub resource for "home control" devices (lamps, plugs, covers, thermostats, scenes) backed by gateway plugins; the source of the Touch's Home Control screens and live state. |
| **Blocker (cloud blocker)** | Melodious's offline mode (`/data/codex/cloud_blocker.conf` = 1). It removes WAN egress, blocks cloud tasks, and replaces resource/sync handlers with local ones. |
| **CAPOD** | Connected-App Power-On Delay (`ConnectedAppPowerOnDelay`); the IP manager's post-failure window logic. |
| **CD_<id>** | Per-device content record that the Touch fetches in its content step. Missing → 553 abort unless the guard serves an empty record. |
| **codexactivity** | Melodious's hub Lua plugin (`/pkg/codexactivity`): the writer ops, validation, device screens, the HA writer, publish. |
| **codex_webui** | Melodious's C web server (:8080): the API, the writer lock, raw IR writers, `/import`. |
| **codexmqtt** | Melodious's MQTT bridge plugin. It also, problematically, consumes the reload flag. |
| **ControlSection** | The `IrProtocol` field holding an IP request template (`Url`, `Method`, `Header`, `Body`, `Timeout`). |
| **Device screen** | A Touch screen for one device, drawn from `16417Device<id>`. |
| **Digest (state digest)** | The hub state (`stateVersion`, `configVersion`, `contentVersion`, activity status) that the Touch polls and receives by notify. |
| **EquadID** | The remote surface type: `16417` = Harmony Touch; `16414` = another remote type; `16420` = the Bluetooth keyboard/HID surface; `16422`/`16423` = rocker remotes. |
| **Executed** | The action actually happened (IR sent, HA service succeeded). Only HA's logs or state prove it for HA. |
| **FGT** | `FunctionGroupType`. 0 normal, 2 number pad (own index space), 36 the `123` row, 1006 and others other groups. |
| **Gate (hardware gate)** | An owner-approved, step-by-step hardware test. |
| **HOT** | The hub–remote RF protocol (CC2544 radio); "optimized" packed button messages, or type-9 zlib JSON. |
| **hal** | The native daemon handling radio, IR, hbus, LTCP (Touch :16716 / hub engine :16717). |
| **hetag** | The hub's random per-resource tag in `index.json`, alongside `etag`. |
| **holdaction** | `harmony.engine?holdaction`: the app/API path to send a device command (or sequence) without MapList. |
| **IndexInMenu** | A soft button's slot. Both display order and the hub's lookup key. A JSON number. |
| **IP device** | A DeviceList device whose commands have `TransportType 64`, executed as HTTP requests through `ipmanager`. |
| **LTCP** | Local TCP JSON framing used between the UI, hal and the engine. |
| **Member (activity member)** | A device with a role in an activity; powered and input-switched by the activity. |
| **Mirror** | Copying 16414 activity hard keys into the 16417 (Touch) map. |
| **Optimized verb** | One of six verbs the Touch hal packs compactly over RF (the button verbs, `statedigest?get`, `getEventQueueCount`). |
| **Plugin path (writer)** | Saving through `codexactivity` → `resMgr.saveResource` with new etags → reload → publish. |
| **Publish** | `publishLocalRevision`: bump `configVersion` and `stateVersion`, save the digest, notify. Triggers the Touch pull. |
| **Raw write** | `write_file_atomic` straight onto `/data/resources`, keeping the old etag, plus a reload flag. |
| **Reload flag** | `/data/codex/reload_resources`: tells a hub task to `config_new` the named lists. |
| **Role** | `…ActivityRole` entries in an activity (Display, Volume, ChannelChanging, KeyboardTextEntry, …). |
| **Sent** | The Touch UI queued a `control.button` and hal answered 200 locally. |
| **Soft button** | `SoftRemoteButton`, an on-screen button on the Touch. |
| **Stale-Touch window** | The time between a hub map change and the Touch's sync, during which old labels run new commands. |
| **Surface** | A remote's map family (`16417…` maps for the Touch). |
| **Touch editor** | Melodious's on-screen button editor for `16417Activity` maps (web, and Android). |
| **uid** | `AutoDetectedDevice.Id` as seen by `ipmanager`. Required for IP devices. |
| **Wizard** | Melodious's activity creation/edit flow (web and Android). |
