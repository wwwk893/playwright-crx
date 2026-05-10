/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import type { RecorderEventJournal, RecorderEventEnvelope } from '../capture/eventEnvelope';
import type { PageContextEvent, StepContextSnapshot } from '../flow/pageContextTypes';
import { cloneRecorderState, withRecorderState } from '../flow/recorderState';
import { nextStableStepId, recomputeOrders } from '../flow/stableIds';
import type { BusinessFlow, FlowStep, FlowTarget } from '../flow/types';

export type SelectTransactionComponent = 'Select' | 'TreeSelect' | 'Cascader';
export type SelectTransactionCommitReason = 'option-click' | 'dropdown-close' | 'stop-recording';

export interface SelectTransaction {
  id: string;
  type: 'select';
  component: SelectTransactionComponent;
  targetKey: string;
  targetAliases: string[];
  field: { testId?: string; label?: string; name?: string };
  searchText?: string;
  selectedText: string;
  optionPath?: string[];
  sourceEventIds: string[];
  sourceActionIds: string[];
  startedAt: number;
  endedAt: number;
  commitReason: SelectTransactionCommitReason;
  context?: StepContextSnapshot;
  target?: FlowTarget;
}

export interface OpenSelectTransaction extends Omit<SelectTransaction, 'selectedText' | 'commitReason'> {
  selectedText?: string;
  commitReason?: SelectTransactionCommitReason;
}

export interface SelectTransactionComposition {
  selectTransactions: SelectTransaction[];
  openSelectTransactions: OpenSelectTransaction[];
}

type ComposeSelectOptions = {
  commitOpen?: boolean;
  commitReason?: SelectTransactionCommitReason;
};

type PageContextPayload = PageContextEvent;

export function composeSelectTransactionsFromFlow(flow: BusinessFlow, options: ComposeSelectOptions = {}): SelectTransactionComposition {
  const journal = flow.artifacts?.recorder?.eventJournal;
  return journal ? composeSelectTransactionsFromJournal(journal, options) : { selectTransactions: [], openSelectTransactions: [] };
}

