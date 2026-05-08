# Pilot Page Selection for MVP 0.1.6

## 1. Selection criteria

A pilot flow should cover meaningful complexity without touching too many files.

Use these criteria:

```text
already has some data-testid / e2eId patterns
uses ProTable / table row actions
uses modal or strict modal form
uses ProForm fields
uses Select/Cascader-like composite inputs
has a clear terminal state assertion
can be tested without quoting sensitive values
```

## 2. Recommended first pilot: Site IP Port Pool

### Files

```text
networking/Site/Detail/Device/components/IpPools/components/IpPortPool/index.tsx
networking/Site/Detail/Device/components/IpPools/components/IpPortPool/UpdateForm.tsx
networking/Site/Detail/Device/components/IpPools/components/IpAddressPool/index.tsx
networking/Site/Detail/Device/components/IpPools/components/IpAddressPool/UpdateForm.tsx
networking/Site/Detail/Device/components/IpPools/components/IpAddressPool/V6UpdateForm.tsx
networking/Site/Detail/Network/components/DeviceWan.tsx
```

### Why this flow first

The code already shows a strong base contract:

```text
site-ip-port-pool-table
site-ip-port-pool-row
site-ip-port-pool-create-button
site-ip-port-pool-modal
site-ip-port-pool-address-pool-field
site-ip-port-pool-address-pool-select
site-ip-port-pool-ip-port-field
site-ip-port-pool-vrf-field
site-ip-port-pool-vrf-select
```

It also covers:

```text
ProTable
rowKey / onRow
row edit/delete action
Toolbar create button
StrictModalForm
ProFormText
ProFormSelect
nested field wrapper
Select options
modal submit terminal state
```

### Expected first pilot flow

Suggested business flow:

```text
Open Site Detail / Device / IP Pools area
Open IP Port Pool table
Click create
Fill name
Choose address pool
Fill IP prefix and port
Choose VRF
Confirm modal
Assert new row exists in IP Port Pool table
Edit the row
Change one field
Confirm modal
Assert row updated
Delete row or remove test-created row if current UI supports direct delete
Assert row no longer exists or table count changed
```

MVP 0.1.6 does not need to generate the final Playwright spec. It only needs the business repo and plugin to produce stronger semantic context during recording.

### Expected component/interaction types

```text
ProTable root
ProTable toolbar create action
ProTable row action
StrictModalForm root
Modal ok/cancel buttons
ProFormText
ProFormSelect
Select dropdown portal
Form field wrappers
row terminal assertion
```

### Risk and mitigation

| Risk | Mitigation |
|---|---|
| Some IDs already exist but wrappers do not expose semantic metadata | Add metadata only where low-risk: field wrapper and table root |
| Select options may contain internal values | Do not emit option value; let plugin use visible text while sanitizing export |
| Modal ok/cancel props may be hidden inside StrictModalForm | Add optional `e2eIds` to wrapper; fallback to `modalProps.okButtonProps` if easier |
| Row id may be numeric timestamp for newly added records | Use `data-row-key`; do not put row text into `data-testid` |

## 3. Recommended second pilot: DNAT / SNAT security tables

### Files

```text
networking/Site/Detail/Security/components/SecurityDnat.tsx
networking/Site/Detail/Security/components/SecurityDnatForm.tsx
networking/Site/Detail/Security/components/snat/ui/SnatTable.tsx
networking/Site/Detail/Security/components/snat/form/SnatFormBase.tsx
networking/Site/Detail/Security/components/snat/form/SnatFormV4Fields.tsx
networking/Site/Detail/Security/components/snat/form/SnatFormV6Fields.tsx
```

### Why useful

Observed patterns include:

```text
site-dnat-table
site-dnat-row
site-dnat-row-edit-action
site-dnat-row-delete-action
site-dnat-row-copy-action
site-dnat-search-keyword-field
site-dnat-create-button
site-snat-table
site-snat-row
site-snat-search-keyword-field
site-snat-create-button
```

It covers:

```text
ProTable
search toolbar
Tooltip / help icon
row edit/delete/copy actions
compact table mode
VirtualTable via SnatTable
modal form fields
SNAT/DNAT tab or IPv4/IPv6 variants
```

### Expected interactions

```text
search keyword field
open create modal
select field in modal
row edit action
row copy action
row delete action or direct remove
help tooltip trigger
```

### Risk and mitigation

| Risk | Mitigation |
|---|---|
| Security forms may include sensitive values | Do not print or export form values; tests should use synthetic non-sensitive placeholders |
| Existing delete may not use Popconfirm | Do not introduce Popconfirm solely for testing; only instrument existing behavior |
| Tooltip content may be long | Plugin diagnostics/export must not include full tooltip/overlay text |
| VirtualTable may not expose row DOM consistently | Require wrapper rowTestId + data-row-key |

## 4. Recommended third pilot: Traffic Class / EditableProTable

### Files

```text
networking/Site/Detail/Network/components/TrafficClass/index.tsx
networking/Site/Detail/Network/components/TrafficClass/UpdateForm.tsx
networking/Site/Detail/Network/components/DeviceWan.tsx
```

### Why useful

This is a high-complexity pilot:

```text
ProTable
StrictModal
ProForm
ProFormRadio.Group
ProFormCheckbox
EditableProTable
DeviceWan → WanBindingCascader
Select
modal submit
conditional form rendering
```

### Expected interactions

```text
open Traffic Class edit modal
choose a class from Select
toggle ProFormRadio.Group
edit EditableProTable row
choose transport target
choose DeviceWan cascader
save modal
assert table row changed
```

### Risk and mitigation

| Risk | Mitigation |
|---|---|
| Complex conditional rendering | Make this second or third PR if first pilot gets large |
| EditableProTable row ids are generated at runtime | Use `rowKey=id` and `data-row-key`; do not depend on row index |
| DeviceWan / WanBindingCascader wrapper may live outside `networking.zip` | Inspect full business repo first; add optional `e2eIds` there |

## 5. Other candidates

### VrfSelection

File:

```text
networking/components/VrfSelection.tsx
```

Already has:

```text
site-detail-vrf-selector
site-detail-vrf-option-<id>
```

Useful for:

```text
Tag-based selector
Tooltip trigger
Transfer inside Popconfirm if re-enabled later
```

Not first choice because the Popconfirm block is commented out in the uploaded archive.

### NetworkTrafficForm

File:

```text
networking/components/Network/NetworkTrafficForm.tsx
```

Useful for broad ProForm coverage:

```text
StrictModalForm
ProForm.Group
ProFormText
ProFormSelect
ProFormRadio.Group
ProFormSwitch
ProFormCheckbox
ProFormDependency
custom selection components
```

Not first choice because it is very large and likely to make the PR too wide.

### InputFireWallForm

File:

```text
networking/components/InputFireWall/InputFireWallForm.tsx
```

Useful for:

```text
StrictModalForm
ProFormSelect
ProFormText
ProFormRadio.Group
ProFormDependency
service-mode selector
custom port inputs
```

Good follow-up once the field wrapper pattern is proven.

## 6. Recommended pilot order

```text
Pilot 1: IP Port Pool / IP Address Pool
Pilot 2: DNAT / SNAT tables
Pilot 3: Traffic Class / EditableProTable
```

This order moves from existing IDs and simpler flow to increasingly complex composite components.

## 7. What not to pilot in MVP 0.1.6

Do not start with:

```text
networking/components/utils.ts
large utility conversion
all security forms
all WAN forms
all route/static policy pages
all 261 TSX files in networking.zip
```

MVP 0.1.6 is an alignment pilot, not a full business repo migration.
