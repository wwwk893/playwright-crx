# PR-05: Select and Popup Transactions

## Goal

Normalize AntD Select / TreeSelect / Cascader interactions into SelectTransaction.

## Why

Current Select handling is spread across pageContextSidecar, flowBuilder, codePreview, and CrxPlayer. This causes mismatch between exported code and runtime playback.

## Files

Add:

```text
examples/recorder-crx/src/interactions/selectTransactions.ts
```

Modify:

```text
examples/recorder-crx/src/pageContextSidecar.ts
examples/recorder-crx/src/flow/flowBuilder.ts
examples/recorder-crx/src/flow/sessionFinalizer.ts
examples/recorder-crx/src/flow/stepStability.test.ts
```

## Transaction model

```ts
interface SelectTransaction {
  id: string;
  type: 'select';
  component: 'Select' | 'TreeSelect' | 'Cascader';
  targetKey: string;
  field: { testId?: string; label?: string; name?: string };
  searchText?: string;
  selectedText: string;
  optionPath?: string[];
  sourceEventIds: string[];
  sourceActionIds: string[];
  commitReason: 'option-click' | 'dropdown-close' | 'stop-recording';
}
```

## Rules

- trigger click opens transaction.
- search fill/input attaches to open transaction.
- option click commits transaction.
- option path preserved for Cascader/TreeSelect.
- If no option before stop, mark incomplete and warn; do not fake a select step.

## Implementation steps

1. Bind dropdown option event to trigger using:
   - dropdownContextId
   - field label
   - field testId
   - controlType
   - time window
2. Build one `select` FlowStep with `uiRecipe`.
3. Remove duplicated synthetic option steps.
4. Keep current fallback paths until PR-07/08 replace renderer.

## Tests

Add:

```text
- select trigger + search + option becomes one select transaction
- TreeSelect option path is preserved
- Cascader path is preserved
- stop recording with open select does not create fake completed select
- option event arriving after recorded action is reconciled
- generated code and parser-safe playback code both include selected option
```

Commands:

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build:examples:recorder
cd tests
xvfb-run -a npx playwright test crx/businessFlowRecorder.spec.ts crx/humanLikeRecorder.spec.ts \
  --config=playwright.config.ts --project=Chrome \
  -g "Select|TreeSelect|Cascader|WAN|IPv4|network" --workers=1 --reporter=line
```

## Rollback

Allow projection to fall back to existing click/fill/option steps if SelectTransaction is incomplete.
