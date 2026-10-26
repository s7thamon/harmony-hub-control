# P30: Touch retrospective log, post-S8 sync verification, and P22 closeout

Date: 2026-10-26. Builds on: `results/P22-HA-footprint.md` … `P29-S8-watchtv-lamp-rows.md`.

**Writes performed in this step: none** (read-only SSH `logread`, `cat`, and
`md5sum` on the tethered Touch and the hub).

## 1. Touch vs hub resource parity after S0–S8

- **Devices:** Touch `DeviceList.json` has all **10 devices** and its md5
  matches the hub `DeviceList.json` byte-for-byte. (Closes U10 from P22 §7:
  `<deviceCCA>` and its 11 commands including `SkipForward`/`SkipBack` are on
  the Touch.)
- **Maps:** Touch `MapList.json` has all **21 maps**, and every map's button
  count and bindings match the current hub `MapList.json`:
  - `16417Activity<L>`: 25 buttons (3 original hard keys with VolumeMute
    self-long from S1 + 8 lamp On/Off soft rows from S2 + 10 hard keys from S3
    + 4 swipe gestures from S4);
  - `16414Activity<L>`: 13 hard keys (mirror of S1 + S3);
  - `16417Activity<M>` and `16414Activity<M>`: 13 and 8 buttons (cast hard keys
    from S5 + 5 cast soft rows from S6; see §3 below on the wizard save at
    18:21 UTC);
  - `16417Activity<A>`: 34 buttons (contiguous main soft rows `0..4` with the 3
    new lamp rows at `1..3` from S8).

## 2. Touch retrospective ring buffer (`touch-logread-final.log`, 2456 lines)

- The 260 KB ring buffer spans `14:06:32`–`14:48:09` Touch-local time
  (`18:06:32`–`18:48:09` UTC):
  - **S1–S5 and the first half of S6** predate the ring buffer window (rolled
    off before re-tether).
  - **S6 tail (`14:06:32`–`14:06:40`):** captures the remaining soft-row taps
    (`touchPress` → `touchRelease` ~60–95 ms apart → `hot.1.control.button?press`
    and `release`, local 200 each, 0 holds).
  - **Config pulls (`14:21:53` and `14:22:24`):** `setup.sync?begin` →
    `proxy.resource?get` → `proxy.finished` (`errorCode 200`), advancing the
    Touch to `configVersion 632`.
  - **S8 presses (`14:23:33`–`14:23:49`):** every tap on the 3 new `<activityA>`
    lamp rows (`L1 On`, `L1 Off`, `L1 Dim`) logs `touchPress` → `touchRelease`
    (~50–80 ms) and `hot.1.control.button?press` + `release` (ids 1682–1701,
    local 200), matching the hub `logread` 1:1 by sequence.
  - **Zero notify-receipt lines:** as in P21 G1–G4, the Touch log shows no
    incoming notify lines during any press sequence.

## 3. Two post-S8 observations explained by the logs

1. **Wizard save on `<activityM>` (`18:21:29` UTC, `configVersion 632`):**
   Between S6 and S8, `<deviceCCA>` was added as a `PlayMovieActivityRole`
   member of `<activityM>` via the activity wizard. That save kept all 5 S6 soft
   rows (including `Cast Mute`'s self-long) and the 5 standard transport keys
   (`Play`, `Pause`, `Stop`, `FastForward`, `Rewind`), while dropping `Select` →
   `PlayPause` and clearing `ButtonLongPressAction` on the hard
   `FastForward`/`Rewind` keys — a live confirmation of the wizard reconcile
   behavior documented in corpus §12 §1 (P06).
2. **Touch `SyncCounter` (`syncCount: 1`, `errorCode: "554"` at `14:26:34`):**
   At `14:26:25` Touch-local time (`18:26:25` UTC), the Touch began pulling a
   hub publish (`configVersion 633`) and 7 seconds later the USB cable was
   plugged in. The Touch logged `a.harmony: syncFailure: [ code: 554 ] [ msg:
   USB cable connected ]`, aborted the in-flight sync (`proxy.abort`), and
   recorded `errorCode: "554"` (`syncCount: 1`, `hubSyncConflictCount: 0`,
   `syncConflictCount: 0`). All 21 maps had already been written (`MapList` and
   `DeviceList` on the Touch match the hub). Hub `SyncCounter` remains
   `syncCount: 0`.

## 4. Files

- Results: `Remote-Feature-Correction/results/P30-touch-retrospective-and-closeout.md`
  (this file).
- Private (`/tmp/melodious-research/private/p22-touch-final/`, mode 700):
  `touch-logread-final.log`, `touch-DeviceList.json`, `touch-MapList.json`,
  `hub-config-now.json`.
