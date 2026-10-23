# Melodious for Android: Logitech catalog lookup

Status: plan for the owner's approval, 2026-10-22 (open decisions at the
end). No app code yet. The Phase 0 sign-in spike passed on the owner's
phone.

This brings the macOS app's catalog feature (`docs/DESKTOP_APP.md`, slices
2 and 3) to the Android app, one to one:

- **Sign in** to the user's own Logitech account, in Chrome, from the app.
- **Devices → a device → Import codes → Logitech catalog:** Sign in, Brand
  and Model fields with the model check, Search, a results list, Download,
  the preview (what this hub can take, plus every skipped command and why),
  Import to that device, and "Open a catalog package…" for the
  `harmony-catalog-*.json` files made by `tools/catalog/harmony_catalog.py`.
- **Settings:** a Logitech account row (signed in or not; Sign in, Sign
  out), and the OAuth client_id override.

Limits:
- The hub doesn't change: no new routes, no C, no web UI change, no
  `codex_webui` rebuild. The app uses `/export/protocols` and
  `/api/catalog-import`, which the hub already serves.
- Logitech tokens stay in the app, encrypted with the Android Keystore.
  The hub only receives the same `/api/catalog-import` rows the web UI and
  the macOS app send.
- Nothing is created or changed in the Logitech account.
- No WebView. Google blocks its sign-in in embedded WebViews
  (`disallowed_useragent`), and spoofing the user agent is not an option.
- No system URL handler. The app declares **no intent filter** for
  Logitech's `com.logitech.harmony` scheme. Chrome's Auth Tab hands the
  redirect back to the app that opened it. The existing `melodious://hub`
  deep link stays as it is.
- Out of scope, as on the Mac: IRDB ("Find codes"), RemoteCentral, Type a
  code and Flipper files. Android's Paste path is unchanged.

## Sign-in: Phase 0 result (2026-10-22)

A throwaway spike app (outside the repo, never committed) ran the full
sign-in on the owner's phone with Google login. Its log held only presence
flags, never a token, code or AccountId.

| Step | Result |
| --- | --- |
| Browsers | The default browser is Firefox 158: `CustomTabsClient.isAuthTabSupported(org.mozilla.firefox)` is false. Chrome is installed and returns true. The spike launched Chrome explicitly (`setPackage`). |
| Auth Tab (`androidx.browser:browser:1.9.0`, Chrome 137+) | `AuthTabIntent.registerActivityResultLauncher(activity, callback)`, then `AuthTabIntent.Builder().build().launch(launcher, authorizeUrl, "com.logitech.harmony")` |
| Google sign-in | Worked end to end (owner-confirmed). No "This browser or app may not be secure" block. |
| Redirect | `AuthTabIntent.RESULT_OK`; `resultUri` scheme `com.logitech.harmony`, host `lidsoauth`, query keys `[code, state]`; state matched. No intent filter declared. |
| Code exchange (PKCE, form-encoded) | HTTP 200: access, id and refresh tokens |
| Harmony `signin` | HTTP 200 with an AccountId |
| Refresh grant | HTTP 200, new access token |

What it showed:
- Support must not depend on the default browser. The app looks for a
  browser with Auth Tab support itself (see "Sign-in").
- The redirect comes back through the activity-result callback. No
  manifest entry claims Logitech's scheme.

Not verified:
- **Logitech email and password login**, as on the Mac: no such account
  was at hand. It uses the same page, redirect and token endpoint.
- **The official Harmony app installed** (`com.logitech.harmonyhub`, which
  may register the same scheme). It wasn't on the phone. Auth Tab returns
  the redirect to the calling app, so no clash is expected, but it hasn't
  been run.
- **Other Auth Tab browsers** (for example Edge or Samsung Internet). Only
  Chrome was run.

## Architecture

