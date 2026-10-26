# 25 Safety and operating rules

## 1. Owner rules

- Preserve the stock Touch experience. No Touch software replacement, and no firmware
  flashing.
- Research phases are **read-only on both devices**:
  - no uploads, edits, installs, reboots, process restarts, debug-mode changes, pairing
    changes or sync triggers;
  - no mutation endpoints, commits, imports, activity runs, button sends, IR/Bluetooth sends,
    HA services or webhooks.
- "GET", "status" and "dryRun" labels don't prove an operation is side-effect-free. Read the
  implementation first. (Verified side-effect-free: `CommitHaDevices` dry run; it still takes
  the writer lock.)
- No Home Assistant installation or test harness on the Mac. HA tests run on the owner's
  server.
- The assistant runs approved commands; the owner only handles physical hardware. Never hand
  the owner copy-paste runbooks.
- Every hardware write step needs explicit approval for **that** step.
- Never tell the owner to use the Touch's menu Sync; publishes trigger the Touch by itself.
- Never fake a successful `setup.firmware?check`. It once stranded the Touch on a
  "myharmony.com" screen.

## 2. Access

| Device | Access | Notes |
|---|---|---|
| Hub | `ssh -i ~/.ssh/harmony_owner_ed25519 root@<hub>` | BusyBox: no `head` or `df`; use `ls -la`, `cat`, `md5sum` |
| Touch | `ssh -i ~/.ssh/harmony_owner_ed25519 -o UserKnownHostsFile=/tmp/melodious-touch-usb/known_hosts root@192.168.2.1` over USB Ethernet (Mac interface 192.168.2.2/24) | no `tar`; copy file by file with `cat`. Root SSH is verified; **don't re-root**. |
| Touch over RF | HOT `hot.1.data.resource {"file":…}` through the hub hal tunnel | send `timeout: 30000` (ms); 60 means 60 ms |

- The Touch suspends even on USB (ScreenTimeout about 29 s). Work in short bursts, treat
  silence as sleep, and wake it rather than rebooting.
- Resume with stale watchdog files has self-rebooted the Touch (it recovered).
- The backup `~/Backups/HarmonyTouch/2026-10-25_21-05-12.tar.gz` is live and non-atomic. It
  excludes the radio chip's internal storage. **Restore is untested; never flash.**

## 3. Data hygiene

- Never commit:
  - household IDs, names, emails, serials, entity IDs;
  - webhook IDs, URLs, keys;
  - raw dumps or raw resources.
- Raw captures live in `/tmp/melodious-research/private/` (mode 700) or the private backup
  folders.
- Fixtures are synthetic. The example graph uses IDs in synthetic ranges that respect the
  Melodious floors.
- **Sanitization check before committing anything from this folder:** extract every scalar
  value of 6 or more characters, and every number of 6 or more digits, from a private
  snapshot, and grep the files for them. Check device, activity, group and scene names
  separately. Zero hits are required. The research used this method; see the report's
  §13.

## 4. Engineering rules (from verified failures)

- Every resource write goes through the plugin (new etags, reload, publish). No raw writes.
- IP devices must meet corpus §07 §7. A uid-less IP device kills the engine's IP task until
  reboot.
- The webhook must answer 200 fast. Non-200 triggers failure paths; slow answers hit the
  500 ms queue deadline.
- `codex_webui` reads POST bodies by Content-Length only. Test POST paths on
  `tools/hub-emu`.
- After a change to `codexactivity.lua`, a reboot is needed (the old plugin stays loaded).
  The writer then answers 503 for a minute or two.
- Hub `/data` is a ~5 MB jffs2. Check space before installs.
- Commit hygiene: check the branch and PR state before committing. The owner merges from this
  checkout; push explicit branches.
