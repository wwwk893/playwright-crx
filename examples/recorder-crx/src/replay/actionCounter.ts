/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { BusinessFlow, FlowStep } from '../flow/types';
import {
  countStepActions,
  createEffectiveReplayFlow,
  createStepReplaySkipPolicy,
  firstSegmentStepId,
} from './stepEmitter';

export function countBusinessFlowPlaybackActions(flow: BusinessFlow) {
  const effectiveFlow = createEffectiveReplayFlow(flow);
  let count = 0;
  const emittedRepeatStepIds = new Set<string>();
  const skipPolicy = createStepReplaySkipPolicy('parserSafe');
  const dropdownState = skipPolicy.createDropdownDedupeState();
  let previousEmittedStep: FlowStep | undefined;
  for (const [index, step] of effectiveFlow.steps.entries()) {
    const segment = (effectiveFlow.repeatSegments ?? []).find(segment => firstSegmentStepId(effectiveFlow, segment) === step.id);
    if (segment) {
      const rows = segment.rows.length ? segment.rows : [{ id: 'row-1', values: {} }];
      const segmentSteps = effectiveFlow.steps.filter(step => segment.stepIds.includes(step.id));
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        let previousSegmentStep: FlowStep | undefined;
        for (const [stepIndex, segmentStep] of segmentSteps.entries()) {
          if (skipPolicy.shouldSkipRepeatStep({ step: segmentStep, steps: segmentSteps, index: stepIndex, previousEmittedStep: previousSegmentStep, skipPlaceholderSelectOption: true }))
            continue;
          count += countStepActions(segmentStep, { parserSafe: true, previousStep: previousSegmentStep, nextStep: segmentSteps[stepIndex + 1], suppressRowExistsAssertions: !!segment.assertionTemplate });
          previousSegmentStep = segmentStep;
        }
      }
      segment.stepIds.forEach(stepId => emittedRepeatStepIds.add(stepId));
      continue;
    }
    if (emittedRepeatStepIds.has(step.id))
      continue;
    if (skipPolicy.shouldSkipTopLevelStep({ step, steps: effectiveFlow.steps, index, previousEmittedStep, dropdownState }))
      continue;

    count += countStepActions(step, { parserSafe: true, previousStep: previousEmittedStep, nextStep: effectiveFlow.steps[index + 1] });
    previousEmittedStep = step;
  }
  return count;
}
