# Executive Summary

## 为什么当前 recorder 不稳定？

当前系统把这些层混在了一起：

```text
Playwright recorder action
page context event
semantic adapter result
synthetic step
FlowStep
repeat segment
exported Playwright code
parser-safe runtime playback code
CrxPlayer fallback
human-like test helper
```

这些层的时间顺序、语义粒度和可靠性都不同。真实业务录制里，尤其是 AntD / ProComponents 场景，单个用户动作会产生多个异步事实：click、input、change、portal dropdown、virtual option、late page context、recorder action、side panel merge。没有统一事务模型时，系统只能靠局部 patch 修复，导致 flake 和 false-green 反复出现。

## 新架构的一句话

```text
Raw event 是事实，transaction 是交互，step 是业务，recipe 是回放语义，renderer 只是输出。
```

## 迁移目标

迁移完成后，系统应该满足：

1. 输入框 typing/fill/press/change 只生成一个 committed fill step。
2. stop recording / review / export 之前一定 finalize，最后一步不丢。
3. Select/TreeSelect/Cascader 是 select transaction，不是散落的 click/fill/option。
4. BusinessFlow.steps 是稳定 projection，用户编辑态不被 recorder 覆盖。
5. Exported Playwright code 和 plugin Resume runtime playback 来自同一个 UiActionRecipe。
6. CrxPlayer 只做极窄 runtime bridge，不做业务推断。
7. 所有 generated replay E2E 都必须验证 terminal business state，避免 false-green。
8. Diagnostics/adaptive target snapshot 默认 fail-closed，不自动点击替代元素。

## 不做什么

这条迁移不是 MVP 0.2/0.3/0.4，也不是平台化：

```text
不做 Native Messaging
不做 Node Runner
不做 AI spec generation
不做 AI repair
不做完整 self-healing
不做第三方 UI 全量适配
```

## 推荐工作方式

每个 PR 只做一个结构层级的迁移。每个 PR 必须：

- 先补失败测试或锁定边界测试；
- 小范围改代码；
- 保持老 public API façade；
- 不削弱现有真实 E2E；
- 附 rollback plan。
