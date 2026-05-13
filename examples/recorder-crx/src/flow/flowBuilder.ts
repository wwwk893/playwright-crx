/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import { createEmptyEventJournal } from './eventJournal';
import { migrateFlowToStableStepModel, stripDeprecatedLegacyArtifacts } from './flowMigration';
import { suggestWaitIntent } from './intentRules';
import type { MergeActionsOptions } from './mergeTypes';
import { normalizeWaitMilliseconds, renderStableWaitSource } from './recorderActionModel';
import { mergeRecorderActionsIntoFlow } from './recorderActionMerge';
import { cloneRecorderState, withRecorderState } from './recorderState';
import { nextStableStepId, recomputeOrders } from './stableIds';
import { defaultExpected, nextAssertionIndex, subjectForAssertionType } from './stepDrafts';
import type { BusinessFlow, FlowAssertion, FlowAssertionType, FlowRepeatSegment, FlowStep } from './types';
import { flowAssertionId } from './types';

export { appendSyntheticPageContextSteps, appendSyntheticPageContextStepsWithResult } from './syntheticReconciler';
export type { SyntheticAppendOptions, SyntheticAppendResult } from './syntheticReconciler';
export type { MergeActionsOptions, MergeDiagnosticEvent } from './mergeTypes';

export function mergeActionsIntoFlow(prev: BusinessFlow | undefined, actions: unknown[], sources: unknown[], options: MergeActionsOptions = {}): BusinessFlow {
  return mergeRecorderActionsIntoFlow(prev, actions, sources, options);
}

export function deleteStepFromFlow(flow: BusinessFlow, stepId: string): BusinessFlow {
  const base = migrateFlowToStableStepModel(flow);
  const steps = recomputeOrders(base.steps.filter(step => step.id !== stepId));
  return {
    ...base,
    steps,
    repeatSegments: cleanRepeatSegments(base.repeatSegments, new Set([stepId])),
    artifacts: {
      ...base.artifacts,
      deletedStepIds: [...new Set([...(base.artifacts?.deletedStepIds ?? []), stepId])],
    },
    updatedAt: new Date().toISOString(),
  };
}

export function clearFlowRecordingHistory(flow: BusinessFlow): BusinessFlow {
  return {
    ...flow,
    repeatSegments: [],
    network: [],
    artifacts: {
      ...stripDeprecatedLegacyArtifacts(flow.artifacts),
      playwrightCode: undefined,
      deletedStepIds: [],
      recorder: {
        version: 3,
        actionLog: [],
        eventJournal: createEmptyEventJournal(),
        nextActionSeq: 1,
        nextStepSeq: 1,
        sessions: [],
      },
    },
    updatedAt: new Date().toISOString(),
  };
}

export function insertEmptyStepAfter(flow: BusinessFlow, afterStepId: string): BusinessFlow {
  const base = migrateFlowToStableStepModel(flow);
  const recorder = cloneRecorderState(base);
  const step: FlowStep = {
    id: nextStableStepId(recorder),
    order: 0,
    kind: 'manual',
    sourceActionIds: [],
    action: 'unknown',
    intent: '',
    comment: '插入的空步骤',
    assertions: [],
    target: { label: '待补充操作' },
  };
  const insertAt = Math.max(0, base.steps.findIndex(candidate => candidate.id === afterStepId) + 1);
  const steps = [...base.steps];
  steps.splice(insertAt, 0, step);
  return withRecorderState({
    ...base,
    steps: recomputeOrders(steps),
    updatedAt: new Date().toISOString(),
  }, recorder);
}

export function insertWaitStepAfter(flow: BusinessFlow, afterStepId: string, milliseconds: number): BusinessFlow {
  const base = migrateFlowToStableStepModel(flow);
  const recorder = cloneRecorderState(base);
  const waitMilliseconds = normalizeWaitMilliseconds(milliseconds);
  const previousStep = base.steps.find(candidate => candidate.id === afterStepId);
  const suggestion = suggestWaitIntent(previousStep);
  const step: FlowStep = {
    id: nextStableStepId(recorder),
    order: 0,
    kind: 'manual',
    sourceActionIds: [],
    action: 'wait',
    intent: suggestion.text,
    intentSource: 'rule',
    intentSuggestion: suggestion,
    comment: '等待页面状态稳定后继续执行。',
    value: String(waitMilliseconds),
    assertions: [],
    sourceCode: renderStableWaitSource(waitMilliseconds),
  };
  const insertAt = Math.max(0, base.steps.findIndex(candidate => candidate.id === afterStepId) + 1);
  const steps = [...base.steps];
  steps.splice(insertAt, 0, step);
  return withRecorderState({
    ...base,
    steps: recomputeOrders(steps),
    updatedAt: new Date().toISOString(),
  }, recorder);
}

export function normalizeFlowStepIds(flow: BusinessFlow): BusinessFlow {
  return migrateFlowToStableStepModel(flow);
}

export function nextAssertionId(flow: BusinessFlow) {
  return flowAssertionId(nextAssertionIndex(flow));
}

export function createAssertion(type: FlowAssertionType, id: string, step?: FlowStep): FlowAssertion {
  return {
    id,
    type,
    subject: subjectForAssertionType(type),
    target: step?.target,
    expected: defaultExpected(type, step),
    enabled: true,
  };
}

function cleanRepeatSegments(segments: FlowRepeatSegment[] | undefined, deletedStepIds: Set<string>): FlowRepeatSegment[] {
  if (!segments?.length)
    return [];
  return segments
      .map(segment => ({
        ...segment,
        stepIds: segment.stepIds.filter(stepId => !deletedStepIds.has(stepId)),
        parameters: segment.parameters.filter(parameter => !deletedStepIds.has(parameter.sourceStepId)),
        updatedAt: new Date().toISOString(),
      }))
      .filter(segment => segment.stepIds.length > 0);
}
