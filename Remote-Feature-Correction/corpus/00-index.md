# Corpus index

This corpus is everything learned in the 2026-10-25 research into button mapping, map
generation and Home Assistant support. Each page stands alone. Citations use these prefixes:

| Prefix | Path |
|---|---|
| `MEL/` | `~/Repos/harmony/harmony-hub-control/` (Melodious, `main` @ `3bd6bad`) |
| `HAM/` | `schlambos/ha-melodious` @ `c6d137b` (v0.1.0), `custom_components/melodious/` |
| `LW/` | `~/Repos/harmony/re/luaworks/` (hub engine, fw 4.15.600) |
| `LS/` | `~/Repos/harmony/re/luaworks-share/` (LuaSocket and friends) |
| `TLW/` | `~/Repos/harmony/re/touch-fw/luaworks-dec/luaworks/` (Touch engine; its button, loader, sync and IR modules are identical to the hub's) |
| `LD/` | `~/Repos/harmony/re/touch-fw/cs/rootfs/opt/luadraws/` (Touch UI, plain Lua; **the Touch loads `juniper/`**, `LD/main.lua:135-142`) |
| `C/` | `~/Repos/harmony/re/ghidra/c/` (decompiled native code) |

Evidence tags:

| Tag | Meaning |
|---|---|
| **[SRC]** | read in source |
| **[RT]** | observed on the live devices (read-only, 2026-10-25) |
| **[HW]** | proven in an earlier owner-run hardware gate |
| **[INF]** | inference |

| # | Page | Covers |
|---|---|---|
| 01 | [System overview](01-system-overview.md) | components, processes, who resolves what |
| 02 | [Touch input and UI](02-touch-input-and-ui.md) | keys, taps, gestures, context, gates, rendering |
| 03 | [Touch → hub transport](03-touch-to-hub-transport.md) | message shapes, hal, RF, acknowledgements |
| 04 | [Hub button resolution](04-hub-button-resolution.md) | map choice, button choice, action types |
| 05 | [Press semantics](05-press-semantics.md) | press, hold, release, long, double, fire, sequences |
| 06 | [Execution transports](06-execution-transports.md) | IR, Bluetooth, HID, IP, activities |
| 07 | [IP device engine reference](07-ip-device-engine-reference.md) | ipmanager in depth: the HA path |
| 08 | [Resource model and schemas](08-resource-model-and-schemas.md) | every list, every field, invariants |
| 09 | [IDs and allocation](09-ids-and-allocation.md) | ID spaces, floors, allocators |
| 10 | [Sync and publication](10-sync-and-publication.md) | resource manager, etags, publish, Touch pull |
| 11 | [Melodious writers](11-melodious-writers.md) | all 25 write paths and the transaction |
| 12 | [Map generators](12-map-generators.md) | wizard, editors, device screens, preservation |
| 13 | [Alias tables](13-alias-tables.md) | key matching rules and their divergence |
| 14 | [Validators](14-validators.md) | what each validator checks and misses |
| 15 | [HA integration](15-ha-integration.md) | ha-melodious end to end, constraints, defects |
| 16 | [AutomationConfig and Home Control](16-automationconfig-and-home-control.md) | the stock state path |
| 17 | [Capability matrices](17-capability-matrices.md) | device type × context; HA domains; IP vs AutomationConfig |
| 18 | [Drop, transform, repeat catalogue](18-drop-transform-repeat-catalogue.md) | every place a command changes fate |
| 19 | [Constants and timeouts](19-constants-and-timeouts.md) | every number that matters |
| 20 | [Live snapshot structure](20-live-snapshot-structure.md) | sanitized structural facts |
| 21 | [Contradictions resolved](21-contradictions-resolved.md) | old claims vs current evidence |
| 22 | [Evidence ledger](22-evidence-ledger.md) | revisions, checksums, observations |
| 23 | [Open questions](23-open-questions.md) | what still needs hardware |
| 24 | [Glossary](24-glossary.md) | terms |
| 25 | [Safety and operating rules](25-safety-and-operating-rules.md) | how to work on these devices |

The synthetic example graph is in `../fixtures/synthetic-graph.json`, and is explained in §08.