export function composeSelectTransactionsFromJournal(journal: RecorderEventJournal, options: ComposeSelectOptions = {}): SelectTransactionComposition {
  const openByTarget = new Map<string, OpenSelectTransaction>();
  const committed: SelectTransaction[] = [];

  const openTransaction = (identity: SelectIdentity, at: number, eventId: string, context?: StepContextSnapshot, target?: FlowTarget) => {
    commitUnrelatedOpenTransactions(identity, 'dropdown-close', at);
    const existing = findOpen(openByTarget, identity.aliases);
    if (existing) {
      existing.endedAt = Math.max(existing.endedAt, at);
      existing.context = context ?? existing.context;
      existing.target = target ?? existing.target;
      addUnique(existing.sourceEventIds, eventId);
      return existing;
    }
    const transaction: OpenSelectTransaction = {
      id: `select-tx-${stableIdPart(identity.targetKey)}-${Math.round(at)}-${stableIdPart(eventId)}`,
      type: 'select',
      component: identity.component,
      targetKey: identity.targetKey,
      targetAliases: identity.aliases,
      field: identity.field,
      sourceEventIds: [eventId],
      sourceActionIds: [],
      startedAt: at,
      endedAt: at,
      context,
      target,
    };
    openByTarget.set(identity.targetKey, transaction);
    return transaction;
  };

  const updateSearch = (identity: SelectIdentity, searchText: string | undefined, at: number, eventId: string, context?: StepContextSnapshot, target?: FlowTarget) => {
    const transaction = findOpen(openByTarget, identity.aliases) ?? openTransaction(identity, at, eventId, context, target);
    transaction.endedAt = Math.max(transaction.endedAt, at);
    transaction.searchText = searchText ?? transaction.searchText;
    transaction.context = context ?? transaction.context;
    transaction.target = target ?? transaction.target;
    addUnique(transaction.sourceEventIds, eventId);
  };

  const commitOption = (identity: SelectIdentity, selectedText: string | undefined, optionPath: string[] | undefined, at: number, eventId: string, context?: StepContextSnapshot, target?: FlowTarget) => {
    const transaction = findOpen(openByTarget, identity.aliases);
    if (!transaction)
      return;
    transaction.endedAt = Math.max(transaction.endedAt, at);
    transaction.selectedText = selectedText ?? transaction.selectedText;
    transaction.optionPath = optionPath ?? transaction.optionPath;
    transaction.component = identity.component;
    transaction.context = context ?? transaction.context;
    transaction.target = target ?? transaction.target;
    addUnique(transaction.sourceEventIds, eventId);
    commitOpenTransaction(transaction, 'option-click');
  };

  const commitOpenTransaction = (transaction: OpenSelectTransaction, reason: SelectTransactionCommitReason) => {
    openByTarget.delete(transaction.targetKey);
    if (!transaction.selectedText)
      return;
    committed.push({
      ...transaction,
      selectedText: transaction.selectedText,
      commitReason: reason,
    });
  };

  const commitUnrelatedOpenTransactions = (identity: SelectIdentity | undefined, reason: SelectTransactionCommitReason, at: number) => {
    for (const transaction of Array.from(openByTarget.values())) {
      if (identity && isSelectTransactionForAliases(transaction, identity.aliases))
        continue;
      transaction.endedAt = Math.max(transaction.endedAt, at);
      commitOpenTransaction(transaction, reason);
    }
  };

  const orderedEvents = journal.eventOrder
      .map((id, index) => ({ event: journal.eventsById[id], index }))
      .filter(({ event }) => !!event)
      .sort((left, right) => left.event.timestamp.wallTime - right.event.timestamp.wallTime || left.index - right.index);

  for (const { event } of orderedEvents) {
    if (event.source !== 'page-context') {
      commitUnrelatedOpenTransactions(undefined, 'dropdown-close', event.timestamp.wallTime);
      continue;
    }
    const payload = event.payload as PageContextPayload;
    const at = event.timestamp.wallTime;
    const identity = selectIdentityFromPageContext(payload);
    if (!identity) {
      if (payload.kind !== 'input')
        commitUnrelatedOpenTransactions(undefined, 'dropdown-close', at);
      continue;
    }
    const context = pageContextStepContext(payload, at);
    const target = selectTargetFromIdentity(identity);
    if (isSelectTrigger(payload)) {
      openTransaction(identity, at, event.id, context, target);
      continue;
    }
    if (isSelectSearch(payload)) {
      updateSearch(identity, pageContextSearchValue(payload), at, event.id, context, target);
      continue;
    }
    if (isSelectOption(payload)) {
      commitOption(identity, optionText(payload), optionPath(payload), at, event.id, context, target);
      continue;
    }
  }

  const openSelectTransactions = Array.from(openByTarget.values()).map(transaction => ({ ...transaction, commitReason: options.commitReason ?? 'stop-recording' }));
  if (options.commitOpen) {
    for (const transaction of openSelectTransactions)
      commitOpenTransaction(transaction, options.commitReason ?? 'stop-recording');
    return { selectTransactions: committed, openSelectTransactions: [] };
  }
  return { selectTransactions: committed, openSelectTransactions };
}

