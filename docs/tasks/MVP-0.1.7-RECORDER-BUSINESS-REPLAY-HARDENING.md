# MVP 0.1.7: Recorder Business Replay Hardening

## 1. Goal

MVP 0.1.7 turns the current semantic business-flow recorder from “can record and replay realistic AntD/ProComponents actions” into “can generate replay assets that are reviewable, parser-safe, runtime-safe, privacy-safe, and capable of proving terminal business state.”

This phase is intentionally narrower than MVP 0.2. It does not build a full spec generator or local runner. It improves the quality of the flow asset, code preview/playback, terminal-state assertions, and diagnostics inside the existing Playwright CRX workflow.

## 2. Non-goals

Do not implement in this phase:

```text
Native Messaging
Node Runner
Flow → Playwright spec generation
CI automation against downstream business app
AI intent scoring dashboard
Storybook / Playwright CT corpus
broad business wrapper migration
hardcoded networking/WAN/IP Pools domain logic in plugin core
rewriting Playwright recorder/player
replacing real CRX E2E with mocked DOM-only tests
```

## 3. Assumptions

1. PR #11 is merged baseline.
2. `semanticAdapterEnabled` and PR #10 privacy controls remain available.
3. `UiSemanticContext`, `UiActionRecipe`, business hints, and compact sanitization already exist.
4. PR #11 added realistic WAN/IP Pools equivalent fixtures under:

```text
tests/server/antd-wan-transport-real.html
tests/server/src/antdWanTransportRealApp.tsx
```

5. `networking_contract_summary.md` is the only downstream business input in this bundle. The raw archive is not included and should not be requested for this phase.

## 4. Repo responsibilities

### `playwright-crx`

Owns:

```text
Replay asset quality.
Parser-safe code preview/playback.
Terminal-state assertion suggestion/serialization.
Privacy-safe replay diagnostics.
Real CRX E2E coverage.
```

Likely touched files:

```text
examples/recorder-crx/src/flow/codePreview.ts
examples/recorder-crx/src/flow/flowBuilder.ts
examples/recorder-crx/src/flow/pageContextMatcher.ts
examples/recorder-crx/src/flow/exportSanitizer.ts
examples/recorder-crx/src/flow/compactExporter.ts
examples/recorder-crx/src/flow/stepStability.test.ts
examples/recorder-crx/src/uiSemantics/compact.ts
examples/recorder-crx/src/uiSemantics/businessHints.ts
examples/recorder-crx/src/uiSemantics/recipes.ts
examples/recorder-crx/src/uiSemantics/types.ts
tests/crx/semanticAdapter.spec.ts
tests/crx/humanLikeRecorder.spec.ts
tests/crx/businessFlowRecorder.spec.ts
tests/server/src/antdWanTransportRealApp.tsx
```

Do not touch unless a blocker proves it necessary:

```text
src/server/recorder/crxRecorderApp.ts
src/server/recorder/crxPlayer.ts
playwright/**
node_modules/**
```

### Downstream business repo

Owns:

```text
Stable generic hints.
Terminal-state-friendly DOM hooks.
Pilot flows with stable non-sensitive test data.
Business wrapper compatibility.
```

Do not make `playwright-crx` depend on downstream business labels or module names.

## 5. Task breakdown

### Task A — Add terminal-state assertion model for semantic replay

#### Goal

Represent terminal-state expectations at the business-flow level without jumping to full Playwright spec generation.

#### Files likely touched

```text
examples/recorder-crx/src/flow/types.ts
examples/recorder-crx/src/flow/flowBuilder.ts
examples/recorder-crx/src/flow/compactExporter.ts
examples/recorder-crx/src/flow/exportSanitizer.ts
examples/recorder-crx/src/flow/stepStability.test.ts
```

#### Implementation notes

Add a minimal, generic assertion representation if the existing `FlowAssertion` shape cannot express these cleanly:

