# P22 HA footprint: map Home Assistant entities to Touch controls (research and proposal)

Date: 2026-10-26. Researcher: research agent. Prompt: `prompts/03-P11-P13-P16-HA-footprint.md`.
Builds on: `results/P21-G1-G4.md` (cited, not re-run). Plans: P11, P13, P15, P16, P18, P21.

**Writes performed: none.** I used only read-only SSH (`cat`, `ls`, `md5sum`, `logread`, `ps`,
`/proc/uptime`) on the hub and the Touch, a read-only mDNS browse from the Mac, local reads of
the firmware source and the integration source, and local Python over private copies. No HA
calls, sends, syncs, publishes or presses.

Placeholders (no household names, IDs, entity IDs or URLs in this file):
- activities: `<activityA>` (TV/streaming, as in P21), `<activityB>` (PC activity with the
  gesture map, as in P21), `<activityC>` (second PC activity), `<activityM>` (audio
  activity), `<activityL>` (the lamp activity);
- devices: `<deviceTV>` (IR), `<deviceAMP>` (IR soundbar), `<deviceSTB>` (BT HID),
  `<deviceRCV>` (IR receiver), `<deviceDAC>` (IR);
- HA devices: `<deviceHA1>`…`<deviceHA4>` (lamps) and `<deviceCCA>` (the cast audio
  endpoint).

## 0. Preflight

| Check | Result |
|---|---|
| Hub SSH | OK (kernel 2.6.31), uptime ~35 h (no recent reboot) |
| Touch SSH | OK over USB (kernel 2.6.37); Mac USB interface already configured |
| Touch tethered | **yes** (locked screen: no live traffic possible; see P21 addendum) |
| SyncCounter, Touch | syncCount 0, conflicts 0, unchanged before and after this session |
| SyncCounter, hub | syncCount 0, conflicts 0, unchanged before and after |
| Resource copies | hub DeviceList, MapList, ActivityList, ProtocolList, AutomationConfig, FunctionList; Touch DeviceList, MapList, ActivityList, ProtocolList; both `index.json` (private) |

### Pending publish: the Touch lags the hub (explained, not caused by the agent)

- At 14:37:26 UTC today, about 2 minutes before my first login, the hub saved
  DeviceList and MapList through the resource manager and ran `config_new
  {DeviceList, ProtocolList, MapList}`. This is the HA writer path: the integration pushes
  5 s after an entity change.
- What it added: one new HA device, `<deviceCCA>` (media player, 9 commands), and its
  hub-built `16417Device` screen.
- The tethered Touch has **not** pulled it yet:
  - Touch DeviceList: 9 devices; hub DeviceList: 10;
  - the Touch MapList has every map except that device's screen;
  - every other map is semantically identical. The only difference is key order inside
    two `123` client actions.
  - ProtocolList, ActivityList and AutomationConfig etags match.
- Touch SyncCounter is unchanged. The cause is the tether: the Touch is on the locked
  screen. So none of the §Stop conditions applies.
- **It must still be settled before any `<deviceCCA>` press step** (see §6 step S0).

## 1. Inventory (task 1)

### 1.1 What is on the hub

- **5 HA entities:**
  - 4 lamps (`light` domain): `<deviceHA1>`…`<deviceHA4>`;
  - 1 `media_player`: `<deviceCCA>`.
- **Cast endpoint identity:** an mDNS `_googlecast._tcp` browse from the Mac found a
  Chromecast Audio whose cast friendly name equals `<deviceCCA>`'s hub name, so
  `<deviceCCA>` is the Chromecast Audio.
- **Other cast endpoints on the LAN:** 4 (including one cast group). None is in the HA set.
- **No HA entity exists for any IR device** (TV, soundbar, receiver, DAC).

### 1.2 Engine requirements (corpus §07 §7): all 5 devices pass

- `Transport 64`; every command has `TransportType 64`.
- `AutoDetectedDevice.Id` present, `melodious-ha-` prefix, unique.
- `Tokens.Parameters` has `{d}`.
- Every command has `Raw: null` present and a `{c}` parameter, with clean values.
- `ControlPort 7`; one `PowerFeature` each (discrete, PowerOn/PowerOff); no InputFeature.
- All delay fields are 0 (relevant to P16/G7).

