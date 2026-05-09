# WAN and IP Pools Realistic Coverage Plan

## 1. Scope

WAN/IP Pools are used as realistic AntD/ProComponents fixture scenarios because PR #11 already introduced business-equivalent tests and fixtures. They are **not** production rules to hardcode into plugin core.

The purpose is to validate generic behaviors:

```text
Select option replay
multi-select replay
modal form submit
ProTable row action scoping
duplicate data-testid handling
Popconfirm confirm scoping
row appears/disappears terminal assertions
radio/number input terminal assertions
```

## 2. Existing fixture baseline

Current fixture path:

```text
tests/server/antd-wan-transport-real.html
tests/server/src/antdWanTransportRealApp.tsx
```

The fixture includes:

```text
ProTable
Modal
ProForm
ProFormSelect
ProFormRadio
ProFormDigit
Popconfirm
row edit/delete actions
toolbar create button
semantic business hints
```

## 3. Coverage targets

### Scenario A — Add transport network

Interactions:

```text
click toolbar add
modal opens
select transport option
select tags option(s)
choose radio value
fill number threshold
submit modal
```

Terminal assertions:

```text
modal is hidden after submit
row with selected transport appears
row contains selected tag token
row contains selected FEC/threshold if visible
```

Negative regressions:

```text
placeholder option must not be clicked
modal submit must not be treated as field fill
selected value must not be derived from raw option value
```

### Scenario B — Delete transport row

Interactions:

```text
click row delete action
visible Popconfirm appears
click confirm
```

Terminal assertions:

```text
Popconfirm hidden
row disappears or row count decreases
```

Negative regressions:

```text
global duplicate row delete test id must not be emitted
confirmation must not be a tooltip role click
blind wait must not be used
```

### Scenario C — Edit transport row

Interactions:

```text
click row edit
modal opens with row context
change select/radio/number field
submit
```

Terminal assertions:

```text
modal closes
row content updates
same row key remains or changed key is explicitly handled
```

Negative regressions:

```text
row action must be scoped by table/row context
old row context must not be lost after modal opens
```

### Scenario D — IP Pool create/edit/delete equivalent

The raw downstream archive is omitted, so this is implemented in plugin fixture as a business-equivalent scenario.

Interactions:

```text
ProTable toolbar create
ModalForm fields
Select/Cascader-like field
submit
row edit
row delete with Popconfirm
```

Terminal assertions:

```text
created row appears
edited row text/token changes
deleted row disappears
```

## 4. Where to add tests

Likely files:

```text
tests/crx/humanLikeRecorder.spec.ts
tests/crx/businessFlowRecorder.spec.ts
tests/crx/semanticAdapter.spec.ts
tests/server/src/antdWanTransportRealApp.tsx
examples/recorder-crx/src/flow/stepStability.test.ts
```

## 5. Test data rules

Use stable fixture-only data. Do not use sensitive downstream values.

Allowed examples:

```text
row-nova-public
Nova 公网
controller
business
```

If unsure, use symbolic test data:

```text
[Test Transport A]
[Test Tag A]
row-test-a
```

Do not use credentials, tokens, real customer names, private IPs from production, or raw downstream archive content.

## 6. Acceptance gates

Before merge:

```bash
npm run test:flow --prefix examples/recorder-crx
xvfb-run -a npx playwright test -c tests/playwright.config.ts \
  tests/crx/humanLikeRecorder.spec.ts tests/crx/businessFlowRecorder.spec.ts tests/crx/semanticAdapter.spec.ts \
  --project=Chrome --workers=1 --reporter=line --global-timeout=900000
xvfb-run -a npx playwright test -c tests/playwright.config.ts \
  --project=Chrome --workers=1 --reporter=line --global-timeout=1200000
npm run build
git diff --check
```

## 7. What not to do

Do not:

```text
hardcode WAN/IP Pools in plugin production logic
replace real AntD/ProComponents fixture with mock DOM only
remove existing negative assertions
use waitForTimeout instead of terminal-state assertions
store full row text or raw values in exported flow
```
