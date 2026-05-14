# 05. Hermes / Codex BAGLC Prompts

## BAGLC-01 Prompt

请实现 BAGLC-01：Anchor Grounding Diagnostics。

边界：

- 不改变 FlowStep 投影。
- 不改变 generated code。
- 不改变 CrxPlayer。
- 只增加 page-context event 中的 grounding diagnostics。

新增：

```text
uiSemantics/anchorGrounding.ts
uiSemantics/visualOverlap.ts
uiSemantics/anchorDiagnostics.ts
```

实现：

1. 从 event target / composedPath / ancestors / elementFromPoint 生成候选。
2. 为候选提取 tag、role、testId、data-e2e、text、class tokens、depth、bbox、form/table/dialog context。
3. 实现 VON-like equivalent anchors，IoU >= 0.85 + center containment + same interactive family。
4. 输出 winner/candidates/reasons 到 pageContextEvent.before.grounding。
5. 当前 winner 仍保持现有 actionAnchorForElement 的行为。

验证：

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build:examples:recorder
```

必须新增单测：

- icon inside button。
- checkbox wrapper vs inner input。
- select trigger。
- ProTable row action。
- portal option。

---

## BAGLC-02 Prompt

请实现 BAGLC-02：Locator Candidate Generator + Robustness Scorer。

边界：

- 不改变 renderer 输出主行为。
- 不改变 CrxPlayer。
- LocatorContract 先只进入 diagnostics / recipe metadata。

新增：

```text
replay/locatorTypes.ts
replay/locatorCandidates.ts
replay/locatorRobustnessScorer.ts
replay/locatorBlacklist.ts
```

实现：

1. 为 Input/Select/TableRowAction/ModalButton/PopconfirmButton/Button 生成 LocatorCandidate[]。
2. 评分规则：row-scoped-testid > dialog-scoped-testid > business-testid > role-name-scoped > label-control > active-popup-option > text-scoped > css/xpath/nth diagnostic。
3. blacklist：rc_select_*、style、href/src as primary、onclick/onload、tabindex、ant-motion/zoom、hashed css、nth-only。
4. 输出 primary + alternatives + reasons。

验证：

- ProTable row action primary 必须是 row scoped。
- Select option primary 必须是 active popup option。
- Popconfirm confirm primary 必须是 visible popconfirm confirm。
- rc_select 不得作为 primary。

---

## BAGLC-03 Prompt

请实现 BAGLC-03：Safety Guard Preflight。

边界：

- 不做 self-healing。
- 不做 runtime fallback 扩张。
- 不改变低风险步骤行为。

新增：

```text
replay/safetyGuard.ts
```

实现：

1. classify risk：low/medium/high/critical。
2. delete/remove/confirm/popconfirm/bulk operation 为 critical。
3. table row action 无 rowKey 为 critical。
4. multiple visible popconfirm/modal 为 critical。
5. critical action 不允许 fallback。
6. 输出 SafetyDecision 到 LocatorContract。

验证：

- 相关 unsafe cases fail-closed。
- 低风险 navigation 不阻断。

---

## BAGLC-04 Prompt

请实现 BAGLC-04：Effect Hints + Terminal Assertion Integration。

边界：

- 基于现有 terminalAssertions.ts 扩展。
- 不引入复杂多信号 verifier。

实现：

1. 新增 replay/effectHints.ts。
2. recipe -> effect hints。
3. assertionRenderer/terminalAssertions 渲染 selected-value-visible、row-exists、row-disappears、modal-closed、popconfirm-closed。
4. repeat template 保持兼容。

验证：

- generated replay 包含终态断言。
- 故意删 row / 不关 modal 的 fixture 能失败。

---

## BAGLC-05 Prompt

请实现 BAGLC-05：OverlayPrediction Shadow Mode。

边界：

- Prediction 不影响 FlowStep。
- Prediction 不是事实。
- 只记录 resolved/expired/ambiguous diagnostics。

实现：

1. capture/overlayPrediction.ts。
2. click 时根据 ui/component 推断 expected overlay。
3. MutationObserver observe body childList/attributes/subtree。
4. 1000-1500ms 内 resolved/expired/ambiguous。
5. finalizer counts 加 pendingOverlayPredictionCount，但先只 diagnostic。

验证：

- select/modal/popconfirm cases。
