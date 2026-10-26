# Remote Feature Correction

This folder holds the work programme that came out of the 2026-10-25 deep dive into button
mapping, map generation and Home Assistant support across the Harmony Touch, the Harmony Hub
and Melodious.

It contains two things:

1. **`plans/`**: one framework plan per problem to fix. Each plan states the problem, the
   evidence, the design, the files, the local tests, the hardware gate, the rollback, and
   when it counts as done.
2. **`corpus/`**: everything learned in the research, written as a reference you can read
   without the original session. It covers the Touch, the hub engine, the resource model,
   Melodious's writers and generators, the Home Assistant integration, the evidence, and the
   open questions.

`fixtures/` holds a synthetic, internally consistent example graph used throughout the corpus
and the plans.

The source report is `~/Repos/harmony/re/reports/button-mapping-ha-deep-dive.md`. This folder
expands on it; read either one on its own.

## Status

- **Nothing here is implemented.** Every plan is *Proposed*.
- Every plan that touches hardware has its own approval gate. No hardware step runs without
  the owner's explicit yes for that step.
- This folder is **not committed**. It lives in the working checkout so plans sit next to
  the code they change. If it is ever committed, re-run the sanitization check in
  `corpus/25-safety-and-operating-rules.md` first.

## Ground rules (from the owner)

- Preserve the stock Touch experience. Replacing the Touch's software is not a goal.
- Prefer fixing generated data and shared hub-side logic over changing the Touch.
- Never commit household data: IDs, names, emails, serials, entity IDs, webhook IDs, URLs,
  keys or dumps. Everything in this folder is synthetic or structural.
- Hub writes go through the writer (`resMgr.saveResource`, then reload and publish), never
  through raw file writes.
- The assistant runs approved commands itself; the owner only handles physical hardware.
- No local Home Assistant on the Mac. HA tests run on the owner's server.

## Reading order

1. `corpus/00-index.md`, then `corpus/01-system-overview.md`.
2. `plans/00-framework.md`, for how plans are run, gated and closed.
3. `plans/README.md`, for the ranked list and the dependency order.

## Layout

```text
Remote-Feature-Correction/
  README.md                     this file
  plans/                        framework + one plan per problem
  corpus/                       the research written up as a reference
  fixtures/synthetic-graph.json the example graph (valid JSON, synthetic IDs)
```
