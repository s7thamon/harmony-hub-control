# Logitech catalog helper

Downloads one device's command set from Logitech's own catalog, on your
computer, for import into Melodious. Use it only for devices you own.

```sh
python3 tools/catalog/harmony_catalog.py Sony STR-DG720
# writes harmony-catalog-sony-str-dg720.json
```

Then, in the web UI: open the device → **Import codes → Logitech catalog** →
open the package. Only commands whose IR protocol your hub already has are
imported (a Sony receiver's `Sony 15 Bit` set works out of the box on most
hubs); the rest are listed in the sheet, not dropped silently.

## One-time setup

1. **Logitech's client_id.** Sign-in needs an identifier that lives inside
   Logitech's Android app. It is their credential, so it is not shipped
   here. Put your own copy of the Harmony app APK at `~/Downloads/harmony.apk`
   (or pass `--apk PATH`, or set `MELODIOUS_HARMONY_APK`), and the helper
   reads the one value out of it. If you already have the value, set
   `MELODIOUS_CLIENT_ID` instead.
2. **Your Logitech email.** Pass `--email` or set `MELODIOUS_LOGITECH_EMAIL`.
   The password is prompted each time it is needed and is never saved.
   Tokens are kept at `~/.melodious/harmony_token.json` (mode `0600`) so
   later runs usually need no password.

`--list` shows the catalog matches for a maker/model without downloading.

## How it behaves

- Read-only, one device at a time, at the pace of the official app. Nothing
  is created, changed or deleted in your Logitech account.
- Credentials never leave your computer. The hub stays offline and never
  sees the sign-in; only the finished package (which carries no tokens)
  reaches it, through your browser.
- This uses Logitech's service with your own account. Logitech's terms
  govern your account; if they ever close this path, IRDB search and
  learning still work. Last verified against the live service 2026-10-22.
