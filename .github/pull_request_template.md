## Summary

- ...

## Change Type

- [ ] Bug fix
- [ ] Architecture cleanup
- [ ] Harness / test infrastructure
- [ ] Runtime bridge
- [ ] Documentation
- [ ] Future MVP feature

## Affected Layer

- [ ] capture
- [ ] flow / projection
- [ ] interactions / transactions
- [ ] uiSemantics / recipes
- [ ] replay / exported renderer
- [ ] replay / parser-safe renderer
- [ ] runtime bridge
- [ ] L1 tests
- [ ] L2 tests
- [ ] L3 tests
- [ ] docs / governance

## Architecture Movement

```text
Moved:
- from: ...
- to: ...

Preserved behavior:
- ...

Explicit non-goals:
- ...
```

## Scope Guard

- [ ] No broad `src/server/*` behavior changes.
- [ ] No global text fallback.
- [ ] No blind sleeps or timeout increases to hide races.
- [ ] No mocked replacement for real AntD/ProComponents fixture coverage.
- [ ] No weakened terminal-state assertions.
- [ ] Exported Playwright and parser-safe playback still share the same semantic source.
- [ ] User-authored edits/assertions/repeat rows/manual steps are preserved.

## Changed Files

```text
...
```

## Validation

### L1 Flow/Unit/Codegen/Recipe

```bash
npm run test:crx:business-flow:l1
```

Result:

```text
...
```

### Build

```bash
npm run ci:pw:bundles
npm run build:crx
npm run build:examples:recorder
npm run build:tests
```

Result:

```text
...
```

### L2 Deterministic CRX Generated Replay

```bash
npm run test:crx:business-flow:l2 -- --reporter=line --global-timeout=1200000
```

Result:

```text
...
```

### L3 Human-Like Smoke

```bash
npm run test:crx:business-flow:l3 -- --reporter=line --global-timeout=1200000
```

Result:

```text
...
```

### Full Regression

```bash
CI=1 npm run test:crx:business-flow -- --reporter=line --global-timeout=1200000
CI=1 npm run test:crx:legacy-core -- --reporter=line --global-timeout=1200000
```

Result:

```text
...
```

## Known Flaky / Issue Link

```text
Known flaky:
Issue link:
Command:
Observed result:
Why it does or does not block this PR:
```

## Review Checklist

- [ ] Layer boundary preserved.
- [ ] User edits preserved.
- [ ] Terminal business-state assertions preserved.
- [ ] Redaction/export surfaces safe.
- [ ] Legacy import compatibility preserved.
- [ ] No new flaky helper behavior.

## Known Limitations / Follow-Up

- ...
