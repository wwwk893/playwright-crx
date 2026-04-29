# business-flow.schema.md

# Business Flow Schema v1

本文件描述 `business-flow/v1` 的约定。MVP 阶段不要求实现完整 JSON Schema，但所有代码必须遵守这些结构。

---

## 1. 顶层结构

```ts
interface BusinessFlow {
  schema: 'business-flow/v1';
  flow: FlowMeta;
  env: FlowEnv;
  preconditions: string[];
  testData: FlowTestDataItem[];
  steps: FlowStep[];
  repeatSegments?: FlowRepeatSegment[];
  network: FlowNetworkEvent[];
  artifacts?: {
    playwrightCode?: string;
    storageState?: unknown;
    /**
     * Internal recorder bookkeeping. It may be stored in drafts/records to keep
     * step identity stable, but must be stripped from exported JSON/YAML.
     */
    recorder?: FlowRecorderState;
  };
  createdAt: string;
  updatedAt: string;
}
```

---

## 2. FlowMeta

```ts
interface FlowMeta {
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
```

命名建议：

```text
{app}.{module}.{page}.{action}.{expectation}
```

示例：

```text
admin.customer.create.success
portal.order.submit.need-approval
```

---

## 3. Step

```ts
interface FlowStep {
  id: string;
  order: number;
  kind?: 'recorded' | 'manual';
  sourceActionIds?: string[];
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

### step identity 约定

MVP 0.1.3 起，`id` 是稳定身份，不再等同于数组下标或展示序号。

```text
FlowStep.id 创建后不可因为删除、插入、继续录制而变化
FlowStep.order 只表示当前展示顺序，可以重算
Playwright recorder action index 不能作为业务 step 身份
recorded step 通过 sourceActionIds 指向 artifacts.recorder.actionLog
manual step 的 sourceActionIds 为空数组
```

因此允许出现：

```text
order 1 -> s001
order 2 -> s004
order 3 -> s003
```

这里 `order` 才是当前 UI 顺序，`sNNN` 是稳定 ID。

### action 枚举

```text
navigate
click
fill
select
check
uncheck
press
upload
assert
unknown
```

---

## 4. Target

```ts
interface FlowTarget {
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

优先级：

```text
testId
role + name
label
placeholder
text
selector
```

---

## 5. Assertion

```ts
interface FlowAssertion {
  id: string;
  type: FlowAssertionType;
  target?: FlowTarget;
  expected?: string;
  note?: string;
  enabled: boolean;
}
```

### assertion 枚举

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

---

## 6. Network event

```ts
interface FlowNetworkEvent {
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
```

MVP 阶段只记录摘要，不保存完整 response body。

---

## 7. Repeat segment

```ts
interface FlowRepeatSegment {
  id: string;
  name: string;
  stepIds: string[];
  parameters: FlowRepeatParameter[];
  rows: FlowRepeatRow[];
  assertionTemplate?: {
    subject: FlowAssertionSubject;
    type: FlowAssertionType;
    description: string;
    params: FlowAssertionParams;
  };
  createdAt: string;
  updatedAt: string;
}

interface FlowRepeatParameter {
  id: string;
  label: string;
  sourceStepId: string;
  currentValue: string;
  variableName: string;
  enabled: boolean;
}
```

`stepIds` 和 `sourceStepId` 都必须引用稳定 `FlowStep.id`，不能引用展示序号、action index 或字符串范围。
UI 显示循环片段范围时应按当前 `flow.steps[].order` 计算，例如：

```text
包含步骤：#2 s004 - #5 s003
```

---

## 8. Internal recorder state

```ts
interface FlowRecorderState {
  version: 2;
  actionLog: RecordedActionEntry[];
  nextActionSeq: number;
  nextStepSeq: number;
  sessions: RecordingSession[];
}

interface RecordedActionEntry {
  id: string;
  sessionId: string;
  sessionIndex: number;
  recorderIndex: number;
  signature: string;
  rawAction: unknown;
  sourceCode?: string;
  wallTime?: number;
  endWallTime?: number;
  createdAt: string;
}
```

`artifacts.recorder` 是内部状态，只用于草稿/记录恢复和继续录制稳定性。导出 `business-flow.json`、`compact-flow.yaml`、Playwright code preview 时都不能依赖或暴露 action log。

迁移期允许旧记录中存在以下 legacy 字段，但新逻辑不应再写入它们作为身份来源：

```text
deletedActionIndexes
deletedActionSignatures
stepActionIndexes
stepMergedActionIndexes
```

---

## 9. compact-flow.yaml

compact flow 面向 AI，不等同于完整 JSON。

必须删除：

```text
rawAction
完整 DOM
完整 trace
完整 response body
cookie/token/password
storageState
artifacts.recorder
deletedActionIndexes
deletedActionSignatures
stepActionIndexes
stepMergedActionIndexes
```

只保留：

```text
flow meta
business goal
preconditions
testData summary
steps
assertions
selected network summary
```

---

## 10. 安全规则

导出前必须脱敏：

```text
password
token
cookie
authorization
secret
session
手机号
邮箱
身份证号
JWT
长 base64
```

如果不能确定某值是否敏感，默认 masked。
