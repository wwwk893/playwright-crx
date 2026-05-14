# 03. Validation Method：如何证明比当前效果更好

验证必须分成 baseline、离线算法指标、L1/L2/L3 测试、突变 benchmark 四层。

---

# 1. Baseline 采集

在实现 BAGLC-01 前，先记录当前主干/最新分支指标。

## 1.1 命令

```bash
npm run build:crx
npm run build:tests
npm run build:examples:recorder
npm run test:flow --prefix examples/recorder-crx

cd tests && xvfb-run -a npx playwright test \
  crx/businessFlowRecorder.spec.ts crx/humanLikeRecorder.spec.ts \
  --config=playwright.config.ts \
  --project=Chrome \
  --workers=1 \
  --repeat-each=5 \
  --reporter=line
```

## 1.2 采集指标

从 generated replay / diagnostics 里统计：

```text
N_total_actions
N_role_nth
N_global_text_click
N_unscoped_testid_duplicate
N_css_or_xpath_chain
N_ant_internal_class_primary
N_rc_select_reference
N_force_click
N_runtime_bridge
N_terminal_assertions
N_terminal_assertions_enabled
L3_repeat_pass_rate
L3_failure_count
```

形成 `baseline-locator-risk-report.json`。

---

# 2. 算法离线指标

每个 FlowStep/Recipe 生成 LocatorContract 后，统计：

```text
primary_unique_rate
scoped_locator_rate
business_contract_rate
forbidden_locator_rate
critical_fail_closed_count
candidate_count_avg
score_margin_avg
```

## Success targets

第一阶段目标不是神奇提到 100%，而是可量化改善：

```text
forbidden_locator_rate: 降到 0 in semantic flows
role_nth_for_row_action: 降到 0
rc_select_primary: 降到 0
critical_unsafe_execute: 降到 0
scoped_locator_rate: 提升 >= 30%
terminal_assertion_coverage: 提升 >= 25%
```

---

# 3. DOM Mutation Benchmark

构造小型 fixture 页面，模拟文献中常见 locator breakage：

```text
M1: button 内新增 span/svg/icon wrapper
M2: input 外层 Form.Item 多一层 div
M3: table 插入新行导致 nth 变化
M4: row 排序变化
M5: Select option portal 延迟渲染
M6: Modal 从 inline 变 portal
M7: data-testid 保持，文本变化
M8: 文本保持，class/hash 变化
M9: rc_select 动态 id 变化
M10: 多个 Popconfirm 可见
M11: 无 rowKey 的重复 row action
M12: checkbox 内部 input 被点击
```

每个 mutation 比较 baseline locator 和 BAGLC locator：

```text
locator resolves exactly one target
action effect matches expected
unsafe case fail-closed
```

## Mutation benchmark metrics

```text
Top1 grounding hit
Equivalent-group hit
Primary locator survival
Top3 candidate contains valid locator
Dangerous false-positive click rate
Fail-closed correctness
Effect assertion pass rate
```

---

# 4. L1 单元测试

文件建议：

```text
examples/recorder-crx/src/flow/stepStability.test.ts
examples/recorder-crx/src/replay/locatorCandidates.test.ts
examples/recorder-crx/src/replay/safetyGuard.test.ts
examples/recorder-crx/src/uiSemantics/anchorGrounding.test.ts
```

核心断言：

```text
row-scoped-testid > global text > nth
active-popup-option > global option text
rc_select_* blacklist
delete without rowKey -> fail-closed
multi visible popconfirm -> fail-closed
icon/span/button equivalent group generated
```

---

# 5. L2 Replay Code Tests

对 synthetic BusinessFlow / FlowStep / UiActionRecipe 生成代码，断言：

```text
不包含 #rc_select_
不包含 row action global nth
不包含 delete global getByText
包含 rowKey scoped locator
包含 dialog scoped confirm locator
包含 selected-value-visible / row-exists / row-disappears assertion
```

---

# 6. L3 CRX E2E

保留当前 businessFlowRecorder/humanLikeRecorder 路径，增加：

```bash
--repeat-each=10
```

重点场景：

```text
ProTable duplicate row edit
WAN row delete via Popconfirm
Select / TreeSelect / Cascader
ModalForm / DrawerForm submit
EditableProTable cell
repeat segment terminal assertion
```

## 通过标准

```text
现有测试全部通过
repeat-each=5 必须 0 fail
repeat-each=10 允许最多 1 known external flake，但不能是 locator contract 错误
危险动作 false-positive click = 0
```

---

# 7. 结果对比表模板

| Metric | Baseline | After BAGLC-02 | After BAGLC-03 | After BAGLC-04 | Target |
|---|---:|---:|---:|---:|---:|
| L3 repeat pass rate | TBD | TBD | TBD | TBD | >= 99% |
| role nth row action | TBD | TBD | TBD | TBD | 0 |
| rc_select primary refs | TBD | TBD | TBD | TBD | 0 |
| unscoped delete clicks | TBD | TBD | TBD | TBD | 0 |
| scoped locator rate | TBD | TBD | TBD | TBD | +30% |
| terminal assertion coverage | TBD | TBD | TBD | TBD | +25% |
| dangerous false-positive rate | TBD | TBD | TBD | TBD | 0 |
