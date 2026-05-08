# Playwright CRX Adapter Alignment

## 1. Purpose

MVP 0.1.6 should make `playwright-crx` consume generic business hints emitted by the company frontend without hardcoding `networking` domain names.

The plugin should not know what an IP port pool or SNAT rule is. It should know:

```text
this target belongs to a ProTable
this row has a stable row key
this action is a row edit action
this select field has a stable field id
this modal has a root and ok/cancel buttons
```

## 2. Current plugin context

Current PR #10 context includes these files:

```text
examples/recorder-crx/src/uiSemantics/types.ts
examples/recorder-crx/src/uiSemantics/antd.ts
examples/recorder-crx/src/uiSemantics/compact.ts
examples/recorder-crx/src/uiSemantics/diagnostics.ts
examples/recorder-crx/src/uiSemantics/index.ts
examples/recorder-crx/src/pageContextSidecar.ts
examples/recorder-crx/src/flow/exportSanitizer.ts
examples/recorder-crx/src/aiIntent/prompt.ts
examples/recorder-crx/src/flow/compactExporter.ts
```

MVP 0.1.6 should extend this layer. It should not modify:

```text
src/server/recorder/crxRecorderApp.ts
src/server/recorder/crxPlayer.ts
playwright/**
```

## 3. Business hint attributes to read

The plugin should support these generic attributes:

```text
data-testid
data-test-id
data-e2e
data-e2e-component
data-e2e-role
data-e2e-action
data-e2e-field-name
data-e2e-field-kind
data-e2e-form-kind
data-e2e-table
data-row-key
data-column-key
data-e2e-overlay
```

Compatibility note:

- `data-testid` remains the primary test id.
- `data-e2e` is accepted only as compatibility input.
- `data-e2e-*` attributes are semantic metadata, not the primary locator contract.

## 4. Generic mapping into UiSemanticContext

### Test ID

Any `data-testid`, `data-test-id`, or `data-e2e` on the anchor or relevant ancestor should become:

```ts
UiSemanticContext.targetTestId
UiLocatorHint { kind: 'testid', value, score: high }
```

### Component kind

```text
data-e2e-component="pro-table"       → component='pro-table', library='pro-components'
data-e2e-component="pro-form-field"  → component='pro-form-field', library='pro-components'
data-e2e-component="select"          → component='select', library='antd'
data-e2e-component="cascader"        → component='cascader', library='antd'
data-e2e-component="modal"           → component='modal', library='antd'
```

The adapter should map unknown values to `component='unknown'`, not throw.

### Field metadata

```text
data-e2e-field-name="destVrfId" → ui.form.name
data-e2e-field-kind="select"    → ui.form.fieldKind
data-e2e-form-kind="modal-form" → ui.form.formKind
```

Do not collect field values from attributes.

### Table metadata

```text
data-e2e-table="ip-port-pool" → ui.table.title or metadata table id
data-row-key="123"            → ui.table.rowKey
data-column-key="option"      → ui.table.columnKey
```

If `data-e2e-table` is technical and not user-facing, store it as a stable table id. Compact export can output it as `table` only if it is not sensitive and is reasonably short.

### Action metadata

```text
data-e2e-action="create" → recipe target/action role
```

Use action metadata to improve `UiActionRecipe.kind`, for example:

```text
create + pro-table toolbar → protable-toolbar-action
edit + table row           → table-row-action
delete + table row         → table-row-action
confirm + popconfirm       → confirm-popconfirm
```

## 5. Fallback order

The fallback order must be:

```text
1. Business hints: data-testid + data-e2e-* + data-row-key
2. AntD / ProComponents semantic detection
3. Generic DOM / ARIA / role / label / text
4. Weak fallback
```

Do not invert this order. Business hints are the stable contract; `.ant-*` classes are detector fallback only.

## 6. Suggested implementation points

### `examples/recorder-crx/src/uiSemantics/types.ts`

Add compact business hint fields if needed:

```ts
export interface UiBusinessHints {
  component?: UiComponentKind | string;
  role?: string;
  action?: string;
  fieldName?: string;
  fieldKind?: string;
  formKind?: string;
  table?: string;
  rowKey?: string;
  columnKey?: string;
  overlay?: string;
}
```

Do not expose this directly to compact export unless sanitized.

### `examples/recorder-crx/src/uiSemantics/antd.ts`

Add a helper near existing collector utilities:

```ts
function collectBusinessHints(anchor: Element): UiBusinessHints {
  const hintRoot = closestWithin(anchor, '[data-e2e-component], [data-e2e-field-name], [data-e2e-table], [data-row-key], [data-e2e-action]') || anchor;
  return compactObject({
    component: hintRoot.getAttribute('data-e2e-component') || undefined,
    role: hintRoot.getAttribute('data-e2e-role') || undefined,
    action: hintRoot.getAttribute('data-e2e-action') || undefined,
    fieldName: hintRoot.getAttribute('data-e2e-field-name') || undefined,
    fieldKind: hintRoot.getAttribute('data-e2e-field-kind') || undefined,
    formKind: hintRoot.getAttribute('data-e2e-form-kind') || undefined,
    table: hintRoot.getAttribute('data-e2e-table') || undefined,
    rowKey: hintRoot.getAttribute('data-row-key') || undefined,
    columnKey: hintRoot.getAttribute('data-column-key') || undefined,
    overlay: hintRoot.getAttribute('data-e2e-overlay') || undefined,
  });
}
```

