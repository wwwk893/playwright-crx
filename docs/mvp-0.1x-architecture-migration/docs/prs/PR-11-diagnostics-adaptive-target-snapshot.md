# PR-11: Diagnostics and Adaptive Target Snapshot

## Goal

Add fail-closed adaptive target diagnostics. Do not implement auto-healing yet.

## Files

Add:

```text
examples/recorder-crx/src/flow/adaptiveTargetTypes.ts
examples/recorder-crx/src/flow/adaptiveTargetSnapshot.ts
examples/recorder-crx/src/flow/adaptiveTargetRedactor.ts
examples/recorder-crx/src/flow/locatorCandidates.ts
```

Modify:

```text
examples/recorder-crx/src/flow/types.ts
examples/recorder-crx/src/flow/exportSanitizer.ts
examples/recorder-crx/src/flow/compactExporter.ts
examples/recorder-crx/src/flow/stepStability.test.ts
```

## Rules

- Store snapshots only in internal `artifacts.recorder.adaptiveTargets`.
- Strip from exported JSON/YAML by default.
- Redact before storing, not just before export.
- No auto-click / auto-fill relocation.
- Table row snapshot is first-class.

## Tests

```text
- adaptive target snapshot stores testId/role/label/table row safely
- redaction removes token/password/email/phone-like values
- export sanitizer strips adaptiveTargets
- compact YAML does not contain snapshot/candidates
- candidates rank testId > table row > role > label > text > CSS
```

Run:

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build:examples:recorder
```

## Rollback

Remove diagnostics display; internal state can be ignored.
