# 数据结构变更设计：Step Context 与 Intent Suggestion

## 目标

当前 `BusinessFlow / FlowStep / FlowTarget / FlowAssertion` 已能支持 MVP 0.1 的录制、编辑、断言和导出。下一步需要让每个 step 携带小型页面语义上下文，并区分自动生成 intent 与测试人员手写 intent。

本设计只面向 MVP 0.1.1：

- 插件内能力；
- 非 AI 规则；
- 小型 DOM 语义摘要；
- 不采集完整 DOM / trace / response body；
- 不采集 cookie/token/password/authorization。

---

## 当前结构评价

### BusinessFlow

当前结构：

```ts
export interface BusinessFlow {
  schema: typeof BUSINESS_FLOW_SCHEMA;
  flow: FlowMeta;
  env: FlowEnv;
  preconditions: string[];
  testData: FlowTestDataItem[];
  steps: FlowStep[];
  network: FlowNetworkEvent[];
  artifacts?: {
    playwrightCode?: string;
    storageState?: unknown;
    deletedStepIds?: string[];
    deletedActionIndexes?: number[];
    stepActionIndexes?: Record<string, number>;
  };
  createdAt: string;
  updatedAt: string;
}
```

评价：

- 支撑 MVP 0.1 足够。
- `artifacts.playwrightCode` 保留合理。
- `rawAction/sourceCode` 保留合理。
- `deletedActionIndexes/stepActionIndexes` 属于内部 recorder 状态，长期更适合放到 `recorderState`，但本轮可先保留在 `artifacts`。
- `storageState` 不建议导出给用户，尤其不应包含登录态和敏感信息。

本轮最小改动建议：

```text
不要强制迁移 artifacts 内部字段；
只修改保存/导出边界：保存记录保留内部字段，导出时 strip。
```

---

## 推荐新增类型

新增文件：

```text
examples/recorder-crx/src/flow/pageContextTypes.ts
```

推荐内容：

```ts
export type IntentSource = 'auto' | 'user';

export interface StepContextSnapshot {
  eventId: string;
  actionIndex?: number;
  capturedAt: number;
  before: PageContextSnapshot;
  after?: PageContextAfterSnapshot;
}

export interface PageContextSnapshot {
  url?: string;
  title?: string;
  breadcrumb?: string[];

  activeTab?: TabContext;
  dialog?: DialogContext;
  section?: SectionContext;
  table?: TableContext;
  form?: FormContext;
  target?: ElementContext;

  nearbyText?: string[];
}

export interface PageContextAfterSnapshot {
  url?: string;
  title?: string;
  breadcrumb?: string[];
  activeTab?: TabContext;
  dialog?: DialogContext;
  toast?: string;
}

export interface ElementContext {
  tag?: string;
  role?: string;
  testId?: string;
  ariaLabel?: string;
  title?: string;
  text?: string;
  placeholder?: string;
  valuePreview?: string;
  normalizedText?: string;
}

export interface DialogContext {
  type: 'modal' | 'drawer' | 'popover' | 'dropdown';
  title?: string;
  visible: boolean;
}

export interface SectionContext {
  title?: string;
  kind?: 'card' | 'panel' | 'section' | 'fieldset' | 'page';
  testId?: string;
}

export interface TableContext {
  title?: string;
  testId?: string;
  rowKey?: string;
  rowText?: string;
  columnName?: string;
  headers?: string[];
}

export interface FormContext {
  title?: string;
  label?: string;
  name?: string;
  required?: boolean;
}

export interface TabContext {
  title?: string;
  key?: string;
}

export interface IntentSuggestion {
  text: string;
  confidence: number;
  rule: string;
  provenance: IntentProvenance[];
}

export interface IntentProvenance {
  field: string;
  value: string;
}

export interface PageContextEvent {
  id: string;
  tabId?: number;
  kind: 'click' | 'input' | 'change' | 'keydown' | 'navigation';
  time: number;
  before: PageContextSnapshot;
  after?: PageContextAfterSnapshot;
}
```

---

## 修改 FlowStep

当前：

```ts
export interface FlowStep {
  id: string;
  order: number;
  action: FlowActionType;
  intent?: string;
  comment?: string;
  target?: FlowTarget;
  value?: string;
  url?: string;
  assertions: FlowAssertion[];
  networkRefs?: string[];
  rawAction?: unknown;
  sourceCode?: string;
}
```

建议改为：

```ts
import type { IntentSource, IntentSuggestion, StepContextSnapshot } from './pageContextTypes';

export interface FlowStep {
  id: string;
  order: number;
  action: FlowActionType;

  intent?: string;
  intentSource?: IntentSource;
  intentSuggestion?: IntentSuggestion;

  comment?: string;
  context?: StepContextSnapshot;

  target?: FlowTarget;
  value?: string;
  url?: string;

  assertions: FlowAssertion[];
  networkRefs?: string[];

  rawAction?: unknown;
  sourceCode?: string;
}
```

