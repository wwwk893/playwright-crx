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

  const scored = candidates
      .map(event => ({ event, score: candidateScore(step, event) }))
      .filter(candidate => candidate.score >= 0);
  if (!scored.length)
    return undefined;

  return scored.sort((a, b) => {
    const scoreDiff = b.score - a.score;
    if (scoreDiff)
      return scoreDiff;
    return Math.abs(eventTimeFor(a.event, timing.clock) - timing.end) - Math.abs(eventTimeFor(b.event, timing.clock) - timing.end);
  })[0].event;
}

function candidateScore(step: FlowStep, event: PageContextEvent) {
  const target = step.target;
  const contextTarget = event.before.target;
  if (!target || !contextTarget)
    return 0;

  const targetTestId = target.testId;
  const contextTestId = contextTarget.testId;
  if (targetTestId && contextTestId)
    return targetTestId === contextTestId ? 200 : -1;

  const stepText = normalizeComparable(target.displayName || target.name || target.text || target.label || target.placeholder);
  const contextText = normalizeComparable(contextTarget.text || contextTarget.ariaLabel || contextTarget.title || contextTarget.placeholder || event.before.form?.label);
  const labelText = normalizeComparable(target.label || target.scope?.form?.label);
  const formLabel = normalizeComparable(event.before.form?.label);

  const targetSemantic = normalizeComparable(target.label || target.name || target.displayName || target.placeholder || target.text);
  if ((step.action === 'fill' || step.action === 'select') && targetSemantic && formLabel && targetSemantic !== formLabel && targetSemantic !== contextText)
    return -1;

  let score = 0;
  if (targetTestId && !contextTestId)
    score += 20;
  if (!targetTestId && contextTestId)
    score += 10;
  if (stepText && contextText && stepText === contextText)
    score += 120;
  if (labelText && formLabel && labelText === formLabel)
    score += 100;
  if (target.role && contextTarget.role && target.role === contextTarget.role)
    score += 40;
  if (event.before.table?.rowKey)
    score += 80;
  if (event.kind === 'input' || event.kind === 'change')
    score += step.action === 'fill' || step.action === 'select' || step.action === 'check' || step.action === 'uncheck' ? 30 : 0;

  const clearTextMismatch = stepText && contextText && stepText !== contextText;
  const clearLabelMismatch = labelText && formLabel && labelText !== formLabel;
  if (!score && (clearTextMismatch || clearLabelMismatch))
    return -1;
  if (clearTextMismatch && score <= 10)
    return -1;
  if (step.action === 'fill' && event.kind === 'click' && (clearTextMismatch || (targetTestId && contextTestId && targetTestId !== contextTestId)))
    return -1;
  return score;
}

function normalizeComparable(value?: string) {
  return value?.replace(/^\s*\*\s*/, '').replace(/\s+/g, ' ').trim().toLowerCase();
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
    case 'wait':
      return false;
    case 'navigate':
      return eventKind === 'navigation' || eventKind === 'click';
    default:
      return eventKind === 'click' || eventKind === 'change' || eventKind === 'input';
  }
}
