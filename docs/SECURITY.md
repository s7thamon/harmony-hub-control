# Security Notes

This project changes a Harmony Hub into a local-control appliance. Treat it as
trusted-LAN equipment.

## Current Policy

- HTTP authentication is disabled.
- The web UI should only be reachable from a trusted local network.
- SSH access is managed by the already-rooted hub state.
- MQTT credentials are provided at install time or from the web UI and must not
  be committed.
- The hub installs software only through the installer, over SSH. Hub 1.2.0
  and older also accepted binaries over HTTP (`/api/update-begin`, `-chunk`,
  `-apply`) with a checksum list the client supplied. On a hub with sign-in
  off, any device on the network could replace a hub program that way. 1.3.0
  removed those routes, so update older hubs with the installer.

## Checking a download

Releases are not signed. Each release's `SHA256SUMS.txt` lists the SHA-256 of
every asset, so `shasum -a 256 -c SHA256SUMS.txt` proves a download is intact.
It doesn't prove who published it: anyone who can publish on the GitHub repo
can replace both the files and the checksums. The Android APK is the
exception, because Android only installs an update signed with the same key
as the installed app (certificate SHA-256 `7a766509…0bd2de`).

## Never Commit

- SSH private keys or `authorized_keys`
- MQTT passwords
- Home Assistant long-lived tokens
- Real hub backups
- Firmware dumps
- Rooting tools or vulnerability writeups
- Local IPs if they reveal a private deployment you do not want shared

## Before Sharing

Run a quick scan from the repo root:

```powershell
rg -n "PRIVATE KEY|BEGIN OPENSSH|password|authorized_keys|token|secret|credential" .
```

Review any hits before pushing or zipping the repository.

The installer intentionally writes `/etc/tdeenable` because the post-root
runtime expects the local service mode to remain enabled. That is runtime setup,
not a rooting method.
