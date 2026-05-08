# Codex / Hermes Prompt: MVP 0.1.6 Business Components Semantic Alignment

你现在要做 MVP 0.1.6 规划中的实现工作。请严格按本提示执行，不要跳到后续 MVP。

## 0. Scope

本轮只做 MVP 0.1.6：Business Components × Semantic Adapter Alignment。

目标：让业务仓组件通过 `data-testid` + 可选 `data-e2e-*` 语义属性暴露稳定测试契约，让 `playwright-crx` 的语义适配器泛化消费这些提示。

不要做：

```text
MVP 0.1.7 recipe → Playwright preview helper/codegen
MVP 0.1.8 Storybook / Playwright CT corpus
MVP 0.1.9 AI scoring dashboard
MVP 0.2 Flow → Playwright spec generation / Runner / Native Messaging / CI automation
Playwright recorder/player rewrite
third-party AntD helper runtime dependency
Cypress integration
blind sleep
mock replacement for real CRX E2E
secrets leakage
```

## 1. Read docs first

先阅读：

```text
docs/tasks/MVP-0.1.6-BUSINESS-COMPONENTS-SEMANTIC-ALIGNMENT.md
docs/design/E2E_ID_CONVENTION.md
docs/design/BUSINESS_WRAPPER_ADAPTATION.md
docs/design/PLAYWRIGHT_CRX_ADAPTER_ALIGNMENT.md
docs/design/PILOT_PAGE_SELECTION.md
docs/testing/MVP_0.1.6_ACCEPTANCE_TEST_PLAN.md
docs/checklists/MVP_0.1.6_REVIEW_CHECKLIST.md
docs/planning/PR_SPLIT_PLAN.md
```

如果这些文档不在仓库，请先提示我需要把 `mvp016-business-components-semantic-alignment-docs` 放到仓库中。

## 2. Inspect business wrappers first

如果你在业务仓执行：

先查找并阅读：

```text
src/utils/e2eTestId.ts
src/components/StrictModalComponents/StrictModalForm.tsx
src/components/StrictModalComponents/StrictModal.tsx
src/components/WanBindingCascader/**
src/components/V4AndV6Table/**
src/components/CompactTable/**
src/components/SiteSelect/**
src/components/TrafficMarkSelect/**
```

同时阅读 pilot files：

```text
networking/Site/Detail/Device/components/IpPools/components/IpPortPool/index.tsx
networking/Site/Detail/Device/components/IpPools/components/IpPortPool/UpdateForm.tsx
networking/Site/Detail/Device/components/IpPools/components/IpAddressPool/index.tsx
networking/Site/Detail/Device/components/IpPools/components/IpAddressPool/UpdateForm.tsx
networking/Site/Detail/Network/components/DeviceWan.tsx
networking/Site/Detail/Security/components/SecurityDnat.tsx
networking/Site/Detail/Security/components/snat/ui/SnatTable.tsx
networking/Site/Detail/Network/components/TrafficClass/UpdateForm.tsx
```

不要在未检查 wrapper 实现前直接批量编辑页面。

## 3. Inspect plugin files first

如果你在 `playwright-crx` 执行：

先阅读：

```text
examples/recorder-crx/src/uiSemantics/types.ts
examples/recorder-crx/src/uiSemantics/antd.ts
examples/recorder-crx/src/uiSemantics/compact.ts
examples/recorder-crx/src/uiSemantics/diagnostics.ts
examples/recorder-crx/src/uiSemantics/index.ts
examples/recorder-crx/src/pageContextSidecar.ts
examples/recorder-crx/src/flow/exportSanitizer.ts
examples/recorder-crx/src/flow/compactExporter.ts
examples/recorder-crx/src/aiIntent/prompt.ts
examples/recorder-crx/src/aiIntent/redactForModel.ts
examples/recorder-crx/src/flow/stepStability.test.ts
tests/crx/semanticAdapter.spec.ts
```

Do not modify:

```text
src/server/recorder/crxRecorderApp.ts
src/server/recorder/crxPlayer.ts
playwright/**
node_modules/**
```

unless you stop and explain why it is unavoidable.

## 4. Test / acceptance first

Before implementation, write or update failing tests for the exact behavior.

### Business repo first tests

Add tests for:

```text
e2eTestId helper returns data-testid safely
rowTestId returns data-testid + data-row-key
StrictModalForm passes modal/ok/cancel ids
WanBindingCascader/DeviceWan passes trigger/root ids
V4AndV6Table/VirtualTable passes table/row/create/tab ids
```

If the business repo has no suitable test harness, document the limitation and add focused DOM/manual verification checklist instead of inventing a mock-heavy framework.

### Plugin tests first

Add tests for:

```text
data-e2e-component=pro-table maps to UiSemanticContext
field hints map to ui.form
row key hints map to ui.table.rowKey
business hints beat AntD CSS fallback
compact export / AI input sanitize business hints
unknown hints do not crash
CRX E2E fixture proves real page semantic output
```

## 5. Implementation order

### If implementing business repo PR

1. Extend or create `src/utils/e2eTestId.ts`.
2. Adapt `StrictModalForm` / `StrictModal` with optional `e2eId/e2eIds`.
3. Adapt `WanBindingCascader` / `DeviceWan` with optional `e2eIds`.
4. Adapt `V4AndV6Table` / `VirtualTable` / table wrappers.
5. Instrument IP Port Pool pilot.
6. Instrument DNAT/SNAT pilot if diff remains manageable.
7. Only then consider TrafficClass / EditableProTable pilot.

Rules:

```text
Keep existing data-testid values.
All new props optional.
Do not change business behavior.
Do not encode secrets/user values in IDs.
Do not mass-edit all networking files.
```

### If implementing playwright-crx PR

1. Add tests for business hints.
2. Add generic business hint extraction in `uiSemantics`.
3. Merge business hints into `UiSemanticContext`.
4. Preserve PR #10 feature flag behavior.
5. Keep compact export / AI input sanitized.
6. Add CRX E2E fixture.

Rules:

```text
No networking-specific hardcoding.
No full DOM/rawAction/sourceCode in AI input.
No locatorHints/reasons/rowText/overlay.text/option.value in compact exports.
No recorder/player rewrite.
```

## 6. Validation commands

### Plugin repo

Run:

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build:examples:recorder
npm run build:tests
xvfb-run -a npx playwright test -c tests/playwright.config.ts tests/crx/semanticAdapter.spec.ts --project=Chrome --workers=1 --reporter=line --global-timeout=300000
npm run build:crx
git diff --check
```

### Business repo

Run the repo's actual commands. Suggested:

```bash
npm run lint
npm run test
npm run build
```

If commands differ, report the actual commands and results.

## 7. Security requirements

Do not print or include raw values for:

```text
credentials
API keys
tokens
passwords
cookies
authorization headers
connection strings
private keys
```

If encountered, use `[REDACTED]`.

Do not add test IDs using sensitive values.

## 8. Final output format

When done, report:

```text
Summary
Changed files
How to test
Acceptance checklist
Security notes
Known limitations
Next handoff
```

Do not auto-merge.
Do not implement MVP 0.1.7+ or MVP 0.2.
