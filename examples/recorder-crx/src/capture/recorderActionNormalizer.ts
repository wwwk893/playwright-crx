/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import type { RecordedActionEntry } from '../flow/types';
import type { RecorderEventEnvelope } from './eventEnvelope';

export type RecorderActionEventPayload = {
  actionId: string;
  signature: string;
  recorderIndex: number;
  sessionIndex: number;
  rawAction: unknown;
  sourceCode?: string;
  wallTime?: number;
  endWallTime?: number;
};

export function recorderActionEventId(entry: Pick<RecordedActionEntry, 'id'>) {
  return `playwright-recorder:${entry.id}`;
}

export function recorderActionEntryToEvent(entry: RecordedActionEntry): RecorderEventEnvelope<RecorderActionEventPayload> {
  return {
    id: recorderActionEventId(entry),
    sessionId: entry.sessionId,
    source: 'playwright-recorder',
    kind: 'recorder-action',
    createdAt: entry.createdAt,
    timestamp: {
      wallTime: entry.wallTime ?? parseCreatedAt(entry.createdAt),
      recorderIndex: entry.recorderIndex,
    },
    payload: {
      actionId: entry.id,
      signature: entry.signature,
      recorderIndex: entry.recorderIndex,
      sessionIndex: entry.sessionIndex,
      rawAction: entry.rawAction,
      sourceCode: entry.sourceCode,
      wallTime: entry.wallTime,
      endWallTime: entry.endWallTime,
    },
  };
}

function parseCreatedAt(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}
