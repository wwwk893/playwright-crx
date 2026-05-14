# MVP 0.1x Architecture Migration Status

## Current Status

The MVP 0.1x recorder/replay architecture migration is complete through
PR-17.

The migration docs are now historical guardrails and post-migration reference
material. New work should be tracked as GitHub issues and should not reopen the
PR-01..PR-17 migration train unless an architecture review explicitly changes
that baseline.

## Completed Migration PRs

| Migration PR | GitHub PR | Topic |
| --- | --- | --- |
| PR-01 | #16 | Architecture guardrails |
| PR-02 | #18 | Recorder event journal v3 |
| PR-03 | #19 | Recording session finalizer |
| PR-04 | #20 | Input transaction model |
| PR-05 | #21 | Select and popup transactions |
| PR-06 | #24 | Business step projection refactor |
| PR-07 | #29 | UiActionRecipe model |
| PR-08 | #30 | Replay compiler split |
| PR-09 | #31 | Runtime player bridge contract |
| PR-10 | #32 | Repeat terminal replay hardening |
| PR-11 | #33 | Adaptive target diagnostics |
| PR-12 | #34 | Cleanup and deprecation |
| PR-13 | #35 | flowBuilder facade cleanup |
| PR-14 | #40 | Replay renderer internals split |
| PR-15 | #41 | Recipe-first replay contract |
| PR-16 | #42 | Adaptive replay diagnostics surfacing |
| PR-17 | #43 | Explicit L1/L2/L3 regression layers |

## Post-Migration Baseline

The current baseline includes:

```text
Event Journal v3
session finalizer
input/select transactions
business projection
UiActionRecipe
exported and parser-safe replay renderer split
narrow runtime bridge contract
repeat terminal-state assertions
adaptive replay diagnostics
explicit L1/L2/L3 regression layers
```

The following files are now long-lived operating contracts:

```text
AGENTS.md
docs/architecture/RECORDER_REPLAY_ARCHITECTURE.md
docs/mvp-0.1x-architecture-migration/ARCHITECTURE_CONTRACT.md
docs/mvp-0.1x-architecture-migration/FINAL_FILE_TREE.md
tests/crx/TEST_LAYERING.md
docs/harness/README.md
docs/harness/REPAIR_LOOP.md
docs/checklists/REVIEW_CHECKLIST.md
```

## Remaining Hardening Issues

Known post-migration follow-up work:

| Issue | Topic |
| --- | --- |
| #25 | Lock terminal assertion ordering after business projection |
| #26 | Add API compatibility coverage for synthetic reconciler facade |
| #27 | Split synthetic reconciler responsibilities |
| #28 | Document business projection order before more projectors |
| #37 | Refine recorder selector parsing layer |
| #39 | Track legacy-core flaky resume behavior |
| #44 | Refresh migration status and post-migration docs |
| #45 | Split replay stepEmitter into focused recipe-backed modules |
| #46 | Add business-flow recorder developer README |
| #47 | Add harness improvement loop and eval case catalog |
| #48 | Add scoped AGENTS.md files |
| #49 | Add issue templates |
| #50 | Define flaky budget and aggregate-run policy |

Issue #22 was closed by PR #51.

## Execution Rule

Future work is no longer part of a serial migration train. Use small,
issue-scoped PRs:

```text
correctness fixes -> focused L1/L2 regression
docs/governance -> git diff --check + L1
runtime bridge -> runtime bridge tests + legacy regression + action count parity
replay renderer changes -> L1 + L2 + L3
```

Do not reintroduce broad logic into:

```text
examples/recorder-crx/src/flow/flowBuilder.ts
examples/recorder-crx/src/flow/codePreview.ts
src/server/*
```

## Path Decisions

- Raw event envelope and normalization live under `examples/recorder-crx/src/capture/`.
- Event journal and flow state live under `examples/recorder-crx/src/flow/`.
- Interaction transaction logic lives under `examples/recorder-crx/src/interactions/`.
- UiActionRecipe domain types live under `examples/recorder-crx/src/uiSemantics/recipes.ts`.
- Replay renderer types may re-export recipe types from `examples/recorder-crx/src/replay/types.ts`.
- `src/server/recorder/*` remains runtime bridge / upstream CRX recorder territory, not business semantic inference.
