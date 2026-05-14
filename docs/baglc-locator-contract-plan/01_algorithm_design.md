# 01. BAGLC 算法设计

BAGLC = **Business Action Grounding + Locator Contract**。

它不是单个 selector 算法，而是一套将 `UiActionRecipe` 转换为安全定位契约的算法链。

## 输入与输出

### 输入

```ts
{
  step: FlowStep;
  recipe: UiActionRecipe;
  context?: StepContextSnapshot;
  pageContextEvent?: PageContextEvent;
}
```

### 输出

```ts
LocatorContract
```

包含：

- `BusinessActionGroundingEvidence`
- `LocatorCandidate[]`
- `primary LocatorCandidate`
- `SafetyDecision`
- `EffectHint[]`

---

# Phase 1：Business Action Anchor Grounding

## 1.1 Candidate generation

从局部而非全页面生成候选：

```text
event.target
composedPath()
elementFromPoint / elementsFromPoint
ancestors up to depth 10-12
known AntD interactive wrappers
current table row/action scope
active portal option target
current top overlay root
```

禁止第一阶段生产使用：

```text
全页面文本搜索
50px nearby clickable 搜索
全局 role/name 重排
```

这些只能作为 diagnostics。

## 1.2 Candidate features

每个候选提取：

- DOM：tag、role、class tokens、id/name/title、text length。
- Business hints：data-testid、data-e2e、data-e2e-action、data-row-key、data-column-key。
- Accessibility：accessible name、aria-label、labelledby、placeholder。
- AntD：ant-btn、ant-select-selector、ant-select-item-option、ant-picker、ant-switch、checkbox/radio wrapper。
- ProComponents：ProTable、EditableProTable、ProForm、ModalForm、DrawerForm、row-action/search/toolbar region。
- Context：form label/name、dialog title/testId、table testId/title、rowKey、columnKey。
- Geometry：bbox、clickInside、centerDistance、visible、topOverlay。
- Negative signals：svg/path/icon、plain span、hidden input、disabled、dynamic id。

## 1.3 VON-like equivalent anchors

将视觉上等价的节点合并为等价锚点组：

```ts
isEquivalent(a, b) =
  IoU(rect(a), rect(b)) >= 0.85
  && centerContained(a, b)
  && sameInteractiveFamily(a, b)
```

适用：

```text
button > span > svg/path
checkbox wrapper > inner input > label span
radio wrapper > inner input
tab wrapper > text node
```

目标不是唯一 DOM，而是业务等价 anchor group。

## 1.4 Deterministic grounding score

```text
anchorScore =
  businessHintScore
+ interactionSemanticScore
+ contextScore
+ geometryScore
+ accessibilityScore
- riskPenalty
- depthPenalty
```

第一阶段不启用 ML。输出：

```ts
BusinessActionGroundingEvidence {
  rawTarget,
  chosenAnchor,
  equivalentAnchors,
  candidates,
  confidence,
  reasons,
}
```

---

# Phase 2：Locator Candidate Generation

按 recipe component/operation 生成候选。

## 2.1 Input

```text
1. business-testid
2. getByLabel
3. getByPlaceholder
4. form-item-control
5. role textbox + scope
6. CSS diagnostic
```

## 2.2 Select / TreeSelect / Cascader

```text
1. form label scoped trigger
2. field testId scoped trigger
3. active popup option exact text/path
4. active tree/cascader popup scoped option
```

## 2.3 TableRowAction

```text
1. tableTestId + rowKey + actionTestId
2. tableTestId + rowKey + role/name
3. data-e2e-table + data-row-key + data-e2e-action
4. row text scoped action
5. global testId diagnostic
6. nth diagnostic
```

## 2.4 Modal / Drawer action

```text
1. dialog testId + role/name
2. dialog title + role/name
3. overlay root scoped text
4. global role/name diagnostic
```

## 2.5 Popconfirm confirm

唯一合法策略：

```text
visible-popconfirm-confirm
```

要求：

```text
visible popconfirm root count === 1
confirm button count === 1
button name in 确定/确 定/确认/OK/Yes
```

---

# Phase 3：Locator Robustness Scoring

## 3.1 Base score

```ts
row-scoped-testid        1.00
dialog-scoped-testid     0.98
business-testid          0.95
role-name-scoped         0.88
label-control            0.86
form-item-control        0.82
active-popup-option      0.78
visible-popconfirm       0.75
text-scoped              0.62
css-diagnostic           0.35
xpath-diagnostic         0.30
nth-diagnostic           0.12
```

## 3.2 Boosts

```text
+0.10 scope has rowKey
+0.08 scope has dialogTestId/title
+0.08 scope has formLabel
+0.06 scope uniqueness count == 1
+0.05 exact accessible name
+0.05 effect hint exists
```

## 3.3 Penalties

```text
-0.20 global text-only interactive action
-0.25 nth usage
-0.30 long CSS/XPath chain
-0.40 dynamic id / rc_select_*
-0.50 missing rowKey for row action
-0.60 multiple visible popconfirm/modal
-1.00 blacklisted primary locator
```

---

# Phase 4：Safety Guard

Safety Guard 对 locator contract 做执行前决策。

## 4.1 Risk classes

```text
LOW: tab, navigation, plain open drawer/modal
MEDIUM: input, select, toggle
HIGH: submit, save, upload, table row edit
CRITICAL: delete, remove, confirm, popconfirm confirm, bulk operation
```

## 4.2 Decision rules

```text
critical -> primary must be low-risk + unique + scoped, fallback=false
high -> primary must be unique; fallback=false unless explicitly read-only
medium -> fallback allowed only before execution and only if unique
low -> fallback allowed with preflight uniqueness
```

绝不允许：

```text
delete failed -> try next locator
confirm failed -> try next locator
row action failed -> try next locator
submit failed -> try next locator
```

---

# Phase 5：Effect Hints

Locator 成功不代表业务成功。每个 recipe 生成业务效果提示。

```text
selectOption -> selected-value-visible
modal opener -> modal-opened
modal confirm -> modal-closed
popconfirm confirm -> popconfirm-closed
table row create -> row-exists
table row delete -> row-disappears
fill -> field-value-visible
toast action -> toast-visible
```

EffectHint 先用于生成断言和 diagnostics；不要一开始搞复杂加权 verifier。

---

# Phase 6：Overlay Prediction Shadow Mode

点击 trigger 后预测可能出现：

```text
modal
drawer
popconfirm
select-dropdown
tree-select-dropdown
cascader-dropdown
picker-dropdown
```

用 MutationObserver 观察：

```text
childList
attributes
subtree
class/style/hidden/aria-hidden/aria-expanded/role
```

状态：

```text
pending -> resolved | expired | ambiguous
```

Prediction 不是事实；resolved 才能进入业务上下文。
