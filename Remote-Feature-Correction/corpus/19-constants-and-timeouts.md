# 19 Constants and timeouts

| Constant | Value | Where |
|---|---|---|
| Touch surface / EquadID | `16417` | `LD/appscommon/harmony.lua:49` |
| Touch hold repeat | **300 ms**, repeating | `harmony.lua:2435-2441` |
| Touch hard-key `keyLatency` | 200 ms (0 for soft and holds) | `LD/juniper/init.lua:1830` |
| Touch button hold timeout (widget) | 1000 ms (unused for commands) | `LD/draws/event/button.lua:21` |
| Gesture press/release timeouts | 200 / 200 ms | `LD/juniper/gesture.lua:21-26` |
| Gesture threshold | 60 px | same |
| Gesture hold | 700 ms | same |
| Double-tap window | 300 ms | same |
| UI queue limit | 25 requests → synthetic 500 after 1 s | `LD/network/hbus.lua:209-217` |
| hal per-verb timeouts | 30 s (`control.`, `harmony.`), 5 s default | `re/touch-fw/notes/hal-firmware.md` |
| Activity popup | polls the digest every 5 s; error after 60 s | `LD/juniper/style.lua:~537-630` |
| Touch screen timeout (observed) | ~29 s | earlier USB mapping [HW] |
| Hub long-press threshold | ≥ **550 ms** from press to a hold (dequeue times) | `LW/…/apihandler/activity.lua:709-746` |
| Effective long press from the Touch | ≈ 600 ms (the second hold) | [INF] |
| Hub stale-press filter | `IR_BUTTON_TIMEOUT_MS` 1000 ms (5-sample moving average) | `activity.lua:45-46, 77-111` |
| Home-control short press sleep | 2000 ms (blocks `actionQueue`) | `LW/tasks/automation/core/hamanager.lua:589-591` |
| IP queue deadline | `IP_COMMAND_TIMEOUT_MS` **500 ms** from enqueue | `LW/…/core/ipmanager.lua:20, 278-285` |
| IP HTTP timeout | `Timeout` field, else `HTTP_TIMEOUT` 2 s; seconds per socket operation | `ipmanager.lua:23, 379, 435` |
| SSDP rescan | at most once per 24 h; blocks 10–35 s | `ipmanager.lua:593-600`; `ssdp.lua:1427-1452` |
| Dummy relaunch window | ≤ 120 s after boot | `core/statedigest.lua:73-84` |
| `stateVersion` at boot | random 50–100, not persisted | `core/statedigest.lua:54-67` |
| hetag | random 100000–999999999 | `harmonywebservices/core/common.lua:283-285` |
| Melodious writer lock wait | 50 s (500 × 100 ms) | `MEL/payload/source/codex_webui.c:2739-2748` |
| Melodious reply wait | 45 s (450 × 100 ms) | `codex_webui.c:2777-2801` |
| Plugin engine barrier | 25 s by the clock, ≤ 250 steps | `MEL/payload/activity/codexactivity.lua:22, 704` |
| Android HTTP read timeout | 20 s | `CodexHubRestClient.kt:54-57` |
| HA client timeout | 120 s | `HAM/hub.py:33-40, 72` |
| HA push delay after an entity change | 5 s | `HAM/const.py:12` |
| HA set limits | 64 devices, 128 commands, 32 inputs, 64-byte names, 96-byte values, 48-byte command names, 256-byte webhook | `codexactivity.lua:1711-1868` |
| Web hold lease | heartbeat 200 ms; the hub releases 700 ms after the last; cap 31 s | `MEL/tools/webui-sim/public/js/views/key-repeat.js:16-20` |
| Melodious ID floors | map IDs > 52944089; button IDs > 1878029713; HA device/command counter ≥ 39000000 | `wizard-model.js:36-41`; `codexactivity.lua:1273, 1692` |
| HA protocol carrier | 38000 | `codexactivity.lua:2021-2041` |
| Hub `/data` | jffs2, ~5 MB | [HW] |
