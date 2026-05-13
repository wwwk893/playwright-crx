/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import type { Source } from '@recorder/recorderTypes';
import { asLocator } from '@isomorphic/locatorGenerators';
import type { BusinessFlow, FlowActionType, FlowAssertion, FlowAssertionSubject, FlowAssertionType, FlowRecorderState, FlowRepeatSegment, FlowStep, FlowTarget, RecordedActionEntry, RecordingSession } from './types';
import { suggestBasicIntent, suggestWaitIntent } from './intentRules';
import { createEmptyBusinessFlow, flowAssertionId } from './types';
import { migrateFlowToStableStepModel, stripDeprecatedLegacyArtifacts } from './flowMigration';
import { cloneRecorderState, withRecorderState } from './recorderState';
import { appendRecorderActionEvents, createEmptyEventJournal } from './eventJournal';
import { projectBusinessFlow } from './businessFlowProjection';
import { nextStableActionId, nextStableStepId, recomputeOrders } from './stableIds';
import { isSyntheticClickStep, moveEarlierTimedStepsBeforeLaterSyntheticClicks, upgradeSyntheticStepsCoveredByRecordedDrafts } from './syntheticReconciler';
export { appendSyntheticPageContextSteps, appendSyntheticPageContextStepsWithResult } from './syntheticReconciler';
export type { SyntheticAppendOptions, SyntheticAppendResult } from './syntheticReconciler';

type ActionLike = {
  name?: string;
  selector?: string;
  url?: string;
  text?: string;
  value?: string;
  timeout?: number;
  key?: string;
  options?: string[];
  files?: string[];
  substring?: boolean;
  checked?: boolean;
  signals?: Array<{ name?: string; url?: string }>;
};

type ActionInContextLike = {
  action?: ActionLike;
  description?: string;
  wallTime?: number;
  endWallTime?: number;
};

export type MergeActionsOptions = {
  insertAfterStepId?: string;
  insertBaseActionCount?: number;
  appendNewActions?: boolean;
  recordingSessionId?: string;
  diagnostics?: (event: MergeDiagnosticEvent) => void;
};

export type MergeDiagnosticEvent = {
  level?: 'info' | 'warn';
  type: string;
  message: string;
  data?: Record<string, unknown>;
};

type StepDraft = {
  step: FlowStep;
  entries: RecordedActionEntry[];
};

type RefreshResult = {
  flow: BusinessFlow;
  changed: boolean;
};

