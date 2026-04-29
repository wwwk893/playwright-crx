# MVP-0.1.md

# MVP 0.1：浏览器插件内业务流程录制

## 目标

在 Playwright CRX recorder 的基础上，加一层 Business Flow 录制能力。测试人员可以录制流程、给流程和步骤补充业务信息、添加断言，并导出 `business-flow.json` 和 `compact-flow.yaml`。

MVP 0.1 不做本地 Node Runner、不做 Native Messaging、不做 AI。

---

## 1. 范围

### In scope

- 暴露 recorded actions 给 side panel。
- 新增 `BusinessFlow` 类型。
- 将 Playwright actions 合并成 Flow steps。
- Flow metadata UI。
- Step list UI。
- Step intent/comment 编辑。
- Assertion editor。
- JSON/YAML 导出。
- IndexedDB 草稿保存。
- 脱敏。
- best-effort network summary。
- 保留原有 Playwright code export 和 replay。

### Out of scope

- 本地项目写文件。
- 执行 `npx playwright test`。
- Native Messaging。
- AI 生成。
- 自动 PR。
- 后台平台。
- 复杂权限系统。

---

## 2. 关键文件

优先修改：

```text
src/server/recorder/crxRecorderApp.ts
examples/recorder-crx/src/background.ts
examples/recorder-crx/src/crxRecorder.tsx
examples/recorder-crx/src/settings.ts
examples/recorder-crx/src/saveCodeForm.tsx
```

新增：

```text
examples/recorder-crx/src/flow/types.ts
examples/recorder-crx/src/flow/flowBuilder.ts
examples/recorder-crx/src/flow/compactExporter.ts
examples/recorder-crx/src/flow/download.ts
examples/recorder-crx/src/flow/storage.ts
examples/recorder-crx/src/flow/redactor.ts
examples/recorder-crx/src/flow/networkRecorder.ts
examples/recorder-crx/src/components/FlowMetaPanel.tsx
examples/recorder-crx/src/components/StepList.tsx
examples/recorder-crx/src/components/StepEditor.tsx
examples/recorder-crx/src/components/AssertionEditor.tsx
```

如果路径不存在，先搜索等价文件：

```bash
rg "class CrxRecorderApp|setActions|RecorderMessage|CrxRecorder|SaveCodeForm|idb-keyval|attach"
```

---

## 3. Step 1：确认原始能力

先运行：

```bash
npm ci
npm run build
```

手工确认：

```text
插件能加载
能 attach 当前 tab
能 record
能 replay
能导出现有 Playwright code
```

只有原始能力正常，再开始改造。

---

## 4. Step 2：把 recorded actions 发送给 side panel

### 目标

让 `examples/recorder-crx/src/crxRecorder.tsx` 可以收到结构化 `actions`，而不是只拿到生成后的 code。

### 实施

检查 `src/server/recorder/crxRecorderApp.ts` 中是否已有类似：

```ts
async setActions(actions: ActionInContext[], sources: Source[]) {
  // ...
}
```

如果没有发送 actions 给前端，则添加最小 patch：

```ts
async setActions(actions: ActionInContext[], sources: Source[]) {
  this._recordedActions = Array.from(actions);
  this._sources = Array.from(sources);

  this._sendMessage({
    type: 'recorder',
    method: 'setActions',
    actions: this._recordedActions,
    sources,
  });

  if (this._recorder._isRecording())
    this._updateCode(null);
}
```

如果上游已经有 `setActions` 消息，则不要重复添加；直接在 UI 侧消费该消息。

### UI 消费

在 `crxRecorder.tsx` 的 message handler 中增加：

```ts
case 'setActions':
  setRecordedActions(msg.actions ?? []);
  setSources(msg.sources ?? []);
  setFlowDraft(prev => mergeActionsIntoFlow(prev, msg.actions ?? [], msg.sources ?? []));
  break;
```

### 验收

- 录制 click/fill 后，side panel state 中能看到 actions 数量变化。
- 原有源码显示仍然更新。
- 原有 replay 不受影响。

---

