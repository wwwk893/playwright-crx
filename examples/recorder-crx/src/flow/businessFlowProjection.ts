/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import { composeInputTransactionsFromFlow, isInputTransactionForIdentity } from '../interactions/inputTransactions';
import { projectSelectTransactionsIntoFlow } from '../interactions/selectTransactions';
import type { InputTransaction } from '../interactions/types';
import { inputTargetIdentityFromFlowTarget } from '../interactions/targetIdentity';
import { cloneRecorderState, withRecorderState } from './recorderState';
import { nextStableStepId, recomputeOrders } from './stableIds';
import type { BusinessFlow, FlowAssertion, FlowStep, FlowTarget } from './types';

export type BusinessFlowProjectionOptions = {
  commitOpen?: boolean;
};

export function projectBusinessFlow(flow: BusinessFlow, options: BusinessFlowProjectionOptions = {}): BusinessFlow {
  const commitOpen = options.commitOpen ?? true;
  return projectSelectTransactionsIntoFlow(projectInputTransactionsIntoFlow(flow, { commitOpen }), { commitOpen });
}

export function projectInputTransactionsIntoFlow(flow: BusinessFlow, options: { commitOpen?: boolean } = {}): BusinessFlow {
  const composition = composeInputTransactionsFromFlow(flow, { commitOpen: options.commitOpen ?? true, commitReason: 'stop-recording' });
  const transactions = composition.inputTransactions
      .filter(transaction => transaction.finalValue !== undefined)
      .sort((left, right) => left.startedAt - right.startedAt || left.endedAt - right.endedAt || left.id.localeCompare(right.id));
  if (!transactions.length)
    return flow;

  const recorder = cloneRecorderState(flow);
  let steps = [...flow.steps];
  let changed = false;
  const usedStepIds = new Set<string>();

  for (const transaction of transactions) {
    const index = findStepForTransaction(steps, transaction, usedStepIds);
    if (index >= 0) {
      const previous = steps[index];
      const next = projectTransactionOntoStep(previous, transaction);
      changed = changed || next !== previous;
      steps[index] = next;
      usedStepIds.add(next.id);
      const sourceActionIds = new Set(transaction.sourceActionIds);
      steps = steps.filter((step, stepIndex) => {
        if (stepIndex === index)
          return true;
        if (!isLowLevelInputStep(step))
          return true;
        if (step.sourceActionIds?.some(actionId => sourceActionIds.has(actionId))) {
          changed = true;
          return false;
        }
        return true;
      });
      continue;
    }

    if (transaction.sourceActionIds.length)
      continue;

    const step = createFillStepFromTransaction(recorder, transaction, nextAssertionIndex(steps));
    const insertAt = insertionIndexForTransaction(steps, transaction);
    steps = [...steps.slice(0, insertAt), step, ...steps.slice(insertAt)];
    usedStepIds.add(step.id);
    changed = true;
  }

  if (!changed)
    return flow;

  return withRecorderState({
    ...flow,
    steps: recomputeOrders(steps),
    updatedAt: new Date().toISOString(),
  }, recorder);
}

function projectTransactionOntoStep(step: FlowStep, transaction: InputTransaction): FlowStep {
  const target = mergeTarget(step.target, transaction);
  const sourceActionIds = unique([...(step.sourceActionIds ?? []), ...transaction.sourceActionIds]);
  const assertions = updateValueAssertions(step.assertions.length ? step.assertions : [valueAssertion(nextAssertionIdFromStep(step), target, transaction.finalValue)], target, step.value, transaction.finalValue);
  const next: FlowStep = {
    ...step,
    action: 'fill',
    target,
    value: transaction.finalValue,
    context: transaction.context ?? step.context,
    sourceActionIds,
    assertions,
    rawAction: inputRawAction(step.rawAction, transaction, target),
    sourceCode: sourceCodeForProjectedStep(step, transaction, target),
  };
  return shallowStepEqual(step, next) ? step : next;
}

