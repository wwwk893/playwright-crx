# 07. Paper Mapping

## ROBULA+

用于：LocatorRobustnessScorer。

吸收：

- 从泛化表达逐步 specialize。
- 属性优先级。
- blacklist。
- 少层级、少 position、多稳定属性。

不照搬：

- 不以 XPath 为主输出。
- 不让 XPath/CSS 成为 primary，除非 diagnostic。

## SIDEREAL

用于：未来 Attribute Reliability Learning。

吸收：

- 属性 fragility 可从历史版本/回放结果中学习。
- 不同业务应用的稳定属性不同。

阶段：P2。P0/P1 先用固定权重。

## Multi-Locator

用于：LocatorCandidates。

吸收：

- 同一目标生成多 locator 候选。
- 不同 locator 弱点互补。

修正：

- 多 locator 不用于危险动作 sequential fallback。
- 只用于 preflight、diagnostics、repair suggestion。

## Similo / LTR Ranking

用于：未来 locator/anchor ranker。

吸收：

- 多属性相似度评分。
- candidate ranking 比 binary classification 更合适。
- Top-k 结果有意义。

阶段：P2 shadow mode。

## VON Similo

用于：Anchor equivalent group。

吸收：

- visually overlapping nodes 可代表同一视觉元素。
- IoU threshold 0.85 可作为初始值。

## Contextual Clues

用于：scope generation。

吸收：

- “View rates near United Kingdom” 模式。
- 对 ProTable row action、Form label、dialog title 非常关键。

## WATER / Erratum / VISTA

用于：repair diagnostics。

吸收：

- repair 要比较旧/新 DOM 或旧/新执行。
- Erratum 的 tree matching 强调父子关系上下文。
- VISTA 说明视觉信息适合 repair/diagnostic。

不照搬：

- 不在 runtime 自动 repair 危险动作。

## Klarna Element Nomination

用于：未来 ML ranker 训练方法。

吸收：

- element nomination 不等于 classification。
- 目标是在页面/候选集中选唯一动作元素。

## SeeAct / SeeClick / OmniParser

用于：VLM diagnostic。

吸收：

- GUI grounding 是 agent 的核心瓶颈。
- 视觉 + DOM 比单一 HTML 或单一截图更可靠。

不照搬：

- 不进入实时录制主链路。
