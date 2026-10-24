# Hub Protocols

A reference to the Harmony Hub's own local protocols — the interfaces the stock
firmware exposes on the device and the local network. It is written from
black-box and static analysis of a hub we own, in our own words, to explain how
the local-control features in this project work underneath.

This describes the **stock hub's** interfaces. For the web UI's REST API that
this project adds, see `API.md`. For the security posture and what not to commit,
see `SECURITY.md`.

> Addresses are shown as `<hub-ip>`. Loopback means the interface is only
> reachable from software running on the hub itself, not from the LAN.

---

## 1. Interfaces at a glance

| Port / socket | Scope | Speaks | Role |
|---|---|---|---|
| `127.0.0.1:16716` | loopback | LTCP | Hardware server (IR, RF, Bluetooth, LED, Wi-Fi, flash). The hub's hardware daemon listens here. |
| `127.0.0.1:16717` | loopback | LTCP | Engine server. The hardware daemon connects *out* to this to deliver events (a remote button, a Bluetooth status change) up to the control engine. |
| `127.0.0.1:8333` | loopback | HTTP | A thin `GET/POST /api/<command>` bridge to the engine, used by local helpers. |
| `127.0.0.1:80`, `127.0.0.1:443` | loopback | TCP accept only | `codex_webui` accepts and closes connections here; nothing is read or sent. While the cloud blocker is on, `/etc/hosts` points `ping.myharmony.com` here, so the hardware daemon's `wifi.status` connectivity probe, which the Harmony Touch checks before its own Sync, succeeds. |
| `<hub-ip>:8088` | LAN | HTTP + WebSocket | The engine's LAN control channel (the "hbus" message bus over HTTP/WS). |
| `<hub-ip>:5222` | LAN | XMPP | The engine's XMPP control channel (the classic Harmony app/remote API). |
| `<hub-ip>:5224` (UDP) | LAN | custom | A discovery responder: a client announces a callback port and the hub connects back and sends an info blob. |
| `239.255.255.250:1900` (UDP) | LAN multicast | SSDP | UPnP discovery; answers `M-SEARCH` and points at a device-description URL on 8088. |

The three loopback channels (16716 / 16717 / 8333) and the two LAN channels
(8088 / 5222) all reach the same internal command set. **None of them require
authentication by default** — see §6.

---

## 2. LTCP — the hardware wire format (16716 / 16717)

LTCP is a small binary request/response/notify framing used between the engine
and the hardware daemon. Messages are built from 64-byte-oriented packets.

**Primary packet** (the header of a message):

| Offset | Field | Meaning |
|---|---|---|
| 0 | service id | constant marker byte |
| 1 | operation | `ping, open, seek, write, read, flush, devctl, close, command, notify` (0–9) |
| 2 | message id | 0–63, rolling; a reply echoes it with the high bit set |
| 3 | param count | low 6 bits; high bit would indicate a trailing checksum (off by default) |
| 4… | parameters | length-prefixed; a leading `0x80` flags a NUL-terminated string, otherwise a big-endian integer |

**Secondary (payload) packets** carry the body: a sequence byte, a length byte
(with a continuation flag and an optional extended-length form reaching ~16 KB),
then the bytes. The body is UTF-8 JSON, optionally followed by binary.

**The virtual-file model.** The hardware daemon models its features as a tiny
virtual filesystem. A client `open`s a path (for example an IR-send or an
LED path), receives a handle, issues `command` / `write` / `devctl` on it, then
`close`s it. The same table also matches short dotted command names (see §4).

**Responses** echo the request's message id with the high bit set; a reply id of
all-ones marks an error frame, and a dedicated sentinel marks end-of-data.
Transport error names include things like *Busy*, *UnknownHandle*,
*UnknownAction*, *BadDataLength* and *CheckSumMismatch*.

---

## 3. hbus — the JSON message shape

On top of LTCP (and inside the HTTP/XMPP channels) the hub exchanges "hbus"
messages. The shapes are:

- **Request:** `{ "id": <n>, "cmd": "<category.noun?verb>", "params": { … } }`
- **Response:** `{ "code": 200, "data": { … } }` (HTTP-style integer codes)
- **Notify (event):** an asynchronous push carrying a state digest, an event name
  and a parameter.

Command names are dotted, e.g. `harmony.engine?startactivity`,
`control.button?press`, `connect.statedigest?get`. A long vendor-prefixed form is
collapsed to the short form before dispatch. A request whose verb is a hardware
verb (see §4) is forwarded to the hardware daemon; everything else is handled by
the engine.

---

## 4. Command families

### Hardware verbs (handled by the hardware daemon)

