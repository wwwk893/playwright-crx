# Flow Layer Instructions

This directory owns the business-flow model, Event Journal, projection,
finalization, export/redaction, diagnostics, and compatibility facades.

## Invariants

- `FlowStep` is a projection, not a fact source.
- Raw recorder actions and page context events must enter through capture /
  journal paths before projection.
- User-authored intent, comments, assertions, repeat rows, and manual steps must
  not be overwritten by recorder merge.
- Terminal assertions must be derived after business projection has reached its
  final step shape.
- `flowBuilder.ts` is a public facade. Do not add new internals there.
- `codePreview.ts` is a replay facade. Do not add renderer logic there.

## Do Not Add

```text
Playwright renderer mechanics
runtime bridge behavior
business semantic guessing from DOM strings
React component state
global text fallback
```

## Validation

For flow changes, run:

```bash
npm run test:crx:business-flow:l1
```

If projection affects generated replay, also run the relevant L2/L3 targeted
specs.
