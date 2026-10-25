# Melodious web UI: porting the Android app's interface

Status: plan approved by the owner, 2026-10-21 (decisions at the end).
Slices 1 (shell and remote, PR #21), 2 (Activities, PR #22) and 3 (Devices,
PR #23) are done; slice 4 (Settings) follows.

The owner's native Android app (`Android/`, Kotlin + Jetpack Compose,
Material 3, dark) has the better interface. This port makes the hub web UI
look, navigate and feel like it, under one brand. It's a full interface port
(layout, navigation, components, type, colour, icons, motion), not a recolour.

Limits:
- The backend doesn't change: same hub routes and request shapes, no new C
  routes.
- Everything stays embedded in `codex_webui`: no CDN, no web fonts, no new
  served files.
- `main` keeps the current UI until each PR merges. PRs go one at a time and
  are never stacked.

## Brand

- **Product name: Melodious** (owner-confirmed; it matches the app's
  `app_name`, its package `app.melodious` and the branding files).
- Where it appears in the web UI: page title, header, per-view titles
  (`Remote · Melodious`), meta description, the default Bluetooth keyboard
  name shown on the TV, and `DESIGN.md`.
- Unchanged:
  - "Harmony Hub" and "Harmony Touch" as device names;
  - the repo `schlambos/harmony-hub-control`, binaries, paths, API routes;
  - the installers, `README.md` (they name the project, not the product);
  - the legacy page built into `codex_webui.c`.