## 5. Step 3：定义 BusinessFlow 类型

新增：`examples/recorder-crx/src/flow/types.ts`

实现：

```ts
export type FlowAssertionType =
  | 'visible'
  | 'textContains'
  | 'textEquals'
  | 'valueEquals'
  | 'urlMatches'
  | 'toastContains'
  | 'tableRowExists'
  | 'apiStatus'
  | 'apiRequestContains'
  | 'custom';

export type FlowActionType =
  | 'navigate'
  | 'click'
  | 'fill'
  | 'select'
  | 'check'
  | 'uncheck'
  | 'press'
  | 'upload'
  | 'assert'
  | 'unknown';

export interface FlowMeta {
  id: string;
  name: string;
  app?: string;
  repo?: string;
  module?: string;
  page?: string;
  role?: string;
  priority?: 'P0' | 'P1' | 'P2' | 'P3';
  businessGoal?: string;
  owner?: string;
  tags?: string[];
}

export interface FlowEnv {
  baseUrl?: string;
  browser?: string;
  viewport?: string;
  timezone?: string;
  gitCommit?: string;
  url?: string;
}

export interface FlowTestDataItem {
  key: string;
  value: string;
  strategy?: 'literal' | 'generated' | 'masked' | 'runtime';
  rule?: string;
}

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

export interface FlowAssertion {
  id: string;
  type: FlowAssertionType;
  target?: FlowTarget;
  expected?: string;
  note?: string;
  enabled: boolean;
}

export interface FlowNetworkEvent {
  id: string;
  stepId?: string;
  method: string;
  url: string;
  urlPattern?: string;
  status?: number;
  resourceType?: string;
  requestPostData?: unknown;
  responseBodyPreview?: string;
  timestamp: number;
  alias?: string;
  selected?: boolean;
}

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

export interface BusinessFlow {
  schema: 'business-flow/v1';
  flow: FlowMeta;
  env: FlowEnv;
  preconditions: string[];
  testData: FlowTestDataItem[];
  steps: FlowStep[];
  network: FlowNetworkEvent[];
  artifacts?: {
    playwrightCode?: string;
    storageState?: unknown;
  };
  createdAt: string;
  updatedAt: string;
}
```

同时实现：

```ts
export function createEmptyBusinessFlow(partial?: Partial<BusinessFlow>): BusinessFlow
```

默认值：

```text
schema = business-flow/v1
flow.id = draft-${Date.now()}
flow.name = ""
steps = []
network = []
createdAt/updatedAt = new Date().toISOString()
```

---

## 6. Step 4：实现 flowBuilder

新增：`examples/recorder-crx/src/flow/flowBuilder.ts`

### 目标

把 Playwright recorded actions 转换为业务步骤，并保留用户已经写过的 intent/comment/assertions。

### API

```ts
export function mergeActionsIntoFlow(
  prev: BusinessFlow,
  actions: unknown[],
  sources: unknown[]
): BusinessFlow;
```

### 映射规则

```text
action.name === 'navigate'      -> navigate
action.name === 'click'         -> click
action.name === 'fill'          -> fill
action.name === 'select'        -> select
action.name === 'selectOption'  -> select
action.name === 'check'         -> check
action.name === 'uncheck'       -> uncheck
action.name === 'press'         -> press
action.name === 'setInputFiles' -> upload
action.name starts with assert  -> assert
otherwise                       -> unknown
```

### 稳定 step id

```ts
function stepId(index: number) {
  return `s${String(index + 1).padStart(3, '0')}`;
}
```

### 保留用户编辑

如果旧 flow 中已有同 id/order 的 step：

```text
保留 intent
保留 comment
保留 assertions
保留 networkRefs
更新 rawAction
更新 target
更新 value
更新 url
更新 sourceCode
```

### target 提取

尽量从 action 中提取：

```text
selector
locator
role
name
label
placeholder
testId
text
```

如果只能拿到 selector，就先保存：

```ts
target: { selector: action.selector, raw: action }
```

### 验收