export function projectSelectTransactionsIntoFlow(flow: BusinessFlow, options: ComposeSelectOptions = {}): BusinessFlow {
  const composition = composeSelectTransactionsFromFlow(flow, options);
  const transactions = composition.selectTransactions
      .filter(transaction => transaction.selectedText)
      .sort((left, right) => left.startedAt - right.startedAt || left.endedAt - right.endedAt);
  if (!transactions.length)
    return flow;

  const recorder = cloneRecorderState(flow);
  let steps = flow.steps.slice();
  let changed = false;
  const usedTransactionIds = new Set(existingSelectTransactionIds(steps));

  for (const transaction of transactions) {
    if (usedTransactionIds.has(transaction.id))
      continue;
    const step = createSelectStep(recorder, transaction);
    const insertAt = insertionIndexForTransaction(steps, transaction);
    steps = [...steps.slice(0, insertAt), step, ...steps.slice(insertAt)];
    usedTransactionIds.add(transaction.id);
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

function createSelectStep(recorder: ReturnType<typeof cloneRecorderState>, transaction: SelectTransaction): FlowStep {
  const target = transaction.target ?? selectTargetFromTransaction(transaction);
  return {
    id: nextStableStepId(recorder),
    order: 0,
    kind: 'recorded',
    action: 'select',
    target,
    value: transaction.selectedText,
    context: transaction.context,
    uiRecipe: {
      kind: 'select-option',
      library: 'antd',
      component: uiComponentForTransaction(transaction),
      fieldKind: componentControlType(transaction.component),
      fieldLabel: transaction.field.label,
      fieldName: transaction.field.name,
      optionText: transaction.selectedText,
    },
    assertions: [{
      id: `${transaction.id}-selected`,
      type: 'selected-value-visible',
      subject: 'element',
      target,
      expected: transaction.selectedText,
      enabled: false,
    }],
    rawAction: {
      name: 'select',
      transactionId: transaction.id,
      searchText: transaction.searchText,
      selectedText: transaction.selectedText,
      optionPath: transaction.optionPath,
      sourceEventIds: transaction.sourceEventIds,
      wallTime: transaction.startedAt,
      endWallTime: transaction.endedAt,
    },
    sourceCode: selectSourceCode(transaction),
  };
}

function selectSourceCode(transaction: SelectTransaction) {
  const trigger = selectTriggerLocator(transaction);
  const option = selectOptionLocator(transaction);
  const fieldVariable = `selectField_${stableIdPart(transaction.id).replace(/-/g, '_').slice(0, 40)}`;
  const lines = [
    `const ${fieldVariable} = ${trigger};`,
    `await ${fieldVariable}.locator(${stringLiteral('.ant-select-selector, .ant-cascader-picker, .ant-select')}).first().click();`,
  ];
  if (transaction.searchText)
    lines.push(`await ${fieldVariable}.locator(${stringLiteral('input:visible')}).first().fill(${stringLiteral(transaction.searchText)});`);
  lines.push(`await ${option}.click();`);
  return lines.join('\n');
}

function selectTriggerLocator(transaction: SelectTransaction) {
  const label = transaction.field.label || transaction.field.name;
  if (label)
    return `page.locator(${stringLiteral('.ant-form-item')}).filter({ hasText: ${stringLiteral(label)} })`;
  if (transaction.field.testId)
    return `page.getByTestId(${stringLiteral(transaction.field.testId)})`;
  return 'page.locator(".ant-select-selector").last()';
}

function selectOptionLocator(transaction: SelectTransaction) {
  const text = transaction.optionPath?.[transaction.optionPath.length - 1] || transaction.selectedText;
  const popupRoot = 'page.locator(".ant-select-dropdown:visible, .ant-cascader-dropdown:visible").last()';
  return `${popupRoot}.getByText(${stringLiteral(text)}, { exact: true })`;
}

type SelectIdentity = {
  component: SelectTransactionComponent;
  targetKey: string;
  aliases: string[];
  field: SelectTransaction['field'];
};

function selectIdentityFromPageContext(payload: PageContextPayload): SelectIdentity | undefined {
  if (!isSelectTrigger(payload) && !isSelectSearch(payload) && !isSelectOption(payload))
    return undefined;
  const field = selectField(payload);
  if (!field.testId && !field.label && !field.name)
    return undefined;
  const component = componentFromPayload(payload);
  const aliases = unique([
    field.testId && `testid:${field.testId}`,
    field.label && `label:${normalize(field.label)}`,
    field.name && `name:${normalize(field.name)}`,
    `${component.toLowerCase()}:${normalize(field.label || field.name || field.testId || '')}`,
  ].filter(Boolean) as string[]);
  const targetKey = aliases[0] || `${component.toLowerCase()}:unknown`;
  return { component, targetKey, aliases, field };
}

function selectField(payload: PageContextPayload): SelectTransaction['field'] {
  return {
    testId: payload.before.form?.testId || payload.before.ui?.form?.testId || payload.before.target?.testId,
    label: payload.before.form?.label || payload.before.ui?.form?.label,
    name: payload.before.form?.name || payload.before.ui?.form?.name,
  };
}

function isSelectTrigger(payload: PageContextPayload) {
  const controlType = payload.before.target?.controlType || '';
  const role = payload.before.target?.role || '';
  return payload.kind === 'click' && /^(select|tree-select|cascader)$/.test(controlType) || payload.kind === 'click' && role === 'combobox';
}

function isSelectSearch(payload: PageContextPayload) {
  const controlType = payload.before.target?.controlType || payload.before.ui?.component || payload.before.ui?.form?.fieldKind || '';
  const role = payload.before.target?.role || '';
  return payload.kind === 'input' && (/^(select|tree-select|cascader)$/.test(controlType) || role === 'combobox');
}

function isSelectOption(payload: PageContextPayload) {
  const controlType = payload.before.target?.controlType || '';
  const role = payload.before.target?.role || '';
  return payload.kind === 'click' && (/^(select-option|tree-select-option|cascader-option)$/.test(controlType) || role === 'option' || role === 'treeitem');
}

function componentFromPayload(payload: PageContextPayload): SelectTransactionComponent {
  const controlType = payload.before.target?.controlType || payload.before.ui?.component || payload.before.ui?.form?.fieldKind || '';
  if (/tree-select/.test(controlType))
    return 'TreeSelect';
  if (/cascader/.test(controlType))
    return 'Cascader';
  const label = payload.before.form?.label || payload.before.ui?.form?.label || '';
  if (/范围/.test(label))
    return 'TreeSelect';
  if (/路径/.test(label))
    return 'Cascader';
  return 'Select';
}

function optionText(payload: PageContextPayload) {
  return payload.before.target?.selectedOption || payload.before.ui?.option?.text || payload.before.target?.text || payload.before.target?.normalizedText || payload.before.target?.title;
}

function optionPath(payload: PageContextPayload) {
  const path = payload.before.target?.optionPath || payload.before.ui?.option?.path;
  return path?.length ? path : undefined;
}

function pageContextSearchValue(payload: PageContextPayload) {
  const value = payload.before.ui?.form?.valuePreview;
  return typeof value === 'string' ? value : undefined;
}

function pageContextStepContext(payload: PageContextPayload, at: number): StepContextSnapshot {
  return {
    eventId: payload.id,
    capturedAt: at,
    before: payload.before,
    after: payload.after,
  };
}

function selectTargetFromIdentity(identity: SelectIdentity): FlowTarget {
  return {
    role: 'combobox',
    label: identity.field.label,
    name: identity.field.label || identity.field.name,
    displayName: identity.field.label || identity.field.name || identity.field.testId,
    testId: identity.field.testId,
    scope: { form: identity.field },
  };
}

function selectTargetFromTransaction(transaction: SelectTransaction): FlowTarget {
  return {
    role: 'combobox',
    label: transaction.field.label,
    name: transaction.field.label || transaction.field.name,
    displayName: transaction.field.label || transaction.field.name || transaction.field.testId,
    testId: transaction.field.testId,
    scope: { form: transaction.field },
  };
}

function insertionIndexForTransaction(steps: FlowStep[], transaction: SelectTransaction) {
  let insertAt = 0;
  let sawComparableWallTime = false;
  for (let index = 0; index < steps.length; index++) {
    const wallTime = stepTime(steps[index]);
    if (typeof wallTime !== 'number') {
      if (sawComparableWallTime)
        insertAt = index + 1;
      continue;
    }
    sawComparableWallTime = true;
    if (wallTime > transaction.endedAt)
      return insertAt;
    insertAt = index + 1;
  }
  return sawComparableWallTime ? insertAt : steps.length;
}

function stepTime(step: FlowStep): number | undefined {
  const raw = step.rawAction as { wallTime?: number; endWallTime?: number; action?: { wallTime?: number; endWallTime?: number } } | undefined;
  return raw?.endWallTime ?? raw?.wallTime ?? raw?.action?.endWallTime ?? raw?.action?.wallTime ?? step.context?.capturedAt;
}

function existingSelectTransactionIds(steps: FlowStep[]) {
  return steps.map(step => (step.rawAction as { transactionId?: string } | undefined)?.transactionId).filter(Boolean) as string[];
}

export function isSelectTransactionForAliases(transaction: Pick<SelectTransaction, 'targetKey' | 'targetAliases'>, aliases: string[] | undefined) {
  return transaction.targetKey && aliases?.includes(transaction.targetKey) || aliasesOverlap(transaction.targetAliases, aliases);
}

function findOpen(openByTarget: Map<string, OpenSelectTransaction>, aliases: string[]) {
  return Array.from(openByTarget.values()).find(transaction => isSelectTransactionForAliases(transaction as SelectTransaction, aliases));
}

function aliasesOverlap(left: string[] | undefined, right: string[] | undefined) {
  return !!left?.some(value => right?.includes(value));
}

function addUnique(values: string[], value: string) {
  if (!values.includes(value))
    values.push(value);
}

function stableIdPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'select';
}

function normalize(value: string) {
  return value.trim().replace(/\s+/g, '').toLowerCase();
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function popupFieldLabel(value?: string) {
  return value?.replace(/^[*＊]\s*/, '').trim();
}

function uiComponentForTransaction(transaction: SelectTransaction) {
  switch (transaction.component) {
    case 'TreeSelect': return 'tree-select';
    case 'Cascader': return 'cascader';
    default: return 'select';
  }
}

function componentControlType(component: SelectTransactionComponent) {
  switch (component) {
    case 'TreeSelect': return 'tree-select';
    case 'Cascader': return 'cascader';
    default: return 'select';
  }
}

function stringLiteral(value: string) {
  return JSON.stringify(value);
}
