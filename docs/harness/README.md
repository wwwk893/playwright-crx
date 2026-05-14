# Recorder Replay Harness

The harness is the contract that keeps business-flow recording, replay, and
repair work reviewable. It is more than a test command: it includes repository
instructions, fixtures, generated replay output, artifacts, validation checks,
and issue/repair workflow.

## Harness Contract

```text
Instructions:
  AGENTS.md
  scoped AGENTS.md files
  docs/architecture/RECORDER_REPLAY_ARCHITECTURE.md

Tools:
  npm scripts
  Playwright CRX test fixtures
  generated replay runner
  runtime bridge tests

Fixtures:
  real AntD / ProComponents pages
  human-like smoke flows
  legacy CRX recorder/player pages

Outputs:
  business-flow JSON
  compact YAML
  exported Playwright code
  parser-safe playback code
  adaptive replay failure diagnostics

Validation:
  L1 flow/unit/codegen/recipe
  L2 deterministic CRX generated replay
  L3 human-like CRX smoke
  runtime bridge tests
  legacy-core regression
```

## Validation Layers

Use `tests/crx/TEST_LAYERING.md` as the canonical layer guide.

```bash
npm run test:crx:business-flow:l1
npm run test:crx:business-flow:l2 -- --reporter=line --global-timeout=1200000
npm run test:crx:business-flow:l3 -- --reporter=line --global-timeout=1200000
npm run test:crx:legacy-core -- --reporter=line --global-timeout=1200000
```

The historical aggregate command remains available for parity and targeted
`-g` workflows:

```bash
npm run test:crx:business-flow -- --reporter=line --global-timeout=1200000
```

## Non-Goals

Do not make the harness pass by:

```text
deleting terminal-state assertions
replacing real AntD/ProComponents fixtures with mocks
adding blind sleeps
turning L3 into deterministic helper paths
adding global text fallback
adding selector self-healing
silently hiding runtime bridge gaps
```

## Documents

| Document | Purpose |
| --- | --- |
| `EVAL_CASES.md` | Catalog durable eval cases and their oracles |
| `TRACE_AND_ARTIFACTS.md` | Explain failure artifacts and redaction |
| `REPAIR_LOOP.md` | Define failure -> repair -> validation workflow |
| `SCORING_RUBRICS.md` | Define pass/fail rubrics |
| `FLAKY_POLICY.md` | Define flaky budget and aggregate-run policy |

## Issue Hygiene

Every follow-up issue should identify:

```text
affected layer
command that reproduces or validates
expected terminal business state
actual result
artifact paths
privacy/redaction check
acceptance criteria
```

Do not leave known regressions only in PR bodies.
