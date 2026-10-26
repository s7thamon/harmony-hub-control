# 02 Touch input and UI

All citations are under `LD/` (Touch UI, the `juniper/` skin) unless prefixed. Everything here
is **[SRC]** unless tagged.

## 1. Hard keys

- **Keycode table:** `luadraws.so` holds static `{linux_keycode, name}` pairs at file offset
  0x709f0–0x70b47. The input read loop isn't decompiled [INF: it maps EV_KEY to `keyPress`
  and `keyRelease` events with the name, `draws/event.lua:43-47`].

| Linux key | ButtonKey | Linux key | ButtonKey |
|---|---|---|---|
| KEY_POWER | `PowerOffActivity` | KEY_OK | `Select` |
| KEY_FORWARD | `FastForward` | KEY_PLAY | `Play` |
| KEY_REWIND | `Rewind` | KEY_PAUSE | `Pause` |
| KEY_RECORD | `Record` | KEY_STOP | `Stop` |
| KEY_EXIT | `Exit` | KEY_MENU | `Menu` |
| KEY_VOLUMEUP/DOWN | `VolumeUp`/`VolumeDown` | KEY_CHANNELUP/DOWN | `ChannelUp`/`ChannelDown` |
| KEY_UP/DOWN/LEFT/RIGHT | `DirectionUp/Down/Left/Right` | KEY_MUTE | `VolumeMute` |
| KEY_PREVIOUS | `PrevChannel` | (0x185) | `DVR` |
| (0x18b) | `Guide` | KEY_INFO | `Info` |
| KEY_RED/GREEN/YELLOW/BLUE | `Red`/`Green`/`Yellow`/`Blue` | KEY_FAVORITES | `Favorites` |
| KEY_HOME | `Home` | KEY_PROG1..4, KP± | `HomeControl*` (shared .so; the Touch has no such keys) |

- **29 physical key names** (`juniper/desktop.lua:90-128`, a desktop-simulator layout that
  confirms the set).
- The Touch's names differ from 16414 maps: `DVR` (not `Dvr`), `VolumeMute`, `PrevChannel`
  for Back, and no `Number*` keys (digits are on screen).

## 2. Touchscreen and gestures

- **Buttons** (`draws/event/button.lua:21-115`):
  - press → `buttonPress`;
  - release → `buttonAction`, then `buttonRelease`;
  - a drag off the widget → `buttonRelease`;
  - `buttonHold` at 1000 ms (unused by command lists).
- **Wake:** the first touch after sleep is **swallowed** (with its release). A key that wakes
  the screen **is** dispatched (`draws/render.lua:1258-1300`).
- **Gesture recognizer** (`juniper/gesture.lua:21-197`):
  - PRESS/RELEASE timeouts 200 ms; threshold 60 px; HOLD 700 ms; DOUBLE_TAP 300 ms.
  - Swipes fire on finger-up, with `gestureRelease` 200 ms later.
  - A swipe held 700 ms fires the swipe with value `Hold`.
  - A tap fires at the 300 ms double-tap timeout.
  - `DoubleTap` and `TapHold` are values of `Tap`.

## 3. Context

- `Harmony.currentActivity` (−1 = off) and `Harmony.currentDevice` (0 = none)
  (`appscommon/harmony.lua:1871-1934`).
  - Activities with no `Roles` (home-control-only) never become current.
  - The device context is set when a device row is opened (`juniper/devicemode.lua:356, 539`)
    and reset on leave, home and number-pad exit.
- `JUNIPER_EQUADID = "16417"` (`harmony.lua:49`) is used for map lookup and for `equadId` in
  every button message.
- `findButtonMap` accepts `16417Device<id>` **or** a bare `Device<id>`, first match in array
  order (`harmony.lua:444-487`). The hub accepts only the prefixed form, so a bare map shows
  on the Touch while its presses are dropped.
- The UI never reads `16414*` maps. It reads a `RootButtonMap` only to find `HomeControl*`
  keys (`populateHCButtonMaps`, `harmony.lua:228-251`).

## 4. The hard-key table (`hardButtonsMap`)

- `updateHardButtonsMap(buttonList, sequenceList)` (`harmony.lua:4770-4801`):
  - maps each `HardRemoteButton.ButtonKey`;
  - flags keys that have a `ButtonLongPressAction`;
  - records sequence names, but only when `Sequences` is non-empty;
  - is a one-level stack (nil restores the previous table).

