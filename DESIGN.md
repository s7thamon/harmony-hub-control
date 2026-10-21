# Melodious design system

The hub web UI and the Melodious Android app share one visual identity. The
app (Kotlin + Jetpack Compose, Material 3, dark) is the reference: its theme
is `MelodiousTheme.kt`, and the web tokens below mirror it. The port plan and
the screen-by-screen mapping are in `docs/MELODIOUS_WEB_UI.md`.

## 1. Identity

- **Product name: Melodious.** "Harmony Hub" and "Harmony Touch" stay as the
  names of the devices. The repo, binaries, paths and API routes keep their
  technical names.
- **Icon:** the neon wave-and-remote glyph on a charcoal tile, from the
  owner's artwork. The web page inlines a 64 px favicon and a 180 px
  home-screen icon (the hub serves no separate icon files).
- **Feel:** a calm phone remote. Big, friendly keys; one obvious thing per
  screen; what is on and what a key will do are always clear. Dark only.

## 2. Colour

Tokens live in `tools/webui-sim/public/css/tokens.css`.

### App palette (`MelodiousColors`)

| Token | Value | Use |
| --- | --- | --- |
| `--canvas` | `#0e1014` | Page background |
| `--nav-bar` | `#15181d` | Bottom bar, rail |
| `--card` | `#171a20` | Cards, list groups, sheets' cards |
| `--key` | `#1f232b` | Remote keys, rockers |
| `--key-raised` | `#2a2f39` | Pressed key, OK |
| `--dpad-ring` | `#1a1e25` | D-pad ring |
| `--divider` | `#22262e` | Hairlines between rows |
| `--live` | `#6fd3a8` | Running / connected dot |
| `--warning` | `#f2c48d` | Warnings |
| `--power-container` / `--on-power-container` | `#3a1f1f` / `#ffb4ab` | Power and destructive fills |
| `--running-card` | `#1d2840` | The running activity, info notes |
| `--key-red` `--key-green` `--key-yellow` `--key-blue` | `#f06a6a` `#5fd08b` `#f2d25c` `#6aa2f5` | Colour keys |

### Material 3 dark scheme

| Token | Value |
| --- | --- |
| `--primary` / `--on-primary` | `#9db8ff` / `#0b1a3a` |
| `--primary-container` / `--on-primary-container` | `#2b3a5e` / `#d9e2ff` |
| `--secondary` / `--secondary-container` | `#bec6dc` / `#2b3a5e` |
| `--tertiary` / `--on-tertiary` | `#8fe0bc` / `#003828` |
| `--on-surface` / `--on-surface-variant` | `#e7e9ee` / `#a3aab7` |
| `--surface-lowest` / `--surface-high` / `--surface-highest` | `#0a0b0e` / `#1a1d23` / `#262a33` |
| `--outline` / `--outline-variant` | `#4a505c` / `#343a46` |
| `--error` / `--on-error` | `#ffb4ab` / `#690005` |
| `--inverse-surface` / `--inverse-on-surface` | `#e2e2e9` / `#2f3036` |

### Rules

- **Primary blue** is for the main action on a screen (filled buttons), the
  selected tab, section labels and links.
- **Green** (`--live`) means running or connected, and nothing else.
- **Power and destructive** actions use the power container (dark red fill,
  coral text), never primary.
- Unmapped remote keys stay visible but dimmed to 35%.
- Older token names (`--surface-*`, `--accent-*`, `--status-*`) are aliases
  for pages not ported yet. New code uses the names above.

## 3. Type

