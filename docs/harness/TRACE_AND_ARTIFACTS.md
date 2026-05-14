# Trace And Artifact Guide

Failure artifacts are evidence, not noise. Read them before changing replay,
test helpers, or runtime bridge code.

## Artifact Locations

```text
tests/.raw-generated-replay/
tests/test-results/
tests/playwright-report/
```

## Common Files

| File | Meaning |
| --- | --- |
| `generated-replay.spec.ts` | Final emitted Playwright spec used by standalone replay |
| `raw-replay-output.txt` | Standalone replay stdout/stderr |
| `replay-failure-diagnostics.json` | Privacy-safe adaptive replay diagnostics |
| `trace.zip` | Playwright trace when enabled by retry/failure |
| HTML report | Playwright report for local inspection |

## Redaction Rules

Artifacts must not contain:

```text
cookies
authorization headers
tokens
passwords
full DOM snapshots from recorder capture
full response bodies
private customer data
```

If an artifact is needed in a GitHub issue, attach only the smallest redacted
snippet that proves the failure.

## Reading Order

For generated replay failures:

1. Read the failing assertion and spec line.
2. Open `tests/.raw-generated-replay/*/generated-replay.spec.ts`.
3. Compare the emitted locator/expectation to the expected terminal state.
4. Read `raw-replay-output.txt`.
5. Read `replay-failure-diagnostics.json` if present.
6. Use trace only when the generated source and diagnostics do not explain the
   failure.

## ENOENT And Cleanup Noise

Trace cleanup errors such as `browserContext.close: ENOENT` can be secondary
noise. Always identify the first real timeout/assertion failure before changing
artifact handling.
