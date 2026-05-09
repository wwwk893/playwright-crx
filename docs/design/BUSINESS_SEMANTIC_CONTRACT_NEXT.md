# Business Semantic Contract Next

## 1. Purpose

PR #11 proved that `playwright-crx` can consume generic business hints. The next contract work should make downstream business flows terminal-state friendly, not just semantically labeled.

The plugin must stay generic. WAN/IP Pools are realistic fixture scenarios, not production rules to hardcode.

## 2. Contract fields already supported

The plugin baseline accepts generic hints:

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
data-e2e-overlay
data-row-key
data-column-key
```

Primary locator attribute remains:

```text
data-testid
```

`data-e2e-*` is semantic metadata, not the main locator contract.

## 3. What downstream business repo should implement next

### 3.1 Terminal-state-friendly attributes

Business pages should expose generic hooks that let replay assert state:

```tsx
<section data-testid="wan-transport-table" data-e2e-component="pro-table" data-e2e-table="wan-transport">
  <tr data-testid="wan-transport-row" data-row-key="row-nova-public">
    <td data-column-key="transport">Nova 公网</td>
    <td data-column-key="tags">controller</td>
    <td data-column-key="actions">
      <button data-testid="wan-transport-row-delete-action" data-e2e-action="delete">删除</button>
    </td>
  </tr>
</section>
```

The plugin can then assert:

```text
row exists / row disappears / row contains token
```

without storing full row text.

### 3.2 Overlay roots and terminal controls

Modal/Drawer/Popconfirm roots and terminal controls should expose:

```text
data-testid
data-e2e-component
data-e2e-overlay
data-e2e-action
```

Example:

```tsx
<Modal
  data-testid="entity-modal"
  data-e2e-component="modal-form"
  data-e2e-overlay="modal"
  okButtonProps={{
    'data-testid': 'entity-modal-ok-button',
    'data-e2e-action': 'submit',
    'data-e2e-form-kind': 'modal-form',
  }}
/>
```

### 3.3 Form fields

Fields should expose stable names, not values:

```tsx
<div
  data-testid="entity-vrf-field"
  data-e2e-component="pro-form-field"
  data-e2e-field-name="vrfId"
  data-e2e-field-kind="select"
  data-e2e-form-kind="modal-form"
>
  <ProFormSelect fieldProps={{ 'data-testid': 'entity-vrf-select' }} />
</div>
```

Do not put raw selected values into attributes.

### 3.4 Select/Cascader/TreeSelect wrappers

Composite select wrappers should expose:

```text
root/field id
trigger id
popup or optionPrefix when possible
field name
field kind
```

If popup is portal-mounted and cannot receive attributes easily, the trigger and field metadata are still useful.

### 3.5 Table/list row actions

Repeated action buttons must be scoped by row/container.

Required:

```text
row-level data-row-key
action-level data-testid
action-level data-e2e-action
optional data-column-key
```

Do not rely on global duplicate test ids.

## 4. What belongs in `playwright-crx`

The plugin should interpret generic hints:

```text
component kind
field kind/name
table id / row key / column key
action role
overlay type
```

It should not know:

```text
IP pool
SNAT/DNAT
WAN domain names
specific Chinese labels
business backend semantics
```

Allowed fixture strings in tests are fine. Production adapter logic must be generic.

## 5. What belongs in downstream business repo

Business repo should implement:

```text
wrapper props e2eId/e2eIds
stable data-testid naming
data-row-key and data-column-key
data-e2e-field-name/kind/form-kind
data-e2e-table / overlay / action
pilot flow terminal-state hooks
```

Business repo should not implement:

```text
Playwright CRX replay codegen
AI intent behavior
plugin diagnostics storage
plugin sanitizer logic
```

## 6. Contract migration policy

1. Preserve existing `data-testid` values.
2. Add semantic `data-e2e-*` only where it clarifies component role.
3. Start with pilot pages that already have test ids.
4. Avoid broad bulk changes across all pages.
5. If a wrapper cannot pass a hint safely, do not force it; emit hints at the nearest stable wrapper DOM node.

## 7. Next downstream pilots

Use these as realistic coverage, not plugin hardcoding:

```text
IP Pools create/edit/delete flows
WAN transport add/delete/select/radio/threshold flows
SNAT/DNAT table actions and modal forms
TrafficClass / EditableProTable flows
```

## 8. Validation expectations

For each pilot flow, downstream should provide enough DOM contract for the plugin to prove:

```text
modal opened/closed
selected value changed
row appeared/disappeared
row content updated
validation appeared
popconfirm closed
```

If downstream cannot expose a stable terminal-state hook, the plugin should skip assertion with a diagnostic rather than guess.
