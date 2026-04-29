# Token 与费用统计设计

## 目标

每次 AI intent 调用都要可审计：

```text
谁调用的 provider/model
调用了哪些 step
用了多少 tokens
多少钱
花了多久
是否成功
错误是什么
```

这对后续判断模型是否值得接入非常关键。

## NormalizedTokenUsage

```ts
export interface NormalizedTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;

  cachedInputTokens?: number;
  cacheMissInputTokens?: number;

  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;

  reasoningTokens?: number;
}
```

## AiCostBreakdown

```ts
export interface AiCostBreakdown {
  currency: string;
  total: number;
  inputCost: number;
  outputCost: number;
  cachedInputCost: number;
  cacheMissInputCost: number;
  cacheWriteCost: number;
  cacheReadCost: number;
  reasoningCost: number;
  requestCost: number;
}
```

## 价格配置

用户在 UI 中手动输入模型价格：

```text
Currency: USD
Unit: per 1M tokens
Input price / 1M
Output price / 1M
Cached input price / 1M，可选
Cache miss input price / 1M，可选
Cache write price / 1M，可选
Cache read price / 1M，可选
Reasoning output price / 1M，可选
Request fee，可选
```

### DeepSeek V4 Flash 示例

```json
{
  "currency": "USD",
  "unit": "per_1m_tokens",
  "cacheMissInputPer1M": 0.14,
  "cachedInputPer1M": 0.0028,
  "outputPer1M": 0.28
}
```

如果 provider 返回：

```json
{
  "prompt_cache_hit_tokens": 128,
  "prompt_cache_miss_tokens": 318,
  "completion_tokens": 65
}
```

计算：

```ts
cost =
  128 * cachedInputPer1M / 1_000_000 +
  318 * cacheMissInputPer1M / 1_000_000 +
   65 * outputPer1M / 1_000_000
```

### OpenAI-compatible 普通示例

如果只有：

```json
{
  "prompt_tokens": 480,
  "completion_tokens": 62,
  "total_tokens": 542
}
```

计算：

```ts
cost =
  prompt_tokens * inputPer1M / 1_000_000 +
  completion_tokens * outputPer1M / 1_000_000
```

如果同时有：

```json
"prompt_tokens_details": { "cached_tokens": 128 }
```

则：

```ts
cached = 128
regularInput = prompt_tokens - cached
cost =
  cached * cachedInputPer1M / 1_000_000 +
  regularInput * inputPer1M / 1_000_000 +
  completion_tokens * outputPer1M / 1_000_000
```

### Anthropic-compatible 示例

如果返回：

```json
{
  "usage": {
    "input_tokens": 300,
    "output_tokens": 50,
    "cache_creation_input_tokens": 100,
    "cache_read_input_tokens": 200
  }
}
```

计算：

```ts
cost =
  input_tokens * inputPer1M / 1_000_000 +
  output_tokens * outputPer1M / 1_000_000 +
  cache_creation_input_tokens * cacheWritePer1M / 1_000_000 +
  cache_read_input_tokens * cacheReadPer1M / 1_000_000
```

如果某些字段不存在，就按 0 处理。

## 费用计算函数

```ts
export function calculateAiCost(
  usage: NormalizedTokenUsage,
  pricing: AiModelPricing
): AiCostBreakdown {
  const per = 1_000_000;

  const cachedInputCost =
    ((usage.cachedInputTokens ?? 0) * (pricing.cachedInputPer1M ?? pricing.inputPer1M ?? 0)) / per;

  const cacheMissInputCost =
    ((usage.cacheMissInputTokens ?? 0) * (pricing.cacheMissInputPer1M ?? pricing.inputPer1M ?? 0)) / per;

  const inputWithoutCacheBreakdown =
    usage.cacheMissInputTokens === undefined && usage.cachedInputTokens === undefined
      ? usage.inputTokens
      : 0;

  const inputCost =
    (inputWithoutCacheBreakdown * (pricing.inputPer1M ?? 0)) / per;

  const outputCost =
    (usage.outputTokens * (pricing.outputPer1M ?? 0)) / per;

  const cacheWriteCost =
    ((usage.cacheCreationInputTokens ?? 0) * (pricing.cacheWritePer1M ?? 0)) / per;

  const cacheReadCost =
    ((usage.cacheReadInputTokens ?? 0) * (pricing.cacheReadPer1M ?? pricing.cachedInputPer1M ?? 0)) / per;

  const reasoningCost =
    ((usage.reasoningTokens ?? 0) * (pricing.reasoningOutputPer1M ?? 0)) / per;

  const requestCost = pricing.requestFee ?? 0;

  const total = inputCost + outputCost + cachedInputCost + cacheMissInputCost + cacheWriteCost + cacheReadCost + reasoningCost + requestCost;

  return {
    currency: pricing.currency,
    total,
    inputCost,
    outputCost,
    cachedInputCost,
    cacheMissInputCost,
    cacheWriteCost,
    cacheReadCost,
    reasoningCost,
    requestCost,
  };
}
```

## Usage Log 存储

使用 IndexedDB 或现有 `idb-keyval`。

建议 key：

```text
ai-intent-usage-records
```

只保留最近 N 条，例如：

```text
maxUsageRecords = 1000
```

每条 record 不保存原始 API key，不保存完整 prompt，不保存完整业务数据。

可以保存：

```text
stepIds
provider/model
usage
cost
latency
success/error
requestSizeChars/responseSizeChars
```

## Usage Summary

实现函数：

```ts
export function summarizeUsage(records: AiUsageRecord[]) {
  return {
    calls,
    successCalls,
    failedCalls,
    totalCost,
    totalInputTokens,
    totalOutputTokens,
    avgLatencyMs,
    byProviderModel,
    todayCost,
  };
}
```

## Usage 面板

显示：

```text
今日费用
总费用
调用次数
成功率
平均延迟
总 input tokens
总 output tokens
最近 20 次调用
```

操作：

```text
Export JSONL
Clear usage records
```

## 导出 JSONL

每行一条：

```json
{"createdAt":"2026-04-28T00:00:00.000Z","providerName":"DeepSeek","model":"deepseek-v4-flash","stepIds":["s001","s002"],"usage":{"inputTokens":900,"outputTokens":120},"cost":{"currency":"USD","total":0.00015},"latencyMs":1380,"success":true}
```

不要导出 API key。
