# 13 Key alias tables

## 1. The four tables

| Table | Location | Matching rule |
|---|---|---|
| C `IR_REMOTE_BUTTONS` | `MEL/payload/source/codex_webui.c:6397-6435` (`ir_alias_match`, `ir_find_remote_command`) | the first command matching exactly **or** containing the alias (alias > 4 chars) |
| Web `REMOTE_BUTTONS` | `MEL/tools/webui-sim/public/js/remote-layout.js:8-82` | **exact match first**, then substring (> 4). Owner-approved 2026-10-21; the comment notes that C and the app still take the first match. |
| Android `RemoteLayout.REMOTE_BUTTONS` | `MEL/Android/core-protocol/.../model/RemoteLayout.kt:107-175` | the first match, substring allowed |
| Hub Lua `TOUCH_SCREEN_KEYS` | `MEL/payload/activity/codexactivity.lua:1286-1315` | **exact only**, using Touch key names (`DVR`, no numbers). Adds `brightnessup`/`brightnessdown` to the volume keys. |

- Normalization everywhere: lower case, alphanumerics only (`commandKey`).
- The alias **strings** in C, web and Android are character-identical [SRC diff].

## 2. Hub Lua table (for reference)

```text
Rewind        rewind|rev|skipback|previous track
Play          play
FastForward   fastforward|forward|ffwd|next track|skipforward
Record        record|rec
Pause         pause
Stop          stop
Red/Green/Yellow/Blue
DVR           dvr|recordings
Guide         guide|epg
Info          info|information|displayinfo|settings|setting|setup|option|options
Exit          exit|clear|cancel
Menu          menu|home
DirectionUp/Left/Right/Down   up|directionup|arrowup|cursorup (etc.)
Select        ok|select|enter
VolumeUp      volumeup|volup|vol up|vol_up|volume up|brightnessup
VolumeDown    volumedown|voldown|… |brightnessdown
ChannelUp     channelup|chup|… |pageup|pgup
ChannelDown   channeldown|chdown|… |pagedown|pgdown
VolumeMute    mute
PrevChannel   back|return|previous
```

## 3. Divergence in practice

From a local run of the real web and Android logic over HA-style names (Track C,
`scratchC/alias-check.mjs`):

| Device commands | Web wizard | Android / C | Hub device screen |
|---|---|---|---|
| Light: PowerOn, PowerOff, PowerToggle, BrightnessUp, BrightnessDown | **DirectionRight → BrightnessUp** ("right" is a substring of "brightnessup") | the same first-match result | **VolumeUp → BrightnessUp**, VolumeDown → BrightnessDown |
| Soundbar: …, ClearVoice, PreviousTrack, Return | Exit → ClearVoice ("clear"); Rewind → PreviousTrack; Back → Return (exact) | **Back → PreviousTrack** ("previous") | — |
| HA media player (VolumeUp, Mute, Play, Pause, PlayPause, Stop, SkipForward, SkipBack) | consistent | consistent | consistent; SkipForward → FastForward, SkipBack → Rewind |

- **`PlayPause` lands on no key.** "play" is only 4 characters, so it matches exactly only.
- The same lamp gets brightness on the D-pad in an activity and on volume on its device
  screen.

## 4. Other shared tables (identical across copies)

| Table | Locations |
|---|---|
| Role routing chains (which role's device takes a key group) | `wizard-model.js:123-142`, `activity-ui.js:417-431`, `ActivityGraphBuilder.kt:345-375`, `tools/activity_graph_repair.mjs:499-513` |
| HID keys (16420) | `wizard-model.js:45-50, 405-411`, `activity-ui.js:481-494`, `ActivityGraphBuilder.kt:46-51, 912-919`, `activity_graph_repair.mjs:572-585` |
| Touch hard-key set | `wizard-model.js:672-683`, `ActivityGraphBuilder.kt:437-448` |
| Back-key exact filter (back/return/previous) | web only (`views/wizard.js:45-62, 171-172`); **missing on Android** |

## 5. Direction

Plan P05: one canonical table, one rule (exact, then reviewed synonyms, then per-domain
extras; no free substrings), and a parity test.
