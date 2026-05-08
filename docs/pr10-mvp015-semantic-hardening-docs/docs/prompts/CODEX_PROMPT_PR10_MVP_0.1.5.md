# Prompt for Hermes/Codex: PR #10 MVP 0.1.5 Semantic Adapter Hardening

你现在位于 `wwwk893/playwright-crx` 仓库。请只做 MVP 0.1.5：Semantic Adapter Hardening。

## 前置条件

PR #9 `feat: add MVP 0.1.4 AntD Pro semantic adapter` 应已经合并到 `main`。如果没有合并，请不要继续实现 PR #10，先提示我确认 PR #9 状态。

请创建分支：

```bash
git checkout main
git pull
git checkout -b feat/mvp-015-semantic-adapter-hardening
```

## 必读文件

请先阅读：

```text
CONTEXT.md，如果存在
docs/tasks/MVP-0.1.5-SEMANTIC-ADAPTER-HARDENING-IMPLEMENTATION.md
roadmap/extracted-after-semantic-adapter-plan/docs/tasks/MVP-0.1.5-SEMANTIC-ADAPTER-HARDENING.md，如果存在
roadmap/extracted-after-semantic-adapter-plan/docs/design/SEMANTIC_ADAPTER_ACCEPTANCE_AND_HARDENING.md，如果存在
examples/recorder-crx/src/uiSemantics/types.ts
examples/recorder-crx/src/uiSemantics/antd.ts
examples/recorder-crx/src/pageContextSidecar.ts
examples/recorder-crx/src/flow/exportSanitizer.ts
examples/recorder-crx/src/flow/compactExporter.ts
examples/recorder-crx/src/aiIntent/prompt.ts
examples/recorder-crx/src/aiIntent/redactForModel.ts
examples/recorder-crx/src/flow/stepStability.test.ts
tests/crx/semanticAdapter.spec.ts
```

## 本轮只做

只实现：

```text
1. semantic adapter feature flag；
2. semantic diagnostics compact ring buffer；
3. export sanitizer / compact YAML / AI input 压缩加固；
4. 旧 flow 无 ui 兼容测试；
5. CRX semanticAdapter focused stress；
6. 文档落地。
```

## 本轮禁止做

不要做：

```text
不要做 Native Messaging
不要做 Node Runner
不要做 Flow → Playwright spec 生成
不要做 recipe helper codegen preview
不要做 Storybook / Playwright CT corpus
不要做业务仓 wrapper 改造
不要重写 Playwright recorder/player
不要引入 Cypress 或第三方 AntD helper runtime dependency
不要删除测试断言
不要用 mock 替代 CRX E2E fixture
不要加盲 sleep
不要把 diagnostics 存入 business-flow.json / compact-flow.yaml / AI input
```

## 实现顺序

### Step 1：先写 regression tests

修改：

```text
examples/recorder-crx/src/flow/stepStability.test.ts
tests/crx/semanticAdapter.spec.ts
```

新增测试：

- 旧 flow 没有 ui 时 export / compact / AI input 不报错；
- `step.uiRecipe` 直接存在时导出走白名单；
- AI input URL 去 query/hash；
- AI input 不含 locatorHints/reasons/rowText/overlay.text/option.value；
- semantic adapter disabled 时不写 ui；
- diagnostics 不包含敏感/膨胀字段。

运行：

```bash
npm run test:flow --prefix examples/recorder-crx
```

### Step 2：实现 feature flags

修改：

```text
examples/recorder-crx/src/settings.ts
examples/recorder-crx/src/preferencesForm.tsx
examples/recorder-crx/src/pageContextSidecar.ts
```

新增设置：

```ts
semanticAdapterEnabled?: boolean;
semanticAdapterDiagnosticsEnabled?: boolean;
```

默认：

```text
semanticAdapterEnabled=true
semanticAdapterDiagnosticsEnabled=false
```

关闭 adapter 时：

```text
不调用 collectUiSemanticContext
不写 PageContextSnapshot.ui
不新增 FlowStep.uiRecipe
```

### Step 3：实现 diagnostics

新增：

```text
examples/recorder-crx/src/uiSemantics/diagnostics.ts
```

要求：

- ring buffer 最近 200 条；
- 事件包括 `semantic.detect`、`semantic.weak`、`semantic.fallback-css`、`semantic.disabled`；
- 只存 compact fields；
- `locatorHints.value` 只能作为截断后的 `valuePreview`；
- 默认关闭。

### Step 4：加固 export / compact YAML / AI input

修改：

```text
examples/recorder-crx/src/flow/exportSanitizer.ts
examples/recorder-crx/src/flow/compactExporter.ts
examples/recorder-crx/src/aiIntent/prompt.ts
examples/recorder-crx/src/aiIntent/redactForModel.ts
```

要求：

- `context.before.ui`、`target.raw.ui`、`step.uiRecipe` 都只走白名单；
- compact YAML 只输出 compact ui；
- AI input 只输出 compact ui；
- AI input URL 去 query/hash；
- 不输出 locatorHints/reasons/rowText/overlay.text/option.value/rawAction/sourceCode。

### Step 5：补 CRX E2E focused stress

修改：

```text
tests/crx/semanticAdapter.spec.ts
```

覆盖：

- enabled / disabled 对照；
- unknown DOM；
- Select portal；
- Popconfirm；
- Tooltip；
- ProTable row action；
- 重复 3 次 focused stress。

运行：

```bash
xvfb-run -a npx playwright test -c tests/playwright.config.ts tests/crx/semanticAdapter.spec.ts --project=Chrome --workers=1 --reporter=line --global-timeout=300000
```

### Step 6：完整验证

按顺序运行：

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build:examples:recorder
npm run build:tests
xvfb-run -a npx playwright test -c tests/playwright.config.ts tests/crx/semanticAdapter.spec.ts --project=Chrome --workers=1 --reporter=line --global-timeout=300000
npm run build:crx
git diff --check
```

## 不得修改

除非绝对必要，不要修改：

```text
src/server/recorder/crxRecorderApp.ts
src/server/recorder/crxPlayer.ts
playwright/**
node_modules/**
```

## 最终汇报格式

完成后请输出：

```text
Summary
Changed files
Commit plan
How to test
Acceptance checklist
Security/privacy notes
Known limitations
Next handoff
```

不要自动 merge。不要自动压缩范围之外的任务。不要提前实现 MVP 0.1.6/0.1.7/0.1.8/0.1.9/0.2。
