# PR-06: Business Step Projection Refactor

## Goal

Move FlowStep generation out of low-level merge logic. Keep public APIs stable while moving logic into transaction → step projection.

## Files

Add:

```text
examples/recorder-crx/src/flow/businessFlowProjection.ts
examples/recorder-crx/src/flow/syntheticReconciler.ts
```

Modify:

```text
examples/recorder-crx/src/flow/flowBuilder.ts
examples/recorder-crx/src/flow/stepStability.test.ts
```

## Design

`flowBuilder.ts` becomes façade:

```ts
export function mergeActionsIntoFlow(prev, actions, sources, options) {
  const journal = appendRecorderActions(...);
  const transactions = composeTransactions(journal, options);
  return projectBusinessFlow(prev, journal, transactions, options);
}
```

## Responsibilities

### businessFlowProjection.ts

- transaction → FlowStep
- preserve stable step id
- preserve user edits
- recompute order

### syntheticReconciler.ts

- recorded action upgrades synthetic step in place
- late context attaches to recorded step
- synthetic submit relocation remains narrow

## Do not

- Do not change UI APIs.
- Do not rewrite codePreview yet.
- Do not remove existing tests.

## Tests

Add:

```text
- projection preserves user edited intent/comment/assertions
- synthetic step upgrades in place when recorded action arrives
- delete/insert/continue recording ids remain stable
- repeat segment refs stable after projection
```

Run:

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build:examples:recorder
```

## Rollback

Keep old functions behind façade. If projection fails, temporarily route to legacy merge path.
