# Business Wrapper Adaptation Strategy

## 1. Purpose

The company frontend should emit stable, generic semantic hints from business wrappers so `playwright-crx` can recognize components without hardcoding `networking` domain names.

The business repo owns:

```text
where identifiers are rendered
which wrapper prop maps to which DOM node
which business row key is stable
which form field name is stable
```

The plugin owns:

```text
reading generic attributes
mapping them to UiSemanticContext
sanitizing export / AI input
falling back to AntD / ProComponents semantics when hints are absent
```

## 2. Priority wrapper list based on networking.zip

The uploaded `networking.zip` shows repeated use of these wrapper/component families.

### P0 wrappers / helpers

These should be adapted first because many pilot pages depend on them:

```text
@/components/StrictModalComponents/StrictModalForm
@/components/StrictModalComponents/StrictModal
@/components/WanBindingCascader
@/components/V4AndV6Table
@/components/V4AndV6Table/VirtualTable
@/components/CompactTable
@/utils/e2eTestId
```

Observed from files such as:

```text
networking/Site/Detail/Device/components/IpPools/components/IpPortPool/UpdateForm.tsx
networking/Site/Detail/Network/components/DeviceWan.tsx
networking/Site/Detail/Security/components/snat/ui/SnatTable.tsx
networking/Site/Detail/Security/components/SecurityDnat.tsx
networking/Site/Detail/Network/components/TrafficClass/UpdateForm.tsx
```

### P1 wrappers / composite components

```text
@/components/SiteSelect/SiteSelect
@/components/TrafficMarkSelect
OverrideSelect, referenced in networking/Site/Detail/Vrf/index.tsx and networking/components/Network/Internet.tsx
VrfSelection, observed at networking/components/VrfSelection.tsx
DeviceWan, observed at networking/Site/Detail/Network/components/DeviceWan.tsx
TransportSelection, observed at networking/Site/Detail/Device/components/Wan/Config/TransportSelection.tsx
```

### P2 individual pages/forms

```text
networking/components/Network/NetworkTrafficForm.tsx
networking/components/InputFireWall/InputFireWallForm.tsx
networking/Site/Detail/Device/components/Wan/*
networking/Site/Detail/Network/components/TrafficClass/*
networking/Site/Detail/Security/components/snat/*
```

These are complex but should be instrumented after shared wrappers, otherwise the PR becomes too wide.

## 3. Minimal invasive pattern

### Pattern A — pass through `e2eId`

Use when the component has one primary target.

```ts
type Props = {
  e2eId?: string;
};
```

Example:

```tsx
const DeviceWan: React.FC<Props> = ({ e2eId, ...props }) => {
  return <WanBindingCascader {...props} e2eId={e2eId} />;
};
```

This pattern already exists in `networking/Site/Detail/Network/components/DeviceWan.tsx`.

### Pattern B — pass through `e2eIds`

Use when the component has multiple internal targets.

```ts
export type E2eIds = Partial<{
  root: string;
  trigger: string;
  input: string;
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
  ok: string;
  cancel: string;
  popconfirm: string;
}>;

export type WithE2eProps = {
  e2eId?: string;
  e2eIds?: E2eIds;
};
```

### Pattern C — wrapper data attributes

Use generic metadata, not domain data.

```tsx
<div
  data-testid={e2eIds?.field}
  data-e2e-component="pro-form-field"
  data-e2e-field-name="destVrfId"
  data-e2e-field-kind="select"
>
  {children}
</div>
```

### Pattern D — row identity

Use stable row key metadata.

```tsx
<tr data-testid="site-dnat-row" data-row-key={String(record.id)} />
```

If the existing helper `rowTestId()` exists in `@/utils/e2eTestId`, extend it rather than duplicating row logic in pages.

## 4. TypeScript prop design

Recommended shared types:

```ts
export type E2eId = string;

export type E2eIds = Partial<{
  root: E2eId;
  field: E2eId;
  input: E2eId;
  trigger: E2eId;
  popup: E2eId;
  optionPrefix: E2eId;
  table: E2eId;
  row: E2eId;
  toolbar: E2eId;
  create: E2eId;
  search: E2eId;
  batch: E2eId;
  pagination: E2eId;
  modal: E2eId;
  drawer: E2eId;
  ok: E2eId;
  cancel: E2eId;
  popconfirm: E2eId;
}>;

export type WithE2eProps = {
  e2eId?: E2eId;
  e2eIds?: E2eIds;
};
```

