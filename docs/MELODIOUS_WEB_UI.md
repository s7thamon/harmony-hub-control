# Melodious web UI: porting the Android app's interface

Status: plan approved by the owner, 2026-10-21 (decisions at the end).
Branch `feat/melodious-ui` from `main`.

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
- The router gains path arguments (`#devices/<id>`, `#devices/<id>/settings`,
  `#remote/<activityId>`). Today it only matches exact names.

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
| DeviceDetailScreen | Device page with Remote and Commands tabs (tap a command to send it; search) | 1 |
| Learn and Import sheets | Learn a button, Import codes | 3 |
| `devices/DeviceSettingsScreen` | Device settings page: Power, Inputs (web-only), Timing | 3 |
| `activities/ActivitiesScreen` | Activities tab: running card, rows with Start and a ⋮ menu (Edit, Set up buttons, Advanced editor, Delete); reorder kept | 2 |
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
| ConfirmDialog | `<dialog class="m-dialog">`. The existing inline danger guards stay where a typed phrase is needed. |
| Snackbar | `.m-snackbar` (inverse surface), errors linger |
| FilterChip / AssistChip | `.m-chip` |
| EmptyState | `.m-empty` |
| KeyButton, IconKey, TextKey, CaptionKey, DPad, Rocker, ColorKey | `.rk-*` remote keys (a native keypad, no photo) |
| Material icons | inline SVG paths for the roughly 40 Material Symbols the app uses (Apache-2.0; licence goes in `third_party/`) |

## Behaviour carried over

- Plain keys fire on release.
- Keys with a hold action fire it after 500 ms (the web used 550 ms).
- Unmapped keys dim to 35% and do nothing.
- Keys don't repeat while held (the owner chose not to port that).
- Menu or Exit is relabelled "Home" when it really sends Home.
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
- Anything on the stock :8088 bus: native press-and-hold, the sleep timer,
  "Resend everything" (hub Help), instant state push. That bus wants a
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
  - reorder;
  - the vendored advanced editor;
  - pressing a non-running activity's keys. This stays as "Try the buttons"
    in the activity menu, which opens `#remote/<id>` without starting it.
- **Remote:** the send log, the resolved command for every key, and "All
  commands".
- **Wizard:** the review step and the per-device input choice.

## Slices (one PR at a time)

1. **Shell and remote.**
   - Brand and icon.
   - Tokens and components (every view picks up the new look).
   - Shell with four tabs.
   - Remote tab (buttons, keyboard tab, more keys, Fix-it).
   - Devices list plus device remote and commands (the old Control
     "Devices" mode).
   - Settings list linking the existing pages.
2. **Activities:** list, wizard, editor entry points. The photo's last user
   goes, so the hub stops injecting it into the page (the C change in
   `render_harmony_shell`).
3. **Devices:** the IR setup functions move into the device pages (settings,
   learn, import, Find codes, batch sweep, lab, add/edit/delete). The old
   `#ir` page goes.
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
3. **Wide screens:** navigation rail with the content centred.
4. **Icons:** the 64 px favicon and the 180 px home-screen icon, together
   about 26 KB per page load.
5. **The plan is approved; slice 1 starts.**
