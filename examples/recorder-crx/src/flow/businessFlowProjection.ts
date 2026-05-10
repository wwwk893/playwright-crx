/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import { composeInputTransactionsFromFlow, isInputTransactionForAliases } from '../interactions/inputTransactions';
import type { InputTransaction } from '../interactions/types';
import { inputTargetIdentityFromFlowTarget } from '../interactions/targetIdentity';
import { cloneRecorderState, withRecorderState } from './recorderState';
import { nextStableStepId, recomputeOrders } from './stableIds';
import type { BusinessFlow, FlowAssertion, FlowStep, FlowTarget } from './types';

export function projectInputTransactionsIntoFlow(flow: BusinessFlow, options: { commitOpen?: boolean } = {}): BusinessFlow {
  const composition = composeInputTransactionsFromFlow(flow, { commitOpen: options.commitOpen ?? true, commitReason: 'stop-recording' });
  const transactions = composition.inputTransactions.filter(transaction => transaction.finalValue !== undefined);
  if (!transactions.length)
    return flow;

  const recorder = cloneRecorderState(flow);
  let steps = [...flow.steps];
  let changed = false;

  for (const transaction of transactions) {
    const index = steps.findIndex(step => stepMatchesTransaction(step, transaction));
    if (index >= 0) {
      const previous = steps[index];
      const next = projectTransactionOntoStep(previous, transaction);
      changed = changed || next !== previous;
      steps[index] = next;
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

function stepMatchesTransaction(step: FlowStep, transaction: InputTransaction) {
  if (!isLowLevelInputStep(step))
    return false;
  if (transaction.sourceActionIds.length)
    return !!step.sourceActionIds?.some(actionId => transaction.sourceActionIds.includes(actionId));
  const identity = inputTargetIdentityFromFlowTarget(step.target);
  return isInputTransactionForAliases(transaction, identity?.aliases);
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
  const fromTransaction = transaction.target ?? targetFromTransaction(transaction);
  if (!current)
    return fromTransaction;
  if (!fromTransaction)
    return current;
  return {
    ...current,
    testId: current.testId || fromTransaction.testId,
    label: current.label || fromTransaction.label,
    name: current.name || fromTransaction.name,
    placeholder: current.placeholder || fromTransaction.placeholder,
    displayName: current.displayName || fromTransaction.displayName,
    scope: current.scope || fromTransaction.scope,
    raw: {
      recorder: current.raw,
      inputTransaction: transaction,
    },
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
    displayName: field.label || field.name || field.placeholder || field.testId,
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
  if (target?.label)
    return `internal:label="${escapeSelectorValue(target.label)}"i`;
  if (target?.placeholder)
    return `internal:attr=[placeholder="${escapeSelectorValue(target.placeholder)}"i]`;
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
  if (target?.testId)
    return `page.getByTestId(${stringLiteral(target.testId)})`;
  if (target?.label)
    return `page.getByLabel(${stringLiteral(target.label)})`;
  if (target?.placeholder)
    return `page.getByPlaceholder(${stringLiteral(target.placeholder)})`;
  if (target?.selector)
    return `page.locator(${stringLiteral(target.selector)})`;
  if (target?.locator)
    return `page.locator(${stringLiteral(target.locator)})`;
  return `page.getByRole('textbox', { name: ${stringLiteral(target?.displayName || target?.name || '输入框')} })`;
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
