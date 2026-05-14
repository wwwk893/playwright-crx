# Replay Layer Instructions

This directory owns exported Playwright rendering, parser-safe playback
rendering, repeat/assertion rendering, action counting, and recipe-backed replay
mechanics.

## Invariants

- Replay consumes `FlowStep` plus `UiActionRecipe`.
- Exported Playwright and parser-safe playback must share the same semantic
  source.
- Do not rediscover AntD/ProComponents business semantics independently in each
  renderer.
- Parser-safe gaps require an explicit recipe `runtimeFallback` and a narrow
  runtime bridge test.
- `countBusinessFlowPlaybackActions()` must stay aligned with parser-safe
  runnable line count.

## Do Not Add

```text
new raw DOM scanning
global text fallback
selector self-healing
business semantic inference in src/server/*
FlowStep projection rules
```

## Validation

For replay changes, run:

```bash
npm run test:crx:business-flow:l1
CI=1 npm run test:crx:business-flow:l2 -- --reporter=line --global-timeout=1200000
```

For human-like recording or fallback paths, also run L3.