```
┌─────────────────────────── Melodious (app.melodious) ───────────────────────────┐
│ app module (Android)                                                            │
│  ├─ MainActivity        registers the Auth Tab result launcher (onCreate)       │
│  ├─ AuthTabSignIn       picks a browser with Auth Tab support, launches,        │
│  │                      hands the result URI back; no intent filter             │
│  ├─ LogitechTokenStore  AES-GCM key in the Android Keystore; ciphertext in      │
│  │                      its own private prefs file; nothing stored on failure   │
│  ├─ HubPrefs            + client_id override (not secret)                       │
│  ├─ MelodiousViewModel  catalog account + tab state, handlers                   │
│  └─ UI                  Import sheet tabs (Logitech catalog | Paste),           │
│                         Settings row, client_id field, file picker (SAF)        │
│ core-protocol (pure Kotlin/JVM, unit-tested on the Mac)                         │
│  ├─ catalog/            OAuth + PKCE, strict callback, Harmony signin,          │
│  │                      discovery, model check, search, download, package,      │
│  │                      catalogRows; one request at a time                      │
│  └─ rest/               + getHubProtocolNames, importCatalogCommands            │
└─────────────────────────────────────────────────────────────────────────────────┘
        │ LAN, plain HTTP (unchanged)                  │ HTTPS
        ▼                                              ▼
   codex_webui :8080 on the hub         accounts.logi.com, *.myharmony.com
                                        (and Chrome, for the sign-in page only)
```

### Module split

Everything that isn't Android goes in `core-protocol`, which is already a
pure JVM library with JUnit tests. The app module keeps only what needs
the Android framework.

| `core-protocol` (`app.melodious.protocol.catalog`) | `app` (`app.melodious`) |
| --- | --- |
| `CatalogOAuth`: PKCE, authorize URL, `parseCallback`, exchange and refresh forms, `parseTokens` | `system/AuthTabSignIn`: browser choice, launch, result hand-back |
| `CatalogHttp`: OkHttp transport with the endpoint allowlist, no redirects, a scoped cookie jar | `system/LogitechTokenStore`: Keystore encryption behind `TokenStore` |
| `CatalogClient`: Harmony signin, discovery and host swap, `checkModel`, search, `GetGlobalDevices`, `GetGlobalLanguageCommands` | `MelodiousViewModel`: catalog state and handlers |
| `CatalogService`: `ensureSession`, one refresh-and-retry, serialized calls, `status`/`signIn`/`signOut`/`checkModel`/`search`/`download` | `ui/devices/CatalogImportTab.kt`, the Import sheet tabs, the Settings row and the client_id field |
| `CatalogPackage`: 0.2.0 package, `redact`, `isCatalogPackage` | |
| `CatalogImport`: `catalogRows`, `hubProtocolNames`, `describeCatalogRows` | |
| Interfaces: `TokenStore`, `SignInLauncher` (implemented in `app`, faked in tests) | |

### Sign-in with Chrome's Auth Tab

1. The user taps **Sign in** (on the catalog tab or in Settings).
2. `CatalogService.signIn()` runs `ensureSession`: saved tokens first, then
   one silent refresh, and only then the browser.
3. For the browser, `AuthTabSignIn` picks the package:
   - Chrome (`com.android.chrome`), if `isAuthTabSupported` says yes. It's
     the one browser that has been run.
   - Otherwise the default Custom Tabs browser, if it supports Auth Tab
     (not verified; see above).
   - Otherwise nothing is launched, and the app says sign-in needs Chrome
     (decision 2). "Open a catalog package…" still works.

   A plain Custom Tab is never used as a fallback. Without an intent
   filter, its redirect would go nowhere, or to Logitech's own app if that
   is installed.
4. `AuthTabIntent.launch(launcher, authorizeUrl, "com.logitech.harmony")`,
   with the chosen package set on the intent. The launcher is registered
   in `MainActivity.onCreate`. A small app-scoped holder passes it, and the
   pending result, between the activity and the ViewModel.
5. The result:
   - `RESULT_OK`: `resultUri` goes through the strict `parseCallback`
     (below), then the code exchange, the encrypted save and Harmony
     signin.
   - `RESULT_CANCELED` (the user backed out): signed out quietly, with no
     error and no retry loop, as on the Mac.
   - `RESULT_VERIFICATION_FAILED` and `RESULT_VERIFICATION_TIMED_OUT` (these
     only apply to `https` redirects): an error message, signed out.
6. The PKCE verifier and state live only in memory, for one attempt. If
   Android ends the app's process while Chrome is open, the result that
   comes back has no matching attempt. It's refused with "Sign-in was
   interrupted; sign in again". Nothing is written to disk before the
   exchange succeeds.

The callback check is the Mac's strict one:
- scheme `com.logitech.harmony`;
- host `lidsoauth`;
- no path, fragment or user info;
- exactly one `code` and one `state`, and the state must match this
  attempt;
- `error=` means "Logitech refused the sign-in; sign in again";
- bare strings and logi.com pages are refused.

