# MVP 0.1.2 任务设计：AI Intent Suggestion + Token/Cost 统计

## 任务目标

在当前 MVP 0.1 / 0.1.1 基础上，为业务流程录制插件增加 AI intent suggestion 能力。

完成后：

```text
测试人员录制页面操作
  ↓
插件采集 step context
  ↓
插件批量调用配置的模型
  ↓
自动填入中文业务 intent
  ↓
记录每次调用 token、费用、延迟、成功/失败
```

## 本轮必须完成

### P0

1. 新增 AI Intent 设置和 provider profile 管理；
2. 支持 OpenAI-compatible Chat Completions；
3. 支持 Anthropic-compatible Messages；
4. 支持用户输入 API key；
5. 支持用户输入模型价格；
6. 支持批量生成 intent；
7. 支持 token/费用/延迟 usage log；
8. 支持 usage 面板和导出 JSONL；
9. AI 返回后默认写入 `step.intent`；
10. 用户手动改过的 intent 不允许被 AI 覆盖；
11. AI 请求前做脱敏；
12. build 通过。

### P1

1. Test Connection；
2. 对当前 flow 手动触发 `Generate AI Intents`；
3. Step 上展示 AI badge、confidence、cost；
4. 单步重新生成 intent；
5. 错误提示但不阻断录制。

### P2

1. Prompt 调参 UI；
2. 多 provider profile 导入导出；
3. 更细的每日/每模型图表。

## 不允许做

- 不做 Native Messaging；
- 不做 Node Runner；
- 不做 spec 生成；
- 不做 AI 修复；
- 不做 CI；
- 不做 Git/PR；
- 不采集完整 DOM/trace/response body；
- 不把 API key 写入源码或 flow export。

## 推荐实现文件

新增：

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

修改：

```text
examples/recorder-crx/src/flow/types.ts
examples/recorder-crx/src/flow/compactExporter.ts
examples/recorder-crx/src/crxRecorder.tsx
examples/recorder-crx/src/settings.ts
examples/recorder-crx/src/background.ts，如当前架构需要 background 发请求
```

以真实仓库结构为准。

## 实施顺序

### Step 1：类型和存储

实现：

```text
aiIntent/types.ts
aiIntent/settings.ts
aiIntent/storage.ts
```

要求：

- Provider profile 可保存；
- API key 不保存在 profile 里，只保存 storage key；
- Usage records 可保存、读取、清空、导出；
- 默认内置一个 DeepSeek V4 Flash profile 模板，但不包含 API key。

### Step 2：价格和 usage normalize

实现：

```text
aiIntent/pricing.ts
aiIntent/usage.ts
```

要求：

- OpenAI-compatible usage normalize；
- Anthropic-compatible usage normalize；
- DeepSeek cache hit/miss usage normalize；
- 费用计算函数单元可测。

### Step 3：Prompt 和脱敏

实现：

```text
aiIntent/prompt.ts
aiIntent/redactForModel.ts
```

Prompt 必须要求：

```text
只输出 JSON
不要 markdown
不要泄露敏感值
不要复述 selector/testId
intent 简短自然
上下文不足则低置信度
```

脱敏必须删除或掩码：

```text
value
rawAction
sourceCode
cookie/token/password/authorization/secret
phone/email/id/JWT/base64-like
```

### Step 4：Provider clients

实现：

```text
openaiCompatibleClient.ts
anthropicCompatibleClient.ts
providerClient.ts
```

要求：

- 支持 timeout；
- 支持 JSON parse；
- 支持 usage normalize；
- 支持 responseMode：json_object / json_schema / prompt_json_only；
- 错误返回清晰，不要满屏 try/catch。

### Step 5：AI queue

实现：

```text
queue.ts
applyAiIntent.ts
```

要求：

- Debounce；
- batchSize；
- 不重复请求同一个 step；
- 用户 intentSource=user 时跳过；
- 返回后只更新仍未被用户修改的 step；
- 每次调用写 usage log。

### Step 6：UI

实现：

```text
AiIntentSettingsPanel.tsx
AiUsagePanel.tsx
AiIntentBadge.tsx
```

要求：

- 启用/禁用 AI Intent；
- 新增/编辑/删除 provider profile；
- 输入 API key；
- 输入模型价格；
- Test Connection；
- Generate AI Intents；
- Usage summary；
- Export usage JSONL；
- Clear usage。

### Step 7：集成到 recorder

修改 `crxRecorder.tsx` 或当前 side panel 主入口：

- 在 Business Flow 区域下方增加 AI Intent 设置；
- setActions / context merge 后，把待处理 steps 加入 AI queue；
- Step 列表显示 AI badge；
- compact-flow.yaml 输出 `intentSource: ai` 和 `suggestionConfidence`。

## 验收场景

### 场景 1：DeepSeek V4 Flash

配置：

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

点击 `Test Connection`，应返回：

```text
打开共享 WAN 新建弹窗
```

并产生一条 usage record。

### 场景 2：真实流程

录制：

```text
点击共享 WAN 新建
选择 WAN2
填写 MTU
点击确定
```

期望：

```text
打开共享 WAN 新建弹窗
选择 WAN 为 WAN2
填写共享 WAN 的 MTU
确认保存新建共享 WAN
```

### 场景 3：用户手改不覆盖

1. AI 生成 intent；
2. 用户手动改成自己的表达；
3. 再点击 Generate AI Intents；
4. 用户修改内容保持不变。

### 场景 4：usage 统计

每次调用后 usage 面板能看到：

```text
provider/model
input/output/cache tokens
cost
latency
success/error
```

## build

完成后至少运行：

```bash
npm run build
```

如果仓库有 recorder-crx 单独 build，也要运行。
