# Legacy Field Migration

## Fields to preserve during migration

- `steps[].id`
- `steps[].order`
- `steps[].intent/comment/assertions`
- `repeatSegments[].stepIds`
- `artifacts.recorder.actionLog`

## Fields to deprecate gradually

```text
artifacts.stepActionIndexes
artifacts.stepMergedActionIndexes
artifacts.deletedActionIndexes
negative virtual action indexes
sourceCode as identity
rawAction.selector as primary business target
```

## Migration rules

- Do not delete legacy fields until PR-12.
- New behavior should not depend on legacy fields.
- Export sanitizer should strip internal recorder fields.
- Legacy flow import must still produce valid projection.

## Tests

```text
legacy flow with old artifacts imports
legacy flow exports sanitized JSON
legacy repeat segment stepIds remain valid
```
