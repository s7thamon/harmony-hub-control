# 10 Sync and publication

## 1. Resource manager (`LW/tasks/harmonywebservices/core/resourcemanager.lua`) [SRC]

- `index.json` maps a name to a **JSON-encoded string** `{etag, hetag, type, maxAge}`.
- It is loaded into **`indexCache` only in `init()`**: module load, sync abort or success,
  folder delete, and a put in mode ≠ 3 (`:204-209, 33`; `apihandler/resource.lua:415`).
- `getEtag`/`getHubEtag` read the cache. `getEtag` returns nil if the file is missing
  (`:260-280`).
- `saveIndexFile` mutates the cache and rewrites the **whole** `index.json`, so raw edits to
  `index.json` are ignored until `init()` and overwritten by the next save (`:126-135`).
- **`getResource` reads and decodes the file from disk on every call; only etags come from
  the cache** (`:427-462`).
- During a sync, all reads and writes go to `/data/tmp`.
- `hetag = tostring(math.random(100000, 999999999))` (`core/common.lua:283-285`): random, not
  content-derived. `etag` is opaque (the cloud ETag, or whatever the writer passes).
- `saveResource(type, etag, resource, name, maxAge, hetag)` keeps the old hetag when none is
  given (`:505-528`).

## 2. `proxy.resource?get`: two handlers

| Handler | When | Behaviour |
|---|---|---|
| **Stock** (`apihandler/resource.lua:32-220`) | cloud blocker **off** | `sus://` → firmware check; hub syncing → 202; `harmony://` or AutomationConfig → `isResourceMatch` = (hetag == index hetag) **and** (etag == index etag) → **304**, else 200 + the resource + the index hetag; a missing index entry → cloud |
| **Melodious override** (`MEL/payload/scripts/netservicestarter.lua:574-619`, registered `:841-843`) | blocker **on** (`/data/codex/cloud_blocker.conf` = `1`) | known names → `resMgr.getResource` → **always 200** with the current disk content and the cached etag/hetag; never 304; ignores the sync-in-progress 202. Missing `CD_<id>` → a deterministic empty record (`:554-572`). Unknown or `sus://` → 404/304 stubs. |

## 3. Touch side (`TLW/tasks/harmonywebservices/proxy/sync.lua`) [SRC]

- `getResourceListForHub` (`:1341-1434`): ActivityList, DeviceList,
  `MapList?excludeFunctionMaps=true`, Context, Settings, AutomationConfig, ProtocolList,
  InstallerInfo, CapabilityList (mode 3/4). **No FunctionList.**
- `getResourceFromHub` (`:1185-1270`):
  - 304 → copy the old file and update the etag;
  - 200 → save the served content (MapList, ActivityList, DeviceList and CapabilityList are
    re-read raw over `hot.1.data.resource`) with the hub's etag and hetag;
  - for `content://` URIs, anything other than 200/304 **aborts the whole sync (553)**.
- On commit: `resMgr.init()` (drops caches), `updateVersion()`, the `syncDone` subscriber,
  `populateHCButtonMaps()` (`LD/appscommon/harmony.lua:2940-2990`). Screens rebuild lazily
  when shown.
- The **content step** (`ContentUser`, `CD_<id>`) runs only in menu Sync and the stale-retry
  loop, for devices used in activities. Publish-triggered syncs pull resources only [HW].

## 4. What triggers the Touch

`LD/appscommon/harmony.lua:4268-4283` [SRC]: the Touch auto-resyncs when its local status is
`NO_SYNC`, the hub's `syncStatus == 0`, **`stateVersion` differs, and `configVersion` or
`contentVersion` differs**.

| Who bumps what | stateVersion | configVersion |
|---|---|---|
| Stock `processPutRequestInHub` (`resource.lua:373-378`) | no | yes → **doesn't trigger the Touch** |
| Cloud sync, automation `sendPutRequest` | yes | yes |
| **Melodious `publishLocalRevision`** (`MEL/payload/activity/codexactivity.lua:763-780`) | yes | yes, plus a notify → **triggers** [HW] |
| Activity status changes | yes | no → activity state only |
| Sequence status (`updateSequenceStatus`) | yes | no (and no notify) |

- The hub delivers the digest by notify (first LTCP client only) or answers the Touch's
  `statedigest?get` poll (on resume, and every 5 s while the activity popup is up).
- The Touch must be **awake** to receive a notify. It checks the digest on resume
  (`juniper/init.lua:1497-1504`).

## 5. Why a resource change can fail to reach the Touch

| Cause | Status |
|---|---|
| No publish (stock put; codexmqtt reload; a raw write whose flag codexmqtt consumed) | **the real gate with the blocker on** |
| Etag match → 304 | **only with the blocker off** |
| Touch asleep | caught up on wake |
| Hub syncing (202) / plugin refuses during a stock sync | retried later |
| Content step 404 → 553 abort | fixed by the empty-`CD_` guard (PR #54) |
| Raw edits to `index.json` | ignored until `init()` |

## 6. Melodious publish (`codexactivity.lua:763-780`)

`configVersion++`, `stateVersion++`, save the digest, broadcast `connect.stateDigest?notify`.
It is called after every successful plugin commit and after `reloadRequestedResources` (the
raw-write flag), but not after codexmqtt's reload (§11).

## 7. Engine reload (`LW/tasks/harmonyengine/main.lua:444-585`)

- `config_new` with a list of names → `loadResource(name)`.
- It is a no-op returning true if `/data/resources/ProtocolList.json` is missing
  (hard-coded).
- FunctionList has no branch.
- DeviceList also reloads ProtocolList.
- It always broadcasts `init_activity_engine`.
- **Loader errors aren't caught**, so the engine task dies (§06).

## 8. Runtime state (2026-10-25) [RT]

The Touch's MapList, DeviceList, ActivityList, CapabilityList and ContentUser are
byte-identical to the hub's. ProtocolList, Settings, Context and AutomationConfig are identical
after normalization. The Touch's `index.json` carries the hub's etags. SyncCounter: last sync
successful, no aborts.
