# FINAL_FILE_TREE.md

This file is the **non-negotiable target file tree contract** for the architecture migration.

The migration roadmap describes PR order. This file describes the expected final module layout. Hermes must treat this as the acceptance target for the whole migration.

## Final target tree

```text
examples/recorder-crx/src/
├─ capture/
│  ├─ eventEnvelope.ts
│  ├─ recorderActionNormalizer.ts
│  ├─ pageContextSidecar.ts              # may be moved here from src/pageContextSidecar.ts after adapters settle
│  └─ README.md
│
├─ flow/
│  ├─ types.ts
│  ├─ eventJournal.ts
│  ├─ recorderState.ts
│  ├─ stableIds.ts
│  ├─ flowMigration.ts
│  ├─ sessionFinalizer.ts
│  ├─ businessFlowProjection.ts
│  ├─ syntheticReconciler.ts
│  ├─ exportSanitizer.ts
│  ├─ compactExporter.ts
│  ├─ storage.ts
│  ├─ redactor.ts
│  ├─ diagnostics.ts
│  └─ flowBuilder.ts                     # compatibility façade only
│
├─ interactions/
│  ├─ types.ts
│  ├─ targetIdentity.ts
│  ├─ inputTransactions.ts
│  ├─ selectTransactions.ts
│  ├─ clickTransactions.ts
│  ├─ tableRowTransactions.ts
│  ├─ dialogTransactions.ts
│  ├─ waitTransactions.ts
│  └─ transactionComposer.ts
│
├─ uiSemantics/
│  ├─ index.ts
│  ├─ types.ts
│  ├─ antdAdapter.ts
│  ├─ proComponentsAdapter.ts
│  ├─ businessHints.ts
│  ├─ recipes.ts
│  ├─ compact.ts
│  ├─ diagnostics.ts
│  └─ README.md
│
├─ replay/
│  ├─ types.ts
│  ├─ recipeBuilder.ts
│  ├─ exportedRenderer.ts
│  ├─ parserSafeRenderer.ts
│  ├─ assertionRenderer.ts
│  ├─ repeatRenderer.ts
│  ├─ actionCounter.ts
│  ├─ antDRecipeRenderers.ts
│  ├─ terminalAssertions.ts
│  └─ index.ts
│
├─ aiIntent/
│  └─ ...                                # unchanged by this migration unless specific PR says otherwise
│
├─ components/
│  └─ ...                                # UI only; no merge/projection/codegen logic
│
├─ pageContextSidecar.ts                 # legacy import shim during migration; remove or delegate by PR-12
├─ crxRecorder.tsx                       # UI orchestration only
└─ settings.ts

src/server/recorder/
├─ crxPlayer.ts                          # runtime bridge only, no business semantics
└─ ...                                   # upstream-protected area
```

## Final dependency direction

```text
capture → flow/eventJournal
capture → uiSemantics
flow/sessionFinalizer → interactions
interactions → uiSemantics types only
flow/businessFlowProjection → interactions + uiSemantics/recipes
replay → flow/types + uiSemantics/recipes
components → flow services + replay public façade
crxRecorder.tsx → components + flow services + replay public façade
src/server/recorder/crxPlayer.ts → runtime bridge only
```

Forbidden dependency directions:

```text
replay → pageContextSidecar
replay → raw DOM scanning
flowBuilder internals → React components
CrxPlayer → uiSemantics business inference
components → transaction internals
capture → replay
```

## Legacy façade requirements

The following old public functions may remain, but after PR-12 they must be thin façades:

```ts
mergeActionsIntoFlow(...)
appendSyntheticPageContextStepsWithResult(...)
generateBusinessFlowPlaywrightCode(...)
generateBusinessFlowPlaybackCode(...)
countBusinessFlowPlaybackActions(...)
```

Final intended ownership:

```text
mergeActionsIntoFlow                       → flow/businessFlowProjection.ts façade through flowBuilder.ts
appendSyntheticPageContextStepsWithResult  → flow/syntheticReconciler.ts façade through flowBuilder.ts
generateBusinessFlowPlaywrightCode         → replay/exportedRenderer.ts façade through codePreview.ts or replay/index.ts
generateBusinessFlowPlaybackCode           → replay/parserSafeRenderer.ts façade through codePreview.ts or replay/index.ts
countBusinessFlowPlaybackActions           → replay/actionCounter.ts façade
```

## End-state anti-goals

By the end of PR-12:

- `flowBuilder.ts` must not contain AntD selector heuristics.
- `codePreview.ts` must not infer dialog/table/select semantics.
- `crxPlayer.ts` must not perform global text fallback.
- `crxRecorder.tsx` must not contain session finalization or transaction logic.
- Low-level typing events must not directly become business steps.
- Exported Playwright and parser-safe runtime playback must share `UiActionRecipe`.
```