### 1.3 Plugin path

- All 5 share one protocol: `IrProtocol`, CarrierFrequency 38000, empty segment arrays,
  `ControlSection` with `POST`, a JSON content-type header, body `{"device":"{d}","command":"{c}"}`
  and `Timeout "2"`.
- The URL is **plain http to an IP literal with an explicit port**, so there is no DNS per
  request (P16 URL guidance already met).
- So every command takes the **ControlSection branch** of `fireIpCommand` (corpus §07 §1),
  never the roku/sonos/heos plugin branch. Execution path: `ipActionQueue` → one POST per
  press/hold/fire, none on release.
- Webhook side (integration source, `devices.py`): a value is honoured only if it is in
  the entity's allowed set. Only `select_source:<src>` takes an argument; every other
  `:arg` is refused.

### 1.4 Command classification

Classes:
- **I** idempotent: repeats are harmless;
- **T** toggle / exactly-once: a repeat flips back or runs twice;
- **M** momentary step: repeats accumulate; this is the intended hold-to-ramp behaviour,
  but a slow tap adds one extra step.

| Entity | Command (value) | Class | Note |
|---|---|---|---|
| lamp ×4 | PowerOn (`turn_on`) | I | |
| | PowerOff (`turn_off`) | I | |
| | PowerToggle (`toggle`) | **T** | |
| | BrightnessUp/Down (`brightness_up/down` → `light.turn_on` ±10 %) | M | BrightnessUp on an off lamp turns it on |
| `<deviceCCA>` | PowerOn (`turn_on`) | I | cast `turn_on` returns early when not idle [HA source, from memory; verify] |
| | PowerOff (`turn_off`) | I | quits the cast app, so it **stops playback** |
| | VolumeUp/Down | M | HA steps the volume per call (step size unverified) |
| | Mute (`mute` → `volume_mute` with `not current`) | **T** | computed from HA's cached state at call time, so a hold may flip back or not |
| | Play (`media_play`) | I | |
| | Pause (`media_pause`) | I | |
| | PlayPause (`media_play_pause`) | **T** | |
| | Stop (`media_stop`) | I | |

**Totals: 5 entities, 29 commands = 13 idempotent / 6 toggle / 10 momentary.**

## 2. Control matrix (task 2)

### 2.1 Verb rules (from G1–G4 plus Touch source)

| Control shape | Messages | Safe for |
|---|---|---|
| Plain hard key, held | press + `hold` every 300 ms (G1a, G3, G4) | I, M |
| Plain hard key, tapped | the same; under 300 ms there is no hold | I, M (T is unsafe: any press over 300 ms repeats) |
| Plain on-screen row | press, then `hold`s while held (G1b, G4) | I, M (T is unsafe: same reason) |
| **Long-armed key ("self-long", P11 Option B: long action = short action)** | hub sends nothing on press; fires once at release (short), or once at the 2nd hold (~600 ms) (G3); no IP repeats (corpus §07 §5) | **T** (exactly once), I |
| Number-pad digit | single `fire` (G1c) | anything, but **N/A** here: the Touch needs FGT 2 commands whose names parse as numbers, and no HA command does (P15/P17) |
| Swipe / Tap gesture | press, then release ~200–240 ms later (G1d) | I, M; T only with margin (see below) |
| Hold-gesture (`SwipeXHold`/`TapHold`, finger held ≥ 700 ms) | press at 700 ms, then `hold` every 300 ms until finger-up | I, M only |
| Double-tap gesture | resolved Touch-side to an ordinary press | I (T with the margin caveat) |

Two source facts the design relies on:

1. **The gesture press arms the same 300 ms hold timer as any press**
   (`appscommon/harmony.lua:2428-2441`). A plain swipe's release at ~200–240 ms (G1d)
   cancels it with only ~60–100 ms of margin.
   - Toggles on gestures are therefore *probably* single-shot but not guaranteed.
   - Hold-gestures always repeat.
   - Gestures resolve to the target device's **hub-built screen** button, which never
     carries a long action. So a gesture can't be hub-protected.
