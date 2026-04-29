# MVP 0.1.1 任务设计：P0 修复 + Page Context + Intent Suggestion

## 任务目标

在当前 Playwright CRX 业务流程录制 MVP 0.1 基础上，完成：

1. P0 修复；
2. 插件内页面上下文采集；
3. 非 AI 中文 intent suggestion；
4. suggestion 默认写入 `step.intent`；
5. 用户修改后不再被自动覆盖；
6. compact YAML 输出 context。

本任务完成后，测试人员录制流程时，大部分步骤应该自动带有可读业务意图。

---

## 范围约束

### 本轮允许

- 修改浏览器插件内代码；
- 增加 content script / page sidecar；
- 增加 flow 类型字段；
- 修改 compact exporter；
- 修改 redactor；
- 修改 step editor UI；
- 修复 `extractTestId()`；
- 修复保存/导出边界；
- 保留原有 recorder/player/code export。

### 本轮禁止

- Native Messaging；
- 本地 Node Runner；
- AI 生成 Playwright spec；
- AI 修复；
- CI；
- Git 自动提交或 PR；
- 完整 DOM 采集；
- 完整 trace 采集；
- 完整 response body 采集；
- cookie/token/password/authorization/secret 采集；
- 重写 Playwright recorder/player/locator。

---

## 需要重点阅读的文件

当前仓库中：

```text
AGENTS.md
ROADMAP.md
docs/tasks/MVP-0.1.md
docs/schemas/business-flow.schema.md
examples/recorder-crx/src/crxRecorder.tsx
examples/recorder-crx/src/background.ts
examples/recorder-crx/src/flow/types.ts
examples/recorder-crx/src/flow/flowBuilder.ts
examples/recorder-crx/src/flow/compactExporter.ts
examples/recorder-crx/src/flow/redactor.ts
examples/recorder-crx/src/components/StepEditor.tsx
examples/recorder-crx/src/components/StepList.tsx
src/server/recorder/crxRecorderApp.ts
```

本任务文档包中：

```text
docs/reviews/MVP-0.1-REVIEW.md
docs/design/DATA_STRUCTURE_CHANGES.md
docs/design/PAGE_CONTEXT_INTENT_ALGORITHM.md
docs/design/ENGINEERING_PLAN.md
docs/checklists/ACCEPTANCE_CHECKLIST.md
```

---

## 任务 1：修复 testId 提取

### 文件

```text
examples/recorder-crx/src/flow/flowBuilder.ts
```

### 要求

修复 `extractTestId()`，使其正确解析：

```text
internal:testid=[data-testid="xxx"s]
internal:testid=[data-testid="xxx"i]
[data-testid="xxx"]
[data-e2e="xxx"]
```

### 验收

输入：

```text
internal:testid=[data-testid="ha-wan-add-button"s]
```

输出：

```text
ha-wan-add-button
```

不要再输出：

```text
[data-testid="ha-wan-add-button"s
```

---

## 任务 2：comment 始终可编辑

### 文件

```text
examples/recorder-crx/src/components/StepEditor.tsx
```

### 要求

每个 step 都显示备注 textarea。

不要依赖：

```ts
step.comment !== undefined
```

使用：

```ts
step.comment ?? ''
```

### 验收

录制出的普通步骤，即使之前没有 `comment` 字段，也能填写备注。

---

## 任务 3：新增 intent/context 类型

### 文件

新增：

```text
examples/recorder-crx/src/flow/pageContextTypes.ts
```

修改：

```text
examples/recorder-crx/src/flow/types.ts
```

### 要求

新增类型：

- `IntentSource`
- `StepContextSnapshot`
- `PageContextSnapshot`
- `PageContextAfterSnapshot`
- `ElementContext`
- `DialogContext`
- `SectionContext`
- `TableContext`
- `FormContext`
- `TabContext`
- `IntentSuggestion`
- `IntentProvenance`
- `PageContextEvent`

修改 `FlowStep`：

```ts
intentSource?: IntentSource;
intentSuggestion?: IntentSuggestion;
context?: StepContextSnapshot;
```

修改 `FlowTarget`：

```ts
displayName?: string;
```

### 验收

TypeScript build 通过；旧 flow 导入不报错。

---

## 任务 4：区分保存和导出

### 文件

```text
examples/recorder-crx/src/crxRecorder.tsx
```

或者更合适的 flow utility 文件。

### 要求

拆分当前类似 `withPlaywrightCode()` 的逻辑：

```ts
prepareFlowForStorage(flow, code)
prepareFlowForExport(flow, code)
```

保存记录：

```text
保留 deletedStepIds / deletedActionIndexes / stepActionIndexes
```

导出 JSON/YAML：

```text
删除 deletedStepIds / deletedActionIndexes / stepActionIndexes
删除 storageState
执行 redactor
```

### 验收

- 保存记录后重新打开，继续录制/插入录制不恢复已删除 step；
- 导出的 JSON/YAML 不带内部 recorder 映射状态。

---

## 任务 5：实现 pageContextSidecar

### 文件

```text
examples/recorder-crx/src/pageContextSidecar.ts
```

### 要求

监听：

```text
click
input
change
keydown
```

采集：

```text
before PageContextSnapshot
after PageContextAfterSnapshot，click 后延迟 100~200ms
```

采集字段：

