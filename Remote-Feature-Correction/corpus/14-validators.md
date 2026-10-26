# 14 Validators

Three validators exist; Android has none.

| Check | Hub `validateGraph` (`cx:342-592`) | Web `validateMapList` (`touch-model.js`) | Advanced editor (`activity-ui.js` `validateGraph`) | Android |
|---|---|---|---|---|
| Top-level arrays present | ✓ | MapList only | ✓ | — |
| Activity IDs valid/unique | ✓ | — | ✓, plus unique names | — |
| Role device references | ✓ | — | ✓, plus `SelectedInput` exists on the device | — |
| Map activity/device references | ✓ | — | ✓ | — |
| Map and button `__type` | ✓ (`cx:410-475`) | ✓ | partial | — |
| Hard/gesture `ButtonKey` present | ✓ | ✓ | ✓ | — |
| Soft `IndexInMenu` non-negative integer | ✓ | ✓ | ✓ | — |
| Duplicate `IndexInMenu` in **activity** maps (number pad separate) | ✓ (`cx:489-504`) | ✓ | — | — |
| Duplicate `IndexInMenu` in **device** maps | ✗ (deliberate: Logitech data has one) | ✗ | ✗ | — |
| Duplicate hard `ButtonKey` in a map | ✗ | ✗ | ✗ | — |
| `ButtonId` positive/unique; map ID unique | ✗ | ✗ | ✓ (`au:1795-1820`) | — |
| `ButtonState` 0/1 | ✗ | ✗ | ✓ | — |
| Action-less buttons in activity maps | ✗ | ✗ | ✓ | — |
| Sequence shape + step device references | ✓ (`cx:421-462`) | shape only | — | — |
| `ButtonSequenceAction` → sequence in the same map (press/long/double) | ✓ | ✓ | — | — |
| Long/double device + activity references | ✓ (`cx:506-536`) | — | ✓ | — |
| `ButtonClientAction` shape | ✗ | ✗ | — | — |
| **Command names exist on the device** | ✗ | ✗ | ✗ (catalog UI only) | — |
| FunctionList references / exactly one `ActivityFunctionMap` | ✓ (`cx:540-590`) | — | ✓ | — |
| Surface totality / 16420 count | ✗ | ✗ | ✓ | — |
| `ButtonMapIdentifier` ↔ `ActivityId-`; duplicate identifiers | ✗ | ✗ | ✓ / ✗ | — |
| `EnterActions`/`LeaveActions` references | ✗ | — | — | — |
| Sequence step `Order` numeric | ✗ (**the stock loader throws without it**) | ✗ | — | — |
| Gesture target has a device screen with the command | ✗ | ✗ | ✗ | — |
| IP device on paths that drop IP (non-power leave, channel/HID roles) | ✗ | ✗ | ✗ | — |

## Consequences

- The wizard and Android can save graphs the advanced editor later refuses (duplicate activity
  names; a BT keyboard device without a keyboard role) [INF].
- The live data passes every hub rule; it contains exactly one duplicate soft slot, in a
  Logitech device map, which is allowed [RT].
- The hub and web copies share fixtures (`MEL/tools/webui-sim/fixtures/touch-maplist.json`),
  run by both `codexactivity-validate-test.lua` and `touch-map-validation.test.mjs`.

## Tests run 2026-10-25 [RT, local]

| Suite | Result |
|---|---|
| `luajit tools/touch-validator/codexactivity-barrier-test.lua` | 5/5 |
| `luajit tools/touch-validator/codexactivity-device-screens-test.lua` | 34/34 |
| `luajit tools/touch-validator/codexactivity-ha-devices-test.lua` | 44/44 |
| `luajit tools/touch-validator/codexactivity-validate-test.lua tools/webui-sim/fixtures/touch-maplist.json` | 18/18 (without the argument it prints usage and exits 2) |
| `luajit tools/touch-validator/netservicestarter-guards-test.lua` | 12/12 |
| `node --test` in `tools/webui-sim` | 500/500 (135 suites) |
| ha-melodious `python3 -I -B -m unittest discover -s tests` | 12/12 (covers `devices.py` only) |
| Android Gradle | not run (it would download dependencies) |

Plan P07 lists the rules to add.
