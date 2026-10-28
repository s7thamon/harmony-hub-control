# Releasing Melodious

A release is a GitHub release `v<version>` ("Melodious <major.minor>") with:
- the hub zip;
- the Android APK;
- the four macOS files;
- `melodious-update.json`;
- `SHA256SUMS.txt` and its signature `SHA256SUMS.txt.sig`.

A Mac-only hotfix may go out as `desktop-v<version>` with the Mac files. Untick
"Set as latest" on those releases, so GitHub's "latest" stays on the full
release.

Apps and, later, the hub trust a release only when `SHA256SUMS.txt.sig`
verifies with a public key in `docs/release-signers`. That signature covers
every asset hash and `melodious-update.json`.

## The signing keys (once)

There are two Ed25519 keys:
- **melodious-release-1**: signs releases.
- **melodious-release-2**: a cold backup, used only if key 1 is lost or
  stolen.

Clients trust both from the start, so a lost key doesn't strand anyone.

Generate each with a passphrase, on the Mac:

```sh
ssh-keygen -t ed25519 -a 200 -C melodious-release-1 -f <offline-dir>/melodious-release-1
ssh-keygen -t ed25519 -a 200 -C melodious-release-2 -f <other-offline-dir>/melodious-release-2
```

Keep the private keys off the dev Mac's `~/.ssh`: for example, on an encrypted
USB drive or as password-manager attachments, with key 2 stored separately
from key 1. Never put them in the repo, in CI or in `/tmp`.

Then publish the two public keys in `docs/release-signers`, one line each:

```text
melodious-release namespaces="melodious-release" ssh-ed25519 AAAA… melodious-release-1
melodious-release namespaces="melodious-release" ssh-ed25519 AAAA… melodious-release-2
```

### Rotation and compromise

| Event | What to do |
| --- | --- |
| Planned rotation | Make key 3. Ship a release signed with key 1 whose apps trust keys 2 and 3. Sign later releases with key 2. |
| Key 1 lost | Sign with key 2. The next release trusts keys 2 and 3. |
| Key 1 stolen | Change the GitHub credentials too: publishing needs both. Ship a release signed with key 2 that trusts keys 2 and 3 only. Copies that never update keep trusting key 1. |
| Both lost | Make new keys. Users install that release by hand once, as they did before signed releases. |

The Android signing key (`melodious-release.jks`, certificate SHA-256
`7a766509…0bd2de`) is a separate trust root. Android refuses an update signed
with any other key, so losing it means users uninstall and reinstall.

## Each release

1. **Build the assets** into one folder:
   - `melodious-hub-<v>.zip`;
   - the owner signs the APK with `apksigner` → `melodious-<v>.apk`;
   - `Melodious-<v>-{arm64,x64}.{dmg,zip}`.
2. **Write the manifest and checksums** (the agent runs this):

   ```sh
   python3 tools/releases/release.py manifest <folder> --version <v> --min-hub <oldest hub the apps support>
   ```

   This writes:
   - `melodious-update.json`: version, the APK's versionCode and certificate,
     the Mac zips, and each hub payload file with its install destination,
     tier and SHA-256;
   - `SHA256SUMS.txt`: every asset plus `melodious-update.json`.

   It also checks:
   - the APK is signed with the release key;
   - the hub zip's `MANIFEST.txt` matches its binaries;
   - every payload file has a known destination.
3. **Sign** (the owner, one passphrase prompt):

   ```sh
   cd <folder> && ssh-keygen -Y sign -f <offline-dir>/melodious-release-1 -n melodious-release SHA256SUMS.txt
   ```

4. **Verify** (the agent runs this):

   ```sh
   python3 tools/releases/release.py verify <folder>
   ```

   It checks the signature against `docs/release-signers`, every checksum,
   that nothing in the folder is left out, and that the manifest matches the
   assets.
5. **Upload everything in the folder**, including `melodious-update.json` and
   `SHA256SUMS.txt.sig`, then publish.

For a `desktop-v<v>` release, add `--series desktop --commit <sha>` in step 2.

## Hub version

`MELODIOUS_VERSION` in `payload/source/codex_webui.c` is the release the hub
software belongs to. `GET /api/version` reports it. Bump it in the release
commit and rebuild `codex_webui` (`docs/BUILD.md`), even if nothing else in
the hub changed.