- 新录制 3 个动作后，flow.steps 长度为 3。
- 编辑 s002 的 comment 后，再录制第 4 步，s002 comment 不丢。
- 清空 recorder 后，steps 可以同步清空或显示为 draft 状态，行为要稳定。

---

## 7. Step 5：Flow metadata UI

新增：`examples/recorder-crx/src/components/FlowMetaPanel.tsx`

字段：

```text
flow.name，必填
flow.id，可编辑或自动 slug
flow.app
flow.repo
flow.module
flow.page
flow.role
flow.priority
flow.businessGoal
flow.owner
flow.tags
preconditions，多行
testData，多行 key=value
```

建议 UI：

```text
Business Flow
  Flow Name
  Module
  Role
  Priority
  Business Goal
  Advanced:
    App
    Repo
    Page
    Owner
    Tags
    Preconditions
    Test Data
```

### 注意

- 不要让 UI 占满整个 recorder。
- 可以折叠。
- 如果 name 为空，导出时 warning。
- testData 文本解析失败时保留原始字符串或提示，不要崩。

---

## 8. Step 6：Step list 和 step editor

新增：

```text
examples/recorder-crx/src/components/StepList.tsx
examples/recorder-crx/src/components/StepEditor.tsx
```

每个 step 显示：

```text
s001
action type
target summary
value/url summary
intent input
comment textarea
assertion count
network refs count
```

target summary 优先：

```text
testId
role + name
label
placeholder
selector
```

实现 callbacks：

```ts
onUpdateStep(stepId, patch)
onDeleteStep(stepId)
onIgnoreStep(stepId) // optional
```

MVP 0.1 可以先不删除真实 recorded action；如果做 ignore，请只在 flow 层标记，不要破坏 recorder actions。

---

## 9. Step 7：Assertion editor

新增：`examples/recorder-crx/src/components/AssertionEditor.tsx`

支持类型：

```text
visible
textContains
textEquals
valueEquals
urlMatches
toastContains
tableRowExists
apiStatus
apiRequestContains
custom
```

字段：

```text
type
target summary
expected
note
enabled
```

快捷按钮：

```text
+ 元素可见
+ 文本包含
+ 文本等于
+ 输入值等于
+ URL 匹配
+ Toast
+ 表格存在行
+ 接口状态
+ 请求参数包含
+ 自定义
```

默认断言建议：

- navigate：自动建议 `urlMatches`。
- fill：自动建议 `valueEquals`。
- click button with save/submit：自动建议 `toastContains` 和 `apiStatus`，但不要默认 enabled，除非用户确认。
- assert action：转换成对应 assertion 并 enabled。

---

## 10. Step 8：导出 JSON

新增：`examples/recorder-crx/src/flow/download.ts`

```ts
export function downloadText(filename: string, text: string, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

导出按钮：

```text
Export Flow JSON
```

文件名：

```text
{safeFlowId}.business-flow.json
```

导出前：

1. merge 当前 code 到 `artifacts.playwrightCode`。
2. redact。
3. validate basic invariants。
4. 如果无断言，warning。
5. download。

---

## 11. Step 9：导出 compact YAML

新增：`examples/recorder-crx/src/flow/compactExporter.ts`

API：

```ts
export function toCompactFlow(flow: BusinessFlow): string;
```

输出示例：

```yaml
flow: 客户管理-新增客户-保存成功
id: admin.customer.create.success
app: admin-web
repo: admin-frontend
module: 客户管理
role: 销售管理员
priority: P0
goal: 创建一个企业客户，保存后进入详情页，并校验核心字段展示正确

preconditions:
  - 已登录 sales_admin
  - 存在客户分类：企业客户

testData:
  customerName: AUTO_CUSTOMER_${timestamp}

steps:
  - id: s001
    intent: 进入新增客户页面
    action: navigate
    url: /customer/create
    assert:
      - url matches /customer/create

  - id: s002
    intent: 填写客户名称
    action: fill
    target: internal:role=textbox[name="客户名称"]
    value: ${customerName}
    assert:
      - value equals ${customerName}