2. **Durability depends on who owns the map.** The HA writer **rebuilds HA device screens
   whenever the device set changes** (corpus §12 §6–7):
   - a hand-added long action on an HA device screen would be silently lost;
   - `<deviceCCA>`'s screen will change once if its next/previous features ever appear
     (see §3).

   So:
   - exactly-once bindings belong in **`16417Activity` maps**, which the HA writer never
     touches;
   - the HA device screens' toggle rows stay hazardous until P11 Option A (HA-side
     debounce) or P11 Option B's builder flag ships.

### 2.2 Constraint compliance (applies to every row below)

| Constraint | How the design complies |
|---|---|
| Root-only home control | Only `ButtonCommandAction` → HA device command, the G4-verified path. No `ButtonHomeControlAction` or `ButtonProgramAction` anywhere. |
| Stale filter / queue blocking | IP sends return to `actionQueue` immediately, so HA buttons don't block presses. No hub sequences (they block `actionQueue` and trigger the Touch's sequence popup and key block). Multi-entity actions belong in HA scenes/scripts (one POST each). |
| 500 ms IP deadline | One POST per press. The fixed-IP URL means no DNS lookup per request. Bursts (several HA keys in quick succession) are G7's open question. |
| Storage rules | Every row has an executable action; numeric `IndexInMenu`; FGT 0 only; new rows fill gaps first (§5); no duplicate keys or indices. |
| Gesture limits | Every gesture target is a command present on that device's `16417Device` screen. Every hard-key resolution's `ButtonKey` is also a hard key in the same activity map (§2.5). |
| Transport reality | `<deviceSTB>` is BT HID (transport 32), not IR. Nothing here reroutes it. Every "IR retained" claim below names an IR (transport 1) device. |
| Tethered Touch | Every press step is done untethered. Logs come from hub `logread -f` live, plus one retrospective Touch `logread` after re-tether (the P21 method). |

### 2.3 Lamps (`<activityL>`, 16417 + 16414 activity maps; non-member lamps follow P13)

Current `16417Activity<L>`:
- VolumeUp/Down → `<deviceHA1>` BrightnessUp/Down (M, plain): OK;
- **VolumeMute → `<deviceHA1>` PowerToggle (T, plain): a live hazard.** A press of 300 ms or
  more toggles twice (G4 rule).

Proposed:

| Control | Binding | Class | Shape |
|---|---|---|---|
| VolumeUp / VolumeDown | `<deviceHA1>` BrightnessUp / Down (unchanged) | M | plain, hold ramps |
| VolumeMute | `<deviceHA1>` PowerToggle **+ `ButtonLongPressAction` = same** | T | self-long, exactly once |
| ChannelUp / ChannelDown | `<deviceHA2>` BrightnessUp / Down | M | plain |
| DirectionUp / DirectionDown | `<deviceHA3>` BrightnessUp / Down | M | plain |
| DirectionRight / DirectionLeft | `<deviceHA4>` BrightnessUp / Down | M | plain |
| Red / Green / Yellow / Blue | `<deviceHA1>` / `<deviceHA2>` / `<deviceHA3>` / `<deviceHA4>` PowerToggle, each with a self-long | T | self-long |
| On-screen rows idx 0–7 (FGT 0) | `<deviceHA1>` On, `<deviceHA1>` Off, `<deviceHA2>` On, Off, `<deviceHA3>` On, Off, `<deviceHA4>` On, Off | I | plain (holds harmless) |
| Gesture SwipeUp / SwipeDown | `<deviceHA1>` BrightnessUp / Down | M | resolves to that screen's **hard** `VolumeUp/VolumeDown` + `deviceId`. Passes the gate because the activity maps VolumeUp/Down. Hold-swipe = ramp. |
| Gesture SwipeRight / SwipeLeft | `<deviceHA1>` PowerOn / PowerOff | I | resolves to soft idx 0 / 1 + `deviceId` |
| Gesture Tap | **unassigned** until P11 A ships; then `<deviceHA1>` PowerToggle | T | the gesture margin and the hold fallback (TapHold repeats) make a toggle unsafe today |
| Off key | ends the activity; `<deviceHA1>` is the member, so its PowerOff runs (verified 2026-10-24/25) | I | local Touch handling |

