# PR_TO_FILE_MAP.md

This file maps each PR to the target files it is allowed to create/modify. It prevents architectural drift.

## Status

PR-01 through PR-17 are complete. This file is now a historical migration map,
not an active serial execution plan. Future post-migration work should use
GitHub issues and the scoped AGENTS.md files near the code being changed.

## PR-01 — Architecture guardrails and AGENTS

Create/modify:

```text
AGENTS.md
STATUS.md
TARGET_ARCHITECTURE.md
FINAL_FILE_TREE.md
PR_TO_FILE_MAP.md
ARCHITECTURE_CONTRACT.md
docs/migration/MODULE_BOUNDARIES.md
docs/checklists/ACCEPTANCE_GATES.md
docs/prs/PR-02-event-journal-and-recorder-state-v3.md
docs/prs/PR-07-ui-action-recipe-model.md
```

Must not modify runtime code except docs/tests import path checks.

## PR-02 — Event journal and recorder state v3

Create:

```text
examples/recorder-crx/src/capture/eventEnvelope.ts
examples/recorder-crx/src/capture/recorderActionNormalizer.ts
examples/recorder-crx/src/flow/eventJournal.ts
```

Modify:

```text
examples/recorder-crx/src/flow/types.ts
examples/recorder-crx/src/flow/recorderState.ts
examples/recorder-crx/src/flow/flowMigration.ts
examples/recorder-crx/src/flow/stepStability.test.ts
```

## PR-03 — Session finalizer

Create:

```text
examples/recorder-crx/src/flow/sessionFinalizer.ts
examples/recorder-crx/src/flow/sessionDrain.ts
```

Modify:

```text
examples/recorder-crx/src/crxRecorder.tsx
examples/recorder-crx/src/flow/flowBuilder.ts
examples/recorder-crx/src/flow/stepStability.test.ts
```

## PR-04 — Input transactions

Create:

```text
examples/recorder-crx/src/interactions/types.ts
examples/recorder-crx/src/interactions/targetIdentity.ts
examples/recorder-crx/src/interactions/inputTransactions.ts
examples/recorder-crx/src/interactions/transactionComposer.ts
```

Modify:

```text
examples/recorder-crx/src/flow/sessionFinalizer.ts
examples/recorder-crx/src/flow/businessFlowProjection.ts
examples/recorder-crx/src/flow/flowBuilder.ts
examples/recorder-crx/src/flow/stepStability.test.ts
```

## PR-05 — Select / popup transactions

Create:

```text
examples/recorder-crx/src/interactions/selectTransactions.ts
examples/recorder-crx/src/interactions/popupTransactions.ts
```

Modify:

```text
examples/recorder-crx/src/pageContextSidecar.ts
examples/recorder-crx/src/flow/sessionFinalizer.ts
examples/recorder-crx/src/flow/flowBuilder.ts
examples/recorder-crx/src/flow/stepStability.test.ts
```

## PR-06 — Business step projection refactor

Create:

```text
examples/recorder-crx/src/flow/businessFlowProjection.ts
examples/recorder-crx/src/flow/syntheticReconciler.ts
```

Modify:

```text
examples/recorder-crx/src/flow/flowBuilder.ts
examples/recorder-crx/src/flow/stepStability.test.ts
```

## PR-07 — UiActionRecipe model

Create/modify:

```text
examples/recorder-crx/src/uiSemantics/recipes.ts
examples/recorder-crx/src/replay/types.ts
examples/recorder-crx/src/replay/recipeBuilder.ts
examples/recorder-crx/src/flow/types.ts
examples/recorder-crx/src/flow/businessFlowProjection.ts
examples/recorder-crx/src/flow/stepStability.test.ts
```

## PR-08 — Replay compiler split

Create:

```text
examples/recorder-crx/src/replay/index.ts
examples/recorder-crx/src/replay/exportedRenderer.ts
examples/recorder-crx/src/replay/parserSafeRenderer.ts
examples/recorder-crx/src/replay/assertionRenderer.ts
examples/recorder-crx/src/replay/repeatRenderer.ts
examples/recorder-crx/src/replay/actionCounter.ts
examples/recorder-crx/src/replay/antDRecipeRenderers.ts
```

Modify:

```text
examples/recorder-crx/src/flow/codePreview.ts       # façade only
examples/recorder-crx/src/flow/stepStability.test.ts
```

## PR-09 — Runtime player bridge contract

Modify only with narrow scope:

```text
src/server/recorder/crxPlayer.ts
examples/recorder-crx/src/replay/parserSafeRenderer.ts
examples/recorder-crx/src/replay/types.ts
examples/recorder-crx/src/flow/stepStability.test.ts
tests/crx/player*.spec.ts
tests/crx/humanLikeRecorder.spec.ts
```

## PR-10 — Repeat + terminal-state hardening

Create/modify:

```text
examples/recorder-crx/src/replay/terminalAssertions.ts
tests/crx/businessFlowRecorder.spec.ts
tests/crx/humanLikeRecorder.spec.ts
examples/recorder-crx/src/flow/repeatSegments.ts
examples/recorder-crx/src/flow/stepStability.test.ts
```

## PR-11 — Diagnostics + adaptive target snapshot

