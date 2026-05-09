# Coding Agent Prompt: MVP 0.1.7 Recorder Business Replay Hardening

You are working in `wwwk893/playwright-crx` after PR #11 was merged.

Your task is to implement **MVP 0.1.7: Recorder Business Replay Hardening** only.

Do not implement MVP 0.2. Do not implement Native Messaging, Node Runner, Flow-to-spec generation, CI automation, Storybook/CT corpus, or AI scoring dashboard.

## Read first

Read these files before changing code:

```text
CONTEXT.md, if present
metadata/summary.json, if present
docs/mvp-0.1.6-business-components-semantic-alignment/README.md
docs/mvp-0.1.6-business-components-semantic-alignment/docs/design/PLAYWRIGHT_CRX_ADAPTER_ALIGNMENT.md
docs/mvp-0.1.6-business-components-semantic-alignment/docs/testing/MVP_0.1.6_ACCEPTANCE_TEST_PLAN.md
examples/recorder-crx/src/uiSemantics/businessHints.ts
examples/recorder-crx/src/uiSemantics/compact.ts
examples/recorder-crx/src/uiSemantics/recipes.ts
examples/recorder-crx/src/uiSemantics/types.ts
examples/recorder-crx/src/flow/codePreview.ts
examples/recorder-crx/src/flow/flowBuilder.ts
examples/recorder-crx/src/flow/pageContextMatcher.ts
examples/recorder-crx/src/flow/exportSanitizer.ts
examples/recorder-crx/src/flow/stepStability.test.ts
tests/crx/semanticAdapter.spec.ts
tests/crx/humanLikeRecorder.spec.ts
tests/crx/businessFlowRecorder.spec.ts
tests/server/src/antdWanTransportRealApp.tsx
```

Also read the new docs if they exist:

```text
docs/tasks/MVP-0.1.7-RECORDER-BUSINESS-REPLAY-HARDENING.md
docs/design/RECORDER_REPLAY_ASSET_QUALITY.md
docs/testing/E2E_TERMINAL_STATE_ASSERTIONS.md
```

## Scope

Implement:

```text
1. terminal-state assertion suggestions/serialization for replay assets;
2. replay/code preview hardening for Select placeholders, duplicate row actions, Popconfirm, row text token matching;
3. privacy-safe replay diagnostics if small enough;
4. realistic WAN/IP Pools equivalent terminal-state E2E coverage.
```

Do not:

```text
rewrite Playwright recorder/player;
modify playwright/** unless a blocker proves it is necessary;
add Cypress or third-party AntD helper runtime dependency;
hardcode WAN/IP Pools/networking strings in production plugin logic;
replace real CRX E2E with mocks;
delete negative regression tests;
add blind sleeps;
leak secrets or raw DOM/source/rawAction into export/AI/diagnostics;
start MVP 0.2 Runner/spec generation.
```

## Implementation order

### Step 1 — Write regression tests first

Add or preserve tests in:

```text
examples/recorder-crx/src/flow/stepStability.test.ts
tests/crx/humanLikeRecorder.spec.ts
tests/crx/businessFlowRecorder.spec.ts
tests/crx/semanticAdapter.spec.ts
```

Required negative tests:

```text
Select placeholder must never be emitted as option click after repeat/parameter substitution.
Duplicate row action test id must not emit global page.getByTestId(...).click() when row/table context exists.
Popconfirm confirm must use visible popover scope, not tooltip role and not modal scope.
Row text matching must be tokenized or key-based, not exact-whitespace-only.
Replay must fail/prove failure if terminal row state is absent.
Export/AI input must not include raw diagnostics/private fields.
```

Run:

```bash
npm run test:flow --prefix examples/recorder-crx
```

### Step 2 — Add terminal-state assertion support

Prefer existing `FlowAssertion` shape if possible. Add small helper functions rather than a large framework.

Likely files:

```text
examples/recorder-crx/src/flow/types.ts
examples/recorder-crx/src/flow/flowBuilder.ts
examples/recorder-crx/src/flow/compactExporter.ts
examples/recorder-crx/src/flow/exportSanitizer.ts
examples/recorder-crx/src/flow/stepStability.test.ts
```

Supported terminal states:

```text
row-exists
row-not-exists
modal-closed
drawer-closed
popover-closed
selected-value-visible
form-validation-visible
toast-visible
```

Keep assertion params compact and sanitized.

### Step 3 — Harden code preview / runtime replay

Likely file:

```text
examples/recorder-crx/src/flow/codePreview.ts
```

Maintain these invariants:

```text
No placeholder option clicks.
No global duplicate row action test id clicks when row/table context exists.
Popconfirm confirm clicks visible popover button.
Overlay root test id is not treated as control target.
Parser-safe output remains parseable.
```

### Step 4 — Add diagnostics if still small

If implemented, diagnostics must be optional and privacy safe.

Likely files:

```text
examples/recorder-crx/src/uiSemantics/diagnostics.ts
examples/recorder-crx/src/flow/codePreview.ts
examples/recorder-crx/src/flow/exportSanitizer.ts
```

Default off. Do not export diagnostics.

### Step 5 — Add realistic terminal-state CRX coverage

Use real AntD/ProComponents fixtures, especially:

```text
tests/server/src/antdWanTransportRealApp.tsx
tests/crx/humanLikeRecorder.spec.ts
tests/crx/businessFlowRecorder.spec.ts
```

Add terminal assertions:

```text
modal closes after submit
row appears after add
row disappears after delete
selected value visible after select
popconfirm closes after confirm
```

No blind sleeps.

## Validation commands

Run focused first:

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build:examples:recorder
npm run build:tests
xvfb-run -a npx playwright test -c tests/playwright.config.ts \
  tests/crx/humanLikeRecorder.spec.ts \
  -g "runtime replay supports wait inserted|shared WAN duplicate row edit action|WAN2 transport delete" \
  --project=Chrome --workers=1 --reporter=line --global-timeout=420000
```

Before final:

```bash
xvfb-run -a npx playwright test -c tests/playwright.config.ts \
  tests/crx/businessFlowRecorder.spec.ts tests/crx/humanLikeRecorder.spec.ts tests/crx/semanticAdapter.spec.ts \
  --project=Chrome --workers=1 --reporter=line --global-timeout=900000
xvfb-run -a npx playwright test -c tests/playwright.config.ts \
  --project=Chrome --workers=1 --reporter=line --global-timeout=1200000
npm run build
npm run build:crx
git diff --check
```

## Final response format

Return:

```text
Summary
Changed files
How to test
Acceptance checklist
Security/privacy notes
Known limitations
Next handoff
```

Do not auto-merge.