The system font stack: Roboto on Android (the app's own font), SF on Apple,
Segoe on Windows. No web fonts are shipped.

| Use | Size / weight |
| --- | --- |
| Screen title, "Everything's off" | 28 / 500 |
| Remote title | 24 / 500 |
| Running card, empty-state title | 22 / 500 |
| Sheet title | 20 / 500 |
| Card and row titles | 16–18 |
| Body, buttons | 15 (buttons 14 / 500) |
| Section labels | 14 / 500, primary |
| Subtitles | 13 |
| Key captions, badges | 12 |
| Overlines ("VOL", "CH") | 11 / 600, +1px tracking |

- Sentence case everywhere.
- Body text never goes below 13 px.

## 4. Shape, spacing, layout

- **Shapes:** 8, 12, 16, 24 and 28 px (`--shape-xs` … `--shape-xl`) and full
  pills.
  - List groups and cards use 24.
  - Sheets and dialogs use 28.
  - Keys use 16–20; the D-pad, OK and the power button are circles.
- **Spacing:** a 4 px grid (`--space-1` … `--space-12`). Page gutters are
  16 px on phones.
- **Navigation:** four tabs (Remote, Activities, Devices, Settings).
  - Phones get a bottom navigation bar, 80 px tall, with a pill indicator.
  - From 840 px there is a navigation rail (88 px) with the brand mark.
  - Sub-pages get a top bar with a back arrow and hide the bottom bar on
    phones, as the app's full-screen pages do.
- **Remote layout:**
  - On phones the remote fills the screen above the bar, up to 780 px tall;
    the D-pad takes the spare height (up to 320 px).
  - From 1100 px, "More keys" sits in a panel beside the remote instead of a
    sheet.
- Lists are capped at 720 px wide.

## 5. Components

| App (Compose) | Web |
| --- | --- |
| ScreenTitle, SectionLabel | `.m-title`, `.m-section` |
| ListGroup, ListRow | `.m-list`, `.m-row` (min 64 px, chevron for navigation) |
| IconTile, StatusDot | `.m-tile`, `.m-dot` |
| Button, FilledTonalButton, OutlinedButton, TextButton | `.btn-filled`, `.btn-tonal`, `.btn-outlined`, `.btn-text` |
| PowerButton | `.power-btn` |
| ModalBottomSheet | `<dialog class="sheet">` (a centred card on wide screens) |
| Snackbar | `.snackbar`: inverse surface; errors stay for 8 s |
| Remote mode tabs | `.seg-tabs` (pill track, primary-container selection) |
| Keys | `.rk`, `.dpad-*`, `.rocker`, `.rk-captioned`, `.rk-color` |

Unported setup pages keep their own classes (`.panel`, `.btn-primary`,
`.notice-*`, …), restyled to these tokens.

Icons are Material Icons (filled and outlined, Apache-2.0) inlined as SVG
paths, the same glyphs the app draws. See `third_party/material-icons/`. No
emoji icons.

## 6. Remote behaviour

- A key fires when the finger lifts. Sliding off cancels it.
- A key with a long-press action fires that action after 500 ms instead.
  Those keys carry a small dot.
- Menu or Exit is labelled "Home" when it really sends Home.
- Unmapped keys are dimmed and inert.
- Feedback: the pressed key brightens, phones that can vibrate tick, and a
  quiet status line shows "key → device · command" (it also previews keys on
  hover and focus).
- Failures show as a snackbar, never `alert()`.
- **Power** turns the activity off with no confirmation, like the physical
  remote. Destructive edits (delete, restore, reboot) keep their
  confirmation guards.

## 7. Motion

- Easing: standard `cubic-bezier(0.2, 0, 0, 1)`, emphasized
  `cubic-bezier(0.05, 0.7, 0.1, 1)`.
- Durations: 150, 250 and 400 ms.
- Animate transform, opacity and colour only.
- Views fade up 6 px.
- Sheets rise; on wide screens they scale in from 96%.
- With `prefers-reduced-motion`, all of that is off and spinners slow down.

## 8. Do and don't

### Do

- Lead the Remote tab with what is running and a one-tap power button.
- Keep every function reachable. Web-only tools (Wi-Fi, MQTT, Backup, System,
  IR tools) live under Settings and Devices.
- Keep the hub offline: no CDN, no web fonts, no new served files.

### Don't

- Invent new colours outside the tokens, or use primary for power or delete.
- Use emoji as icons, or modal confirmations for ordinary sends.
- Make the simulator contact a real hub. The sim binds 127.0.0.1 and only
  uses its fixtures.
