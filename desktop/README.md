# Melodious for macOS (`desktop/`)

Desktop shell for Melodious on macOS (`docs/DESKTOP_APP.md`). It serves the packaged web UI (`tools/package_harmony_shell.sh`) over `melodious://app` and forwards hub requests over the LAN.

## Setup

```sh
cd desktop
npm ci
node node_modules/electron/install.js
```

## Bundle and run

```sh
cd desktop
npm start
```

`scripts/bundle-shell.sh` runs `tools/package_harmony_shell.sh`, checks that `payload/source/harmony_shell_assets.h` did not change, and copies the five shell files into `desktop/build/shell/`.

## Tests

Unit tests (forwarder rules, headers, 401/502 handling, SSDP discovery, settings and security):

```sh
node --test desktop/test/
```

Playwright `_electron` end-to-end suite against `tools/webui-sim`:

```sh
cd desktop
npm run test:e2e
```
