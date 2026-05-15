/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import type { PageContextEvent } from './pageContextTypes';

export function pageContextEventSignature(events: PageContextEvent[]) {
  return JSON.stringify(events.map(event => ({
    id: event.id,
    kind: event.kind,
    wallTime: event.wallTime,
    before: event.before,
    after: event.after,
    tabId: event.tabId,
  })));
}

export function pageContextEventPayloadSignature(event: PageContextEvent) {
  return pageContextEventSignature([event]);
}

export function hasPendingOverlayPrediction(events: PageContextEvent[], options: { now?: () => number, pendingWindowMs?: number } = {}) {
  const now = options.now || Date.now;
  const pendingWindowMs = options.pendingWindowMs ?? 1600;
  return events.some(event =>
    event.kind === 'click' &&
    !!event.wallTime &&
    now() - event.wallTime <= pendingWindowMs &&
    !!expectedOverlayKindForSettle(event) &&
    !event.after?.overlayPrediction
  );
}

export function updatePageContextEventSignatures(events: PageContextEvent[], signaturesById: Map<string, string>) {
  const changedEventIds = new Set<string>();
  for (const event of events) {
    const signature = pageContextEventPayloadSignature(event);
    const previousSignature = signaturesById.get(event.id);
    signaturesById.set(event.id, signature);
    if (previousSignature !== undefined && previousSignature !== signature)
      changedEventIds.add(event.id);
  }
  return changedEventIds;
}

export function pageContextEventsForIngestion(options: {
  events: PageContextEvent[];
  lastEventId?: string;
  signaturesById: Map<string, string>;
}) {
  const changedEventIds = updatePageContextEventSignatures(options.events, options.signaturesById);
  const lastIndex = options.lastEventId ? options.events.findIndex(event => event.id === options.lastEventId) : options.events.length - 1;
  const newEvents = lastIndex >= 0 ? options.events.slice(lastIndex + 1) : options.events.slice(-3);
  const newEventIds = new Set(newEvents.map(event => event.id));
  const eventsToProcess = uniquePageContextEvents([
    ...newEvents,
    ...options.events.filter(event => changedEventIds.has(event.id) && !newEventIds.has(event.id)),
  ]);
  return {
    eventsToProcess,
    changedEventIds,
    lastEventId: options.events[options.events.length - 1]?.id,
  };
}

export function shouldQueueSyntheticPageContextEvent(options: {
  event: PageContextEvent;
  changedEventIds: ReadonlySet<string>;
  scheduledEventIds: ReadonlySet<string>;
}) {
  return options.event.kind === 'click' &&
    !!options.event.wallTime &&
    (options.changedEventIds.has(options.event.id) || !options.scheduledEventIds.has(options.event.id));
}

function uniquePageContextEvents(events: PageContextEvent[]) {
  const seen = new Set<string>();
  return events.filter(event => {
    if (seen.has(event.id))
      return false;
    seen.add(event.id);
    return true;
  });
}

// Keep this settle-only heuristic local: importing the capture sidecar helper here
// can make Vite split the content script into an unlisted shared chunk.
function expectedOverlayKindForSettle(event: PageContextEvent) {
  const target = event.before?.target;
  const controlType = target?.controlType || '';
  const role = target?.role || '';
  const testId = normalizeIngestionText(target?.testId || '');
  const text = normalizeIngestionText([
    target?.testId,
    target?.text,
    target?.ariaLabel,
    target?.title,
  ].filter(Boolean).join(' '));

  if (/^(select|tree-select|cascader)$/.test(controlType) || role === 'combobox')
    return 'select-dropdown';
  if (controlType === 'dropdown-trigger' || controlType === 'menu-item')
    return 'dropdown';
  if (/(delete|remove|trash|destroy|删除|移除)/i.test(text))
    return 'popconfirm';
  if (/(drawer|抽屉)/i.test(text))
    return 'drawer';
  if (/(create|add|new|edit|新增|新建|添加|编辑)/i.test(text) && hasModalTriggerEvidence({ controlType, role, testId }))
    return 'modal';
  if (/(open|打开)/i.test(text) && hasExplicitModalTriggerEvidence(testId))
    return 'modal';
  return undefined;
}

function hasModalTriggerEvidence(evidence: { controlType: string, role: string, testId: string }) {
  return /^(button|table-row-action)$/.test(evidence.controlType) ||
    evidence.role === 'button' ||
    /(^|[-_])(button|btn|create|add|new|edit|modal|dialog)([-_]|$)/i.test(evidence.testId);
}

function hasExplicitModalTriggerEvidence(testId: string) {
  return /(^|[-_])(open|modal|dialog)([-_]|$)/i.test(testId);
}

function normalizeIngestionText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}
