# 04. PR Roadmap

当前仓库已经完成 0.1x recorder/replay architecture migration 与 post-migration governance。BAGLC 作为新的 locator-contract 工作流，从 BAGLC-01 开始编号，避免和历史 GitHub PR 编号混淆。

---

# BAGLC-01：Anchor Grounding Diagnostics

## 目标
不改变现有行为，只把当前 anchor 选择过程变成可观测证据。

## 新增文件

```text
examples/recorder-crx/src/uiSemantics/anchorGrounding.ts
examples/recorder-crx/src/uiSemantics/visualOverlap.ts
examples/recorder-crx/src/uiSemantics/anchorDiagnostics.ts
```

## 修改文件

```text
examples/recorder-crx/src/pageContextSidecar.ts
examples/recorder-crx/src/flow/pageContextTypes.ts
examples/recorder-crx/src/flow/eventJournal.ts
examples/recorder-crx/src/flow/stepStability.test.ts
```

## 验证

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build:examples:recorder
```

验收：

- icon inside button 有 candidates 和 equivalent anchors。
- checkbox inner input 的 wrapper 分数更高。
- ProTable row action candidates 带 table/rowKey/action 证据。
- 不改变 FlowStep 数量、不改变 generated code。

---

# BAGLC-02：Locator Candidate Generator + Robustness Scorer

## 目标
每个 UiActionRecipe 生成 LocatorContract diagnostics，但 renderer 先不强制消费。

## 新增文件

```text
examples/recorder-crx/src/replay/locatorCandidates.ts
examples/recorder-crx/src/replay/locatorRobustnessScorer.ts
examples/recorder-crx/src/replay/locatorBlacklist.ts
examples/recorder-crx/src/replay/locatorTypes.ts
```

## 修改文件

```text
examples/recorder-crx/src/replay/types.ts
examples/recorder-crx/src/replay/recipeBuilder.ts
examples/recorder-crx/src/replay/index.ts
examples/recorder-crx/src/flow/stepStability.test.ts
```

## 验证

- row-scoped-testid 排第一。
- modal confirm dialog scoped 排第一。
- active-popup-option 排第一。
- nth/css 仅 diagnostic。
- rc_select_* blacklist。

---

# BAGLC-03：Safety Guard Preflight

## 目标
把危险动作从“可回放”升级为“必须满足 safety contract 才能回放”。

## 新增文件

```text
examples/recorder-crx/src/replay/safetyGuard.ts
```

## 修改文件

```text
examples/recorder-crx/src/replay/types.ts
examples/recorder-crx/src/replay/recipeBuilder.ts
examples/recorder-crx/src/replay/exportedRenderer.ts
examples/recorder-crx/src/replay/parserSafeRenderer.ts
examples/recorder-crx/src/flow/stepStability.test.ts
```

## 验证

- delete without rowKey -> fail-closed。
- multiple visible popconfirm -> fail-closed。
- multiple modal roots -> fail-closed。
- low-risk navigation 不被阻断。
- 不新增 CrxPlayer 全局 fallback。

---

# BAGLC-04：Effect Hints + Terminal Assertion Integration

## 目标
把 recipe 的业务效果映射成可渲染 terminal assertions。

## 新增文件

```text
examples/recorder-crx/src/replay/effectHints.ts
```

## 修改文件

```text
examples/recorder-crx/src/replay/terminalAssertions.ts
examples/recorder-crx/src/replay/assertionRenderer.ts
examples/recorder-crx/src/replay/recipeBuilder.ts
examples/recorder-crx/src/replay/exportedRenderer.ts
```

## 验证

- select -> selected-value-visible。
- row create -> row-exists。
- row delete -> row-disappears。
- modal confirm -> modal closed。
- popconfirm confirm -> popconfirm closed。

---

# BAGLC-05：OverlayPrediction Shadow Mode

## 目标
用 MutationObserver 观察 click 触发的 portal overlay，但不改变 FlowStep。

## 新增文件

```text
examples/recorder-crx/src/capture/overlayPrediction.ts
```

## 修改文件

```text
examples/recorder-crx/src/pageContextSidecar.ts
examples/recorder-crx/src/flow/eventJournal.ts
examples/recorder-crx/src/flow/sessionFinalizer.ts
examples/recorder-crx/src/flow/pageContextTypes.ts
```

## 验证

- select trigger -> resolved select-dropdown。
- modal opener -> resolved modal。
- delete trigger -> resolved popconfirm。
- no overlay -> expired。
- multiple overlays -> ambiguous。

---

# BAGLC-06：Renderer Consumption of LocatorContract

## 目标
renderer 开始优先使用 LocatorContract.primary，减少旧 renderer helper 推断。

## 修改文件

```text
examples/recorder-crx/src/replay/exportedRenderer.ts
examples/recorder-crx/src/replay/parserSafeRenderer.ts
examples/recorder-crx/src/replay/antDRecipeRenderers.ts
examples/recorder-crx/src/replay/actionCounter.ts
examples/recorder-crx/src/flow/stepStability.test.ts
```

## 验证

- generated code 不包含 rc_select_*。
- row action 不再生成 global nth。
- Select option 仍走 active-popup-option runtime bridge。
- parser-safe 与 exported 使用同一 primary contract。

---

# BAGLC-07：Model Shadow Mode

## 目标
只记录 modelScore，不影响主链路选择。

## 新增文件

```text
examples/recorder-crx/src/uiSemantics/anchorRankerShadow.ts
examples/recorder-crx/src/replay/locatorRankerShadow.ts
```

## 验证

- ruleScore 与 modelScore 同时写 diagnostics。
- 不改变 generated code。
- 可导出训练样本。