export function mergeActionsIntoFlow(prev: BusinessFlow | undefined, actions: unknown[], sources: unknown[], options: MergeActionsOptions = {}): BusinessFlow {
  const base = migrateFlowToStableStepModel(prev ?? createEmptyBusinessFlow());
  const recorder = cloneRecorderState(base);
  const canRefreshExistingEntries = options.insertBaseActionCount === undefined || actions.length >= options.insertBaseActionCount;
  emitDiagnostic(options, 'merge.begin', '收到 recorder actions，开始合并业务步骤', {
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
    emitDiagnostic(options, 'merge.skip-refresh', '本次 payload 短于继续录制边界，跳过旧 action 刷新以避免污染已有步骤', {
      actionCount: actions.length,
      insertBaseActionCount: options.insertBaseActionCount,
    });
  }
  const refreshed = canRefreshExistingEntries ? refreshExistingActionEntries(base, recorder, actions, sources, options) : { flow: base, changed: false };
  const session = createRecordingSession(actions, options);
  const entries = extractNewActionEntries(recorder, actions, sources, session, options);
  if (!entries.length) {
    emitDiagnostic(options, 'merge.no-new-actions', '没有生成新的业务步骤', {
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
  const drafts = compactStepDrafts(entries.map(entry => ({
    step: buildStepFromEntry(recorder, entry, assertionIndex),
    entries: [entry],
  })));
  emitDiagnostic(options, 'merge.project', '新 recorder action 已投影为业务步骤草稿', {
    entryCount: entries.length,
    draftCount: drafts.length,
    actions: entries.map(entry => actionSummary(entry.rawAction)),
    stepIds: drafts.map(draft => draft.step.id),
  });

  recorder.actionLog.push(...entries);
  recorder.sessions.push({ ...session, committedAt: new Date().toISOString() });
  appendRecorderActionEvents(recorder, entries);

  const next = insertProjectedSteps(refreshed.flow, drafts, options.insertAfterStepId, options);
  emitDiagnostic(options, 'merge.commit', '业务步骤合并完成', {
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

function stepWallTime(step: FlowStep) {
  const raw = asRecord(step.rawAction);
  if (typeof raw.wallTime === 'number')
    return raw.wallTime;
  if (typeof raw.endWallTime === 'number')
    return raw.endWallTime;
  if (typeof step.context?.capturedAt === 'number')
    return step.context.capturedAt;
  return undefined;
}

function createRecordingSession(actions: unknown[], options: MergeActionsOptions): RecordingSession {
  const now = new Date().toISOString();
  return {
    id: options.recordingSessionId ?? `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    mode: options.insertAfterStepId ? 'insert-after' : options.appendNewActions ? 'append' : 'initial',
    baseActionCount: options.insertBaseActionCount ?? actions.length,
    insertAfterStepId: options.insertAfterStepId,
    startedAt: now,
  };
}

function extractNewActionEntries(recorder: FlowRecorderState, actions: unknown[], sources: unknown[], session: RecordingSession, options: MergeActionsOptions): RecordedActionEntry[] {
  const sourceActions = recordedSourceActions(sources);
  const start = newActionStartIndex(recorder, actions, options);
  const slicedActions = actions.slice(start);
  const navigationFilteredActions = filterIncidentalContinuationNavigations(slicedActions, start, options);
  const incomingActions = navigationFilteredActions.filter(({ rawAction }) => !isIncidentalStructuralContainerAction(rawAction));
  emitDiagnostic(options, 'merge.extract', '已计算本次新增 action 范围', {
    start,
    incomingRawCount: slicedActions.length,
    incomingKeptCount: incomingActions.length,
    filteredCount: slicedActions.length - incomingActions.length,
    structuralContainerFilteredCount: navigationFilteredActions.length - incomingActions.length,
    sourceActionCount: sourceActions.length,
    rawActions: slicedActions.map(actionSummary),
    keptActions: incomingActions.map(({ rawAction }) => actionSummary(rawAction)),
  });
  return incomingActions.map(({ rawAction, recorderIndex }, offset) => {
    const actionInContext = asRecord(rawAction) as ActionInContextLike;
    const action = normalizeAction(actionInContext);
    return {
      id: nextStableActionId(recorder),
      sessionId: session.id,
      sessionIndex: offset,
      recorderIndex,
      signature: actionSignature(rawAction) || `${session.id}:${offset}`,
      rawAction,
      sourceCode: sourceCodeForRecordedAction(sourceActions[recorderIndex], action),
      wallTime: typeof actionInContext.wallTime === 'number' ? actionInContext.wallTime : undefined,
      endWallTime: typeof actionInContext.endWallTime === 'number' ? actionInContext.endWallTime : undefined,
      createdAt: new Date().toISOString(),
    };
  });
}

function refreshExistingActionEntries(flow: BusinessFlow, recorder: FlowRecorderState, actions: unknown[], sources: unknown[], options: MergeActionsOptions): RefreshResult {
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
    const action = normalizeAction(asRecord(rawAction) as ActionInContextLike);
    const nextSignature = actionSignature(rawAction) || entry.signature;
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

function refreshStepFromEntry(step: FlowStep, entry: RecordedActionEntry, entriesById: Map<string, RecordedActionEntry>): FlowStep {
  const action = normalizeAction(asRecord(entry.rawAction) as ActionInContextLike);
  const target = extractTarget(action) ?? step.target;
  const url = extractUrl(action) ?? step.url;
  const value = extractValue(action);
  const actionType = mapActionType(action.name);
  return {
    ...step,
    action: actionType,
    target,
    value,
    url,
    assertions: refreshAssertionsForStep(step.assertions, step.value, value, target),
    rawAction: entry.rawAction,
    sourceCode: sourceCodeForStep(step, entriesById),
  };
}

function sourceCodeForStep(step: FlowStep, entriesById: Map<string, RecordedActionEntry>) {
  return step.sourceActionIds
      ?.map(actionId => entriesById.get(actionId)?.sourceCode)
      .filter(Boolean)
      .join('\n') || undefined;
}

function newActionStartIndex(recorder: FlowRecorderState, actions: unknown[], options: MergeActionsOptions) {
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
    const action = normalizeAction(asRecord(actions[index]) as ActionInContextLike);
    const signature = actionSignature(actions[index]);
    if ((signature && knownSignatures.has(signature)) || isNavigationAction(action)) {
      index += 1;
      continue;
    }
    break;
  }
  return index;
}

function filterIncidentalContinuationNavigations(actions: unknown[], start: number, options: MergeActionsOptions) {
  const indexedActions = actions.map((rawAction, offset) => ({ rawAction, recorderIndex: start + offset }));
  if (!options.appendNewActions && !options.insertAfterStepId)
    return indexedActions;
  if (indexedActions.length <= 1)
    return indexedActions;
  return indexedActions.filter(({ rawAction }) => !isNavigationAction(normalizeAction(asRecord(rawAction) as ActionInContextLike)));
}

function isIncidentalStructuralContainerAction(rawAction: unknown) {
  const action = normalizeAction(asRecord(rawAction) as ActionInContextLike);
  if (action.name !== 'click')
    return false;
  const target = extractTarget(action);
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

function emitDiagnostic(options: MergeActionsOptions, type: string, message: string, data?: Record<string, unknown>, level: MergeDiagnosticEvent['level'] = 'info') {
  options.diagnostics?.({ type, message, data, level });
}

function actionSummary(rawAction: unknown) {
  const action = normalizeAction(asRecord(rawAction) as ActionInContextLike);
  return [
    action.name || 'unknown',
    extractTarget(action)?.testId || extractTarget(action)?.name || extractTarget(action)?.label || extractTarget(action)?.text || action.url,
    extractValue(action),
  ].filter(Boolean).join(' · ');
}

function buildStepFromEntry(recorder: FlowRecorderState, entry: RecordedActionEntry, assertionIndex: { value: number }): FlowStep {
  const actionInContext = asRecord(entry.rawAction) as ActionInContextLike;
  const action = normalizeAction(actionInContext);
  const target = extractTarget(action);
  const url = extractUrl(action);
  const value = extractValue(action);
  const assertions = defaultAssertions(action, assertionIndex.value, target, url, value);
  assertionIndex.value += Math.max(assertions.length, 1);
  return withBasicIntent({
    id: nextStableStepId(recorder),
    order: 0,
    kind: 'recorded',
    sourceActionIds: [entry.id],
    action: mapActionType(action.name),
    target,
    value,
    url,
    assertions,
    rawAction: entry.rawAction,
    sourceCode: entry.sourceCode,
  });
}

function compactStepDrafts(drafts: StepDraft[]): StepDraft[] {
  const compacted: StepDraft[] = [];
  for (const draft of drafts) {
    const previous = compacted[compacted.length - 1];
    if (previous && shouldMergeTyping(previous.step, draft.step)) {
      previous.step = mergeFillStep(previous.step, draft.step);
      previous.entries.push(...draft.entries);
      continue;
    }
    if (previous && draft.step.action === 'press' && isTypingPress(draft.step) && sameEditableTarget(previous.step, draft.step)) {
      previous.step = mergeSourceActions(previous.step, draft.step);
      previous.entries.push(...draft.entries);
      continue;
    }
    if (previous && draft.step.action === 'assert' && draft.step.assertions.some(assertion => assertion.enabled)) {
      previous.step = {
        ...mergeSourceActions(previous.step, draft.step),
        assertions: mergeAssertions(previous.step.assertions, draft.step.assertions),
      };
      previous.entries.push(...draft.entries);
      continue;
    }
    compacted.push(draft);
  }
  return compacted;
}

function insertProjectedSteps(flow: BusinessFlow, drafts: StepDraft[], afterStepId?: string, options?: MergeActionsOptions): BusinessFlow {
  const reconciled = upgradeSyntheticStepsCoveredByRecordedDrafts(flow.steps, drafts);
  const steps = reconciled.steps;
  drafts = reconciled.remainingDrafts;
  if (reconciled.upgradedStepIds.length) {
    emitDiagnostic(options ?? {}, 'merge.synthetic-upgrade', '迟到 recorder action 已原地升级页面侧补录步骤', {
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

function normalizeAction(actionInContext: ActionInContextLike): ActionLike {
  if (actionInContext.action && typeof actionInContext.action === 'object')
    return actionInContext.action;
  return actionInContext as ActionLike;
}

function mapActionType(name?: string): FlowActionType {
  switch (name) {
    case 'navigate':
    case 'goto':
    case 'openPage':
      return 'navigate';
    case 'click':
      return 'click';
    case 'fill':
      return 'fill';
    case 'select':
    case 'selectOption':
      return 'select';
    case 'check':
      return 'check';
    case 'uncheck':
      return 'uncheck';
    case 'press':
      return 'press';
    case 'wait':
    case 'waitForTimeout':
      return 'wait';
    case 'setInputFiles':
      return 'upload';
    default:
      return name?.startsWith('assert') ? 'assert' : 'unknown';
  }
}

function extractTarget(action: ActionLike): FlowTarget | undefined {
  const selector = readString(action.selector);
  if (!selector)
    return undefined;

  const target: FlowTarget = {
    selector,
    raw: { selector },
  };

  Object.assign(target, inferTargetFromSelector(selector));
  return target;
}

function inferTargetFromSelector(selector: string): Partial<FlowTarget> {
  const target: Partial<FlowTarget> = {};
  const roleMatch = selector.match(/internal:role=([a-zA-Z0-9_-]+)/);
  const nameMatch = selector.match(/\[name=(?:"([^"]+)"|'([^']+)'|([^i\]]+))/);
  const labelMatch = selector.match(/internal:label=(?:"([^"]+)"|'([^']+)'|([^\]]+))/);
  const placeholderMatch = selector.match(/internal:attr=\[placeholder=(?:"([^"]+)"|'([^']+)'|([^\]]+))/);
  const textMatch = selector.match(/internal:text=(?:"([^"]+)"|'([^']+)'|([^\]]+))/);

  target.testId = extractTestId(selector);
  target.role = firstMatch(roleMatch);
  target.name = cleanupSelectorText(firstMatch(nameMatch));
  target.label = cleanupSelectorText(firstMatch(labelMatch));
  target.placeholder = cleanupSelectorText(firstMatch(placeholderMatch));
  target.text = cleanupSelectorText(firstMatch(textMatch));
  target.locator = selector;
  if (target.testId) {
    const ordinalHint = locatorHintFromSelectorOrdinal(selector);
    if (ordinalHint)
      target.locatorHint = ordinalHint;
  }
  return target;
}

function locatorHintFromSelectorOrdinal(selector: string) {
  const nthMatch = selector.match(/(?:>>\s*)?nth=(-?\d+)/);
  if (!nthMatch)
    return undefined;
  const pageIndex = Number(nthMatch[1]);
  if (!Number.isInteger(pageIndex) || pageIndex < 0)
    return undefined;
  return { strategy: 'global-testid' as const, confidence: 0.9, pageCount: pageIndex + 1, pageIndex };
}

function extractTestId(selector: string) {
  const internalMatch = selector.match(/internal:testid=\[(?:data-testid|data-test-id|data-e2e)=(?:"([^"]+)"|'([^']+)')[si]?\]/i);
  if (internalMatch)
    return cleanupSelectorText(firstMatch(internalMatch));
  const attributeMatch = selector.match(/\[(?:data-testid|data-test-id|data-e2e)=(?:"([^"]+)"|'([^']+)')\]/i);
  if (attributeMatch)
    return cleanupSelectorText(firstMatch(attributeMatch));
  const bareInternalMatch = selector.match(/internal:testid=(?:"([^"]+)"|'([^']+)'|([^\]\s]+))/i);
  if (bareInternalMatch)
    return cleanupSelectorText(firstMatch(bareInternalMatch));
  const looseAttributeMatch = selector.match(/\[(?:data-testid|data-test-id|data-e2e)=(?:"([^"]+)"|'([^']+)'|([^\]\s]+))/i);
  if (looseAttributeMatch)
    return cleanupSelectorText(firstMatch(looseAttributeMatch));
  return undefined;
}

function extractUrl(action: ActionLike) {
  const directUrl = readString(action.url);
  if (directUrl)
    return directUrl;
  return action.signals?.find(signal => signal.name === 'navigation' && signal.url)?.url;
}

function isNavigationAction(action: ActionLike) {
  return action.name === 'navigate' || action.name === 'goto' || action.name === 'openPage';
}

function extractValue(action: ActionLike) {
  const text = readString(action.text);
  if (text !== undefined)
    return text;
  const value = readString(action.value);
  if (value !== undefined)
    return value;
  if (typeof action.timeout === 'number')
    return String(action.timeout);
  const key = readString(action.key);
  if (key !== undefined)
    return key;
  if (Array.isArray(action.options))
    return action.options.join(', ');
  if (Array.isArray(action.files))
    return action.files.join(', ');
  if (typeof action.checked === 'boolean')
    return String(action.checked);
  return undefined;
}

function defaultAssertions(action: ActionLike, assertionIndex: number, target?: FlowTarget, url?: string, value?: string): FlowAssertion[] {
  const id = flowAssertionId(assertionIndex);
  switch (action.name) {
    case 'assertVisible':
      return [assertion(id, 'visible', target, undefined, true)];
    case 'assertValue':
      return [assertion(id, 'valueEquals', target, value, true)];
    case 'assertText':
      return [assertion(id, action.substring ? 'textContains' : 'textEquals', target, value, true)];
    case 'assertChecked':
      return [assertion(id, 'custom', target, `checked=${String(action.checked)}`, true)];
    case 'navigate':
    case 'goto':
    case 'openPage':
      return url ? [assertion(id, 'urlMatches', undefined, url, false)] : [];
    case 'fill':
      return value ? [assertion(id, 'valueEquals', target, value, false)] : [];
    case 'wait':
    case 'waitForTimeout':
      return [];
    default:
      return [];
  }
}

function assertion(id: string, type: FlowAssertionType, target: FlowTarget | undefined, expected: string | undefined, enabled: boolean): FlowAssertion {
  return {
    id,
    type,
    subject: subjectForAssertionType(type),
    target,
    expected,
    enabled,
  };
}

function subjectForAssertionType(type: FlowAssertionType): FlowAssertionSubject {
  if (type === 'urlMatches')
    return 'page';
  if (type === 'tableRowExists')
    return 'table';
  if (type === 'toastContains')
    return 'toast';
  if (type === 'apiStatus' || type === 'apiRequestContains')
    return 'api';
  if (type === 'custom')
    return 'custom';
  return 'element';
}

function defaultExpected(type: FlowAssertionType, step?: FlowStep) {
  if (type === 'urlMatches')
    return step?.url ?? '';
  if (type === 'valueEquals')
    return step?.value ?? '';
  return '';
}

function shouldMergeTyping(previous: FlowStep, incoming: FlowStep) {
  return previous.action === 'fill' && incoming.action === 'fill' && sameEditableTarget(previous, incoming);
}

function mergeFillStep(previous: FlowStep, incoming: FlowStep): FlowStep {
  return {
    ...mergeSourceActions(previous, incoming),
    value: incoming.value,
    rawAction: incoming.rawAction,
    assertions: updateFillAssertions(previous.assertions.length ? previous.assertions : incoming.assertions, incoming),
  };
}

function mergeSourceActions(previous: FlowStep, incoming: FlowStep): FlowStep {
  return {
    ...previous,
    sourceActionIds: unique([...(previous.sourceActionIds ?? []), ...(incoming.sourceActionIds ?? [])]),
    sourceCode: [previous.sourceCode, incoming.sourceCode].filter(Boolean).join('\n') || undefined,
  };
}

function updateFillAssertions(assertions: FlowAssertion[], step: FlowStep) {
  return assertions.map(assertion => {
    if (assertion.type !== 'valueEquals')
      return assertion;
    return {
      ...assertion,
      target: assertion.target ?? step.target,
      expected: step.value ?? assertion.expected,
    };
  });
}

function refreshAssertionsForStep(assertions: FlowAssertion[], previousValue: string | undefined, nextValue: string | undefined, target?: FlowTarget) {
  return assertions.map(assertion => {
    if (assertion.type !== 'valueEquals')
      return assertion;
    if (assertion.expected && assertion.expected !== previousValue)
      return assertion;
    return {
      ...assertion,
      target: assertion.target ?? target,
      expected: nextValue ?? assertion.expected,
    };
  });
}

function isTypingPress(step: FlowStep) {
  const key = step.value || '';
  return key.length === 1 || /^(Backspace|Delete|Space|Shift|CapsLock|Control|Alt|Meta|Tab|ArrowLeft|ArrowRight|ArrowUp|ArrowDown)$/i.test(key);
}

function sameEditableTarget(a: FlowStep, b: FlowStep) {
  const left = editableTargetSignature(a);
  const right = editableTargetSignature(b);
  return !!left && left === right;
}

function editableTargetSignature(step: FlowStep) {
  const target = targetSignature(step.target);
  if (!target)
    return '';
  const dialogScope = step.context?.before.dialog?.title || dialogScopeFromSource(step.sourceCode);
  return dialogScope ? `${target}|dialog:${dialogScope}` : target;
}

function dialogScopeFromSource(sourceCode?: string) {
  const match = sourceCode?.match(/\.filter\(\{\s*hasText:\s*(?:"([^"]+)"|'([^']+)')\s*\}\)/);
  return cleanupSelectorText(match?.[1] || match?.[2]);
}

function targetSignature(target?: FlowTarget) {
  if (!target)
    return '';
  return target.testId || target.selector || target.locator || [target.role, target.name, target.label, target.placeholder].filter(Boolean).join('|');
}

function mergeAssertions(existingAssertions: FlowAssertion[], incomingAssertions: FlowAssertion[]) {
  const merged = [...existingAssertions];
  for (const incoming of incomingAssertions) {
    if (merged.some(existing => assertionSignature(existing) === assertionSignature(incoming)))
      continue;
    let id = incoming.id;
    while (merged.some(existing => existing.id === id))
      id = flowAssertionId(merged.length);
    merged.push({ ...incoming, id });
  }
  return merged;
}

function assertionSignature(assertion: FlowAssertion) {
  return JSON.stringify({
    type: assertion.type,
    subject: assertion.subject,
    target: assertion.target,
    expected: assertion.expected,
    params: assertion.params,
  });
}

function actionSignature(rawAction: unknown) {
  const raw = asRecord(rawAction);
  const action = normalizeAction(raw as ActionInContextLike);
  try {
    return JSON.stringify({
      name: action.name,
      selector: action.selector,
      url: action.url,
      text: action.text,
      value: action.value,
      timeout: action.timeout,
      key: action.key,
      options: action.options,
      files: action.files,
      checked: action.checked,
      signals: action.signals?.map(signal => ({ name: signal.name, url: signal.url })),
    });
  } catch {
    return undefined;
  }
}

function nextAssertionIndex(flow: BusinessFlow) {
  return flow.steps.reduce((highest, step) => {
    return step.assertions.reduce((innerHighest, assertion) => {
      const numeric = Number(assertion.id.replace(/^a/, ''));
      return Number.isFinite(numeric) ? Math.max(innerHighest, numeric) : innerHighest;
    }, highest);
  }, 0);
}

function recordedSourceActions(sources: unknown[]) {
  const source = sources.find(source => {
    const candidate = source as Partial<Source>;
    return candidate?.isRecorded;
  }) as Source | undefined;
  if (!source)
    return [];
  if (Array.isArray(source.actions))
    return source.actions;
  return extractRunnableSourceLines(source.text);
}

function extractRunnableSourceLines(text?: string) {
  return text
      ?.split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => isRunnableActionSourceLine(line)) ?? [];
}

function isRunnableActionSourceLine(line: string) {
  return /^(await|const|let|var)\s/.test(line) && !line.includes(' has no runnable Playwright action source');
}

function sourceCodeForRecordedAction(candidate: string | undefined, action: ActionLike) {
  return sourceCodeMatchesAction(candidate, action) ? candidate : renderActionSource(action);
}

function sourceCodeMatchesAction(sourceCode: string | undefined, action: ActionLike) {
  if (!sourceCode)
    return false;

  if (action.name === 'click' && !/\.click\(/.test(sourceCode))
    return false;
  if (action.name === 'fill' && !/\.fill\(/.test(sourceCode))
    return false;
  if (action.name === 'press' && !/\.press\(/.test(sourceCode))
    return false;
  if ((action.name === 'wait' || action.name === 'waitForTimeout') && !/\.waitForTimeout\(/.test(sourceCode))
    return false;
  if ((action.name === 'select' || action.name === 'selectOption') && !/\.selectOption\(/.test(sourceCode))
    return false;

  const target = extractTarget(action);
  if (target?.testId)
    return sourceCode.includes(target.testId);
  if (action.name === 'click' && /getByTestId\(/.test(sourceCode))
    return true;

  const tokens = [
    target?.name,
    target?.label,
    target?.text,
    target?.placeholder,
    action.text,
    action.value,
    action.key,
    ...(action.options ?? []),
  ].filter(Boolean) as string[];
  return !tokens.length || tokens.some(token => sourceCode.includes(token));
}

function renderActionSource(action: ActionLike) {
  switch (action.name) {
    case 'navigate':
    case 'goto':
    case 'openPage':
      return action.url ? `await page.goto(${stringLiteral(action.url)});` : undefined;
    case 'click':
      return action.selector ? `await ${locatorExpression(action.selector)}.click();` : undefined;
    case 'fill':
      return action.selector ? `await ${locatorExpression(action.selector)}.fill(${stringLiteral(extractValue(action) ?? '')});` : undefined;
    case 'press':
      return action.selector ? `await ${locatorExpression(action.selector)}.press(${stringLiteral(action.key ?? '')});` : undefined;
    case 'wait':
    case 'waitForTimeout':
      return renderStableWaitSource(normalizeWaitMilliseconds(Number(extractValue(action) ?? action.value ?? action.text)));
    case 'check':
      return action.selector ? `await ${locatorExpression(action.selector)}.check();` : undefined;
    case 'uncheck':
      return action.selector ? `await ${locatorExpression(action.selector)}.uncheck();` : undefined;
    case 'select':
    case 'selectOption':
      return action.selector ? `await ${locatorExpression(action.selector)}.selectOption(${stringLiteral(action.options?.[0] ?? extractValue(action) ?? '')});` : undefined;
    case 'setInputFiles':
      return action.selector ? `await ${locatorExpression(action.selector)}.setInputFiles(${stringLiteral(action.files?.[0] ?? '')});` : undefined;
    default:
      return undefined;
  }
}

function normalizeWaitMilliseconds(value: number) {
  if (!Number.isFinite(value))
    return 1000;
  return Math.max(0, Math.round(value));
}

function renderStableWaitSource(milliseconds: number) {
  return [
    `await page.waitForLoadState('networkidle').catch(() => {});`,
    `await page.waitForTimeout(${milliseconds});`,
  ].join('\n');
}

function withBasicIntent(step: FlowStep): FlowStep {
  if (step.intentSource === 'user' || step.intent)
    return step;
  const suggestion = suggestBasicIntent(step);
  if (!suggestion || suggestion.confidence < 0.6)
    return step;
  return {
    ...step,
    intent: suggestion.text,
    intentSource: 'rule',
    intentSuggestion: suggestion,
  };
}

function locatorExpression(selector: string) {
  try {
    return `page.${asLocator('javascript', selector)}`;
  } catch {
    return `page.locator(${stringLiteral(selector)})`;
  }
}

function stringLiteral(value: unknown) {
  return JSON.stringify(String(value ?? ''));
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function firstMatch(match: RegExpMatchArray | null) {
  if (!match)
    return undefined;
  return match.slice(1).find(Boolean);
}

function cleanupSelectorText(value?: string) {
  return value?.replace(/\\(["'])/g, '$1').trim();
}
