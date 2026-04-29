/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 */
import type { FlowActionType, FlowStep } from './types';
import type { PageContextEvent } from './pageContextTypes';

const beforeWindowMs = 300;
const afterWindowMs = 800;

export function matchPageContextEvent(step: FlowStep, events: PageContextEvent[]): PageContextEvent | undefined {
  const timing = actionTiming(step.rawAction);
  if (!timing)
    return undefined;

  const compatibleEvents = events.filter(event => isCompatible(step.action, event.kind));
  const windowStart = timing.start - beforeWindowMs;
  const windowEnd = timing.end + afterWindowMs;
  const candidates = compatibleEvents.filter(event => {
    const eventTime = timing.clock === 'wall' ? event.wallTime : event.time;
    return eventTime !== undefined && eventTime >= windowStart && eventTime <= windowEnd;
  });
  if (!candidates.length)
    return undefined;

  return candidates.sort((a, b) => Math.abs(eventTimeFor(a, timing.clock) - timing.end) - Math.abs(eventTimeFor(b, timing.clock) - timing.end))[0];
}

function actionTiming(rawAction: unknown) {
  const record = rawAction && typeof rawAction === 'object' ? rawAction as Record<string, unknown> : undefined;
  const wallStart = typeof record?.wallTime === 'number' ? record.wallTime : undefined;
  const wallEnd = typeof record?.endWallTime === 'number' ? record.endWallTime : wallStart;
  if (wallStart !== undefined && wallEnd !== undefined)
    return { start: wallStart, end: wallEnd, clock: 'wall' as const };

  const start = typeof record?.startTime === 'number' && record.startTime > 0 ? record.startTime : undefined;
  const end = typeof record?.endTime === 'number' && record.endTime > 0 ? record.endTime : start;
  if (start === undefined || end === undefined)
    return undefined;
  return { start, end, clock: 'page' as const };
}

function eventTimeFor(event: PageContextEvent, clock: 'wall' | 'page') {
  return clock === 'wall' ? event.wallTime ?? event.time : event.time;
}

function isCompatible(action: FlowActionType, eventKind: PageContextEvent['kind']) {
  switch (action) {
    case 'click':
      return eventKind === 'click';
    case 'fill':
      return eventKind === 'input' || eventKind === 'change' || eventKind === 'click';
    case 'select':
      return eventKind === 'change' || eventKind === 'click';
    case 'check':
    case 'uncheck':
      return eventKind === 'change' || eventKind === 'click';
    case 'press':
      return eventKind === 'keydown';
    case 'navigate':
      return eventKind === 'navigation' || eventKind === 'click';
    default:
      return eventKind === 'click' || eventKind === 'change' || eventKind === 'input';
  }
}