Do not require every component to implement every field. Implement the nodes that exist.

## 5. Wrapper examples

### 5.1 StrictModalForm

Observed in many files, including:

```text
networking/Site/Detail/Device/components/IpPools/components/IpPortPool/UpdateForm.tsx
networking/Vrf/components/UpdateForm.tsx
networking/Profile/components/UpdateForm.tsx
networking/components/Network/NetworkTrafficForm.tsx
```

Recommended wrapper API:

```ts
type StrictModalFormProps = ExistingProps & {
  e2eId?: string;
  e2eIds?: Pick<E2eIds, 'modal' | 'ok' | 'cancel'>;
};
```

Implementation strategy:

```tsx
<ModalForm
  {...props}
  modalProps={{
    ...props.modalProps,
    'data-testid': props.e2eIds?.modal || props.e2eId || props.modalProps?.['data-testid'],
    okButtonProps: {
      ...props.modalProps?.okButtonProps,
      ...(props.e2eIds?.ok ? { 'data-testid': props.e2eIds.ok } : {}),
    },
    cancelButtonProps: {
      ...props.modalProps?.cancelButtonProps,
      ...(props.e2eIds?.cancel ? { 'data-testid': props.e2eIds.cancel } : {}),
    },
  } as any}
/>
```

Do not change submit behavior.

### 5.2 StrictModal

Recommended API:

```ts
type StrictModalProps = ExistingProps & {
  e2eId?: string;
  e2eIds?: Pick<E2eIds, 'modal' | 'ok' | 'cancel'>;
};
```

Implementation:

```tsx
<Modal
  {...props}
  data-testid={props.e2eIds?.modal || props.e2eId}
  okButtonProps={{
    ...props.okButtonProps,
    ...(props.e2eIds?.ok ? { 'data-testid': props.e2eIds.ok } : {}),
  }}
  cancelButtonProps={{
    ...props.cancelButtonProps,
    ...(props.e2eIds?.cancel ? { 'data-testid': props.e2eIds.cancel } : {}),
  }}
/>
```

If AntD type definitions reject `data-testid`, use `as any` only at the prop boundary.

### 5.3 WanBindingCascader / DeviceWan

Observed pattern:

```text
networking/Site/Detail/Network/components/DeviceWan.tsx
```

`DeviceWan` already accepts `e2eId` and passes it to `WanBindingCascader`.

Recommended next step:

```ts
type DeviceWanProps = ExistingProps & {
  e2eId?: string;
  e2eIds?: Pick<E2eIds, 'trigger' | 'popup' | 'optionPrefix'>;
};
```

Business wrapper should render:

```text
trigger: data-testid={e2eIds.trigger || e2eId}
popup: data-testid={e2eIds.popup}
options: data-testid={`${e2eIds.optionPrefix}-${stableOptionKey}`}
```

If option keys are sensitive or unstable, emit only:

```text
data-e2e-component="cascader-option"
data-e2e-option-level="..."
```

and let visible text be used by the plugin during capture.

### 5.4 V4AndV6Table / VirtualTable

Observed in:

```text
networking/Site/Detail/Security/components/snat/ui/SnatTable.tsx
networking/Site/Detail/Device/components/IpPools/components/IpAddressPool/index.tsx
networking/Site/Detail/Device/components/Lan/RouteStatic/index.tsx
networking/Site/Detail/Device/components/Wan/RouteStatic/index.tsx
```

Existing props in observed files include:

```text
tableTestId
rowTestId
createButtonTestId
tabTestIdPrefix
```

Recommended API extension:

```ts
type V4AndV6TableE2eProps = {
  tableTestId?: string;
  rowTestId?: string;
  createButtonTestId?: string;
  tabTestIdPrefix?: string;
  e2eIds?: Pick<E2eIds, 'search' | 'toolbar' | 'batch' | 'pagination'>;
};
```

Wrapper should emit:

```text
table root: data-testid={tableTestId}, data-e2e-component="pro-table"
rows: data-testid={rowTestId}, data-row-key
v4 tab: data-testid={`${tabTestIdPrefix}-ipv4-tab`}
v6 tab: data-testid={`${tabTestIdPrefix}-ipv6-tab`}
create: data-testid={createButtonTestId}
search: data-testid={e2eIds.search}
pagination: data-testid={e2eIds.pagination}
```

### 5.5 CompactTable / useCompactTable

Observed usage:

