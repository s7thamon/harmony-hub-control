# Plan framework

Every plan in this folder follows the same shape and lifecycle. This page defines them once,
so the individual plans can stay short.

## 1. Lifecycle

```text
Proposed → Agreed (owner) → In progress (one branch, one PR) → Local tests green
        → Hardware gate approved → Gate run → Merged → Deployed → Closed
```

- **Proposed:** written here; nothing started.
- **Agreed:** the owner picks the plan and any options it offers. Record the decision and
  its date in the plan's *Decisions* section.
- **In progress:**
  - one branch from `main` per plan, unless the plan says it may stack;
  - branch names follow the repo's habit: `fix/<topic>`, `feat/<topic>`, `docs/<topic>`;
  - before any commit, check the branch and the PR state.
- **Local tests green:** every test the plan lists passes, along with the full existing
  suites:
  - `luajit tools/touch-validator/*.lua` (the validate test needs
    `tools/webui-sim/fixtures/touch-maplist.json` as its argument);
  - `node --test` in `tools/webui-sim`;
  - Android unit tests where Android changes.

  POST paths must also be checked against `tools/hub-emu`, because the Node sim accepts
  chunked bodies and the real `codex_webui` doesn't.
- **Hardware gate:**
  - the owner approves the gate as written, step by step;
  - the assistant runs every command;
  - the owner only touches the remote and the devices.
- **Closed:** merged, deployed, gate passed, and docs updated in the same PR.

## 2. Plan template

```markdown
# P-NN Title
Status · Priority · Area · Depends on · Blocks

## Problem          what is wrong, in user-visible terms
## Evidence         proven (file:line) vs inferred; corpus links
## Goal / Non-goals
## Design           the change, and why this shape
## Work breakdown   files and functions, in order
## Local tests      new tests, with the fixtures they use
## Hardware gate    approval-gated steps, expected results, stop conditions
## Risks & rollback
## Definition of done
## Open questions
## Decisions        owner decisions with dates (empty until agreed)
```

## 3. Priorities

| Tier | Meaning | Plans |
|---|---|---|
| **T0** | Documentation that is wrong today and misleads future work | P01 |
| **T1** | Silent data loss or wrong behaviour in the save/sync path | P02, P03, P09 |
| **T2** | The same intent produces different maps depending on the editor | P04, P05, P06, P07, P08 |
| **T3** | Home Assistant correctness and reach | P10, P11, P12, P13, P14, P15, P16 |
| **T4** | New capability, gated design spikes | P17, P18, P19 |
| **T5** | Cross-cutting | P20 (security), P21 (hardware validation programme) |

## 4. Rules every plan inherits

1. **No Touch software changes.** Work around Touch quirks in generated data (corpus §02,
   §05).
2. **Writer path only.** Resources change through `codexactivity` ops using
   `resMgr.saveResource` with new etag and hetag, then `config_new`, then
   `publishLocalRevision`. A plan that adds a writer adds a plugin op, not a raw file write.
3. **Generators live on the hub** (owner decision, 2026-10-24). Web and Android may keep
   copies only behind a parity test (P05).
4. **Never renumber on-screen slots** on save (`docs/TOUCH_EDITOR.md`). That covers
   activity screens and, once P04 lands, device screens too.
5. **Never touch Logitech-made maps** (`ButtonMapId- ≤ 52944089`) except to carry them
   through byte for byte.
6. **Validators come in pairs.** Any rule added to the hub's `validateGraph` is mirrored in
   the web validator, with a shared fixture test so the two can't drift.
7. **Synthetic fixtures only.** Use `fixtures/synthetic-graph.json` as the base and extend
   it.
8. **The Touch stale window.** Any change that moves a soft button's index creates a window
   in which an old label runs a new command until the Touch syncs. Plans must either avoid
   moving indexes or say why it is acceptable.
9. **Accepted is not executed.** No plan may treat a 200 (from hal, the engine or the HA
   webhook) as proof that an action ran.

## 5. Hardware gate conventions

- Before each step:
  - start `logread -f` on the hub;
  - restart the capture each step, because it stalls after a few minutes;
  - read the Touch's `/data/loggly/SyncCounter.json` before and after (SSH on USB, or HOT
    over RF with a 30000 ms timeout).
- One variable per step. Stop at the first surprise, and revert before investigating.
- Take a backup before the first write step (the web UI's backup, plus a copy of
  `/data/resources`).
- Never tell the owner to use the Touch's menu Sync; the Touch pulls by itself after a
  publish.
- Watch hub `/data` free space before installs (jffs2, about 5 MB).
- Don't reboot to "fix" a Touch that goes quiet; it is probably asleep. Wake it.

## 6. Definition of done (all plans)

- Code, tests and docs land in one PR.
- Every corpus page the change contradicts is updated in the same PR, if this folder has
  been committed by then.
- The hardware gate results are posted as a PR comment, sanitized.
- The memory notes are updated when an earlier conclusion changes.
