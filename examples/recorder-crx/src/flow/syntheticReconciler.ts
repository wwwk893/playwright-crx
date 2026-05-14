/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { appendPageContextEvents } from './eventJournal';
import { migrateFlowToStableStepModel } from './flowMigration';
import type { ElementContext, PageContextEvent } from './pageContextTypes';
import { cloneRecorderState, withRecorderState } from './recorderState';
import { nextStableStepId, recomputeOrders } from './stableIds';
import type { BusinessFlow, FlowRecorderState, FlowStep, FlowTarget, RecordedActionEntry } from './types';
import type { UiSemanticContext } from '../uiSemantics/types';

type ActionLike = {
  name?: string;
  selector?: string;
};

type ActionInContextLike = {
  action?: ActionLike;
};

export type SyntheticReconcilerDiagnosticEvent = {
  level?: 'info' | 'warn';
  type: string;
  message: string;
  data?: Record<string, unknown>;
};

export type SyntheticAppendOptions = {
  insertAfterStepId?: string;
  diagnostics?: (event: SyntheticReconcilerDiagnosticEvent) => void;
};

export type SyntheticAppendResult = {
  flow: BusinessFlow;
  insertedStepIds: string[];
  upgradedStepIds: string[];
  skippedEventIds: string[];
};

export type SyntheticStepDraft = {
  step: FlowStep;
  entries: RecordedActionEntry[];
};

type StepDraft = SyntheticStepDraft;

const syntheticPageClickComment = '页面侧已捕获点击，并根据页面上下文自动补录为业务步骤。';

export function appendSyntheticPageContextSteps(flow: BusinessFlow, events: PageContextEvent[], diagnostics?: (event: SyntheticReconcilerDiagnosticEvent) => void): BusinessFlow {
  return appendSyntheticPageContextStepsWithResult(flow, events, { diagnostics }).flow;
}

export function appendSyntheticPageContextStepsWithResult(flow: BusinessFlow, events: PageContextEvent[], options: SyntheticAppendOptions = {}): SyntheticAppendResult {
  let base = migrateFlowToStableStepModel(flow);
  const recorder = cloneRecorderState(base);
  const journalChanged = appendPageContextEvents(recorder, events);
  const steps = [...base.steps];
  const addedStepIds: string[] = [];
  const upgradedStepIds: string[] = [];
  const skippedEventIds: string[] = [];
  const requestedInsertAfterStepId = options.insertAfterStepId;
  let cursorStepId = options.insertAfterStepId;
  for (const event of dedupeSyntheticClickEvents(events)) {
    if (event.kind !== 'click' || !event.wallTime || !shouldCreateSyntheticClick(event)) {
      skippedEventIds.push(event.id);
      continue;
    }
    const choiceControlEvent = isChoiceControlContext(event);
    const hasExistingStep = choiceControlEvent ? hasExistingChoiceControlStepForEvent(steps, event) : hasSyntheticStepForEvent(steps, event);
    if (hasExistingStep || !choiceControlEvent && hasRecordedClickForEvent(recorder, event)) {
      skippedEventIds.push(event.id);
      continue;
    }
    const recordedOptionIndex = dropdownRecordedOptionStepIndexForEvent(steps, event);
    if (recordedOptionIndex >= 0) {
      steps[recordedOptionIndex] = upgradeRecordedDropdownOptionStep(steps[recordedOptionIndex], event);
      upgradedStepIds.push(steps[recordedOptionIndex].id);
      cursorStepId = steps[recordedOptionIndex].id;
      continue;
    }
    const step = buildSyntheticClickStep(recorder, event);
    const insertAt = isDropdownOptionContext(event.before.target)
      ? syntheticInsertionIndexForEvent(steps, event)
      : cursorStepId ? Math.max(0, steps.findIndex(candidate => candidate.id === cursorStepId) + 1) : syntheticInsertionIndexForEvent(steps, event);
    steps.splice(insertAt, 0, step);
    addedStepIds.push(step.id);
    cursorStepId = step.id;
  }
  if (!addedStepIds.length && !upgradedStepIds.length) {
    return {
      flow: journalChanged ? withRecorderState(flow, recorder) : flow,
      insertedStepIds: [],
      upgradedStepIds: [],
      skippedEventIds,
    };
  }

  base = {
    ...base,
    steps: recomputeOrders(moveEarlierTimedStepsBeforeLaterSyntheticClicks(steps)),
    updatedAt: new Date().toISOString(),
  };
  emitDiagnostic({ diagnostics: options.diagnostics }, 'merge.synthetic-page-click', '页面侧 click 已根据上下文合成业务步骤', {
    addedStepIds,
    upgradedStepIds,
    skippedEventIds,
    eventIds: events.map(event => event.id),
    insertAfterStepId: requestedInsertAfterStepId,
    finalCursorStepId: cursorStepId,
  }, 'warn');
  return {
    flow: withRecorderState(base, recorder),
    insertedStepIds: addedStepIds,
    upgradedStepIds,
    skippedEventIds,
  };
}