```text
networking/Site/Detail/Device/components/IpPools/components/IpPortPool/index.tsx
networking/Site/Detail/Security/components/SecurityDnat.tsx
networking/Site/Detail/Device/components/Wan/RouteStatic/index.tsx
```

`useCompactTable()` already receives `tableId` such as:

```text
site-detail:global:ip-port-pool
site-detail:vrf:dnat
```

Do not expose this colon-separated internal table id as `data-testid` directly. Instead use it as semantic metadata:

```tsx
<div data-e2e-table={tableId} />
```

or convert to kebab if needed:

```text
site-detail-global-ip-port-pool
```

### 5.6 ProForm / ProForm fields

For individual `ProFormText`, `ProFormSelect`, `ProFormRadio.Group`, `ProFormCheckbox`, `ProFormSwitch`, wrap or pass `fieldProps`:

```tsx
<ProFormSelect
  name="destVrfId"
  label={t('...')}
  fieldProps={{
    'data-testid': 'site-ip-port-pool-vrf-select',
    'data-e2e-field-name': 'destVrfId',
    'data-e2e-field-kind': 'select',
  } as any}
/>
```

When `fieldProps` only lands on inner input and not enough context, add a field wrapper:

```tsx
<div
  data-testid="site-ip-port-pool-vrf-field"
  data-e2e-component="pro-form-field"
  data-e2e-field-name="destVrfId"
  data-e2e-field-kind="select"
>
  <ProFormSelect ... />
</div>
```

### 5.7 Popconfirm

For row delete confirmation:

```tsx
<Popconfirm
  title={...}
  okButtonProps={{ 'data-testid': 'site-dnat-delete-confirm-ok-button' } as any}
  cancelButtonProps={{ 'data-testid': 'site-dnat-delete-confirm-cancel-button' } as any}
>
  <a data-testid="site-dnat-row-delete-action">...</a>
</Popconfirm>
```

If current code deletes directly without Popconfirm, do not add Popconfirm in MVP 0.1.6 just for testing. Instrument existing behavior only.

### 5.8 Tooltip / Popover

For icon-only tooltip triggers:

```tsx
<Tooltip title={...}>
  <QuestionCircleOutlined
    data-testid="site-dnat-search-help-trigger"
    data-e2e-component="tooltip-trigger"
  />
</Tooltip>
```

Do not encode tooltip content in test id.

## 6. Avoiding test-id leakage into UI

- `e2eId` and `e2eIds` must not affect rendered text, labels, validation, payload, or backend requests.
- Do not use `e2eId` in business branching logic.
- Do not serialize `e2eId` into submitted form values.
- Do not put raw user values into IDs.
- Do not use IDs as translation keys.

## 7. Compatibility with existing business logic

All new props must be optional.

Good:

```ts
e2eId?: string;
e2eIds?: E2eIds;
```

Bad:

```ts
e2eId: string; // required, forces all callsites to change
```

Do not change existing props or callbacks:

```text
onFinish
onOpenChange
onChange
value
rowKey
columns
toolBarRender
recordCreatorProps
editable
```

Only add pass-through attributes.

## 8. Recommended first business files to touch

### Shared / wrapper files, if present in full repo

```text
src/utils/e2eTestId.ts
src/components/StrictModalComponents/StrictModalForm.tsx
src/components/StrictModalComponents/StrictModal.tsx
src/components/WanBindingCascader/index.tsx
src/components/V4AndV6Table/index.tsx
src/components/V4AndV6Table/VirtualTable.tsx
src/components/CompactTable/index.tsx
```

### Pilot files from `networking.zip`

```text
networking/Site/Detail/Device/components/IpPools/components/IpPortPool/index.tsx
networking/Site/Detail/Device/components/IpPools/components/IpPortPool/UpdateForm.tsx
networking/Site/Detail/Device/components/IpPools/components/IpAddressPool/index.tsx
networking/Site/Detail/Device/components/IpPools/components/IpAddressPool/UpdateForm.tsx
networking/Site/Detail/Device/components/IpPools/components/IpAddressPool/V6UpdateForm.tsx
networking/Site/Detail/Network/components/DeviceWan.tsx
networking/Site/Detail/Security/components/SecurityDnat.tsx
networking/Site/Detail/Security/components/snat/ui/SnatTable.tsx
networking/Site/Detail/Network/components/TrafficClass/UpdateForm.tsx
```

Do not mass-edit all 261 TSX files in `networking.zip` in the first PR.
