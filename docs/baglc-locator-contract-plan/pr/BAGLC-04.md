# BAGLC-04 Effect Hints + Terminal Assertions

## Scope

从 LocatorContract/Recipe 生成 EffectHint，并渲染到 terminal assertions。

## Files

Create:

- `replay/effectHints.ts`

Modify:

- `replay/terminalAssertions.ts`
- `replay/assertionRenderer.ts`
- `replay/recipeBuilder.ts`
- `replay/exportedRenderer.ts`
- `flow/stepStability.test.ts`

## Done when

- select-option -> selected-value-visible。
- row create/delete -> row exists/disappears。
- modal confirm -> modal closed。
- popconfirm confirm -> popconfirm closed。
- false-green fixture 被 assertion 捕获。

## Validation

```bash
npm run test:flow --prefix examples/recorder-crx
cd tests && xvfb-run -a npx playwright test crx/businessFlowRecorder.spec.ts --config=playwright.config.ts --project=Chrome --workers=1 --reporter=line
```
