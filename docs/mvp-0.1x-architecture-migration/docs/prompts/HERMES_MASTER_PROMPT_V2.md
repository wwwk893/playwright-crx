# HERMES_MASTER_PROMPT_V2

You are working inside the `wwwk893/playwright-crx` repository.

Before implementing any PR, read:

```text
AGENTS.md
ROADMAP.md
docs/mvp-0.1x-architecture-migration/README.md
docs/mvp-0.1x-architecture-migration/TARGET_ARCHITECTURE.md
docs/mvp-0.1x-architecture-migration/FINAL_FILE_TREE.md
docs/mvp-0.1x-architecture-migration/PR_TO_FILE_MAP.md
docs/mvp-0.1x-architecture-migration/ARCHITECTURE_CONTRACT.md
```

Critical rule:

Do not treat PR docs as vague guidance. Treat `FINAL_FILE_TREE.md` and `PR_TO_FILE_MAP.md` as the migration contract.

For each PR:

1. Only implement that PR.
2. Only create/modify files allowed by `PR_TO_FILE_MAP.md`, unless you explain why a small additional file is necessary.
3. Preserve public façade functions until PR-12.
4. Do not move business semantics into `src/server/*`.
5. Do not let `flowBuilder.ts` or `codePreview.ts` grow more heuristics.
6. Add tests before or alongside implementation.
7. Run the commands required by that PR.
8. End with: Summary, Changed files, Architecture movement, How to test, Acceptance checklist, Risks/rollback, Next PR handoff.

Never auto-commit unless explicitly asked.
