# Plans: ranked list and dependency order

| ID | Title | Tier | Area | Depends on |
|---|---|---|---|---|
| [P01](P01-documentation-corrections.md) | Documentation corrections | T0 | docs | — |
| [P02](P02-writer-lost-update.md) | Writer lost update and read-back race | T1 | C, Lua | — |
| [P03](P03-reload-flag-and-raw-writers.md) | Reload-flag race and raw writers | T1 | C, Lua, MQTT | — |
| [P04](P04-device-screen-slot-stability.md) | Stable device-screen slots | T2 | Lua | — |
| [P05](P05-shared-key-alias-core.md) | One key-alias table and one matching rule | T2 | Lua, C, JS, Kotlin | — |
| [P06](P06-activity-map-mirror-and-editor-parity.md) | Activity map mirror and editor parity | T2 | JS, Kotlin | P05 (soft) |
| [P07](P07-validator-hardening.md) | Validator hardening | T2 | Lua, JS | — |
| [P08](P08-command-reference-integrity.md) | Command rename and delete integrity | T2 | C, Lua | P03 |
| [P09](P09-save-timeouts-and-outcomes.md) | Save timeouts and honest outcomes | T1 | C, Kotlin | P02 |
| [P10](P10-ha-integration-robustness.md) | HA integration robustness (D1–D5, D7, D10, D11, D13, D16) | T3 | ha-melodious | — |
| [P11](P11-ha-hold-and-one-shot-semantics.md) | HA hold and one-shot semantics (D6) | T3 | ha-melodious | — |
| [P12](P12-ha-setup-and-feedback.md) | HA setup validation and failure feedback (D8, D9) | T3 | ha-melodious, Lua | — |
| [P13](P13-ha-action-devices-in-activities.md) | HA action devices on activity keys without membership | T3 | JS, Kotlin, Lua | P05, P06 |
| [P14](P14-ha-engine-limit-guards.md) | Guards for engine paths that drop IP commands | T3 | Lua, JS | P07 |
| [P15](P15-ha-parameter-presets.md) | Parameterized actions as fixed presets | T3 | ha-melodious | P10, P11 |
| [P16](P16-ha-inputs-and-activity-timing.md) | HA input selection and multi-device activity timing | T3 | hardware, docs | P21 |
| [P17](P17-touch-number-pad-on-hub-screens.md) | Touch number pad on hub-built screens | T4 | Lua | P04 |
| [P18](P18-gesture-coverage.md) | Gesture coverage | T4 | Lua, JS | P07 |
| [P19](P19-automationconfig-state-spike.md) | AutomationConfig live-state spike | T4 | new /pkg plugin, HA | P12, P21 |
| [P20](P20-security-hardening.md) | Security hardening (webhook exposure, MQTT hbus, /import) | T5 | C, MQTT, docs | P03 |
| [P21](P21-hardware-validation-programme.md) | Hardware validation programme (G1–G10) | T5 | hardware | per step |

## Suggested order

```text
P01 ─┬─ P02 ── P09
     ├─ P03 ── P08 ── P20
     ├─ P04 ── P17
     ├─ P05 ── P06 ── P13
     ├─ P07 ── P14, P18
     ├─ P10 ── P11 ── P15
     ├─ P12 ───────────── P19
     └─ P21 (G1–G4 read-only presses any time after approval; G5+ after the plan each step belongs to)
```

Waves:

1. **Read-only proof (P21 G1–G4) and the documentation fixes (P01).** No code risk, and
   they settle the open questions the later plans lean on.
2. **Safety (P02, P03, P09).** They stop silent data loss before generators change.
3. **Consistency (P04, P05, P06, P07, P08).** Every generator produces the same data.
4. **HA (P10–P16).** The integration fixes run in the integration's own repository and can
   proceed in parallel with wave 3.
5. **New capability (P17–P19)**, each behind its own design approval.
