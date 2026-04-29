# AI Intent Suggestion 集成方案

## 背景

当前 MVP 已能录制 Playwright actions、采集页面上下文，并生成 `BusinessFlow`。但实测发现：纯规则 intent suggestion 的正确率和效率不足，测试人员仍需要大量手工修改。下一步需要接入轻量 Flash 模型，用模型直接根据 action + 局部页面上下文生成中文业务意图。

## 目标

在浏览器插件内实现可配置 AI intent suggestion：

```text
recorded action + page context snapshot
  ↓
redacted compact AI input
  ↓
provider adapter：OpenAI-compatible / Anthropic-compatible
  ↓
model json output
  ↓
step.intent = model intent
step.intentSource = ai
step.intentSuggestion = model suggestion
  ↓
usage log 记录 token / cost / latency / error
```

## 非目标

本轮不实现：

- Native Messaging；
- 本地 Node Runner；
- Playwright spec 生成；
- AI 修复；
- CI；
- Git/PR；
- 服务端代理；
- 多人共享计费报表；
- 完整 DOM/trace/response body 采集。

## 用户体验

### 设置入口

在 recorder side panel 增加一个折叠区：

```text
AI Intent
  [x] Enable AI Intent Suggestion
  Mode: AI first / Rule first then AI fallback / Manual only
  Provider Profile: DeepSeek V4 Flash
  Batch size: 5
  Debounce: 1500 ms
  Max output tokens: 200
  Temperature: 0.1
  [Test Connection]
  [Generate intents for current flow]
  [Open usage]
```

默认建议：

```text
enabled: false
mode: ai-first
batchSize: 5
debounceMs: 1500
temperature: 0.1
maxTokens: 200
```

首次使用时用户必须自己输入 API key。不要把 key 写入源码或导出文件。

### 录制中行为

1. 用户点击/输入页面；
2. 插件立即生成或保留当前 step；
3. step 显示 `AI 生成中...`；
4. AI 返回后，如果 `intentSource !== 'user'`，则写入：

```ts
step.intent = aiSuggestion.intent;
step.intentSource = 'ai';
step.intentSuggestion = aiSuggestion;
```

5. 测试人员手动修改 intent 后：

```ts
intentSource = 'user'
```

AI 后续不能覆盖。

### 停止录制后行为

提供按钮：

```text
Generate AI Intents
```

作用：对当前 flow 中满足以下条件的 step 批量生成 intent：

```text
step.intentSource !== 'user'
step.context 存在
step.action 不是 unknown，或至少有 target/context
```

## 数据结构变更

### IntentSource

建议从：

```ts
type IntentSource = 'auto' | 'user';
```

升级为：

```ts
export type IntentSource = 'rule' | 'ai' | 'user';
```

兼容旧数据：

```text
旧的 auto → rule
有 intent 但无 intentSource → user
无 intent → undefined
```

### FlowStep

```ts
export interface FlowStep {
  id: string;
  order: number;
  action: FlowActionType;

  intent?: string;
  intentSource?: 'rule' | 'ai' | 'user';
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

### IntentSuggestion

```ts
export interface IntentSuggestion {
  text: string;
  confidence: number;
  source: 'rule' | 'ai';
  ruleHint?: string;
  provider?: string;
  model?: string;
  requestId?: string;
  latencyMs?: number;
  usageRecordId?: string;
  reason?: string;
}
```

### AI Provider Profile

```ts
export type AiProviderProtocol = 'openai-compatible' | 'anthropic-compatible';

export interface AiProviderProfile {
  id: string;
  name: string;
  enabled: boolean;
  protocol: AiProviderProtocol;

  baseUrl: string;
  model: string;

  apiKeyStorageKey: string;
  apiKeyPreview?: string;

  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;

  responseMode: 'json_object' | 'json_schema' | 'prompt_json_only';
  thinking?: 'disabled' | 'enabled' | 'omit';

  pricing: AiModelPricing;

  createdAt: string;
  updatedAt: string;
}
```

### Pricing

```ts
export interface AiModelPricing {
  currency: 'USD' | 'CNY' | string;
  unit: 'per_1m_tokens';

  inputPer1M?: number;
  outputPer1M?: number;

  cachedInputPer1M?: number;
  cacheMissInputPer1M?: number;
  cacheWritePer1M?: number;
  cacheReadPer1M?: number;

  reasoningOutputPer1M?: number;
  requestFee?: number;
}
```

### Usage Record

```ts
export interface AiUsageRecord {
  id: string;
  createdAt: string;

  flowId?: string;
  recordId?: string;
  stepIds: string[];

  providerProfileId: string;
  providerName: string;
  protocol: AiProviderProtocol;
  baseUrl: string;
  model: string;

  mode: 'single' | 'batch';
  success: boolean;
  error?: string;
  latencyMs: number;

