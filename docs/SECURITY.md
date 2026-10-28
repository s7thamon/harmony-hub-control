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

## Release signing

Each release's `SHA256SUMS.txt` is signed with an Ed25519 key that the owner
holds offline (an OpenSSH `SSHSIG`, namespace `melodious-release`). The
signature covers every asset and `melodious-update.json`, which lists the
SHA-256 of each hub payload file. The public keys are in
`docs/release-signers`. Check a download with stock `ssh-keygen`:

```sh
ssh-keygen -Y verify -f docs/release-signers -I melodious-release \
  -n melodious-release -s SHA256SUMS.txt.sig < SHA256SUMS.txt
shasum -a 256 -c SHA256SUMS.txt
```

`docs/RELEASING.md` covers the keys, rotation and the release steps.

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
