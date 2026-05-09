# PR_TO_FILE_MAP.md

This file maps each PR to the target files it is allowed to create/modify. It prevents architectural drift.

## PR-01 — Architecture guardrails and AGENTS

Create/modify:

```text
AGENTS.md
TARGET_ARCHITECTURE.md
FINAL_FILE_TREE.md
PR_TO_FILE_MAP.md
ARCHITECTURE_CONTRACT.md
docs/migration/MODULE_BOUNDARIES.md
docs/checklists/ACCEPTANCE_GATES.md
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
examples/recorder-crx/src/flow/types.ts
examples/recorder-crx/src/flow/businessFlowProjection.ts
examples/recorder-crx/src/flow/stepStability.test.ts
```

## PR-08 — Replay compiler split

Create:

```text
examples/recorder-crx/src/replay/index.ts
examples/recorder-crx/src/replay/recipeBuilder.ts
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
```
