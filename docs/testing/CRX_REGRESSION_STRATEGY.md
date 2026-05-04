# CRX Regression Strategy

> Goal: keep the CRX recorder/player E2E suite useful as a regression system instead of turning old UI drift into noise.

This document defines how the repository treats three CRX regression layers:

1. **Business-flow core regression** — must be green on every relevant change.
2. **Legacy recorder/player core regression** — must be green after fixture isolation and selector-helper cleanup.
3. **Full CRX periodic regression** — run regularly to catch broader extension, recorder, player and upstream integration regressions.

The guiding rule is: **do not edit tests just to make them green**. A failure must be classified first. If the failure exposes product/business logic bug, record the root cause, add a regression test, and fix the production code.

---

## 1. Why this exists

The project has two valid UI/test surfaces now:

- **Business-flow recorder UI** in `examples/recorder-crx`, focused on business steps, intents, assertions and exportable flow assets.
- **Legacy Playwright recorder/player UI**, inherited from the original CRX project, focused on low-level recorder/player/codegen/extension behavior.

Old specs are valuable because they exercise foundational capabilities that the business-flow layer still depends on:

- action capture
- generated Playwright source
- replay/player resume behavior
- extension target attachment
- dialogs, cookies, popups, incognito, context and other browser edge cases

However, old specs can become noisy when they accidentally enter the business-flow UI or bind directly to old CodeMirror DOM classes. The fix is not to rewrite their intent into business-flow tests; the fix is to separate modes and hide brittle DOM details behind helpers.

---

## 2. Failure classification before fixing

Every CRX E2E failure must be classified before code changes.

### A. Product/business bug

Examples:

- recorder generates replay steps in the wrong order
- explicit `testId` click is overwritten by stale page context
- business-flow export drops step identity, intent, assertion or network reference
- replay cannot perform the action that the recorder just generated

Required response:

1. Reproduce with the smallest command/spec.
2. Record the observed behavior, expected behavior and root cause hypothesis.
3. Add or extend a failing regression test first.
4. Fix production code, not the test.
5. Re-run the focused test and the relevant regression layer.

### B. Fixture or mode drift

Examples:

- a legacy spec expects the old recorder UI but the fixture opens the business-flow panel
- a business-flow spec accidentally attaches legacy UI
- extension storage/query/default settings changed and a suite enters the wrong mode

Required response:

1. Keep the test intent unchanged.
2. Fix the shared fixture/helper so each suite explicitly selects the intended mode.
3. Add fixture-level coverage when possible.
4. Re-run affected legacy and business-flow specs.

### C. Brittle UI implementation selector

Examples:

- direct `.CodeMirror-line` / `.CodeMirror-linenumber` dependency
- direct `.cm-line` dependency
- assertions coupled to incidental DOM wrappers instead of source text/line behavior

Required response:

1. Do not scatter one-off selector replacements through specs.
2. Add or extend a source-code helper that supports current and legacy DOM forms.
3. Update specs to express behavior through the helper.
4. Re-run affected specs.

### D. Obsolete test target

Examples:

- a spec asserts visual details of a removed UI affordance that no longer maps to a supported capability
- a test only verifies old chrome around the recorder, not recorder/player behavior

Required response:

1. Document why the target is obsolete.
2. Either move it to a legacy-only/visual suite or replace it with a behavior-level assertion.
3. Do not silently weaken the assertion.

---

## 3. Regression layers

### Layer A — Business-flow core regression, must be green

Purpose: protect the new business-flow MVP surface and real-world Ant Design / ProComponents flows.

Command:

```bash
npm run test:flow --prefix examples/recorder-crx
xvfb-run -a npx playwright test -c tests/playwright.config.ts businessFlowRecorder.spec.ts humanLikeRecorder.spec.ts --project=Chrome --workers=1
```

This layer should exercise:

- business-flow step ordering and stable IDs
- ProForm / ProFormSelect / Cascader / address-pool style flows
- human-like click/type/select behavior
- generated replay and exported source
- extension side-panel resume/F8/player behavior where applicable

Expected policy: **always green before merging business-flow changes**.

### Layer B — Legacy recorder/player core regression, must be green

Purpose: keep old low-level recorder/player tests as bottom-layer capability sentinels.

Command:

