# Acceptance Gates

## Global gates for every PR

- No Native Messaging / Node Runner / AI expansion unless PR explicitly says so.
- No weakening tests to get green.
- No blind sleeps as primary fix.
- No mock-only replacement for real AntD / ProComponents coverage.
- No global text fallback in CrxPlayer or generated code.
- No full DOM / response body / cookie / token export.
- User-edited intent/comment/assertions/repeat data must not be overwritten by recorder merge.

## Build gates

Minimum:

```bash
git diff --check
npm run test:flow --prefix examples/recorder-crx
npm run build:examples:recorder
```

If `src/server/*`, parser, root package, or runtime replay changed:

```bash
npm run build:crx
npm run build:tests
```

If generated replay changed:

```bash
cd tests
xvfb-run -a npx playwright test crx/businessFlowRecorder.spec.ts crx/humanLikeRecorder.spec.ts \
  --config=playwright.config.ts --project=Chrome --workers=1 --reporter=line
```

## E2E gates

Generated replay E2E must verify terminal business state:

```text
row exists
row disappears
modal closed
selected value visible
toast visible
validation visible
popconfirm closed
```

A test that only asserts “script completed” is insufficient.

## Runtime gates

For parser-safe runtime playback:

- action count must match generated parser-safe actions.
- Resume/F8 log must show key business markers and final expect.
- Runtime fallback must be scoped and fail-closed.