```

不要输出：

```text
rawAction
完整 DOM
完整 network response body
cookie/token
大对象
```

---

## 12. Step 10：脱敏

新增：`examples/recorder-crx/src/flow/redactor.ts`

API：

```ts
export function redactValue(value: unknown): unknown;
export function redactBusinessFlow(flow: BusinessFlow): BusinessFlow;
```

规则：

```text
key 包含 password/passwd/pwd/token/cookie/authorization/auth/secret/session -> "***"
JWT -> "***token***"
长 base64 -> "***base64***"
手机号 -> "***phone***"
邮箱 -> "***email***"
身份证号 -> "***id***"
```

注意：

- 不要修改原对象，返回 clone。
- 对嵌套对象递归处理。
- 对循环引用做保护。
- 对过大字符串截断并标记。

---

## 13. Step 11：草稿保存

新增：`examples/recorder-crx/src/flow/storage.ts`

优先使用上游 example 已存在的 storage 依赖；如果已有 `idb-keyval`，用它。否则用 `chrome.storage.local` 也可以。

API：

```ts
export async function saveFlowDraft(flow: BusinessFlow): Promise<void>;
export async function loadFlowDraft(flowId: string): Promise<BusinessFlow | undefined>;
export async function listFlowDrafts(): Promise<BusinessFlow[]>;
export async function deleteFlowDraft(flowId: string): Promise<void>;
```

行为：

```text
flowDraft 变化后 debounce 1000ms 自动保存
启动 side panel 时加载最近草稿
提供 Clear Draft 按钮
```

验收：

- 录制两步，写 comment。
- 刷新 side panel。
- comment 还在。

---

## 14. Step 12：Network summary，best effort

新增：`examples/recorder-crx/src/flow/networkRecorder.ts`

目标是记录关键接口摘要，不追求完整 HAR。

如果 `background.ts` 的 attach 能拿到 page：

```ts
const page = await crxApp.attach(tab.id!);
bindNetworkRecorder(tab.id!, page);
```

在 `bindNetworkRecorder` 中：

```ts
page.on('request', request => { ... });
page.on('response', response => { ... });
```

记录：

```text
method
url
status
resourceType
requestPostData redacted
timestamp
```

通过 extension message 发送到 side panel。

UI 中允许用户把某个 request 标记为关键接口，并关联当前 step：

```text
[ ] POST /api/customer/create 200
```

如果实现遇到 Playwright CRX 环境限制，可以先实现 UI 和数据结构，network event 为空不阻塞 0.1。

---

## 15. Step 13：settings 增强

在 settings 中增加：

```ts
businessFlowEnabled?: boolean;
defaultApp?: string;
defaultRepo?: string;
defaultRole?: string;
redactSensitiveData?: boolean;
```

默认：

```ts
businessFlowEnabled: true
redactSensitiveData: true
defaultApp: ''
defaultRepo: ''
defaultRole: ''
```

保留原有：

```text
targetLanguage
testIdAttributeName
sidepanel
experimental
playInIncognito
```

---

## 16. QA checklist

### Build

```bash
npm run build
```

### Manual QA

1. 加载插件。
2. 打开 staging 页面。
3. attach 当前 tab。
4. 开始 record。
5. 执行 navigate/click/fill/select。
6. 添加 flow name/module/role/businessGoal。
7. 给至少 2 个 step 添加 intent/comment。
8. 给至少 2 个 step 添加 assertion。
9. Replay 原流程。
10. Export JSON。
11. Export YAML。
12. 刷新 side panel，确认草稿还在。
13. 检查导出文件没有 token/password/cookie。
14. 检查原 Playwright code export 仍可用。

---

## 17. 版本完成定义

MVP 0.1 完成时，必须能录制并导出至少一条真实内部 staging 流程，例如：

```text
登录后进入某个列表页
打开新增弹窗
填写一个字段
点击保存
断言 toast 或 URL 或接口状态
导出 business-flow.json
导出 compact-flow.yaml
```

并且要提交：

```text
sample business-flow.json
sample compact-flow.yaml
变更摘要
已知问题
下一版 handoff
```
