# PR-03: Session Finalizer

## Goal

Introduce `finalizeRecordingSession()` and call it before stop/review/export/codegen. This fixes late context/action loss at recording end.

## Why

Stop/export currently can read `flowDraft` before pending recorder actions or page context events settle. This causes missing last Select option, missing final input value, and runtime/export mismatch.

## Files

Add:

```text
examples/recorder-crx/src/flow/sessionFinalizer.ts
```

Modify:

```text
examples/recorder-crx/src/crxRecorder.tsx
examples/recorder-crx/src/flow/flowBuilder.ts
examples/recorder-crx/src/flow/stepStability.test.ts
```

## API

```ts
export async function finalizeRecordingSession(flow: BusinessFlow, options: {
  reason: 'stop-recording' | 'enter-review' | 'export' | 'generate-code';
  drainRecorderActions?: () => Promise<void>;
  drainPageContextEvents?: () => Promise<void>;
  diagnostics?: (event: FinalizeDiagnosticEvent) => void;
}): Promise<BusinessFlow>
```

Phase 1 can be mostly synchronous if queue draining is already handled in `crxRecorder.tsx`; the API shape should support async.

## Implementation steps

1. Add finalizer façade with diagnostics.
2. In `crxRecorder.tsx`, route these paths through finalizer:
   - stop recording
   - enter review
   - export JSON/YAML
   - generate preview/replay code if triggered after recording
3. Add stable queue drain hooks if available; otherwise add a bounded stabilization wait:

```text
stableForMs=250
maxWaitMs=1200
```

This is not a blind sleep; it waits for pending counts to stop changing.

4. Finalizer currently only reconciles late synthetic/recorded via existing flowBuilder functions. Input/select finalization comes in PR-04/05.

## Acceptance

- Finalizer called before export and review.
- Diagnostics log includes reason, pending counts, elapsed time.
- Existing behavior should mostly remain.

## Tests

Add:

```text
- finalizeRecordingSession is called before export
- late page context event can be merged before review
- export uses finalized flow, not stale draft
```

Targeted E2E:

```bash
cd tests
xvfb-run -a npx playwright test crx/humanLikeRecorder.spec.ts \
  --config=playwright.config.ts --project=Chrome \
  -g "wait inserted|Select|human-like" --workers=1 --reporter=line
```

## Rollback

Keep finalizer file but temporarily make it return input flow unchanged; remove call sites if necessary.
