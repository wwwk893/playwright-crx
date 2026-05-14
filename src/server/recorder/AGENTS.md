# Recorder Runtime Instructions

This directory is upstream-protected CRX recorder/player territory. Treat it as
runtime bridge code only.

## Allowed

- Existing recorder/player behavior.
- Narrow parser-safe runtime bridge gaps explicitly declared by recipe
  `runtimeFallback`.
- Focused bridge tests for active AntD popup option dispatch, duplicate test id
  ordinal replay, or active Popconfirm confirmation.

## Forbidden

```text
business semantic inference
global text fallback
selector self-healing
AI repair logic
complex AntD/ProComponents adapter logic
test-only broad behavior changes
```

## Validation

Any runtime bridge change must include:

```bash
npm run build:crx
npm run build:tests
npm run test:crx:legacy-core -- --reporter=line --global-timeout=1200000
```

Also run focused runtime bridge specs and action count regression coverage when
parser-safe playback is affected.
