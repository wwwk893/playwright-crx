# CRX Test Instructions

This directory owns CRX integration, generated replay, human-like smoke, runtime
bridge, and legacy recorder/player regression tests.

## Layer Rules

- L2 tests may use deterministic helpers, but every generated replay case must
  verify terminal business state.
- L3 tests must use realistic mouse/keyboard behavior for the core user path.
- L3 helpers must not silently replace the path with force clicks, dispatch
  events, mocks, or blind sleeps.
- Runtime bridge tests must stay narrow and must not justify broad server-side
  semantic guessing.
- Legacy tests protect upstream recorder/player compatibility.

## Artifact Rules

Retain and inspect:

```text
tests/.raw-generated-replay/
tests/test-results/
tests/playwright-report/
```

Do not upload or paste unredacted private data.

## Validation

Use:

```bash
npm run test:crx:business-flow:l2 -- --reporter=line --global-timeout=1200000
npm run test:crx:business-flow:l3 -- --reporter=line --global-timeout=1200000
npm run test:crx:legacy-core -- --reporter=line --global-timeout=1200000
```
