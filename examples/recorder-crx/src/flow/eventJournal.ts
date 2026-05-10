/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import { recorderActionEntryToEvent } from '../capture/recorderActionNormalizer';
import type { RecorderEventEnvelope, RecorderEventJournal } from '../capture/eventEnvelope';
import type { PageContextEvent } from './pageContextTypes';
import type { FlowRecorderState, RecordedActionEntry, RecordingSession } from './types';

export type EventJournalStats = {
  eventCount: number;
  recorderActionCount: number;
  pageContextEventCount: number;
  lastEventAt?: number;
  lastRecorderActionAt?: number;
  lastPageContextEventAt?: number;
};

export function createEmptyEventJournal(sessions: RecordingSession[] = []): RecorderEventJournal {
  return {
    version: 1,
    eventsById: {},
    eventOrder: [],
    sessions: sessions.map(session => ({ ...session })),
    highWaterMarks: {
      recorderActionCount: 0,
      pageContextEventCount: 0,
    },
  };
}

export function cloneEventJournal(journal: RecorderEventJournal | undefined): RecorderEventJournal | undefined {
  if (!journal)
    return undefined;
  return {
    version: 1,
    eventsById: Object.fromEntries(Object.entries(journal.eventsById).map(([id, event]) => [id, { ...event, timestamp: { ...event.timestamp } }])),
    eventOrder: [...journal.eventOrder],
    sessions: journal.sessions.map(session => ({ ...session })),
    highWaterMarks: { ...journal.highWaterMarks },
  };
}

export function ensureEventJournal(recorder: FlowRecorderState): RecorderEventJournal {
  if (!recorder.eventJournal)
    recorder.eventJournal = createEmptyEventJournal(recorder.sessions);
  recorder.eventJournal.sessions = recorder.sessions.map(session => ({ ...session }));
  return recorder.eventJournal;
}

export function appendRecorderActionEvents(recorder: FlowRecorderState, entries: RecordedActionEntry[]): boolean {
  const journal = ensureEventJournal(recorder);
  let changed = false;
  for (const entry of entries) {
    changed = appendEvent(journal, recorderActionEntryToEvent(entry)) || changed;
  }
  journal.highWaterMarks.recorderActionCount = recorderEventCount(journal);
  return changed;
}

export function appendPageContextEvents(recorder: FlowRecorderState, events: PageContextEvent[]): boolean {
  const journal = ensureEventJournal(recorder);
  let changed = false;
  for (const event of events)
    changed = appendEvent(journal, pageContextEventToEnvelope(event)) || changed;
  journal.highWaterMarks.pageContextEventCount = pageContextEventCount(journal);
  return changed;
}

export function eventJournalStats(recorder: FlowRecorderState): EventJournalStats {
  const journal = ensureEventJournal(recorder);
  const events = journal.eventOrder.map(id => journal.eventsById[id]).filter(Boolean);
  return {
    eventCount: events.length,
    recorderActionCount: recorderEventCount(journal),
    pageContextEventCount: pageContextEventCount(journal),
    lastEventAt: lastWallTime(events),
    lastRecorderActionAt: lastWallTime(events.filter(event => event.source === 'playwright-recorder')),
    lastPageContextEventAt: lastWallTime(events.filter(event => event.source === 'page-context')),
  };
}

function appendEvent(journal: RecorderEventJournal, event: RecorderEventEnvelope): boolean {
  if (journal.eventsById[event.id])
    return false;
  journal.eventsById[event.id] = event;
  journal.eventOrder.push(event.id);
  return true;
}

function recorderEventCount(journal: RecorderEventJournal) {
  return journal.eventOrder.reduce((count, id) => count + (journal.eventsById[id]?.source === 'playwright-recorder' ? 1 : 0), 0);
}

function pageContextEventCount(journal: RecorderEventJournal) {
  return journal.eventOrder.reduce((count, id) => count + (journal.eventsById[id]?.source === 'page-context' ? 1 : 0), 0);
}

function lastWallTime(events: RecorderEventEnvelope[]) {
  const times = events.map(event => event.timestamp.wallTime).filter(time => Number.isFinite(time));
  return times.length ? Math.max(...times) : undefined;
}

function pageContextEventToEnvelope(event: PageContextEvent): RecorderEventEnvelope {
  const wallTime = event.wallTime ?? event.time ?? Date.now();
  return {
    id: `page-context:${event.id}`,
    sessionId: 'page-context',
    source: 'page-context',
    kind: event.kind,
    createdAt: new Date(wallTime).toISOString(),
    timestamp: {
      wallTime,
    },
    payload: compactPageContextEvent(event),
  };
}

function compactPageContextEvent(event: PageContextEvent) {
  return {
    id: event.id,
    kind: event.kind,
    time: event.time,
    wallTime: event.wallTime,
    before: event.before ? {
      url: event.before.url,
      title: event.before.title,
      breadcrumb: event.before.breadcrumb,
      activeTab: event.before.activeTab,
      dialog: event.before.dialog,
      section: event.before.section,
      table: event.before.table,
      form: event.before.form,
      target: event.before.target,
      ui: event.before.ui,
    } : undefined,
    after: event.after ? {
      url: event.after.url,
      title: event.after.title,
      breadcrumb: event.after.breadcrumb,
      activeTab: event.after.activeTab,
      dialog: event.after.dialog,
      openedDialog: event.after.openedDialog,
      toast: event.after.toast,
    } : undefined,
  };
}
