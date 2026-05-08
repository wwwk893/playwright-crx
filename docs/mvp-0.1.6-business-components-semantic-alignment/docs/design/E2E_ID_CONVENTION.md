# E2E ID Convention for MVP 0.1.6

## 1. Decision

Use `data-testid` as the rendered DOM attribute.

Do not switch the business repo to `data-e2e` in MVP 0.1.6. The uploaded `networking/` code already uses `data-testid` in many important places, for example:

```text
networking/components/VrfSelection.tsx
networking/Site/Detail/index.tsx
networking/Site/Detail/Vrf/index.tsx
networking/Site/Detail/Device/components/IpPools/components/IpPortPool/index.tsx
networking/Site/Detail/Device/components/IpPools/components/IpPortPool/UpdateForm.tsx
networking/Site/Detail/Security/components/SecurityDnat.tsx
networking/Site/Detail/Security/components/snat/ui/SnatTable.tsx
```

The plugin should still read `data-e2e` and `data-test-id` for compatibility, but the company convention should be:

```tsx
<div data-testid="site-ip-port-pool-table" />
```

not:

```tsx
<div data-e2e="site-ip-port-pool-table" />
```

## 2. Naming style

Use lowercase kebab-case:

```text
<scope>-<feature>-<object>-<part>
```

Examples already close to the codebase:

```text
site-save-button
site-detail-vrf-selector
site-detail-vrf-option-<id>
site-global-page
site-vrf-config-tabs
site-dnat-table
site-dnat-row-edit-action
site-dnat-search-keyword-field
site-dnat-create-button
site-ip-port-pool-table
site-ip-port-pool-row
site-ip-port-pool-create-button
site-ip-port-pool-modal
site-ip-port-pool-address-pool-field
site-ip-port-pool-address-pool-select
site-ip-port-pool-vrf-field
site-ip-port-pool-vrf-select
site-snat-table
site-snat-row
site-snat-search-keyword-field
site-snat-create-button
```

## 3. Do not overfit domain labels

Avoid encoding translated labels or user-facing copy in IDs.

Good:

```text
site-ip-port-pool-create-button
site-ip-port-pool-address-pool-select
traffic-class-transport-table
```

Bad:

```text
新建IP端口地址池按钮
请选择共享地址池下拉框
```

Do not put raw user-entered values into `data-testid`.

For dynamic rows, prefer:

```tsx
<tr data-testid="site-ip-port-pool-row" data-row-key={String(record.id)} />
```

instead of:

```tsx
<tr data-testid={`site-ip-port-pool-row-${record.name}`} />
```

If a row-specific ID is already in use, keep it temporarily, but new code should prefer static row id + `data-row-key`.

## 4. Optional semantic attributes

`data-testid` is identity. Use optional `data-e2e-*` attributes for generic semantics only.

Allowed:

```tsx
<div
  data-testid="site-ip-port-pool-table"
  data-e2e-component="pro-table"
  data-e2e-table="ip-port-pool"
/>

<tr
  data-testid="site-ip-port-pool-row"
  data-row-key={String(record.id)}
/>

<div
  data-testid="site-ip-port-pool-vrf-field"
  data-e2e-component="pro-form-field"
  data-e2e-field-name="destVrfId"
  data-e2e-field-kind="select"
/>
```

Not allowed:

```tsx
data-e2e-value={sensitiveValue}
data-e2e-auth={sensitiveAuthValue}
data-e2e-row-text={fullRowText}
data-e2e-option-value={internalSensitiveValue}
```

## 5. Prop convention

For business components and wrappers, expose optional props:

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

export interface WithE2eProps {
  e2eId?: string;
  e2eIds?: E2eIds;
}
```

Rule:

```text
e2eId = primary root/trigger id
e2eIds = internal important DOM node ids
```

## 6. Simple component examples

### Button

```tsx
<Button data-testid="site-ip-port-pool-create-button">新建</Button>
```

### Input.Search

```tsx
<Input.Search
  data-testid="site-dnat-search-keyword-field"
  data-e2e-component="search-input"
