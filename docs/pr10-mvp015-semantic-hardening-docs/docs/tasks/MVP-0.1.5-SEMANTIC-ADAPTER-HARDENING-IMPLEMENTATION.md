# MVP 0.1.5: Semantic Adapter Hardening Implementation

## 0. 当前阶段判断

### PR #9 / MVP 0.1.4 当前完成度

PR #9 已经完成 MVP 0.1.4 的主体目标：把低层 DOM/action 映射到 `UiSemanticContext` / `FlowStep.uiRecipe`，并把语义上下文接入 page context、FlowStep、compact export、AI intent input、CRX 语义适配 E2E 测试。

当前已验证通过：

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build:examples:recorder
npm run build:tests
xvfb-run -a npx playwright test -c tests/playwright.config.ts tests/crx/semanticAdapter.spec.ts --project=Chrome --workers=1 --reporter=line --global-timeout=300000
npm run build:crx
git diff --check
```

这说明 PR #9 已经具备合并候选条件，前提是 GitHub CI 最终绿。

### Hermes 本次修复解决的 review blocker

本次 PR #9 最后修掉了两个实际 blocker / review risk：

1. `prepareBusinessFlowForExport()` 过去只清理 `step.context.before.ui`，但 `step.target.raw.ui` 仍可能带完整 `locatorHints`、`reasons`、`rowText`、`overlay.text`、`option.value`。现在 `sanitizeFlowTarget()` / `sanitizeRawTarget()` 已经把 `target.raw.ui` 也走 `sanitizeUiSemanticContext()`，避免绕过导出清理路径。
2. `collectAntdSemanticContext()` 中 `component === 'unknown'` 时现在明确输出 `library: 'unknown'`，避免普通 DOM 被误归类为 AntD，污染 AI intent、统计、compact export 和诊断。

### 仍属于 0.1.5 的内容

以下内容不应继续塞进 PR #9，因为它们属于加固阶段，而不是 0.1.4 merge blocker：

- semantic adapter feature flag 和关闭回退路径；
- semantic diagnostics 结构、环形缓存和 UI/导出边界；
- old flow / no-ui flow 的兼容测试；
- compact YAML / AI input 膨胀控制；
- semantic adapter fallback reason 统计；
- focused stress tests；
- 真实 flow 导入/导出回归；
- adapter 不覆盖人工 intent 的回归测试。

### 是否应先合并 PR #9 再开 PR #10

建议：**等待 PR #9 CI 全绿后合并，再从 main 开 PR #10 做 MVP 0.1.5。**

理由：

- PR #9 已经包含主体功能、review blocker 修复和必要测试，继续堆 0.1.5 会让 PR 过大，review 成本上升；
- 0.1.5 是 hardening，不应和 0.1.4 的 feature implementation 混在一个 diff 里；
- 若 CI 失败，应先修 PR #9 的失败，不要在失败基础上叠加 hardening；
- PR #10 可以明确以 “不改变核心识别覆盖，只加开关/诊断/兼容/安全边界” 为审查边界。

除非 PR #9 CI 暴露的是必须在 0.1.5 才能修的安全/导出问题，否则不要在 PR #9 继续扩范围。

---

## 1. 背景

MVP 0.1.4 已将 AntD / ProComponents Semantic Adapter 接入业务流程录制链路。当前系统已经能把低层 DOM/action 提升为：

```ts
PageContextSnapshot.ui?: UiSemanticContext
FlowStep.uiRecipe?: UiActionRecipe
```

下一阶段 MVP 0.1.5 的目标不是继续加新组件，也不是生成 Playwright spec，而是让 adapter 变成可信、可关闭、可诊断、可回归的主链路能力。

---

## 2. 非目标

本 PR 不做：

```text
不做 Native Messaging
不做 Node Runner
不做 Flow → Playwright spec 生成
不做 AI 修复
不做 CI/PR 自动化
不做业务仓 wrapper 大改造
不做 Storybook / Playwright CT corpus
不做 recipe helper codegen preview
不重写 Playwright recorder/player
不引入 Cypress 或第三方 AntD helper runtime dependency
不删除现有语义覆盖断言
不为了过测试替换成 mock 或 blind sleep
```

---

## 3. 具体文件清单

### 必改文件

```text
examples/recorder-crx/src/settings.ts
examples/recorder-crx/src/preferencesForm.tsx
examples/recorder-crx/src/pageContextSidecar.ts
examples/recorder-crx/src/uiSemantics/types.ts
examples/recorder-crx/src/uiSemantics/antd.ts
examples/recorder-crx/src/flow/exportSanitizer.ts
examples/recorder-crx/src/flow/compactExporter.ts
examples/recorder-crx/src/aiIntent/prompt.ts
examples/recorder-crx/src/aiIntent/redactForModel.ts
examples/recorder-crx/src/flow/stepStability.test.ts
tests/crx/semanticAdapter.spec.ts
```

### 建议新增文件

```text
examples/recorder-crx/src/uiSemantics/diagnostics.ts
examples/recorder-crx/src/uiSemantics/compact.ts   # 若当前已有则只加测试，不重复创建
examples/recorder-crx/src/uiSemantics/uiSemantics.test.ts  # 若当前测试集中已有语义单测入口，可沿用
```

### 不应修改或谨慎修改

```text
src/server/recorder/crxRecorderApp.ts
src/server/recorder/crxPlayer.ts
playwright/**
node_modules/**
tests/crx/helpers/**  # 除非只是 fixture 装载小调整
```

---

## 4. 数据模型 / 兼容性约束

### 4.1 `UiSemanticContext` 仍然分完整态和紧凑态

完整态可以存在于运行时：

```ts
UiSemanticContext {
  library,
  component,
  componentPath,
  targetText,
  targetTestId,
  targetRole,
  form,
  table,
  overlay,
  option,
  locatorHints,
  recipe,
  confidence,
  weak,
  reasons,
}
```

但导出、compact YAML、AI input 只能使用紧凑态。

紧凑态只允许保留：

```ts
{
  library,
  component,
  recipe,
  formKind,
  fieldKind,
  fieldLabel,
  fieldName,
  optionText,
  tableTitle,
  rowKey,
  columnTitle,
  overlayTitle,
  targetText,
  targetTestId,
  confidence,
  weak,
}
```

不得包含：

```text
locatorHints
reasons
overlay.text
table.rowText
option.value
nearbyText
DOM HTML
rawAction
sourceCode
完整 URL query
cookie/token/password/authorization
```

### 4.2 旧 flow 兼容

旧 flow 可能没有：

```ts
step.context.before.ui
step.uiRecipe
step.target.raw.ui
```

所有入口必须能处理：

```text
open record
edit record
import JSON
restore draft
toCompactFlow
prepareBusinessFlowForExport
buildAiIntentInput
```

不允许因为缺少 ui 报错；缺少 ui 时应退回现有 target/context 逻辑。

### 4.3 不覆盖用户编辑态

如果：

```ts
step.intentSource === 'user'
```

semantic adapter 或 UI recipe 不得覆盖 `step.intent`。

允许更新：

```ts
step.context.before.ui
step.uiRecipe
step.intentSuggestion
```

但 intent 本体只在非 user 来源时可自动更新。

---

## 5. Feature flag 设计

### 5.1 设置字段

在 `examples/recorder-crx/src/settings.ts` 中新增：

```ts
export interface CrxSettings {
  // existing...
  semanticAdapterEnabled?: boolean;
  semanticAdapterDiagnosticsEnabled?: boolean;
}
```

默认：

```ts
semanticAdapterEnabled: true
semanticAdapterDiagnosticsEnabled: false
```

### 5.2 UI 设置

在 `examples/recorder-crx/src/preferencesForm.tsx` 增加两个开关：

```text
启用 AntD / ProComponents 语义识别
启用语义识别诊断日志
```

说明文案：

```text
关闭后，页面上下文仍会采集基础 target/form/table/dialog，但不会写入 PageContextSnapshot.ui 或 FlowStep.uiRecipe。
诊断日志仅用于本地调试，不进入 flow export。
```

### 5.3 接入点

`pageContextSidecar.ts` 当前已有类似：

```ts
const baseUi = semanticAdapterEnabled ? collectUiSemanticContext(anchor, document) : undefined;
```

0.1.5 需要确保此开关来自设置注入，而不是永久常量。若当前 sidecar bundle 无法动态读取 settings，则先实现 build-time/default runtime flag，并在 side panel settings 中控制下一次安装/刷新生效。

最小可接受方案：

```ts
const semanticAdapterEnabled = readSidecarOptions()?.semanticAdapterEnabled !== false;
```

不要求在不刷新页面的情况下热切换。

### 5.4 关闭后的验收

关闭 `semanticAdapterEnabled` 后：

- `PageContextSnapshot.ui` 不应出现；
- `FlowStep.uiRecipe` 不应由 adapter 新增；
- recorder action、FlowStep、assertion、compact export 应保持原有逻辑；
- CRX E2E 中至少有一条测试证明关闭后仍可录制基础 action。

---

## 6. Diagnostics 设计

### 6.1 新增文件

```text
examples/recorder-crx/src/uiSemantics/diagnostics.ts
```

### 6.2 类型

```ts
export type SemanticDiagnosticLevel = 'debug' | 'info' | 'warn';

export interface SemanticDiagnosticEntry {
  id: string;
  time: string;
  level: SemanticDiagnosticLevel;
  event:
    | 'semantic.detect'
    | 'semantic.fallback-css'
    | 'semantic.weak'
    | 'semantic.disabled'
    | 'semantic.compact-sanitized';
  library: 'antd' | 'pro-components' | 'unknown';
  component: string;
  confidence?: number;
  weak?: boolean;
  targetTestId?: string;
  targetText?: string;
  recipeKind?: string;
  reasons?: string[];
  locatorHints?: Array<{
    kind: string;
    score: number;
    scope?: string;
    reason?: string;
    /** value 必须 truncate，不能是完整 selector/DOM/text */
    valuePreview?: string;
  }>;
  fallbackReasons?: string[];
}
```

### 6.3 存放位置

运行时：

```text
chrome.storage.session 或页面 side panel 内存 ring buffer
```

最小实现：在 side panel 进程内维护最近 200 条。

不得存入：

```text
BusinessFlow.artifacts
business-flow.json
compact-flow.yaml
AI usage records
```

### 6.4 隐私边界

Diagnostics 不得包含：

```text
完整 DOM
完整 HTML
完整 nearbyText
rowText 全文
overlay.text 全文
option.value
input value
rawAction
sourceCode
cookie/token/password/authorization
```

`locatorHints.value` 只允许作为 `valuePreview`，最多 80 字符，并经过 redactor。

### 6.5 触发点

在 `collectUiSemanticContext()` 或 `collectAntdSemanticContext()` 之后生成诊断摘要：

```ts
const ui = collectUiSemanticContext(anchor, document);
recordSemanticDiagnostic(compactSemanticDiagnostic(ui));
```

如果 diagnostics disabled，只返回 ui，不写日志。

### 6.6 诊断测试

增加测试覆盖：

- unknown target 诊断为 `semantic.weak` 或 `semantic.detect` + `library: unknown`；
- CSS fallback hint 时有 `semantic.fallback-css`；
- diagnostics 不包含 `locatorHints.value` 原文、`overlay.text`、`table.rowText`。

---

## 7. compact export / AI input 压缩策略

### 7.1 `exportSanitizer.ts`

当前已修 `step.target.raw.ui`，0.1.5 要补充两个回归约束：

- `sanitizeUiSemanticContext()` 是唯一导出清理入口；
- `FlowStep.uiRecipe` 若直接存在，也必须经过 compact 处理或只保留白名单字段。

新增 helper：

```ts
function sanitizeUiRecipe(recipe?: UiActionRecipe): UiActionRecipe | undefined {
  if (!recipe)
    return undefined;
  return {
    kind: recipe.kind,
    library: recipe.library,
    component: recipe.component,
    formKind: recipe.formKind,
    fieldKind: recipe.fieldKind,
    fieldLabel: recipe.fieldLabel,
    fieldName: recipe.fieldName,
    optionText: recipe.optionText,
    tableTitle: recipe.tableTitle,
    rowKey: recipe.rowKey,
    columnTitle: recipe.columnTitle,
    overlayTitle: recipe.overlayTitle,
    targetText: recipe.targetText,
  };
}
```

并在 export steps 中处理：

```ts
steps: flow.steps.map(step => ({
  ...step,
  uiRecipe: sanitizeUiRecipe(step.uiRecipe),
  target: sanitizeFlowTarget(step.target),
  context: sanitizeStepContext(step.context),
}))
```

### 7.2 `compactExporter.ts`

`toCompactFlow()` 只能输出：

```yaml
ui:
  library:
  component:
  recipe:
  field:
  fieldName:
  option:
  table:
  row:
  column:
  overlay:
  target:
  confidence:
  weak:
