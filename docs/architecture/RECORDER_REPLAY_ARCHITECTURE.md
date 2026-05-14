# Recorder Replay Architecture

This document describes the current post-migration architecture for the
business-flow recorder and replay harness. The historical migration plan lives
under `docs/mvp-0.1x-architecture-migration/`; this file is the stable
operating map after PR-17.

## Data Flow

```text
Raw recorder actions
  -> capture normalization
  -> Event Journal
  -> interaction transactions
  -> BusinessFlow projection
  -> UiActionRecipe
  -> exported Playwright renderer
  -> parser-safe playback renderer
  -> narrow runtime bridge only when declared by recipe
```

## Module Ownership

| Area | Owns | Must not own |
| --- | --- | --- |
| `capture/` | Raw recorder facts, page context facts, normalization | FlowStep projection, replay code |
| `interactions/` | Input/select/click transaction composition | Playwright source rendering |
| `flow/` | BusinessFlow model, Event Journal, projection, finalization, export/redaction | Runtime bridge behavior, DOM scanning |
| `uiSemantics/` | AntD/ProComponents/business semantic context and UiActionRecipe | Final Playwright code emission |
| `replay/` | Exported and parser-safe replay rendering from FlowStep + UiActionRecipe | New business semantic inference |
| `tests/crx/` | L2/L3 integration, generated replay evidence, legacy CRX coverage | Mock replacements for real AntD coverage |
| `src/server/recorder/` | Upstream recorder/player and narrow runtime bridge | Business semantics, selector self-healing, global fallback |

## Core Invariants

- Raw recorder actions and page context events are fact sources, not business
  steps.
- `BusinessFlow.steps` is a stable business projection. User edits, comments,
  assertions, repeat rows, and manual steps must survive recorder merge.
- Codegen must not rediscover business semantics. It consumes the projected
  step and recipe contract.
- Exported Playwright and parser-safe playback must share the same semantic
  source.
- Parser-safe gaps must be declared in the recipe through `runtimeFallback`.
- Runtime bridge code must be narrow, tested, and free of broad text fallback or
  selector self-healing.

## Current Facades

The following public entrypoints intentionally remain as compatibility facades:

```text
examples/recorder-crx/src/flow/flowBuilder.ts
examples/recorder-crx/src/flow/codePreview.ts
examples/recorder-crx/src/replay/index.ts
```

Do not move new internal logic into these facades. Add new implementation to the
owner module and keep the facade as delegation only.

## Known Complexity Hubs

These modules are accepted post-migration complexity hubs and have follow-up
issues:

| Module | Follow-up |
| --- | --- |
| `examples/recorder-crx/src/replay/stepEmitter.ts` | #45 |
| `examples/recorder-crx/src/flow/syntheticReconciler.ts` | #27 |
| `examples/recorder-crx/src/capture/targetFromRecorderSelector.ts` | #37 |

Keep unrelated fixes out of those cleanup PRs. Correctness fixes should remain
small and issue-scoped.

## Validation Map

| Change type | Required validation |
| --- | --- |
| Flow/projection/recipe contract | `npm run test:crx:business-flow:l1` |
| Replay renderer behavior | L1 + L2 |
| Human-like recording stability | L1 + L3 |
| Runtime bridge | focused runtime bridge tests + legacy-core + action count parity |
| Documentation/governance only | `git diff --check` + L1 unless clearly unnecessary |

See `tests/crx/TEST_LAYERING.md` and `docs/harness/README.md` for the full
harness contract.
