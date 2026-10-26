# 03 Touch → hub transport

## 1. UI → hal

- `NetworkSwitch:request(cmd, args, cb, "ltcp")` sends `hot.1.<cmd>` to the Touch hal on
  127.0.0.1:16716 when `provision.mode == 4` and paired. Otherwise it goes to the Touch's own
  luaworks on 16717 (`LD/network/networkswitch.lua:61-123`) [SRC].
- Framing: JSON `{"id","cmd","data","timeout"}` over LTCP (`LD/network/hbus.lua:244-259`).
- **One request in flight**, with a FIFO behind it (`hbus.lua:95-109, 268-272`):
  - more than 25 queued → a synthetic `{code:500}` after 1 s;
  - the Lua side has no timeout; hal's per-verb timeouts apply (30 s for `control.` and
    `harmony.`, 5 s default) [SRC, `re/touch-fw/notes/hal-firmware.md`];
  - a slow request (sync, getstate, resource) **delays** the presses queued behind it.

## 2. Button message (`LD/appscommon/harmony.lua:2496-2528`)

```text
cmd  = "control.button?" .. ("press" | "hold" | "release" | "fire")
data = {
  equadId = "16417",
  buttonKey = <name>          -- hard keys, gesture hard resolutions
  | indexInMenu = <number>,   -- soft buttons, number pad, gesture soft resolutions
  deviceId = <number>?,       -- device screen, gestures, Sonos/HEOS reroute
  functionGroupType = 2?,     -- number pad
  sequenceId = <number>?,     -- gesture bound to a sequence (no key or index)
  keyLatency = 200 | 0,       -- 200 on a hard-key press
  timestamp = <ms>,           -- relative to the first press; used by the hub's stale filter
  ulem = <bits>               -- press/fire only: 0x01 activity, 0x02 device, 0x04 gesture, 0x08 hard, 0x10 soft
}
```

## 3. hal → RF (`C/touch_hal.c`) [SRC]

- `libhal_rf_hot_hbus_without_lock` strips `hot.1.` and tries the **optimized** encoder first;
  it falls back to type-9 zlib JSON (`:10860-10891`).
- Optimized verbs (6): `control.button?press|hold|release|fire`, `connect.statedigest?get`,
  `harmony.engine?getEventQueueCount`.
- **Button packer** (`:13940-14003`):
  - requires `equadId == "16417"`;
  - maps `buttonKey` through a **29-name table**; an unknown name falls back to type-9;
  - a flags byte (0x01 key, 0x02 index, 0x04 device, 0x08 FGT, 0x10 sequence, 0x20 latency,
    0x40 timestamp, 0x80 ulem), each field followed by a varint.
- **Local reply.** For the button verbs, hal sends fire-and-forget and **answers the UI
  itself with 200** (`:14059-14070`). The UI sees only RF-level failures (−500 timeout, −503
  link loss), never hub-side resolution errors [INF from SRC].

## 4. Other verbs a "button" can become

| UI action | Verb |
|---|---|
| Activity tile | `harmony.activityengine?runactivity {activityId, async:true, args:{rule:"start"}}` |
| Off key | the same, with `rule:"end"` |
| Favorite channel | `harmony.engine?startActivity {activityId?, channel}` / `harmony.engine?changeChannel {…}` |
| Home Control scene | `harmony.activityengine?runactivity {activityId:<sceneId>, args:{rule:"start"}}` |
| Home Control device | `harmony.automation?setstate {state:{<devId>:{…}}}` / `?getstate` |
| Help | `harmony.engine?helpSync`, `?helpDiscretes` |

## 5. Hub side: engine entry (`LW/tasks/connectserver/transport/ltcpserverconnector.lua`) [SRC]

- One task per LTCP connection. **All hal-originated traffic shares the hal connection's
  `clientId`.**
- `handleCommandCallback` calls `engine.processMessage` **synchronously in the connection
  task**, then replies. A slow synchronous handler (for example `harmony.automation?setstate`
  into a slow plugin) stalls every later message on that connection, Touch presses included.
- Verifiers on `control.button?*`: `IsSyncComplete` returns **202 while the hub syncs**
  (`LW/tasks/connectserver/core/verifiers.lua:407-413`).

## 6. Acknowledgement layers

| Layer | What the Touch gets | Meaning |
|---|---|---|
| hal | local 200, immediately | radio-level "sent" |
| engine | LTCP 200 after queueing (`activity.lua:378, 392, 411, 416`) | **accepted** (the Touch never sees it for optimized verbs [INF]) |
| async callback | `hbus:notify(nil, cmd, {errorCode, …})` → hal → HOT 0x0a | **executed or failed**: IR/HID/BT only on failure; **IP always** (with the HTTP code); long/short `pressType`; `sequenceFinished` |
| broadcast | `connect.stateDigest?notify`, `startActivityFinished`, `automation.state?notify` | state; **only the first LTCP client** receives broadcasts (`LW/tasks/connectserver/main.lua:110-133`) |

Whether the async notifies actually reach the Touch UI is unproven on hardware (§23).

## 7. IR from the Touch's blaster

When a device's `ControlPort` is 0 ("IR control is from remote"), the hub's
`irsender.startIrCommand` uses `/rf/hot/1/ir/ir_send` (`TLW/…/core/irsender.lua:32-60`). The
hub resolves the press, then tells the Touch's hal to blast. This was seen in an earlier
hardware log as `/ir/ir_send` after `runactivity` (`re/reports/touch-hot.md`) [HW].