### Catalog client (`core-protocol`)

A Kotlin port of `desktop/src/catalog/{oauth,client}.js`, which ports
`tools/catalog/harmony_catalog.py`. Same endpoints, bodies and wording:

| Step | Call |
| --- | --- |
| PKCE | 48 random bytes (`SecureRandom`) → base64url verifier; S256 challenge; 24-byte state |
| Authorize | `accounts.logi.com/identity/oauth2/authorize`, `response_type=code`, `scope=openid`, `redirect_uri=com.logitech.harmony://lidsoauth`, the client_id |
| Code exchange, refresh | `POST accounts.logi.com/identity/oauth2/token`, form-encoded. A refresh answer without a new refresh or id token keeps the old one. |
| Harmony session | `POST lb-svcs…/CompositeSecurityServices/Security.svc/json2/signin` with `{access_token, id_token}` and the bearer → `AccountId` (kept in memory only; a locked account is refused) |
| Operation table | `POST cf-svcs…/Discovery/Discovery.svc/json/GetJsonOperations` `{"clientTypeId":"Redbull 1.0"}`, header `x-logitech-api-version: 1`; cached for the session; `svcs`/`cf-svcs` addresses moved to `lb-svcs`, `json` → `json2` where the Mac does it; `GetGlobalLanguageCommands` falls back to the `GetCommands` sibling's address |
| Model check (anonymous) | `GET svcs.myharmony.com/HarmonyPlatform/DeviceManager.svc/json2/SearchDevice/manf/<m>/model/<n>/iface/IR` → found or not, and the canonical spelling. No bearer, no cookies. |
| Search | `SearchGlobalDevices` (json2) `{manufacturer, modelNumber, deviceType:0, searchType:2, maxResults:50}`. Each match becomes `{id (Id-), manufacturer, model (DeviceModel or Model), displayText (DisplayText or SelectedText), deviceType (the Mac's label table), description}`. |
| Download | `GetGlobalDevices([id])` (exactly one device, with that id), then `GetGlobalLanguageCommands({globalLanguageVersionId:{Value: DefaultGlobalLanguageVersionId}})` |
| Package | `schema_version` `0.2.0`, `source` `logitech-catalog-via-melodious-android`, `query`, and `resources` (`search_result`, `selected_match`, `global_device`, `global_language_commands`), each passed through the helper's `redact` rule (keys matching authorization, cookie, password, secret, access/refresh/id/auth token or account id) |

Transport, as on the Mac:
- Its own `OkHttpClient`, separate from the hub client, with a 30 s call
  timeout.
- HTTPS only. Redirects are not followed (`followRedirects(false)`,
  `followSslRedirects(false)`); a 3xx is an error.
- An allowlist of exactly the Mac's endpoints: the token URL, discovery,
  Harmony signin, `SearchDevice/manf/…` (GET only), and the three
  `lb-svcs…/DeviceManager.svc/` operations. Anything else is refused
  before it's sent.
- `Accept: application/json` and the Mac's `User-Agent`
  (`melodious-catalog/1.0`).
- An in-memory cookie jar with the Mac's rules: only `myharmony.com`
  cookies, never sent on a GET (so the model check stays anonymous),
  never written to disk, and cleared on sign-out.
- JSON and form bodies are sent with a fixed `Content-Length`.
- Coroutine cancellation cancels the OkHttp call.

Session handling follows the Mac's `createCatalogService`:
- All catalog calls run one at a time (a `Mutex`), and sign-in is
  single-flight.
- A refused catalog call (HTTP 400 "Access is denied") gets one refresh
  and one retry, never a loop. If that fails, the tokens are deleted and
  the message is "Logitech refused the catalog session; sign in again".
- The service checks its inputs: trimmed strings of 1–64 characters, and a
  positive integer id.
- Errors are plain messages the tab can show, for example "Sign in to
  Logitech first" or "No catalog device matches Sony STR-DG7".

Etiquette, unchanged from the Mac and the helper:
- Read-only. One request at a time, one device per download.
- Search and Download run only when the user taps.
- The model check runs only after a 600 ms pause in typing, at most one
  request in flight, and never for the values pre-filled when the tab
  opens.
- Nothing runs in the background or on a timer. Opening the sheet or the
  tab makes no network request.

### Token storage (Android Keystore)

- `LogitechTokenStore` implements `TokenStore { load(); save(tokens);
  clear() }`.
