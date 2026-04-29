# Model Provider 协议适配设计

## 目标

支持两类协议：

```ts
type AiProviderProtocol = 'openai-compatible' | 'anthropic-compatible';
```

这样可以接入：

```text
OpenAI official
OpenAI-compatible provider，例如 DeepSeek、部分网关、私有兼容服务
Anthropic official
Anthropic-compatible provider，例如 DeepSeek Anthropic endpoint、部分网关
```

## 统一接口

```ts
export interface IntentModelClient {
  suggestBatch(input: AiIntentInput, profile: AiProviderProfile, apiKey: string): Promise<AiIntentClientResult>;
}

export interface AiIntentClientResult {
  output: AiIntentBatchOutput;
  rawText: string;
  rawResponse?: unknown;
  usage: NormalizedTokenUsage;
  latencyMs: number;
  requestId?: string;
}
```

## OpenAI-compatible Chat Completions

### Endpoint

```text
POST {baseUrl}/chat/completions
```

如果 baseUrl 已经以 `/v1` 或 `/chat/completions` 结尾，Codex 可以做简单 normalize，但不要过度猜测。建议 UI 里让用户填完整 baseUrl，例如：

```text
https://api.deepseek.com
https://api.openai.com/v1
```

### Request

```ts
const body = {
  model: profile.model,
  messages: [
    { role: 'system', content: INTENT_SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(input) },
  ],
  temperature: profile.temperature ?? 0.1,
  max_tokens: profile.maxTokens ?? 400,
  stream: false,
  response_format: { type: 'json_object' },
  ...(profile.thinking === 'disabled' ? { thinking: { type: 'disabled' } } : {}),
};
```

说明：

- DeepSeek V4 Flash 可以使用 OpenAI-compatible Chat Completions；
- OpenAI 官方模型也可以走 Chat Completions；
- 如果某个 provider 不支持 `thinking` 字段，用户可把 `thinking` 设为 `omit`；
- 如果某个 provider 不支持 `response_format`，用户可把 `responseMode` 设为 `prompt_json_only`。

### Response parse

```ts
const content = response.choices?.[0]?.message?.content ?? '';
const output = parseJsonObject(content) as AiIntentBatchOutput;
```

### Usage normalize

兼容这些字段：

```ts
const usage = raw.usage ?? {};

return {
  inputTokens: usage.prompt_tokens ?? 0,
  outputTokens: usage.completion_tokens ?? 0,
  totalTokens: usage.total_tokens ?? 0,

  cachedInputTokens:
    usage.prompt_cache_hit_tokens ??
    usage.prompt_tokens_details?.cached_tokens ??
    0,

  cacheMissInputTokens:
    usage.prompt_cache_miss_tokens ??
    undefined,

  reasoningTokens:
    usage.completion_tokens_details?.reasoning_tokens ?? 0,
};
```

DeepSeek 返回 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`，OpenAI-compatible 服务通常返回 `prompt_tokens` / `completion_tokens` / `total_tokens`，有的还会返回 `prompt_tokens_details.cached_tokens`。

## Anthropic-compatible Messages

### Endpoint

```text
POST {baseUrl}/v1/messages
```

如果是 DeepSeek Anthropic-compatible endpoint，可以配置为：

```text
https://api.deepseek.com/anthropic
```

再拼接 `/v1/messages` 时注意不要重复。

### Headers

```ts
{
  'Content-Type': 'application/json',
  'x-api-key': apiKey,
  'anthropic-version': profile.anthropicVersion ?? '2023-06-01'
}
```

### Request

```ts
const body = {
  model: profile.model,
  max_tokens: profile.maxTokens ?? 400,
  temperature: profile.temperature ?? 0.1,
  system: INTENT_SYSTEM_PROMPT,
  messages: [
    {
      role: 'user',
      content: JSON.stringify(input),
    },
  ],
};
```

### Response parse

Anthropic Messages 的 `content` 是 block 数组：

```ts
const text = raw.content
  ?.filter((block) => block.type === 'text')
  .map((block) => block.text)
  .join('\n') ?? '';

const output = parseJsonObject(text) as AiIntentBatchOutput;
```

### Usage normalize

```ts
const usage = raw.usage ?? {};

return {
  inputTokens: usage.input_tokens ?? 0,
  outputTokens: usage.output_tokens ?? 0,
  totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
  cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
  cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
};
```

## JSON 解析策略

MVP 不需要复杂 parser。实现一个简单函数即可：

```ts
export function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);

  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Model did not return a JSON object.');
  return JSON.parse(match[0]);
}
```

## 输出校验

```ts
export function normalizeAiIntentOutput(value: unknown): AiIntentBatchOutput {
  // 检查 items 是否数组
  // 检查 stepId / intent 是否字符串
  // confidence 如果缺失默认 0.8
  // intent 为空则丢弃该 item
}
```

不要引入大型 schema validator。MVP 只做轻量校验。

## Prompt

System prompt 建议单独放：

```text
examples/recorder-crx/src/aiIntent/prompt.ts
```

Prompt 目标：

```text
输入局部页面上下文，输出每个 step 的中文业务意图。
```

必须包含：

```text
- 只输出 JSON
- 不输出 markdown
- 不泄露敏感值
- 不复述 selector/testId
- 每条 intent 简短自然
- 如果上下文不足，生成保守 intent 并降低 confidence
```

## Provider 测试

`Test Connection` 按钮发送一个固定样例：

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

期待：

```json
{
  "items": [
    {
      "stepId": "test-001",
      "intent": "打开共享 WAN 新建弹窗",
      "confidence": 0.9
    }
  ]
}
```
