/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import { extractTargetFromRecorderAction } from '../capture/targetFromRecorderSelector';
import { cleanupSelectorText } from '../capture/targetFromRecorderSelector';
import { suggestBasicIntent } from './intentRules';
import {
  asRecord,
  extractRecorderActionUrl,
  extractRecorderActionValue,
  mapRecorderActionType,
  normalizeRecorderAction,
  unique,
  type ActionInContextLike,
  type ActionLike,
} from './recorderActionModel';
import { nextStableStepId } from './stableIds';
import type { BusinessFlow, FlowAssertion, FlowAssertionSubject, FlowAssertionType, FlowRecorderState, FlowStep, FlowTarget, RecordedActionEntry } from './types';
import { flowAssertionId } from './types';

export type StepDraft = {
  step: FlowStep;
  entries: RecordedActionEntry[];
};

export function buildStepDraftsFromEntries(recorder: FlowRecorderState, entries: RecordedActionEntry[], assertionIndex: { value: number }): StepDraft[] {
  return compactStepDrafts(entries.map(entry => ({
    step: buildStepFromEntry(recorder, entry, assertionIndex),
    entries: [entry],
  })));
}

export function buildStepFromEntry(recorder: FlowRecorderState, entry: RecordedActionEntry, assertionIndex: { value: number }): FlowStep {
  const actionInContext = asRecord(entry.rawAction) as ActionInContextLike;
  const action = normalizeRecorderAction(actionInContext);
  const target = extractTargetFromRecorderAction(action);
  const url = extractRecorderActionUrl(action);
  const value = extractRecorderActionValue(action);
  const assertions = defaultAssertions(action, assertionIndex.value, target, url, value);
  assertionIndex.value += Math.max(assertions.length, 1);
  return withBasicIntent({
    id: nextStableStepId(recorder),
    order: 0,
    kind: 'recorded',
    sourceActionIds: [entry.id],
    action: mapRecorderActionType(action.name),
    target,
    value,
    url,
    assertions,
    rawAction: entry.rawAction,
    sourceCode: entry.sourceCode,
  });
}

export function compactStepDrafts(drafts: StepDraft[]): StepDraft[] {
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

export function refreshStepFromEntry(step: FlowStep, entry: RecordedActionEntry, entriesById: Map<string, RecordedActionEntry>): FlowStep {
  const action = normalizeRecorderAction(asRecord(entry.rawAction) as ActionInContextLike);
  const target = extractTargetFromRecorderAction(action) ?? step.target;
  const url = extractRecorderActionUrl(action) ?? step.url;
  const value = extractRecorderActionValue(action);
  const actionType = mapRecorderActionType(action.name);
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

export function subjectForAssertionType(type: FlowAssertionType): FlowAssertionSubject {
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

export function defaultExpected(type: FlowAssertionType, step?: FlowStep) {
  if (type === 'urlMatches')
    return step?.url ?? '';
  if (type === 'valueEquals')
    return step?.value ?? '';
  return '';
}

export function shouldMergeTyping(previous: FlowStep, incoming: FlowStep) {
  return previous.action === 'fill' && incoming.action === 'fill' && sameEditableTarget(previous, incoming);
}

export function mergeFillStep(previous: FlowStep, incoming: FlowStep): FlowStep {
  return {
    ...mergeSourceActions(previous, incoming),
    value: incoming.value,
    rawAction: incoming.rawAction,
    assertions: updateFillAssertions(previous.assertions.length ? previous.assertions : incoming.assertions, incoming),
  };
}

export function mergeSourceActions(previous: FlowStep, incoming: FlowStep): FlowStep {
  return {
    ...previous,
    sourceActionIds: unique([...(previous.sourceActionIds ?? []), ...(incoming.sourceActionIds ?? [])]),
    sourceCode: [previous.sourceCode, incoming.sourceCode].filter(Boolean).join('\n') || undefined,
  };
}

export function isTypingPress(step: FlowStep) {
  const key = step.value || '';
  return key.length === 1 || /^(Backspace|Delete|Space|Shift|CapsLock|Control|Alt|Meta|Tab|ArrowLeft|ArrowRight|ArrowUp|ArrowDown)$/i.test(key);
}

export function sameEditableTarget(a: FlowStep, b: FlowStep) {
  const left = editableTargetSignature(a);
  const right = editableTargetSignature(b);
  return !!left && left === right;
}

export function mergeAssertions(existingAssertions: FlowAssertion[], incomingAssertions: FlowAssertion[]) {
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

export function nextAssertionIndex(flow: BusinessFlow) {
  return flow.steps.reduce((highest, step) => {
    return step.assertions.reduce((innerHighest, assertion) => {
      const numeric = Number(assertion.id.replace(/^a/, ''));
      return Number.isFinite(numeric) ? Math.max(innerHighest, numeric) : innerHighest;
    }, highest);
  }, 0);
}

function sourceCodeForStep(step: FlowStep, entriesById: Map<string, RecordedActionEntry>) {
  return step.sourceActionIds
      ?.map(actionId => entriesById.get(actionId)?.sourceCode)
      .filter(Boolean)
      .join('\n') || undefined;
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

function assertionSignature(assertion: FlowAssertion) {
  return JSON.stringify({
    type: assertion.type,
    subject: assertion.subject,
    target: assertion.target,
    expected: assertion.expected,
    params: assertion.params,
  });
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
