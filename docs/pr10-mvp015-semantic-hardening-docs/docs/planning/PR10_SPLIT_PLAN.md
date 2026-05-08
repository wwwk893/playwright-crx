# PR #10 拆分建议：MVP 0.1.5 Semantic Adapter Hardening

## 分支名

```bash
git checkout main
git pull
git checkout -b feat/mvp-015-semantic-adapter-hardening
```

## Commit 分组

### Commit 1: `test: add semantic adapter hardening regressions`

目标：先写失败回归测试，避免实现时 false green。

文件：

```text
examples/recorder-crx/src/flow/stepStability.test.ts
tests/crx/semanticAdapter.spec.ts
```

测试点：

- 旧 flow 无 ui：export / compact / AI input 不报错；
- `step.uiRecipe` 直接字段导出清理；
- AI input URL 去 query/hash；
- semantic adapter disabled 时不写 ui；
- diagnostics 不包含 `locatorHints.value` 原文、`reasons`、`overlay.text`、`rowText`。

先跑：

```bash
npm run test:flow --prefix examples/recorder-crx
xvfb-run -a npx playwright test -c tests/playwright.config.ts tests/crx/semanticAdapter.spec.ts --project=Chrome --workers=1 --reporter=line --global-timeout=300000
```

预期：部分新测试失败。

### Commit 2: `feat: add semantic adapter feature flags`

目标：支持关闭 adapter 和 diagnostics。

文件：

```text
examples/recorder-crx/src/settings.ts
examples/recorder-crx/src/preferencesForm.tsx
examples/recorder-crx/src/pageContextSidecar.ts
```

实现：

- `semanticAdapterEnabled?: boolean`，默认 true；
- `semanticAdapterDiagnosticsEnabled?: boolean`，默认 false；
- sidecar 读取配置；
- 关闭时不写 `PageContextSnapshot.ui`。

验证：

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build:examples:recorder
```

### Commit 3: `feat: add compact semantic diagnostics`

目标：诊断可解释，但不泄漏。

文件：

```text
examples/recorder-crx/src/uiSemantics/diagnostics.ts
examples/recorder-crx/src/uiSemantics/antd.ts
examples/recorder-crx/src/pageContextSidecar.ts
```

实现：

- ring buffer 最近 200 条；
- `semantic.detect` / `semantic.weak` / `semantic.fallback-css`；
- `locatorHints` 只存 kind/score/scope/reason/valuePreview；
- 默认关闭。

验证：

```bash
npm run test:flow --prefix examples/recorder-crx
```

### Commit 4: `fix: harden semantic export and AI compaction`

目标：所有外发路径只保留 compact UI。

文件：

```text
examples/recorder-crx/src/flow/exportSanitizer.ts
examples/recorder-crx/src/flow/compactExporter.ts
examples/recorder-crx/src/aiIntent/prompt.ts
examples/recorder-crx/src/aiIntent/redactForModel.ts
examples/recorder-crx/src/flow/stepStability.test.ts
```

实现：

- `step.uiRecipe` 白名单清理；
- `compactUiSemanticContext()` 确认不输出敏感字段；
- AI input URL 去 query/hash；
- tests 覆盖 `target.raw.ui`、`context.before.ui`、`step.uiRecipe`。

验证：

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build:examples:recorder
```

### Commit 5: `test: add focused semantic adapter CRX stress coverage`

目标：覆盖真实 CRX fixture 行为。

文件：

```text
tests/crx/semanticAdapter.spec.ts
```

实现：

- enabled / disabled 对照；
- unknown DOM；
- Select portal；
- Popconfirm；
- Tooltip；
- ProTable row action；
- 重复 3 次 focused stress。

验证：

```bash
xvfb-run -a npx playwright test -c tests/playwright.config.ts tests/crx/semanticAdapter.spec.ts --project=Chrome --workers=1 --reporter=line --global-timeout=300000
```

### Commit 6: `chore: document MVP 0.1.5 hardening`

目标：把本实施文档放进仓库。

文件：

```text
docs/tasks/MVP-0.1.5-SEMANTIC-ADAPTER-HARDENING-IMPLEMENTATION.md
```

验证：无额外测试。

---

## 需要先写 failing regression 的风险点

优先先写测试：

1. `step.uiRecipe` 直接挂在 step 上时导出清理；
2. `target.raw.ui` 不再绕过 sanitizer，这条 PR #9 已有，但 PR #10 应继续保留；
3. AI input 不包含 `locatorHints` / `reasons` / `rowText` / `overlay.text` / `option.value`；
4. semantic disabled 不写 ui；
5. legacy no-ui flow 兼容；
6. diagnostics 不进入 export。

---

## 不要塞进 PR #10 的内容

留到后续：

### 0.1.6

```text
业务仓 wrapper 改造
e2eId/e2eIds 透传
provider/tenant 代表页面 data-testid 试点
```

### 0.1.7

```text
recipe → Playwright preview helper
antd.selectOption / antd.fillFormField helper codegen
```

### 0.1.8

```text
Storybook / Playwright CT fixture corpus
30+ 组件场景库
```

### 0.1.9

```text
AI intent 人工评分看板
质量/成本闭环升级
```

### 0.2

```text
Flow → Playwright spec generation
Runner
Native Messaging
CI / PR automation
```