function createFillStepFromTransaction(recorder: ReturnType<typeof cloneRecorderState>, transaction: InputTransaction, assertionIndex: number): FlowStep {
  const target = transaction.target ?? targetFromTransaction(transaction);
  const id = nextStableStepId(recorder);
  return {
    id,
    order: 0,
    kind: 'recorded',
    sourceActionIds: [...transaction.sourceActionIds],
    action: 'fill',
    intent: transaction.field.label ? `填写${transaction.field.label}` : '',
    intentSource: transaction.field.label ? 'rule' : undefined,
    comment: '由输入事务合并为一个填写步骤。',
    context: transaction.context,
    target,
    value: transaction.finalValue,
    assertions: [valueAssertion(`a${String(assertionIndex + 1).padStart(3, '0')}`, target, transaction.finalValue)],
    rawAction: inputRawAction(undefined, transaction, target),
    sourceCode: fillSourceCode(target, transaction.finalValue),
  };
}

function findStepForTransaction(steps: FlowStep[], transaction: InputTransaction, usedStepIds: Set<string>) {
  return steps.findIndex(step => {
    if (usedStepIds.has(step.id))
      return false;
    return stepMatchesTransaction(step, transaction);
  });
}

function stepMatchesTransaction(step: FlowStep, transaction: InputTransaction) {
  if (!isLowLevelInputStep(step))
    return false;
  if (transaction.sourceActionIds.length)
    return !!step.sourceActionIds?.some(actionId => transaction.sourceActionIds.includes(actionId));
  const existingTransactionId = inputTransactionIdForStep(step);
  if (existingTransactionId)
    return existingTransactionId === transaction.id;
  const at = stepWallTime(step);
  if (at !== undefined && (at < transaction.startedAt - 50 || at > transaction.endedAt + 50))
    return false;
  const identity = inputTargetIdentityFromFlowTarget(step.target);
  return isInputTransactionForIdentity(transaction, identity);
}

function inputTransactionIdForStep(step: FlowStep) {
  const raw = recordFromUnknown(step.rawAction);
  const value = raw.inputTransactionId;
  return typeof value === 'string' ? value : undefined;
}

function isLowLevelInputStep(step: FlowStep) {
  return step.action === 'fill' || step.action === 'press';
}

function insertionIndexForTransaction(steps: FlowStep[], transaction: InputTransaction) {
  const transactionAt = transaction.startedAt;
  const index = steps.findIndex(step => {
    const at = stepWallTime(step);
    return at !== undefined && at > transactionAt;
  });
  return index === -1 ? steps.length : index;
}

function stepWallTime(step: FlowStep) {
  if (typeof step.context?.capturedAt === 'number')
    return step.context.capturedAt;
  const raw = recordFromUnknown(step.rawAction);
  const action = recordFromUnknown(raw.action);
  for (const value of [raw.wallTime, raw.endWallTime, action.wallTime, action.endWallTime]) {
    if (typeof value === 'number' && Number.isFinite(value))
      return value;
  }
  return undefined;
}

function mergeTarget(current: FlowTarget | undefined, transaction: InputTransaction): FlowTarget | undefined {
  const fromTransaction = targetWithFieldEvidence(transaction.target, transaction.field) ?? targetFromTransaction(transaction);
  if (!current)
    return fromTransaction;
  if (!fromTransaction)
    return current;
  return {
    ...current,
    testId: fromTransaction.testId || current.testId,
    label: strongerText(current.label, fromTransaction.label),
    name: fromTransaction.name || current.name,
    placeholder: strongerText(current.placeholder, fromTransaction.placeholder),
    displayName: strongerText(current.displayName, fromTransaction.displayName),
    scope: mergeScope(fromTransaction.scope, current.scope),
    raw: {
      recorder: current.raw,
      inputTransaction: transaction,
      pageContext: rawPageContextFromTarget(fromTransaction),
    },
  };
}

function targetWithFieldEvidence(target: FlowTarget | undefined, field: InputTransaction['field']): FlowTarget | undefined {
  if (!target)
    return undefined;
  return {
    ...target,
    testId: target.testId || field.testId,
    label: strongerText(target.label, field.label),
    name: target.name || field.name,
    placeholder: strongerText(target.placeholder, field.placeholder),
    displayName: strongestDisplayName(target.displayName, field.label, field.name, field.placeholder, field.testId),
  };
}

