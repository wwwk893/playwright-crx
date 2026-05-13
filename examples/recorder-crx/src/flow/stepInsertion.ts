/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import { emitMergeDiagnostic } from './mergeTypes';
import type { MergeActionsOptions } from './mergeTypes';
import { asRecord } from './recorderActionModel';
import { recomputeOrders } from './stableIds';
import type { StepDraft } from './stepDrafts';
import { isTypingPress, mergeAssertions, mergeFillStep, mergeSourceActions, sameEditableTarget, shouldMergeTyping } from './stepDrafts';
import { isSyntheticClickStep, moveEarlierTimedStepsBeforeLaterSyntheticClicks, upgradeSyntheticStepsCoveredByRecordedDrafts } from './syntheticReconciler';
import type { BusinessFlow, FlowStep } from './types';

export function insertProjectedSteps(flow: BusinessFlow, drafts: StepDraft[], afterStepId?: string, options?: MergeActionsOptions): BusinessFlow {
  const reconciled = upgradeSyntheticStepsCoveredByRecordedDrafts(flow.steps, drafts);
  const steps = reconciled.steps;
  drafts = reconciled.remainingDrafts;
  if (reconciled.upgradedStepIds.length) {
    emitMergeDiagnostic(options ?? {}, 'merge.synthetic-upgrade', '迟到 recorder action 已原地升级页面侧补录步骤', {
      upgradedStepIds: reconciled.upgradedStepIds,
      recordedActionIds: reconciled.upgradedActionIds,
    });
  }
  if (!afterStepId && shouldPlaceRecordedBatchAroundSyntheticSteps(steps, drafts)) {
    const insertAt = projectedDraftInsertionIndex(steps, insertionAnchorDraft(drafts));
    return insertProjectedDraftBatch(flow, steps, drafts, insertAt);
  }

  const insertAt = afterStepId ? Math.max(0, steps.findIndex(step => step.id === afterStepId) + 1) : steps.length;
  return insertProjectedDraftBatch(flow, steps, drafts, insertAt);
}

export function stepWallTime(step: FlowStep) {
  const raw = asRecord(step.rawAction);
  if (typeof raw.wallTime === 'number')
    return raw.wallTime;
  if (typeof raw.endWallTime === 'number')
    return raw.endWallTime;
  if (typeof step.context?.capturedAt === 'number')
    return step.context.capturedAt;
  return undefined;
}

function shouldPlaceRecordedBatchAroundSyntheticSteps(steps: FlowStep[], drafts: StepDraft[]) {
  if (!drafts.length || !drafts.some(draft => typeof draftWallTime(draft) === 'number'))
    return false;
  return steps.some(step => isSyntheticClickStep(step) && typeof stepWallTime(step) === 'number');
}

function insertionAnchorDraft(drafts: StepDraft[]) {
  return drafts.find(draft => typeof draftWallTime(draft) === 'number') || drafts[0];
}

function insertProjectedDraftBatch(flow: BusinessFlow, steps: FlowStep[], drafts: StepDraft[], insertAt: number): BusinessFlow {
  while (drafts.length) {
    const previous = steps[insertAt - 1];
    const [firstDraft] = drafts;
    if (previous && firstDraft && shouldMergeTyping(previous, firstDraft.step)) {
      steps[insertAt - 1] = mergeFillStep(previous, firstDraft.step);
      drafts = drafts.slice(1);
      continue;
    }
    if (previous && firstDraft?.step.action === 'press' && isTypingPress(firstDraft.step) && sameEditableTarget(previous, firstDraft.step)) {
      steps[insertAt - 1] = mergeSourceActions(previous, firstDraft.step);
      drafts = drafts.slice(1);
      continue;
    }
    if (previous && firstDraft?.step.action === 'assert' && firstDraft.step.assertions.some(assertion => assertion.enabled)) {
      steps[insertAt - 1] = {
        ...mergeSourceActions(previous, firstDraft.step),
        assertions: mergeAssertions(previous.assertions, firstDraft.step.assertions),
      };
      drafts = drafts.slice(1);
      continue;
    }
    break;
  }
  steps.splice(insertAt, 0, ...drafts.map(draft => draft.step));
  return {
    ...flow,
    steps: recomputeOrders(moveEarlierTimedStepsBeforeLaterSyntheticClicks(steps)),
  };
}

function projectedDraftInsertionIndex(steps: FlowStep[], draft: StepDraft) {
  const wallTime = draftWallTime(draft);
  if (typeof wallTime !== 'number')
    return steps.length;
  const firstLaterStepIndex = steps.findIndex(step => {
    const existingWallTime = stepWallTime(step);
    return typeof existingWallTime === 'number' && existingWallTime > wallTime;
  });
  return firstLaterStepIndex >= 0 ? firstLaterStepIndex : steps.length;
}

function draftWallTime(draft: StepDraft) {
  return draft.entries.map(entry => entry.wallTime).find((value): value is number => typeof value === 'number');
}