- Icon: made from `Android/branding/melodious-icon-source.jpg` using the same
  numpy glyph extraction as `build_icon.py`: the neon glyph on the charcoal
  tile with rounded corners. Only the output PNGs come into the repo, not
  the scripts or the artwork.
  - Favicon: 64 px PNG, about 3.7 KB, inlined in the page head (about 5 KB
    as a data URI).
  - Optional home-screen icon (`apple-touch-icon` for iOS "Add to Home
    Screen"; Chrome for Android can fall back to it): 180 px, about 15.7 KB
    (about 21 KB inline).
  - No PWA manifest. It would need its own route, and the hub sends every
    asset `no-store` and uncompressed, so anything inlined is paid on every
    page load.

## Navigation

Four tabs, as in the app. Phones get a bottom navigation bar. Screens
840 px and wider get a Material navigation rail on the left, with the
content centred.

| Tab | Hash | What it holds | Old hashes that land here |
| --- | --- | --- | --- |
| Remote | `#remote` | "Everything's off" picker, running-activity remote | `#control`, `#home` |
| Activities | `#activities` | list, setup wizard (`#wizard`), advanced editor (`#editor`) | (unchanged) |
| Devices | `#devices` | device list, then a device page (remote, commands, settings, learn, import) and the IR tools | `#ir` |
| Settings | `#settings` | hub status, Bluetooth, MQTT, Wi-Fi, Backup, System | `#bluetooth` `#mqtt` `#wifi` `#backup` `#system`, kept as sub-pages |

- Sub-pages get the app's top bar (back arrow and title). Back returns to
  the tab they belong to.
- Old hashes keep working, so bookmarks survive.
- The router has path arguments: `#devices/<id>`, `#devices/<id>/settings`,
  `#devices/<id>/sweep`, `#devices/lab`, `#remote/<activityId>`,
  `#wizard/<id>`.

## Screen map

| Android (`ui/…`) | Web after the port | Slice |
| --- | --- | --- |
| `remote/RemoteScreen` OffState | Remote tab when nothing runs: "Everything's off · What do you want to do?" with one card per activity (tap starts it). Replaces Home's Start tiles. | 1 |
| BusyState | Remote tab while starting or stopping ("Starting Watch TV…") | 1 |
| ActivityRemote + RemoteHeader | Running activity: name (tap opens a switch-activity sheet with "Turn everything off"), device line with live dot, power button | 1 |
| RemoteModeTabs + ButtonsSurface | Buttons surface: transport row, D-pad, VOL and CH rockers, Back/Menu/Exit/Mute | 1 |
| MoreKeysSheet + AllCommandsPage | "More keys" sheet: this activity's on-screen buttons; Guide/Info/DVR/Exit; Record/Stop and colour keys; number pad; all device commands | 1 |
| TouchpadSurface | — (not chosen) | — |
| KeyboardSurface | Keyboard tab: text and keys to the hub's Bluetooth keyboard (`/api/bt-text`, `/api/bt-call`, the same as the Bluetooth page) | 1 |
| FixItSheet | Fix-it sheet: per-device "It's off" / "Switch to HDMI 1" resend through `/api/ir-send` | 1 |
| SleepTimerPill/Sheet | — | Android-only (see below) |
| `devices/DevicesScreen` DevicesTab | Devices tab: search devices or commands; grouped list with icon, model, command count and IR/Bluetooth badge | 1 |
| DeviceDetailScreen | Device page with Remote and Commands tabs (tap a command to send it; search); ⋮ Make, Rebuild or Remove Touch screen | 1 |
| Learn and Import sheets | Learn a button, Import codes (Find codes, Paste, Type a code) | 3 |
| `devices/DeviceSettingsScreen` | Device settings page: Power, Turning on, Inputs (web-only), Timing | 3 |
| `activities/ActivitiesScreen` | Activities tab: running card, rows with Start and a ⋮ menu (Edit, Set up buttons, Try the buttons, Advanced editor, Move up / down, Delete) | 2 |
| ActivityEditor (5 steps) | Wizard restyled as the app's step screens: Name, Devices, Inputs, Buttons, Review. The app's "Start & end" step is parity item P2, not part of the port. | 2 |
| TouchScreenEditor | — (parity item P3; the advanced editor still covers on-screen buttons) | later |
| `settings/SettingsScreen` | Settings tab: hub card, then rows for Bluetooth keyboard, MQTT, Wi-Fi, Backup, System | 1 (list), 4 (pages) |
| BluetoothScreen | Bluetooth page | 4 |
| AdvancedScreen | Hub status → System page. Recent commands → send log. IR sweep → Devices. | 3, 4 |
| HubConnectScreen / ConnectGate | — (the hub serves the page; there's nothing to discover) | Android-only |

Slice 1 restyles every view through the shared tokens and components.
Views outside slice 1 keep their current layout until their own slice lands.

## Tokens: `MelodiousTheme.kt` → `tokens.css`

| Compose | Value | CSS custom property |
| --- | --- | --- |
| `MelodiousColors.Canvas` (background, surface) | `#0E1014` | `--canvas` |
| `NavBar` (surfaceContainerLow) | `#15181D` | `--nav-bar` |
| `Card` (surfaceContainer) | `#171A20` | `--card` |
| `Key` (surfaceVariant) | `#1F232B` | `--key` |
| `KeyRaised` | `#2A2F39` | `--key-raised` |
| `DPadRing` | `#1A1E25` | `--dpad-ring` |
| `Divider` | `#22262E` | `--divider` |
| `Live` | `#6FD3A8` | `--live` |
| `Warning` | `#F2C48D` | `--warning` |
| `PowerContainer` / `OnPowerContainer` | `#3A1F1F` / `#FFB4AB` | `--power-container` / `--on-power-container` |
| `RunningCard` | `#1D2840` | `--running-card` |
| `KeyRed` `KeyGreen` `KeyYellow` `KeyBlue` | `#F06A6A` `#5FD08B` `#F2D25C` `#6AA2F5` | `--key-red` … `--key-blue` |
| primary / onPrimary | `#9DB8FF` / `#0B1A3A` | `--primary` / `--on-primary` |
| primaryContainer / on | `#2B3A5E` / `#D9E2FF` | `--primary-container` / `--on-primary-container` |
| secondary / onSecondary | `#BEC6DC` / `#283141` | `--secondary` / `--on-secondary` |
| tertiary / onTertiary | `#8FE0BC` / `#003828` | `--tertiary` / `--on-tertiary` |
| onSurface / onSurfaceVariant | `#E7E9EE` / `#A3AAB7` | `--on-surface` / `--on-surface-variant` |
| surfaceContainerLowest / High / Highest | `#0A0B0E` / `#1A1D23` / `#262A33` | `--surface-lowest` / `--surface-high` / `--surface-highest` |
| outline / outlineVariant | `#4A505C` / `#343A46` | `--outline` / `--outline-variant` |
| error / onError | `#FFB4AB` / `#690005` | `--error` / `--on-error` |
| inverseSurface / inverseOnSurface / inversePrimary | `#E2E2E9` / `#2F3036` / `#3F5A9A` | `--inverse-surface` / `--inverse-on-surface` / `--inverse-primary` |
| Shapes xs/sm/md/lg/xl | 8 / 12 / 16 / 24 / 28 dp | `--shape-xs` … `--shape-xl`, plus `--shape-full` |

Colours the screens use inline (icon tiles `#262A33` on `#C3C8D2`, activity
tiles `#23302A` on `#A8E6C8`, the hub tile `#1E3329`, the sheet key
`#262A33`, the keyboard warning `#2E2718`) get named tokens too.

The old token names (`--surface-*`, `--accent-*`, `--status-*`, `--key-face`
…) stay as aliases onto the new palette until every view is ported, then
they're removed. This is the same trick `tokens.css` already uses for the
vendored editor.

Type uses the system font stack: Roboto on Android (the app's own font), SF
on Apple, Segoe on Windows. That costs 0 bytes. Sizes follow the app:

| Use | Size and weight |
| --- | --- |
| Screen title | 28/36 medium |
| Remote title | 24 medium |
| Card title | 22 medium |
| Sheet title | 20 medium |
| Row title | 16–18 |
| Buttons | 15 |
| Section label | 14 medium, primary |
| Subtitle | 13 |
| Caption | 12 |
| Overline | 11–12 semibold, +0.8 tracking ("RUNNING NOW", "VOL") |

## Components

| Compose | Web |
| --- | --- |
| ScreenTitle, SectionLabel | `.m-title` (28 px, optional subtitle and action), `.m-section` |
| ListGroup / ListRow / GroupDivider / SwitchRow | `.m-list` (24 px radius on `--card`, hairline dividers), `.m-row` (min 64 px, chevron), `.m-switch` (a checkbox with `role="switch"`) |
| IconTile, StatusDot, PowerButton | `.m-tile`, `.m-dot`, `.m-power` |
| Buttons: filled, tonal, outlined, text, icon | `.btn` family restyled as pills (40–52 px); the `.btn-primary` etc. class names stay so unported views follow |
| DetailPage / TopAppBar | shell top bar for sub-pages |
| ModalBottomSheet | `<dialog class="m-sheet">`: 28 px top corners, drag handle, scrim, Esc and scrim-tap close it; centred card on wide screens |
| ConfirmDialog | `<dialog class="m-dialog">` through `confirmDialog()`; Cancel has focus first. The existing inline danger guards stay where a typed phrase is needed. |
| DropdownMenu | `<dialog class="m-menu">` through `openMenu()`: dropped from its button, arrow keys move, Esc and a click outside close it |
| Snackbar | `.m-snackbar` (inverse surface), errors linger |
| FilterChip / AssistChip | `.m-chip` |
| EmptyState | `.m-empty` |
| KeyButton, IconKey, TextKey, CaptionKey, DPad, Rocker, ColorKey | `.rk-*` remote keys (a native keypad, no photo) |
| Material icons | inline SVG paths for the roughly 40 Material Symbols the app uses (Apache-2.0; licence goes in `third_party/`) |

## Behaviour carried over

- Plain keys fire on release.
- Keys with a hold action fire it after 500 ms (the web used 550 ms).
- Unmapped keys dim to 35% and do nothing.
- Keys didn't repeat while held at first (the owner chose not to port that).
  Owner, 2026-10-22: they do now, as in the app. Volume, channel and the
  D-pad fire on touch-down and, held, repeat through the hub's native
  press-and-hold: `/api/ir-send` with `status` press, hold every 200 ms and
  release, and a `holdId`. The hub runs the hold over one engine connection
  and repeats from 380 ms, as the app does.
- Menu or Exit is relabelled "Home" when it really sends Home.
- The remote's Back key is stored as `PrevChannel`, and the wizard lets you
  set it like any other key, as the app does (approved 2026-10-21).
- Phones get a short vibration where the browser supports it; desktops get a
  pressed state.
- Errors show as a snackbar.
- The web's resolved "device · command" line stays as a quiet status line
  under the mode tabs. On desktop it also shows a preview on hover or focus.
- Keyboard and screen readers: every key and row is a real button with a
  label and a visible focus ring. Sheets trap focus and close on Esc.
- With `prefers-reduced-motion`, sheets and views appear without sliding.

## Android-only (not portable to a web page)

- Home-screen widget, Quick Settings tile, notification remote, lock-screen
  controls, `melodious://` deep links.
- Phone volume rocker, and the "This phone" settings that go with it.
- The app's keyboard and voice drawer. The web keyboard surface uses the
  phone's own keyboard, whose mic button dictates.
- SSH recovery (`core-ssh`); hub discovery and the connect screen.
- Anything else on the stock :8088 bus: the sleep timer, "Resend
  everything" (hub Help), instant state push. (Native press-and-hold now
  goes through `/api/ir-send`, which relays it to the bus.) That bus wants a
  Logitech `Origin` header, which a browser can't send. Reaching it would
  need a hub-side proxy route, which is a backend change. The web keeps
  polling `/api/state`.

## Web-only (the app lacks these; they stay, restyled)

- **Settings pages:**
  - Wi-Fi;
  - MQTT;
  - Backup: owner bundle, single exports, restore with typed guards;
  - System: status, logs, cloud blocker, time zone, sign-in, software
    update, HA rediscovery, reboot.
- **IR tools:**
  - add, edit and delete devices;
  - add, edit and delete commands, including signal details;
  - capture, test and save (Learn);
  - batch sweep with dry run and cancel;
  - Find codes (IRDB search and preview, file drop);
  - paste import; RemoteCentral fetch; the IR lab.
- **Bluetooth:** scan, connect, disconnect, adapter status, 30 quick keys
  and custom combos, saved devices with keyboard-script commands.
- **Activities:**
  - reorder (Move up and Move down in the ⋮ menu);
  - the vendored advanced editor;
  - pressing a non-running activity's keys. This stays as "Try the buttons"
    in the activity menu, which opens `#remote/<id>` without starting it.
- **Remote:** the send log, the resolved command for every key, and "All
  commands".
- **Wizard:**
  - the review step;
  - "Don't switch" among a device's inputs;
  - a key's hold action (a Press / Hold tab in the button picker);
  - the wait after a device turns on, on the Devices step. The app keeps
    it in its "Start & end" step, which is parity item P2.

## Slices (one PR at a time)

1. **Shell and remote.**
   - Brand and icon.
   - Tokens and components (every view picks up the new look).
   - Shell with four tabs.
   - Remote tab (buttons, keyboard tab, more keys, Fix-it).
   - Devices list plus device remote and commands (the old Control
     "Devices" mode).
   - Settings list linking the existing pages.

   Done: PR #21.
2. **Activities:** list, wizard, editor entry points. The photo's last user
   goes, so the hub stops injecting it into the page (the C change in
   `render_harmony_shell`).

   Done: PR #22; see "Slice 2 notes" below.
3. **Devices:** the IR setup functions move into the device pages (settings,
   learn, import, Find codes, batch sweep, lab, add/edit/delete). The old
   `#ir` page goes.

   Done: PR #23; see "Slice 3 notes" below.
4. **Settings:** Hub, Bluetooth, MQTT, Wi-Fi, Backup and System pages.
   Leftover old CSS goes.

Every PR must have:
- the sim tests green;
- `tools/harmony_shell_smoke.mjs` updated wherever the contract really
  changed (for example the photo remote);
- the baselines holding (reconciliation 12, installer 37 OK, hygiene ok);
- before and after screenshots at 390 px and 1280 px;
- the bundle and binary size change.

## Size

Baseline on `main`:

| Item | Size |
| --- | --- |
| Shell JS | 240,199 B |
| Shell CSS | 47,070 B |
| Page HTML | 10,045 B, plus about 80 KB of base64 photo injected by C on every load |
| `codex_webui` | 992,740 B |

Budget for the additions:

| Addition | Cost |
| --- | --- |
| Fonts | 0 B |
| Icons | about 8–12 KB |
| Favicon | about 5 KB |

Slice 1 should stay within +30 KB net. Later slices delete old views and CSS
and should shrink the bundle.

After each slice (bytes):

| Item | `main` before | Slice 1 (PR #21) | Slice 2 (PR #22) | Slice 3 (PR #23) |
| --- | --- | --- | --- | --- |
| Shell JS | 240,199 | 265,965 | 275,827 | 288,922 |
| Shell CSS | 47,070 | 53,388 | 54,274 | 63,114 |
| Page HTML per load | 10,045 + 79,856 photo | 28,916 + 79,856 photo | 28,842, no photo | 28,746 |
| All three per load | 377,170 | 428,125 | 358,943 | 380,782 |
| `codex_webui` | 992,740 | 1,043,700 | 1,054,340 | 1,076,180 |

Slice 2 serves 69,182 bytes less per page load than slice 1: the photo's
79,856 base64 bytes go, while the new wizard, the menu and the dialog add
10,748 bytes of script and style. The binary still carries the photo for
the legacy page, so it grows by 10,640 bytes.

Slice 3 serves 21,839 bytes more per page load than slice 2, and the binary
grows by 21,840 bytes. The old IR page and the Devices view minified to
about 50 KB of script; the device pages, sheets and the settings page that
replace them, with the app's components and every web-only tool, to about
66 KB, and `devices.css` adds about 9 KB. Slice 4 removes the old setup-page
CSS that only the unported Settings pages still use.

## Owner decisions (2026-10-21)

1. **The photo remote goes.** The native keypad replaces it, matching the
   app. `DESIGN.md`'s old "the photo is the interface" rule is retired.
   - Slice 1 drops it from the Remote.
   - The hub stops injecting the base64 JPEG into the page in slice 2. That
     is a small change to `render_harmony_shell`, not a route. It has to
     wait because the wizard's "Map buttons" step is the photo's last user,
     and the hub serves no `/assets/remote-skin.jpg` to fall back on. It
     saves about 80 KB per page load.
   - The legacy page keeps its photo.
2. **App extras that come to the web:**
   - the Keyboard tab on the remote;
   - the Fix-it sheet (per-device resend only; there's no hub-wide Help).

   The touchpad and repeat-while-held were not chosen. Keys fire once,
   except keys with a hold action, which fire it after 500 ms.
   (Superseded 2026-10-22: the owner asked for repeat-while-held; it matches
   the app.)
3. **Wide screens:** navigation rail with the content centred.
4. **Icons:** the 64 px favicon and the 180 px home-screen icon, together
   about 26 KB per page load.
5. **The plan is approved; slice 1 starts.**
6. **Slice 2: the Back key is assignable in the wizard** (`PrevChannel`,
   suggested from a device's Back, Return or Previous command), as in the
   app.
7. **Slice 2: an exact command name wins.** When matching a key to a
   device's commands, a command named exactly like one of the key's aliases
   beats an earlier command that only contains one. Before, the fixture
   amplifier's OK and Enter keys found "CenterDown" (it contains "enter")
   and its Back found "PreviousTrack". This applies to the device remote and
   the wizard's suggestions; the C legacy page and the Android app keep the
   first match.
8. **Slice 3: the placement of the IR tools** is the table in "Slice 3
   notes", approved as proposed with two choices:
   - the IR lab is a Tools row on the Devices tab (`#devices/lab`);
   - Edit details and Delete device are in a ⋮ menu on the device page's
     top bar, so the settings page keeps to Power, Inputs and Timing.
9. **Slice 3: the simulator answers the IR write routes** (the `/ir/*`
   forms, import, the lab, test, batch send and cancel) from memory, so the
   new pages can be tried end to end. It is test tooling; the hub's routes
   and request shapes don't change.

## Slice 2 notes

- **Activities tab.** The running activity has the "RUNNING NOW" card with
  Open remote and Turn off; the other activities are rows with Start and a ⋮
  menu: Edit, Set up buttons (opens the wizard on its Buttons step), Try the
  buttons (`#remote/<id>`), Advanced editor, Move up, Move down and Delete
  (with a confirm dialog). Start opens the Remote tab, as in the app. A row
  with fewer than 5 buttons says so in amber.
- **Moving past the running activity.** Move up and Move down step over the
  activity in the running card, so the two activities that swap are the
  ones you see side by side; the running one keeps its place.
- **Wizard routes.** `#wizard` (new), `#wizard/<id>` (edit) and
  `#wizard/<id>/buttons`. Leaving with changes asks "Discard changes?",
  whether through the close button, the browser's Back or the navigation
  rail; staying puts history back exactly as it was, and the page also warns
  before a reload loses changes. While a save is in flight the wizard stays
  put. Opened on a later step, Next stays off until the earlier steps are
  filled in, and the step says what is missing.
- **Jobs, not rows.** As in the app, each job (Screen, Sound / volume, …) is
  a card with its device, and one device can do several jobs. A new
  activity starts with the first TV as the screen and the first amplifier
  as the sound, like the app (a receiver or soundbar counts as well).
- **A device's input and wait belong to the device.** Every job of a device
  shares them. A device new to the activity starts on "Don't switch" with no
  wait (the app picks its first input; the web keeps its earlier
  behaviour). Changing a job's device no longer keeps the old device's
  input name, which the old form did.
- **Power-on order is kept.** Editing loads the roles in the hub's power-on
  order, so saving keeps it. The old wizard numbered devices in the order
  the roles were stored and could swap them.
- **Buttons.** "Check the buttons" lists the 36 keys in the app's groups. A
  key opens a picker: Press and Hold tabs, the activity's devices as chips,
  search, and the device's commands. A key's double-press action is kept as
  it was. A cleared key stays cleared; suggestions don't fill it again. Keys
  a map spells another way ("DVR" for "Dvr") show on their row and save as
  one entry. Back is only suggested from a command named Back, Return or
  Previous, never from "PreviousTrack".
  "Undo my change" (one key) and "Undo my changes" (every key) put keys back
  as the wizard opened them: the activity's own mapping, or a new activity's
  suggestion. The old wizard's resets went to the suggestion even on an
  edited activity.
- **A refused save reloads.** If the hub's setup changed elsewhere, the save
  is refused, the wizard reloads the latest setup and the next try saves
  onto it.
- **The photo is gone from the shell.** `render_harmony_shell` serves the
  generated page whole, the packager no longer splits it at a base64 seam,
  and the photo CSS, the sim's copy of the JPEG and the hotspot geometry in
  `remote-layout.js` are removed. The legacy page keeps its photo.

## Slice 3 notes

Every function of the old `#ir` page and where it is now (`#ir` itself opens
the Devices tab):

| `#ir` | Now |
| --- | --- |
| Device list (maker, model, type, count; id on hover) | Devices tab list. The id, maker, model and type are in Edit details. |
| Counts: devices of the limit, all commands, the per-device and per-request limits | A line under the list ("4 of 32 devices · 215 commands in all"); the two limits in the Import sheet |
| Add device | Devices tab: + in the title (like New activity) opens "Add a device"; the new device's page opens once the hub has it |
| Edit device | Device page ⋮ → Edit details (same fields and route) |
| Delete device, with the in-use guard and the removal of its own remote screens | Device page ⋮ → Delete device: "still in use" names the activities and maps, otherwise the app's confirm dialog |
| Refresh | No button: every page reads the hub when it opens and after each change; errors offer Try again |
| Settings: power type, On/Off or toggle command | `#devices/<id>/settings` (tune icon): radio rows and the app's command picker |
| Wait after power-on, Always on, Leave on between activities | "Turning on": warm-up stepper and two switches, hidden for "No power control" as in the app (still sent unchanged) |
| Inputs, all of it | "Inputs" section (web-only): switching type, wait, the list with names, commands and a ⋮ (Move up, Move down, Remove), Add input, Fill from commands, the cycling commands and the input after power-on, the in-use hint and check |
| Timing | The app's three steppers; the number can be typed, so any value still works |
| Save settings | The app's bottom Save bar; leaving with changes asks "Discard changes?" |
| Command list, badges, Send | Commands tab: tap sends; "Learned" as in the app |
| Edit command (signal details), Delete command | ⋮ on each command: Edit (same fields; a raw command's timings are filled in) and Delete (confirm dialog) |
| Add command by code | Import codes → Type a code (the same form) |
| Learn: capture, signal, name, Test, Save | Commands tab → Learn a button: the app's sheet; Signal details are a web extra |
| Batch sweep | Commands tab → Send all… (`#devices/<id>/sweep`): gap, commands per request, the command list, Dry run, Send, Stop, progress and log |
| Find codes (IRDB search, Preview, file, Import) | Import codes → Find codes; nothing is fetched until Search IRDB or Preview |
| Paste codes | Import codes → Paste |
| RemoteCentral | Import codes → Paste → Fetch from RemoteCentral; Add puts a code in the paste box |
| IR lab | Devices tab → Tools → IR lab (`#devices/lab`): set up the scratch device, open it, clear it with the same two-step guard |
| A device select on every panel | Gone: each tool works on the page's device |

Behaviour:
- **Faster on the hub.** The pages read the setup from
  `/api/activity-config` (about 0.2 s on the hub, and it holds the whole
  device list) instead of `/api/inventory` (about 10 s) and
  `/api/device-commands` (1.5–3 s per device). The limits are the hub's
  constants, the same as `ir-model.js`'s `LIMITS`.
- **A refusal reads as one.** The hub answers its `/ir/*` forms with HTTP
  200 even when it refuses. The old page showed such a refusal as a green
  "ok"; now a change only counts once the re-read setup has it, and the
  hub's message is shown as the error otherwise.
- **Learn a button** starts over after a save, ready for the next button,
  as the app does. A capture that heard nothing says so under Start.
- **Import codes** closes once the hub has the codes and says how many it
  imported, skipped or rejected.
- **Device settings** keep Save off until something changes, except on a
  device the hub has no power settings for yet: its suggestions can be
  saved as they are. Inputs are sent only when they change, as before, so
  saving power alone never rewrites a cloud-made input feature. A save goes
  back to the device.
- **Send all commands** goes on while the page is closed; coming back
  shows the run, and Stop cancels it on the hub. One run at a time.
- **Delete device** checks the setup on screen first, then the hub's own
  copy, before it removes the device's own remote screens and the device.
