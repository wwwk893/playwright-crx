# PR-12: Cleanup and Deprecation

## Goal

After migration is green, remove obsolete ad hoc patches and freeze the new architecture.

## Scope

- Remove unused legacy merge helpers.
- Mark old fields as deprecated or migrate them.
- Update docs and schemas.
- Ensure all public APIs still work.

## Files

Likely:

```text
examples/recorder-crx/src/flow/flowBuilder.ts
examples/recorder-crx/src/flow/codePreview.ts
examples/recorder-crx/src/flow/types.ts
examples/recorder-crx/src/flow/flowMigration.ts
docs/schemas/business-flow.schema.md
AGENTS.md
```

## Migration

Legacy fields that should no longer drive behavior:

```text
artifacts.stepActionIndexes
artifacts.stepMergedActionIndexes
artifacts.deletedActionIndexes
negative virtual action indexes
sourceCode as identity
rawAction.selector as primary business target
```

## Tests

```text
- legacy flow imports still work
- old exported flow can be sanitized
- no compact YAML raw internals
- generated replay still works
- legacy player tests green
```

Commands:

```bash
git diff --check
npm run test:flow --prefix examples/recorder-crx
npm run build:crx
npm run build:examples:recorder
npm run build:tests
cd tests
xvfb-run -a npx playwright test crx/player.spec.ts crx/player-asserts.spec.ts crx/businessFlowRecorder.spec.ts crx/humanLikeRecorder.spec.ts \
  --config=playwright.config.ts --project=Chrome --workers=1 --reporter=line
```

## Rollback

Keep deprecation as no-op first; remove legacy only after CI stable.