Notes:
- Options for the self-long's long action: keep it equal to the short (pure P11 B), or give
  it a different exactly-once verb (for example long = PowerOff, which is idempotent). The
  baseline here is "equal". The owner decides.
- `<deviceHA2>`…`<deviceHA4>` are **non-members** of `<activityL>` (P13). The hub accepts
  this (corpus §14). The web/Android **wizard would drop these mappings** on the next save
  of `<activityL>`, and its open-time default fill would add others (corpus §12 §1). So:
  - **don't edit `<activityL>` in the wizard** until P13 lands;
  - use the single-map writer path (§6).

### 2.4 `<deviceCCA>` (cast audio): placed in `<activityM>` as a non-member

| Control | Binding | Class | Shape |
|---|---|---|---|
| Play (hard) | `<deviceCCA>` Play | I | plain |
| Pause (hard) | `<deviceCCA>` Pause | I | plain |
| Stop (hard) | `<deviceCCA>` Stop | I | plain |
| Select (hard) | `<deviceCCA>` PlayPause + self-long | T | self-long, exactly once |
| VolumeUp / Down / Mute (hard) | **unchanged: `<deviceRCV>` (IR)** | — | IR retained (§4) |
| FastForward / Rewind (hard) | **unbound** until `SkipForward`/`SkipBack` exist on `<deviceCCA>` (§3). Binding a missing command is drop #21: accepted, nothing sent, and no validator catches it. | — | — |
| On-screen rows idx 0–3 (FGT 0) | 0 `<deviceCCA>` PowerOn ("cast on"), 1 PowerOff ("stop casting"), 2 VolumeUp, 3 VolumeDown | I, I, M, M | plain |
| On-screen row idx 4 | `<deviceCCA>` Mute + self-long | T | self-long on a **soft** row: unverified (§U2) |
| Gesture Tap | `<deviceCCA>` Pause | I | soft/hard resolution on the cast screen. Pause is a hard key there, and the activity maps Pause after this change. |
| Gesture TapHold (explicit long) | `<deviceCCA>` Stop | I | explicit, so there's no fallback to Tap |
| Gesture DoubleTap | `<deviceCCA>` Play | I | |
| Gesture SwipeUp / SwipeDown | `<deviceRCV>` VolumeUp / Down (IR) | M | resolves to that screen's hard `VolumeUp/Down`; the gate passes |
| Gesture SwipeRight / SwipeLeft | unassigned until Skip exists | — | — |

