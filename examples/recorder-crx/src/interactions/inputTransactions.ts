/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import type { RecorderEventEnvelope, RecorderEventJournal } from '../capture/eventEnvelope';
import type { PageContextAfterSnapshot, PageContextSnapshot, StepContextSnapshot } from '../flow/pageContextTypes';
import type { BusinessFlow, FlowTarget } from '../flow/types';
import { inputTargetIdentityFromPageContext, inputTargetIdentityFromRecorderAction, normalizeKeys, targetAliasesOverlap } from './targetIdentity';
import type { InputTransaction, InputTransactionCommitReason, InputTransactionComposition } from './types';

type ActionLike = {
  name?: string;
  selector?: string;
  text?: string;
  value?: string;
  key?: string;
};

type RecorderPayload = {
  actionId?: string;
  rawAction?: unknown;
  wallTime?: number;
  sourceCode?: string;
};

type PageContextPayload = {
  id?: string;
  kind?: string;
  time?: number;
  wallTime?: number;
  before?: PageContextSnapshot & {
    ui?: PageContextSnapshot['ui'] & {
      targetTestId?: string;
      form?: {
        testId?: string;
        label?: string;
        name?: string;
        dataIndex?: string;
        placeholder?: string;
        valuePreview?: string;
      };
    };
  };
  after?: PageContextAfterSnapshot;
};

type OpenInputTransaction = Omit<InputTransaction, 'commitReason'> & {
  commitReason?: InputTransactionCommitReason;
};

export function composeInputTransactionsFromFlow(flow: BusinessFlow, options: { commitOpen?: boolean; commitReason?: InputTransactionCommitReason } = {}): InputTransactionComposition {
  const recorder = flow.artifacts?.recorder;
  const latestRecorderActions = new Map((recorder?.actionLog ?? []).map(entry => [entry.id, entry]));
  return composeInputTransactionsFromJournal(recorder?.eventJournal, options, latestRecorderActions);
}

