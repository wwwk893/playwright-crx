# Eval Case Catalog

This catalog keeps regression cases durable across PRs. Add an entry whenever a
bug fix, flaky investigation, or new replay strategy depends on a specific
business oracle.

## Format

Each eval case must include:

```text
ID:
Layer:
Fixture:
Business objective:
Positive oracle:
Negative oracle:
Command:
Expected artifacts on failure:
Regression issue / PR link:
```

## Seed Cases

| ID | Layer | Fixture | Objective | Positive oracle | Negative oracle | Command | Artifacts |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BF-TERMINAL-001 | L2 | AntD users page | Generated replay fails when a created row is missing | Missing row assertion rejects | Script completion alone is not enough | `npm run test:crx:business-flow:l2 -- -g "created row is missing"` | `tests/test-results/`, raw replay output |
| BF-SELECT-001 | L2 | AntD/ProComponents Select | Select committed option and verify selected value | Selected value visible in owning control | Global option text click does not count | `npm run test:crx:business-flow:l2 -- -g "AntD"` | generated spec, diagnostics |
| BF-REPEAT-001 | L1 | step stability fixtures | Repeat terminal assertions keep dynamic row keys | Dynamic `row.variable` selectors are emitted | Fallback to first row fails | `npm run test:crx:business-flow:l1` | L1 stdout |
| BF-HUMAN-001 | L3 | Network resource repeat flow | Human-like repeat flow records and replays terminal state | Rows/select values/popovers reach final business state | Force clicks or mocks do not satisfy L3 | `npm run test:crx:business-flow:l3 -- -g "network resource"` | trace/report/raw replay on failure |
| BF-RUNTIME-001 | Runtime bridge | Player runtime bridge specs | Parser-safe fallback dispatches only declared runtime gaps | Runtime bridge action succeeds with recipe fallback | Global text fallback is not allowed | `npx playwright test -c tests/playwright.config.ts tests/crx/player-runtime-bridge.spec.ts --project=Chrome` | Playwright trace/report |

## Adding Cases

When adding a case:

- Include a normal happy path and at least one negative oracle when practical.
- Prefer terminal business state over "script finished".
- Record whether the case exercises exported Playwright, parser-safe playback,
  runtime bridge, or all three.
- Link the issue or PR that made the case necessary.