- Key: AES-256-GCM, generated in `AndroidKeyStore` under one alias,
  encrypt/decrypt only, random IV per write, no user authentication
  (so a refresh doesn't need the lock screen). The key can't leave the
  device.
- Stored: `{access_token, id_token, refresh_token}` as JSON, encrypted, in
  its own private SharedPreferences file (`melodious_logitech`), as IV +
  ciphertext in base64. Nothing else: never the AccountId, cookies or
  codes. The hub settings file (`melodious_prefs`) doesn't change.
- **If the Keystore fails**, on key creation or on encrypt, nothing is
  stored and any old blob is deleted. The tokens last only while the app
  runs, as on the Mac when `safeStorage` is unavailable.
- **If a blob can't be decrypted** (for example after a device transfer,
  where the key doesn't follow), it is deleted and the user is signed out.
- Sign out deletes the blob and the in-memory tokens, and clears the
  cookies and the operation cache.
- `android:allowBackup="false"` is already set. A device-to-device
  transfer could copy the blob, but not the Keystore key, so it's
  useless there and gets deleted on first read.
- No new dependency. `androidx.security:security-crypto`
  (`EncryptedSharedPreferences`) is deprecated, so it isn't used.
- Tokens never reach logs, the hub, packages or the UI. The app has no
  HTTP logging interceptor and adds none.

The hub's Basic auth header is still stored in plain `HubPrefs`, as it is
today. Moving it under the same Keystore key is a small follow-up, not part
of this plan unless the owner adds it.

### Talking to the hub

Two calls are added to `CodexHubRestClient`. Both use the saved endpoint
and Basic header, as every hub call does:
- `getHubProtocolNames(endpoint)`: `GET /export/protocols` →
  `Protocols[].Name`, as `hubProtocolNames` does in the web UI. If it
  can't be read, the preview says so ("…the hub's protocol list couldn't
  be read, so no KeyCode can be checked yet") and imports nothing.
- `importCatalogCommands(endpoint, deviceId, rows)`: `POST
  /api/catalog-import` with JSON `{deviceId, commands:[{name, keycode, raw,
  protocol}]}`, the same body the web sends. It goes through the existing
  `postJson`, whose OkHttp body has a fixed `Content-Length`; `codex_webui`
  can't read chunked bodies.
  - The hub answers `{ok, message}`: it backs up DeviceList, stores each
    KeyCode with the protocol its `G:<name>:` prefix names, skips names the
    device already has, and refuses protocols it lacks.
  - A 404 shows "Your hub's Melodious software is older than this app;
    update the hub". Any other error shows the hub's message.
  - Afterwards the app reloads the config, closes the sheet and shows
    "Imported to <device>. <hub message>".

## Screens

### Import codes sheet

Today `ImportSheet` (in `DevicesScreen.kt`) is Paste only. It gets the web
sheet's tab row, with only the tabs Android has, in the web's order:
**Logitech catalog | Paste**. The sheet opens on the first tab, as the web
does.

- **Paste:** today's content, unchanged (the text, the field and Import
  through `importIrPayload`). It's moved into its own composable; no
  behaviour change.
- **Logitech catalog,** top to bottom, as on the Mac:
  1. The intro: "Use the code set from Logitech's own catalog for
     <maker> <model>. Only commands whose IR protocol this hub already has
     are imported; the rest are listed below, not dropped silently."
  2. Account row: "Signed in to Logitech" with Sign out, or "Logitech
     account" with Sign in.
  3. Brand and Model fields (64 characters at most), pre-filled from the
     device's manufacturer and model. Under Model, the check result:
     "Logitech knows this as STR-DG720" or "Not found under that name".
  4. **Search Logitech catalog**, then the results: display text, then
     device type and description, with a Download button on each row.
  5. The preview, as the web builds it:
     - the summary line from `describeCatalogRows` (importable count,
       protocols, skipped count, protocols missing on the hub);
     - the first 24 importable commands with their protocol;
     - **every** skipped command with its reason, for example
       "protocol “RC6 Mode 0” is not on this hub".
  6. **Import N commands to <device>**.
  7. **Open a catalog package…** always at the bottom, signed in or not,
     and with or without Chrome.
  8. The hint under it: "Or open a harmony-catalog-*.json file from
     tools/catalog/harmony_catalog.py. Your Logitech sign-in stays on this
     phone; the hub never sees it."