/>
```

### Switch / Checkbox / Radio

```tsx
<ProFormSwitch
  name="enableQos"
  label={t('...')}
  fieldProps={{
    'data-testid': 'traffic-class-enable-qos-switch',
    'data-e2e-field-name': 'enableQos',
    'data-e2e-field-kind': 'switch',
  } as any}
/>
```

## 7. Composite component examples

### ProFormSelect inside a field wrapper

```tsx
<div
  data-testid="site-ip-port-pool-vrf-field"
  data-e2e-component="pro-form-field"
  data-e2e-field-name="destVrfId"
  data-e2e-field-kind="select"
>
  <ProFormSelect
    name="destVrfId"
    label={t('...')}
    fieldProps={{
      'data-testid': 'site-ip-port-pool-vrf-select',
    } as any}
  />
</div>
```

### Business Cascader wrapper

Observed pattern:

```text
networking/Site/Detail/Network/components/DeviceWan.tsx
  passes e2eId to WanBindingCascader
```

Recommended contract:

```tsx
<DeviceWan
  e2eId="traffic-class-transport-device-wan"
  e2eIds={{
    trigger: 'traffic-class-transport-device-wan-trigger',
    popup: 'traffic-class-transport-device-wan-popup',
    optionPrefix: 'traffic-class-transport-device-wan-option',
  }}
/>
```

If `WanBindingCascader` only supports `e2eId` in the first PR, keep that and add `e2eIds` in a follow-up.

### Table / ProTable

```tsx
<div
  data-testid="site-ip-port-pool-table"
  data-e2e-component="pro-table"
  data-e2e-table="ip-port-pool"
>
  <ProTable
    rowKey="id"
    onRow={(record) => ({
      'data-testid': 'site-ip-port-pool-row',
      'data-row-key': String(record.id),
    })}
    toolBarRender={() => [
      <Button data-testid="site-ip-port-pool-create-button">...</Button>,
    ]}
  />
</div>
```

### ModalForm / StrictModalForm

Observed pattern:

```text
networking/Site/Detail/Device/components/IpPools/components/IpPortPool/UpdateForm.tsx
  uses StrictModalForm and modalProps.data-testid = site-ip-port-pool-modal
```

Recommended contract:

```tsx
<StrictModalForm
  e2eId="site-ip-port-pool-modal"
  e2eIds={{
    ok: 'site-ip-port-pool-modal-ok-button',
    cancel: 'site-ip-port-pool-modal-cancel-button',
  }}
/>
```

If `StrictModalForm` cannot accept `e2eIds` yet, pass through AntD `modalProps`:

```tsx
modalProps={{
  'data-testid': 'site-ip-port-pool-modal',
  okButtonProps: { 'data-testid': 'site-ip-port-pool-modal-ok-button' } as any,
  cancelButtonProps: { 'data-testid': 'site-ip-port-pool-modal-cancel-button' } as any,
} as any}
```

## 8. Migration rules

1. Preserve existing `data-testid` values.
2. Do not rename existing IDs in MVP 0.1.6 unless they are clearly broken.
3. Add missing `data-testid` at wrapper/root level first.
4. Add optional semantic attributes second.
5. For dynamic row identity, migrate toward static `data-testid` + `data-row-key`.
6. Do not add IDs to every DOM node. Add IDs only to:
   - page/section roots;
   - table roots and rows;
   - toolbar/search/create/batch actions;
   - modal/drawer roots and footer actions;
   - form field wrappers and real controls;
   - composite trigger/popup/option hooks.

## 9. Attribute privacy rules

Never put these into IDs or semantic attributes:

```text
passwords
API keys
tokens
cookies
authorization headers
customer secrets
full addresses / full row text
connection strings
full user-entered values
```

IDs are test contracts, not data storage.
