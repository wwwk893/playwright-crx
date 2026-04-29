# 工程实施方案：Page Context Sidecar + Intent Suggestion

## 目标

在当前 `playwright-crx` fork 的 MVP 0.1 基础上，用最小改动完成：

1. P0 修复；
2. 页面上下文采集；
3. action 与 context 匹配；
4. 非 AI intent suggestion；
5. 自动写入 `step.intent`；
6. compact YAML 输出 context。

本轮仍只允许浏览器插件内能力。

---

## 禁止事项

本轮不要实现：

- Native Messaging；
- 本地 Node Runner；
- AI 生成 Playwright spec；
- AI 修复；
- CI；
- Git 自动提交或 PR；
- 大型测试平台；
- 完整 DOM 采集；
- 完整 trace 采集；
- 完整 response body 采集；
- cookie/token/password/authorization/secret 采集。

也不要：

- 重写 Playwright recorder；
- 重写 Playwright player；
- 重写 locator 生成逻辑；
- 把全部逻辑继续塞进 `crxRecorder.tsx`；
- 引入复杂状态管理；
- 写满屏 try/catch。

---

## 建议新增文件

```text
examples/recorder-crx/src/flow/pageContextTypes.ts
examples/recorder-crx/src/pageContextSidecar.ts
examples/recorder-crx/src/flow/pageContextMatcher.ts
examples/recorder-crx/src/flow/intentRules.ts
examples/recorder-crx/src/flow/flowContextMerger.ts
```

### 文件职责

| 文件 | 职责 |
|---|---|
| `pageContextTypes.ts` | 定义 `StepContextSnapshot`、`PageContextEvent`、`IntentSuggestion` 等类型 |
| `pageContextSidecar.ts` | 页面内事件监听与小型 DOM 上下文采集 |
| `pageContextMatcher.ts` | 将 Playwright rawAction 与 context event 进行时间窗口匹配 |
| `intentRules.ts` | 非 AI 中文 intent 生成规则 |
| `flowContextMerger.ts` | 把 context/suggestion 合并进 `FlowStep` |

---

## 第一阶段：P0 修复

### 1. 修复 `extractTestId()`

文件：

```text
examples/recorder-crx/src/flow/flowBuilder.ts
```

需求：

支持：

```text
internal:testid=[data-testid="ha-wan-add-button"s]
internal:testid=[data-testid="ha-wan-add-button"i]
[data-testid="ha-wan-add-button"]
[data-e2e="ha-wan-add-button"]
```

示例实现：

```ts
function extractTestId(selector: string) {
  const normalized = selector.trim();
  const internalMatch = normalized.match(/internal:testid=\[data-(?:testid|e2e)=["']([^"']+)["'][si]?\]/);
  if (internalMatch)
    return internalMatch[1];

  const attrMatch = normalized.match(/\[data-(?:testid|e2e)=["']([^"']+)["']\]/);
  return attrMatch?.[1];
}
```

不要写完整 selector parser。

### 2. comment 始终可编辑

文件：

```text
examples/recorder-crx/src/components/StepEditor.tsx
```

将 comment textarea 改成始终展示：

```tsx
<textarea
  value={step.comment ?? ''}
  onChange={event => onChange({ ...step, comment: event.target.value })}
/>
```

### 3. 增加 intent/context 字段

文件：

```text
examples/recorder-crx/src/flow/types.ts
examples/recorder-crx/src/flow/pageContextTypes.ts
```

修改 `FlowStep`：

```ts
intentSource?: 'auto' | 'user';
intentSuggestion?: IntentSuggestion;
context?: StepContextSnapshot;
```

人工编辑 intent 时设置：

```ts
intentSource: 'user'
```

旧 flow normalize：

```ts
if (step.intent && !step.intentSource)
  step.intentSource = 'user';
```

### 4. 保存与导出分离

当前如果存在 `withPlaywrightCode()` 同时用于保存和导出，需要拆分。

建议：

