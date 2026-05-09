# PR-09: Runtime Player Bridge Contract

## Goal

Make `CrxPlayer` fallback explicit, narrow, and recipe-driven. Do not let runtime player guess business semantics.

## Files

Modify:

```text
src/server/recorder/crxPlayer.ts
examples/recorder-crx/src/replay/parserSafeRenderer.ts
examples/recorder-crx/src/replay/actionCounter.ts
examples/recorder-crx/src/flow/stepStability.test.ts
```

## Allowed runtime fallback

Only:

```text
active AntD popup option dispatch
duplicate test id ordinal replay
popconfirm active confirm when parser-safe selector is explicit
```

Forbidden:

```text
global text fallback
click first matching element
open all selects
business semantics in CrxPlayer
```

## Implementation

1. Parser-safe renderer marks fallback intent through selector shape or step metadata already parsable.
2. CrxPlayer only intercepts selectors matching active popup selectors:

```text
.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option
.ant-select-tree-node-content-wrapper
.ant-cascader-dropdown:not(.ant-cascader-dropdown-hidden) .ant-cascader-menu-item
```

3. Fallback exact-matches tokens. Multiple loose candidates fail closed.
4. Add diagnostics for fallback used.

## Tests

```text
- runtime active popup dispatch succeeds for Select option
- ambiguous popup candidates fail closed
- non-popup click is not globally healed
- action count remains correct
- legacy player unaffected
```

Commands:

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build:crx
npm run build:tests
cd tests
xvfb-run -a npx playwright test crx/player.spec.ts crx/player-asserts.spec.ts crx/humanLikeRecorder.spec.ts \
  --config=playwright.config.ts --project=Chrome --workers=1 --reporter=line
```

## Rollback

Disable new runtime fallback paths; parser-safe code should still fail honestly rather than false-green.
