# MVP 0.1x Architecture Migration Status

## Baseline

- Migration docs landed on main at: `82b4b1c560e2bd05af225dd161244da6adc2caf3`
- Docs directory: `docs/mvp-0.1x-architecture-migration/`

## Current phase

- Current PR: PR-01 Architecture Guardrails + AGENTS Update
- Next PR: PR-02 Event Journal and Recorder State v3

## Execution rule

This migration must run serially:

```text
PR-01 → PR-02 → PR-03 → PR-04 → PR-05 → PR-06 → PR-07 → PR-08 → PR-09 → PR-10 → PR-11 → PR-12
```

Do not parallelize PR-07/PR-08/PR-09/PR-10.

PR-03 must wait for PR-02 to provide Event Journal high-water marks / pending counts. Finalizer waiting must be based on stable journal counts and diagnostics, not a fixed sleep.

## Architecture contracts

The following files are binding architecture contracts:

- `FINAL_FILE_TREE.md`
- `PR_TO_FILE_MAP.md`
- `ARCHITECTURE_CONTRACT.md`

If a task document conflicts with these files, update the task document first.

## Path decisions

- Raw event envelope and normalization live under `examples/recorder-crx/src/capture/`.
- Event journal and flow state live under `examples/recorder-crx/src/flow/`.
- Interaction transaction logic lives under `examples/recorder-crx/src/interactions/`.
- UiActionRecipe domain types live under `examples/recorder-crx/src/uiSemantics/recipes.ts`.
- Replay renderer types may re-export recipe types from `examples/recorder-crx/src/replay/types.ts`.
- Do not introduce a second recipe model under `replay/recipes.ts` unless a later architecture review explicitly changes this decision.