function mergeScope(current: FlowTarget['scope'] | undefined, incoming: FlowTarget['scope'] | undefined): FlowTarget['scope'] | undefined {
  if (!current)
    return incoming;
  if (!incoming)
    return current;
  return {
    ...current,
    dialog: current.dialog ?? incoming.dialog,
    section: current.section ?? incoming.section,
    table: current.table ?? incoming.table,
    form: current.form ?? incoming.form,
  };
}

function targetFromTransaction(transaction: InputTransaction): FlowTarget | undefined {
  const { field } = transaction;
  if (!field.testId && !field.label && !field.name && !field.placeholder)
    return undefined;
  return {
    testId: field.testId,
    label: field.label,
    name: field.name,
    placeholder: field.placeholder,
    displayName: strongestDisplayName(field.label, field.name, field.placeholder, field.testId),
    scope: field.label || field.name || field.testId ? {
      form: {
        label: field.label,
        name: field.name,
        testId: field.testId,
      },
    } : undefined,
    raw: { inputTransaction: transaction },
  };
}

function inputRawAction(previous: unknown, transaction: InputTransaction, target: FlowTarget | undefined) {
  const record = typeof previous === 'object' && previous ? previous as Record<string, unknown> : {};
  const previousAction = typeof record.action === 'object' && record.action ? record.action as Record<string, unknown> : {};
  return {
    ...record,
    action: {
      ...previousAction,
      name: 'fill',
      selector: typeof previousAction.selector === 'string' ? previousAction.selector : selectorFromTarget(target),
      text: transaction.finalValue,
      value: transaction.finalValue,
    },
    inputTransactionId: transaction.id,
    inputTransactionSourceEventIds: transaction.sourceEventIds,
  };
}

function selectorFromTarget(target: FlowTarget | undefined) {
  if (target?.testId)
    return `internal:testid=[data-testid="${escapeSelectorValue(target.testId)}"s]`;
  if (target?.placeholder)
    return `internal:attr=[placeholder="${escapeSelectorValue(target.placeholder)}"i]`;
  if (target?.name)
    return `input[name="${escapeSelectorValue(target.name)}"]`;
  if (target?.label)
    return `internal:label="${escapeSelectorValue(target.label)}"i`;
  return target?.selector || target?.locator;
}