| Context | Source map |
|---|---|
| Home/activity list | `Activity<current>` (`juniper/activity.lua:160-170`) |
| Activity commands page | `Activity<id>` (`activitycommands.lua:487`) |
| After activity start | `Activity<id>` (`launcher.lua:84-88`) |
| Resync | `Activity<id>` (`resync.lua:143-147, 239-244`) |
| Gesture pad | `Activity<id>` (`gesturepad.lua:943-948`) |
| Device screen | `Device<id>`, **without sequences** (`devicemode.lua:537-542`) |
| Off | empty |

## 5. Local gates (before anything is sent)

1. **Global:** hard keys are forwarded only if `currentDevice > 0` **or**
   `currentActivity ~= -1` (`juniper/init.lua:1827-1831`). On the home screen, every
   forwarded key is dead, so the hub's Root maps are unreachable from Touch keys.
2. **Map:** a `buttonKey` that isn't in `hardButtonsMap` (and isn't a known HomeControl key)
   returns without sending (`harmony.lua:2400-2404`). **There is no fallback** to the
   activity or Root map from a device screen.
3. **State:** keys are ignored (and their releases eaten) while:
   - syncing;
   - unprovisioned;
   - on the link-loss screen;
   - `startingActivity` is set (activity or sequence starting) (`init.lua:1731-1754`).
4. **BT-HID target not paired** (FireTV, Nexus and PlayStation exempt): the "pair in app"
   screen is shown; nothing is sent.
5. **Windows that consume keys:** message and edit windows; remote lock (only a 1 s Exit hold
   unlocks); windows that disable Home/Favorites.
6. **Suspend fade:** `Hbus.ignoreRequests` makes requests return silently and clears the
   queue (`network/hbus.lua:229-232, 288-297`; `init.lua:1371`).

## 6. Locally handled keys

| Key | Behaviour |
|---|---|
| `Home` | `showHome()` |
| `Favorites` | `showFavorites()` |
| `PowerOffActivity` (Off) | if an activity is running: popup, then `harmony.activityengine?runactivity {activityId, async:true, args:{rule:"end"}}`. **Not a button press.** With nothing running: nothing. (`init.lua:1757-1824`; `harmony.lua:2336-2353`) |

Key combinations (filter callbacks, `init.lua:363-376, 1644-1712`):
- Menu+Mute → pairing;
- Record+PrevChannel → "place in cradle";
- with `/etc/tdeenable`, FF+Stop+{VolUp, Blue, Red, Green} → factory/debug menus.

The first key of a combination is still sent [INF].

## 7. On-screen button lists and rendering

- **Ordering:**
  - `reorderActivityButtonMaps` (`harmony.lua:388-414`): soft buttons with FGT 0 or 36 and
    `ButtonState ~= 4` go into `softButtons[IndexInMenu+1]`; everything else goes first in map
    order. The result is the head followed by the soft buttons in `pairs()` order.
  - `reorderDeviceButtonMaps` (`:416-440`): the same, without the `ButtonState` test.
  - These reorder functions **mutate the in-memory MapList cache**
    (`appscommon/resourcemanager.lua:27-28, 198-249`), which `resMgr.init()` clears after a
    sync.
- **Consequences:**
  - a duplicate index within FGT 0/36 drops the earlier button from the list;
  - gaps push keys into the hash part, so the order over gaps isn't guaranteed [INF];
  - a missing `MenuItem` raises a Lua error.
- **Render** (`juniper/style.lua:1869-1968`):
  - FGT 2 or `ButtonState 4` → zero-size (not tappable);
  - a non-table `ButtonAction` → hidden;
  - a `Numpad` client action while the number pad isn't shown → hidden;
  - non-soft → hidden;
  - label = `TextOnRemote`, camelCase split except `TiVo`/`SetUp`;
  - **`ButtonImagePath` is dead code:** `type(button.ButtonImagePath) == string` compares
    against the global `string` table (`style.lua:1910`; `hops/style.lua:2457` has the same
    bug);
  - icons: `123`/`Gesturepad`/`Trackpad` → arrow; sequence → `sequence.png`; else
    `commands/<FunctionId->.png` if it exists;
  - BT/BT-HID not paired → alpha 0.4.
- **FGT meanings on the Touch:**

  | FGT | Meaning |
  |---|---|
  | 0 | normal ordered row |
  | 36 | the `123` row (keyed by the **label** `123`) |
  | 2 | number pad (hidden from lists; own index space) |
  | 1006 and others | listed unordered at the top; press sends the bare index |

