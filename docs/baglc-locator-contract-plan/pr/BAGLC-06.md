# BAGLC-06 Renderer Consumption of LocatorContract

## Scope

renderer 开始消费 LocatorContract.primary。禁止新增 runtime broad fallback。

## Files

Modify:

- `replay/exportedRenderer.ts`
- `replay/parserSafeRenderer.ts`
- `replay/antDRecipeRenderers.ts`
- `replay/actionCounter.ts`
- `flow/stepStability.test.ts`

## Done when

- exported/parser-safe 使用同一 LocatorContract primary。
- Select 仍使用 explicit active-popup-option runtime bridge。
- TableRowAction 不再产生 global nth。
- Delete 不产生 global getByText。

## Validation

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build:examples:recorder
cd tests && xvfb-run -a npx playwright test crx/player-runtime-bridge.spec.ts --config=playwright.config.ts --project=Chrome --workers=1 --reporter=line
```
