# BAGLC-01 Anchor Grounding Diagnostics

## Scope

只增加 anchor 候选证据，不改变行为。

## Files

Create:

- `uiSemantics/anchorGrounding.ts`
- `uiSemantics/visualOverlap.ts`
- `uiSemantics/anchorDiagnostics.ts`

Modify:

- `pageContextSidecar.ts`
- `flow/pageContextTypes.ts`
- `flow/eventJournal.ts`
- `flow/stepStability.test.ts`

## Done when

- `pageContextEvent.before.grounding` 包含 candidates/winner/equivalentAnchors/reasons。
- 当前 FlowStep 和 replay code 快照不变。
- 单测覆盖 icon/button、checkbox wrapper、select trigger、ProTable row action、portal option。

## Validation

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build:examples:recorder
npm run build:crx
```
