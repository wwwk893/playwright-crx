/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import { extractTargetFromRecorderAction } from '../capture/targetFromRecorderSelector';
import { emitMergeDiagnostic, type MergeActionsOptions } from './mergeTypes';
import {
  asRecord,
  extractRecorderActionValue,
  isNavigationRecorderAction,
  normalizeRecorderAction,
  recorderActionSignature,
  readString,
  type ActionInContextLike,
} from './recorderActionModel';
import { nextStableActionId } from './stableIds';
import { recordedSourceActions, sourceCodeForRecordedAction } from './sourceCodeForRecorderAction';
import { refreshStepFromEntry } from './stepDrafts';
import type { BusinessFlow, FlowRecorderState, RecordedActionEntry, RecordingSession } from './types';

type RefreshResult = {
  flow: BusinessFlow;
  changed: boolean;
};

export type ExtractRecordedActionEntriesOptions = Pick<MergeActionsOptions,
  'insertBaseActionCount' | 'appendNewActions' | 'insertAfterStepId' | 'recordingSessionId' | 'diagnostics'
>;

export function createRecordingSession(actions: unknown[], options: MergeActionsOptions): RecordingSession {
  const now = new Date().toISOString();
  return {
    id: options.recordingSessionId ?? `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    mode: options.insertAfterStepId ? 'insert-after' : options.appendNewActions ? 'append' : 'initial',
    baseActionCount: options.insertBaseActionCount ?? actions.length,
    insertAfterStepId: options.insertAfterStepId,
    startedAt: now,
  };
}

export function extractNewActionEntries(recorder: FlowRecorderState, actions: unknown[], sources: unknown[], session: RecordingSession, options: ExtractRecordedActionEntriesOptions): RecordedActionEntry[] {
  const sourceActions = recordedSourceActions(sources);
  const start = newActionStartIndex(recorder, actions, options);
  const slicedActions = actions.slice(start);
  const navigationFilteredActions = filterIncidentalContinuationNavigations(slicedActions, start, options);
  const incomingActions = navigationFilteredActions.filter(({ rawAction }) => !isIncidentalStructuralContainerAction(rawAction));
  emitMergeDiagnostic(options, 'merge.extract', '已计算本次新增 action 范围', {
    start,
    incomingRawCount: slicedActions.length,
    incomingKeptCount: incomingActions.length,
    filteredCount: slicedActions.length - incomingActions.length,
    structuralContainerFilteredCount: navigationFilteredActions.length - incomingActions.length,
    sourceActionCount: sourceActions.length,
    rawActions: slicedActions.map(recorderActionSummary),
    keptActions: incomingActions.map(({ rawAction }) => recorderActionSummary(rawAction)),
  });
  return incomingActions.map(({ rawAction, recorderIndex }, offset) => {
    const actionInContext = asRecord(rawAction) as ActionInContextLike;
    const action = normalizeRecorderAction(actionInContext);
    return {
      id: nextStableActionId(recorder),
      sessionId: session.id,
      sessionIndex: offset,
      recorderIndex,
      signature: recorderActionSignature(rawAction) || `${session.id}:${offset}`,
      rawAction,
      sourceCode: sourceCodeForRecordedAction(sourceActions[recorderIndex], action),
      wallTime: typeof actionInContext.wallTime === 'number' ? actionInContext.wallTime : undefined,
      endWallTime: typeof actionInContext.endWallTime === 'number' ? actionInContext.endWallTime : undefined,
      createdAt: new Date().toISOString(),
    };
  });
}

export function refreshExistingActionEntries(flow: BusinessFlow, recorder: FlowRecorderState, actions: unknown[], sources: unknown[], options: ExtractRecordedActionEntriesOptions): RefreshResult {
  if (!recorder.actionLog.length || !actions.length)
    return { flow, changed: false };

  const sourceActions = recordedSourceActions(sources);
  const changedActionIds = new Set<string>();
  for (const entry of recorder.actionLog) {
    if (options.recordingSessionId && entry.sessionId !== options.recordingSessionId)
      continue;
    if (entry.recorderIndex < 0 || entry.recorderIndex >= actions.length)
      continue;
    const rawAction = actions[entry.recorderIndex];
    const action = normalizeRecorderAction(asRecord(rawAction) as ActionInContextLike);
    const nextSignature = recorderActionSignature(rawAction) || entry.signature;
    const nextSourceCode = sourceCodeForRecordedAction(sourceActions[entry.recorderIndex], action);
    if (entry.signature === nextSignature && entry.sourceCode === nextSourceCode)
      continue;

    const actionInContext = asRecord(rawAction) as ActionInContextLike;
    entry.signature = nextSignature;
    entry.rawAction = rawAction;
    entry.sourceCode = nextSourceCode;
    entry.wallTime = typeof actionInContext.wallTime === 'number' ? actionInContext.wallTime : entry.wallTime;
    entry.endWallTime = typeof actionInContext.endWallTime === 'number' ? actionInContext.endWallTime : entry.endWallTime;
    changedActionIds.add(entry.id);
  }

  if (!changedActionIds.size)
    return { flow, changed: false };

  const entriesById = new Map(recorder.actionLog.map(entry => [entry.id, entry]));
  return {
    flow: {
      ...flow,
      steps: flow.steps.map(step => {
        const changedEntryId = step.sourceActionIds?.find(actionId => changedActionIds.has(actionId));
        if (!changedEntryId)
          return step;
        const changedEntry = entriesById.get(changedEntryId);
        if (!changedEntry)
          return step;
        return refreshStepFromEntry(step, changedEntry, entriesById);
      }),
    },
    changed: true,
  };
}

export function recorderActionSummary(rawAction: unknown) {
  const action = normalizeRecorderAction(asRecord(rawAction) as ActionInContextLike);
  const target = extractTargetFromRecorderAction(action);
  return [
    action.name || 'unknown',
    target?.testId || target?.name || target?.label || target?.text || action.url,
    extractRecorderActionValue(action),
  ].filter(Boolean).join(' · ');
}

function newActionStartIndex(recorder: FlowRecorderState, actions: unknown[], options: ExtractRecordedActionEntriesOptions) {
  if (options.insertBaseActionCount !== undefined) {
    if (actions.length >= options.insertBaseActionCount)
      return options.insertBaseActionCount;
    return stalePrefixEndIndex(recorder, actions);
  }
  return Math.min(recorder.actionLog.length, actions.length);
}

function stalePrefixEndIndex(recorder: FlowRecorderState, actions: unknown[]) {
  const knownSignatures = new Set(recorder.actionLog.map(entry => entry.signature).filter(Boolean));
  let index = 0;
  while (index < actions.length) {
    const action = normalizeRecorderAction(asRecord(actions[index]) as ActionInContextLike);
    const signature = recorderActionSignature(actions[index]);
    if ((signature && knownSignatures.has(signature)) || isNavigationRecorderAction(action)) {
      index += 1;
      continue;
    }
    break;
  }
  return index;
}

function filterIncidentalContinuationNavigations(actions: unknown[], start: number, options: ExtractRecordedActionEntriesOptions) {
  const indexedActions = actions.map((rawAction, offset) => ({ rawAction, recorderIndex: start + offset }));
  if (!options.appendNewActions && !options.insertAfterStepId)
    return indexedActions;
  if (indexedActions.length <= 1)
    return indexedActions;
  return indexedActions.filter(({ rawAction }) => !isNavigationRecorderAction(normalizeRecorderAction(asRecord(rawAction) as ActionInContextLike)));
}

function isIncidentalStructuralContainerAction(rawAction: unknown) {
  const action = normalizeRecorderAction(asRecord(rawAction) as ActionInContextLike);
  if (action.name !== 'click')
    return false;
  const target = extractTargetFromRecorderAction(action);
  const testId = target?.testId || '';
  const selector = readString(action.selector) || '';
  const looksStructural = looksLikeStructuralContainerTestId(testId) ||
    /(^|[ >.])(section|article|main|aside|header|footer)(?=$|[ >.#:[\]])/i.test(selector) ||
    /\.(ant-pro-card|ant-card|ant-collapse-item|card|section|container|wrapper)(?=$|[\s.#:[\]])/i.test(selector) ||
    /\[role=(?:"region"|'region'|region)\]/i.test(selector);
  if (!looksStructural || looksLikeActionTestId(testId))
    return false;
  const role = target?.role || '';
  if (/^(button|link|checkbox|radio|switch|combobox|option|menuitem|tab)$/i.test(role))
    return false;
  return !(target?.name || target?.label || target?.text || target?.placeholder);
}

function looksLikeStructuralContainerTestId(testId: string) {
  return /(^|[-_])(section|container|card|wrapper|content|region)([-_]|$)/i.test(testId);
}

function looksLikeActionTestId(testId: string) {
  return /(^|[-_])(button|btn|link|tab|switch|checkbox|radio|select|input|create|add|new|save|delete|remove|edit|confirm|cancel|submit|ok|option|menu)([-_]|$)/i.test(testId);
}
