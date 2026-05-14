# BAGLC-03 Safety Guard Preflight

## Scope

新增安全决策，不做 self-healing。

## Files

Create:

- `replay/safetyGuard.ts`

Modify:

- `replay/types.ts`
- `replay/recipeBuilder.ts`
- `replay/exportedRenderer.ts`
- `replay/parserSafeRenderer.ts`
- `flow/stepStability.test.ts`

## Done when

- delete/remove/confirm/popconfirm 为 critical。
- critical 不允许 fallback。
- row action 无 rowKey fail-closed。
- 多 visible modal/popconfirm fail-closed。
- low-risk action 不被阻断。

## Validation

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build:examples:recorder
```
