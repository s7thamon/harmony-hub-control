# Prompts issued to the implementing agent

Each prompt is one plan, or one bounded slice of a plan. The research agent writes the prompt,
the implementing agent does the work and reports in the prompt's fixed format, and the
research agent validates the report against the source before the next prompt is issued.

| # | Prompt | Plan | Status | Validation |
|---|---|---|---|---|
| 01 | [P01 documentation corrections](01-P01-documentation-corrections.md) | P01 | Done: `aa5b566` on `docs/p01-documentation-corrections`, not pushed | **PASS** 2026-10-25: diff reviewed; every cited line re-checked (spot re-reads incl. gesturepad 700-708, harmony.lua 4274-4282, cacert 18 roots / no ISRG); tests 500/500 re-run; sanitization 0 hits; scope 3 files; untracked files untouched. One wording fix → 01b. Checkout left on the branch → 01b returns it to `main`. |
| 01b | [P01 follow-up](01b-P01-fixup.md) | P01 | Issued 2026-10-25 | pending |
| 02 | [P21 G1–G4 press observation](02-P21-G1-G4-press-observation.md) | P21 | Issued 2026-10-25 (owner presses; agent read-only) | pending |

## Standing rule for every prompt (owner, 2026-10-25)

The hub and the Touch are **always available for read-only access**: SSH, file reads,
`logread`, `ps`, checksums, HTTP GET reviews. Contacting them is never restricted. **Writes**
of any kind need the owner's explicit authorization, step by step. Prompt 01's "no device
access" rule was stricter than intended; prompts from 02 onward grant read-only access.

Every prompt should include:

- the access details:
  - key `~/.ssh/harmony_owner_ed25519`;
  - hub `root@<hub>`;
  - Touch `root@192.168.2.1` over USB Ethernet, with
    `-o UserKnownHostsFile=/tmp/melodious-touch-usb/known_hosts`;
  - the hub has no `head`/`df`; the Touch has no `tar`, so use `cat`;
  - the Touch sleeps, so wake it rather than rebooting;
- these rules:
  - "GET", "status" and "dryRun" labels don't prove an operation is side-effect-free;
  - raw captures stay in a private, uncommitted scratch directory.

## Validation checklist (every prompt)

1. Branch and commit match the prompt; nothing pushed unless the prompt allowed it.
2. Only the allowed files changed; the untracked owner files and this folder were not staged.
3. Each claimed "verified at" citation is re-read by the validator.
4. Tests reported are re-run by the validator.
5. Sanitization grep over the diff (corpus §25) gives zero hits.
6. Any skipped or disputed item is resolved before the next prompt.
