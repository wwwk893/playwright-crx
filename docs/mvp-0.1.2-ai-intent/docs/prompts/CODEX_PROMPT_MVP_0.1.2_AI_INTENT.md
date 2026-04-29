# 给 Codex App 的 Prompt：MVP 0.1.2 AI Intent Suggestion + Token/Cost 统计

直接复制下面整段给 Codex App。

---

你现在位于一个 fork 后的 `playwright-crx` 仓库根目录。

当前仓库已经完成或部分完成：

- MVP 0.1：业务流程录制、FlowStep、断言、导出、记录库；
- MVP 0.1.1：页面上下文采集、非 AI intent suggestion，或至少已有相关文档/部分实现。

本轮任务是实现：

```text
MVP 0.1.2：AI Intent Suggestion + Token/Cost 统计
```

请先阅读以下文档：

1. `AGENTS.md`
2. `ROADMAP.md`
3. `docs/mvp-0.1.2-ai-intent/README.md`
4. `docs/mvp-0.1.2-ai-intent/docs/design/AI_INTENT_INTEGRATION.md`
5. `docs/mvp-0.1.2-ai-intent/docs/design/MODEL_PROVIDER_PROTOCOLS.md`
6. `docs/mvp-0.1.2-ai-intent/docs/design/TOKEN_COST_ACCOUNTING.md`
7. `docs/mvp-0.1.2-ai-intent/docs/design/SECURITY_PRIVACY.md`
8. `docs/mvp-0.1.2-ai-intent/docs/tasks/MVP-0.1.2-AI-INTENT.md`
9. `docs/mvp-0.1.2-ai-intent/docs/checklists/MVP-0.1.2-ACCEPTANCE_CHECKLIST.md`

如果这些文档路径不存在，请先提示我复制文档包，不要继续实现。

## 重要边界

本轮只允许浏览器插件内能力。

不要实现：

- Native Messaging；
- 本地 Node Runner；
- Playwright spec 生成；
- AI 修复；
- CI；
- Git/PR 自动化；
- 服务端代理；
- 完整 DOM/trace/response body 采集；
- 把 API key 写进源码或 flow export。

不要重写：

- Playwright recorder；
- Playwright player；
- locator 生成逻辑。

代码要求：

- 简洁可读；
- 不要过度抽象；
- 不要满屏 try/catch；
- 不要引入大型 schema validator；
- 不要让 `crxRecorder.tsx` 继续无限膨胀；
- 尽量新增 `aiIntent/` 目录承载逻辑。

## 本轮要完成的能力

1. 新增 AI Intent 设置面板；
2. 支持 provider profile 管理；
3. 支持 OpenAI-compatible Chat Completions；
4. 支持 Anthropic-compatible Messages；
5. 用户可输入 API key；
6. 用户可输入模型价格；
7. 支持 DeepSeek V4 Flash profile 模板；
8. 支持批量生成 intent；
9. AI 返回后默认填入 `step.intent`；
10. `intentSource` 支持 `'rule' | 'ai' | 'user'`；
11. 用户手动改过的 intent 不被 AI 覆盖；
12. 每次调用记录 token、cost、latency、provider、model、stepIds；
13. Usage 面板显示汇总；
14. Usage records 可导出 JSONL；
15. API 请求前执行脱敏；
16. build 通过。

## 推荐新增文件

请优先实现或等价实现：

```text
examples/recorder-crx/src/aiIntent/types.ts
examples/recorder-crx/src/aiIntent/settings.ts
examples/recorder-crx/src/aiIntent/storage.ts
examples/recorder-crx/src/aiIntent/prompt.ts
examples/recorder-crx/src/aiIntent/redactForModel.ts
examples/recorder-crx/src/aiIntent/openaiCompatibleClient.ts
examples/recorder-crx/src/aiIntent/anthropicCompatibleClient.ts
examples/recorder-crx/src/aiIntent/providerClient.ts
examples/recorder-crx/src/aiIntent/usage.ts
examples/recorder-crx/src/aiIntent/pricing.ts
examples/recorder-crx/src/aiIntent/queue.ts
examples/recorder-crx/src/aiIntent/applyAiIntent.ts
examples/recorder-crx/src/components/AiIntentSettingsPanel.tsx
examples/recorder-crx/src/components/AiUsagePanel.tsx
examples/recorder-crx/src/components/AiIntentBadge.tsx
```

如果当前仓库结构不同，请以真实结构为准，并在最终总结说明。

## 核心类型

请实现这些类型或等价结构：

```ts
type AiProviderProtocol = 'openai-compatible' | 'anthropic-compatible';
type IntentSource = 'rule' | 'ai' | 'user';
```

`FlowStep` 应支持：

```ts
intent?: string;
intentSource?: 'rule' | 'ai' | 'user';
intentSuggestion?: {
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
};
```

Provider profile 应支持：

```ts
protocol
baseUrl
model
apiKeyStorageKey
temperature
maxTokens
timeoutMs
responseMode
thinking
pricing
```

