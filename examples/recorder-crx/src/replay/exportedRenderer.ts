/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { BusinessFlow, FlowStep } from '../flow/types';
import {
  createEffectiveReplayFlow,
  createStepReplaySkipPolicy,
  emitRepeatSegment,
  emitStep,
  firstSegmentStepId,
  stringLiteral,
} from './stepEmitter';

export function generateBusinessFlowPlaywrightCode(flow: BusinessFlow) {
  const effectiveFlow = createEffectiveReplayFlow(flow);
  const lines = [
    `import { test, expect } from '@playwright/test';`,
    '',
    `test(${stringLiteral(effectiveFlow.flow.name || 'business flow')}, async ({ page }) => {`,
  ];

  const emittedRepeatStepIds = new Set<string>();
  const skipPolicy = createStepReplaySkipPolicy('exported');
  const dropdownState = skipPolicy.createDropdownDedupeState();
  let previousEmittedStep: FlowStep | undefined;
  for (const [index, step] of effectiveFlow.steps.entries()) {
    const segment = (effectiveFlow.repeatSegments ?? []).find(segment => firstSegmentStepId(effectiveFlow, segment) === step.id);
    if (segment) {
      emitRepeatSegment(lines, effectiveFlow, segment);
      segment.stepIds.forEach(stepId => emittedRepeatStepIds.add(stepId));
      continue;
    }
    if (emittedRepeatStepIds.has(step.id))
      continue;
    if (skipPolicy.shouldSkipTopLevelStep({ step, steps: effectiveFlow.steps, index, previousEmittedStep, dropdownState }))
      continue;

    emitStep(lines, step, '  ', undefined, undefined, { safetyGuard: true, previousStep: previousEmittedStep, nextStep: effectiveFlow.steps[index + 1] });
    previousEmittedStep = step;
  }

  lines.push('});');
  return `${lines.join('\n')}\n`;
}
