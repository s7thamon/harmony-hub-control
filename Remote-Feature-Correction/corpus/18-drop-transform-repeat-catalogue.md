# 18 Where a command is dropped, transformed, repeated or rerouted

"T" means it happens on the Touch; "H" on the hub. The "Seen as" column uses the four levels:
**displayed** (the row exists), **sent** (the UI queued it; hal answered 200 locally),
**accepted** (the engine queued it), **executed**.

## Dropped

| # | Side | Where | Condition | Seen as | Source |
|---|---|---|---|---|---|
| 1 | T | render | first touch after sleep (and its release) | not sent | `LD/draws/render.lua:1258-1278` |
| 2 | T | windows | message/edit/lock windows consume keys | not sent | `juniper/style.lua:3366-3385`; `settings/remoteLock.lua:56-62` |
| 3 | T | state | syncing, unprovisioned, link-loss screen, activity or sequence starting | not sent (release eaten too) | `juniper/init.lua:1731-1754` |
| 4 | T | global gate | no device screen and no activity | not sent | `init.lua:1827-1831` |
| 5 | T | map gate | key not in the current hard-key table; no fallback | not sent | `appscommon/harmony.lua:2400-2404` |
| 6 | T | BT pairing | BT-HID target unpaired | "pair in app" screen | `init.lua:1569-1579` |
| 7 | T | rendering | FGT 2 / `ButtonState 4` / non-table action / non-soft | not displayed | `style.lua:1870-1891` |
| 8 | T | duplicates | same index within FGT 0/36 | earlier row not displayed | `harmony.lua:402, 428` |
| 9 | T | client rows | `ButtonClientAction` with a non-magic label | sent; the hub has no button | `userconfigreader.lua:799, 875-881` [INF] |
| 10 | T | gesture | no matching button in the target device map, or no map | not sent / Lua error | `juniper/gesturepad.lua:121-139, 732-760` |
| 11 | T | gesture | resolves to a hard key that isn't in the activity's hard keys | not sent | `gesturepad.lua:750, 946`; `harmony.lua:2401-2404` |
| 12 | T | release | release while `startingActivity` | press sent, release not | `harmony.lua:2449-2453` |
| 13 | T | suspend | `ignoreRequests` during the fade | silently dropped; queue cleared | `network/hbus.lua:229-232, 288-297` |
| 14 | T | queue | more than 25 queued | synthetic 500 | `hbus.lua:209-217` |
| 15 | H | verifier | hub syncing | 202 | `connectserver/core/verifiers.lua:407-413` |
| 16 | H | activity key | already queued or in progress | 404 | `apihandler/activity.lua:404-406` |
| 17 | H | stale | press/fire > 1 s late at dequeue | accepted, not executed | `activity.lua:73-107, 1835` |
| 18 | H | map | `16417Device`/`Activity`/`Root` missing | accepted, not executed | `activity.lua:1856` |
| 19 | H | button | missing in map and Root | accepted, not executed | `activity.lua:1898-1923` |
| 20 | H | loader | zero-action buttons (client/channel/bookmark/unknown, unknown sequence) | never stored | `userconfigreader.lua:875` |
| 21 | H | expansion | unknown device or command name | accepted, nothing sent | `model/action.lua:25-27`; `model/device.lua:298-305` |
| 22 | H | home control | action in a non-Root map | nothing | `activity.lua:1979-2024` |
| 23 | H | double press | `ButtonDoublePressAction` | never executed | `activity.lua:1802-1833` |
| 24 | H | long press | long action but no holds arrive | short runs at release instead | `activity.lua:1949-1960` |
| 25 | H | IR modifier | `IRHoldAction` modifier | ignored | `model/action.lua:31-47` |
| 26 | H | dummy relaunch | ≤ 120 s after boot | IR/BT/IP suppressed | `core/irmanager.lua:59, 75`; `ipmanager.lua:274` |
| 27 | H | IP queue | > 500 ms in queue | 595, silent | `ipmanager.lua:278-285` |
| 28 | H | IP CAPOD | inside the window after a failure | HTTP skipped (601) | `ipmanager.lua:296-297, 574, 636-641` |
| 29 | H | IP without protocol | non-power leave actions; `holdaction` sequences | 592 | `activity.lua:1214, 603` |
| 30 | H | IP release | release | no HTTP | `ipmanager.lua:109-110` |
| 31 | H | IP task death | uid-less 200 or any error in the loop | all later IP silently queued forever | `ipqueuehandler.lua:4-8`; `ipmanager.lua:632` |
| 32 | H | SSDP scan | daily scan on 404/no reply blocks 10–35 s | queued IP expires | `ipmanager.lua:593-600` |
| 33 | H | IP channel / HID | transport 64 | 592 | `model/device.lua:451-457`; `ipmanager.lua:204-271` |
| 34 | H | IR errors | 500/503 | rest of sequence/activity aborted | `activity.lua:978-981, 1302-1308` |
| 35 | H | activity start | presses before `currentActivityId` updates | old map, or dropped | `activity.lua:1437` |
| 36 | H | dead tasks | any uncaught error in queue/engine loops | everything behind it | §06 |
| 37 | H | HA queue | rocker release | queued HA events discarded | `activity.lua:381-383, 1823-1825` |

## Transformed

| Side | What |
|---|---|
| T | gesture → device-map index or hard key + `deviceId`, or `sequenceId`; long and double chosen locally; hold falls back to short |
| T | Sonos/HEOS activity keys → speaker coordinator `deviceId` |
| T | hal: unknown key name → type-9 JSON instead of the optimized format |
| H | command names lower-cased |
| H | `DVR` ↔ `Dvr` |
| H | a non-FGT-2 index miss → number-pad space |
| H | a long-armed short press → `fire` at release |
| H | Lua-pattern template substitution; token re-expansion |
| H | transport 65 prefers `64name`, with IR fallback |
| H | `{IP}` refreshed from SSDP |
| H | multi-zone power rewrites |
| H | optimistic power/input state → later `SetValue` may send nothing |
| H | starting the running activity → help-discretes; a second activity press → help-sync power toggling |

## Repeated

| Side | What |
|---|---|
| T | `hold` every 300 ms until release |
| H | IR heartbeat per hold (HAL auto-repeat) |
| H | **IP POST per hold, with the same body** |
| H | multi-command (non-sequence) buttons fire on both press **and** release (only arises for the multi-zone power rewrite) |
| H | BT/BT-HID retries (5–30×); 403 renew retries ×2 |

## Rerouted

| Side | What |
|---|---|
| T | device-screen soft button → the **action's** device map, not the screen's device |
| T | activity soft button → the **hub's** current activity, which can differ from what the Touch shows |
| T | IR for `ControlPort 0` devices → hub → RF → Touch blaster |
| H | `runactivity` in the activity-engine task (concurrent with buttons); `startactivity` through `actionQueue` |
| H | `holdaction` (apps) by `deviceId`+command, no MapList; without `deviceId` → FunctionList label lookup |
| H | Root home control → `haButtonHandler` inline (2 s sleep); rockers → `haActionQueue` |
| H | `hidCode` → keyboard-role device |
| H | async results → the requesting client only; broadcasts → the first LTCP client only |

## Orphan releases (sent without a press)

- remote lock;
- the `Gesturepad` row on a device screen;
- a `123` row cancelled by drag-off.

Whether the hub acts on them is open (§23).