Create:

```text
examples/recorder-crx/src/flow/adaptiveTargetTypes.ts
examples/recorder-crx/src/flow/adaptiveTargetSnapshot.ts
examples/recorder-crx/src/flow/adaptiveTargetRedactor.ts
examples/recorder-crx/src/flow/locatorCandidates.ts
```

Modify:

```text
examples/recorder-crx/src/flow/exportSanitizer.ts
examples/recorder-crx/src/flow/compactExporter.ts
examples/recorder-crx/src/components/*diagnostics*       # only if UI display is added
```

## PR-12 — Cleanup and deprecation

Modify:

```text
examples/recorder-crx/src/flow/flowBuilder.ts
examples/recorder-crx/src/flow/codePreview.ts
examples/recorder-crx/src/pageContextSidecar.ts
examples/recorder-crx/src/crxRecorder.tsx
AGENTS.md
```

Acceptance:

- `flowBuilder.ts` and `codePreview.ts` are thin façades.
- Legacy helper functions marked deprecated or removed.
- Final module tree matches `FINAL_FILE_TREE.md`.
- Full CRX regression and flow tests pass.

## PR-13 — flowBuilder facade cleanup

GitHub PR: #35

Create/modify:

```text
examples/recorder-crx/src/flow/recorderActionMerge.ts
examples/recorder-crx/src/flow/recordedActionEntries.ts
examples/recorder-crx/src/flow/stepDrafts.ts
examples/recorder-crx/src/flow/stepInsertion.ts
examples/recorder-crx/src/capture/targetFromRecorderSelector.ts
examples/recorder-crx/src/flow/flowBuilder.ts
examples/recorder-crx/src/flow/stepStability.test.ts
```

Acceptance:

- `flowBuilder.ts` delegates recorder action merge internals.
- Recorded action extraction, step draft creation, insertion, and source rendering
  are physically split.
- No replay/runtime behavior changes.

## PR-14 — replay compiler physical split

GitHub PR: #40

Create/modify:

```text
examples/recorder-crx/src/replay/stepEmitter.ts
examples/recorder-crx/src/replay/exportedRenderer.ts
examples/recorder-crx/src/replay/parserSafeRenderer.ts
examples/recorder-crx/src/replay/actionCounter.ts
examples/recorder-crx/src/replay/assertionRenderer.ts
examples/recorder-crx/src/replay/repeatRenderer.ts
examples/recorder-crx/src/replay/antDRecipeRenderers.ts
examples/recorder-crx/src/flow/codePreview.ts
examples/recorder-crx/src/flow/stepStability.test.ts
```

Acceptance:

- `codePreview.ts` remains a re-export / compatibility facade.
- Parser-safe replay and action counting are no longer thin aliases around the
  exported renderer.
- Token-order handling for parser-safe AntD option matching is covered by L1.

## PR-15 — recipe-first replay contract

GitHub PR: #41

Create/modify:

```text
examples/recorder-crx/src/uiSemantics/recipes.ts
examples/recorder-crx/src/replay/recipeBuilder.ts
examples/recorder-crx/src/replay/stepEmitter.ts
examples/recorder-crx/src/replay/exportedRenderer.ts
examples/recorder-crx/src/replay/parserSafeRenderer.ts
examples/recorder-crx/src/replay/actionCounter.ts
examples/recorder-crx/src/flow/terminalAssertions.ts
examples/recorder-crx/src/flow/stepStability.test.ts
```

Acceptance:

- AntD/ProComponents Select replay strategy is expressed through UiActionRecipe.
- TreeSelect and Cascader do not accidentally use ordinary Select owned-option
  replay mechanics.
- Selected-value echo suppression is field-scoped or assertion-tied.

## PR-16 — adaptive diagnostics surfacing

GitHub PR: #42

Create/modify:

```text
examples/recorder-crx/src/flow/adaptiveFailureReport.ts
examples/recorder-crx/src/flow/adaptiveTargetSnapshot.ts
examples/recorder-crx/src/flow/adaptiveTargetRedactor.ts
examples/recorder-crx/src/flow/locatorCandidates.ts
tests/crx/helpers/replayAssertions.ts
tests/crx/businessFlowRecorder.spec.ts
tests/crx/humanLikeRecorder.spec.ts
```

Acceptance:

- Replay failure artifacts include privacy-safe diagnostics.
- Diagnostics are not exported in business-flow JSON or compact YAML.
- Generated replay failure reports are retained under the raw replay artifacts.

## PR-17 — explicit L1/L2/L3 regression layers

GitHub PR: #43

Create/modify:

```text
package.json
.github/workflows/crx-regression.yml
.github/pull_request_template.md
tests/crx/TEST_LAYERING.md
docs/checklists/REVIEW_CHECKLIST.md
docs/mvp-0.1x-architecture-migration/docs/checklists/REVIEW_CHECKLIST.md
```

Acceptance:

- `test:crx:business-flow:l1`, `:l2`, `:l3`, and `:layers` scripts exist.
- The historical `test:crx:business-flow` aggregate command remains available.
- CI exposes L1 contract, L2 deterministic replay, and L3 human-like smoke as
  named steps.
