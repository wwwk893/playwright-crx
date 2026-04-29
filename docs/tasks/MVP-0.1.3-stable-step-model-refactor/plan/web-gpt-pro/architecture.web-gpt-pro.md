# Web GPT Pro Architecture Notes

Date: 2026-04-29
Type: Architecture design
Input summary: Step stability refactor for Playwright CRX business-flow recorder.

## 原文摘要

当前问题不是 `mergeActionsIntoFlow` 还不够聪明，而是把低层 recorder action index、UI step id、用户编辑态、删除态、插入态、repeat segment 引用，全塞进一次反复重建的 merge 里。

推荐方向：

```text
append-only action log + stable step entity + ordered projection
```

推荐采用 B 方案：

```text
不引入完整 normalized stepsById/stepOrder 大重构；
保留 steps: FlowStep[] 作为 UI projection；
新增 artifacts.recorder.actionLog；
FlowStep.id 改为稳定身份；
FlowStep.order 改为展示顺序；
新增 sourceActionIds 连接 step 与 action log；
逐步替换 mergeActionsIntoFlow 内部实现。
```

关键原则：

```text
不要再从完整 actions payload 反复重建旧步骤。
旧步骤是用户资产，新 actions 只能生成新步骤；旧步骤只能被用户编辑、删除、移动，不能被 recorder merge 覆盖。
```

## 采纳结论

本任务按上述 B 方案落地，优先以最小渐进改动替换 flow merge 内部语义，保留现有 UI projection 和公开函数名，降低联动改造风险。

