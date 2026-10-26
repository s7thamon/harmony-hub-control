# P05 One key-alias table and one matching rule

Status: Proposed · Tier T2 · Area: Lua, C, web JS, Kotlin · Depends on: — · Blocks: P06, P13

## Problem

Four generators decide which command goes on which hard key:

| Generator | File | Rule |
|---|---|---|
| C (IR remote page, `ir_find_remote_command`) | `payload/source/codex_webui.c:6397-6435` | first command matching exactly, or by substring (alias > 4 chars) |
| Web wizard and remote | `tools/webui-sim/public/js/remote-layout.js:58-82` | **exact first**, then substring (owner-approved 2026-10-21) |
| Android | `Android/core-protocol/.../model/RemoteLayout.kt:107-175` | first match, substring allowed |
| Hub device screens | `payload/activity/codexactivity.lua:1286-1315` | **exact only**; plus BrightnessUp/Down on the volume keys |

The alias strings are identical in C, web and Android; the rules are not. With Home Assistant
command names:

| Device | Web wizard | Android/C | Hub device screen |
|---|---|---|---|
| Light | **DirectionRight → BrightnessUp** (substring "right") | — | **VolumeUp → BrightnessUp** |
| Soundbar | Exit → ClearVoice | **Back → PreviousTrack** | — |

`PlayPause` lands on no key anywhere.

## Evidence

- Proven in source.
- Track C reproduced the divergence locally (`/tmp/melodious-research/scratchC/alias-check.mjs`).
- See corpus §13.

## Goal / Non-goals

- **Goal:**
  - one table;
  - one rule;
  - one explicit list of per-domain extras (brightness, speed);
  - every generator gives the same answer for the same command list;
  - a test fails on drift.
- **Non-goal:** changing the owner-approved exact-first preference. It becomes the shared
  rule.

## Design

1. **The rule:**
   1. Exact normalized-name match (lower case, alphanumerics only) against the key's
      aliases, in alias order.
   2. Explicit synonym list (a reviewed list, not free substrings). Examples:
      `skipforward→FastForward`, `skipback→Rewind`, `previoustrack→Rewind`,
      `nexttrack→FastForward`, `return→PrevChannel`, `playpause→Play`. The last one is
      decided with the owner, because Play then toggles.
   3. **No free substring matching.** The current substring rule is what produces "right"
      in BrightnessUp.
   4. Per-domain extras, only when the key has no exact or synonym match:
      `brightnessup/down → VolumeUp/Down`, `speedup/down → VolumeUp/Down`.
2. **The table lives in one canonical file**, `payload/shared/remote-keys.json`:
   `{key, touchKey, aliases[], synonyms[], extras[], repeatable}`.
   - The Lua plugin loads it at runtime (installed beside `codexactivity.lua`), or it is
     generated into the Lua source by a build step.
   - The web build imports it.
   - The Android build copies it as a resource.
   - C embeds it through `tools/embed_activity_ui.sh`-style generation.
3. **Parity test:** a Node test reads the canonical file plus each implementation, runs a
   shared vector file of command lists, and asserts identical results. For C and Kotlin,
   either run them (C under hub-emu or a host build; Kotlin through the Gradle unit test that
   reads the same vectors) or compare generated tables textually.
4. **Wizard defaults and device screens both call the same function.** The web and Android
   wizards keep a local copy for offline editing, but the copy comes from the canonical file.

## Work breakdown

1. Write `payload/shared/remote-keys.json` from the current Lua table plus the reviewed
   synonym list.
2. Lua: `touchScreenKeyFor()` reads it (`codexactivity.lua:1368-1387`).
3. Web: `remote-layout.js` imports it; `matchCommand` implements the rule.
4. Android: `RemoteLayout.kt` reads it; implement the same rule.
5. C: generate `IR_REMOTE_BUTTONS` from it, and implement the rule in `ir_find_remote_command`.
6. Vectors: `tools/webui-sim/fixtures/key-alias-vectors.json`, with HA light, fan, cover,
   media player, soundbar, a Logitech TV and set-top-box names.
7. Tests (below); docs `docs/HOME_ASSISTANT.md` ("The names match the activity wizard's key
   aliases").

## Local tests

- `tools/webui-sim/test/alias-parity.test.mjs` (new): canonical file vs web; Lua through
  `luajit` running a tiny shim; C table text equality.
- `Android/core-protocol/src/test/.../AliasParityTest.kt` (new): same vectors.
- Existing: `wizard-button-defaults.test.mjs`, `remote-layout.test.mjs`,
  `wizard-back-key.test.mjs`, `codexactivity-device-screens-test.lua`. Update their
  expectations deliberately; list each changed expectation in the PR.

## Hardware gate (approval required)

1. Rebuild one HA light's screen and create one test activity with that light through the
   wizard.
2. Brightness sits on the same keys in both, and DirectionRight carries nothing unexpected.
3. Revert.

## Risks & rollback

- Changing defaults changes **new** activities only. Existing maps are not rewritten. A
  rebuilt device screen may move hard keys; announce it in the PR.
- Rollback: revert; the canonical file is additive.

## Definition of done

- One table and one rule; the parity tests are green on all four implementations; the docs
  are updated.

## Open questions

- Does `PlayPause` belong on Play, Pause or both? Owner decision.
- Should the synonym list be user-extendable? Not now.

## Decisions

—
