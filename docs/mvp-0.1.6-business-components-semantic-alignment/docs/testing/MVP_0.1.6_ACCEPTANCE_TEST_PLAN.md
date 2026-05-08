# MVP 0.1.6 Acceptance Test Plan

## 1. Business repo tests

The business repo must test wrapper passthrough. Use the repo's existing test stack. If no test stack exists for components, add the lightest available unit/component tests or at minimum add a focused smoke page/manual verification checklist.

### 1.1 Shared utility tests

Target path, if present or created:

```text
src/utils/e2eTestId.ts
```

Required assertions:

```text
testId('x') returns { 'data-testid': 'x' }
rowTestId('table-row', 123) returns data-testid + data-row-key
rowTestId does not include row text
empty id returns empty object or undefined-safe object
```

### 1.2 StrictModalForm / StrictModal tests

Target files in full business repo:

```text
src/components/StrictModalComponents/StrictModalForm.tsx
src/components/StrictModalComponents/StrictModal.tsx
```

Assertions:

```text
e2eId renders modal/root test id
e2eIds.ok renders ok button test id
e2eIds.cancel renders cancel button test id
existing modalProps are preserved
onOk/onCancel/onFinish behavior unchanged
```

### 1.3 Cascader/select wrapper tests

Target files referenced by `networking.zip`:

```text
src/components/WanBindingCascader/index.tsx
networking/Site/Detail/Network/components/DeviceWan.tsx
```

Assertions:

```text
e2eId is passed through to trigger/root
e2eIds.trigger/popup/optionPrefix are passed when supported
onChange/value behavior unchanged
no user-visible text changes
```

### 1.4 Table wrapper tests

Target files in full business repo:

```text
src/components/V4AndV6Table/index.tsx
src/components/V4AndV6Table/VirtualTable.tsx
src/components/CompactTable/index.tsx
```

Assertions:

```text
tableTestId reaches table root
rowTestId reaches rows
rows include data-row-key
createButtonTestId reaches create button
tabTestIdPrefix reaches IPv4/IPv6 tabs if used
search/toolbar/batch/pagination ids are optional and do not break existing calls
```

## 2. Business pilot validation

### Pilot 1: IP Port Pool

Files:

```text
networking/Site/Detail/Device/components/IpPools/components/IpPortPool/index.tsx
networking/Site/Detail/Device/components/IpPools/components/IpPortPool/UpdateForm.tsx
networking/Site/Detail/Device/components/IpPools/components/IpAddressPool/index.tsx
networking/Site/Detail/Device/components/IpPools/components/IpAddressPool/UpdateForm.tsx
```

Manual or automated DOM checks:

```text
site-ip-port-pool-table exists
site-ip-port-pool-row rows include data-row-key
site-ip-port-pool-create-button exists
site-ip-port-pool-modal exists
modal ok/cancel ids exist if wrapper supports them
site-ip-port-pool-address-pool-field exists and has data-e2e-field-name
site-ip-port-pool-address-pool-select exists
site-ip-port-pool-vrf-field exists and has data-e2e-field-name
site-ip-port-pool-vrf-select exists
```

Terminal-state assertions for pilot replay:

```text
After create, table row count increases or row with stable test data appears.
After edit, the row field visibly changes.
After delete/remove, the row disappears or count returns.
Modal closes after confirm.
Validation error appears if required fields are omitted.
```

Do not accept a false green that only proves the button was clicked.

### Pilot 2: DNAT / SNAT

Files:

```text
networking/Site/Detail/Security/components/SecurityDnat.tsx
networking/Site/Detail/Security/components/SecurityDnatForm.tsx
networking/Site/Detail/Security/components/snat/ui/SnatTable.tsx
```

Checks:

```text
site-dnat-table root exists
site-dnat-row rows include data-row-key
site-dnat-row-edit-action / delete / copy exist
site-dnat-search-keyword-field exists
site-dnat-create-button exists
site-snat-table root exists
site-snat-row rows include data-row-key
site-snat-search-keyword-field exists
site-snat-create-button exists
Tooltip trigger has stable test id if modified
```

Terminal-state assertions:

```text
Search filters visible row set.
Create opens modal.
Edit opens modal with selected row context.
Copy opens modal with copy state if applicable.
Delete modifies row set if current UI supports direct delete.
```

### Pilot 3: TrafficClass / EditableProTable

Files:

```text
networking/Site/Detail/Network/components/TrafficClass/index.tsx
networking/Site/Detail/Network/components/TrafficClass/UpdateForm.tsx
networking/Site/Detail/Network/components/DeviceWan.tsx
```

