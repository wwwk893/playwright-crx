/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import { projectBusinessFlow } from './businessFlowProjection';
import { appendRecorderActionEvents } from './eventJournal';
import { createEmptyBusinessFlow } from './types';
import type { BusinessFlow } from './types';
import { migrateFlowToStableStepModel } from './flowMigration';
import { emitMergeDiagnostic, type MergeActionsOptions } from './mergeTypes';
import { recorderActionSummary, createRecordingSession, extractNewActionEntries, refreshExistingActionEntries } from './recordedActionEntries';
import { cloneRecorderState, withRecorderState } from './recorderState';
import { insertProjectedSteps } from './stepInsertion';
import { buildStepDraftsFromEntries, nextAssertionIndex } from './stepDrafts';

export function mergeRecorderActionsIntoFlow(prev: BusinessFlow | undefined, actions: unknown[], sources: unknown[], options: MergeActionsOptions = {}): BusinessFlow {
  const base = migrateFlowToStableStepModel(prev ?? createEmptyBusinessFlow());
  const recorder = cloneRecorderState(base);
  const canRefreshExistingEntries = options.insertBaseActionCount === undefined || actions.length >= options.insertBaseActionCount;
  emitMergeDiagnostic(options, 'merge.begin', '收到 recorder actions，开始合并业务步骤', {
    actionCount: actions.length,
    sourceCount: sources.length,
    stepCount: base.steps.length,
    recorderActionLogCount: recorder.actionLog.length,
    insertBaseActionCount: options.insertBaseActionCount,
    insertAfterStepId: options.insertAfterStepId,
    appendNewActions: options.appendNewActions,
    canRefreshExistingEntries,
  });
  if (!canRefreshExistingEntries) {
    emitMergeDiagnostic(options, 'merge.skip-refresh', '本次 payload 短于继续录制边界，跳过旧 action 刷新以避免污染已有步骤', {
      actionCount: actions.length,
      insertBaseActionCount: options.insertBaseActionCount,
    });
  }
  const refreshed = canRefreshExistingEntries ? refreshExistingActionEntries(base, recorder, actions, sources, options) : { flow: base, changed: false };
  const session = createRecordingSession(actions, options);
  const entries = extractNewActionEntries(recorder, actions, sources, session, options);
  if (!entries.length) {
    emitMergeDiagnostic(options, 'merge.no-new-actions', '没有生成新的业务步骤', {
      refreshedExistingSteps: refreshed.changed,
      actionCount: actions.length,
      stepCount: refreshed.flow.steps.length,
      recorderActionLogCount: recorder.actionLog.length,
    });
    return projectBusinessFlow(withRecorderState(refreshed.changed ? {
      ...refreshed.flow,
      updatedAt: new Date().toISOString(),
    } : refreshed.flow, recorder), { commitOpen: true });
  }

  const assertionIndex = { value: nextAssertionIndex(refreshed.flow) };
  const drafts = buildStepDraftsFromEntries(recorder, entries, assertionIndex);
  emitMergeDiagnostic(options, 'merge.project', '新 recorder action 已投影为业务步骤草稿', {
    entryCount: entries.length,
    draftCount: drafts.length,
    actions: entries.map(entry => recorderActionSummary(entry.rawAction)),
    stepIds: drafts.map(draft => draft.step.id),
  });

  recorder.actionLog.push(...entries);
  recorder.sessions.push({ ...session, committedAt: new Date().toISOString() });
  appendRecorderActionEvents(recorder, entries);

  const next = insertProjectedSteps(refreshed.flow, drafts, options.insertAfterStepId, options);
  emitMergeDiagnostic(options, 'merge.commit', '业务步骤合并完成', {
    beforeStepCount: refreshed.flow.steps.length,
    afterStepCount: next.steps.length,
    insertedStepIds: next.steps.filter(step => !refreshed.flow.steps.some(previous => previous.id === step.id)).map(step => step.id),
    recorderActionLogCount: recorder.actionLog.length,
  });
  return projectBusinessFlow(withRecorderState({
    ...next,
    updatedAt: new Date().toISOString(),
  }, recorder), { commitOpen: true });
}
