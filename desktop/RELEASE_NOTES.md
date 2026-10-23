Melodious for macOS is the Melodious web app in a Mac window, plus one thing the hub's own page can't do: sign in to your Logitech account and pull a device's codes from Logitech's catalog. Your Logitech sign-in stays on your Mac; the hub never sees it.

## Downloads

| File | What it is |
| --- | --- |
| `Melodious-1.0.0-arm64.dmg` | Apple silicon (M1 and later) |
| `Melodious-1.0.0-x64.dmg` | Intel |
| `Melodious-1.0.0-arm64.zip`, `Melodious-1.0.0-x64.zip` | The same apps, zipped |
| `SHA256SUMS.txt` | SHA-256 checksums of the four files |

Needs macOS 13 or later and a hub running Melodious. Use hub software from this release's commit or newer: the app carries that commit's web app, and catalog import needs the hub's catalog route (an older hub says "update the hub"). The app ships Electron 45.0.0 (Chromium 156).

## Install

1. Open the `.dmg` for your Mac and drag Melodious to Applications (or unzip the `.zip`).
2. The app isn't signed with an Apple Developer ID, so macOS asks before the first launch:
   - Finder: Control-click Melodious → Open. Where macOS no longer offers Open, use System Settings → Privacy & Security → Open Anyway.
   - Or in Terminal: `xattr -dr com.apple.quarantine /Applications/Melodious.app`
3. Melodious looks for your hub on the network, or you type its address. If your hub has a sign-in, enter it once; it's kept encrypted in your Keychain.

## What's in 1.0

- **The web app, unchanged:** Remote, Activities, Devices and Settings, from the same bundle the hub serves.
- **Logitech catalog lookup:** Devices → a device → Import codes → Logitech catalog.
  - Sign in with your Logitech account (Google sign-in works) in a separate window.
  - Type the brand and model; the app checks the model name as you type, then Search lists the matches.
  - Download one device's codes, preview them, and import the commands this hub can play. Commands whose IR protocol the hub doesn't have are listed with the reason, not dropped silently.
- **Settings (⌘,):** the hub's address and sign-in, and the Logitech account.

## Privacy

- Logitech tokens stay in the app's background process and are stored encrypted with your Keychain. Sign out deletes them.
- The hub gets only the imported commands. Logitech gets the sign-in, the searches and the one device you download; nothing about your hub.
- No telemetry, no crash upload, no update check. The app contacts Logitech only when you sign in, type a model, search or download.

## Known limits

- **Updates:** download each new version from the release page; the app doesn't update itself. Each build has a new signature, so macOS may ask once more to let Melodious use "Melodious Safe Storage" in your Keychain. Choose Always Allow.
- **Protocols:** catalog codes import only if the hub already has their IR protocol. The others are listed as skipped.
- **Sign-in:** Google sign-in is tested. Logitech email-and-password sign-in uses the same page but hasn't been run.
- **Logitech's service:** this uses your own Logitech account. If Logitech closes this path, IRDB search, code files and learning still work.

See the [README](https://github.com/schlambos/harmony-hub-control#the-macos-app) for details and screenshots.
