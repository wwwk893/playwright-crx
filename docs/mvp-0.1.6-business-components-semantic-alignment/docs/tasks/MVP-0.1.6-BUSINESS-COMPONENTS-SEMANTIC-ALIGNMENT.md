# MVP 0.1.6: Business Components Semantic Alignment

## 1. Goals

MVP 0.1.6 aligns the company frontend business components with the generic semantic adapter in `playwright-crx`.

The goal is not to make the plugin understand the `networking` domain by name. The goal is to make business components expose generic, stable hints that any enterprise app can use:

```text
stable data-testid
semantic component kind
form field name / label
row key
table region
overlay scope
action role
```

After MVP 0.1.6, the same Playwright CRX semantic adapter should work better on:

- the uploaded `networking/` business module;
- other AntD / ProComponents modules in the same company frontend;
- future business repositories that adopt the same contract.

## 2. Non-goals

Do not do these in MVP 0.1.6:

```text
MVP 0.1.7 recipe → Playwright preview helper/codegen
MVP 0.1.8 Storybook / Playwright CT corpus
MVP 0.1.9 AI scoring dashboard
MVP 0.2 Flow → Playwright spec generation / Runner / Native Messaging / CI automation
rewriting Playwright recorder/player
turning business labels into plugin hardcoded rules
adding Cypress or third-party AntD helper runtime dependency
embedding secrets or raw business data into data-testid
```

## 3. Assumptions

1. PR #10 / MVP 0.1.5 has been merged or is available as the base design.
2. `semanticAdapterEnabled` and `semanticAdapterDiagnosticsEnabled` exist and remain plugin-side feature flags.
3. The business repo currently uses `data-testid` in several places and already has `e2eId` in some wrappers, for example:
   - `networking/components/VrfSelection.tsx`
   - `networking/Site/Detail/index.tsx`
   - `networking/Site/Detail/Device/components/IpPools/components/IpPortPool/index.tsx`
   - `networking/Site/Detail/Network/components/DeviceWan.tsx`
   - `networking/Site/Detail/Security/components/SecurityDnat.tsx`
   - `networking/Site/Detail/Security/components/snat/ui/SnatTable.tsx`
4. Some referenced shared components are outside the provided `networking.zip`, such as:
   - `@/components/StrictModalComponents/StrictModalForm`
   - `@/components/StrictModalComponents/StrictModal`
   - `@/components/CompactTable`
   - `@/components/WanBindingCascader`
   - `@/components/V4AndV6Table`
   - `@/components/SiteSelect`
   - `@/components/TrafficMarkSelect`
   - `@/utils/e2eTestId`

The business repo implementation agent must inspect the full business repo before modifying these referenced files.

## 4. Repo-by-repo responsibilities

### Business frontend repo

Owns the contract emission:

```text
Add stable test ids.
Expose e2eId / e2eIds props on wrappers.
Forward identifiers to real DOM targets.
Avoid leaking business secrets or user-visible text into ids.
Add pilot page instrumentation and business repo tests.
```

### `playwright-crx` repo

Owns generic consumption:

```text
Read data-testid and optional semantic data attributes.
Map them into UiSemanticContext without networking-specific names.
Prefer business hints over AntD DOM fallback.
Keep export / compact / AI input sanitization strict.
Add CRX tests proving the hints improve semantic context.
```

## 5. Task list

### Task A — Business repo: introduce shared E2E contract utilities

Add or extend a shared utility near the existing `@/utils/e2eTestId` pattern.

Candidate path in business repo:

```text
src/utils/e2eTestId.ts
```

If the file already exists, extend it. If it does not exist, create it in the business repo root, not inside `networking/`.

Required helpers:

```ts
export type E2eIds = Partial<{
  root: string;
  field: string;
  input: string;
  trigger: string;
  popup: string;
  optionPrefix: string;
  table: string;
  row: string;
  toolbar: string;
  create: string;
  search: string;
  batch: string;
  pagination: string;
  modal: string;
  drawer: string;
  ok: string;
  cancel: string;
  popconfirm: string;
}>;

export function testId(id?: string): Record<string, string>;
export function e2eField(id?: string, fieldName?: string, fieldKind?: string): Record<string, string>;
export function e2eComponent(id?: string, component?: string): Record<string, string>;
export function rowTestId(id: string, rowKey?: string | number): Record<string, string>;
export function actionTestId(base: string, action: string): string;
```

Rules:

- render as `data-testid`, not `data-e2e`;
- optional semantic hints can use `data-e2e-*` attributes, but only for generic metadata, not values;
- do not encode raw secret values or long business data in attributes;
- `rowTestId()` should emit a stable row test id plus `data-row-key`.

### Task B — Business repo: adapt shared wrappers first

Priority wrappers based on `networking.zip` references:

```text
@/components/StrictModalComponents/StrictModalForm
@/components/StrictModalComponents/StrictModal
@/components/WanBindingCascader
@/components/CompactTable
@/components/V4AndV6Table
@/components/V4AndV6Table/VirtualTable
@/components/SiteSelect/SiteSelect
@/components/TrafficMarkSelect
OverrideSelect, referenced in networking/Site/Detail/Vrf/index.tsx and networking/components/Network/Internet.tsx
```

Do not force all wrappers to be perfect in one PR. Required minimum:

