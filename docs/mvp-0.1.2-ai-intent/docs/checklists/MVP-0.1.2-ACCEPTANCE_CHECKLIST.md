# MVP 0.1.2 验收清单

## 功能

- [ ] AI Intent 可启用/禁用。
- [ ] 可创建 OpenAI-compatible provider profile。
- [ ] 可创建 Anthropic-compatible provider profile。
- [ ] 可输入并保存 API key。
- [ ] API key 不出现在 flow export、usage export、console log 中。
- [ ] 可配置模型价格。
- [ ] Test Connection 可用。
- [ ] 可对当前 flow 批量生成 intent。
- [ ] 录制中新 step 可进入 AI queue。
- [ ] AI 返回后默认填入 `step.intent`。
- [ ] `intentSource` 正确设置为 `ai`。
- [ ] 用户手动修改后 `intentSource` 设置为 `user`。
- [ ] 用户手写 intent 不被 AI 覆盖。
- [ ] Step 上显示 AI badge / confidence / provider / model。
- [ ] 单步可重新生成 intent。

## 数据与导出

- [ ] `BusinessFlow` 支持 `intentSource='ai'`。
- [ ] `IntentSuggestion` 保存 provider/model/confidence/usageRecordId。
- [ ] `compact-flow.yaml` 输出 `intentSource` 和 `suggestionConfidence`。
- [ ] `business-flow.json` 不包含 API key。
- [ ] AI 请求不包含 rawAction/sourceCode/完整 DOM。

## Provider

- [ ] OpenAI-compatible Chat Completions 可用。
- [ ] DeepSeek V4 Flash 可用。
- [ ] Anthropic-compatible Messages 可用，至少结构正确。
- [ ] JSON 输出解析失败时不阻断录制。
- [ ] HTTP 401/403/429/timeout 有清晰提示。

## Token / Cost

- [ ] OpenAI-compatible usage 可 normalize。
- [ ] DeepSeek `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 可统计。
- [ ] Anthropic `input_tokens` / `output_tokens` 可统计。
- [ ] 费用计算使用当前 profile 的 pricing snapshot。
- [ ] Usage panel 显示总费用、今日费用、调用数、成功率、平均延迟。
- [ ] Usage records 可导出 JSONL。
- [ ] Usage records 可清空。

## 安全

- [ ] API key 不写源码。
- [ ] API key 不进入 content script。
- [ ] API 请求前执行脱敏。
- [ ] cookie/token/password/authorization/secret 被脱敏或删除。
- [ ] 手机号、邮箱、身份证、JWT/base64-like 字符串被脱敏。
- [ ] 默认不保存完整 prompt。

## 工程质量

- [ ] 不重写 Playwright recorder。
- [ ] 不重写 Playwright player。
- [ ] 不引入 Native Messaging。
- [ ] 不引入 Node Runner。
- [ ] 没有复杂过度抽象。
- [ ] 网络请求逻辑集中在 provider client。
- [ ] `crxRecorder.tsx` 没有继续大幅膨胀。
- [ ] build 通过。

## 手工测试样例

- [ ] 点击“新建” + after.dialog=“新建共享 WAN” → “打开共享 WAN 新建弹窗”。
- [ ] 点击行内“编辑” + rowKey=WAN1 + table=共享 WAN → “编辑 WAN1 共享 WAN”。
- [ ] fill + dialog=编辑 WAN1 共享 WAN + form.label=MTU → “填写 WAN1 共享 WAN 的 MTU”。
- [ ] option=WAN2 + form.label=WAN → “选择 WAN 为 WAN2”。
- [ ] 点击“确定” + dialog=新建共享 WAN → “确认保存新建共享 WAN”。
