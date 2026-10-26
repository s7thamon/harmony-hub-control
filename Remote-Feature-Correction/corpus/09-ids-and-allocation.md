# 09 IDs and allocation

## ID spaces

| ID | Where it lives | Read by the engine? | Notes |
|---|---|---|---|
| `Activity.Id-` | ActivityList; map identifiers; `ActivityId-` | yes (current activity, map identifier) | Melodious allocates new ones from the **button-ID band** (`wizard-model.js:337-367`) |
| `Device.Id-` | DeviceList; maps; roles; actions | yes | HA writer: one counter shared with commands and the protocol; C IR forms: max device + 1, or a random band |
| `Command.Id-` | DeviceList | no (commands resolve by name) | HA writer keeps them by name |
| `Protocol.Id-` | ProtocolList; command `ProtocolId` | yes | |
| `ButtonMapId-` | MapList | no | ≤ **52944089** = Logitech-made (Melodious never rebuilds those) |
| `ButtonId` | MapList | no | Melodious allocates above **1878029713** |
| `SequenceId` | map `Sequences` | yes | |
| `FunctionId-` | actions; FunctionList | Touch gesture lookup only (when > 0) | Melodious writes 0 |
| Role `Id-`, `SelectedInput` ids | ActivityList | no | the wizards re-issue them every save |
| AutomationConfig ids | AutomationConfig | automation task | separate space (`udn`, gateway ids) |

## Allocators

| Writer | ButtonMapId- | ButtonId | Device / command | Sequence |
|---|---|---|---|---|
| Web wizard / Touch editor (`createAllocator`, `wizard-model.js:36-41, 262-296`) | > 52944089, unseen | > 1878029713, skipping every `Id`/`Id-`/`ButtonId`/`ButtonMapId(-)` seen in Activity/Map/Function/Device lists | — | — |
| Android | same floors | same | — | button band, unique among `SequenceId`s |
| Hub Lua device screens (`identityAllocator`) | same floors | same; reused by `hard:<key>`/`soft:<command>` | — | `Sequences = null` |
| HA writer (`CommitHaDevices`) | screens as above | screens as above | `max(all Id- in DeviceList ∪ ProtocolList, 39000000) + 1…`; device kept per entity, command per name (`codexactivity.lua:2110-2116, 1985`) | — |
| C IR forms | — | — | device: max device + 1 or `90000000 + time % 9e6`; command: max + 1 or `39000000 + time % 9e6` (`codex_webui.c:3815-3817, 4380-4381`) | — |
| BT bridge (`tools/bluetooth_device_bridge.mjs`) | **max + 1 (not floor-aware)** | max + 1 | max + 1 | cleared |

## Hazards

- **Floor-unaware allocators:** the BT bridge on a hub whose MapList maximum is below the
  floor would create maps that look "Logitech-made" to the device-screen builder [INF].
- **ID reuse across kinds:** `create_ir_device` uses max **device** ID + 1, which can equal an
  HA **command** ID (HA device N has commands N+1…). Harmless to the engine (different
  namespaces) [INF]. No collision exists in the live data.
- **Churn:** the wizards re-issue every 16414 `ButtonId` and every role `Id-` on every save.
  Harmless to the engine, noisy for diffs (plan P06).
- **Text-scan lookup in C:** `strstr` on `"Id-":<id>` can match a longer ID with the same
  prefix (`codex_webui.c:3503-3509, 3762-3768`). It is latent while all IDs have the same
  length.
