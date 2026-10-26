# 05 Press semantics

## 1. Touch side (`LD/appscommon/harmony.lua:2392-2554`) [SRC]

| Input | Messages |
|---|---|
| Hard key down | `press` (keyLatency 200), then a **300 ms repeating timer** sends `hold` (`:2435-2441`) |
| Hard key up | `release` (cancels the timer). **Dropped while `startingActivity`** (`:2449-2453`). |
| Soft tap | `press` … `hold` every 300 ms … `release` |
| Number pad | `fire` (single shot) |
| Gesture | `press` at recognition; `release` 200 ms later (swipe, tap, double tap) or at finger-up (holds). A plain swipe or tap has no `hold` [INF]. |
| Sequence button (activity hard or soft key, or gesture) | `press` only; popup; key block until `sequenceFinished` |

- For keys flagged as having a long-press action, the Touch doesn't pulse the IR indicator on
  press. The **hub** makes the long/short decision.
- Other clients have their own cadence. The Melodious web UI keeps a hub-side hold lease alive
  with a heartbeat every 200 ms; the hub gives up 700 ms after the last heartbeat
  (`MEL/tools/webui-sim/public/js/views/key-repeat.js:1-20`).

## 2. Hub side (`LW/tasks/harmonyengine/apihandler/activity.lua`) [SRC]

The state is **global across all remotes and clients** (`:27-38`): `checkLongPressTime`,
`longPressButton`, `longPressStatus`, `currentButton`, `irsender.irState`,
`ipmanager.currentCommand`.

| Event | Button without a long action | Button with `ButtonLongPressAction` |
|---|---|---|
| press / fire | `fireCommandsList`. One command → `device:sendCommand(cmd, status)`; several, or a sequence → each as `fire` with delays. | records the time; **sends nothing** (`:1937-1946`) |
| hold | `holdCommand`: IR heartbeat (`irManager.sendHeartBeat`) and `ipManager.sendHold` → **another IP POST** (`:697-699`) | a hold ≥ **550 ms** after the press fires the long action once (`fire`) + `pressType {type=long}` (`:713-746`); later holds are heartbeats only; **no IP repeats** |
| release | queued holds purged; `sendCommand(cmd, "release")`: IR cancel; **IP nothing**; HID release report; BT release. A sequence button returns early. | if still armed: the **short action runs now as `fire`** + `pressType {type=short}` (`:1949-1960`); if the long action already fired: nothing |

- **Long-press detection depends on `hold` messages, not release timing.** A press with no
  holds runs the short action on release, however long it was.
- The 550 ms is measured between dequeues in `actionQueue`. With the Touch's 300 ms cadence,
  the effective threshold is the second hold, about 600 ms [INF].
- **Double press:** not executed for normal buttons. On the Touch it exists only through the
  gesture pad, which resolves it locally to an ordinary press.
- **`fire`:** IR start+cancel; IP one POST; HID press+release.
- **`IRPressAction` with `Duration`:** IR start, then a heartbeat loop that **never sleeps**,
  because `if not self.model == "Apple TV"` is always false (`model/device.lua:239-259`).
- **Overlap:**
  - a new IR start cancels the running IR;
  - a heartbeat refreshes whichever IR is running;
  - a new long-armed press overwrites the previous arm;
  - each IP press replaces `currentCommand`. If an IP release is lost, later holds of **any**
    button re-send that IP command (`ipmanager.lua:310-322`) [SRC/INF].

## 3. Sequences

- They are resolved and run **on the hub** (`userconfigreader.lua:681-692, 883-891`;
  `activity.lua:1932-1938, 2039-2054`).
- **Triggers:**
  - a press of a button whose actions carry `sequenceName`;
  - a nameless press with `sequenceId`;
  - `harmony.engine?holdaction` with `sequenceId` (`:586-610`).
- **Order:** by `Order`. Each device step waits `device:delayRequired()` and `blockingSleep`;
  `SendDelay` sleeps `Duration × 1000` ms.
- **Errors:** the sequence aborts on IR/RF 500, 503 or 507.
- **Status:** `updateSequenceStatus` bumps `stateVersion` with no notify. `sequenceFinished`
  goes back through the callback.
- **The whole sequence blocks `actionQueue`**, so presses queued behind it may fail the 1 s
  stale filter.
- **IP steps in a `holdaction`-started sequence are dropped** (no protocols, `:603`). IP steps
  in a **button-pressed** sequence work (protocols passed, `:2043`).
- **A device-screen soft button bound to a sequence** [INF hazard]:
  - the device screen loads no sequence list;
  - `deviceId` is taken from `ButtonAction["DeviceId-"]`, which a sequence action may lack;
  - the press then resolves in `16417Activity<current>` (or drops).

## 4. EventType

| Value | Seen on |
|---|---|
| 0 | soft `ButtonAction` |
| 1 | hard and gesture `ButtonAction` |
| 2 | `ButtonLongPressAction` |
| 3 | `ButtonDoublePressAction` |

The engine reads `EventType` only for home-control and program actions; the UI never reads
it. Generators should still write the conventional values, for fidelity with Logitech data.

## 5. HA consequences

- Press and hold produce the **same POST body**, and release sends nothing, so HA can't tell
  them apart. A press held ≥ 300 ms on the Touch runs the action at least twice.
- Buttons with a long-press action send **one** POST per press (at release or at ≥ 550 ms).
  This is a data-level way to make one-shot actions (plans P11 Option B).