```ts
type SemanticTerminalAssertionKind =
  | 'row-exists'
  | 'row-not-exists'
  | 'row-updated'
  | 'modal-closed'
  | 'drawer-closed'
  | 'popover-closed'
  | 'selected-value-visible'
  | 'form-validation-visible'
  | 'toast-visible';
```

Prefer using the existing `FlowAssertion` when possible:

```ts
{
  type: 'custom',
  subject: 'terminal-state',
  expected: 'row-exists',
  params: {
    tableTestId,
    rowKey,
    rowTextToken,
    overlayTitle,
  }
}
```

Keep values compact and sanitized. Do not store full row text or raw values.

#### Acceptance tests

Add unit/flow tests that prove assertions can be attached to steps after:

```text
protable-toolbar-action create
submit-form modal-form
confirm-popconfirm delete
select-option
editable-table-cell save
```

#### Negative regression tests

- Do not output full `rowText`.
- Do not output `overlay.text`.
- Do not infer terminal state from click alone when no table/modal/overlay context exists.

#### Privacy/security

Terminal assertions may include stable identifiers:

```text
tableTestId
rowKey
fieldName
field label if non-sensitive
```

They must not include:

```text
full row text
raw form values
credentials
tokens
rawAction
sourceCode
full DOM
```

#### Rollback / blast radius

Keep terminal assertions optional. If regression occurs, feature can be disabled by not generating assertion suggestions. Existing recording/replay remains unchanged.

---

### Task B — Harden parser-safe and runtime-safe code preview

#### Goal

Make generated code preview/runtime playback robust for the PR #11 failure classes.

#### Files likely touched

```text
examples/recorder-crx/src/flow/codePreview.ts
examples/recorder-crx/src/flow/stepStability.test.ts
tests/crx/humanLikeRecorder.spec.ts
```

#### Implementation notes

Preserve and extend these behaviors:

```text
Select placeholder suppression after repeat/parameter substitution.
Duplicate row action ids must be table/row/container scoped.
Popconfirm confirmation must use visible popover scope, not modal scope.
Row text matching should use tokenized regex/container fallback, not exact whitespace.
Overlay root testId should not be clicked as action target.
```

Add internal helper-level diagnostics or comments only where they explain emitted replay code. Avoid introducing a large new codegen architecture.

#### Acceptance tests

Must preserve/add tests for:

```text
placeholder option never emitted as click target
row scoped action with duplicate test id
Popconfirm OK visible popover scope
modal/drawer scoped row action
parser-safe code string for runtime playback
repeat segment parameterization does not reintroduce placeholder
```

#### Negative regression tests

- Do not emit global `page.getByTestId("row-delete-action").click()` when row scope exists.
- Do not emit `.ant-select-item-option` click for placeholder/search prompt text.
- Do not use blind `waitForTimeout` as a substitute for overlay hidden/row state checks.

#### Privacy/security

No raw context dump into generated code comments. Generated comments must not include full row text or sensitive values.

#### Rollback

Changes isolated to code preview/playback emission. Revert this PR without affecting semantic adapter collection if necessary.

---

### Task C — Privacy-safe replay diagnostics

#### Goal

Make replay failures explainable without leaking private data.

#### Files likely touched

```text
examples/recorder-crx/src/flow/codePreview.ts
examples/recorder-crx/src/uiSemantics/diagnostics.ts
examples/recorder-crx/src/flow/exportSanitizer.ts
examples/recorder-crx/src/flow/stepStability.test.ts
```

#### Implementation notes

Add compact replay diagnostic entries for decisions like:

```text
replay.locator.scoped-row-action
replay.locator.suppressed-placeholder-option
replay.locator.popconfirm-scope
replay.assertion.suggested-terminal-state
replay.assertion.skipped-insufficient-context
```

Keep diagnostics in memory / session-level storage only. Do not write diagnostics to flow export or compact YAML.

Diagnostic example:

