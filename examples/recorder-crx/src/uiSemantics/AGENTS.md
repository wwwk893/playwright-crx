# UI Semantics Instructions

This directory owns AntD, ProComponents, business-hint, compact semantic, and
UiActionRecipe contracts.

## Invariants

- Business hints such as `data-testid`, `data-e2e-*`, `data-row-key`, and
  `data-column-key` outrank framework CSS clues.
- AntD / ProComponents adapters may inspect `.ant-*` DOM, but that detail should
  become compact semantic context or `UiActionRecipe`, not final locator policy.
- Recipe contracts declare replay strategy and runtime fallback capability.
- Export and diagnostics must use compact, privacy-safe semantic data only.

## Do Not Add

```text
final Playwright source rendering
runtime bridge implementation
FlowStep merge or projection ownership
unredacted DOM snapshots
```

## Validation

For recipe changes, run:

```bash
npm run test:crx:business-flow:l1
```

If strategy changes affect generated replay, run targeted L2/L3 coverage.
