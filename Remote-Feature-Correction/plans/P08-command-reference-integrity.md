# P08 Command rename and delete integrity

Status: Proposed · Tier T2 · Area: `codex_webui.c` IR forms, `codexactivity.lua` · Depends on: P03 (Stage 2) · Blocks: —

## Problem

Deleting or renaming an IR command leaves every button, function and sequence step that
referenced it pointing at a name that no longer exists. Nothing reports it. On the remote the
button does nothing (the engine's `device:getCommand` returns nil and sends nothing,
`device.lua:298-305`).

The HA writer already guards this for HA devices (`codexactivity.lua:2151-2174`). IR devices
have no guard.

## Evidence

- `codex_webui.c:3666-3704`: command delete has no reference check.
- `codex_webui.c:4230-4311`: rename doesn't update references.
- `validateGraph` never checks command names (`codexactivity.lua:342-592`).

## Goal / Non-goals

- **Goal:**
  - delete refuses when the command is referenced, and lists the references;
  - rename offers "rename everywhere", which rewrites `CommandName` in MapList, FunctionList,
    sequences and PowerFeature/InputFeature actions in one transaction.
- **Non-goal:** fuzzy re-mapping of deleted commands.

## Design

- Implement both as plugin ops once P03 Stage 2 exists. Until then, the C side calls a new
  read-only plugin op `CommandReferences {deviceId, name}` that returns the references.
- **`DeleteCommand {deviceId, name, force:false}`:**
  - refuse with the reference list;
  - with `force`, also remove the referring buttons. Activity soft buttons leave a gap;
    hard keys become unmapped.
- **`RenameCommand {deviceId, from, to}`:**
  - rewrite every reference;
  - revalidate;
  - save the changed lists with new etags;
  - reload and publish.
- Reuse `haReferences` (`codexactivity.lua:1908-1938`), generalized to any device.
- Device screens built by the hub: rebuild through `touchScreenMap` with P04 slot stability,
  so a renamed command keeps its slot. P04's key is the command name, so rename must map
  `oldSlot[from]` to `to`.

## Work breakdown

1. `codexactivity.lua`: generalize the reference walker; add ops.
2. `codex_webui.c`: the IR command delete and rename handlers call the ops.
3. Web `views/devices.js` and IR views: show references and offer force or rename-everywhere.
4. Android parity, where Android edits IR commands.

## Local tests

- Lua: delete refused when referenced; force removes; rename rewrites all reference kinds
  (hard, soft, long, double, sequence step, FunctionList, PowerFeature, InputFeature).
- hub-emu: end-to-end rename through the HTTP route.

## Hardware gate (approval required)

On a test IR device with a test activity:
1. Rename one command everywhere. The Touch label and key still send.
2. Delete with force on a gate-only command.
3. Revert.

## Risks & rollback

- The rename touches many lists; the transaction must roll back as a unit (reuse the
  activity-save restore).
- Rollback: revert the PR.

## Definition of done

- No path can leave a dangling command reference. P07's warning shows zero on the live data.

## Decisions

—
