# Proposed AGENTS.md Update

This file contains patch-ready sections to add to the repository-level `AGENTS.md`.

## Add after “数据模型不变量”

```md
## 架构不变量：录制事实、业务步骤、回放代码必须分层

本项目禁止把 recorder action、page context、业务步骤、generated code 混在同一层处理。

必须遵守：

1. Raw recorder action / page context event 是事实源，不是业务步骤。
2. BusinessFlow.steps 是 projection，可以重建，但 step.id 必须稳定。
3. 用户编辑态（intent/comment/assertions/repeat data）不得被 recorder merge 覆盖。
4. 所有低层输入事件必须先归并成 interaction transaction，再投影成 FlowStep。
5. Codegen 阶段不得再补业务语义；业务语义必须在 step projection / recipe builder 阶段完成。
6. Exported Playwright code 和 parser-safe runtime playback code 必须来自同一个 UiActionRecipe。
7. 如果 exported code 和 runtime playback 表达能力不同，必须在 recipe 中显式标注 runtimeFallback，不能在 CrxPlayer 里隐式猜。
```

## Add new section: 输入框录制规则

```md
## 输入框录制规则

输入框输入必须通过 InputTransaction 归并。

禁止把以下事件直接作为业务步骤导出：

- 单字符 keydown/press。
- 中间 input value。
- 单纯 focus click。
- Tab/blur 事件。

同一字段连续输入必须合并为一个 fill step，并以最终值为准。

InputTransaction 的结束条件：

- blur/change。
- 用户操作另一个字段。
- 用户触发非输入 action。
- stop recording / export 前 finalization。

导出和回放只能使用 committed input transaction，不得读取未 finalize 的临时输入事件。
```

## Add new section: 录制结束与导出前 finalization

```md
## 录制结束与导出前 finalization

停止录制、进入复查、导出 JSON/YAML、生成 Playwright code 前，必须执行 finalizeRecordingSession。

finalizeRecordingSession 至少要：

1. drain pending recorder actions。
2. drain pending page context events。
3. commit open input/select transactions。
4. reconcile synthetic steps with late recorded actions。
5. recompute BusinessFlow projection。
6. 记录 diagnostic summary。

禁止直接从未 finalize 的 flowDraft 导出或生成代码。
```

## Add new section: 回放代码生成规则

```md
## 回放代码生成规则

本项目存在两种 codegen：

1. exported Playwright spec：可以使用完整 Playwright 能力，例如 evaluateAll、条件判断、dispatch workaround。
2. parser-safe plugin playback：必须能被 recorder parser 解析，不能输出复杂控制流、evaluate 回调或 catch 链。

两者必须从同一个 UiActionRecipe 生成。

禁止在 exported code 和 parser-safe code 中分别重新推断 AntD/ProComponents 语义。

当 parser-safe code 无法表达某个稳定交互时，必须：

- 在 recipe 中声明 runtimeFallback。
- 在 CrxPlayer 中实现窄范围 fallback。
- 为 action count 和 runtime replay 增加测试。
```

## Replace / extend src/server protection section

```md
### src/server/* 修改边界

默认禁止修改 `src/server/*`。

允许的例外：

1. recorder app 向 side panel 暴露 recorded actions / sources。
2. parser-safe runtime playback 的窄范围 bridge，例如：
   - active AntD popup option dispatch；
   - duplicate test id ordinal replay；
   - parser-safe action counting 必需的 runtime bridge。

禁止在 `src/server/*` 中实现：

- 业务语义推断。
- 全局文本 fallback。
- selector self-healing。
- AI 调用。
- 复杂 AntD/ProComponents adapter。

任何 `src/server/*` 修改必须附带：

- focused unit/E2E test；
- action count 回归测试；
- 不影响 legacy player 的说明。
```

## Add new section: UI Component Adapter 规则

```md
## UI Component Adapter 规则

AntD / ProComponents / business hints 必须输出 UiSemanticContext 和 UiActionRecipe，不得直接污染最终 codegen。

优先级：

1. business hints: data-testid / data-e2e-* / data-row-key / data-column-key。
2. AntD / ProComponents semantic context。
3. role/label/placeholder。
4. Playwright selector。
5. CSS/XPath diagnostic fallback。

Adapter 可以识别 `.ant-*` DOM，但 `.ant-*` 不应成为最终业务 locator 的主路径，除非是 active popup runtime bridge。
```

## Add new section: 测试分层

```md
## 测试分层

L1 flow/unit:
- 测 transaction、projection、recipe、codegen。
- 不跑真实浏览器。

L2 deterministic CRX E2E:
- 可以使用稳定 helper 操作 AntD。
- 必须验证 generated replay terminal business state。

L3 human-like smoke:
- 使用真实 mouse/keyboard。
- fallback 必须 fail 或记录为测试失败证据。
- 禁止使用 mock 替代真实 AntD/ProComponents fixture。
- 禁止只验证脚本完成，必须验证业务终态。

每个 generated replay 测试必须至少有一个 terminal-state assertion。
```
