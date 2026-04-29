# MVP 0.1 完成度审阅

## 结论

当前 MVP 0.1 已经完成了“业务流程录制资产”的核心闭环，不再只是 Playwright codegen 的包装。它已经具备：

- Playwright recorder actions 暴露给 side panel；
- `ActionInContext` 合并为 `business-flow/v1` 的 `FlowStep`；
- 业务流程元数据编辑；
- 步骤 intent/comment 编辑；
- 半结构化 assertion；
- `business-flow.json` 与 `compact-flow.yaml` 导出；
- IndexedDB 草稿和记录库 CRUD；
- 停止后继续录制、插入录制、插入空步骤；
- assertion 合并进 Playwright code preview；
- `npm run build` 通过。

总体评价：

```text
核心录制资产能力：80% ~ 85%
工程闭环能力：75%
业务语义理解能力：40%
```

下一步不要扩到本地执行、AI 生成、CI 或 Git 流程。最有价值的下一步是：

```text
插件内页面上下文采集 + 非 AI intent suggestion。
```

---

## 已经符合 MVP 0.1 的内容

### 1. Recorder 最小 patch 方向正确

当前通过最小改动把 Playwright recorder actions 暴露给 side panel，而不是重写 recorder/player/locator，这是正确方向。

需要继续保持：

- 不重写 Playwright recorder；
- 不重写 Playwright player；
- 不把生成的 Playwright code 反解析成主数据源；
- 以 recorded actions 为主数据源，以 source code 为辅助证据。

### 2. Flow 数据资产雏形已经成型

当前 `BusinessFlow` 已经覆盖：

- flow 元数据；
- env；
- preconditions；
- testData；
- steps；
- assertions；
- network；
- artifacts；
- createdAt / updatedAt。

这足够支撑 MVP 0.1 的录制、保存、导出和人工 review。

### 3. 步骤编辑能力超出原始 MVP

已支持：

- 步骤删除；
- 重新编号；
- 停止后继续录制；
- 步骤间插入录制；
- 插入空步骤；
- 记录库 CRUD。

这些能力对测试人员实际使用很重要，应保留。

### 4. assertion 类型第一版够用

已支持：

- `visible`
- `textContains`
- `textEquals`
- `valueEquals`
- `urlMatches`
- `toastContains`
- `tableRowExists`
- `apiStatus`
- `apiRequestContains`
- `custom`

这一版不要继续扩 assertion 类型，下一步先提升 step context 和 intent。

---

## P0 问题

### P0-1：`intent` 经常为空，业务语义不足

当前导出的 flow 对“生成测试脚本”勉强够，但对“理解业务流程”不够。

例子：

```yaml
- id: s001
  action: click
  target: ha-wan-add-button
```

它只能说明“点击了一个按钮”，不能说明：

```text
打开共享 WAN 新建弹窗
```

影响：

- AI 后续生成测试时缺少业务目的；
- 失败排查时看不出用户业务动作；
- 客服/运维知识库无法直接复用；
- 测试人员需要逐步手填 intent，使用负担高。

处理建议：

```text
实现插件内页面上下文采集，并用非 AI 规则生成 intent suggestion，默认写入 step.intent。
```

---

### P0-2：`extractTestId()` 解析存在 bug

当前导出样例出现类似：

```json
"testId": "[data-testid=\"ha-wan-add-button\"s"
```

期望是：

```json
"testId": "ha-wan-add-button"
```

疑似 selector 来源：

```text
internal:testid=[data-testid="ha-wan-add-button"s]
```

风险：

- compact target 摘要错误；
- intent rule 无法基于 testId 识别业务区域；
- 后续 AI/Runner 读取 flow 会误判 locator；
- 人工 review 体验差。

修复要求：

支持以下 selector：

```text
internal:testid=[data-testid="xxx"s]
internal:testid=[data-testid="xxx"i]
[data-testid="xxx"]
[data-e2e="xxx"]
```

实现要简单，不要写复杂 selector parser。

---

### P0-3：自动 intent 和人工 intent 没有区分

下一步自动填入 `step.intent` 后，必须区分来源，否则会覆盖测试人员手写内容。

新增字段：

```ts
intentSource?: 'auto' | 'user';
intentSuggestion?: IntentSuggestion;
context?: StepContextSnapshot;
```

合并规则：