The model check is in the composable: a `LaunchedEffect` keyed on the two
fields. It does nothing while they equal the pre-filled values or either is
blank. Otherwise it waits 600 ms, then asks the ViewModel. A newer edit
cancels the wait. The ViewModel runs at most one check at a time and drops
a result if the fields have changed since. Closing the sheet cancels it all.

"Open a catalog package…" uses the Storage Access Framework
(`ActivityResultContracts.OpenDocument`, JSON and text types), so it needs
no storage permission. It reads at most 4 MB (the Sony package is about
30 KB), parses it, checks `isCatalogPackage`, and shows the same preview.
Errors use the web's wording: "<file> is not a catalog package (not
JSON)" and "<file> is not a Logitech catalog package from
tools/catalog/harmony_catalog.py."

The tab's state (matches, preview, status line) lives in the ViewModel, so
it survives the sheet being redrawn. It's cleared when the sheet closes.
The account state is shared with Settings.

### Settings

The Mac's Settings page, section by section, and where it is on Android:

| Mac Settings | Android |
| --- | --- |
| Current hub | Settings tab → **Hub** row (exists) |
| Hubs on this network | Settings → Hub page (exists; SSDP plus the existing /24 probe) |
| Enter address | Settings → Hub page (exists) |
| Hub sign-in | Settings → Hub page, "My hub needs a sign-in" (exists) |
| Logitech account | **New:** a "Logitech account" row on the Settings tab, under Hub: "Signed in to Logitech" (Sign out) or "Not signed in · used only to search and download device codes from Logitech's catalog" (Sign in) |
| Advanced: OAuth client_id | **New**, per decision 4: a "Logitech catalog" section at the bottom of Settings → Advanced, with a field and Save. "Leave empty to use Logitech's public desktop client_id (9d88df5e-…)." |

The client_id override:
- It's stored in `HubPrefs` (it isn't a secret). Empty means the built-in
  value.
- It's checked like the Mac's: trimmed, 128 characters at most, no spaces
  or control characters.
- Changing it doesn't sign the user out. It applies to the next sign-in or
  refresh.

## Code ported or reused

| What | From |
| --- | --- |
| OAuth, PKCE, callback check, exchange, refresh | `desktop/src/catalog/oauth.js` |
| Harmony signin, discovery, host swap, model check, search, download, package, `redact`, session and retry, serialization | `desktop/src/catalog/client.js` (which follows `tools/catalog/harmony_catalog.py`) |
| `catalogRows`, `isCatalogPackage`, `hubProtocolNames`, `describeCatalogRows` and the skip reasons | `tools/webui-sim/public/js/logitech-catalog.js` |
| Tab layout, wording, model-check rules, error handling, the 404 message | `tools/webui-sim/public/js/views/device-import.js` (`previewCatalogPackage`, `doCatalogSignIn`, `doCatalogSignOut`, `doCatalogSearch`, `doCatalogDownload`, `checkCatalogModel`, `renderCatalogAccount`, `renderCatalogResults`, `renderCatalogPreview`, `doCatalogImport`) |
| Settings wording | `desktop/src/connect/connect.js` (Logitech account, Advanced) |
| Test data | `desktop/test/fixtures/catalog-fixtures.json` (public catalog fields only, no credentials), read in place by the Kotlin tests so both ports test the same data |
| Hub calls | `CodexHubRestClient.postJson` and `getRawText`; `importIrPayload` as the model for busy state and messages |

The Kotlin names follow the JS ones (`catalogSignIn`, `catalogSearch`,
`catalogDownload`, `checkCatalogModel`, `catalogImport`), so the two ports
can be read side by side.

## Exact changes

By slice (see "Slices"). No file outside `Android/` and the docs changes.

**Slice 1: build and sign-in**
- `Android/gradle/libs.versions.toml`: `agp` 8.7.2 → 8.9.1; add
  `androidx-browser` 1.9.0.
- `Android/gradle/wrapper/gradle-wrapper.properties`: Gradle 8.9 →
  8.11.1 (the minimum for AGP 8.9.1).
- `Android/app/build.gradle.kts`: `compileSdk` 35 → 36 (`minSdk` 26 and
  `targetSdk` 35 stay); the browser dependency; one packaging exclude,
  `/META-INF/versions/9/OSGI-INF/MANIFEST.MF`. Without it the build fails:
  the browser library brings `org.jspecify:jspecify`, whose copy of that
  file clashes with JSch's.