Why not a member:
- membership would send `turn_on` at activity start (harmless when it isn't idle);
- but it would also send `turn_off` at activity end, which **stops whatever is casting**;
- and it adds an HA power step to the activity, so the overlap and deadline questions of
  P16/G7 apply.

Membership is an owner choice for later. The physical chain (whether the cast endpoint
feeds `<activityM>`'s receiver) is **assumed, not determined**.

### 2.5 Other activities and the HA device screens

- **`<activityA>` (optional):** soft rows at the **gap** indices 1–3 (§5) →
  `<deviceHA1>` PowerOn (I), PowerOff (I), BrightnessDown (M). These are lamp controls while
  watching. No toggles here.
- **`<activityB>` / `<activityC>`:** no HA bindings proposed. Their key space is fully used
  by `<deviceTV>`/`<deviceAMP>`.
- **HA device screens** (writer-owned; leave as built):
  - lamps: rows PowerOn/PowerOff/PowerToggle (idx 0–2); hard VolumeUp/Down →
    Brightness ±;
  - cast: rows PowerOn/PowerOff/PlayPause (idx 0–2); hard Play, Pause, Stop,
    VolumeUp/Down, VolumeMute → Mute.
  - **Hazard (documented, not fixable in data):** the `PowerToggle` rows (×4), the cast
    `PlayPause` row and the cast `VolumeMute`→Mute hard key are T on plain shapes.
  - Fix order: P11 Option A (HA-side debounce, no hub change) first, or the P11 B builder
    flag (`codexactivity.lua`, needs a reboot).
- **Gesture gate check** (every hard-key resolution above):
  - VolumeUp/Down: present in `<activityL>` and `<activityM>`;
  - Pause, Play: present in `<activityM>` after step S5.

## 3. Chromecast Audio deep-dive (task 3)

### 3.1 Operations the hub↔HA path exposes

The path carries one fixed `{c}` string per command, and the integration whitelists
media_player values. The full set is:
- `turn_on`, `turn_off`;
- `volume_up`, `volume_down`;
- `mute` (toggle, computed in HA);
- `media_play`, `media_pause`, `media_play_pause`, `media_stop`;
- `media_next_track`, `media_previous_track`;
- `select_source:<src>`.

Each is generated only if the entity reports the feature bit at push time.

### 3.2 Live on the hub now

9 commands:
- PowerOn, PowerOff (I);
- VolumeUp, VolumeDown (M);
- Mute (T);
- Play, Pause, Stop (I);
- PlayPause (T).

### 3.3 Binding per operation

| Operation | Binding (see §2.4) |
|---|---|
| Play / Pause / Stop | hard keys in `<activityM>`, plain; gestures DoubleTap / Tap / TapHold |
| PlayPause | `<activityM>` Select, self-long |
| Mute | `<activityM>` soft row, self-long (U2) |
| VolumeUp/Down | `<activityM>` soft rows, plain (ramp) |
| Power on/off | soft rows, plain |
| Device screen | as built; PlayPause row and Mute key carry the T hazard until P11 |

### 3.4 Gaps and blocking constraints

| Gap | Blocking constraint |
|---|---|
| Next / previous track | **Not generated.** Cast reports the next/previous bits only while the loaded media supports a queue, and they were absent at the push. The integration's merge would keep them forever once seen. The writer would then rebuild the cast screen once: Skip maps to hard FastForward/Rewind (alias table), so **no soft index moves** (§5). |
| Source / input selection | Never offered: cast doesn't report SELECT_SOURCE. Constraint: feature-gated generation. |
| Absolute volume (`volume_set`), seek, play-media, shuffle/repeat | Blocked by the integration's whitelist: no argument grammar except `select_source` (P15). Also by the hub value rules: ≤ 96 bytes, no `" \ % { }`, no runtime values from the remote. P15 would allow `volume_set:<0-100>` presets. Seek and play-media have no plan. |
| Now-playing, mute or volume state on the Touch | No HA→remote state path for IP devices (corpus §15 §3 C). The Touch ignores success notifies (G3: no notify-receipt lines). |
| Grouping (cast groups) | Not an operation of this entity. A cast group would be a separate media_player entity, hence a separate hub device. |

## 4. LAN migration (task 4)

**Reroutable today: 0 buttons.** The HA set has no entity for any IR-driven device. Per
device:

### `<deviceTV>` (IR; LAN-capable TV)

No TV entity is in the set, and whether HA has one can't be determined without an HA call.
The **conditional design** below applies once the owner adds the TV's HA media_player to
the integration options. That is an HA-side write: it causes a hub publish and a Touch
sync, and needs approval (§6 S9).

- **Expected generated commands** (verify against the entity's feature bits when added):
  - PowerOff;
  - Play, Pause, PlayPause, Stop;
  - SkipForward, SkipBack;
  - `Input <label>` per source (HDMI inputs and apps);
  - volume and mute only if the TV doesn't report external audio. Here audio goes to
    `<deviceAMP>`, so they're irrelevant anyway;
  - PowerOn only if HA has a turn-on trigger configured. LAN power-on of this class of
    TV needs Wake-on-LAN, which is unreliable over Wi-Fi.

| Binding | Before | After | Notes |
|---|---|---|---|
| `<activityB>` hard Play, Pause, Stop | IR `<deviceTV>` | HA TV Play, Pause, Stop (I, plain) | the only hard keys the current grammar covers |
| `<activityB>` soft row "app launch" (idx 5) | IR app key | HA `Input <app>` (`select_source`) | I; one row |
| `<deviceTV>` screen | IR | unchanged (Logitech-made map, never rebuilt) | the new HA TV gets its own hub-built screen |

**IR retained, and why:**
- **Power on and activity power:** LAN power-on is unreliable. Also, PowerFeature on an HA
  device is rewritten from the spec on every push (P10), so a mixed IR-on/HA-off device
  isn't durable. Keep the IR TV as the DisplayActivityRole member.
- **Activity inputs:** IR discrete inputs are proven. HA input selection is still untested
  (G6).
- **D-pad, Select, Back, Home/Menu, Exit, Info, Guide, colour keys, digits/number pad,
  Channel±, Record, List, Rewind/FastForward (seek):** the integration has no TV-button
  grammar. Its whitelist and the `:arg` refusal block it; a P15-style
  `button:<NAME>`/`remote` grammar would be needed.
- **Volume:** goes to `<deviceAMP>` (IR) in all three TV activities.

Recommendation: wait for P15 before migrating anything but transport keys and app launch.
The benefit today is three keys plus one row.

### Other IR devices

| Device | LAN? | Decision |
|---|---|---|
| `<deviceAMP>` (soundbar) | no LAN path in the inventory | **all IR retained** |
| `<deviceRCV>` (receiver) | no network | **all IR retained** |
| `<deviceDAC>` | no network | **all IR retained** |
| `<deviceSTB>` | BT HID (transport 32), not IR. HA could reach it over LAN (cast or a TV-remote integration). | **not a migration target**: HID works, and no entity exists |

## 5. Map-ordering audit (task 5)

Each touched map, as it is now plus the proposed changes:

| Map | Main index (FGT ≠ 2) now | FGT mix | Collisions | Gaps | Pad (FGT 2) | Hard keys | Proposed change and ordering verdict |
|---|---|---|---|---|---|---|---|
| `16417Activity<L>` | none | — | none | none | none | 3 | add rows idx 0–7 (FGT 0, contiguous); add 9 hard keys (no duplicates); add 4–5 gestures. **No collisions or gaps.** |
| `16414Activity<L>` | — | — | — | — | — | 3 | mirror the hard keys and long actions only, so a later wizard save keeps them (wizard: long press is kept). Not read by the Touch. |
| `16417Activity<M>` | none | — | none | none | none | 3 | add rows idx 0–4 (FGT 0); add hard Play, Pause, Stop, Select; add gestures. **No collisions or gaps.** |
| `16417Activity<A>` (optional) | [0, 4] | FGT 0 ×2 | none | **1, 2, 3** | 0–8, 10 | 19 | fill idx 1–3 exactly. That **removes** the existing gap, so render order stops depending on hash order. |
| `16417Device<CCA>` (writer-owned) | [0–2] | FGT 0 | none | none | none | 6 | no hand edits. If Skip appears, they become hard keys and soft indices stay [0–2]. |
| `16417Device<HA1..4>` (writer-owned) | [0–2] each | FGT 0 | none | none | none | 2 each | no change |
| Gesture targets `16417Device<RCV>` | [0–43] | FGT 0 ×44 | none | none | none | 11 (incl. VolumeUp/Down) | read-only target; resolution is by name (FunctionId 0) to the hard VolumeUp/Down |

Not touched, recorded for completeness:
- `16417Device<STB>`: the known FGT 1006/0 collision at one index (G2); gap at 15; one FGT 36
  row (not stored on the hub).
- `16417Device<TV>`: gap at idx 6; one FGT 36 `123` row at a main index (not stored on the
  hub; a press there falls through to the pad space but sends nothing per the Touch
  source).
- No string `IndexInMenu` anywhere; no duplicate hard keys; no dangling device or command
  references in any 16417 map.
- No `16417Root` (as expected). `16414Root` holds 3 hard buttons with no executable action
  (not stored).

Rules for the writes:
- new soft rows take the lowest free index (the web Touch editor's rule; it never
  renumbers);
- never use the **Android** Touch editor: it renumbers every editable row;
- never use the Touch's own on-device activity or gesture editors: they write maps from
  the Touch side.

## 6. Implementation staging (task 6): proposals only; each step needs its own approval

General rules for every step:
1. Before the step: private copy of MapList/DeviceList; SyncCounter on the hub and the Touch.
2. Write through the plugin save path (new etags, reload, publish). **Diff MapList
   before and after; the diff must contain only the intended fields.** If the chosen editor's
   reconcile changes anything else, stop and choose a narrower writer before publishing.
3. Untether the Touch; wake it by **tapping the screen** (never a hard key); let it pull
   the publish (never menu Sync).
4. Verification uses the G1–G4 capture method:
   - a fresh hub `logread -f` per press;
   - count `control.button?press|hold|release|fire`, `he.m.device` lines and
     `Sending notification via ltcp` notifies (the G4 proxy: one per IP send);
   - the owner watches the lamp or the audio;
   - afterwards re-tether, wait for dropbear, then one Touch `logread` and SyncCounter, and
     check the Touch maps match the hub semantically.
5. Revert = restore the step's private pre-copy of that one map through the same writer,
   then publish.

| Step | Write | Maps | Verification (pass criteria) |
|---|---|---|---|
| **S0** | **none** (owner: untether + one wake tap) | — | The Touch pulls the 14:37 publish. After re-tether, the Touch DeviceList has 10 devices and the cast screen exists. No sync-error screen. |
| **S1** | `<activityL>` VolumeMute gets a self-long (one field) | `16417Activity<L>` (+ `16414Activity<L>` mirror, same publish) | (a) Tap under 300 ms: no execution on press; at release one `fire` PowerToggle + `pressType` short; 1 notify; the lamp toggles once. (b) Hold ~1.5 s: one `fire` at the 2nd hold; later holds are heartbeats; 1 notify; release runs nothing; the lamp toggles once. Proves U1. |
| **S2** | 8 lamp On/Off rows (idx 0–7) | `16417Activity<L>` | Tap each: 1 press, 1 notify. Hold one ~1 s: press + holds, one notify each, lamp state unchanged (I). The non-member rows work (part of G9). |
| **S3** | 6 brightness keys + 4 colour toggles (self-long) | `16417Activity<L>` + 16414 mirror | Each brightness key: a tap gives 1 step; a hold ramps. Each colour key: same as S1 (a) and (b). |
| **S4** | 4 lamp gestures (Tap left unassigned) | `16417Activity<L>` | Swipes: Touch log `FunctionId is 0`/name match; hub `deviceId` press; **0 holds per plain swipe over 10 swipes (U3)**; a hold-swipe ramps (U4). |
| **S5** | `<activityM>`: Play, Pause, Stop, Select (self-long) → `<deviceCCA>` | `16417Activity<M>` (+16414 mirror) | Play, Pause, Stop: 1 press each, audio follows. Select: same as S1 (a) and (b) with PlayPause. |
| **S6** | `<activityM>` rows idx 0–4 (row 4 = Mute, self-long) | `16417Activity<M>` | Rows 0–3 as S2. **Row 4 tests U2:** a tap runs at release, a hold runs once. If it repeats instead, remove row 4 (stop condition). |
| **S7** | `<activityM>` gestures (Tap, TapHold, DoubleTap, SwipeUp/Down) | `16417Activity<M>` | As S4; DoubleTap gives one press; TapHold sends Stop (I) with repeats. |
| S8 (optional) | `<activityA>` rows idx 1–3 | `16417Activity<A>` | As S2; the existing rows idx 0 and 4 keep their positions and commands. |
| S9 (deferred, HA-side) | P11 Option A in the integration (owner's HA server) | none on the hub | A 1 s hold on a lamp PowerToggle row gives one HA service call (HA log). Then assign the Tap gestures to toggles. |
| S10 (deferred, HA-side) | add the TV entity to the integration (causes a writer publish and a Touch sync) | DeviceList, MapList (new device + screen) | G8-style check: no existing slot moves. Then a separate step reroutes `<activityB>` Play/Pause/Stop + one app row (§4). |

- S1 is the smallest valuable step: it removes a live double-toggle hazard with one field.
- S2–S8 are each one publish of one Touch map (plus its 16414 mirror where noted).

## 7. Unverified claims and the press step that settles each

| # | Claim | Settled by |
|---|---|---|
| U1 | A self-long on an **IP** button gives exactly one POST per press (G3 proved the pattern on HID, not IP) | S1 |
| U2 | Long-press arming works on an **on-screen row** (the hub logic is generic; the Touch sends holds for rows; never observed) | S6 row 4 |
| U3 | Plain swipes/taps never emit a `hold` (~60–100 ms margin before the Touch's 300 ms timer) | S4: 10 swipes, count holds |
| U4 | Hold-gestures repeat every 300 ms until finger-up | S4 / S7 hold-swipe |
| U5 | Gestures to HA devices work (corpus §15: untested) | S4 |
| U6 | Non-member HA mappings work and `harmony.engine?config` consumers don't error (P13 H4) | S2/S3 + the G9 config check |
| U7 | Several HA presses in quick succession don't hit the 500 ms deadline (D12) | G7 (not in this staging) |
| U8 | Cast volume step size and hold ramp rate | S6 rows 2/3 |
| U9 | Cast `turn_on`/`turn_off` behave as classified (I) | S6 rows 0/1 |
| U10 | The Touch pulls the pending publish when untethered and woken | S0 |

## 8. Surprises

1. **Hub ahead of the Touch** (§0): a new HA media-player device and its screen were
   published at 14:37:26 UTC, before this session and not by the agent. The tethered Touch
   hasn't pulled them. Explained, not a stop condition, but S0 must come first.
2. **The only HA media player is the Chromecast Audio** (cast friendly name match).
   - Its live command set has no next/previous and no inputs.
   - Its device screen already exposes two toggle hazards (PlayPause row, Mute key).
3. **A live double-toggle hazard exists today:** `<activityL>` VolumeMute →
   PowerToggle on a plain hard key. Same class: the 4 lamp-screen PowerToggle rows.
4. **Touch source refinement (not a contradiction):**
   - the gesture press arms the same 300 ms hold timer as any press, so plain gestures
     are single-shot only by the ~60–100 ms margin;
   - hold-gestures always repeat;
   - gestures can't inherit hub long-press protection, because they resolve to
     writer-owned device screens.
5. The Touch has **on-device editors** (activity command edit, gesture-pad edit) that
   rewrite maps from the Touch side. They must not be used for this work.

Nothing contradicts the G1–G4 baseline or the corpus.

## 9. Cannot determine (read-only, no HA calls)

- Whether HA has an entity for the TV (or the soundbar), and what its feature bits would
  be. So §4 is conditional.
- The physical audio chain behind `<activityM>` (whether the cast endpoint feeds that
  receiver). The §2.4 placement assumes it does.
- Whether and when `<deviceCCA>` will gain next/previous (depends on the media at a future
  push).
- Exact POST counts and payloads (no HA listener). The hub notify count is the proxy (G4).
- Whether the available hub editors can make each change with a minimal MapList diff
  (checked per step, §6 rule 2).

## 10. Files

- Results: `Remote-Feature-Correction/results/P22-HA-footprint.md` (this file; untracked,
  not added).
- Private (`/tmp/melodious-research/private/p22/`, mode 700):
  - `hub-{DeviceList,MapList,ActivityList,ProtocolList,AutomationConfig,FunctionList}.json`
  - `touch-{DeviceList,MapList,ActivityList,ProtocolList}.json`
  - `hub-index.json`, `touch-index.json`, `hub-md5.txt`, `touch-ls-md5.txt`
  - `hub-synccounter-before.json`, `touch-synccounter-before.json`, plus the `-after` copies
  - `hub-logread-now.log`
  - `inventory.txt`, `maps-hub.txt`, `maps-touch.txt`, `hacheck.txt`, `audit.txt`
  - `legend.md` (placeholder → name map)
- Analysis scripts (no data): `/tmp/melodious-research/scripts/p22_*.py`.
