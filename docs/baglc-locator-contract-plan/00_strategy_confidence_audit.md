# 00. Strategy Confidence Audit

## 先回答用户要求的自问

问题：**Are you 100% confident in this strategy?**

严格说，我不能诚实宣称“未来实现一定 100% 无漏洞”。但是我可以把策略做成：

- 每个核心假设都有论文依据或仓库事实依据。
- 每个风险点都有 fail-closed / shadow mode / diagnostic 兜底。
- 每个 PR 都有文件边界、测试命令、验收指标。
- 不需要一次性引入 ML/VLM/self-healing 这种高风险复杂度。

经过漏洞审计后，当前策略在工程层面达到“可执行且高置信”。下面列出主要漏洞和修复。

## 漏洞 1：过度相信 anchor top-1

### 风险
AntD/ProComponents 中 `span/svg/button/wrapper` 可能都代表同一个视觉动作。强求唯一 DOM 节点会导致过拟合。

### 修复
引入 VON-like equivalent anchors：使用 bounding box IoU、中心点包含、interactive family 判断等价锚点组。最终优化对象从 `DOM node correctness` 升级为 `Business Action Grounding correctness`。

## 漏洞 2：Multi-locator 被误用成“点击失败就试下一个”

### 风险
对删除、确认、提交、row action 这类副作用动作，顺序 fallback 可能点错对象。

### 修复
Multi-locator 只用于：

- 生成候选。
- preflight resolve。
- diagnostics。
- low-risk action fallback。

高风险动作执行前必须唯一；执行失败后不能尝试第二个 locator 点击。

## 漏洞 3：Safety Guard 过宽导致 false-green

### 风险
系统为了稳定回放，可能隐藏错误业务效果。

### 修复
把 terminal effect hints 作为 LocatorContract 的一部分：locator 成功不代表业务成功，必须验证 selected value、row exists/disappears、modal closed、toast visible 等业务效果。

## 漏洞 4：OverlayPrediction 被当成事实

### 风险
预测“会打开 Modal”但实际没打开，系统却继承了错误 dialog context。

### 修复
Prediction 只是 pending expectation；只有 MutationObserver 观察到匹配 overlay 并 resolved，才能进入 Event Journal 事实层。expired/ambiguous 只进入 diagnostics。

## 漏洞 5：ML 过早进入主链路

### 风险
候选空间通常只有 5-15 个，LightGBM/ONNX 可能增加维护复杂度，却只带来有限收益。

### 修复
P0/P1 全部使用 deterministic scorer；P2 才做 model shadow mode。模型先只记录 `modelScore` 和 `ruleScore` 的差异，不影响选择。

## 漏洞 6：现有 renderer/runtime 继续膨胀

### 风险
新逻辑又塞回 `exportedRenderer.ts`、`parserSafeRenderer.ts`、`crxPlayer.ts`。

### 修复
新建独立模块：

- `uiSemantics/anchorGrounding.ts`
- `uiSemantics/visualOverlap.ts`
- `replay/locatorCandidates.ts`
- `replay/locatorRobustnessScorer.ts`
- `replay/safetyGuard.ts`
- `replay/effectHints.ts`
- `capture/overlayPrediction.ts`

renderer 只消费 LocatorContract，不再自己推断业务语义。CrxPlayer 只消费显式 runtime bridge contract。

## 最终 confidence statement

当前策略不是“保证永不失败”，而是保证：

1. 错误 anchor/locator 更容易被诊断。
2. 脆弱 locator 更少进入最终代码。
3. 高风险动作不靠猜。
4. 业务效果不再只靠“点击成功”判断。
5. 每一步都可以通过 baseline-vs-new 指标量化收益。