```bash
xvfb-run -a npx playwright test -c tests/playwright.config.ts recorder.spec.ts player.spec.ts player-actions.spec.ts player-asserts.spec.ts --project=Chrome --workers=1
```

This layer should exercise:

- legacy recorder attach/start/stop behavior
- Playwright code generation surface
- player resume/run behavior
- action and assertion playback primitives

Expected policy: **green after the legacy fixture explicitly enters legacy mode and source-code helpers remove DOM-class noise**.

### Layer C — Full CRX periodic regression

Purpose: catch broad CRX regressions beyond the required smoke/core layers.

Command:

```bash
xvfb-run -a npx playwright test -c tests/playwright.config.ts --project=Chrome --workers=1
```

Expected policy:

- Run on a schedule and before larger releases.
- Investigate failures with the same classification rules.
- Do not claim “full repo green” unless this command actually completed successfully.

---

## 4. Fixture mode isolation

Specs must not rely on whichever recorder UI happens to be the default.

Use explicit helpers such as:

```ts
await attachRecorder(page, { mode: 'legacy' });
await attachRecorder(page, { mode: 'business-flow' });
```

or separate aliases:

```ts
await attachLegacyRecorder(page);
await attachBusinessFlowRecorder(page);
```

Rules:

- `recorder.spec.ts`, `player.spec.ts`, `player-actions.spec.ts`, `player-asserts.spec.ts` are legacy-core specs unless a test explicitly says otherwise.
- `businessFlowRecorder.spec.ts` and `humanLikeRecorder.spec.ts` are business-flow specs.
- Mode selection should live in shared fixtures/helpers, not duplicated inside each spec.
- If extension storage or query parameters are used for mode selection, the helper must reset/seed them deterministically for every test.
- A mode-isolation regression test should prove that legacy and business-flow specs land on different expected entry surfaces.

---

## 5. Source-code helper policy

Tests should assert source behavior, not incidental editor internals.

Do not write new direct dependencies on:

```text
.CodeMirror-line
.CodeMirror-linenumber
.cm-line
.cm-lineNumbers
```

Preferred helper API shape:

```ts
await sourceLines(recorderPage);
await expectSourceLines(recorderPage, [
  "await page.goto('...')",
  "await page.getByRole('button', { name: 'Save' }).click()",
]);
await pausedSourceLine(recorderPage);
await errorSourceLine(recorderPage);
await sourceLineNumber(recorderPage, 3);
```

Helper behavior:

- Prefer semantic test IDs or accessible labels if the code preview provides them.
- Fall back to current CodeMirror 6 DOM.
- Fall back to legacy CodeMirror 5 DOM.
- Return normalized source text/line information.
- Keep spec assertions focused on generated code and player behavior.

---

## 6. TDD workflow for this workstream

For every production-code or fixture behavior change:

1. **RED** — write the smallest failing test first.
2. Run the focused test and confirm it fails for the expected reason.
3. **GREEN** — implement the smallest fix.
4. Run the focused test and confirm it passes.
5. Run the relevant regression layer.
6. Refactor only while tests stay green.

For an E2E failure that looks like a business bug:

1. Keep the failing generated artifact / failure summary long enough to inspect it.
2. Record the root cause in the commit message, test name or nearby regression-test comment.
3. Add a regression test around the root cause.
4. Fix the production path that generated the wrong behavior.
5. Do not paper over the failure by changing waits, selectors or expectations unless those are proven to be the root cause.

---

## 7. Build requirements before CRX E2E

When changing `examples/recorder-crx` only:

```bash
npm run build:examples:recorder
npm run build:tests
```

When changing root CRX/server/recorder/player/codegen code:

```bash
npm run build:crx
npm run build:examples:recorder
npm run build:tests
```

Linux/headless environments should run Chrome extension E2E under:

```bash
xvfb-run -a
```

---

## 8. Completion criteria for the current stabilization

The stabilization is complete only when these are true:

1. This document exists and stays aligned with implemented helpers.
2. Business-flow specs explicitly enter business-flow mode.
3. Legacy recorder/player specs explicitly enter legacy mode.
4. Specs no longer bind directly to brittle CodeMirror implementation classes for source assertions.
5. Layer A command passes.
6. Layer B command passes.
7. Layer C command is available and documented for periodic runs; if it fails, failures are classified and not hidden.

Required final report format:

```text
Changed files
What was implemented
How to test
Actual commands run + results
Known limitations / classified remaining failures
```
