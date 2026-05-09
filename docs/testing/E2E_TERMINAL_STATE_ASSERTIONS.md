# E2E Terminal-State Assertions

## 1. Purpose

A business-flow replay must prove an outcome. It is not enough to prove clicks happened.

MVP 0.1.7 should add or suggest terminal-state assertions for realistic recorded flows while staying inside the CRX recorder/workbench boundary. This is not full spec generation.

## 2. Terminal-state assertion types

Recommended generic assertion types:

```text
row exists
row not exists
row changed
modal closed
modal visible
drawer closed
popover closed
selected value visible
form validation visible
toast visible
button enabled/disabled
editable cell saved
```

Use existing `FlowAssertion` if possible. Do not introduce a large new assertion framework unless existing type cannot represent the needed assertions.

## 3. Mapping from semantic recipe to terminal assertion

| Recipe | Assertion candidate | Required context |
|---|---|---|
| `protable-toolbar-action` create | row exists after modal submit | table id/test id + row key/token after submit |
| `submit-form` modal-form | modal closed + table row appears/updates | overlay title/test id + table context |
| `table-row-action` edit | modal visible or row changed | row key + action + overlay/table context |
| `table-row-action` delete | popconfirm visible, then row not exists | row key + popconfirm evidence |
| `confirm-popconfirm` | popover closed + row not exists if delete context exists | popconfirm title + row key |
| `select-option` | selected value/tag visible | field test id/label + option text |
| `toggle-control` | checked state changed | field/test id |
| `editable-table-cell` | cell display value changed or validation appears | row key + column key |
| `upload-file` | file listed/status updated | upload root + file token |

If context is insufficient, skip assertion and emit privacy-safe diagnostic.

## 4. Assertion emission examples

### Row added

```ts
const table = page.getByTestId('wan-transport-table');
await expect(table.locator('tr').filter({ hasText: /Nova.*公网/ })).toBeVisible();
```

Prefer stable `data-row-key` when available:

```ts
await expect(page.locator('[data-testid="wan-transport-row"][data-row-key="row-nova-public"]')).toBeVisible();
```

### Row removed

```ts
await expect(page.locator('[data-testid="wan-transport-row"][data-row-key="row-nova-public"]')).toHaveCount(0);
```

### Modal closed

```ts
await expect(page.getByTestId('wan-transport-modal')).toBeHidden();
```

### Popconfirm closed

```ts
await expect(page.locator('.ant-popover:not(.ant-popover-hidden)').filter({ hasText: '删除此行？' })).toBeHidden();
```

### Selected value visible

```ts
const field = page.getByTestId('wan-transport-select-field');
await expect(field).toContainText('Nova 私网');
```

## 5. Terminal-state assertions must avoid false green

Bad:

```ts
await page.getByTestId('create-button').click();
await expect(page.getByText('保存成功')).toBeVisible();
```

Better:

```ts
await page.getByTestId('create-button').click();
await expect(page.getByTestId('entity-modal')).toBeVisible();
// fill and submit
await expect(page.getByTestId('entity-modal')).toBeHidden();
await expect(page.locator('[data-testid="entity-row"][data-row-key="created-row"]')).toBeVisible();
```

A toast alone is not enough for a data-changing flow unless no durable UI state exists.

## 6. No blind sleeps

Do not use `waitForTimeout()` to make terminal-state assertions pass.

Allowed waits:

```text
expect(...).toBeVisible()
expect(...).toBeHidden()
expect(...).toHaveCount()
expect(...).toContainText()
waitForResponse only if response alias exists and is sanitized
```

`waitForTimeout()` may remain a user-inserted wait step, but not as a substitute for terminal-state verification.

## 7. Mandatory negative tests

Add or preserve:

```text
If row is not removed, delete replay test fails.
If modal remains open after submit, submit replay test fails.
If select placeholder is emitted as option, test fails.
If duplicate row action is global-scoped, test fails.
If popconfirm confirm button uses tooltip role instead of visible popover, test fails.
```

## 8. Privacy constraints

Assertions may include:

```text
stable test id
stable row key
field name
short non-sensitive option text used in fixture
```

Assertions must not include:

```text
full row text
private customer data
raw form values
credentials
tokens
rawAction/sourceCode
```

Use `[REDACTED]` if uncertain.

## 9. Test commands

Focused:

```bash
xvfb-run -a npx playwright test -c tests/playwright.config.ts \
  tests/crx/humanLikeRecorder.spec.ts \
  -g "runtime replay supports wait inserted|shared WAN duplicate row edit action|WAN2 transport delete" \
  --project=Chrome --workers=1 --reporter=line --global-timeout=420000
```

Full CRX:

```bash
xvfb-run -a npx playwright test -c tests/playwright.config.ts \
  --project=Chrome --workers=1 --reporter=line --global-timeout=1200000
```
