# MVP 0.1.6 PR Split Plan

## 1. Recommended PRs

MVP 0.1.6 should not be one giant cross-repo mega PR.

Recommended split:

```text
Business PR 1: E2E contract utilities + shared wrapper passthrough
Business PR 2: networking pilot instrumentation
Plugin PR 1: generic business hint consumption
Joint validation: pilot recording session with both branches
```

If the team needs fewer PRs, combine Business PR 1 and Business PR 2, but keep plugin changes separate.

## 2. PR dependencies

```text
PR #10 / MVP 0.1.5 merged
  ↓
Business PR 1 and Plugin PR 1 can develop in parallel
  ↓
Business PR 2 depends on Business PR 1 wrappers/utilities
  ↓
Joint pilot validation after Business PR 2 + Plugin PR 1 are both available
```

## 3. Business PR 1

### Branch name

```bash
feat/mvp-016-e2e-contract-wrappers
```

### Goal

Introduce generic E2E ID contract and adapt shared wrappers.

### Touched file categories

```text
src/utils/e2eTestId.ts, if present or created
src/components/StrictModalComponents/StrictModalForm.tsx
src/components/StrictModalComponents/StrictModal.tsx
src/components/WanBindingCascader/**
src/components/V4AndV6Table/**
src/components/CompactTable/**
```

Exact paths must be confirmed in the full business repo because `networking.zip` contains references but not all shared components.

### Commit groups

#### Commit 1

```text
feat(e2e): add shared e2e id helpers
```

Files:

```text
src/utils/e2eTestId.ts
```

#### Commit 2

```text
feat(e2e): pass e2e ids through strict modal wrappers
```

Files:

```text
src/components/StrictModalComponents/StrictModalForm.tsx
src/components/StrictModalComponents/StrictModal.tsx
```

#### Commit 3

```text
feat(e2e): pass e2e ids through select/table wrappers
```

Files:

```text
src/components/WanBindingCascader/**
src/components/V4AndV6Table/**
src/components/CompactTable/**
```

#### Commit 4

```text
test(e2e): add wrapper passthrough coverage
```

### Validation commands

Use business repo scripts. Suggested:

```bash
npm run lint
npm run test
npm run build
```

The agent must report exact commands.

### Rollback

Disable usage by not passing `e2eId/e2eIds`. Wrapper additions are optional and should be harmless.

## 4. Business PR 2

### Branch name

```bash
feat/mvp-016-networking-pilot-e2e-ids
```

### Goal

Add or complete E2E contracts on representative networking pilot pages.

### Touched files

Primary pilot:

```text
networking/Site/Detail/Device/components/IpPools/components/IpPortPool/index.tsx
networking/Site/Detail/Device/components/IpPools/components/IpPortPool/UpdateForm.tsx
networking/Site/Detail/Device/components/IpPools/components/IpAddressPool/index.tsx
networking/Site/Detail/Device/components/IpPools/components/IpAddressPool/UpdateForm.tsx
networking/Site/Detail/Device/components/IpPools/components/IpAddressPool/V6UpdateForm.tsx
networking/Site/Detail/Network/components/DeviceWan.tsx
```

Secondary pilot if diff remains manageable:

```text
networking/Site/Detail/Security/components/SecurityDnat.tsx
networking/Site/Detail/Security/components/SecurityDnatForm.tsx
networking/Site/Detail/Security/components/snat/ui/SnatTable.tsx
networking/Site/Detail/Security/components/snat/form/SnatFormBase.tsx
networking/Site/Detail/Security/components/snat/form/SnatFormV4Fields.tsx
networking/Site/Detail/Security/components/snat/form/SnatFormV6Fields.tsx
```

Optional third pilot:

```text
networking/Site/Detail/Network/components/TrafficClass/index.tsx
networking/Site/Detail/Network/components/TrafficClass/UpdateForm.tsx
```

### Commit groups

#### Commit 1

```text
feat(e2e): complete IP pool table and modal ids
```

#### Commit 2

```text
feat(e2e): add IP pool form field semantic hints
```

#### Commit 3

```text
feat(e2e): instrument security table row and toolbar actions
```

#### Commit 4, optional

```text
feat(e2e): instrument traffic class editable table pilot
```

### Validation commands

```bash
npm run lint
npm run test
npm run build
```

Also run any available route/page smoke tests for networking.

### Risk

PR may become wide. If it grows beyond pilot scope, split TrafficClass into another PR.

## 5. Plugin PR 1

### Branch name

```bash
feat/mvp-016-business-hints-semantic-alignment
```

### Goal

Teach `playwright-crx` to consume generic business hints emitted by business wrappers.

### Touched files

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

### Commit groups

#### Commit 1

```text
test: add generic business-hint semantic regressions
```

Tests first.

#### Commit 2

```text
feat: collect generic e2e business hints
```

Add generic hint extraction.

#### Commit 3

```text
feat: merge business hints into UiSemanticContext recipes
```

Prefer hints over fallback.

#### Commit 4

```text
fix: keep business hint compaction export-safe
```

Sanitize export / compact YAML / AI input.

#### Commit 5

```text
test: add CRX E2E coverage for business hints
```

### Validation commands

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build:examples:recorder
npm run build:tests
xvfb-run -a npx playwright test -c tests/playwright.config.ts tests/crx/semanticAdapter.spec.ts --project=Chrome --workers=1 --reporter=line --global-timeout=300000
npm run build:crx
git diff --check
```

## 6. Joint validation

After business and plugin PRs are both available in a staging/dev environment:

```text
Open pilot page.
Record IP Port Pool create/edit/delete flow.
Verify FlowStep.context.before.ui contains business hints.
Verify compact-flow.yaml contains compact ui.
Verify AI input contains compact ui only.
Verify disabling semanticAdapterEnabled falls back to old behavior.
```

## 7. If business repo and plugin cannot be merged together

### Plugin merges first

Safe because plugin supports optional hints. It should still pass without business changes.

### Business repo merges first

Safe because new attributes are inert. Existing app behavior should not change.

### Both delayed

Run local integration by installing both branches in a staging build. Do not block either repo on unavailable paired merge if each PR is independently safe.

## 8. Do not include in PR split

Do not add these in MVP 0.1.6 PRs:

```text
Playwright helper codegen
Flow to spec generation
Runner
Native Messaging
Storybook corpus
AI scoring dashboard
large all-networking migration
```