export function composeInputTransactionsFromJournal(journal: RecorderEventJournal | undefined, options: { commitOpen?: boolean; commitReason?: InputTransactionCommitReason } = {}, latestRecorderActions: Map<string, { rawAction: unknown; sourceCode?: string; wallTime?: number }> = new Map()): InputTransactionComposition {
  if (!journal)
    return { inputTransactions: [], openInputTransactions: [] };

  const committed: InputTransaction[] = [];
  const openByTarget = new Map<string, OpenInputTransaction>();

  const openOrUpdate = (identity: NonNullable<ReturnType<typeof inputTargetIdentityFromPageContext>>, value: string | undefined, at: number, source: { eventId?: string; actionId?: string; contextEventId?: string; context?: StepContextSnapshot; target?: InputTransaction['target'] }) => {
    let transaction = findOpen(openByTarget, identity.aliases);
    if (!transaction) {
      if (value === undefined)
        return;
      commitUnrelatedOpenTransactions(identity, 'next-action', at);
      transaction = {
        id: transactionId(identity, at, source),
        type: 'input',
        targetKey: identity.targetKey,
        targetAliases: identity.aliases,
        field: identity.field,
        target: source.target,
        context: source.context,
        contextEventId: source.contextEventId,
        sourceEventIds: [],
        sourceActionIds: [],
        finalValue: value ?? '',
        startedAt: at,
        endedAt: at,
      };
      openByTarget.set(transaction.targetKey, transaction);
    }
    transaction.targetAliases = normalizeKeys([...(transaction.targetAliases ?? []), ...identity.aliases]);
    transaction.field = { ...identity.field, ...transaction.field, ...compactField(transaction.field, identity.field) };
    transaction.target = transaction.target ?? source.target;
    transaction.context = source.context ?? transaction.context;
    transaction.contextEventId = source.contextEventId ?? transaction.contextEventId;
    transaction.endedAt = Math.max(transaction.endedAt, at);
    if (source.eventId && !transaction.sourceEventIds.includes(source.eventId))
      transaction.sourceEventIds.push(source.eventId);
    if (source.actionId && !transaction.sourceActionIds.includes(source.actionId))
      transaction.sourceActionIds.push(source.actionId);
    if (value !== undefined)
      transaction.finalValue = value;
  };

  const commitOpenTransaction = (transaction: OpenInputTransaction, reason: InputTransactionCommitReason, at: number) => {
    transaction.endedAt = Math.max(transaction.endedAt, at);
    commitTransaction(openByTarget, committed, transaction, reason);
  };

  const commitUnrelatedOpenTransactions = (identity: { aliases: string[] }, reason: InputTransactionCommitReason, at: number) => {
    for (const transaction of Array.from(openByTarget.values())) {
      if (isInputTransactionForAliases(transaction, identity.aliases))
        continue;
      commitOpenTransaction(transaction, reason, at);
    }
  };

  const commitMatching = (identity: { aliases: string[] } | undefined, reason: InputTransactionCommitReason, at: number) => {
    if (!identity) {
      for (const transaction of Array.from(openByTarget.values()))
        commitOpenTransaction(transaction, reason, at);
      return;
    }
    const transaction = findOpen(openByTarget, identity.aliases);
    if (!transaction)
      return;
    commitOpenTransaction(transaction, reason, at);
  };

  const orderedEvents = journal.eventOrder
      .map((id, index) => ({ event: journal.eventsById[id], index }))
      .filter(({ event }) => !!event)
      .sort((left, right) => effectiveWallTime(left.event, latestRecorderActions) - effectiveWallTime(right.event, latestRecorderActions) || left.index - right.index);

  for (const { event } of orderedEvents) {
    let at = event.timestamp.wallTime;
    if (event.source === 'playwright-recorder') {
      const payload = event.payload as RecorderPayload;
      const latestAction = payload.actionId ? latestRecorderActions.get(payload.actionId) : undefined;
      const action = normalizeAction(latestAction?.rawAction ?? payload.rawAction);
      at = latestAction?.wallTime ?? at;
      const identity = scopedIdentity(inputTargetIdentityFromRecorderAction(action), dialogScopeFromSource(latestAction?.sourceCode ?? payload.sourceCode));
      if (isInputLikeRecorderAction(action)) {
        if (!identity)
          continue;
        openOrUpdate(identity, recorderActionValue(action), at, { actionId: payload.actionId });
        if (action.name === 'fill')
          continue;
        if (action.name === 'press' && isCommitKey(action.key))
          commitMatching(identity, 'blur', at);
        continue;
      }
      commitMatching(undefined, 'next-action', at);
      continue;
    }

    if (event.source === 'page-context') {
      const payload = event.payload as PageContextPayload;
      if (isSelectLikePageContext(payload)) {
        commitMatching(undefined, 'next-action', at);
        continue;
      }
      const identity = scopedIdentity(inputTargetIdentityFromPageContext(payload.before), pageContextDialogScope(payload.before));
      if (!identity)
        continue;
      if (payload.kind === 'input' || payload.kind === 'change') {
        const value = pageContextInputValue(payload);
        if (value !== undefined) {
          const context = pageContextStepContext(payload, at);
          openOrUpdate(identity, value, at, {
            eventId: event.id,
            contextEventId: payload.id,
            context,
            target: pageContextTarget(payload.before),
          });
        }
        if (payload.kind === 'change')
          commitMatching(identity, 'change', at);
        continue;
      }
      if (payload.kind === 'keydown') {
        // The sidecar deliberately strips raw key values from compact journal events.
        // Keydown facts can commit an already open transaction if the browser also
        // emitted an input/change event; they must never create standalone steps.
        continue;
      }
      commitMatching(undefined, 'next-action', at);
    }
  }

  const openInputTransactions = Array.from(openByTarget.values()).map(transaction => ({ ...transaction, commitReason: options.commitReason ?? 'stop-recording' }));
  if (options.commitOpen) {
    for (const transaction of openInputTransactions)
      commitTransaction(openByTarget, committed, transaction, options.commitReason ?? 'stop-recording');
    return { inputTransactions: committed, openInputTransactions: [] };
  }
  return { inputTransactions: committed, openInputTransactions };
}

export function isInputTransactionForAliases(transaction: Pick<InputTransaction, 'targetKey' | 'targetAliases'>, aliases: string[] | undefined) {
  return transaction.targetKey && aliases?.includes(transaction.targetKey) || targetAliasesOverlap(transaction.targetAliases, aliases);
}

function findOpen(openByTarget: Map<string, OpenInputTransaction>, aliases: string[]) {
  return Array.from(openByTarget.values()).find(transaction => isInputTransactionForAliases(transaction, aliases));
}

function transactionId(identity: { targetKey: string }, at: number, source: { eventId?: string; actionId?: string }) {
  const sourceId = source.eventId || source.actionId || 'local';
  return `input-tx-${stableIdPart(identity.targetKey)}-${Math.round(at)}-${stableIdPart(sourceId)}`;
}

function stableIdPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'field';
}

function commitTransaction(openByTarget: Map<string, OpenInputTransaction>, committed: InputTransaction[], transaction: OpenInputTransaction, reason: InputTransactionCommitReason) {
  openByTarget.delete(transaction.targetKey);
  committed.push({
    ...transaction,
    commitReason: reason,
  });
}

