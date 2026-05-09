# Recorder Replay Asset Quality Design

## 1. Problem

After PR #11, the recorder has strong semantic hints and realistic fixtures. The next risk is that flow assets still become fragile replay assets.

A high-quality business replay asset must prove:

```text
The intended business action was performed.
The replay targets the correct UI scope.
The generated code remains parser-safe.
The terminal business state is asserted.
The asset can be reviewed by a human.
The asset does not leak sensitive context.
```

Click-only playback is not enough.

## 2. Quality dimensions

### 2.1 Locator scope quality

Good:

```ts
page.getByTestId('wan-transport-table')
  .locator('tr')
  .filter({ hasText: /Nova.*default/ })
  .getByTestId('wan-transport-row-delete-action')
  .click();
```

Bad:

```ts
page.getByTestId('wan-transport-row-delete-action').click();
```

The second form is wrong when duplicate row actions exist.

### 2.2 Option quality

Good:

```ts
await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
  .getByTitle('default')
  .click();
```

Bad:

```ts
await page.getByText('选择一个VRF').click();
```

Placeholder/search prompts must never become option replay.

### 2.3 Overlay quality

Good:

```ts
await page.locator('.ant-popover:not(.ant-popover-hidden)')
  .filter({ hasText: '删除此行？' })
  .getByRole('button', { name: /^(确定|确 定)$/ })
  .click();
```

Bad:

```ts
await page.getByRole('tooltip', { name: '确 定' }).click();
```

Popconfirm confirmation is not a tooltip click; it must target the visible popover button.

### 2.4 Terminal-state quality

Good:

```ts
await expect(row).toBeHidden();
await expect(page.getByTestId('wan-transport-modal')).toBeHidden();
await expect(table).toContainText('Nova 私网');
```

Bad:

```ts
await page.getByText('删除').click();
// no assertion
```

## 3. Asset quality contract

Each business step should aim to have:

```ts
FlowStep {
  id: string;
  action: FlowActionType;
  target?: FlowTarget;
  context?: StepContextSnapshot;
  uiRecipe?: UiActionRecipe;
  assertions: FlowAssertion[];
}
```

For replay-quality hardening, use these fields in priority order:

```text
1. step.uiRecipe
2. step.context.before.ui compact fields
3. step.target.scope / duplicate ordinal / row context
4. Playwright recorded raw action
5. weak fallback
```

Do not require every step to have every field. The system must gracefully degrade.

## 4. Replay emission order

When emitting code preview/runtime playback:

```text
1. Use explicit terminal assertions if present.
2. Use UiActionRecipe to decide component-level replay shape.
3. Use business hints/test ids for stable locators.
4. Use AntD/ProComponents context for scoping.
5. Use generic role/label/text as fallback.
6. Use weak CSS only with diagnostics and tests.
```

## 5. Suggested helper functions

Implement only if they reduce complexity in `codePreview.ts`.

```ts
function emitScopedRowAction(step: FlowStep, testId: string): string | undefined;
function emitSelectOption(step: FlowStep): string | undefined;
function emitPopconfirmConfirm(step: FlowStep): string | undefined;
function emitTerminalAssertion(step: FlowStep): string[];
function describeReplayDecision(step: FlowStep, decision: ReplayDecision): ReplayDiagnosticEntry;
```

Avoid a large new codegen framework. Keep helpers small and close to existing code.

## 6. Placeholder suppression

Placeholder suppression must happen at the **final emit layer**, after repeat parameter substitution.

Unsafe option text examples:

```text
选择一个VRF
选择一个WAN口
请选择
Select...
```

Suppression rule:

```text
If option text matches known placeholder/search prompt patterns and there is no strong option identity, do not emit option click.
```

Negative test:

```text
repeat/parameterized Select replay must not emit click for placeholder after substitution.
```

## 7. Duplicate test-id scoping

If a test id is likely duplicate:

```text
row action id
modal/drawer-owned action
toolbar action inside table
popconfirm confirm inside overlay
```

then global `page.getByTestId(id).click()` is not allowed.

Preferred scoping:

```text
table root → row key/text token → action test id
modal/drawer root → action test id
visible popover root → confirm button
```

Negative tests:

```text
No global row action getByTestId when row/table context exists.
No overlay root test id click when the target is an internal ok/cancel/action.
```

## 8. Row text matching

Exact row text is fragile. Use tokenized matching.

Acceptable token sources:

```text
rowKey
stable non-sensitive row label
table id
column key
action test id
```

Do not store full row text in exported flow or AI input.

## 9. Terminal-state assertion strategy

Suggested generic mapping:

| Recipe kind | Terminal-state suggestion |
|---|---|
| `protable-toolbar-action` create | row count increases or row exists after submit |
| `submit-form` modal-form | modal closes and row/value appears |
| `table-row-action` edit | modal opens or row value changes |
| `table-row-action` delete | popconfirm appears, row disappears after confirm |
| `select-option` | selected value/tag visible |
| `toggle-control` | checked state changes |
| `editable-table-cell` | cell display value changes or validation appears |

These are suggestions, not magic. If context is insufficient, emit diagnostics and skip assertion rather than asserting the wrong thing.

## 10. Privacy boundary

Replay asset quality must not weaken PR #10/PR #11 privacy rules.

Never export or send to AI:

```text
raw DOM
rawAction
sourceCode
locatorHints
reasons
rowText
overlay.text
option raw value
full URL query/hash
credentials/tokens/cookies/auth headers/private keys/connection strings
```

Use compact fields only.
