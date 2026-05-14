# Flaky Policy

Flaky behavior is an issue to classify, not a reason to weaken tests.

## Budgets

| Layer | Policy |
| --- | --- |
| L1 | Must be zero flaky. Any L1 flake is a blocker. |
| L2 | Terminal-state generated replay failures are blockers unless proven infrastructure-only. |
| L3 | Human-like flakiness may be accepted only when tracked with artifacts and targeted rerun evidence. |
| Runtime bridge | Must be deterministic. Flakes usually indicate bridge or harness bugs. |
| Legacy core | May be tracked separately when unrelated to changed scope, but must be linked in PR body. |

## Aggregate Command

The aggregate command is preserved for parity:

```bash
CI=1 npm run test:crx:business-flow -- --reporter=line --global-timeout=1200000
```

If split L2/L3 commands pass but aggregate reports flaky:

1. Record the flaky tests and first failing assertions.
2. Link or create a flaky issue.
3. State whether the flaky path overlaps the PR scope.
4. Do not hide the signal by deleting assertions, adding blind sleeps, or
   replacing L3 behavior with deterministic helpers.

## PR Reporting

Every PR that sees flaky behavior must include:

```text
Known flaky:
Issue link:
Command:
Observed result:
Why it does or does not block this PR:
```

If there is no issue, create one before merge unless the flaky signal is
immediately fixed in the same PR.
