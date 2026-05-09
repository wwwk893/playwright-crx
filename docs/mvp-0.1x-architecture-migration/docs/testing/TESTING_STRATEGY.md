# Testing Strategy

## L1: Flow/unit tests

Files:

```text
examples/recorder-crx/src/flow/stepStability.test.ts
```

Purpose:

- event journal
- transaction composer
- projection
- recipe builder
- replay renderers
- export sanitizer

No browser.

## L2: deterministic CRX E2E

Files:

```text
tests/crx/businessFlowRecorder.spec.ts
```

Purpose:

- real AntD / ProComponents fixture
- stable deterministic helpers allowed
- generated replay terminal-state assertions required

## L3: human-like smoke

Files:

```text
tests/crx/humanLikeRecorder.spec.ts
tests/crx/humanLike.ts
```

Purpose:

- real mouse/keyboard where important
- no silent fallback
- terminal business state required
- used for high-value smoke, not every edge

## Generated replay rule

Any generated replay E2E must verify a terminal business invariant. Examples:

```ts
await expect(table).toContainText('created-row');
await expect(dialog).toBeHidden();
await expect(row).toBeHidden();
await expect(field).toHaveValue('expected');
```

## Stress commands

```bash
cd tests
xvfb-run -a npx playwright test crx/businessFlowRecorder.spec.ts \
  --config=playwright.config.ts --project=Chrome \
  --workers=1 --repeat-each=5 --reporter=line

xvfb-run -a npx playwright test crx/humanLikeRecorder.spec.ts \
  --config=playwright.config.ts --project=Chrome \
  --workers=1 --reporter=line
```
