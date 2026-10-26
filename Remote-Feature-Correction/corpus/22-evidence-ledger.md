# 22 Evidence ledger

## 1. Revisions

| Item | Identity |
|---|---|
| Melodious | `main` @ `3bd6badd639b55ccbd673c35b83d96bdb5a796f9`; untracked `Android/HANDOFF.md` and `UI_Redesign_Gemini.md` left untouched |
| Deployed `/pkg/codexactivity/codexactivity.lua` | md5 `b9a2d9e3637e0de4d33d7b451e2243f3`, equal to HEAD |
| Deployed `/opt/luaworks/tasks/connectserver/netservicestarter.lua` | md5 `f8c8c12079fc9bb67e643f9d278e12d4`, equal to HEAD |
| Cloud blocker | `1` (enabled) |
| Hub | Linux 2.6.31-g89d565c MIPS, fw 4.15.600 |
| Touch | Linux 2.6.37-ge384483 ARM, fw 4.15.330 |
| ha-melodious | `c6d137b055df18a8fd555ebd76a3047568bfcad3` (v0.1.0), read-only public clone |
| `~/Repos/harmony/re` | not a git repository; md5s below |

| File (under `~/Repos/harmony/re/`) | md5 |
|---|---|
| `touch-fw/dl/4.15.330.712524.hfw2` | `fad205fefcb9bca5f15c29a585853945` |
| `luaworks/tasks/harmonyengine/apihandler/activity.lua` | `b805085f88d92db17b8250da5e71a754` |
| `luaworks/tasks/harmonyengine/core/ipmanager.lua` | `1281a36db44658e7745e4cbc03047355` |
| `luaworks/tasks/harmonyengine/loader/userconfigreader.lua` | `1792250cea0d1b125c7396e14d249040` |
| `luaworks/tasks/harmonyengine/model/protocol.lua` | `954b4b248ff439ac269514e8a061e16f` |
| `luaworks/tasks/harmonywebservices/core/resourcemanager.lua` | `e25eb40acda4aeba117eb01fa12f7790` |
| `luaworks/tasks/harmonywebservices/apihandler/resource.lua` | `6b342a0ec89d093439f32a1281786dc3` |
| `luaworks/tasks/automation/apihandler/automation.lua` | `5c0070a6cdf1b862fdd6b69f1a6b90a4` |
| `luaworks/tasks/automation/main.lua` | `28f7a2f032421995e894f90eb36d120c` |
| `touch-fw/luaworks-dec/luaworks/tasks/harmonywebservices/proxy/sync.lua` | `53107697aca347be84066825e285d632` |
| `touch-fw/cs/rootfs/opt/luadraws/appscommon/harmony.lua` | `691440a54fc6d87a11485c7050c47e55` |
| `touch-fw/cs/rootfs/opt/luadraws/juniper/gesturepad.lua` | `d1c37af1589edb2d93cabef2dea3f775` |
| `touch-fw/cs/rootfs/opt/luadraws/juniper/init.lua` | `c130556b73a1911477320978d07d1361` |
| `touch-fw/cs/rootfs/opt/luadraws/juniper/devicemode.lua` | `56e21ffa3bd3a5a3bb5edad0ba0157b9` |
| `touch-fw/cs/rootfs/opt/luadraws/juniper/style.lua` | `4fa3c9c16fc5ffecbb87fb3169b827d3` |
| `touch-fw/cs/rootfs/opt/luadraws/juniper/hainterface.lua` | `f2ba51be6567ae7ab161cb571bebef25` |

The Touch rootfs is in the case-sensitive sparsebundle `touch-fw/touchfw.sparsebundle`, mounted
at `touch-fw/cs`.

## 2. Runtime observations (2026-10-25, read-only)

