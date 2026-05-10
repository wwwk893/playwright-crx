/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import type { BusinessFlow, FlowRecorderState, RecordedActionEntry } from './types';
import { appendRecorderActionEvents, cloneEventJournal, ensureEventJournal } from './eventJournal';
import { maxActionSeq, maxStepSeq } from './stableIds';

export function cloneRecorderState(flow: BusinessFlow): FlowRecorderState {
  const legacy = flow.artifacts?.recorder as Partial<FlowRecorderState> | undefined;
  const recorder: FlowRecorderState = legacy?.actionLog ? {
    version: 3,
    actionLog: [...legacy.actionLog],
    eventJournal: cloneEventJournal(legacy.eventJournal),
    nextActionSeq: legacy.nextActionSeq ?? 1,
    nextStepSeq: legacy.nextStepSeq ?? 1,
    sessions: [...(legacy.sessions ?? [])],
  } : {
    version: 3,
    actionLog: legacyActionLog(flow),
    nextActionSeq: 1,
    nextStepSeq: 1,
    sessions: [],
  };

  recorder.nextActionSeq = Math.max(recorder.nextActionSeq || 1, maxActionSeq(recorder) + 1);
  recorder.nextStepSeq = Math.max(recorder.nextStepSeq || 1, maxStepSeq(flow) + 1);
  ensureEventJournal(recorder);
  appendRecorderActionEvents(recorder, recorder.actionLog);
  return recorder;
}

export function withRecorderState(flow: BusinessFlow, recorder: FlowRecorderState): BusinessFlow {
  return {
    ...flow,
    artifacts: {
      ...flow.artifacts,
      recorder,
    },
  };
}

function legacyActionLog(flow: BusinessFlow): RecordedActionEntry[] {
  const entries: RecordedActionEntry[] = [];
  const seen = new Set<string>();
  for (const step of flow.steps) {
    const actionIds = step.sourceActionIds ?? [];
    for (const actionId of actionIds) {
      if (seen.has(actionId))
        continue;
      seen.add(actionId);
      entries.push({
        id: actionId,
        sessionId: 'legacy',
        sessionIndex: entries.length,
        recorderIndex: entries.length,
        signature: signatureForUnknown(step.rawAction) || actionId,
        rawAction: step.rawAction,
        sourceCode: step.sourceCode,
        createdAt: flow.createdAt,
      });
    }
  }
  return entries;
}

function signatureForUnknown(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}
