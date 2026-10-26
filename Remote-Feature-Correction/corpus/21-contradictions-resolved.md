# 21 Contradictions resolved

Earlier documents, reports and notes were treated as leads and checked against current source,
deployed code and live data.

| # | Earlier claim | Where | Resolution | Evidence |
|---|---|---|---|---|
| 1 | Gestures reach the hub as `control.button?press {buttonKey:"SwipeUp"}` | `re/reports/touch-hot.md` §1.3 | **Contradicted.** The Touch resolves the gesture through the target device's `16417Device` map and sends that button's index or key plus `deviceId`. Wire confirmation pending (P21 G1). | `LD/juniper/gesturepad.lua:121-139, 732-750` |
| 2 | The hub falls back to `Device<id>`/`Activity<id>`/`Root` maps | `touch-hot.md` | **Contradicted.** It returns at `:1856` when the `16417…` map is missing; the fallback code is unreachable. | `LW/…/apihandler/activity.lua:1848-1885` |
| 3 | Raw JSON writes never reach the Touch because the hub answers 304 on matching etags | `MEL/docs/HOME_ASSISTANT.md:59-66`; an earlier memory note | **True only with the cloud blocker off.** With it on, the override always serves the disk file (200). The real gate is the publish trigger, made racy by codexmqtt consuming the reload flag. | `MEL/payload/scripts/netservicestarter.lua:574-619`; `resourcemanager.lua:427-462`; `TLW/…/sync.lua:1244-1262`; `codexmqtt.lua:54-71` |
| 4 | The web activity editor writes hard buttons only to 16414 | `HOME_ASSISTANT.md:228-230` | **Fixed for the web and Android wizards** (PR #56). **Still true for the advanced editor.** Live data consistent. | `wizard-model.js:669-756`; `activity-ui.js:1449-1470` |
| 5 | Every activity must have two surface maps, plus 16420 for keyboard roles | `MEL/docs/AI_HANDOFF.md:86-92` | Only "exactly one ActivityFunctionMap" is hub-enforced. The 16420 rule contradicts `SESSION_HANDOFF.md:216-219` (Logitech configs have none). | `codexactivity.lua:540-590` |
| 6 | Touch device screens need a DeviceFunctionMap | older `API.md` | **Contradicted** (already corrected in memory). The Touch never pulls FunctionList; a `16417Device` map alone works [HW]. | `TLW/…/sync.lua:1341-1434` |
| 7 | HA held keys repeat about every 250 ms | `HOME_ASSISTANT.md:23-24` | **The Touch repeats every 300 ms.** The web UI uses a 200 ms lease heartbeat. The 250 ms figure came from another client. | `harmony.lua:2435-2441`; `key-repeat.js:16-17` |
| 8 | The writer has no lock; overlapping requests → 503 | `HOME_ASSISTANT.md:203-206` | **Stale:** PR #57 added `flock` (a 50 s wait). | `codex_webui.c:2734-2748` |
| 9 | Plain http only because LuaSocket 2.0.2 can't do TLS | `HOME_ASSISTANT.md:25-26` | The mechanism is wrong: `works/http.lua` does TLS with validation. The limit is the certificate bundle (no ISRG Root X1). | `LW/works/http.lua:20-68`; `rcmgr.lua:63-100` |
| 10 | A 404 or no answer triggers an SSDP rescan | `HOME_ASSISTANT.md:49-51` | Qualified: also on no reply; only with a uid; **at most once per 24 h**; blocks the IP task 10–35 s. | `ipmanager.lua:578-608` |
| 11 | `KeyCode: ""` required per command | `HOME_ASSISTANT.md:45-47` | Not required; null works. | `userconfigreader.lua:514-516` |
| 12 | The activity list excludes `ButtonState 4` buttons | `re/touch-fw/notes/ui-devices.md` | Partly: they are moved to an unordered head and hidden by the renderer. | `harmony.lua:388-414`; `style.lua:1870-1872` |
| 13 | Tapping an HA device on the Touch does nothing | `HOME_ASSISTANT.md:213-214` (2026-10-24) | Superseded by PR #61: hub-built screens work [HW]. | `codexactivity.lua:1269-1529` |
| 14 | Setup's empty dry run proves the writer works | `HOME_ASSISTANT.md` setup | **Weak:** the webhook isn't validated, and any 422 is accepted. | `HAM/config_flow.py:36-44`; `codexactivity.lua:1847-1850` |
| 15 | The "device keeps every command" promise means no churn on power cycles | ha-melodious README | Merge order churns (D3). | `HAM/devices.py:147-149` |
| 16 | Track B: "MapList has 19 maps" | internal research note | An arithmetic slip; it is **20**. | `scripts/xref.mjs` [RT] |
| 17 | Track A cited `hops/gesturepad.lua` | internal research note | The Touch loads `juniper/`; the same logic was verified there. | `LD/main.lua:135-142` |
| 18 | Track C H3: the resource manager caches resources, so restore verification fails | internal hypothesis | **False:** `getResource` reads from disk every call. | `resourcemanager.lua:427-462` |
| 19 | Live HA state on the Touch exists only for AutomationConfig devices | memory | **Verified.** | §16; [RT] Touch log |
| 20 | Unmapped hard keys can be rejected locally before RF | brief lead | **Verified**, with two gates (global and map). | `init.lua:1827-1831`; `harmony.lua:2400-2404` |
| 21 | Soft indexes are both ordering and command resolution | brief lead | **Verified.** | §02 §7, §04 §3 |
| 22 | Duplicate indexes give different UI/hub outcomes | brief lead | **Verified:** across FGT 0 vs 1006 the Touch shows two rows; the hub runs the later one for both. | `harmony.lua:398-431`; `userconfigreader.lua:849, 879` |
| 23 | `ButtonImagePath` is ignored by a type-comparison bug | brief lead | **Verified.** | `juniper/style.lua:1910` |
| 24 | Number pads require specific client actions and function groups | brief lead | **Verified**, and refined: the `123` row is keyed by label; digits need FGT 2 and numeric `CommandName`s. | `juniper/numpad.lua:67-91`; `devicemode.lua:428` |
| 25 | USB mode and sleep affect notifications and sync | brief lead | **Consistent:** notifies arrive only while awake; resume runs a digest check; USB tethering still suspends. | `init.lua:1371, 1497-1504`; [HW] |
