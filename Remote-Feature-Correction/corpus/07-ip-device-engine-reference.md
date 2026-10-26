# 07 IP device engine reference (the Home Assistant path)

Source: `LW/tasks/harmonyengine/core/ipmanager.lua` unless stated. Everything is [SRC].
Hardware-proven facts are marked [HW].

## 1. Lifecycle of one IP command

```text
device:sendCommand (transport 64)
  → sendIpCommand → ipManagerQueue: params.timestamp = jiffies(); push ipActionQueue (:84-89)
     (returns true,200 to the caller immediately; activities never learn the outcome)
  → ipqueuehandler (single task, no pcall)
  → ipProcessCommand (:273-304)
       dummy relaunch (≤ 120 s after boot) → no-op
       queued > IP_COMMAND_TIMEOUT_MS (500) → discard, code 595, no callback
          (exception: a release while currentCommand exists)
       CAPOD window logic (ConnectedAppPowerOnDelay > 0 only)
       currentCommand = params
  → fireIpCommand (:106-271)
       if params.parameters and params.protocol and protocol.controlSection:
           release → currentCommand = nil, NO HTTP
           else    → sendDeviceCommand (+ 403 renew-PIN flow); fire clears currentCommand
       else → plugin branch (roku/sonos/heos by SSDP uid) → for Melodious devices: 592
  → getRequest (:411-442): render ControlSection
  → makeRequest (:372-387) → socket.http (= works/http.lua → LS/socket/http.lua)
  → sendDeviceCommand result handling (:560-662)
```

## 2. Template rendering (`getRequest`, `:389-442`)

- Substitution lists, in order:
  1. device local tokens: `{clientId}` (hub MAC), `{clientName}`, `{IP}` (`device.ip`, nil
     for Melodious devices), `{cookie}`, `{renewpin}`, `{Authorization}`;
  2. **command `Parameters`**;
  3. **device `Tokens.Parameters`**.
- Each item applies `string.gsub(data, Key, Value)` to `Url`, `Body`, `Method` and `Header`:
  - `Key` is a **Lua pattern**: braces are literal; `. - % ( ) [ ] * + ? ^ $` are magic;
  - `Value` is a **replacement string**: `%` not followed by a digit or `%` raises an error;
    a non-string value throws;
  - a value containing a later token is substituted again (a command value containing `{d}`
    would expand);
  - order within one list is arbitrary (`pairs`).
- `Header` must be a **JSON string** that decodes to an object; a decode failure gives 607,
  and a table-typed Header is ignored.
- `Body` must be a string, or there is no body.
- `Method` nil → GET.
- `Timeout`: `tonumber(Timeout)`, else 2. **Seconds, per socket operation** (connect and each
  receive), not a total deadline (`LW/works/socket.lua:220-222`; `LS/socket/http.lua:116`).
- `content-length` (lower case) = byte length of the body (`:438-440`). With it present, the
  body is sent raw; without it, LuaSocket would chunk.

## 3. HTTP client facts

- **Host header** = `reqt.host` **without the port** (`LS/socket/http.lua:206-219`). User
  headers are lower-cased and override the defaults, so a `Host` key in the Header JSON wins.
  Two Content-Length spellings collapse to one, arbitrarily.
- **Redirects** are never followed for POST or when a body exists (`:244-246, 303`).
- **The response body is ignored;** only the status code matters.
- **TLS:** `works/http.lua:20-68` rewrites `https://` to :443 and uses wolfSSL with
  certificate validation whenever the clock is past 1970 (`tasks/connectserver/core/rcmgr.lua:63-100`),
  apart from a CN whitelist from the `rootcertificates` package. The bundle lacks ISRG Root X1,
  so in practice **plain http** is needed for HA [SRC + LEAD].
- Hostnames resolve through `dns.toip`, cached.

## 4. Result handling (`sendDeviceCommand`, `:560-662`)

| Outcome | Effect |
|---|---|
| **200** | callback (code 200) to the requesting client, **always** (`:628-630`); then `capodDeviceList[params.uid] = nil` (`:632`). **With `uid == nil` this throws "table index is nil" and kills `ipqueuehandler`**: every later IP command queues forever, and button replies still say 200 [HW 2026-10-24]. |
| 201, 204, 3xx, other | failure: callback with the code, `capodDeviceList[uid] = now`, plus a second callback `601 "Capod time is set"` |
| 401 | "Authorization Required" |
| 403 | renew-PIN path or fallback |
| no response (connect error, timeout) or 404, **with a uid** | `ssdp:refreshIpAddress(uid)` (fails fast for an unknown uid); then, if `device.ip` is nil or the URL contains `{IP}`, **`ssdp:scan()` at most once per 24 h**. The scan **blocks the IP task for 10–35 s**, and everything queued meanwhile expires (`:578-608`; `connectserver/plugins/ssdp.lua:1427-1452, 1563-1731`). |
| transport 65 | IR fallback through `fallbackCmdHandler` (`:642-660`) |

## 5. Holds and repeats

- Press → one POST; `currentCommand` stays set.
- Each Touch `hold` → `ipManager.sendHold(longPressStatus)` → a new queued command with
  action `hold` and **the same body** → another POST (`:306-323`; `activity.lua:697-699`).
- Release → no HTTP.
- No repeats when the button has a long-press action (`longPressStatus` → `currentCommand =
  nil`, `:307-309`), after a `fire`, or after a failure.
- A slow webhook makes repeats self-throttle: holds wait more than 500 ms and are discarded.

## 6. Paths that call IP without a protocol (→ 592, silently)

| Path | Source |
|---|---|
| Activity `LeaveActions` other than Power Off | `apihandler/activity.lua:1209-1214` |
| `holdaction`-started sequences | `activity.lua:598-606` |
| Classic-BT retries | `:965, 973` (irrelevant to HA) |
| `SetChannel`/`changechannel` for transport 64 | `model/device.lua:451-457` |
| HID (`hid=…`, no parameters) | `ipmanager.lua:204-271` |

Paths that pass protocols (and so work):
- `buttonPress` (`:2043/2045`);
- long press (`:770/773`);
- activity power and input scheduling (`:1261, 1271`);
- enter actions and Power Off (`:1426`);
- `helpSync` (`:546`);
- `fireChannel` (`device.lua:443`).

## 7. Requirements for a working Melodious IP device (all [HW]-verified rules)

| Rule | Why |
|---|---|
| `Device.AutoDetectedDevice.Id` set, unique, not a real SSDP uuid (`melodious-ha-<id>`) | the 200 path indexes `capodDeviceList[uid]` |
| Device `Transport: 64` (not 65) | 65 adds an IR fallback and changes command lookup |
| Protocol `__type: "IrProtocol"`, `CarrierFrequency` numeric (38000), `IRSegments: []`, `CodeSegments: []`, `KeyCode: null` | `ControlSection` is read only for `IrProtocol`; otherwise the loader throws |
| Each command: `TransportType: 64`, `ProtocolId`, `Raw: null` **present**, `Parameters` with `{c}` | loader and template |
| `KeyCode` `""` or null | either works |
| The webhook answers **200** quickly | non-200 → failure callbacks, SSDP-scan risk; slow → the 500 ms queue deadline |
| Values free of `% " \ { }` and control characters | gsub replacement, JSON body validity, token re-expansion |

## 8. Gaps worth remembering

- The activity engine can't know whether HA acted. Power and input states are assumed.
- The only per-command result is the async callback to the **requesting** client (the Touch
  through hal, or the web UI through its websocket). The Touch UI ignores success codes.