## 8. Magic labels

| Label | Device screen | Activity page |
|---|---|---|
| `123` | tap opens the number pad; press sends nothing | jumps to the number-pad page |
| `Gesturepad` | press sends nothing; release **falls through and sends a release by index** (orphan) | opens the gesture pad |
| `Trackpad` | press **is sent**; tap opens `wii.lua` | — |
| `Disconnect Wii` | `harmony.engine?bluetoothDisconnect` | same, in a Wii activity |

## 9. Number pad (`juniper/numpad.lua:30-103`)

- 12 keys: `1`–`9`, `.-`, `0`, `E`.
- It is built from the current map's **FGT 2** soft buttons:
  - `tonumber(ButtonAction.CommandName)` gives digits 0–9;
  - `-`, `.`, `*` and `NumberPlus` → bottom-left;
  - `Enter`, `NumberEnter`, `#` and `ENT` → bottom-right.
- Each key fires `buttonControl("fire", nil, IndexInMenu, deviceId, 2)`: one shot, no hold,
  no release.
- The device pad uses `Device<id>` (with `deviceId`). The activity pad uses `Activity<id>`
  (no `deviceId`).
- **The digit command names must parse as numbers.** The hub then runs a device command of
  the same name.

## 10. Gestures are resolved on the Touch

`juniper/gesturepad.lua` (same logic as `hops/`; cosmetic differences only):

1. **Setup** (`:319-373`): reads `GestureRemoteButton`s from `Activity<cur>`, mapping:
   - `SwipeX`, `Tap` → `ButtonAction`;
   - `SwipeXHold`, `TapHold` → `ButtonLongPressAction`, **falling back to `ButtonAction`**;
   - `DoubleTap` → `ButtonDoublePressAction`.
2. **On a gesture** (`:638-787`):

   | Action type | Sent |
   |---|---|
   | `ButtonSequenceAction` | `press {sequenceId}` (no key, index or device) |
   | `ButtonClientAction PLAY_PAUSE_TOGGLE` | alternates the main-role device's Play (FunctionId 113) and Pause (106) **hard key** + `deviceId` |
   | `ButtonClientAction 123/Numpad` | jump to the number-pad page on release |
   | `ButtonCommandAction` | `getButton(16417Device<action DeviceId->)`: by `FunctionId-` if > 0, else by `CommandName`/`ButtonKey` (`:121-139`). Soft match → `indexInMenu` + `deviceId`. Hard match → `buttonKey` + `deviceId` (Sonos/HEOS → coordinator) (`:732-750`). |

3. **Drop points:**
   - no matching button → nothing sent;
   - no device map at all → `ipairs(nil)` error [INF];
   - a hard-key resolution must pass the **activity's** hard-key gate;
   - an unpaired BT target is ignored.
4. The hub's stored `Swipe*`/`Tap` buttons are **never used** by the Touch.
5. Release: `cancelIr` sends the matching release on `gestureRelease` (`:815-875`). Sequences
   get no release.

## 11. Feedback the UI acts on

| Notify | Reaction |
|---|---|
| `control.button?press/release/fire` | error path only: `errorCode=…:deviceId=…` → `BtTutorial.lostLink` (`harmony.lua:4007-4028`) |
| `control.button?pressType` | short → IR indicator; long → haptic, pulse, `longPress` event; `sequence=` → popup and key block (`:3876-3903`) |
| `control.button?sequenceFinished` | clears the key block (`:3905-3917`) |
| `harmony.engine?startActivityFinished` | sets the current activity, resync, launcher (rebuilds the hard-key table) |
| `connect.stateDigest?notify` | sync trigger check (§10 of the corpus) |
| `automation.state?notify` | merges into the Home Control device list |

What `lostLink` shows (`juniper/btpairtutorial.lua:545-800`):

| Code | UI |
|---|---|
| 503 | link-lost screen |
| 500 | only if the link-loss window is up |
| 505/401 | BT pairing flows |
| 506/507 | IP-IR redirect after 3 failures |

Other hub errors (for example 566 "command not found") show **nothing** [INF].

- The activity popup polls `statedigest?get` every 5 s and shows `activityerror.lua` after
  60 s.
- `Ir:pulse()` is only an on-screen animation (`juniper/ir.lua:21-104`).