- `Android/deploy_to_phone.sh`: check for and install
  `platforms;android-36` instead of 35.
- `Android/app/src/main/AndroidManifest.xml`: **only** a `<queries>` block
  with the `android.support.customtabs.action.CustomTabsService` intent.
  Since Android 11, the app can't see which browsers support Auth Tab
  without it. It grants no permission, exports nothing and claims no
  scheme. If Chrome isn't detected with that alone, the slice adds
  `<package android:name="com.android.chrome"/>` to the same block, and
  nothing else.
- `core-protocol`: `catalog/CatalogOAuth.kt`, `CatalogHttp.kt`,
  `CatalogService.kt` (status, sign-in, sign-out, `ensureSession`, Harmony
  signin), `TokenStore.kt`, `SignInLauncher.kt`, and their tests.
- `app`: `system/AuthTabSignIn.kt`, `system/LogitechTokenStore.kt`, the
  launcher registration in `MainActivity.kt`, the account state and
  handlers in `MelodiousViewModel.kt`, the Settings row in
  `SettingsScreen.kt`, the client_id section in `AdvancedScreens.kt`, and
  `logitechClientId` in `HubPrefs.kt`.

**Slice 2: catalog client (no UI)**
- `core-protocol`: `catalog/CatalogClient.kt` (discovery, operations,
  model check, search, download), `CatalogPackage.kt`, `CatalogImport.kt`,
  the rest of `CatalogService.kt` (check, search, download, retry), and
  their tests.
- `rest/CodexHubRestClient.kt`: `getHubProtocolNames` and
  `importCatalogCommands`, with tests.

**Slice 3: the tab**
- `app/ui/devices/CatalogImportTab.kt` (new), the tab row in
  `ImportSheet` (`DevicesScreen.kt`), the Paste content moved into its own
  composable unchanged, the catalog tab state and handlers in
  `MelodiousViewModel.kt`, and the file picker.
- The app version, per decision 3.
- `Android/README.md` (it says the app needs no internet; the catalog is
  the optional, user-started exception), the README's Android section,
  and this file's status. Screenshots with personal data masked.

**Slice 4: cross-checks**
- Opt-in JVM integration tests in `core-protocol`, run against the
  webui-sim and hub-emu (see "Test plan"). Any fixes they turn up.

## Security model

**Sign-in:**
- Logitech's page runs in Chrome's Auth Tab, not in the app. The app never
  sees the password or the Google session. Chrome's cookies stay in
  Chrome.
- The app accepts a result only from its own launcher, for its own pending
  attempt, through the strict `parseCallback`. Nothing else in the app can
  deliver a code: there is no intent filter and no exported component.
- PKCE protects the code: a code that went elsewhere can't be exchanged
  without the verifier, which never leaves the app's memory.

**Secrets:**
- Logitech tokens are encrypted with a Keystore key, or not stored at all
  (see "Token storage").
- The AccountId and cookies are kept in memory only.
- Nothing personal is built in: no account, email, hub address, hub ID or
  token. The only fixed value is Logitech's public desktop client_id
  `9d88df5e-7edf-4288-8634-26721cbe7add`, which the client_id setting
  overrides.

**What reaches the hub:** what the app sends today, plus `GET
/export/protocols` and the `/api/catalog-import` body (`deviceId` and the
command rows). Never a Logitech token.

**What reaches Logitech:** the sign-in (in Chrome), the token calls,
Harmony signin, discovery, the anonymous model check, search, and the one
device downloaded. Nothing about the hub: no hub ID, address, device list
or codes.

**No background traffic:** no telemetry, no update check, no request on a
timer. The only network calls are the ones listed above, each started by
a tap or, for the model check, by typing.

## Build upgrade (decision 1)

`androidx.browser` 1.9.0's AAR metadata says `minCompileSdk=36` and
`minAndroidGradlePluginVersion=8.9.1`. Its manifest declares no
permission, no component and no scheme. Its runtime dependencies
(`activity` 1.9.0, `core` 1.10.0) are older than what Melodious already
uses (1.9.3, 1.15.0), so nothing else is upgraded.

**Verified on the Mac (2026-10-22), in a scratch copy of `Android/`
outside the repo:**
- with AGP 8.9.1, Gradle 8.11.1, compileSdk 36, the browser dependency
  and the packaging exclude, `./gradlew --offline :core-protocol:test
  :app:assembleDebug` passes: 13/13 tests, debug APK built;