| # | Observation | Method |
|---|---|---|
| R1 | Hub and Touch resource directories listed | `ls` over SSH |
| R2 | Touch/hub resource equality (§20) | `cat`, `cmp`, `jq -S` diff |
| R3 | The Touch's index carries the hub's etags | normalized read |
| R4 | Touch SyncCounter: success, no aborts | `cat` |
| R5 | Structural counts and integrity (§20) | `/tmp/melodious-research/scripts/xref.mjs` (counts only) |
| R6 | Hub log: web-UI `holdaction`s over websocket; no Touch presses | `logread` |
| R7 | Touch boot log: engine resource loading, UI subscriptions, `automation?getstate` after resync | Touch `logread` |
| R8 | Hub engine command line; cloud blocker = 1; deployed checksums | `ps`, `cat`, `md5sum` |

**No writes, restarts, reboots, uploads, debug changes, sync triggers, button sends or HA calls
were made.**

## 3. Source observations

Every `file:line` in this corpus was read. The four research track notes
(`/tmp/melodious-research/notes/track{A,B,C,D}*.md`, local and sanitized) carry the full
citation sets:
- A: the Touch UI and hal;
- B: the hub engine, resources and automation;
- C: Melodious writers, generators and validators;
- D: ha-melodious, HA core webhook behaviour and AutomationConfig.

Directly re-verified while writing the report:
- `LD/appscommon/harmony.lua:49, 2400-2404, 2435-2441`
- `LD/juniper/gesturepad.lua:121-139, 732-750`
- `LD/juniper/style.lua:1910`
- `LD/juniper/numpad.lua:25-110`
- `LD/main.lua:130-142`
- `LW/…/ipmanager.lua:620-640`
- `LW/…/activity.lua:598-606, 1128-1140, 1210-1216`
- `LW/…/resourcemanager.lua:260-275, 427-462`
- `TLW/…/proxy/sync.lua:1205-1262`
- `MEL/payload/scripts/netservicestarter.lua:560-619`
- `MEL/payload/activity/codexactivity.lua:1280-1316, 1802-1811, 1990-2012, 2345-2383`
- `MEL/payload/mqtt/codexmqtt.lua:50-72`
- `MEL/payload/source/codex_webui.c:2755-2775, 3245-3270`
- `ActivityGraphBuilder.kt:512-534, 865-875`
- `wizard-model.js:181-211`
- `remote-layout.js:52-84`
- `views/touch-screen.js:67-69`
- `views/key-repeat.js:1-20`

## 4. Earlier hardware results relied on [HW]

| Date | Result | Source |
|---|---|---|
| 2026-10-24 | IP spike: taps and holds arrive; a uid-less device kills the IP task; a 404 triggers a rescan | memory (ha-ip-device-path) |
| 2026-10-24 | Writer gate (PR #55): the Touch syncs and lists an IP device; sends; activity power; removal guard; clean revert | `MEL/docs/HOME_ASSISTANT.md` results |
| 2026-10-24 | Missing `CD_` → 553 sync abort loop; fixed by the empty-record guard (PR #54) | memory (touch-sync-cd-404) |
| 2026-10-24/25 | A `16417Device` map alone gives a working screen (soft and hard); hub-built screens for HA and IR devices (PR #61) | memory (touch-device-screen-map-only) |
| 2026-10-25 | Touch root SSH; USB suspend behaviour; RF HOT reads with a 30000 ms timeout | memory (touch-root-route); `re/reports/touch-usb-rf-mapping.md` |

## 5. Inference register (things stated as [INF] that matter for plans)

| Inference | Plan that tests it |
|---|---|
| The UI never sees hub resolution errors (hal answers locally) | P21 G1 (observe the Touch log) |
| Effective long-press threshold ≈ 600 ms | P21 G3 |
| Order over gap slots isn't guaranteed (`pairs()`) | P04 gate |
| A gesture to a device without a map errors in Lua | P18 / P21 G1 variant |
| Multi-device HA activity starts can lose commands | P16 / G7 |
| Non-member mappings are harmless to `harmony.engine?config` consumers | P13 / G9 |
| The Touch tolerates an unknown AutomationConfig gateway type | P19 / G10 |
| A self long-press makes one-shot HA buttons fire once | P11 Option B |
