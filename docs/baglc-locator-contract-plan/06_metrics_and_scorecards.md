# 06. Metrics and Scorecards

## 1. Locator Risk Score

```text
riskScore =
  5 * criticalUnsafeLocatorCount
+ 3 * highRiskLocatorCount
+ 2 * unscopedInteractiveTextCount
+ 2 * nthCount
+ 2 * antInternalPrimaryCount
+ 1 * cssXpathChainCount
- 2 * rowScopedLocatorCount
- 1 * dialogScopedLocatorCount
- 1 * businessTestIdLocatorCount
```

目标：BAGLC-06 后 riskScore 相比 baseline 至少下降 60%。

## 2. Primary Locator Quality

| Metric | Meaning | Target |
|---|---|---:|
| primary_unique_rate | primary locator 在作用域内唯一 | >= 95% |
| scoped_locator_rate | 有 dialog/form/table/row scope | +30% vs baseline |
| business_contract_rate | 使用 data-testid/data-e2e/rowKey | +20% vs baseline |
| forbidden_primary_rate | primary 命中 blacklist | 0 |
| nth_primary_rate | primary 为 nth | 0 for semantic flows |

## 3. Safety Metrics

| Metric | Target |
|---|---:|
| dangerous_false_positive_click_rate | 0 |
| critical_fail_closed_when_ambiguous | 100% |
| unsafe_fallback_attempts | 0 |
| row_action_without_rowKey_execute | 0 |

## 4. Effect Metrics

| Metric | Target |
|---|---:|
| effect_hint_coverage | +25% vs baseline |
| terminal_assertion_pass_rate | >= L3 pass rate |
| false_green_caught_count | should increase initially |

## 5. Repeat Stability

| Test | Baseline | Target |
|---|---:|---:|
| flow unit | current pass | no regression |
| businessFlowRecorder repeat-each=5 | TBD | 0 fail |
| humanLikeRecorder repeat-each=5 | TBD | 0 fail |
| combined L3 repeat-each=10 | TBD | >= 99% pass |

## 6. Mutation Benchmark

| Mutation | Expected behavior |
|---|---|
| insert table row | rowKey scoped survives |
| reorder table rows | rowKey scoped survives |
| add button wrapper span/svg | VON equivalent group survives |
| dynamic rc_select id change | blacklist prevents primary |
| duplicate popconfirm | fail-closed |
| no rowKey delete | fail-closed |
| class hash change | role/testId/label survives |

## 7. Scorecard template

```json
{
  "baseline": {
    "riskScore": 0,
    "nthPrimaryRate": 0,
    "scopedLocatorRate": 0,
    "repeatPassRate": 0
  },
  "after": {
    "riskScore": 0,
    "nthPrimaryRate": 0,
    "scopedLocatorRate": 0,
    "repeatPassRate": 0
  },
  "delta": {
    "riskScoreDropPct": 0,
    "scopedLocatorGainPct": 0,
    "repeatPassGainPct": 0
  }
}
```
