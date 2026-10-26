# Prompt 01b: P01 follow-up (one wording fix, then return to main)

Issued: 2026-10-25 · Plan: P01 · Follows: validation of prompt 01 (PASS)

---

You are in `~/Repos/harmony/harmony-hub-control`. Prompt 01 (P01 documentation corrections)
passed validation. One precision fix is needed before review.

1. Check you are on `docs/p01-documentation-corrections`, at commit `aa5b566`.
2. In `docs/HOME_ASSISTANT.md`, section "Saving: why only the writer reaches the Touch", the
   sentence "If `codexmqtt` picks it up, it reloads the engine without publishing, and the
   Touch keeps its old copy." must say **until the next publish**. The raw-written file is
   served from disk to the Touch at the next sync triggered by any later save. Suggested
   wording: "…and the Touch keeps its old copy until some later save publishes."
3. Commit it as a second commit, `docs: note raw edits reach the Touch at the next publish`.
   Stage the file by explicit path; don't amend.
4. **Leave `docs/FULL_FEATURE_ANALYSIS.md` unchanged.** Its P2 row "No cross-process resource
   lock" is still substantially true: the flock covers writer requests only, raw writers take
   no lock, and the lost-update race remains. It will be corrected in the PRs that fix those
   (plans P02 and P03).
5. Leave the 2026-10-24 spike sentence as history (agreed).
6. Then `git switch main`, so the shared checkout is back on `main`. Don't push, don't open
   a PR, don't touch untracked files.

Report:

```text
BRANCH: <name>   COMMITS: <sha1> <sha2>   PUSHED: no
DIFF (second commit): <git show --stat HEAD~0 on the branch>
CHECKOUT NOW ON: <branch>
GIT STATUS: <output>
```