Pricing 应支持：

```ts
inputPer1M
outputPer1M
cachedInputPer1M
cacheMissInputPer1M
cacheWritePer1M
cacheReadPer1M
reasoningOutputPer1M
requestFee
```

Usage record 应支持：

```ts
provider/model/protocol
stepIds
success/error
latencyMs
normalized usage
pricingSnapshot
cost breakdown
```

## OpenAI-compatible client

实现：

```text
POST {baseUrl}/chat/completions
```

请求体：

```ts
{
  model,
  messages: [
    { role: 'system', content: INTENT_SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(input) },
  ],
  response_format: { type: 'json_object' },
  temperature,
  max_tokens,
  stream: false,
  ...(thinking === 'disabled' ? { thinking: { type: 'disabled' } } : {})
}
```

如果 `responseMode` 是 `prompt_json_only`，不要发送 `response_format`。

解析：

```ts
choices[0].message.content
```

usage normalize 兼容：

```ts
prompt_tokens
completion_tokens
total_tokens
prompt_cache_hit_tokens
prompt_cache_miss_tokens
prompt_tokens_details.cached_tokens
completion_tokens_details.reasoning_tokens
```

## Anthropic-compatible client

实现：

```text
POST {baseUrl}/v1/messages
```

请求体：

```ts
{
  model,
  system: INTENT_SYSTEM_PROMPT,
  messages: [{ role: 'user', content: JSON.stringify(input) }],
  temperature,
  max_tokens
}
```

headers：

```ts
x-api-key
anthropic-version: 2023-06-01
```

解析：

```ts
content blocks 中 type=text 的文本拼接
```

usage normalize 兼容：

```ts
input_tokens
output_tokens
cache_creation_input_tokens
cache_read_input_tokens
```

## AI 输入

不要发送完整 step。只发送 compact input：

```text
flow name/module/page/role/businessGoal
stepId/order/action
target role/text/testId/ariaLabel/placeholder
before page/breadcrumb/activeTab/section/table/form/dialog/dropdown
after activeTab/dialog/toast/url
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
cookie/token/password/authorization/API key
真实手机号/邮箱/身份证/账号
```

## Prompt

System prompt 必须要求：

- 只输出 JSON；
- 不输出 markdown；
- 输出格式 `{ "items": [...] }`；
- 不泄露敏感值；
- 不复述 selector/testId；
- intent 简短、自然、中文；
- 上下文不足时降低 confidence；
- 支持新建/编辑/删除/确定/保存/fill/select/tab/search/reset 等常见场景。

## AI queue

实现批量队列：

```text
batchSize 默认 5
maxBatchSize 10
debounceMs 默认 1500
timeoutMs 默认 15000
```

规则：

- `intentSource === 'user'` 的 step 不进入队列；
- 没有 context 且 target 也不足的 step 可以跳过；
- 同一个 step 不要重复入队；
- AI 返回前 UI 不阻塞；
- AI 返回后，如果用户已经手动改过，不覆盖。

## UI

新增：

```text
AiIntentSettingsPanel
AiUsagePanel
AiIntentBadge
```

Settings 面板至少支持：

- enable/disable；
- mode：ai-first / rule-fallback / manual；
- profile select；
- create/edit/delete profile；
- API key input；
- price input；
- Test Connection；
- Generate AI Intents；
- Open Usage。

Usage 面板至少支持：

- today cost；
- total cost；
- calls；
- success rate；
- avg latency；
- token totals；
- recent usage records；
- export JSONL；
- clear records。

## 安全

- API key 不写源码；
- API key 不进入 content script；
- API key 不进入 flow export；
- API key 不进入 usage log；
- AI 请求前执行脱敏；
- 默认不保存完整 prompt。

## 验收

请完成后对照：

```text
docs/mvp-0.1.2-ai-intent/docs/checklists/MVP-0.1.2-ACCEPTANCE_CHECKLIST.md
```

至少手工验证 DeepSeek V4 Flash：

```text
protocol: openai-compatible
baseUrl: https://api.deepseek.com
model: deepseek-v4-flash
responseMode: json_object
thinking: disabled
pricing:
  cachedInputPer1M: 0.0028
  cacheMissInputPer1M: 0.14
  outputPer1M: 0.28
```

测试样例：

```json
{
  "steps": [
    {
      "stepId": "test-001",
      "order": 1,
      "action": "click",
      "target": { "role": "button", "text": "新建" },
      "before": { "section": { "title": "共享 WAN" } },
      "after": { "dialog": { "type": "modal", "title": "新建共享 WAN" } }
    }
  ]
}
```

期望 intent：

```text
打开共享 WAN 新建弹窗
```

## 构建

完成后运行：

```bash
npm run build
```

如果有 recorder-crx 单独 build，也运行。

## 最终回复格式

完成后请输出：

1. Summary；
2. Changed files；
3. How to test；
4. Acceptance checklist；
5. Known limitations；
6. Security notes；
7. Next handoff。

不要自动 git commit，除非我明确要求。
