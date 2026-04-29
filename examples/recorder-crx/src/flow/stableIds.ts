/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import type { BusinessFlow, FlowRecorderState, FlowStep } from './types';

export function recomputeOrders(steps: FlowStep[]): FlowStep[] {
  return steps.map((step, index) => ({
    ...step,
    order: index + 1,
  }));
}

export function nextStableStepId(recorder: FlowRecorderState) {
  const id = `s${String(recorder.nextStepSeq).padStart(3, '0')}`;
  recorder.nextStepSeq += 1;
  return id;
}

export function nextStableActionId(recorder: FlowRecorderState) {
  const id = `act_${String(recorder.nextActionSeq).padStart(6, '0')}`;
  recorder.nextActionSeq += 1;
  return id;
}

export function maxStepSeq(flow: BusinessFlow) {
  return flow.steps.reduce((max, step) => Math.max(max, numericSuffix(step.id)), 0);
}

export function maxActionSeq(recorder?: FlowRecorderState) {
  return recorder?.actionLog.reduce((max, action) => Math.max(max, numericSuffix(action.id)), 0) ?? 0;
}

function numericSuffix(value: string) {
  const match = value.match(/(\d+)$/);
  if (!match)
    return 0;
  const numeric = Number(match[1]);
  return Number.isFinite(numeric) ? numeric : 0;
}
