# P07 Validator hardening

Status: Proposed · Tier T2 · Area: `codexactivity.lua` `validateGraph`, web `validateMapList` / `touch-model.js`, Android (new) · Depends on: — · Blocks: P14, P18

## Problem

The hub validator protects the stock loader from crashes, but it lets through graphs that
load and then silently do nothing on the remote. Android has no validator at all.

## Evidence

Current coverage (corpus §14; `codexactivity.lua:342-592`):
- **Checked:**
  - shapes;
  - activity, device and role references;
  - slot uniqueness in activity maps;
  - sequence existence and step references;
  - long- and double-press device references;
  - exactly one `ActivityFunctionMap`.
- **Not checked anywhere:**
  - command names existing on the device;
  - duplicate hard `ButtonKey`s in a map;
  - `ButtonId` and map ID uniqueness (only the advanced editor);
  - `IndexInMenu` being a **JSON number** (a string never matches on the hub,
    `userconfigreader.lua:856-857` vs `activity.lua:394`);
  - map identifiers having the `16417` prefix for Touch maps;
  - gesture targets having a device screen with the command (corpus §02);
  - `EnterActions`/`LeaveActions` references;
  - an IP device's command in a non-power `LeaveAction` (engine drops it, P14);
  - a missing `Order` in a sequence step (throws in the stock loader,
    `userconfigreader.lua:676`).

## Goal / Non-goals

- **Goal:** reject what crashes or can never work; warn about what silently degrades. Keep
  the hub and the web validator identical in behaviour.
- **Non-goal:** validating Logitech-authored oddities that work, such as device-map slot
  collisions across FGTs in Logitech maps. Those stay allowed, and warn only for hub-made
  maps.

## Design

Add a **severity** to validation results: `error` refuses the save; `warning` is returned
in the reply and shown by the editor.

| Rule | Severity |
|---|---|
| `IndexInMenu` not a JSON number ≥ 0 | error (today: "non-negative integer"; make it number-typed) |
| Sequence step without numeric `Order` | error |
| Duplicate `ButtonId` across MapList; duplicate `ButtonMapId-`; duplicate `ButtonMapIdentifier` | error |
| Duplicate hard `ButtonKey` within one map | error (the later one shadows the earlier) |
| Command action whose `CommandName` doesn't exist on `DeviceId-` (case-insensitive, as the engine lower-cases) | warning; **error** for maps the save is changing |
| Activity without a `16417Activity` map on a hub that has any 16417 map | warning |
| Gesture `ButtonCommandAction` whose device has no `16417Device` map, or whose map has no button for the command (match like the Touch: `FunctionId-` > 0, else `CommandName`/`ButtonKey`) | warning |
| Gesture resolving to a hard key that isn't also a hard key in the activity map (the Touch gate drops it) | warning |
| Hub-made device map with a duplicate slot | warning |
| IP (transport 64) command in a non-power `LeaveActions`, or in a `ChannelActivityAction`, or an IP device in a keyboard/channel role | warning (P14 may promote this to error) |
| `ButtonClientAction` other than the known Touch ones (`Numpad`, `PLAY_PAUSE_TOGGLE`) | warning |
| `EnterActions`/`LeaveActions` device references | error |

## Work breakdown

1. `codexactivity.lua`: refactor `validateGraph` to collect `{severity, path, message}`.
   Errors fail as today; warnings are included in the reply.
2. Web `touch-model.js` / `validateMapList`: the same rules and messages. The editor shows
   warnings after save.
3. Android: port the validator, sharing the rule vectors.
4. Fixtures: extend `tools/webui-sim/fixtures/touch-maplist.json` with one case per rule.
5. Docs: `docs/TOUCH_EDITOR.md` "Validation".

## Local tests

- `codexactivity-validate-test.lua` and `touch-map-validation.test.mjs` run the **same**
  fixture file and must agree rule for rule (that pattern already exists; extend it).
- Run the stock-reader check over the new fixtures: every "error" shape either throws in the
  stock loader or is misread.
- Live-data structural check: run the validator over the private snapshot locally (never
  commit it). Expected: 0 errors, and warnings only for Logitech-made patterns that are
  explicitly allowed.

## Hardware gate

- None (validation only). If a rule is promoted from warning to error, check with the owner
  that no current activity would be refused (run it over the hub's resources read-only
  first).

## Risks & rollback

- A new error could block saving an existing household activity. Mitigation: run over the
  live resources read-only before release, and start every new rule as a warning for one
  release if in doubt.

## Definition of done

- The hub and web agree on the shared fixtures; Android has the same validator; the docs are
  updated.

## Open questions

- Should warnings block the Touch editor's Save button until acknowledged? Recommendation: no.
  Show them, and don't block.

## Decisions

—
