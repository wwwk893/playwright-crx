# PR-04: Input Transactions

## Goal

Fix input typing instability by introducing InputTransaction and projecting committed inputs into one fill step.

## Files

Add:

```text
examples/recorder-crx/src/interactions/inputTransactions.ts
examples/recorder-crx/src/interactions/targetIdentity.ts
```

Modify:

```text
examples/recorder-crx/src/flow/sessionFinalizer.ts
examples/recorder-crx/src/flow/flowBuilder.ts
examples/recorder-crx/src/flow/stepStability.test.ts
```

## Transaction model

```ts
interface InputTransaction {
  id: string;
  type: 'input';
  targetKey: string;
  field: {
    testId?: string;
    label?: string;
    name?: string;
    placeholder?: string;
  };
  sourceEventIds: string[];
  sourceActionIds: string[];
  finalValue: string;
  commitReason: 'change' | 'blur' | 'next-action' | 'stop-recording';
  startedAt: number;
  endedAt: number;
}
```

## Rules

- Same targetKey input/fill/press/change merge.
- finalValue wins.
- keydown/press single char does not become a business step.
- Tab/blur commits transaction but does not create step.
- stop-recording commits open transaction.

## Implementation steps

1. Add target key function:

```ts
target.testId || form.testId || form.namePath || form.name || form.label || placeholder || raw selector
```

2. Add input transaction builder from recorder actions and page context events.
3. In finalizer, commit open input transactions.
4. In projection, replace relevant low-level input/fill/press steps with one fill FlowStep.
5. Preserve user-edited step fields when refreshing.

## Tests

Add to `stepStability.test.ts`:

```text
- consecutive input events become one fill step
- recorder fill plus page input keeps final value
- stop recording commits open input transaction
- Tab/blur does not create business step
- generated code uses final value
- repeat parameter uses final input value
```

Commands:

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build:examples:recorder
```

Targeted E2E:

```bash
cd tests
xvfb-run -a npx playwright test crx/businessFlowRecorder.spec.ts crx/humanLikeRecorder.spec.ts \
  --config=playwright.config.ts --project=Chrome \
  -g "user|IPv4|network" --workers=1 --reporter=line
```

## Rollback

Gate transaction projection behind an internal flag if needed:

```ts
useInputTransactions?: boolean
```

Default on after tests pass.
