# BAGLC：Business Action Grounding + Locator Contract 算法包

本包面向 `wwwk893/playwright-crx` 当前架构阶段：Event Journal、Session Finalizer、Input/Select Transactions、BusinessFlowProjection、UiActionRecipe、Replay Renderer 拆分、Runtime Bridge 收窄、terminal assertions 与 post-migration governance 均已落地。下一阶段目标不是继续在 renderer/runtime 里补 selector，而是在现有架构上增加 **Locator Contract Layer**。

## 核心目标

给每个业务动作生成一份可解释、可验证、可安全回放的定位契约：

```text
PageContext / FlowStep
  -> UiActionRecipe
  -> BusinessActionGrounding evidence
  -> LocatorCandidates
  -> RobustnessScore
  -> SafetyDecision
  -> EffectHints
  -> Renderer / Runtime / Diagnostics
```

## 包内文件

- `00_strategy_confidence_audit.md`：策略自检、漏洞与修复闭环。
- `01_algorithm_design.md`：完整算法设计。
- `02_interfaces_and_data_model.md`：TypeScript 类型与数据模型。
- `03_validation_method.md`：如何验证算法比当前效果好。
- `04_pr_roadmap.md`：BAGLC 分片切分与边界。
- `05_pr_prompts.md`：给 Codex/Hermes 的逐 BAGLC 分片 prompt。
- `06_metrics_and_scorecards.md`：指标、baseline、评估表。
- `07_paper_mapping.md`：论文依据到模块映射。
- `diagrams/baglc_architecture.mmd`：Mermaid 架构图。
- `pr/`：每个 PR 的详细任务与验收标准。

## 最高优先级原则

1. 不改现有 Event Journal / Transaction / Recipe 主线，只在其后增加 Locator Contract Layer。
2. Multi-locator 只用于候选、preflight、diagnostics；有副作用动作不能按 locator 顺序尝试点击。
3. 删除、确认、Popconfirm、多弹层、无 rowKey 行操作必须 fail-closed。
4. Prediction 不是事实；只有 MutationObserver resolved 后才成为事实。
5. ML/VLM 只进入 shadow/diagnostic，不进入第一阶段主链路。