Then merge the hints into the existing `collectAntdSemanticContext()` output:

```ts
const hints = collectBusinessHints(anchor);
const component = normalizeHintComponent(hints.component) || detectAntdComponent(anchor, target);
const form = mergeFormHints(collectForm(anchor, component), hints);
const table = mergeTableHints(collectTable(anchor, component), hints);
const recipe = buildUiRecipe(...);
```

Keep the logic generic.

### `examples/recorder-crx/src/uiSemantics/compact.ts`

Compact output should remain stable:

```ts
library
component
recipe
formKind
fieldKind
field
fieldName
option
table
row
column
overlay
target
targetTestId
confidence
weak
```

Do not output raw `businessHints` as a nested object.

### `examples/recorder-crx/src/flow/exportSanitizer.ts`

Ensure any new hint fields follow existing compact sanitizer. Do not let new raw hint fields bypass sanitization via:

```text
step.target.raw.ui
step.context.before.ui
step.uiRecipe
```

### `examples/recorder-crx/src/aiIntent/prompt.ts`

AI input may include compact business hints through compact UI fields only. It must not include:

```text
locatorHints
reasons
rowText
overlay.text
option.value
full URL query/hash
rawAction
sourceCode
```

## 7. Generic adapter layer vs business-specific configuration

MVP 0.1.6 should not introduce a `networking` config file in `playwright-crx`.

Avoid:

```ts
if (testId.startsWith('site-ip-port-pool')) ...
if (targetText.includes('WAN')) ...
```

Allowed generic config:

```ts
const businessComponentAliases = {
  'protable': 'pro-table',
  'pro-form-field': 'pro-form-field',
  'cascader': 'cascader',
};
```

But even this should be driven by generic attribute values, not by domain names.

## 8. Relation to PR #10 feature flags and diagnostics

PR #10 defines:

```ts
semanticAdapterEnabled
semanticAdapterDiagnosticsEnabled
```

MVP 0.1.6 must respect them.

If semantic adapter is disabled:

```text
Do not collect business hints into ui.
Do not write FlowStep.uiRecipe from business hints.
Do not emit semantic diagnostics except disabled diagnostic when diagnostics flag is on.
```

Diagnostics should mention when a business hint was used, but only compactly:

```ts
{
  event: 'semantic.detect',
  library: 'pro-components',
  component: 'pro-table',
  targetTestId: 'site-ip-port-pool-table',
  recipeKind: 'table-row-action',
  reasons: ['business-hint.component', 'business-hint.row-key']
}
```

Do not store raw row text.

## 9. How business hints improve existing adapter behavior

### Existing no-hint path

```text
click target span/svg
  ↓
find nearest AntD button/table/modal by class
  ↓
maybe infer component
```

### MVP 0.1.6 hinted path

```text
click target span/svg
  ↓
nearest actionable ancestor has data-testid + data-e2e-action
  ↓
UiSemanticContext has targetTestId + action role
  ↓
recipe becomes table-row-action / protable-toolbar-action
```

This reduces page-specific corner cases without making the plugin domain-specific.

## 10. Tests to add in plugin repo

### Flow/unit tests

Add or extend:

```text
examples/recorder-crx/src/flow/stepStability.test.ts
examples/recorder-crx/src/uiSemantics/uiSemantics.test.ts, if present or practical
```

Required cases:

```text
business hint data-e2e-component=pro-table maps to component pro-table
business hint data-e2e-field-name maps to ui.form.name
business hint data-row-key maps to ui.table.rowKey
business hint targetTestId wins over AntD CSS fallback
unknown data-e2e-component does not throw and results in weak/unknown fallback
compact export excludes raw business hints
```

### CRX E2E tests

Extend:

```text
tests/crx/semanticAdapter.spec.ts
```

Add a fixture containing:

```html
<div data-testid="pilot-table" data-e2e-component="pro-table" data-e2e-table="pilot-table">
  <table>
    <tr data-testid="pilot-row" data-row-key="row-1">
      <td>Row 1</td>
      <td><button data-testid="pilot-row-edit-action" data-e2e-action="edit">Edit</button></td>
    </tr>
  </table>
</div>
```

Expected:

```text
ui.library = pro-components
ui.component = pro-table
ui.table.rowKey = row-1
ui.recipe.kind = table-row-action
```

Also add a form/select fixture:

```html
<div data-testid="pilot-field" data-e2e-component="pro-form-field" data-e2e-field-name="destVrfId" data-e2e-field-kind="select">
  <div class="ant-select" data-testid="pilot-select">...</div>
</div>
```

Expected:

```text
ui.form.name = destVrfId
ui.form.fieldKind = select
recipe.kind = select-option or raw field recipe depending on interaction
```

## 11. Export/privacy boundary

The plugin can read business hints, but exports only compact fields.

Allowed in compact export:

```yaml
ui:
  library: pro-components
  component: pro-table
  recipe: table-row-action
  table: ip-port-pool
  row: "123"
  target: edit
  targetTestId: site-ip-port-pool-row-edit-action
```

Not allowed:

```yaml
locatorHints: ...
reasons: ...
rowText: ...
overlayText: ...
optionValue: ...
rawBusinessHints: ...
```

## 12. Rollback

If business hint parsing causes false positives:

1. Disable semantic adapter with PR #10 setting.
2. Or remove business-hint merge while keeping AntD/ProComponents detector.
3. Business repo can keep `data-testid`; plugin simply ignores optional `data-e2e-*` hints.