### intentSource 规则

```text
auto：由 intentRules 生成，允许后续自动更新。
user：测试人员手动编辑，绝不自动覆盖。
```

旧数据迁移规则：

```ts
if (step.intent && !step.intentSource)
  step.intentSource = 'user';
```

### intentSuggestion 作用

用于保存最近一次自动建议，不管最终 `intent` 是否采用。

当用户已经手动改过 intent：

```text
intent 保持 user 版本；
intentSuggestion 更新为系统建议；
UI 可以展示“自动建议：xxx”。
```

### context 作用

保存已经合并进 step 的小型页面上下文。

它不是完整 DOM，而是：

```text
页面标题、面包屑、tab、section、table、row、field、dialog、target text 等。
```

---

## 修改 FlowTarget

当前：

```ts
export interface FlowTarget {
  selector?: string;
  locator?: string;
  role?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  testId?: string;
  text?: string;
  raw?: unknown;
}
```

建议新增：

```ts
displayName?: string;
```

完整：

```ts
export interface FlowTarget {
  selector?: string;
  locator?: string;
  role?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  testId?: string;
  text?: string;
  displayName?: string;
  raw?: unknown;
}
```

用途：

```text
selector/testId/role 是定位信息；
displayName 是人类可读目标名，例如“新建”“确定”“MTU”。
```

---

## 保存与导出边界

### IndexedDB 保存记录

保存完整内部状态：

```text
steps.context
steps.intentSuggestion
steps.intentSource
rawAction
sourceCode
artifacts.stepActionIndexes
artifacts.deletedActionIndexes
artifacts.deletedStepIds
artifacts.playwrightCode
```

原因：这些字段支撑继续录制、插入录制、删除步骤后重新打开等行为。

### Export Business Flow JSON

导出时应：

- 保留 `context`；
- 保留 `intentSource`；
- 保留 `intentSuggestion`；
- 保留 `rawAction`，但必须经过 redactor；
- 保留 `sourceCode`，但必须经过 redactor；
- 保留 `artifacts.playwrightCode`，但必须经过 redactor；
- 删除内部 recorder 映射状态：
  - `deletedStepIds`
  - `deletedActionIndexes`
  - `stepActionIndexes`
- 不导出 `storageState`。

建议新增函数：

```ts
export function prepareFlowForStorage(flow: BusinessFlow, code?: string): BusinessFlow;
export function prepareFlowForExport(flow: BusinessFlow, code?: string): BusinessFlow;
```

不要再用同一个 `withPlaywrightCode()` 同时服务保存和导出。

### compact-flow.yaml

compact YAML 只输出 AI/人类理解需要的内容：

```yaml
- id: s001
  order: 1
  intent: 打开共享 WAN 新建弹窗
  intentSource: auto
  suggestionConfidence: 0.92
  action: click
  target: 新建
  context:
    page: 全局配置
    tab: WAN
    section: 共享 WAN
    table: 共享 WAN
    target: 新建
    resultDialog: 新建共享 WAN
```

不要输出：

- `rawAction`
- 完整 DOM
- 完整 trace
- 完整 network response body
- cookie/token/password/authorization/secret
- 内部 recorder 映射状态

---

## compact context 输出设计

建议在 `compactExporter.ts` 中新增：

```ts
function compactContext(context?: StepContextSnapshot) {
  if (!context)
    return undefined;
  const before = context.before;
  const after = context.after;
  return {
    page: last(before.breadcrumb) || before.title,
    tab: before.activeTab?.title,
    section: before.section?.title,
    table: before.table?.title,
    row: before.table?.rowKey || before.table?.rowText,
    column: before.table?.columnName,
    dialog: before.dialog?.title,
    field: before.form?.label,
    target: before.target?.displayName || before.target?.text || before.target?.ariaLabel,
    resultDialog: after?.dialog?.title,
    toast: after?.toast,
  };
}
```

过滤空值，保持短小。

---

## redactor 追加要求

当前 redactor 已有基础脱敏。新增 context 后，需要覆盖：

```text
context.before.target.valuePreview
context.before.nearbyText
context.after.toast
intentSuggestion.provenance.value
```

仍然保持结构，不要删除字段，只替换敏感值。

敏感规则：

```text
key 包含 password/token/cookie/authorization/secret → ***
JWT → ***token***
长 base64-like 字符串 → ***token***
手机号 → ***phone***
邮箱 → ***email***
身份证样式 → ***id***
```

---

## 最小兼容策略

导入旧 flow 时：

```ts
function normalizeImportedFlow(flow: BusinessFlow): BusinessFlow {
  return {
    ...flow,
    steps: flow.steps.map(step => ({
      ...step,
      intentSource: step.intentSource ?? (step.intent ? 'user' : undefined),
      assertions: step.assertions ?? [],
    })),
  };
}
```

不要为了旧数据写复杂迁移系统。MVP 阶段只需要轻量 normalize。