Checks:

```text
TrafficClass table root and rows expose ids.
Open modal exposes modal root.
Select field exposes trigger.
EditableProTable rows expose data-row-key.
EditableProTable cell fields expose data-e2e-field-name / data-column-key where practical.
DeviceWan passes e2eId/e2eIds to WanBindingCascader.
```

Terminal-state assertions:

```text
Adding/editing transport rows changes editable table row count or row content.
Choosing DeviceWan changes visible selected value.
Saving modal updates TrafficClass table or closes modal only after valid form.
```

## 3. `playwright-crx` flow/unit tests

Add or update tests in:

```text
examples/recorder-crx/src/flow/stepStability.test.ts
examples/recorder-crx/src/uiSemantics/uiSemantics.test.ts, if available
```

Required tests:

```text
data-e2e-component=pro-table maps to library=pro-components, component=pro-table
data-e2e-field-name maps to ui.form.name
data-e2e-field-kind maps to ui.form.fieldKind
data-row-key maps to ui.table.rowKey
data-e2e-action improves recipe target/action role
data-testid remains highest priority locator hint
business hints are sanitized in compact export
unknown business component hint does not crash
```

Validation command:

```bash
npm run test:flow --prefix examples/recorder-crx
```

## 4. `playwright-crx` CRX E2E tests

Add to:

```text
tests/crx/semanticAdapter.spec.ts
```

Required fixtures:

### Fixture A — business hinted ProTable

```html
<div data-testid="pilot-table" data-e2e-component="pro-table" data-e2e-table="pilot-table">
  <table>
    <tbody>
      <tr data-testid="pilot-row" data-row-key="row-1">
        <td>Name</td>
        <td><button data-testid="pilot-row-edit-action" data-e2e-action="edit">Edit</button></td>
      </tr>
    </tbody>
  </table>
</div>
```

Expected:

```text
ui.library=pro-components
ui.component=pro-table
ui.table.rowKey=row-1
ui.recipe.kind=table-row-action or protable-toolbar-action according to implementation
```

### Fixture B — business hinted ProForm Select

```html
<div data-testid="pilot-field" data-e2e-component="pro-form-field" data-e2e-field-name="destVrfId" data-e2e-field-kind="select">
  <div class="ant-select" data-testid="pilot-select">
    <div class="ant-select-selector">Select</div>
  </div>
</div>
```

Expected:

```text
ui.form.name=destVrfId
ui.form.fieldKind=select
ui.targetTestId=pilot-select or pilot-field according to anchor rules
```

### Fixture C — hinted modal / popconfirm

Expected:

```text
modal root test id preserved
ok/cancel test ids preserved
popconfirm action compacted without leaking overlay text
```

Validation command:

```bash
xvfb-run -a npx playwright test -c tests/playwright.config.ts tests/crx/semanticAdapter.spec.ts --project=Chrome --workers=1 --reporter=line --global-timeout=300000
```

## 5. Export validation

Use a flow containing business hints and ensure:

```text
business-flow.json includes compact ui only
compact-flow.yaml includes compact ui only
AI input includes compact ui only
no locatorHints
no reasons
no rowText
no overlay.text
no option.value
no rawAction/sourceCode in AI input
no full URL query/hash
```

Validation command:

```bash
npm run test:flow --prefix examples/recorder-crx
```

## 6. No mock / no blind sleep rules

Do not pass tests by:

```text
mocking collectUiSemanticContext entirely
mocking CRX E2E recorder output
removing semantic assertions
adding arbitrary waitForTimeout/sleep
asserting only that a click happened
```

The test must prove terminal business state or semantic state.

## 7. Full plugin validation commands

After plugin PR:

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build:examples:recorder
npm run build:tests
xvfb-run -a npx playwright test -c tests/playwright.config.ts tests/crx/semanticAdapter.spec.ts --project=Chrome --workers=1 --reporter=line --global-timeout=300000
npm run build:crx
git diff --check
```

## 8. Business repo validation commands

Because the full business repo was not included, exact scripts must be confirmed by the implementing agent. Suggested order:

```bash
npm run lint
npm run test
npm run build
```

If the business repo has focused component/E2E scripts, run the smallest relevant scripts for:

```text
networking/Site/Detail/Device/components/IpPools
networking/Site/Detail/Security/components
networking/Site/Detail/Network/components/TrafficClass
```

The agent must report exact commands used.
