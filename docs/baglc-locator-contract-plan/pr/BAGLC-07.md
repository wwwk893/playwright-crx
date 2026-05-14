# BAGLC-07 Model Shadow Mode

## Scope

仅记录 modelScore，不改变主链路。

## Files

Create:

- `uiSemantics/anchorRankerShadow.ts`
- `replay/locatorRankerShadow.ts`

Modify:

- `uiSemantics/anchorGrounding.ts`
- `replay/locatorRobustnessScorer.ts`
- diagnostics export

## Done when

- ruleScore/modelScore 同时输出。
- model disagreement 被记录。
- 不改变 generated code。
- 可导出训练样本。

## Validation

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build:examples:recorder
```