- without the exclude, `:app:mergeDebugJavaResource` fails (the JSpecify
  and JSch clash above);
- the merged manifest is identical to `main`'s APK apart from resource-ID
  numbering (no new permission, component, intent filter or query), and
  the APK reports `compileSdkVersion 36`, `targetSdkVersion 35`;
- the debug APK grows from 17,815,871 to 17,871,738 bytes (+55,867).

The options for `androidx.browser`:
- **1.9.0-alpha01** is the only release with Auth Tab that compiles at SDK
  35 (`minCompileSdk=34`). It lacks `CustomTabsClient.isAuthTabSupported`,
  so the app couldn't check for support before launching.
- **alpha02 through 1.9.0** all need SDK 36 and AGP 8.9.1.
- **1.10.0** also exists. It needs the same, and also pulls
  `kotlin-stdlib` 2.1.20, newer than the project's Kotlin 2.0.21. The
  plan stays on 1.9.0, the version the spike ran.

## Test plan

On the Mac (automated, `./gradlew --offline :core-protocol:test
:app:assembleDebug`):
- **OAuth:**
  - PKCE lengths, alphabet and S256;
  - authorize URL fields;
  - `parseCallback`: valid; wrong, missing or repeated state; repeated or
    missing code; `error=`; a bare string; a logi.com page; the wrong
    scheme or host; a path, fragment or user info;
  - the exchange and refresh form bodies;
  - `parseTokens`, including a refresh that keeps the old refresh token.
- **Session:**
  - `ensureSession` order with fakes: saved, then refresh, then one
    prompt, never a loop;
  - a cancelled sign-in leaves the user signed out with no error;
  - "Access is denied": exactly one refresh and retry, then the tokens
    are cleared;
  - calls never overlap (a fake transport counts concurrent requests).
- **Catalog**, against the shared fixtures: operation parsing, the host
  swaps, the `GetCommands` fallback, search formatting (`Id-`,
  `DeviceModel`, `DisplayText`, device-type labels), download, the
  package (schema, source, redaction), and `redact` alone.
- **Transport:**
  - the allowlist refuses other URLs, `http:` and user info;
  - redirects are not followed;
  - no cookies on GET, and the cookie domain rules hold.
- **`catalogRows` and friends:** the cases of
  `tools/webui-sim/test/logitech-catalog.test.mjs`, with the same inputs,
  expected rows and reason strings.
- **Hub client:**
  - `importCatalogCommands` sends `Content-Length` and no
    `Transfer-Encoding: chunked`, checked with a plain `ServerSocket` in
    the test (no new test dependency);
  - a 404 maps to the older-hub message;
  - `getHubProtocolNames` parsing.
- **Token store logic** with a fake cipher: nothing is stored when
  encryption fails, an undecryptable blob is deleted, and sign-out clears
  it. The real Keystore runs only on a device (owner check).
- **Repo baselines unchanged** (no web, desktop or hub code changes): sim
  443, shell smoke all passed, reconciliation 12 failures (the same list
  as `main`), installer smoke 43 OK, desktop units 38, hygiene ok.

Against the webui-sim and hub-emu (slice 4, opt-in, like
`desktop/test/hub-emu.mjs`):
- The Kotlin hub client reads `/export/protocols` and posts
  `/api/catalog-import` with fixture rows. The sim and hub-emu (the real
  `codex_webui` under qemu) both store the 4 KeyCodes byte-identical with
  ProtocolId 17/18, and refuse the missing protocol (400). hub-emu is the
  check that counts for request framing; the Node sim accepts chunked
  bodies and would hide a problem.
- These check the import gate, not IR playback.

On the phone (the owner runs these):
- **Sign-in:**
  - Google login from the catalog tab and from Settings;
  - close and reopen the app: still signed in;
  - Sign out;
  - back out of the Auth Tab: signed out, no error loop;
  - with Firefox as the default browser, Chrome is used;
  - optionally, with Chrome disabled: the "needs Chrome" message, and the
    file picker still works;
  - email and password login, when an account is at hand (until then:
    not verified).
- **Model check:** typing changes the hint after a pause. The pre-filled
  values never trigger it.