- url；
- page title；
- breadcrumb；
- active tab；
- dialog/modal/drawer title；
- section/card/panel title；
- table title；
- rowKey；
- rowText；
- columnName；
- form item label；
- target text / aria / role / testId / placeholder；
- 少量 nearbyText。

限制：

- 向上搜索最多 10 层；
- nearbyText 最多 8 条；
- 单条文本最多 60 字；
- 不采集完整 DOM。

### 验收

在业务页面上点击按钮后，background 能收到一条 `pageContextEvent`，里面包含 target 和局部上下文。

---

## 任务 6：background ring buffer

### 文件

```text
examples/recorder-crx/src/background.ts
```

### 要求

按 tabId 保存最近 context events：

```text
最多 200 条
最多保留 5 分钟
```

提供 side panel 获取最近事件的消息通道。

建议消息：

```ts
{ type: 'pageContextEvent', event }
{ type: 'getRecentPageContextEvents', tabId }
{ type: 'recentPageContextEvents', events }
```

如果现有消息结构不同，以当前项目为准。

### 验收

side panel 能拿到当前 tab 最近 context events。

---

## 任务 7：实现 action/context 匹配

### 文件

```text
examples/recorder-crx/src/flow/pageContextMatcher.ts
```

### 要求

实现：

```ts
export function matchContextEvent(rawAction: unknown, events: PageContextEvent[]): PageContextEvent | undefined;
```

匹配窗口：

```text
startTime - 300ms 到 endTime + 800ms
```

兼容表：

```text
click          => click
fill           => input/change
select         => click/change
check/uncheck  => click/change
press          => keydown
navigate       => navigation
```

### 验收

录制 click 后，能把 rawAction 匹配到对应 page context event。

---

## 任务 8：实现 intentRules

### 文件

```text
examples/recorder-crx/src/flow/intentRules.ts
```

### 要求

实现：

```ts
export function suggestIntent(step: FlowStep, context: StepContextSnapshot): IntentSuggestion | undefined;
```

至少支持：

1. 点击新建按钮打开弹窗；
2. 点击行内编辑；
3. 点击删除；
4. 点击确定/保存；
5. 填写表单字段；
6. 选择下拉选项；
7. check/uncheck；
8. tab 切换；
9. navigate；
10. fallback。

不要写业务硬编码。

### 验收

可以生成：

```text
打开共享 WAN 新建弹窗
编辑 WAN1 共享 WAN
填写 WAN1 共享 WAN的 MTU
选择 WAN 为 WAN2
确认保存 WAN1 共享 WAN配置
```

这些文本来自页面上下文，而不是代码硬编码。

---

## 任务 9：合并 context 和 suggestion 到 flow

### 文件

```text
examples/recorder-crx/src/flow/flowContextMerger.ts
examples/recorder-crx/src/crxRecorder.tsx
```

### 要求

实现：

```ts
export function mergeStepContextsIntoFlow(
  flow: BusinessFlow,
  actions: unknown[],
  events: PageContextEvent[],
): BusinessFlow;
```

合并规则：

```text
写入 step.context
写入 step.intentSuggestion
如果 step.intent 为空：写入 suggestion.text，intentSource=auto
如果 step.intentSource=auto：可更新 intent
如果 step.intentSource=user：不覆盖 intent
```

### 验收

录制后 step.intent 自动出现；手动修改后不被覆盖。

---

## 任务 10：UI 标识 intent 来源

### 文件

```text
examples/recorder-crx/src/components/StepEditor.tsx
```

### 要求

在 intent 输入框附近显示：

```text
自动生成
人工修改
```

如果有：

```ts
step.intentSuggestion?.confidence
step.intentSuggestion?.rule
```

可以显示：

```text
自动生成 · 0.92 · click.create.open-dialog
```

用户手动修改 intent：

```ts
intentSource = 'user'
```

### 验收

用户能看出 intent 是自动还是人工。

---

## 任务 11：compact YAML 输出 context

### 文件

```text
examples/recorder-crx/src/flow/compactExporter.ts
```

### 要求

step 输出增加：

```yaml
intentSource: auto
suggestionConfidence: 0.92
context:
  page: 全局配置
  tab: WAN
  section: 共享 WAN
  table: 共享 WAN
  row: WAN1
  column: 操作
  dialog: 编辑 WAN1 共享 WAN
  field: MTU
  target: 确定
  resultDialog: 新建共享 WAN
  toast: 保存成功
```

过滤空字段。

### 验收

导出的 compact YAML 包含短上下文，不包含 rawAction。

---

## 任务 12：redactor 覆盖新字段

### 文件

```text
examples/recorder-crx/src/flow/redactor.ts
```

### 要求

确保以下字段被递归脱敏：

```text
step.context
step.intentSuggestion
FlowTarget.displayName
```

### 验收

导出 JSON/YAML 时不会泄露手机号、邮箱、身份证、token、password、authorization、secret。

---

## 任务 13：构建与手工验证

### 命令

至少运行：

```bash
npm run build
```

如果项目有 recorder-crx 单独 build，也运行。

### 手工验证

详见：

```text
docs/checklists/ACCEPTANCE_CHECKLIST.md
```

---

## 最终交付格式

Codex 完成后输出：

1. Summary；
2. Changed files；
3. How to test；
4. Acceptance checklist；
5. Known limitations；
6. Risks；
7. Next handoff。

不要自动 git commit，除非用户明确要求。