  usage: NormalizedTokenUsage;
  pricingSnapshot: AiModelPricing;
  cost: AiCostBreakdown;

  requestSizeChars: number;
  responseSizeChars: number;
}
```

## AI 输入结构

不要把整个 `FlowStep` 发给模型。只发最小上下文：

```ts
export interface AiIntentInput {
  flow?: {
    name?: string;
    module?: string;
    page?: string;
    role?: string;
    businessGoal?: string;
  };
  steps: AiIntentStepInput[];
}

export interface AiIntentStepInput {
  stepId: string;
  order: number;
  action: string;
  target?: {
    role?: string;
    text?: string;
    testId?: string;
    ariaLabel?: string;
    placeholder?: string;
  };
  before?: {
    page?: { title?: string };
    breadcrumb?: string[];
    activeTab?: { title?: string };
    section?: { title?: string };
    table?: {
      title?: string;
      rowKey?: string;
      rowText?: string;
      columnName?: string;
    };
    form?: {
      label?: string;
      name?: string;
    };
    dialog?: {
      type?: string;
      title?: string;
    };
    dropdown?: {
      type?: string;
      fieldLabel?: string;
    };
  };
  after?: {
    activeTab?: { title?: string };
    dialog?: { type?: string; title?: string };
    toast?: string;
    url?: string;
  };
}
```

不要发送：

```text
value
rawAction
sourceCode
完整 selector
完整 DOM
完整 network
response body
cookie/token/password/authorization
手机号/邮箱/身份证/真实账号
```

如果确实需要表达输入行为，只发：

```text
action = fill
form.label = xxx
valuePreview = "***"，也可以不发
```

## AI 输出结构

批量输出：

```ts
export interface AiIntentBatchOutput {
  items: AiIntentItemOutput[];
}

export interface AiIntentItemOutput {
  stepId: string;
  intent: string;
  confidence: number;
  reason?: string;
  ruleHint?: string;
}
```

要求模型只输出 JSON。解析失败时不要影响录制，只记录 usage/error。

## 触发策略

### AI First 推荐策略

因为规则算法实测正确率低，本轮默认建议采用 AI First：

```text
step 新增/更新
  ↓
如果 step.intentSource !== user
  ↓
进入 AI queue
  ↓
批量请求模型
  ↓
返回后写入 step.intent
```

规则算法可以继续作为临时占位：

```text
AI 未返回前显示 rule intent 或 “AI 生成中”
AI 返回后覆盖 rule intent
用户手改后不再覆盖
```

### 批量队列

建议：

```text
batchSize: 5
maxBatchSize: 10
debounceMs: 1500
maxWaitMs: 5000
```

单步点击后不要阻塞 UI。

## 文件结构建议

```text
examples/recorder-crx/src/aiIntent/
  types.ts
  settings.ts
  storage.ts
  prompt.ts
  redactForModel.ts
  openaiCompatibleClient.ts
  anthropicCompatibleClient.ts
  providerClient.ts
  usage.ts
  pricing.ts
  queue.ts
  applyAiIntent.ts

examples/recorder-crx/src/components/
  AiIntentSettingsPanel.tsx
  AiUsagePanel.tsx
  AiIntentBadge.tsx
```

原则：

- 不要把所有逻辑塞进 `crxRecorder.tsx`；
- 但也不要引入复杂 DI/container/event bus；
- 每个文件职责单一，函数保持短小；
- 网络请求只在 background/service worker 或 extension trusted context 发起，不在 content script 发起。

## 状态合并规则

```ts
function applyAiIntentResult(step, result) {
  if (step.intentSource === 'user') return step;

  return {
    ...step,
    intent: normalizeIntentText(result.intent),
    intentSource: 'ai',
    intentSuggestion: {
      text: normalizeIntentText(result.intent),
      confidence: result.confidence,
      source: 'ai',
      provider: profile.name,
      model: profile.model,
      requestId,
      latencyMs,
      usageRecordId,
      reason: result.reason,
      ruleHint: result.ruleHint,
    },
  };
}
```

用户编辑时：

```ts
onIntentChange(stepId, text) {
  updateStep(stepId, {
    intent: text,
    intentSource: 'user',
  });
}
```

## UI 展示

每个 step intent 旁边显示来源：

```text
AI  0.95  deepseek-v4-flash  $0.00007
USER
RULE 0.82
```

Usage 面板显示：

```text
Today cost
Total cost
Calls
Avg latency
JSON success rate
By provider/model breakdown
Recent usage records
[Export usage JSONL]
[Clear usage]
```

## 失败处理

失败不阻断录制。

常见失败：

```text
未配置 API key
HTTP 401/403
HTTP 429
timeout
JSON parse error
返回 items 缺 stepId
```

处理：

```text
保留原 intent
显示 step 级别小提示
记录 usage log success=false
不要满屏 try/catch，不要复杂重试
```

最多做一次简单 retry，但 MVP 可以不做。