```text
如果 intent 为空：写入 suggestion.text，intentSource = auto。
如果 intentSource = auto：允许新 suggestion 更新 intent。
如果 intentSource = user：永远不要自动覆盖 intent，只更新 intentSuggestion。
如果旧数据已有 intent 但没有 intentSource：默认视为 user。
```

---

### P0-4：保存记录时不应丢失 recorder 映射状态

当前 `withPlaywrightCode()` 会删除：

```ts
deletedStepIds
deletedActionIndexes
stepActionIndexes
```

这对“导出干净 JSON”可以理解，但对保存记录后继续录制/插入录制有风险。

风险场景：

```text
录制 5 步
删除第 2 步
保存记录
重新打开记录
继续录制
```

如果映射状态丢失，删除过的 action 可能被重新合并回来，或者插入位置错乱。

建议：

- 保存记录到 IndexedDB 时保留内部 recorder 映射状态；
- 导出给用户的 JSON/YAML 时再 strip 内部状态；
- 可以先保留在 `artifacts`，不强制立刻迁移；
- 更好的后续结构是 `recorderState`。

---

### P0-5：step comment 应始终可编辑

当前 `StepEditor` 里 comment 可能依赖：

```tsx
{step.comment !== undefined && ...}
```

如果 recorded step 默认没有 `comment` 字段，则测试人员看不到备注输入框。

修复：

```text
备注输入框始终展示，value 使用 step.comment ?? ''。
```

---

## P1 问题

### P1-1：`crxRecorder.tsx` 已偏大

当前 `crxRecorder.tsx` 已经很大。下一步如果继续把 page context、intent rules、matching 逻辑塞进去，会难维护。

建议新增轻量文件：

```text
examples/recorder-crx/src/flow/pageContextTypes.ts
examples/recorder-crx/src/flow/pageContextMatcher.ts
examples/recorder-crx/src/flow/intentRules.ts
examples/recorder-crx/src/flow/flowContextMerger.ts
examples/recorder-crx/src/pageContextSidecar.ts
```

不要引入复杂状态管理，不要上大型设计模式。

---

### P1-2：业务硬编码应替换为通用上下文

当前若有类似：

```ts
/ha-wan-config-table|共享\s*WAN|WAN1|WAN2/i
```

这类规则对 demo 有用，但不适合平台能力。

下一步应基于通用上下文：

```text
table.title
row.key
field.label
dialog.title
section.title
target.text
```

而不是写死 WAN、WAN1、WAN2。

---

### P1-3：compact-flow.yaml 缺少 context 摘要

当前 compact YAML 主要包含 action、target、value、assert。建议为每步增加短 context：

```yaml
context:
  page: 全局配置
  tab: WAN
  section: 共享 WAN
  table: 共享 WAN
  row: WAN1
  dialog: 编辑 WAN1 共享 WAN
  field: MTU
```

不要包含 rawAction、完整 DOM、完整 response body、cookie/token/password/authorization。

---

## P2 问题

### P2-1：部分 assertion 目前主要是 preview 级别

例如 URL/API assertion 在 code preview 中未必都是最终可执行代码。MVP 0.1 可以接受，因为本轮重点不是最终 spec 质量。

### P2-2：CSS 体积增大

可以后续拆：

```text
business-flow.css
flow-library.css
step-editor.css
```

本轮不用处理。

### P2-3：模板 chips 可后续配置化

如果当前有固定业务模板，例如“站点配置”“WAN 配置”，后续可以改成配置或历史输入。不是本轮重点。

---

## 会影响后续 AI/Runner 的问题

虽然本轮不实现 AI/Runner，但这些点会影响后续读取 flow：

1. `intent` 为空：AI 不知道业务目的。
2. target `testId` 错误：AI 和 Runner 都会生成不稳定 locator。
3. 无 context：AI 只能看到“点击/填写”，看不到页面、弹窗、表格、行、字段语义。
4. 自动/人工 intent 不区分：后续流程资产的可信度无法判断。
5. 保存记录丢失 recorder 映射：继续录制和插入录制会变脆。

---

## 下一步建议

下一步命名为：

```text
MVP 0.1.1：Page Context Sidecar + Intent Suggestion
```

实施顺序：

1. 先修 P0 小问题；
2. 增加 step context / intent source 数据结构；
3. 实现插件内 page context sidecar；
4. 匹配 actions 和 context events；
5. 用规则生成 intent suggestion；
6. 默认写入 `step.intent`；
7. compact YAML 输出 context；
8. build 和手工录制验证。

