# PR-02: Event Journal and Recorder State v3

## Goal

Introduce an internal Event Journal while preserving existing behavior. No UI or codegen behavior should change.

## Why

Current `artifacts.recorder.actionLog` is useful but only models Playwright recorder actions. Page context, semantic hints, synthetic evidence, and user edits are not first-class facts. Later PRs need a unified journal.

## Files

Add:

```text
examples/recorder-crx/src/capture/eventEnvelope.ts
examples/recorder-crx/src/capture/recorderActionNormalizer.ts
examples/recorder-crx/src/flow/eventJournal.ts
```

Path decision: raw event envelope and recorder action normalization belong under `capture/`; the flow layer owns the journal/state/projection. Do not create `examples/recorder-crx/src/flow/eventTypes.ts` as the raw event type entry point.

Modify:

```text
examples/recorder-crx/src/flow/types.ts
examples/recorder-crx/src/flow/recorderState.ts
examples/recorder-crx/src/flow/flowMigration.ts
examples/recorder-crx/src/flow/stepStability.test.ts
```

## Data model

```ts
interface FlowRecorderState {
  version: 3;
  actionLog: RecordedActionEntry[];
  eventJournal?: RecorderEventJournal;
  nextActionSeq: number;
  nextStepSeq: number;
  sessions: RecordingSession[];
}
```

Do not remove `actionLog` yet. Journal is additive.

## Implementation steps

1. Add event envelope types under `capture/eventEnvelope.ts`.
2. Add recorder action normalization under `capture/recorderActionNormalizer.ts`.
3. Add helpers:

```ts
ensureEventJournal(recorder)
appendRecorderActionEvents(recorder, entries)
appendPageContextEvents(recorder, events)
eventJournalStats(recorder)
```

4. Update `mergeActionsIntoFlow()` to append recorder action entries to journal in addition to actionLog.
5. Update `appendSyntheticPageContextStepsWithResult()` to append consumed page context event refs to journal if available.
6. Migration: legacy recorder state gets `version: 3` and empty journal.

## Do not

- Do not change FlowStep projection.
- Do not change export code.
- Do not change CrxPlayer.

## Tests

Add:

```text
stepStability.test.ts
- event journal initializes for legacy flows
- mergeActionsIntoFlow appends recorder action events without changing steps
- page context synthetic event can be recorded in journal
- export sanitizer strips event journal by default
```

Commands:

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build:examples:recorder
```

## Rollback

Remove event journal additions; existing actionLog remains source of truth.