function dropdownRecordedOptionStepIndexForEvent(steps: FlowStep[], event: PageContextEvent) {
  if (!isDropdownOptionContext(event.before.target))
    return -1;
  const eventText = dropdownOptionComparableText(event.before.target);
  if (!eventText)
    return -1;
  const eventWallTime = event.wallTime;
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    if (step.action !== 'click' || step.context?.before.target)
      continue;
    if (typeof eventWallTime === 'number') {
      const wallTime = stepWallTime(step);
      if (typeof wallTime !== 'number' || Math.abs(wallTime - eventWallTime) > 1500)
        continue;
    }
    const candidateText = recordedOptionComparableText(step);
    if (!candidateText)
      continue;
    if (eventText.includes(candidateText) || candidateText.includes(eventText))
      return index;
  }
  return -1;
}

function upgradeRecordedDropdownOptionStep(step: FlowStep, event: PageContextEvent): FlowStep {
  const target = flowTargetFromPageContext(event.before.target, event.before.form?.label, event.before.ui);
  const subject = target?.testId || target?.text || target?.name || target?.label || target?.placeholder || event.before.dialog?.title || '页面元素';
  return {
    ...step,
    target,
    uiRecipe: event.before.ui?.recipe || step.uiRecipe,
    context: {
      ...step.context,
      eventId: event.id,
      capturedAt: event.wallTime ?? Date.now(),
      before: event.before,
      after: event.after,
    },
    rawAction: {
      ...asRecord(step.rawAction),
      syntheticContextEventId: event.id,
      syntheticContextEventSignature: pageContextTargetSignature(event.before.target),
      syntheticContextEventWallTime: event.wallTime,
    },
    sourceCode: syntheticClickSourceCode(target, subject),
  };
}

function dropdownOptionComparableText(target?: ElementContext) {
  return normalizedComparableText(target?.title || target?.selectedOption || target?.ariaLabel || target?.text || target?.normalizedText || '');
}

function recordedOptionComparableText(step: FlowStep) {
  return normalizedComparableText(step.target?.text || step.target?.name || step.target?.displayName || rawTextFromSelector(recorderSelectorForStep(step)) || '');
}