Prefixes: `ir.`, `rf.`, `bthid.`, `bt.`, `hid.`, `sys.`, `wifi.`

| Family | Examples | Purpose |
|---|---|---|
| IR | `ir.send`, `ir.cap`, `ir.loopback`, `ir.test` | Blast a code, learn a code, self-test |
| RF | `rf.pairing`, `rf.unpair`, `rf.info` | Pair / unpair a Harmony RF remote; query remotes |
| Bluetooth HID | `bthid.connect`, `bthid.disconnect`, `bthid.report`, `bthid.status` | Act as a Bluetooth keyboard/controller to a TV/console |
| Bluetooth LE | `bt.leconnect`, `bt.lepair`, `bt.lesenddata`, `bt.lereaddata` | Drive a Bluetooth-LE accessory as a GATT client |
| USB HID | `hid.setdevice`, `hid.report` | Route keystrokes to an RF/BT/USB HID target |
| LED | `sys.led` | Set the front LED state |
| System | `sys.info`, `sys.ping`, `sys.reboot`, `sys.factoryreset`, `sys.otaupdate`, `sys.logread` | Status, reboot, factory reset, staged update, logs |
| Wi-Fi | `wifi.status`, `wifi.connect`, `wifi.networks`, `wifi.wps` | Join / scan / status |

IR payloads carry a compact timing blob (carrier period, pre-silence, minimum
repeats, then mark/space durations). The hub's IR learning (`ir.cap`) returns a
captured blob in the same shape. See `API.md` for the web UI's IR endpoints.

### Engine verbs (handled by the control engine)

| Category | Examples | Purpose |
|---|---|---|
| Activities | `harmony.engine?startactivity`, `?getcurrentactivity`, `?allpoweron`, `?setsleeptimer`, `?changechannel` | Run/stop activities, power, sleep timer |
| Buttons | `control.button?press|hold|release|fire` | Button actions |
| Home control | `harmony.automation?discover|getstate|setstate|toggle|status|identify` | Read/write smart-home devices and scenes |
| State | `connect.statedigest?get|update` + event pushes | Current activity/status, change notifications |
| Config / resources | `proxy.resource?get|put`, `harmony.engine?config`, `?getconfighash` | Read/write the device and activity database |
| System / info | `connect.sysinfo?get`, `harmony.system?systeminfo`, `connect.deviceinfo?get` | Inventory and status |
| Setup / firmware | `setup.sync?…`, `setup.firmware?…`, `harmony.firmware?packageinstall` | Sync, firmware and package management |

Home-control device control is performed **locally** (the engine talks to the
smart-home device over the LAN); only some integrations also use a vendor cloud
for discovery or remote access.

---

## 5. Discovery

- **Reverse-callback (UDP 5224):** a client sends a datagram naming a service
  type and a callback port; the hub opens a TCP connection back to the client and
  sends an information blob (firmware version, friendly name, identifiers,
  control port). The classic Harmony app uses this to find the hub.
- **SSDP (UDP 1900):** standard UPnP `M-SEARCH`; the hub answers with a
  `LOCATION` pointing at a device-description document served on 8088.

---

## 6. Security posture

By design the stock hub trusts the local network. Specifically:

- The loopback channels (16716 / 16717 / 8333) are unauthenticated — they assume
  only on-device software reaches them.
- The LAN channels accept commands without a credential in the common
  local-control configuration: the XMPP channel's handshake succeeds for any
  login, and the HTTP channel's only gate is an `Origin` header check that a
  client fully controls.
- Sensitive verbs (reboot, factory reset, staged firmware update, the SSH-daemon
  install hook) are reachable through the same unauthenticated surface.
- The discovery responder returns device metadata to any host that asks and will
  connect back to a client-specified address and port.

This is why this project treats the hub as trusted-LAN equipment (see
`SECURITY.md`) and why the web UI this project adds offers an optional global
HTTP authentication check. Hardening the stock LAN channels (binding them more
tightly, or placing an authenticated proxy in front) is tracked in `TO_DO.md`.

---

## 7. How this project uses these protocols

- The web UI server issues hardware verbs (IR send/learn, Bluetooth HID, LED,
  status) to the hardware daemon over LTCP via a small local helper.
- The offline activity/sync plugins read and write the engine's resource database
  with `proxy.resource?…` and react to `config_new` rebuilds.
- The cloud blocker keeps the engine's cloud transports from reaching out so that
  all of the above stays local.

See `API.md` for the REST surface, `BUILD.md` for how the components are built,
and `FULL_FEATURE_ANALYSIS.md` for the evidence-graded feature list.
