# Business Flow Recorder Example

This example is the internal business-flow recorder and replay harness built on
top of Playwright CRX. It records realistic business flows, lets testers add
intent and assertions, exports durable flow assets, and verifies generated
Playwright replay against terminal business states.

## Architecture Map

```text
Raw recorder actions
  -> page context facts
  -> Event Journal
  -> interaction transactions
  -> BusinessFlow projection
  -> UiActionRecipe
  -> exported Playwright renderer
  -> parser-safe playback renderer
  -> runtime bridge only when recipe declares a fallback
```

Key contracts:

```text
docs/architecture/RECORDER_REPLAY_ARCHITECTURE.md
docs/mvp-0.1x-architecture-migration/ARCHITECTURE_CONTRACT.md
tests/crx/TEST_LAYERING.md
docs/harness/README.md
```

## Build

From the repository root:

```bash
npm run build:crx
npm run build:examples:recorder
npm run build:tests
```

Use this order when recorder/parser/player code changes, because tests and the
example extension may depend on both root `lib/` output and example `dist/`
output.

## Test

```bash
npm run test:crx:business-flow:l1
npm run test:crx:business-flow:l2 -- --reporter=line --global-timeout=1200000
npm run test:crx:business-flow:l3 -- --reporter=line --global-timeout=1200000
npm run test:crx:business-flow -- --reporter=line --global-timeout=1200000
```

Layer guide:

```text
L1: pure flow / codegen / recipe contracts
L2: deterministic CRX generated replay with terminal-state assertions
L3: human-like mouse/keyboard smoke paths
```

## Failure Artifacts

Inspect these before changing replay logic:

```text
tests/.raw-generated-replay/
tests/test-results/
tests/playwright-report/
```

Useful files include:

```text
generated-replay.spec.ts
raw-replay-output.txt
replay-failure-diagnostics.json
trace.zip
```

## Privacy

Do not export or upload:

```text
cookies
authorization headers
tokens
passwords
full DOM snapshots
full response bodies
private customer data
```

Exported JSON/YAML and diagnostics must remain compact and redacted.

## Where To Add Logic

| Need | Location |
| --- | --- |
| Raw recorder/page context facts | `src/capture/` |
| Transaction composition | `src/interactions/` |
| Projection/finalization/export | `src/flow/` |
| Semantic adapter or recipe contract | `src/uiSemantics/` |
| Exported/parser-safe replay rendering | `src/replay/` |
| L1 contract tests | `src/flow/stepStability.test.ts` |
| L2/L3 CRX coverage | `tests/crx/` |

## Where Not To Add Logic

- Do not add business semantic inference to `src/server/*`.
- Do not add renderer internals to `flowBuilder.ts` or `codePreview.ts`.
- Do not make L3 pass by force-clicking, dispatching, mocking, or adding blind
  sleeps.
- Do not weaken terminal-state assertions to make generated replay green.