function compactField(previous: InputTransaction['field'], incoming: InputTransaction['field']) {
  return {
    testId: previous.testId || incoming.testId,
    label: previous.label || incoming.label,
    name: previous.name || incoming.name,
    placeholder: previous.placeholder || incoming.placeholder,
  };
}

function scopedIdentity<T extends { targetKey: string; aliases: string[] } | undefined>(identity: T, scope?: string): T {
  if (!identity || !scope)
    return identity;
  const suffix = `|dialog:${scope.replace(/\s+/g, ' ').trim().toLowerCase()}`;
  return {
    ...identity,
    targetKey: `${identity.targetKey}${suffix}`,
    aliases: identity.aliases.map(alias => `${alias}${suffix}`),
  };
}

function dialogScopeFromSource(sourceCode?: string) {
  const match = sourceCode?.match(/\.filter\(\{\s*hasText:\s*(?:"([^"]+)"|'([^']+)')\s*\}\)/);
  return match?.[1] || match?.[2];
}

function pageContextDialogScope(before?: PageContextPayload['before']) {
  const dialog = (before as { dialog?: { title?: string } } | undefined)?.dialog;
  return dialog?.title;
}

function isInputLikeRecorderAction(action: ActionLike) {
  if (action.name === 'fill')
    return true;
  if (action.name !== 'press')
    return false;
  const key = action.key || '';
  return key.length === 1 || /^(Backspace|Delete|Space|Tab|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Shift|CapsLock|Alt|Control|Meta)$/i.test(key);
}

function isCommitKey(key?: string) {
  return /^(Tab|Enter)$/i.test(key || '');
}

function recorderActionValue(action: ActionLike) {
  if (typeof action.text === 'string')
    return action.text;
  if (typeof action.value === 'string')
    return action.value;
  return undefined;
}

function pageContextInputValue(payload: PageContextPayload) {
  const value = payload.before?.ui?.form?.valuePreview;
  return typeof value === 'string' ? value : undefined;
}

function isSelectLikePageContext(payload: PageContextPayload) {
  const controlType = payload.before?.target?.controlType || payload.before?.ui?.component || payload.before?.ui?.form?.fieldKind || '';
  const role = payload.before?.target?.role || '';
  return /^(select|tree-select|cascader|select-option|tree-select-option|cascader-option)$/.test(controlType) || role === 'combobox' || role === 'option' || role === 'treeitem';
}

function effectiveWallTime(event: RecorderEventEnvelope, latestRecorderActions: Map<string, { wallTime?: number }>) {
  if (event.source === 'playwright-recorder') {
    const payload = event.payload as RecorderPayload;
    const latestWallTime = payload.actionId ? latestRecorderActions.get(payload.actionId)?.wallTime : undefined;
    if (typeof latestWallTime === 'number')
      return latestWallTime;
  }
  return event.timestamp.wallTime;
}

function pageContextStepContext(payload: PageContextPayload, at: number): StepContextSnapshot | undefined {
  if (!payload.before)
    return undefined;
  return {
    eventId: payload.id ?? `page-context:${at}`,
    capturedAt: at,
    before: payload.before,
    after: payload.after,
  };
}

function pageContextTarget(before?: PageContextPayload['before']): FlowTarget | undefined {
  if (!before)
    return undefined;
  const testId = before.target?.testId || before.ui?.targetTestId;
  const label = before.ui?.form?.label || before.form?.label || before.target?.ariaLabel;
  const name = before.ui?.form?.name || before.ui?.form?.dataIndex || before.form?.namePath?.join('.') || before.form?.name;
  const placeholder = before.ui?.form?.placeholder || before.target?.placeholder;
  const displayName = label || name || placeholder || before.target?.text || before.target?.normalizedText || testId;
  if (!testId && !label && !name && !placeholder && !displayName)
    return undefined;
  return {
    testId,
    label,
    name,
    placeholder,
    displayName,
    scope: {
      dialog: before.dialog,
      section: before.section,
      table: before.table,
      form: before.form ? {
        title: before.form.title,
        label: before.form.label,
        name: before.form.name,
        testId: before.form.testId,
      } : undefined,
    },
    raw: {
      pageContext: {
        target: before.target,
        form: before.form,
        ui: before.ui,
      },
    },
  };
}

function normalizeAction(rawAction: unknown): ActionLike {
  const raw = asRecord(rawAction);
  const action = asRecord(raw.action);
  return (Object.keys(action).length ? action : raw) as ActionLike;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}
