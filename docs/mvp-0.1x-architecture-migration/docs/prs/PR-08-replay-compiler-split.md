# PR-08: Replay Compiler Split

## Goal

Split `codePreview.ts` into recipe-based renderers while keeping public exports stable.

## Files

Add:

```text
examples/recorder-crx/src/replay/exportedRenderer.ts
examples/recorder-crx/src/replay/parserSafeRenderer.ts
examples/recorder-crx/src/replay/assertionRenderer.ts
examples/recorder-crx/src/replay/repeatRenderer.ts
examples/recorder-crx/src/replay/actionCounter.ts
```

Modify:

```text
examples/recorder-crx/src/flow/codePreview.ts
examples/recorder-crx/src/flow/stepStability.test.ts
```

## Implementation

1. Keep these public functions in `codePreview.ts`:

```ts
generateBusinessFlowPlaywrightCode
generateBusinessFlowPlaybackCode
countBusinessFlowPlaybackActions
```

2. Internally call new renderer modules.
3. Recipe-based renderer first supports:
   - Input/fill
   - Select/TreeSelect/Cascader
   - TableRowAction
   - Popconfirm/Modal confirm
   - assertions
   - repeat segments
4. Old code path remains as fallback for steps without recipe.
5. Ensure action count equals parser-safe render actions.

## Tests

```text
- exported and parser-safe renderers use same recipe
- parser-safe Select does not double-click trigger
- exported Select uses exact option dispatch
- action count matches parser-safe generated action lines
- repeat renderer preserves terminal-state assertions
```

Run:

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build:crx
npm run build:examples:recorder
npm run build:tests
```

E2E:

```bash
cd tests
xvfb-run -a npx playwright test crx/businessFlowRecorder.spec.ts crx/humanLikeRecorder.spec.ts \
  --config=playwright.config.ts --project=Chrome \
  -g "proform-fields|ipv4-pool|WAN|human-like" --workers=1 --reporter=line
```

## Rollback

Keep old `codePreview` functions and switch feature flag to legacy renderer if necessary.