function escapeSelectorValue(value: string) {
  return value.replace(/"/g, '\\"');
}

function updateValueAssertions(assertions: FlowAssertion[], target: FlowTarget | undefined, previousValue: string | undefined, nextValue: string) {
  if (!assertions.some(assertion => assertion.type === 'valueEquals'))
    return [...assertions, valueAssertion(nextAssertionId(assertions), target, nextValue)];
  return assertions.map(assertion => {
    if (assertion.type !== 'valueEquals')
      return assertion;
    if (assertion.expected && assertion.expected !== previousValue)
      return assertion;
    return {
      ...assertion,
      target: assertion.target ?? target,
      expected: nextValue,
    };
  });
}

function valueAssertion(id: string, target: FlowTarget | undefined, expected: string): FlowAssertion {
  return {
    id,
    type: 'valueEquals',
    subject: 'element',
    target,
    expected,
    enabled: false,
  };
}

function nextAssertionId(assertions: FlowAssertion[]) {
  const next = assertions.reduce((max, assertion) => {
    const numeric = Number(assertion.id.replace(/^a/, ''));
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, assertions.length) + 1;
  return `a${String(next).padStart(3, '0')}`;
}

function nextAssertionIdFromStep(step: FlowStep) {
  return nextAssertionId(step.assertions);
}

function nextAssertionIndex(steps: FlowStep[]) {
  return steps.reduce((max, step) => step.assertions.reduce((inner, assertion) => {
    const numeric = Number(assertion.id.replace(/^a/, ''));
    return Number.isFinite(numeric) ? Math.max(inner, numeric) : inner;
  }, max), 0);
}

function fillSourceCode(target: FlowTarget | undefined, value: string) {
  const locator = fillLocator(target);
  return `await ${locator}.fill(${stringLiteral(value)});`;
}

function sourceCodeForProjectedStep(step: FlowStep, transaction: InputTransaction, target: FlowTarget | undefined) {
  if (shouldRegenerateFillSource(step, target))
    return fillSourceCode(target, transaction.finalValue);
  return replaceFillValue(step.sourceCode, transaction.finalValue) || step.sourceCode || fillSourceCode(target, transaction.finalValue);
}

function replaceFillValue(sourceCode: string | undefined, value: string) {
  if (!sourceCode || !/\.fill\(/.test(sourceCode))
    return undefined;
  return sourceCode.replace(/\.fill\(\s*([`"'])(?:\\.|(?!\1)[\s\S])*\1\s*\)/, (_match, quote: string) => `.fill(${quotedString(value, quote)})`);
}

function quotedString(value: string, quote: string) {
  if (quote === '`')
    return `\`${value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\``;
  return `${quote}${value.replace(/\\/g, '\\\\').replace(new RegExp(quote, 'g'), `\\${quote}`)}${quote}`;
}

function fillLocator(target: FlowTarget | undefined) {
  if (target?.testId && isLikelyFieldWrapperTarget(target) && target.placeholder)
    return `page.getByTestId(${stringLiteral(target.testId)}).getByPlaceholder(${stringLiteral(target.placeholder)})`;
  if (target?.testId && isLikelyFieldWrapperTarget(target) && target.name)
    return `page.getByTestId(${stringLiteral(target.testId)}).locator(${stringLiteral(fieldNameInputSelector(target.name))}).first()`;
  if (target?.testId && isLikelyFieldWrapperTarget(target))
    return `page.getByTestId(${stringLiteral(target.testId)}).locator(${stringLiteral('input:visible, textarea:visible, [contenteditable="true"]')}).first()`;
  if (target?.testId)
    return `page.getByTestId(${stringLiteral(target.testId)})`;
  if (target?.placeholder)
    return `page.getByPlaceholder(${stringLiteral(target.placeholder)})`;
  if (target?.name)
    return `page.locator(${stringLiteral(fieldNameInputSelector(target.name))}).first()`;
  if (target?.label)
    return `page.getByLabel(${stringLiteral(target.label)})`;
  if (target?.selector)
    return `page.locator(${stringLiteral(target.selector)})`;
  if (target?.locator)
    return `page.locator(${stringLiteral(target.locator)})`;
  return `page.getByRole('textbox', { name: ${stringLiteral(target?.displayName || target?.name || '输入框')} })`;
}

function shouldRegenerateFillSource(step: FlowStep, target: FlowTarget | undefined) {
  if (!step.sourceCode || !target)
    return false;
  if (!/getByLabel|getByRole\(["']textbox|internal:label|internal:role=textbox/.test(step.sourceCode))
    return false;
  const sourceName = weakFillSourceName(step.sourceCode);
  if (!sourceName)
    return !!(target.testId && (target.placeholder || target.name));
  const normalizedSource = normalizeComparableText(sourceName);
  const targetTexts = [target.placeholder, target.name, target.testId ? target.label : undefined].filter(Boolean) as string[];
  if (targetTexts.some(text => normalizeComparableText(text) === normalizedSource))
    return false;
  return targetTexts.some(text => {
    const normalizedTarget = normalizeComparableText(text);
    return normalizedTarget.startsWith(normalizedSource) || normalizedSource.startsWith(normalizedTarget);
  });
}

function weakFillSourceName(sourceCode: string) {
  const getByLabel = sourceCode.match(/getByLabel\((["'`])((?:\\.|(?!\1)[\s\S])*)\1\)/);
  if (getByLabel)
    return unescapeSourceString(getByLabel[2]);
  const getByTextbox = sourceCode.match(/getByRole\((["'`])textbox\1,\s*\{\s*name:\s*(["'`])((?:\\.|(?!\2)[\s\S])*)\2/);
  if (getByTextbox)
    return unescapeSourceString(getByTextbox[3]);
  const internalLabel = sourceCode.match(/internal:label=(?:\\"|")([^\\"]+)(?:\\"|")/);
  if (internalLabel)
    return unescapeSourceString(internalLabel[1]);
  const internalTextbox = sourceCode.match(/internal:role=textbox\[name=(?:\\"|")([^\\"]+)(?:\\"|")(?:i|s)?\]/);
  return internalTextbox ? unescapeSourceString(internalTextbox[1]) : undefined;
}

function unescapeSourceString(value: string) {
  return value.replace(/\\(["'`])/g, '$1');
}

function strongestDisplayName(...values: Array<string | undefined>) {
  return values.reduce<string | undefined>((current, value) => strongerText(current, value), undefined);
}

function strongerText(previous?: string, incoming?: string) {
  if (!previous)
    return incoming;
  if (!incoming)
    return previous;
  const normalizedPrevious = normalizeComparableText(previous);
  const normalizedIncoming = normalizeComparableText(incoming);
  if (normalizedIncoming.startsWith(normalizedPrevious) && normalizedIncoming.length > normalizedPrevious.length)
    return incoming;
  if (normalizedPrevious.startsWith(normalizedIncoming) && normalizedPrevious.length > normalizedIncoming.length)
    return previous;
  return previous;
}

function fieldNameInputSelector(name: string) {
  const escaped = cssAttributeValue(name);
  return `input[name="${escaped}"], textarea[name="${escaped}"]`;
}

function isLikelyFieldWrapperTarget(target: FlowTarget) {
  if (!target.testId)
    return false;
  if (looksLikeStructuralFormTestId(target.testId))
    return false;
  if (looksLikeActualControlTestId(target.testId))
    return false;
  if (targetHasActualControlTestId(target))
    return false;
  const raw = recordFromUnknown(target.raw);
  const pageContext = recordFromUnknown(rawPageContextFromTargetRaw(raw));
  const form = recordFromUnknown(pageContext.form);
  const ui = recordFromUnknown(pageContext.ui);
  const uiForm = recordFromUnknown(ui.form);
  return !!Object.keys(pageContext).length && target.scope?.form?.testId === target.testId ||
    form.testId === target.testId ||
    uiForm.testId === target.testId;
}

function targetHasActualControlTestId(target: FlowTarget) {
  const pageContext = recordFromUnknown(rawPageContextFromTargetRaw(target.raw));
  const contextTarget = recordFromUnknown(pageContext.target);
  if (contextTarget.testId === target.testId)
    return isActualTextControl(contextTarget, target.role);
  const hasObservedWrapper = pageContextFormTestId(pageContext) === target.testId;
  if (hasObservedWrapper || !target.testId)
    return false;
  return isActualTextControl(target);
}

function rawPageContextFromTargetRaw(raw: unknown, depth = 0): unknown {
  if (!raw || typeof raw !== 'object' || depth > 4)
    return undefined;
  const record = raw as { pageContext?: unknown; incoming?: unknown; previous?: unknown; inputTransaction?: { target?: { raw?: unknown } } };
  return record.pageContext ||
    rawPageContextFromTargetRaw(record.inputTransaction?.target?.raw, depth + 1) ||
    rawPageContextFromTargetRaw(record.incoming, depth + 1) ||
    rawPageContextFromTargetRaw(record.previous, depth + 1);
}

function pageContextFormTestId(pageContext: Record<string, unknown>) {
  const form = recordFromUnknown(pageContext.form);
  const ui = recordFromUnknown(pageContext.ui);
  const uiForm = recordFromUnknown(ui.form);
  return form.testId || uiForm.testId;
}

function isActualTextControl(target: { role?: unknown; controlType?: unknown; tag?: unknown }, fallbackRole?: string) {
  const role = String(target.role || fallbackRole || '');
  const controlType = String(target.controlType || '');
  const tag = String(target.tag || '').toLowerCase();
  return role === 'textbox' || /^(input|textarea)$/.test(tag) || /^(input|textarea|text|number|password)$/.test(controlType);
}

function looksLikeActualControlTestId(testId: string) {
  return /(^|[-_])(input|textarea|textbox|digit|number|password)([-_]|$)/i.test(testId);
}

function looksLikeStructuralFormTestId(testId: string) {
  return /(^|[-_])(modal|dialog|drawer|form|container|wrapper|root)([-_]|$)/i.test(testId);
}

function rawPageContextFromTarget(target: FlowTarget | undefined) {
  const raw = recordFromUnknown(target?.raw);
  return raw.pageContext;
}

function cssAttributeValue(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function normalizeComparableText(value?: string) {
  return value?.replace(/\s+/g, ' ').trim().toLowerCase() || '';
}

function shallowStepEqual(left: FlowStep, right: FlowStep) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function stringLiteral(value: unknown) {
  return JSON.stringify(String(value ?? ''));
}
