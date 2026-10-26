# P20 Security hardening

Status: Proposed · Tier T5 · Area: docs, `codexmqtt.lua`, `codex_webui.c`, ha-melodious · Depends on: P03 · Blocks: —

The web UI intentionally has no HTTP auth by default and is a trusted-LAN tool
(`docs/AI_HANDOFF.md`). These items narrow the blast radius without changing that stance.

| # | Exposure | Evidence | Recommendation |
|---|---|---|---|
| 1 | The HA webhook ID (the only secret) sits in ProtocolList. It is exported by `/export/protocols` and `/export/bundle`, synced to the Touch, and sent in clear over HTTP. | `codex_webui.c:1946, 6260`; Touch sync list (corpus §10) | Document hub Basic auth as recommended when HA devices exist. Redact the protocol `Url` path in exports unless the export is a full backup. Keep lock and alarm off this path (as now). |
| 2 | codexmqtt `<base>/hbus` passes **any** `{cmd, params}` to `engine.processMessage`, so anyone with broker publish rights runs arbitrary engine commands | `codexmqtt.lua:584-594` | An allow-list (activity start/stop, holdaction), with `hbus` behind an explicit config flag that defaults off. |
| 3 | `/import` writes up to 8 resource files without validation or lock | `codex_webui.c:7627-7794` | P03 Stage 2 (a transactional plugin op); require auth when it is configured. |
| 4 | The HA webhook accepts `local_only` callers; a LAN device that knows the ID can trigger allowed actions | `ha-melodious __init__.py:173-176` | This is inherent in the design. The allowed-value whitelist already limits it. Document it. |
| 5 | `harmony.automation?setstate` (P19) would be reachable by any LTCP or websocket client | stock | When P19 lands, the plugin's `setState` must enforce the same value whitelist as the webhook. |

## Work breakdown

1. Docs: `docs/SECURITY.md` and `docs/HOME_ASSISTANT.md`.
2. `codexmqtt.lua`: the allow-list plus a flag; tests in a new Lua test.
3. `codex_webui.c`: export redaction (with a test on hub-emu).

## Hardware gate

- Optional: verify MQTT discovery and activity control still work in HA after the allow-list
  (on the owner's server).

## Decisions

—
