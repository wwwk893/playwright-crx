/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import type { BusinessFlow, FlowRepeatSegment } from './types';
import { cloneRecorderState, withRecorderState } from './recorderState';
import { appendRecorderActionEvents } from './eventJournal';
import { nextStableActionId, nextStableStepId, recomputeOrders } from './stableIds';

export function migrateFlowToStableStepModel(flow: BusinessFlow): BusinessFlow {
  const recorder = cloneRecorderState(flow);
  const usedStepIds = new Set<string>();
  const stepIdMap = new Map<string, string>();
  const legacyStepActionIndexes = flow.artifacts?.stepActionIndexes ?? {};
  const legacyStepMergedActionIndexes = flow.artifacts?.stepMergedActionIndexes ?? {};

  const steps = flow.steps.map(step => {
    let id = step.id;
    if (!id || usedStepIds.has(id))
      id = nextStableStepId(recorder);
    usedStepIds.add(id);
    if (step.id && step.id !== id)
      stepIdMap.set(step.id, id);

    let sourceActionIds = step.sourceActionIds?.filter(Boolean);
    if (!sourceActionIds?.length) {
      const legacyIndexes = legacyStepMergedActionIndexes[step.id] ?? legacyIndexArray(legacyStepActionIndexes[step.id]);
      sourceActionIds = legacyIndexes.map(index => {
        const actionId = nextStableActionId(recorder);
        recorder.actionLog.push({
          id: actionId,
          sessionId: 'legacy',
          sessionIndex: index,
          recorderIndex: index,
          signature: legacySignature(step.rawAction, index),
          rawAction: step.rawAction,
          sourceCode: step.sourceCode,
          createdAt: flow.createdAt,
        });
        return actionId;
      });
    }

    return {
      ...step,
      id,
      kind: step.kind ?? (sourceActionIds.length ? 'recorded' : 'manual'),
      sourceActionIds,
    };
  });

  const migrated: BusinessFlow = {
    ...flow,
    artifacts: stripDeprecatedLegacyArtifacts(flow.artifacts),
    steps: recomputeOrders(steps),
    repeatSegments: migrateRepeatSegments(flow.repeatSegments, stepIdMap),
  };
  appendRecorderActionEvents(recorder, recorder.actionLog);
  return withRecorderState(migrated, recorder);
}

export function stripDeprecatedLegacyArtifacts(artifacts: BusinessFlow['artifacts']): BusinessFlow['artifacts'] {
  if (!artifacts)
    return artifacts;
  const cleaned = { ...artifacts };
  delete cleaned.deletedActionIndexes;
  delete cleaned.deletedActionSignatures;
  delete cleaned.stepActionIndexes;
  delete cleaned.stepMergedActionIndexes;
  return cleaned;
}

function migrateRepeatSegments(segments: FlowRepeatSegment[] | undefined, stepIdMap: Map<string, string>): FlowRepeatSegment[] {
  if (!segments?.length)
    return segments ?? [];
  return segments.map(segment => ({
    ...segment,
    stepIds: unique(segment.stepIds.map(stepId => stepIdMap.get(stepId) ?? stepId)),
    parameters: segment.parameters.map(parameter => ({
      ...parameter,
      sourceStepId: stepIdMap.get(parameter.sourceStepId) ?? parameter.sourceStepId,
    })),
  }));
}

function legacyIndexArray(index: number | undefined) {
  return typeof index === 'number' && Number.isFinite(index) ? [index] : [];
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function legacySignature(rawAction: unknown, index: number) {
  try {
    return JSON.stringify(rawAction) || `legacy-${index}`;
  } catch {
    return `legacy-${index}`;
  }
}
