/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import type { RecorderEventEnvelope, RecorderEventJournal } from '../capture/eventEnvelope';
import type { PageContextAfterSnapshot, PageContextSnapshot, StepContextSnapshot } from '../flow/pageContextTypes';
import type { BusinessFlow, FlowTarget } from '../flow/types';
import { inputTargetIdentitiesCompatible, inputTargetIdentityFromPageContext, inputTargetIdentityFromRecorderAction, normalizeKeys, targetAliasesOverlap, type TargetIdentity } from './targetIdentity';
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

type PendingInputFocus = {
  identity: TargetIdentity;
  target?: InputTransaction['target'];
  context?: StepContextSnapshot;
  contextEventId?: string;
  at: number;
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
  const pendingInputFocuses: PendingInputFocus[] = [];

  const openOrUpdate = (identity: TargetIdentity, value: string | undefined, at: number, source: { eventId?: string; actionId?: string; contextEventId?: string; context?: StepContextSnapshot; target?: InputTransaction['target'] }) => {
    let transaction = findOpen(openByTarget, identity);
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
    if (shouldPromoteTransactionIdentity(transaction, identity)) {
      openByTarget.delete(transaction.targetKey);
      transaction.targetKey = identity.targetKey;
      openByTarget.set(transaction.targetKey, transaction);
    }
    transaction.targetAliases = normalizeKeys([...(transaction.targetAliases ?? []), ...identity.aliases]);
    transaction.field = mergeInputFieldEvidence(transaction.field, identity.field);
    transaction.target = mergeInputTargetEvidence(transaction.target, source.target);
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

  const commitUnrelatedOpenTransactions = (identity: TargetIdentity, reason: InputTransactionCommitReason, at: number) => {
    for (const transaction of Array.from(openByTarget.values())) {
      if (isInputTransactionForIdentity(transaction, identity))
        continue;
      commitOpenTransaction(transaction, reason, at);
    }
  };

  const commitMatching = (identity: TargetIdentity | undefined, reason: InputTransactionCommitReason, at: number) => {
    if (!identity) {
      for (const transaction of Array.from(openByTarget.values()))
        commitOpenTransaction(transaction, reason, at);
      return;
    }
    const transaction = findOpen(openByTarget, identity);
    if (!transaction)
      return;
    commitOpenTransaction(transaction, reason, at);
  };

  const commitNextActionBoundary = (at: number) => {
    clearPendingInputFocusesForNextAction(pendingInputFocuses);
    commitMatching(undefined, 'next-action', at);
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
      const sourceCode = latestAction?.sourceCode ?? payload.sourceCode;
      at = latestAction?.wallTime ?? at;
      const identity = scopedIdentity(inputTargetIdentityFromRecorderAction(action), dialogScopeFromSource(sourceCode));
      if (isSelectLikeRecorderAction(action, sourceCode)) {
        commitNextActionBoundary(at);
        continue;
      }
      if (isInputLikeRecorderAction(action)) {
        if (!identity)
          continue;
        const focus = action.name === 'fill' ? findCompatiblePendingInputFocus(pendingInputFocuses, identity, at) : undefined;
        if (focus)
          removePendingInputFocus(pendingInputFocuses, focus);
        const mergedIdentity = mergeInputIdentities(focus?.identity, identity);
        openOrUpdate(mergedIdentity, recorderActionValue(action), at, {
          actionId: payload.actionId,
          contextEventId: focus?.contextEventId,
          context: focus?.context,
          target: focus?.target,
        });
        if (action.name === 'fill')
          continue;
        if (action.name === 'press' && isCommitKey(action.key))
          commitMatching(identity, 'blur', at);
        continue;
      }
      commitNextActionBoundary(at);
      continue;
    }

    if (event.source === 'page-context') {
      const payload = event.payload as PageContextPayload;
      if (isSelectLikePageContext(payload)) {
        commitNextActionBoundary(at);
        continue;
      }
      const identity = scopedIdentity(inputTargetIdentityFromPageContext(payload.before), pageContextDialogScope(payload.before));
      if (!identity) {
        if (payload.kind !== 'keydown')
          commitNextActionBoundary(at);
        continue;
      }
      if (payload.kind === 'click' && isInputFocusContext(payload)) {
        const existing = findOpenForFocus(openByTarget, identity);
        if (existing) {
          openOrUpdate(identity, undefined, at, {
            contextEventId: payload.id,
            context: pageContextStepContext(payload, at),
            target: pageContextTarget(payload.before),
          });
          continue;
        }
        pendingInputFocuses.push({
          identity,
          target: pageContextTarget(payload.before),
          context: pageContextStepContext(payload, at),
          contextEventId: payload.id,
          at,
        });
        pruneOldPendingInputFocuses(pendingInputFocuses, at);
        continue;
      }
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
      commitNextActionBoundary(at);
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

export function isInputTransactionForIdentity(transaction: Pick<InputTransaction, 'targetKey' | 'targetAliases' | 'field'>, identity: TargetIdentity | undefined) {
  return inputTargetIdentitiesCompatible({
    targetKey: transaction.targetKey,
    aliases: transaction.targetAliases,
    field: transaction.field,
  }, identity);
}

function findOpen(openByTarget: Map<string, OpenInputTransaction>, identity: TargetIdentity) {
  return Array.from(openByTarget.values()).find(transaction => isInputTransactionForIdentity(transaction, identity));
}

function findOpenForFocus(openByTarget: Map<string, OpenInputTransaction>, identity: TargetIdentity) {
  return Array.from(openByTarget.values()).find(transaction => isInputTransactionForIdentity(transaction, identity) ||
    singleFocusFallbackCompatible(identity, transactionIdentity(transaction)));
}

function transactionIdentity(transaction: Pick<InputTransaction, 'targetKey' | 'targetAliases' | 'field'>): TargetIdentity {
  return {
    targetKey: transaction.targetKey,
    aliases: transaction.targetAliases ?? [],
    field: transaction.field,
  };
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

function shouldPromoteTransactionIdentity(transaction: OpenInputTransaction, identity: TargetIdentity) {
  if (transaction.targetKey === identity.targetKey)
    return false;
  if (!isInputTransactionForIdentity(transaction, identity))
    return false;
  return identityHasStrongerFieldEvidence(identity.field, transaction.field);
}

function identityHasStrongerFieldEvidence(incoming: InputTransaction['field'], previous: InputTransaction['field']) {
  return !!(
    incoming.testId && incoming.testId !== previous.testId ||
    incoming.name && incoming.name !== previous.name ||
    strongerText(previous.placeholder, incoming.placeholder) !== previous.placeholder ||
    strongerText(previous.label, incoming.label) !== previous.label
  );
}

function mergeInputFieldEvidence(previous: InputTransaction['field'], incoming: InputTransaction['field']) {
  return {
    testId: incoming.testId || previous.testId,
    label: strongerText(previous.label, incoming.label),
    name: incoming.name || previous.name,
    placeholder: strongerText(previous.placeholder, incoming.placeholder),
  };
}

function mergeInputTargetEvidence(previous: InputTransaction['target'], incoming: InputTransaction['target']) {
  if (!previous)
    return incoming;
  if (!incoming)
    return previous;
  return {
    ...previous,
    testId: incoming.testId || previous.testId,
    label: strongerText(previous.label, incoming.label),
    name: incoming.name || previous.name,
    placeholder: strongerText(previous.placeholder, incoming.placeholder),
    displayName: strongerText(previous.displayName, incoming.displayName),
    scope: mergeTargetScope(previous.scope, incoming.scope),
    raw: mergeInputTargetRaw(previous.raw, incoming.raw),
  };
}

function mergeInputTargetRaw(previous: unknown, incoming: unknown) {
  const pageContext = rawPageContext(incoming) ?? rawPageContext(previous);
  return {
    ...rawRecord(previous),
    ...rawRecord(incoming),
    ...(pageContext ? { pageContext } : {}),
    previous,
    incoming,
  };
}

function rawPageContext(raw: unknown, depth = 0): unknown {
  if (!raw || typeof raw !== 'object' || depth > 4)
    return undefined;
  const record = raw as { pageContext?: unknown; incoming?: unknown; previous?: unknown };
  return record.pageContext ?? rawPageContext(record.incoming, depth + 1) ?? rawPageContext(record.previous, depth + 1);
}

function rawRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
}

function mergeTargetScope(previous: FlowTarget['scope'] | undefined, incoming: FlowTarget['scope'] | undefined): FlowTarget['scope'] | undefined {
  if (!previous)
    return incoming;
  if (!incoming)
    return previous;
  return {
    ...previous,
    dialog: incoming.dialog ?? previous.dialog,
    section: incoming.section ?? previous.section,
    table: incoming.table ?? previous.table,
    form: incoming.form ?? previous.form,
  };
}

function mergeInputIdentities(focus: TargetIdentity | undefined, recorder: TargetIdentity): TargetIdentity {
  if (!focus)
    return recorder;
  return {
    targetKey: focus.targetKey,
    aliases: normalizeKeys([...focus.aliases, ...recorder.aliases]),
    field: mergeInputFieldEvidence(recorder.field, focus.field),
  };
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

function findCompatiblePendingInputFocus(pendingInputFocuses: PendingInputFocus[], identity: TargetIdentity, at: number): PendingInputFocus | undefined {
  const candidates = pendingInputFocuses
      .filter(focus => at >= focus.at - 100 && at - focus.at <= 2000)
      .sort((left, right) => right.at - left.at);
  const compatible = candidates.find(focus => inputTargetIdentitiesCompatible(focus.identity, identity));
  if (compatible)
    return compatible;
  if (candidates.length === 1 && singleFocusFallbackCompatible(candidates[0].identity, identity))
    return candidates[0];
  return undefined;
}

function removePendingInputFocus(pendingInputFocuses: PendingInputFocus[], focus: PendingInputFocus) {
  const index = pendingInputFocuses.indexOf(focus);
  if (index !== -1)
    pendingInputFocuses.splice(index, 1);
}

function clearPendingInputFocusesForNextAction(pendingInputFocuses: PendingInputFocus[]) {
  pendingInputFocuses.length = 0;
}

function pruneOldPendingInputFocuses(pendingInputFocuses: PendingInputFocus[], at: number) {
  for (let index = pendingInputFocuses.length - 1; index >= 0; index--) {
    if (at - pendingInputFocuses[index].at > 2000)
      pendingInputFocuses.splice(index, 1);
  }
}

function singleFocusFallbackCompatible(focus: TargetIdentity, recorder: TargetIdentity) {
  if (!sameScopedDialog(focus, recorder))
    return false;
  if (!hasStrongFieldEvidence(focus.field))
    return false;
  if (recorder.field.testId || recorder.field.name || recorder.field.placeholder)
    return false;
  const recorderLabel = recorder.field.label;
  if (!recorderLabel)
    return true;
  const focusTexts = [focus.field.placeholder, focus.field.label].filter(Boolean) as string[];
  return focusTexts.some(text => prefixCompatibleText(text, recorderLabel));
}

function sameScopedDialog(left: TargetIdentity, right: TargetIdentity) {
  const leftScope = dialogScopeFromAliases(left.aliases);
  const rightScope = dialogScopeFromAliases(right.aliases);
  return !leftScope || !rightScope || leftScope === rightScope;
}

function dialogScopeFromAliases(aliases: string[]) {
  for (const alias of aliases) {
    const match = alias.match(/\|dialog:(.+)$/);
    if (match)
      return match[1];
  }
  return undefined;
}

function hasStrongFieldEvidence(field: TargetIdentity['field']) {
  return !!(field.name || field.placeholder || field.testId);
}

function prefixCompatibleText(left: string, right: string) {
  const normalizedLeft = normalizeComparableText(left);
  const normalizedRight = normalizeComparableText(right);
  return !!normalizedLeft && !!normalizedRight && (normalizedLeft === normalizedRight || normalizedLeft.startsWith(normalizedRight) || normalizedRight.startsWith(normalizedLeft));
}

function isInputFocusContext(payload: PageContextPayload) {
  const target = payload.before?.target;
  const ui = payload.before?.ui;
  const role = target?.role || '';
  const controlType = target?.controlType || ui?.form?.fieldKind || '';
  return role === 'textbox' ||
    /^(input|textarea|text|number|password)$/.test(controlType) ||
    ui?.recipe?.kind === 'fill-form-field';
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

function isSelectLikeRecorderAction(action: ActionLike, sourceCode?: string) {
  if (action.name !== 'fill')
    return false;
  const text = `${action.selector || ''}\n${sourceCode || ''}`;
  return /ant-select|ant-cascader|ant-select-tree|role=combobox|internal:role=combobox|getByRole\(["']combobox["']|\.ant-select-selector|\.ant-cascader-picker/i.test(text);
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
  const formScope = before.form || before.ui?.form ? {
    title: before.form?.title,
    label,
    name,
    testId: before.form?.testId || before.ui?.form?.testId,
  } : undefined;
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
      form: formScope,
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

function normalizeComparableText(value?: string) {
  return value?.replace(/\s+/g, ' ').trim().toLowerCase() || '';
}
