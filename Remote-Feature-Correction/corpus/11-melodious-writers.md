# 11 Melodious writers and the save transaction

Prefixes:
- `cw` = `MEL/payload/source/codex_webui.c`
- `cx` = `MEL/payload/activity/codexactivity.lua`
- `wm` = `MEL/tools/webui-sim/public/js/wizard-model.js`
- `tm` = `MEL/tools/webui-sim/public/js/views/touch-model.js`
- `au` = `MEL/payload/web/activity-ui.js`
- `agb` = Android `ActivityGraphBuilder.kt`
- `vm` = Android `MelodiousViewModel.kt`

## 1. Two write mechanisms

| Mechanism | How | Etag | Reload | Publish | Lock | Rollback |
|---|---|---|---|---|---|---|
| **Plugin** | C writes `/var/volatile/codex-activity-request.json` under `flock`; the `codexactivity` task saves through `resMgr.saveResource` | **new** etag + hetag | `config_new` | yes | yes | plugin restores snapshots with the old etags; C restores on read-back mismatch |
| **Raw** | C `write_file_atomic` onto `/data/resources/*.json`, then writes `/data/codex/reload_resources` | **old** etag | by whichever task consumes the flag | only if codexactivity consumes it | **no** | none (backup directory only) |

## 2. All write paths

| # | Path | Lists | Mechanism |
|---|---|---|---|
| 1 | Web wizard create/edit (`/api/activity-save`) | Activity, Map, Function | plugin; **all three get new etags whenever anything changed** (`cx:637-688`) |
| 2 | Web activity delete/reorder | same | plugin |
| 3 | Web Touch on-screen editor | Map (Activity/Function echoed) | plugin |
| 4 | Advanced editor (`#editor`) | all three, plus auto-repairs | plugin |
| 5 | Android wizard / delete / Touch editor | all three | plugin, **always `syncRemote=true`** (`vm:1132, 1432, 1456`) |
| 6 | `/api/activity-sync` | re-saves the on-disk three | plugin |
| 7 | Device settings `CommitDeviceSettings` | DeviceList | plugin (`cx:1227-1253`) |
| 8 | HA devices `CommitHaDevices` | ProtocolList → DeviceList → MapList (changed ones only) | plugin (`cx:2046-2319`) |
| 9 | Device screen `CommitDeviceScreen` | MapList | plugin (`cx:1655-1673`) |
| 10 | IR device create / lab target | DeviceList | **raw** (`cw:3807-3870`) |
| 11 | IR device edit | DeviceList | **raw** (`cw:3872-3902`) |
| 12 | IR device delete | DeviceList | **raw** (`cw:3604-3664`); the web UI first strips the device's maps through the plugin |
| 13 | IR command add / learned | DeviceList (+ProtocolList) | **raw** (`cw:4313-4394, 3449-3463`) |
| 14 | IR command update/rename | DeviceList (+ProtocolList) | **raw** (`cw:4230-4311`) |
| 15 | IR command delete / clear | DeviceList | **raw** (`cw:3666-3739, 8165-8196`) |
| 16 | IR database import | DeviceList (+ProtocolList) | **raw** (`cw:4469-4638`) |
| 17 | Logitech catalog import | DeviceList | **raw** (`cw:4742-4840`) |
| 18 | Protocol auto-repair | ProtocolList | **raw** append (`cw:3474-3498`) |
| 19 | `/import` (single or bundle) | any of the five + AutomationConfig, MQTT, Wi-Fi, BT | **raw**, up to 8 files, **non-atomic, no graph validation, no lock** (`cw:7561-7794`) |
| 20 | Bluetooth device bridge | DeviceList, Map, Function (Activity in reuse mode) | offline Node tool → `/import` bundle (`tools/bluetooth_device_bridge.mjs:181-452`) |
| 21 | 16420 keyboard maps | Map | created by 1/4/5 when a keyboard role exists |
| 22 | Graph repair CLI (`tools/activity_graph_repair.mjs --apply`) | Map, Function (+Activity) | plugin via `/api/activity-save` |
| 23 | Remote "activity started correctly" PUT | ActivityList (drops `Alternatives`) | resMgr, new etag; **outside the flock; no publish** (`MEL/payload/scripts/netservicestarter.lua:654-678`) |
| 24 | codexmqtt | none, but **consumes the reload flag** and sends `config_new` with **no publish and no sync guard** | `MEL/payload/mqtt/codexmqtt.lua:54-71, 657-662` |
| 25 | BT saved devices | `/data/codex/bt-devices.json` (not a Harmony resource) | raw |