```

不得输出：

```text
locatorHints
reasons
overlay.text
rowText
option.value
componentPath 全量
```

### 7.3 `aiIntent/prompt.ts`

`buildAiIntentInput()` 已使用 `compactUiSemanticContext()`。0.1.5 要补：

- 测试证明 AI input 不包含 `locatorHints` / `reasons` / `rowText` / `overlay.text` / `option.value`；
- `target.testId` 可保留，完整 selector 不可保留；
- `before.url` 建议去 query/hash 或限制长度，避免泄漏业务参数。

最小改法：

```ts
url: compactUrl(before?.url)
```

```ts
function compactUrl(url?: string) {
  if (!url)
    return undefined;
  try {
    const parsed = new URL(url);
    return parsed.pathname;
  } catch {
    return url.split(/[?#]/)[0]?.slice(0, 120);
  }
}
```

---

## 8. 旧 flow 兼容策略

### 8.1 导入兼容

旧 flow 没有 ui 时：

- `compactUiSemanticContext(undefined, undefined)` 返回 `undefined`；
- `buildAiIntentInput()` 不输出 `ui` 字段；
- `prepareBusinessFlowForExport()` 不新增空对象；
- `toCompactFlow()` 不输出 `ui:` 空段。

### 8.2 迁移兼容

不需要为旧 flow 强制补 ui，也不要遍历旧 steps 做 DOM 反推。

0.1.5 只保证：

```text
旧 flow 能打开、编辑、导出、AI intent fallback。
```

### 8.3 测试

在 `stepStability.test.ts` 或新增 flow export 测试中构造旧 step：

```ts
const legacyFlow = {
  ...flow,
  steps: [{ id: 's001', order: 1, action: 'click', target: { text: '保存' }, assertions: [] }]
}
```

断言：

```ts
prepareBusinessFlowForExport(legacyFlow)
toCompactFlow(legacyFlow)
buildAiIntentInput(legacyFlow, legacyFlow.steps)
```

均不报错，且不输出空 `ui`。

---

## 9. 分阶段任务拆解

### Task A：Feature flag 与关闭回退

文件：

```text
examples/recorder-crx/src/settings.ts
examples/recorder-crx/src/preferencesForm.tsx
examples/recorder-crx/src/pageContextSidecar.ts
```

要求：

- 增加 `semanticAdapterEnabled`；
- 增加 `semanticAdapterDiagnosticsEnabled`；
- 关闭 adapter 时不写 `PageContextSnapshot.ui`；
- 关闭 adapter 时不新增 `uiRecipe`；
- 加一条 CRX E2E 或 flow test 证明关闭回退。

验证：

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build:examples:recorder
```

### Task B：Diagnostics ring buffer

文件：

```text
examples/recorder-crx/src/uiSemantics/diagnostics.ts
examples/recorder-crx/src/uiSemantics/antd.ts
examples/recorder-crx/src/pageContextSidecar.ts
```

要求：

- 记录最近 200 条 compact diagnostic；
- diagnostics 只存 compact 字段；
- fallback CSS / weak / unknown 要可解释；
- diagnostics 默认关闭。

验证：

```bash
npm run test:flow --prefix examples/recorder-crx
```

### Task C：Export / AI input 压缩回归

文件：

```text
examples/recorder-crx/src/flow/exportSanitizer.ts
examples/recorder-crx/src/flow/compactExporter.ts
examples/recorder-crx/src/aiIntent/prompt.ts
examples/recorder-crx/src/aiIntent/redactForModel.ts
examples/recorder-crx/src/flow/stepStability.test.ts
```

要求：

- `step.uiRecipe` 直接字段也走白名单；
- AI input URL 去 query/hash；
- compact YAML 不出现 locatorHints/reasons/rowText/overlay.text/option.value；
- 添加 regression tests。

验证：

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build:examples:recorder
```

### Task D：旧 flow 兼容测试

文件：

```text
examples/recorder-crx/src/flow/stepStability.test.ts
```

要求：

- 构造无 ui 的旧 flow；
- 验证 export / compact / AI input 不报错；
- 不输出空 ui 段。

验证：

```bash
npm run test:flow --prefix examples/recorder-crx
```

### Task E：Focused CRX stress

文件：

```text
tests/crx/semanticAdapter.spec.ts
```

要求：

- 在现有 fixture 上加关闭 adapter 的用例；
- 加 repeated capture stress：Select portal / Popconfirm / ProTable row action 重复 3 次，保证事件数量和 ui 语义稳定；
- 不用 mock；
- 不加 blind sleep，除非解释为等待 sidecar bundle 安装且已有相同风格。

验证：

```bash
xvfb-run -a npx playwright test -c tests/playwright.config.ts tests/crx/semanticAdapter.spec.ts --project=Chrome --workers=1 --reporter=line --global-timeout=300000
```

---

## 10. 测试计划

### Unit / flow tests

```bash
npm run test:flow --prefix examples/recorder-crx
```

必须覆盖：

- export sanitizer 清理 `context.before.ui`、`target.raw.ui`、`step.uiRecipe`；
- compact YAML 不包含敏感/膨胀字段；
- AI input 不包含敏感/膨胀字段；
- legacy flow 无 ui 兼容；
- semantic adapter disabled 时返回旧结构；
- diagnostics redaction。

### Build tests

```bash
npm run build:examples:recorder
npm run build:tests
npm run build:crx
```

### CRX E2E

```bash
xvfb-run -a npx playwright test -c tests/playwright.config.ts tests/crx/semanticAdapter.spec.ts --project=Chrome --workers=1 --reporter=line --global-timeout=300000
```

必须覆盖：

- enabled：真实 fixture 能写入 ui；
- disabled：不写入 ui，但基础 page context 仍存在；
- unknown DOM：`library: unknown`，`component: unknown`，`weak: true`；
- portal/overlay：Select / Popconfirm / Tooltip 至少能稳定识别；
- ProTable row action：能识别 rowKey / table title / action target。

### Focused stress

建议新增命令或测试名过滤：

```bash
xvfb-run -a npx playwright test -c tests/playwright.config.ts tests/crx/semanticAdapter.spec.ts -g "semantic adapter stress" --project=Chrome --workers=1 --reporter=line --global-timeout=300000
```

stress 不追求大规模，只重复关键路径 3~5 次，检查：

```text
事件数量稳定
ui.component 稳定
ui.recipe.kind 稳定
没有多余 synthetic / duplicate event 误判
```

---

## 11. 验收标准

PR #10 必须满足：

- [ ] PR #9 已合并或基于 PR #9 最新 HEAD；
- [ ] `semanticAdapterEnabled=false` 时能回退旧行为；
- [ ] diagnostics 默认关闭；
- [ ] diagnostics 不进入 flow export / compact YAML / AI input；
- [ ] `prepareBusinessFlowForExport()` 清理 `context.before.ui`、`target.raw.ui`、`step.uiRecipe`；
- [ ] `toCompactFlow()` 只输出 compact ui；
- [ ] `buildAiIntentInput()` 只输出 compact ui，并去掉 URL query/hash；
- [ ] 无 ui 的旧 flow 兼容；
- [ ] 人工 intent 不被 semantic adapter 覆盖；
- [ ] `npm run test:flow --prefix examples/recorder-crx` 通过；
- [ ] `npm run build:examples:recorder` 通过；
- [ ] `npm run build:tests` 通过；
- [ ] `npm run build:crx` 通过；
- [ ] `tests/crx/semanticAdapter.spec.ts` focused E2E 通过。

---

## 12. 不允许的捷径

不允许：

```text
不允许删测试断言
不允许用 mock 替代 CRX E2E fixture
不允许为了过测试添加盲 sleep
不允许删除 semantic adapter 失败分支
不允许把 diagnostics 存进 business-flow.json
不允许把完整 locatorHints/reasons/rowText/overlay.text 发给 AI
不允许修改 Playwright recorder/player core
不允许提前做 Recipe Codegen Preview / Runner / Spec Generation
不允许直接跳 MVP 0.2
```