function rawTextFromSelector(selector: string) {
  const match = selector.match(/internal:(?:text|attr=\[title)=\[?\"([^\"]+)/) || selector.match(/internal:text=\"([^\"]+)/) || selector.match(/name=\"([^\"]+)/);
  return match?.[1];
}

function syntheticInsertionIndexForEvent(steps: FlowStep[], event: PageContextEvent) {
  const dropdownTriggerIndex = dropdownOptionTriggerInsertionIndex(steps, event);
  if (dropdownTriggerIndex !== undefined)
    return dropdownTriggerIndex;

  const eventWallTime = event.wallTime;
  if (typeof eventWallTime !== 'number')
    return steps.length;
  let insertAt = 0;
  let sawComparableWallTime = false;
  const preserveUntimedRecordedBarriers = !isDropdownOptionContext(event.before.target);
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const wallTime = stepWallTime(step);
    if (typeof wallTime !== 'number') {
      if (preserveUntimedRecordedBarriers && sawComparableWallTime)
        insertAt = index + 1;
      continue;
    }
    sawComparableWallTime = true;
    if (wallTime > eventWallTime)
      return insertAt;
    insertAt = index + 1;
  }
  return sawComparableWallTime ? insertAt : steps.length;
}

function dropdownOptionTriggerInsertionIndex(steps: FlowStep[], event: PageContextEvent) {
  if (!isDropdownOptionContext(event.before.target))
    return undefined;
  const fieldLabel = normalizedComparableText(event.before.form?.label || '');
  if (!fieldLabel)
    return dropdownOptionTriggerInsertionIndexForControlType(steps, event.before.target?.controlType || '');

  for (let index = steps.length - 1; index >= 0; index--) {
    const step = steps[index];
    if (!isDropdownTriggerStepForLabel(step, fieldLabel))
      continue;
    let insertAt = index + 1;
    while (insertAt < steps.length && isDropdownOptionStepForLabel(steps[insertAt], fieldLabel))
      insertAt++;
    return insertAt;
  }
  return undefined;
}

function dropdownOptionTriggerInsertionIndexForControlType(steps: FlowStep[], controlType: string) {
  if (!controlType)
    return undefined;
  for (let index = steps.length - 1; index >= 0; index--) {
    const step = steps[index];
    if (!isDropdownTriggerStepForControlType(step, controlType))
      continue;
    let insertAt = index + 1;
    while (insertAt < steps.length && isDropdownOptionStepForControlType(steps[insertAt], controlType))
      insertAt++;
    return insertAt;
  }
  return undefined;
}

function isDropdownTriggerStepForLabel(step: FlowStep, normalizedLabel: string) {
  if (step.action !== 'click')
    return false;
  const target = step.target;
  const role = target?.role || '';
  const raw = recorderSelectorForStep(step);
  const labels = dropdownTriggerLabels(step);
  if (!/combobox|select/i.test(role) && !/combobox|select|ant-select|ant-cascader/i.test(raw) && !labels.some(label => /选择|select|角色|类型|范围|路径|标签|分类/i.test(String(label || ''))))
    return false;
  return labels.some(label => normalizedComparableText(label || '').includes(normalizedLabel));
}

function isDropdownTriggerStepForControlType(step: FlowStep, controlType: string) {
  if (step.action !== 'click')
    return false;
  const target = step.target;
  const role = target?.role || '';
  const raw = recorderSelectorForStep(step);
  const labels = dropdownTriggerLabels(step).join(' ');
  const isTrigger = /combobox|select/i.test(role) || /combobox|select|ant-select|ant-cascader/i.test(raw) || /选择|select|角色|类型|范围|路径|标签|分类/i.test(labels);
  if (!isTrigger)
    return false;
  if (controlType === 'cascader-option')
    return /cascader|路径/.test(raw) || /路径/.test(labels);
  if (controlType === 'tree-select-option')
    return /tree|范围/.test(raw) || /范围/.test(labels);
  if (controlType === 'select-option')
    return !/cascader|tree|路径|范围/.test(raw) && !/路径|范围/.test(labels);
  return false;
}

function dropdownTriggerLabels(step: FlowStep) {
  const target = step.target;
  const raw = recorderSelectorForStep(step);
  return [
    target?.label,
    target?.name,
    target?.text,
    target?.displayName,
    target?.scope?.form?.label,
    step.context?.before.form?.label,
    raw,
  ].filter(Boolean).map(String);
}

function isDropdownOptionStepForLabel(step: FlowStep, normalizedLabel: string) {
  if (step.action !== 'click')
    return false;
  const target = step.target;
  const contextTarget = step.context?.before.target;
  if (!isDropdownOptionContext(contextTarget) && !/option|menuitem/.test(target?.role || '') && !/option/.test(String((target?.raw as { controlType?: unknown } | undefined)?.controlType || '')))
    return false;
  const labels = [target?.label, target?.scope?.form?.label, step.context?.before.form?.label];
  return !labels.some(Boolean) || labels.some(label => normalizedComparableText(label || '').includes(normalizedLabel));
}

function isDropdownOptionStepForControlType(step: FlowStep, controlType: string) {
  if (step.action !== 'click')
    return false;
  const stepControlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  if (stepControlType)
    return stepControlType === controlType;
  const role = step.target?.role || '';
  if (!/option|menuitem/.test(role))
    return false;
  if (controlType === 'cascader-option')
    return /menuitem/.test(role);
  if (controlType === 'tree-select-option')
    return /tree/.test(role);
  return controlType === 'select-option' && /option/.test(role);
}

function normalizedComparableText(value: string) {
  return value.replace(/\s+/g, '').trim().toLowerCase();
}

function recorderSelectorForStep(step: FlowStep) {
  const raw = asRecord(step.rawAction);
  const action = asRecord(raw.action);
  return typeof action.selector === 'string' ? action.selector : '';
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

function dedupeSyntheticClickEvents(events: PageContextEvent[]) {
  const sorted = events
      .filter(event => event.kind === 'click' && event.wallTime)
      .sort((a, b) => Number(a.wallTime) - Number(b.wallTime));
  const groups: PageContextEvent[][] = [];
  for (const event of sorted) {
    if (event.kind !== 'click')
      continue;
    const last = groups[groups.length - 1];
    const previous = last?.[last.length - 1];
    if (previous && sameClickCluster(previous, event))
      last.push(event);
    else
      groups.push([event]);
  }
  return groups.map(bestPageContextEvent);
}

function sameClickCluster(left: PageContextEvent, right: PageContextEvent) {
  const timeClose = Math.abs(Number(left.wallTime ?? 0) - Number(right.wallTime ?? 0)) < 650;
  if (!timeClose)
    return false;

  if (left.before.target?.testId && left.before.target.testId === right.before.target?.testId)
    return true;

  const leftText = left.before.target ? targetComparableText(left.before.target) : undefined;
  const rightText = right.before.target ? targetComparableText(right.before.target) : undefined;
  if (leftText && rightText && leftText === rightText)
    return true;

  const leftDialog = left.after?.dialog?.title || left.before.dialog?.title;
  const rightDialog = right.after?.dialog?.title || right.before.dialog?.title;
  return !!leftDialog && leftDialog === rightDialog && leftText === rightText;
}

function bestPageContextEvent(events: PageContextEvent[]) {
  return [...events].sort((a, b) => contextEventScore(b) - contextEventScore(a))[0];
}

function contextEventScore(event: PageContextEvent) {
  const target = event.before.target;
  return (target?.testId ? 1000 : 0) +
    (target?.locatorQuality === 'testid' ? 200 : 0) +
    (target?.framework === 'antd' || target?.framework === 'procomponents' ? 80 : 0) +
    (target?.role === 'button' ? 80 : 0) +
    (target?.controlType === 'button' ? 80 : 0) +
    (target?.controlType === 'select-option' ? 70 : 0) +
    (target?.text ? 40 : 0) +
    (target?.ariaLabel ? 30 : 0) +
    (target?.placeholder ? 20 : 0) +
    (event.before.form?.label ? 20 : 0) +
    (event.before.table?.rowKey ? 20 : 0) +
    (event.before.dialog?.title ? 10 : 0);
}

function shouldCreateSyntheticClick(event: PageContextEvent) {
  const target = event.before.target;
  if (!target)
    return false;

  if (isNonInteractiveOverlayContainerClick(event))
    return false;
  if (isNonInteractiveStructuralContextTarget(target))
    return false;
  if (target.testId)
    return true;
  if (target.controlType && target.controlType !== 'unknown')
    return true;
  if (target.role && /^(button|menuitem|option|tab|checkbox|radio|switch)$/i.test(target.role))
    return true;
  return !!target.text || !!target.ariaLabel || !!target.placeholder;
}

function isNonInteractiveOverlayContainerClick(event: PageContextEvent) {
  const target = event.before.target;
  if (!target)
    return false;
  const dialog = event.before.dialog || event.after?.dialog;
  const hasDialogEvidence = !!event.before.dialog?.title || !!event.after?.dialog?.title;
  if (!hasDialogEvidence)
    return false;
  const rootByTestId = looksLikeOverlayRootTestId(target.testId || '', dialog?.type);
  const rootContainerByTestId = rootByTestId && isOverlayRootContainerTag(target) && !hasInteractiveRole(target);
  if (isInteractiveContextTarget(target, { ignoreActionTestId: true }) && !rootContainerByTestId)
    return false;
  const plainContainer = rootContainerByTestId || isPlainOverlayContainerTarget(target, dialog?.type);
  if (!plainContainer)
    return false;
  const rootByText = looksLikeOverlayRootText(target, dialog?.title);
  return rootByTestId || rootByText;
}

function isNonInteractiveStructuralContextTarget(target: ElementContext) {
  if (isInteractiveContextTarget(target))
    return false;
  return looksLikeStructuralContainerTestId(target.testId || '') ||
    /^(section|article|main|aside|header|footer)$/i.test(target.tag || '') ||
    /card|section|container|wrapper|region/i.test(target.framework === 'procomponents' || target.framework === 'antd' ? String(target.testId || '') : '');
}

function isInteractiveContextTarget(target: ElementContext, options: { ignoreActionTestId?: boolean } = {}) {
  const testId = target.testId || '';
  return hasInteractiveRoleOrControlType(target) ||
    !options.ignoreActionTestId &&
    looksLikeActionTestId(testId);
}

function hasInteractiveRoleOrControlType(target: ElementContext) {
  return /^(button|link|checkbox|radio|switch|combobox|select|option|menuitem|tab|treeitem|textbox)$/i.test(target.role || '') ||
    /^(button|link|table-row-action|checkbox|radio|switch|select|tree-select|cascader|select-option|tree-select-option|cascader-option|menu-item|dropdown-trigger|tab|date-picker|upload|input|textarea)$/i.test(target.controlType || '');
}

function hasInteractiveRole(target: ElementContext) {
  return /^(button|link|checkbox|radio|switch|combobox|select|option|menuitem|tab|treeitem|textbox)$/i.test(target.role || '');
}

function isPlainOverlayContainerTarget(target: ElementContext, dialogType?: string) {
  const tag = target.tag || '';
  const role = target.role || '';
  const controlType = target.controlType || '';
  if (controlType && controlType !== 'unknown')
    return false;
  if (role && !/^(dialog|region|presentation|none|group)$/i.test(role))
    return false;
  return /^(div|section|article|main|aside)$/i.test(tag) ||
    /^(dialog|region|presentation|none|group)$/i.test(role) ||
    looksLikeOverlayRootTestId(target.testId || '', dialogType);
}

function isOverlayRootContainerTag(target: ElementContext) {
  return /^(div|section|article|main|aside)$/i.test(target.tag || '');
}

function looksLikeOverlayRootTestId(testId: string, dialogType?: string) {
  if (!testId)
    return false;
  if (/(^|[-_])(modal|dialog|drawer|popover|overlay)([-_]|$)/i.test(testId))
    return true;
  return /(^|[-_])(container|wrapper|region|root)([-_]|$)/i.test(testId) &&
    /^(modal|dialog|drawer|popover)$/i.test(dialogType || '');
}

function looksLikeOverlayRootText(target: ElementContext, dialogTitle?: string) {
  const text = normalizePageContextText(target.normalizedText || target.text || target.title);
  const title = normalizePageContextText(dialogTitle);
  return !!text && !!title && (text === title || text.includes(title)) &&
    /^(div|section|article|main|aside)$/i.test(target.tag || '');
}

function normalizePageContextText(value?: string) {
  return value?.replace(/\s+/g, '').trim();
}

function hasSyntheticStepForEvent(steps: FlowStep[], event: PageContextEvent) {
  return steps.some(step => {
    const raw = asRecord(step.rawAction);
    if (step.action === 'click' && step.context?.eventId === event.id)
      return true;
    if (step.action === 'click' && step.context?.before.target &&
      targetsLikelySame(step.context.before.target, event.before.target) &&
      Math.abs(Number(step.context.capturedAt ?? 0) - Number(event.wallTime ?? 0)) < 1500)
      return true;
    return raw.syntheticContextEventId === event.id ||
      (raw.syntheticContextEventSignature === pageContextTargetSignature(event.before.target) &&
        Math.abs(Number(raw.syntheticContextEventWallTime ?? 0) - Number(event.wallTime ?? 0)) < 750) ||
      (step.kind === 'manual' && step.action === 'click' && step.context?.before.target &&
        targetsLikelySame(step.context.before.target, event.before.target) &&
        Math.abs(Number(raw.syntheticContextEventWallTime ?? 0) - Number(event.wallTime ?? 0)) < 1500);
  });
}

function hasRecordedClickForEvent(recorder: FlowRecorderState, event: PageContextEvent) {
  return recorder.actionLog.some(entry => recordedEntryCoversContextEvent(entry, event));
}

function hasExistingChoiceControlStepForEvent(steps: FlowStep[], event: PageContextEvent) {
  const eventText = event.before.target ? normalizedComparableText(stableElementText(event.before.target) || '') : '';
  if (!eventText)
    return false;
  return steps.some(step => {
    if (step.action !== 'click')
      return false;
    const text = normalizedComparableText(step.target?.text || step.target?.name || step.target?.displayName || rawTextFromSelector(recorderSelectorForStep(step)) || '');
    if (text !== eventText)
      return false;
    const rawControlType = rawTargetControlType(step.target?.raw);
    const role = step.target?.role || '';
    if (!/^(checkbox|radio|switch)$/.test(rawControlType) && !/^(checkbox|radio|switch)$/.test(role))
      return false;
    const eventWallTime = Number(event.wallTime ?? 0);
    const existingWallTime = stepWallTime(step);
    return !eventWallTime || typeof existingWallTime !== 'number' || Math.abs(existingWallTime - eventWallTime) < 2000;
  });
}

function recordedEntryCoversContextEvent(entry: RecordedActionEntry, event: PageContextEvent) {
  const action = normalizeAction(asRecord(entry.rawAction) as ActionInContextLike);
  if (action.name !== 'click')
    return false;
  if (typeof entry.wallTime !== 'number' || typeof event.wallTime !== 'number')
    return false;
  const diff = Math.abs(entry.wallTime - event.wallTime);
  if (diff > 2000)
    return false;
  const target = extractTarget(action);
  if (isDropdownOptionContext(event.before.target))
    return false;
  if (targetsLikelySame(target, event.before.target))
    return true;
  if (isChoiceControlContext(event))
    return false;
  if (diff < 800 && isWeakPageContextClickTarget(event.before.target))
    return true;
  return diff < 400 && !target?.testId && !event.before.target?.testId;
}

function isDropdownOptionContext(target?: ElementContext) {
  return /^(select-option|tree-select-option|cascader-option|menu-item)$/.test(target?.controlType || '') ||
    /^(option|treeitem|menuitem)$/.test(target?.role || '');
}

function isChoiceControlContext(event: PageContextEvent) {
  const target = event.before.target;
  if (!target)
    return false;
  if (!/^(checkbox|radio|switch)$/.test(target?.controlType || '') && !/^(checkbox|radio|switch)$/.test(target?.role || ''))
    return false;
  return !!event.before.form?.label || !!stableElementText(target);
}

function isWeakPageContextClickTarget(target?: ElementContext) {
  if (!target)
    return true;
  return !target.testId &&
    !target.ariaLabel &&
    !target.placeholder &&
    !!target.text;
}

function buildSyntheticClickStep(recorder: FlowRecorderState, event: PageContextEvent): FlowStep {
  const target = flowTargetFromPageContext(event.before.target, event.before.form?.label, event.before.ui);
  const subject = target?.testId || target?.text || target?.name || target?.label || target?.placeholder || event.before.dialog?.title || '页面元素';
  return {
    id: nextStableStepId(recorder),
    order: 0,
    kind: 'manual',
    sourceActionIds: [],
    action: 'click',
    intent: '',
    uiRecipe: event.before.ui?.recipe,
    comment: syntheticPageClickComment,
    context: {
      eventId: event.id,
      capturedAt: event.wallTime ?? Date.now(),
      before: event.before,
      after: event.after,
    },
    target,
    assertions: [],
    rawAction: {
      syntheticContextEventId: event.id,
      syntheticContextEventSignature: pageContextTargetSignature(event.before.target),
      syntheticContextEventWallTime: event.wallTime,
    },
    sourceCode: syntheticClickSourceCode(target, subject),
  };
}

function flowTargetFromPageContext(target?: ElementContext, formLabel?: string, ui?: UiSemanticContext): FlowTarget | undefined {
  if (!target && !ui)
    return undefined;
  const contextText = target ? stableElementText(target) : undefined;
  const bestHint = ui?.locatorHints?.slice().sort((a, b) => b.score - a.score)[0];
  return {
    testId: ui?.targetTestId || (bestHint?.kind === 'testid' ? bestHint.value : undefined) || target?.testId,
    role: target?.role,
    name: target?.ariaLabel || ui?.targetText || ui?.table?.rowKey || contextText || target?.title,
    displayName: ui?.recipe?.optionText || ui?.recipe?.targetText || ui?.targetText || ui?.table?.rowKey || contextText || target?.ariaLabel || target?.placeholder || target?.testId || formLabel,
    label: ui?.form?.label || formLabel,
    placeholder: ui?.form?.placeholder || target?.placeholder,
    text: ui?.option?.text || ui?.targetText || contextText,
    raw: { target, ui },
  };
}

function stableElementText(target: ElementContext) {
  const text = target.text?.trim();
  const title = target.title?.trim();
  if (/^(select-option|tree-select-option|cascader-option|menu-item)$/.test(target.controlType || '') || /^(option|treeitem|menuitem)$/.test(target.role || '')) {
    if (title && (!text || title.includes(text) || title.length > text.length))
      return title;
  }
  return text || title;
}

function syntheticClickSourceCode(target: FlowTarget | undefined, fallback: string) {
  if (target?.testId)
    return `await ${testIdLocatorFromTarget(target)}.click();`;
  const rawControlType = rawTargetControlType(target?.raw);
  const choiceText = target?.text || target?.name || target?.displayName;
  if (/^(checkbox|radio|switch)$/.test(rawControlType) && choiceText)
    return `await page.locator('label').filter({ hasText: ${stringLiteral(choiceText)} }).click();`;
  if (target?.label)
    return `await page.getByLabel(${stringLiteral(target.label)}).click();`;
  if (target?.role && (target.name || target.text))
    return `await page.getByRole(${stringLiteral(target.role)}, { name: ${stringLiteral(target.name || target.text)} }).click();`;
  return `await page.getByText(${stringLiteral(target?.text || target?.name || fallback)}).click();`;
}

type RawTargetRecord = {
  controlType?: unknown;
  uniqueness?: { pageCount?: number; pageIndex?: number };
  pageContext?: { controlType?: unknown; uniqueness?: { pageCount?: number; pageIndex?: number } };
  target?: { controlType?: unknown; uniqueness?: { pageCount?: number; pageIndex?: number } };
  synthetic?: RawTargetRecord;
  recorder?: RawTargetRecord;
};

function rawTargetControlType(raw: unknown) {
  if (!raw || typeof raw !== 'object')
    return '';
  const record = raw as RawTargetRecord;
  return String(record.controlType || record.pageContext?.controlType || record.target?.controlType || record.synthetic?.controlType || record.synthetic?.pageContext?.controlType || record.synthetic?.target?.controlType || '');
}

function rawTargetUniqueness(raw: unknown): { pageCount?: number; pageIndex?: number } | undefined {
  if (!raw || typeof raw !== 'object')
    return undefined;
  const record = raw as RawTargetRecord;
  return record.uniqueness || record.pageContext?.uniqueness || record.target?.uniqueness || record.synthetic?.uniqueness || record.synthetic?.pageContext?.uniqueness || record.synthetic?.target?.uniqueness || record.recorder?.uniqueness;
}

function testIdLocatorFromTarget(target: FlowTarget) {
  const locator = `page.getByTestId(${stringLiteral(target.testId)})`;
  const uniqueness = rawTargetUniqueness(target.raw);
  const pageCount = Number(uniqueness?.pageCount);
  const pageIndex = Number(uniqueness?.pageIndex);
  if (Number.isInteger(pageIndex) && pageIndex >= 0 && Number.isFinite(pageCount) && pageCount > 1)
    return `${locator}.nth(${pageIndex})`;
  return locator;
}

function pageContextTargetSignature(target?: ElementContext) {
  return [target?.testId, target?.role, target?.ariaLabel, target?.text, target?.placeholder, target?.tag].filter(Boolean).join('|');
}

function targetsLikelySame(left?: FlowTarget | ElementContext, right?: FlowTarget | ElementContext) {
  if (!left || !right)
    return false;
  const leftTestId = 'testId' in left ? left.testId : undefined;
  const rightTestId = 'testId' in right ? right.testId : undefined;
  if (leftTestId && rightTestId)
    return leftTestId === rightTestId;
  const leftText = targetComparableText(left);
  const rightText = targetComparableText(right);
  if (leftText && rightText && leftText === rightText)
    return true;
  const leftRole = 'role' in left ? left.role : undefined;
  const rightRole = 'role' in right ? right.role : undefined;
  return !!leftRole && !!rightRole && leftRole === rightRole && !!leftText && !!rightText && leftText === rightText;
}

function targetComparableText(target: FlowTarget | ElementContext) {
  const flowTarget = target as FlowTarget;
  const elementTarget = target as ElementContext;
  const value = flowTarget.displayName ||
    flowTarget.name ||
    flowTarget.label ||
    elementTarget.ariaLabel ||
    target.text ||
    elementTarget.title ||
    target.placeholder ||
    elementTarget.normalizedText;
  return value?.replace(/\s+/g, ' ').trim();
}

function emitDiagnostic(options: { diagnostics?: (event: SyntheticReconcilerDiagnosticEvent) => void }, type: string, message: string, data?: Record<string, unknown>, level: SyntheticReconcilerDiagnosticEvent['level'] = 'info') {
  options.diagnostics?.({ type, message, data, level });
}

function isSyntheticSubmitClickStep(step: FlowStep) {
  if (!isSyntheticClickStep(step))
    return false;
  const targetText = [step.target?.testId, step.target?.name, step.target?.text, step.target?.displayName].filter(Boolean).join('|');
  return /save|submit|confirm|保存|提交|确定|确 定/i.test(targetText);
}

export function moveEarlierTimedStepsBeforeLaterSyntheticClicks(steps: FlowStep[]) {
  let ordered = [...steps];
  for (let index = 0; index < ordered.length; index++) {
    const syntheticStep = ordered[index];
    if (!isSyntheticSubmitClickStep(syntheticStep))
      continue;
    const syntheticWallTime = stepWallTime(syntheticStep);
    if (typeof syntheticWallTime !== 'number')
      continue;
    const before = ordered.slice(0, index);
    const after = ordered.slice(index + 1);
    const earlierIndexes = new Set<number>();
    for (let afterIndex = 0; afterIndex < after.length; afterIndex++) {
      const wallTime = stepWallTime(after[afterIndex]);
      if (typeof wallTime !== 'number' || wallTime >= syntheticWallTime)
        continue;
      earlierIndexes.add(afterIndex);
      for (let cursor = afterIndex - 1; cursor >= 0; cursor--) {
        if (earlierIndexes.has(cursor))
          continue;
        if (typeof stepWallTime(after[cursor]) === 'number')
          break;
        if (isSyntheticClickStep(after[cursor]))
          break;
        if (after[cursor].kind !== 'recorded')
          break;
        earlierIndexes.add(cursor);
      }
    }
    if (!earlierIndexes.size)
      continue;
    const earlierAfterSynthetic = after.filter((_, afterIndex) => earlierIndexes.has(afterIndex));
    const laterOrUntimed = after.filter((_, afterIndex) => !earlierIndexes.has(afterIndex));
    ordered = [...before, ...earlierAfterSynthetic, syntheticStep, ...laterOrUntimed];
    index += earlierAfterSynthetic.length;
  }
  return ordered;
}

export function upgradeSyntheticStepsCoveredByRecordedDrafts(steps: FlowStep[], drafts: StepDraft[]) {
  const nextSteps = [...steps];
  const remainingDrafts: StepDraft[] = [];
  const upgradedStepIds: string[] = [];

  for (const draft of drafts) {
    if (draft.step.kind !== 'recorded' || draft.step.action !== 'click') {
      remainingDrafts.push(draft);
      continue;
    }
    const syntheticIndex = nextSteps.findIndex(step => isSyntheticClickStep(step) && syntheticClickCoveredByRecordedStep(step, draft));
    if (syntheticIndex < 0) {
      remainingDrafts.push(draft);
      continue;
    }
    nextSteps[syntheticIndex] = upgradeSyntheticStep(nextSteps[syntheticIndex], draft);
    upgradedStepIds.push(nextSteps[syntheticIndex].id);
  }

  return {
    steps: nextSteps,
    remainingDrafts,
    upgradedStepIds,
    upgradedActionIds: upgradedStepIds.flatMap(stepId => nextSteps.find(step => step.id === stepId)?.sourceActionIds ?? []),
  };
}

export function isSyntheticClickStep(step: FlowStep) {
  return step.kind === 'manual' &&
    step.action === 'click' &&
    !!asRecord(step.rawAction).syntheticContextEventId;
}

function upgradeSyntheticStep(synthetic: FlowStep, draft: StepDraft): FlowStep {
  const recorded = draft.step;
  return {
    ...synthetic,
    kind: 'recorded',
    sourceActionIds: unique([...(synthetic.sourceActionIds ?? []), ...(recorded.sourceActionIds ?? [])]),
    action: recorded.action,
    target: mergeRecordedAndSyntheticTarget(recorded.target, synthetic.target),
    value: recorded.value,
    url: recorded.url,
    assertions: synthetic.assertions.length ? synthetic.assertions : recorded.assertions,
    rawAction: recorded.rawAction,
    sourceCode: recorded.sourceCode,
    comment: synthetic.comment === syntheticPageClickComment ? undefined : synthetic.comment,
  };
}

function mergeRecordedAndSyntheticTarget(recorded?: FlowTarget, synthetic?: FlowTarget): FlowTarget | undefined {
  if (!recorded)
    return synthetic;
  if (!synthetic)
    return recorded;
  return {
    ...recorded,
    testId: recorded.testId || synthetic.testId,
    role: recorded.role || synthetic.role,
    name: recorded.name || synthetic.name,
    displayName: recorded.displayName || synthetic.displayName,
    text: recorded.text || synthetic.text,
    placeholder: recorded.placeholder || synthetic.placeholder,
    raw: {
      recorded: recorded.raw,
      synthetic: synthetic.raw,
    },
  };
}

function syntheticClickCoveredByRecordedStep(syntheticStep: FlowStep, draft: StepDraft) {
  if (isDropdownOptionContext(syntheticStep.context?.before.target) || isChoiceControlStep(syntheticStep))
    return false;
  if (targetsLikelySame(syntheticStep.target, draft.step.target))
    return true;
  const syntheticWallTime = Number(asRecord(syntheticStep.rawAction).syntheticContextEventWallTime ?? 0);
  const recordedWallTime = draft.entries.map(entry => entry.wallTime).find((value): value is number => typeof value === 'number');
  return !!syntheticWallTime && !!recordedWallTime && Math.abs(recordedWallTime - syntheticWallTime) < 1500;
}

function isChoiceControlStep(step: FlowStep) {
  const target = step.context?.before.target;
  if (!target)
    return false;
  if (!/^(checkbox|radio|switch)$/.test(target?.controlType || '') && !/^(checkbox|radio|switch)$/.test(target?.role || ''))
    return false;
  return !!step.context?.before.form?.label || !!stableElementText(target);
}


function normalizeAction(actionInContext: ActionInContextLike): ActionLike {
  if (actionInContext.action && typeof actionInContext.action === 'object')
    return actionInContext.action;
  return actionInContext as ActionLike;
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
  const nameMatch = selector.match(/\[name=(?:\"([^\"]+)\"|'([^']+)'|([^i\]]+))/);
  const labelMatch = selector.match(/internal:label=(?:\"([^\"]+)\"|'([^']+)'|([^\]]+))/);
  const placeholderMatch = selector.match(/internal:attr=\[placeholder=(?:\"([^\"]+)\"|'([^']+)'|([^\]]+))/);
  const textMatch = selector.match(/internal:text=(?:\"([^\"]+)\"|'([^']+)'|([^\]]+))/);

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
  const internalMatch = selector.match(/internal:testid=\[(?:data-testid|data-test-id|data-e2e)=(?:\"([^\"]+)\"|'([^']+)')[si]?\]/i);
  if (internalMatch)
    return cleanupSelectorText(firstMatch(internalMatch));
  const attributeMatch = selector.match(/\[(?:data-testid|data-test-id|data-e2e)=(?:\"([^\"]+)\"|'([^']+)')\]/i);
  if (attributeMatch)
    return cleanupSelectorText(firstMatch(attributeMatch));
  const bareInternalMatch = selector.match(/internal:testid=(?:\"([^\"]+)\"|'([^']+)'|([^\]\s]+))/i);
  if (bareInternalMatch)
    return cleanupSelectorText(firstMatch(bareInternalMatch));
  const looseAttributeMatch = selector.match(/\[(?:data-testid|data-test-id|data-e2e)=(?:\"([^\"]+)\"|'([^']+)'|([^\]\s]+))/i);
  if (looseAttributeMatch)
    return cleanupSelectorText(firstMatch(looseAttributeMatch));
  return undefined;
}

function looksLikeStructuralContainerTestId(testId: string) {
  return /(?:page|view|panel|container|wrapper|layout|section|content|card)$/i.test(testId) && !looksLikeActionTestId(testId);
}

function looksLikeActionTestId(testId: string) {
  return /(?:button|btn|link|switch|checkbox|radio|select|input|textarea|upload|submit|save|delete|remove|edit|create|add|new|ok|cancel)$/i.test(testId);
}

function stringLiteral(value: unknown) {
  return JSON.stringify(String(value ?? ''));
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
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
