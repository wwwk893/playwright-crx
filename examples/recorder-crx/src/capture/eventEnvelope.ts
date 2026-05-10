/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

export type RecorderEventSource =
  | 'playwright-recorder'
  | 'page-context'
  | 'semantic-adapter'
  | 'user-edit'
  | 'network';

export interface RecorderEventTimestamp {
  wallTime: number;
  performanceTime?: number;
  recorderIndex?: number;
}

export interface RecorderEventEnvelope<T = unknown> {
  id: string;
  sessionId: string;
  source: RecorderEventSource;
  kind: string;
  createdAt: string;
  timestamp: RecorderEventTimestamp;
  payload: T;
}

export interface RecorderEventJournalSession {
  id: string;
  mode: 'initial' | 'append' | 'insert-after';
  baseActionCount: number;
  insertAfterStepId?: string;
  startedAt: string;
  committedAt?: string;
}

export interface RecorderEventJournal {
  version: 1;
  eventsById: Record<string, RecorderEventEnvelope>;
  eventOrder: string[];
  sessions: RecorderEventJournalSession[];
  highWaterMarks: {
    recorderActionCount: number;
    pageContextEventCount: number;
  };
}