- **Catalog:** Sony / STR-DG7, pick STR-DG720: 55 commands, Sony 15 Bit ×44
  and Sony 20 Bit ×11. Import into the IR lab device (`Temporary IR Test`),
  then the read-only read-back used for the Mac: KeyCodes byte-identical,
  ProtocolId 17/18, no Raw. No IR sent unless the owner chooses to test.
- **File:** open a helper package through "Open a catalog package…"; the
  same preview appears.

Reporting says, for each item, whether it was verified on the Mac,
verified on hub-emu, verified on the hub, or only observed by the owner.

## Slices (one PR each, from `main`, never stacked)

1. **Build and sign-in:**
   - the build upgrade and `<queries>`;
   - OAuth, PKCE, callback, exchange, refresh and Harmony signin in
     `core-protocol`;
   - the Keystore store and the Auth Tab launcher;
   - the Settings account row and the client_id field.

   The owner checks the sign-in on the phone. This is where "the Auth Tab
   flow looks right in the app" gets confirmed, so it carries the OAuth
   core the brief listed under slice 2. Without it, nothing can be signed
   in.
2. **Catalog client:** discovery, the model check, search, download, the
   package and `catalogRows` in `core-protocol`, plus the two hub calls.
   No UI. Unit tests against the shared fixtures.
3. **The tab:** the Import sheet tabs, the catalog tab, the file picker,
   Import, the version (decision 3) and the docs. The owner checks
   Sony STR-DG720 → 55 commands and imports into the lab device.
4. **Cross-checks:** the webui-sim and hub-emu integration tests, and any
   fixes.

Each slice carries its own unit tests. Each PR has its test output and
the APK size change; where screens change, it has screenshots with
personal data masked. The brief also listed new web/desktop sim tests in
slice 4. No web or desktop code changes in this plan, so instead their
baselines must stay identical.

## Open decisions for the owner

1. **Build upgrade.**
   - (a) **Recommended:** AGP 8.9.1, Gradle 8.11.1, compileSdk 36,
     `androidx.browser` 1.9.0 and the one packaging exclude. minSdk and
     targetSdk stay. Verified building on the Mac (above).
   - (b) Stay at compileSdk 35 with `browser` 1.9.0-alpha01, the only Auth
     Tab release that compiles there. It's an early alpha without
     `isAuthTabSupported`, so the app couldn't check for support first.
     Not recommended.
   - (c) No library: build Chrome's Auth Tab intent by hand. That is
     undocumented wire format, with no support check, and it returns
     `RESULT_CANCELED` on browsers without Auth Tab. Not recommended.
2. **No browser with Auth Tab** (Chrome older than 137, or not installed,
   and no other Auth Tab browser).
   - (a) **Recommended:** say "Logitech sign-in needs Chrome 137 or later.
     Install or update Chrome, or open a catalog package made on a
     computer", and keep "Open a catalog package…" working. This matches
     the Mac app needing its own browser engine. On the owner's phone,
     Chrome is installed.
   - (b) Fall back to a plain Custom Tab. That needs an intent filter for
     `com.logitech.harmony`, which can clash with Logitech's Harmony app if
     it is installed, and is the kind of system handler the owner
     declined before. Only with explicit approval.
3. **Android app version.** The app is `1.0.0` (versionCode 1), published
   with the hub as Melodious 1.0.0. The macOS app with this feature is
   1.1.0.
   - (a) **Recommended:** `1.1.0`, versionCode 2, set in slice 3 (the one
     that ships the feature), signed with the same release key so it
     installs over 1.0.0.
   - (b) Stay at 1.0.0 / 1.
4. **Where the client_id override goes.**
   - (a) **Recommended:** a "Logitech catalog" section at the bottom of
     Settings → Advanced, like the Mac's Advanced section.
   - (b) On the catalog tab.
   - (c) Not at all.

## Risks

- Google could start blocking sign-in in Chrome's Auth Tab. That's
  unlikely, because it is Chrome itself. Logitech could retire the catalog
  services or the desktop client_id; the client_id setting covers the
  second, and Paste and the file picker remain.
- Auth Tab needs Chrome 137 or later. Phones without it get the
  "needs Chrome" message (decision 2).
- The protocol limit: catalog codes import only if the hub's ProtocolList
  already has their protocol. The tab shows every skipped code and why.
  It doesn't fix the limit (a separate item, for later).
- The build upgrade touches every Android build. Slice 1 runs the full
  test and assemble, and the owner installs the result before anything
  else lands on top.