```ts
function prepareFlowForStorage(flow: BusinessFlow, code?: string): BusinessFlow {
  return {
    ...flow,
    artifacts: {
      ...flow.artifacts,
      playwrightCode: code,
    },
    updatedAt: new Date().toISOString(),
  };
}

function prepareFlowForExport(flow: BusinessFlow, code?: string): BusinessFlow {
  const artifacts = { ...flow.artifacts, playwrightCode: code };
  delete artifacts.deletedStepIds;
  delete artifacts.deletedActionIndexes;
  delete artifacts.stepActionIndexes;
  delete artifacts.storageState;
  return {
    ...flow,
    artifacts,
    updatedAt: new Date().toISOString(),
  };
}
```

如果 TypeScript 不允许 `storageState` 删除，需要按实际类型调整。

保存记录使用 `prepareFlowForStorage()`。

导出 JSON/YAML 使用 `prepareFlowForExport()`。

---

## 第二阶段：pageContextSidecar

### 1. 注入方式

优先沿用当前 extension 里已有的 content script / injected script 机制。如果当前项目没有现成 content script，则在 background attach tab 后注入一个小脚本。

不要改 Playwright recorder。

### 2. 事件监听

只监听：

```text
click
input
change
keydown
```

不要监听：

```text
mousemove
mouseover
scroll
resize
```

click 使用 capture phase：

```ts
document.addEventListener('click', handleClick, true);
```

采集 before，然后延迟采集 after：

```ts
const before = collectPageContext(event.target as Element);
setTimeout(() => {
  const after = collectAfterContext();
  emit({ kind: 'click', time, before, after });
}, 120);
```

延迟建议：

```text
100 ~ 200ms
```

不要等待太久，避免干扰录制体验。

### 3. 发送消息

content sidecar 发送：

```ts
chrome.runtime.sendMessage({
  type: 'pageContextEvent',
  event,
});
```

background 接收后按 tabId 存 ring buffer。

### 4. Ring buffer

每个 tab 保存：

```text
最多 200 条事件
或最近 5 分钟事件
```

不要持久化到 IndexedDB。只把合并后的 step.context 存进 flow。

---

## 第三阶段：action 与 context 匹配

新增：

```text
examples/recorder-crx/src/flow/pageContextMatcher.ts
```

核心函数：

```ts
export function matchContextEvent(rawAction: unknown, events: PageContextEvent[]): PageContextEvent | undefined;
```

实现原则：

- 从 rawAction 提取 `name`、`startTime`、`endTime`；
- 使用 `performance.now()` 同时钟匹配；
- 时间窗口：`startTime - 300ms` 到 `endTime + 800ms`；
- 事件类型兼容即可；
- 取离 `startTime` 最近的事件。

兼容表：

```text
click          => click
fill           => input/change
select         => click/change
check/uncheck  => click/change
press          => keydown
navigate       => navigation
```

如果匹配不到：返回 undefined，不要复杂猜。

---

## 第四阶段：Intent Rules

新增：

```text
examples/recorder-crx/src/flow/intentRules.ts
```

核心函数：

```ts
export function suggestIntent(step: FlowStep, context: StepContextSnapshot): IntentSuggestion | undefined;
```

建议规则顺序：

1. click create + after dialog；
2. click edit row；
3. click delete row；
4. click save/confirm inside dialog；
5. fill field；
6. select/dropdown option；
7. check/uncheck；
8. tab switch；
9. navigate；
10. fallback：点击/填写/选择目标文本。

每条规则返回：

```ts
{
  text: string;
  confidence: number;
  rule: string;
  provenance: IntentProvenance[];
}
```

不要写业务硬编码，例如 WAN、WAN1、共享 WAN。只能使用 context 采集到的文本。

---

## 第五阶段：合并进 Flow

新增：

```text
examples/recorder-crx/src/flow/flowContextMerger.ts
```

核心函数：

```ts
export function mergeStepContextsIntoFlow(
  flow: BusinessFlow,
  actions: unknown[],
  events: PageContextEvent[],
): BusinessFlow;
```

伪代码：

