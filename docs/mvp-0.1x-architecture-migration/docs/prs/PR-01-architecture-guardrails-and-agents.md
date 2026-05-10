# PR-01: Architecture Guardrails and AGENTS Update

## Goal

Codify the migration rules before changing behavior. This PR should update repository guidance and add docs only.

## Scope

Modify:

```text
AGENTS.md
docs/mvp-0.1x-architecture-migration/**
```

Allowed documentation-only conflict fixes in this PR:

- PR-02 paths must follow `FINAL_FILE_TREE.md` + `PR_TO_FILE_MAP.md`: raw event envelope/normalization under `capture/`, journal under `flow/`.
- PR-07 recipe ownership must use `uiSemantics/recipes.ts` for domain types and `replay/types.ts` for renderer-facing re-exports/types; do not introduce a second `replay/recipes.ts` model.

Do not modify product source code.

## Implementation

1. Add sections from `AGENTS_UPDATE_PROPOSAL.md` to repository `AGENTS.md`.
2. Add migration docs under:

```text
docs/mvp-0.1x-architecture-migration/
```

3. Add a short `docs/mvp-0.1x-architecture-migration/STATUS.md` recording baseline branch/commit.

## Acceptance

- AGENTS defines layering invariants.
- AGENTS defines input transaction rules.
- AGENTS defines session finalization rule.
- AGENTS defines exported vs parser-safe codegen rules.
- AGENTS defines `src/server/*` exception boundaries.

## Tests

```bash
git diff --check
```

No build required unless repo policy requires it.

## Rollback

Revert docs-only PR.

## Hermes prompt

See `docs/prompts/PR-01.prompt.md`.
