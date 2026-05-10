# Event Journal Design

## Purpose

Event Journal 是事实层，不是业务步骤层。它统一保存 Playwright recorder actions、pageContext events、semantic adapter events、user edits、network summaries。

## New files

```text
examples/recorder-crx/src/capture/eventEnvelope.ts
examples/recorder-crx/src/capture/recorderActionNormalizer.ts
examples/recorder-crx/src/flow/eventJournal.ts
```

## Types

```ts
export type RecorderEventSource =
  | 'playwright-recorder'
  | 'page-context'
  | 'semantic-adapter'
  | 'user-edit'
  | 'network';

export interface RecorderEventEnvelope<T = unknown> {
  id: string;
  sessionId: string;
  source: RecorderEventSource;
  kind: string;
  createdAt: string;
  timestamp: {
    wallTime: number;
    performanceTime?: number;
    recorderIndex?: number;
  };
  payload: T;
}

export interface RecorderEventJournal {
  version: 1;
  eventsById: Record<string, RecorderEventEnvelope>;
  eventOrder: string[];
  sessions: RecordingSession[];
  highWaterMarks: {
    recorderActionCount: number;
    pageContextEventCount: number;
  };
}
```

## Rules

- append-only；不要删除事实事件。
- Export JSON/YAML 默认 strip journal。
- 用户编辑态不写入 raw event；只作为 user-edit event 或 FlowStep editable fields。
- PageContext events 要经过 redaction/truncation。

## Acceptance

- Existing `artifacts.recorder.actionLog` can be adapted into journal without breaking existing flows.
- `mergeActionsIntoFlow()` public API remains.
- Existing tests pass.
