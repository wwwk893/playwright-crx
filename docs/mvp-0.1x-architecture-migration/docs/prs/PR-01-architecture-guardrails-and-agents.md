# PR-01: Architecture Guardrails and AGENTS Update

## Goal

Codify the migration rules before changing behavior. This PR should update repository guidance and add docs only.

## Scope

Modify:

```text
AGENTS.md
docs/mvp-0.1x-architecture-migration/**
```

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