```ts
{
  event: 'replay.locator.scoped-row-action',
  stepId: 's023',
  recipeKind: 'table-row-action',
  targetTestId: 'wan-transport-row-delete-action',
  table: 'wan-transport',
  rowKey: 'row-nova-public',
  reason: 'duplicate test id scoped by table/row context'
}
```

No raw row text, raw DOM, rawAction, or sourceCode.

#### Acceptance tests

- Diagnostics default off.
- Diagnostics enabled does not change replay output.
- Export and AI input do not include replay diagnostics.

#### Negative regression tests

- No `locatorHints`/`reasons`/`rowText`/`overlay.text` in diagnostics export path.
- Diagnostics should not include full URL query/hash.

#### Rollback

Diagnostics should be behind a flag. Disable by default.

---

### Task D — Add realistic WAN/IP Pools terminal-state CRX coverage

#### Goal

Extend current realistic fixtures to prove business terminal states.

#### Files likely touched

```text
tests/server/src/antdWanTransportRealApp.tsx
tests/crx/humanLikeRecorder.spec.ts
tests/crx/businessFlowRecorder.spec.ts
tests/crx/semanticAdapter.spec.ts
```

#### Implementation notes

Do not replace realistic AntD/ProComponents fixtures with hand-written minimal DOM mocks.

Add assertions after replay such as:

```text
row appears after add
row disappears after delete
selected value visible after select
modal closes after submit
popconfirm closes after confirm
validation error visible when required field missing
```

Use `expect(locator).toBeVisible()` / `toHaveCount()` / `toContainText()` / `toBeHidden()` with semantic locators. Avoid blind sleep.

#### Acceptance tests

Focused tests:

```bash
xvfb-run -a npx playwright test -c tests/playwright.config.ts \
  tests/crx/humanLikeRecorder.spec.ts \
  -g "runtime replay supports wait inserted|shared WAN duplicate row edit action|WAN2 transport delete" \
  --project=Chrome --workers=1 --reporter=line --global-timeout=420000
```

Full regression:

```bash
xvfb-run -a npx playwright test -c tests/playwright.config.ts \
  --project=Chrome --workers=1 --reporter=line --global-timeout=1200000
```

#### Negative regression tests

- Replay must fail if expected row is not added/removed.
- Replay must fail if modal remains open after submit when it should close.
- Replay must fail if placeholder `选择一个VRF` is treated as option.

#### Rollback

If realistic fixture becomes flaky, isolate the flaky test with issue link only after preserving the lower-level negative regression in `stepStability.test.ts`.

---

## 6. Required validation commands

Run before merge:

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build:examples:recorder
npm run build:tests
xvfb-run -a npx playwright test -c tests/playwright.config.ts \
  tests/crx/humanLikeRecorder.spec.ts tests/crx/businessFlowRecorder.spec.ts tests/crx/semanticAdapter.spec.ts \
  --project=Chrome --workers=1 --reporter=line --global-timeout=900000
xvfb-run -a npx playwright test -c tests/playwright.config.ts \
  --project=Chrome --workers=1 --reporter=line --global-timeout=1200000
npm run build
npm run build:crx
git diff --check
```

If runtime is too high for local iteration, use focused tests first, but full CRX regression must pass before merge.

## 7. Acceptance criteria

MVP 0.1.7 is acceptable when:

```text
Recorded realistic WAN/IP Pools-equivalent flows replay and prove terminal state.
Generated code preview stays parser-safe.
Runtime playback avoids placeholder options and wrong duplicate row actions.
Terminal assertions are compact and privacy safe.
Diagnostics explain replay decisions without export/AI leakage.
No networking-specific strings are hardcoded in plugin core.
All PR #11 negative tests remain.
Full CRX regression passes.
```

## 8. Explicitly deferred to later phases

### MVP 0.1.8

```text
Storybook / Playwright CT component fixture corpus
```

### MVP 0.1.9

```text
AI intent quality scoring dashboard
```

### MVP 0.2

```text
Flow → Playwright spec generation
Runner
Native Messaging
CI automation
```
