# Local Business Repo Agent Prompt: MVP 0.1.7 Terminal-State Contract Support

You are working in the downstream business frontend repository, not `playwright-crx`.

Your task is to support the plugin's MVP 0.1.7 replay hardening by making pilot business flows expose stable generic terminal-state hooks.

Do not modify `playwright-crx` in this task.

## Security rules

Do not print or commit secrets.

If you see credentials, tokens, cookies, auth headers, passwords, private keys, connection strings, or private values, refer to them only as `[REDACTED]`.

Do not put sensitive values into `data-testid`, `data-e2e-*`, `data-row-key`, or `data-column-key`.

## Read first

Inspect current business wrappers and pilot pages. Likely categories:

```text
src/utils/e2eTestId.ts
src/components/StrictModalComponents/StrictModalForm.tsx
src/components/StrictModalComponents/StrictModal.tsx
src/components/WanBindingCascader/**
src/components/V4AndV6Table/**
src/components/CompactTable/**
src/components/SiteSelect/**
src/components/TrafficMarkSelect/**
networking/Site/Detail/Device/components/IpPools/**
networking/Site/Detail/Security/components/**
networking/Site/Detail/Network/components/TrafficClass/**
networking/Site/Detail/Network/components/DeviceWan.tsx
```

Confirm actual paths before editing; they may differ.

## Goal

Make pilot flows terminal-state friendly for the CRX recorder:

```text
row exists / disappears can be asserted
modal/drawer open/closed can be asserted
selected value visible can be asserted
validation error visible can be asserted
popconfirm visible/closed can be asserted
```

## Required contract

Use primary locator:

```text
data-testid
```

Use semantic metadata:

```text
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

## Implementation guidance

### Tables/lists

Rows should expose stable non-sensitive row keys:

```tsx
<tr data-testid="entity-row" data-row-key={safeStableRowKey}>
```

Actions should expose generic action metadata:

```tsx
<Button data-testid="entity-row-delete-action" data-e2e-action="delete">删除</Button>
```

### Forms

Fields should expose names/kinds, not values:

```tsx
<div
  data-testid="entity-vrf-field"
  data-e2e-component="pro-form-field"
  data-e2e-field-name="vrfId"
  data-e2e-field-kind="select"
  data-e2e-form-kind="modal-form"
>
```

### Overlays

Modal/Drawer roots:

```tsx
<Modal
  data-testid="entity-modal"
  data-e2e-component="modal-form"
  data-e2e-overlay="modal"
/>
```

OK/Cancel buttons:

```tsx
okButtonProps={{
  'data-testid': 'entity-modal-ok-button',
  'data-e2e-action': 'submit',
}}
```

### Popconfirm

Confirm button:

```tsx
okButtonProps={{
  'data-testid': 'entity-delete-confirm-ok',
  'data-e2e-component': 'popconfirm',
  'data-e2e-action': 'confirm',
}}
```

## Pilot priority

Start with existing pilot-equivalent pages/contracts:

```text
IP Pools create/edit/delete
WAN transport add/delete/select/radio/threshold
SNAT/DNAT table actions and modal forms
TrafficClass / EditableProTable if manageable
```

Keep the PR small. If TrafficClass makes the diff large, split it.

## Tests

Use the business repo's available commands. Report exact commands.

Suggested minimum:

```bash
npm run lint
npm run test
npm run build
```

If component tests exist, add wrapper passthrough tests for:

```text
modal root + ok/cancel
select/cascader trigger
row key and row action
form field metadata
popconfirm ok button
```

If no component test stack exists, add a manual smoke checklist and DOM screenshot/inspection evidence without exposing secrets.

## What not to do

Do not:

```text
modify plugin code
add networking-specific requirements to plugin docs
encode raw business/private values in attributes
break existing props/events
change user-visible labels only for testing
add broad wrappers outside pilot scope
```

## Final response format

Return:

```text
Summary
Changed files
How to test
Acceptance checklist
Security notes
Known limitations
Next handoff to plugin repo
```