```ts
for (const step of flow.steps) {
  const actionIndex = findActionIndexForStep(step, flow);
  const rawAction = actions[actionIndex] ?? step.rawAction;
  const event = matchContextEvent(rawAction, events);
  if (!event)
    continue;

  const context = toStepContextSnapshot(step, actionIndex, event);
  const suggestion = suggestIntent(step, context);

  step.context = context;
  step.intentSuggestion = suggestion;

  if (suggestion && (!step.intent || step.intentSource === 'auto')) {
    step.intent = suggestion.text;
    step.intentSource = 'auto';
  }
}
```

注意：

```text
step.intentSource = user 时，不覆盖 intent。
```

---

## 第六阶段：接入 side panel

在 `crxRecorder.tsx` 的 `setActions` 处理流程中：

当前大致是：

```ts
const nextFlow = mergeActionsIntoFlow(prev, actions, sources);
```

改成：

```ts
const nextFlow = mergeActionsIntoFlow(prev, actions, sources);
const events = getRecentPageContextEventsForCurrentTab();
const withContext = mergeStepContextsIntoFlow(nextFlow, actions, events);
```

如果获取 events 是 async，可以先：

1. 同步 merge actions；
2. 异步请求 recent context events；
3. 请求完成后 patch flow steps。

不要为了这个引入 Redux 或复杂状态机。

---

## 第七阶段：UI 展示

### StepEditor

intent 输入框旁边展示来源：

```text
自动生成
人工修改
```

如果有 suggestion confidence：

```text
自动生成 · 0.92 · click.create.open-dialog
```

不要做复杂 UI。简单文本即可。

如果用户点击 intent 输入框并修改：

```ts
intentSource = 'user'
```

### 可选：重置为自动建议

可以加一个小按钮：

```text
使用自动建议
```

点击后：

```ts
intent = step.intentSuggestion.text
intentSource = 'auto'
```

如果时间不够，这个按钮可以不做。

---

## 第八阶段：compact YAML 输出 context

文件：

```text
examples/recorder-crx/src/flow/compactExporter.ts
```

在 `compactStep()` 增加：

```ts
intentSource: step.intentSource,
suggestionConfidence: step.intentSuggestion?.confidence,
context: compactContext(step.context),
```

`compactContext()` 只输出短字段：

```text
page
tab
section
table
row
column
dialog
field
target
resultDialog
toast
```

过滤空值。

---

## 第九阶段：redactor 覆盖 context

文件：

```text
examples/recorder-crx/src/flow/redactor.ts
```

确保新增字段也会被脱敏：

```text
step.context
step.intentSuggestion.provenance
FlowTarget.displayName
```

如果 redactor 已经递归处理对象和值，只需确认规则覆盖即可。

---

## 第十阶段：验证

### 自动验证

运行：

```bash
npm run build
```

如果仓库提供 recorder-crx 独立 build，也运行。

### 手工验证场景

至少手工验证这些场景：

1. 点击页面“新建”按钮，打开弹窗，step.intent 自动填入“打开 xxx 新建弹窗”。
2. 表格行内点击“编辑”，step.intent 自动填入“编辑 row xxx”。
3. 弹窗内填写 `MTU` 字段，step.intent 自动填入“填写 xxx 的 MTU”。
4. 下拉选择 `WAN2`，step.intent 自动填入“选择 WAN 为 WAN2”。
5. 弹窗内点击“确定”，step.intent 自动填入“确认保存 xxx 配置”。
6. 手动修改 intent 后，继续录制或刷新 actions，不覆盖人工 intent。
7. 删除步骤、保存记录、重新打开记录、继续录制，不恢复已删除 action。
8. 导出 `business-flow.json` 包含 context，但不包含敏感信息。
9. 导出 `compact-flow.yaml` 包含短 context，不包含 rawAction。
10. 原有 recorder/player/code preview 没有损坏。

---

## 最小风险策略

如果时间不够，按这个降级顺序：

1. 必须完成 P0 修复；
2. 必须完成 click 的 before/after context；
3. 必须完成 click create/edit/save 的 intent；
4. 尽量完成 fill/select；
5. check/press/tab 可后续补。

但不要留下 build 失败。