## 3. Activity-save transaction (paths 1–6, 22)

1. HTTP → C checks the JSON shape (`cw:3231-3240`).
2. Read the three files; **compare `baseRevision` (FNV) outside the lock** (`cw:3241-3266`) →
   409.
3. Semantic diff; backup if changed (`cw:3267-3275`). With nothing changed and
   `syncRemote` false, skip (`cw:3278`).
4. `offline_writer_lock` (flock, ≤ 500 × 100 ms = 50 s) (`cw:2739-2748`).
5. Unlink and write the request; poll ≤ 450 × 100 ms = **45 s** for a matching `id`
   (`cw:2770-2801`). On timeout, unlink the request (a request not yet read is cancelled).
6. Unlock.
7. **Read back outside the lock** and compare semantically (`cw:3287-3303`). On a mismatch or
   failure, roll back by re-committing the old text (`cw:3340-3361`).
8. Plugin (`cx:594-743`):
   1. snapshots;
   2. validate against the **current** DeviceList;
   3. refuse during a stock sync;
   4. save Activity → Map → Function with new etags and verify each;
   5. `config_new`;
   6. activity-engine barrier (≤ 25 s by the clock, ≤ 250 steps);
   7. publish.

## 4. HA, device-screen and device-settings ops

- Read-modify-write inside the plugin (no client base revision needed).
- True no-ops when nothing changed (`cx:1644-1647, 2261-2264`).
- On the C side's 45 s timeout: **503 with no rollback**, though the plugin may have committed
  (`cw:2908-2926, 2980-2997, 3032-3049`).
- Dry run (HA): returns before encode, save, reload and publish; still takes the lock; C
  skips backup. **Side-effect-free** [SRC].

## 5. Proven transaction defects

| Defect | Evidence |
|---|---|
| **Lost update:** the base check happens before the lock, and the plugin has no base check | `cw:3257` vs `cw:2765`; `cx:594-645` |
| Read-back outside the lock can roll back another writer's commit [INF window] | `cw:2802-2806, 3287-3361` |
| Raw writers take no lock | §2 rows 10–19 |
| codexmqtt consumes the reload flag (no publish) | `codexmqtt.lua:54-71` |
| Android's 20 s read timeout < 25 s barrier, 50 s lock | `CodexHubRestClient.kt:54-57` |
| [INF] Request + preceding raw-reload barrier > 45 s → spurious rollback | `cx:2353-2415` |
| `baseRevision` excludes DeviceList (command edits don't conflict with a pending wizard save) | `cw:1971-1985` |
| netservicestarter's ActivityList PUT is outside the flock and mutates the table `getResource` returned [INF narrow race] | `MEL/payload/scripts/netservicestarter.lua:654-678` |

## 6. Timeouts

| Layer | Value |
|---|---|
| Writer lock wait | 50 s |
| Reply wait (C) | 45 s |
| Plugin engine barrier | 25 s (by the clock) |
| Android HTTP read | 20 s |
| Browser | none |
| HA client | 120 s (`HAM/hub.py:33-40, 72`) |

## 7. Deployment notes [HW]

- After changing `codexactivity.lua`, the engine keeps the old plugin loaded until the hub
  reboots. A new op then answers `422 unknown local operation`.
- After a reboot, the writer starts a minute or two after the web UI; until then it answers
  `503`.
- `codex_webui` reads POST bodies only by **Content-Length** (no chunked). Test POST paths on
  `tools/hub-emu`, not just the Node sim.
- Hub `/data` is a ~5 MB jffs2. Watch free space before installs; BusyBox has no `df`.
