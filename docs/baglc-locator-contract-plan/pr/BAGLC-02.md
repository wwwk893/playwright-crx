# BAGLC-02 Locator Candidate Generator + Robustness Scorer

## Scope

为每个 UiActionRecipe 生成 LocatorContract diagnostics，renderer 暂不强制消费。

## Files

Create:

- `replay/locatorTypes.ts`
- `replay/locatorCandidates.ts`
- `replay/locatorRobustnessScorer.ts`
- `replay/locatorBlacklist.ts`

Modify:

- `replay/types.ts`
- `replay/recipeBuilder.ts`
- `replay/index.ts`
- `flow/stepStability.test.ts`

## Done when

- TableRowAction 有 row-scoped candidate。
- Select 有 active-popup-option candidate。
- Modal/Drawer 有 dialog-scoped candidate。
- Popconfirm 有 visible-popconfirm-confirm candidate。
- rc_select、nth-only、long CSS/XPath 被标为 high/critical risk。

## Validation

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build:examples:recorder
```