```text
StrictModalForm / StrictModal: modal/drawer root + ok/cancel buttons.
WanBindingCascader / DeviceWan: root/trigger/popup/optionPrefix.
V4AndV6Table / VirtualTable / CompactTable-related wrappers: table root, tab prefix, row id, toolbar/create/search/batch/pagination regions.
```

### Task C — Business repo: pilot page instrumentation

First pilot should focus on `networking/Site/Detail/Device/components/IpPools` because it already contains clear test IDs and meaningful complexity.

Required files:

```text
networking/Site/Detail/Device/components/IpPools/components/IpPortPool/index.tsx
networking/Site/Detail/Device/components/IpPools/components/IpPortPool/UpdateForm.tsx
networking/Site/Detail/Device/components/IpPools/components/IpAddressPool/index.tsx
networking/Site/Detail/Device/components/IpPools/components/IpAddressPool/UpdateForm.tsx
networking/Site/Detail/Device/components/IpPools/components/IpAddressPool/V6UpdateForm.tsx
networking/Site/Detail/Network/components/DeviceWan.tsx
```

Add only missing contract fields. Preserve existing `data-testid` values where already present.

### Task D — Business repo: second pilot coverage for table/popconfirm/tooltip/virtual table

Recommended second pilot:

```text
networking/Site/Detail/Security/components/SecurityDnat.tsx
networking/Site/Detail/Security/components/snat/ui/SnatTable.tsx
networking/Site/Detail/Security/components/snat/form/SnatFormBase.tsx
networking/Site/Detail/Security/components/snat/form/SnatFormV4Fields.tsx
networking/Site/Detail/Security/components/snat/form/SnatFormV6Fields.tsx
```

Covers:

```text
ProTable / VirtualTable
row actions
toolbar search/create
tooltip
modal form
select/cascader-like business fields
```

### Task E — Business repo: optional third pilot for EditableProTable

Recommended third pilot:

```text
networking/Site/Detail/Network/components/TrafficClass/index.tsx
networking/Site/Detail/Network/components/TrafficClass/UpdateForm.tsx
networking/Site/Detail/Network/components/DeviceWan.tsx
```

Covers:

```text
ProTable
StrictModal
ProForm
EditableProTable
DeviceWan / WanBindingCascader
ProFormRadio / ProFormCheckbox / Select
```

This can be included in MVP 0.1.6 if PR size is still reasonable. If not, make it the first follow-up business PR after the IP pools pilot.

### Task F — `playwright-crx`: consume generic business hints

Modify only generic semantic adapter files:

```text
examples/recorder-crx/src/uiSemantics/types.ts
examples/recorder-crx/src/uiSemantics/antd.ts
examples/recorder-crx/src/uiSemantics/index.ts
examples/recorder-crx/src/uiSemantics/compact.ts
examples/recorder-crx/src/pageContextSidecar.ts
examples/recorder-crx/src/flow/exportSanitizer.ts
examples/recorder-crx/src/aiIntent/prompt.ts
examples/recorder-crx/src/flow/stepStability.test.ts
tests/crx/semanticAdapter.spec.ts
```

Add generic support for:

```text
data-testid
data-e2e-component
data-e2e-role
data-e2e-field-name
data-e2e-field-kind
data-e2e-table
data-row-key
data-column-key
data-e2e-action
data-e2e-overlay
```

Do not add strings like `site-ip-port-pool` or `WAN` to plugin logic.

### Task G — Tests

Business repo tests should validate wrapper prop passthrough. Plugin repo tests should validate generic consumption.

Detailed test plan is in:

```text
docs/testing/MVP_0.1.6_ACCEPTANCE_TEST_PLAN.md
```

## 6. Acceptance criteria

### Business repo

- Existing `data-testid` values are preserved.
- New `e2eId` / `e2eIds` props are optional and do not change visual UI.
- Wrapper components pass IDs to actual clickable/input/overlay DOM nodes.
- `StrictModalForm` / `StrictModal` can expose modal root and ok/cancel buttons.
- Select/Cascader-like wrappers expose trigger and option/popup hints where possible.
- Table wrappers expose table root, row key, toolbar/create/search, batch, pagination, and row actions.
- Pilot pages can be manually inspected in browser DevTools and show stable `data-testid` / `data-e2e-*` attributes.

### Plugin repo

- Business hints are preferred over AntD DOM fallback.
- Missing business hints still fall back to AntD / ProComponents semantics.
- Unknown DOM still maps to `library: 'unknown'`.
- Compact export and AI input do not include over-collected data.
- Feature flags from PR #10 still disable semantic adapter cleanly.
- Tests pass:

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build:examples:recorder
npm run build:tests
xvfb-run -a npx playwright test -c tests/playwright.config.ts tests/crx/semanticAdapter.spec.ts --project=Chrome --workers=1 --reporter=line --global-timeout=300000
npm run build:crx
```

## 7. Rollback strategy

### Business repo rollback

Because all new props are optional and only emit attributes, rollback is simple:

```text
Remove or stop passing e2eId/e2eIds from pilot pages.
Keep wrapper prop types if harmless.
Disable pilot-specific tests if they only assert attributes.
```

Do not remove existing `data-testid` values.

### Plugin repo rollback

Use PR #10 feature flag:

```text
semanticAdapterEnabled=false
```

If a bug is isolated to business hint parsing, revert only the business-hint collector while keeping AntD / ProComponents semantic adapter intact.
