# Interaction Transaction Instructions

This directory owns deterministic composition of low-level events into
interaction transactions.

## Invariants

- Low-level input, select, click, table, dialog, and wait signals compose into
  transactions before they become business steps.
- Transactions must be source-event-backed and deterministic.
- Open input/select transactions must be committed by finalization before export
  or replay generation.
- Target identity helpers should stay small and reusable.

## Do Not Add

```text
Playwright source emission
runtime bridge behavior
React UI state
terminal assertion rendering
business-flow export sanitization
```

## Validation

For transaction changes, run:

```bash
npm run test:crx:business-flow:l1
```

If a transaction change affects realistic recording order, run targeted L2/L3
coverage as well.
