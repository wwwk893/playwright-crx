/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { BusinessFlow, FlowStep } from '../flow/types';
import {
  countStepActions,
  createEffectiveReplayFlow,
  dropdownOptionEmitCompactIdentity,
  dropdownOptionEmitIdentity,
  firstSegmentStepId,
  isDuplicateSyntheticEchoClick,
  isHiddenDialogContainerClickAfterConfirm,
  isIntermediateSameFieldFill,
  isPlaceholderSelectOptionClick,
  isRedundantDropdownEscape,
  isRedundantExplicitDialogConfirmStep,
  isRedundantExplicitPopoverConfirmStep,
  isRedundantFieldFocusClick,
  isRedundantParserSafeSelectFieldAction,
  isRedundantSelectSearchClear,
  isTruncatedSelectedValueDisplayEchoClick,
  nextEffectiveStepForRedundantAction,
} from './stepEmitter';

export function countBusinessFlowPlaybackActions(flow: BusinessFlow) {
  const effectiveFlow = createEffectiveReplayFlow(flow);
  let count = 0;
  const emittedRepeatStepIds = new Set<string>();
  let lastDropdownOptionIdentity = '';
  let lastDropdownOptionCompact = '';
  let previousEmittedStep: FlowStep | undefined;
  for (const [index, step] of effectiveFlow.steps.entries()) {
    const segment = (effectiveFlow.repeatSegments ?? []).find(segment => firstSegmentStepId(effectiveFlow, segment) === step.id);
    if (segment) {
      const rows = segment.rows.length ? segment.rows : [{ id: 'row-1', values: {} }];
      const segmentSteps = effectiveFlow.steps.filter(step => segment.stepIds.includes(step.id));
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        let previousSegmentStep: FlowStep | undefined;
        for (const [stepIndex, segmentStep] of segmentSteps.entries()) {
          const nextEffectiveSegmentStep = nextEffectiveStepForRedundantAction(segmentSteps, stepIndex, 'parserSafe');
          if (isIntermediateSameFieldFill(segmentStep, segmentSteps, stepIndex) || isPlaceholderSelectOptionClick(segmentStep) || isRedundantFieldFocusClick(segmentStep, segmentSteps[stepIndex + 1]) || isRedundantParserSafeSelectFieldAction(segmentStep, nextEffectiveSegmentStep) || isRedundantSelectSearchClear(segmentStep, segmentSteps[stepIndex - 1]) || isRedundantExplicitPopoverConfirmStep(segmentStep, segmentSteps[stepIndex - 1]) || isRedundantExplicitDialogConfirmStep(segmentStep, segmentSteps[stepIndex - 1]) || isHiddenDialogContainerClickAfterConfirm(segmentStep, segmentSteps[stepIndex - 1]))
            continue;
          if (isTruncatedSelectedValueDisplayEchoClick(segmentStep, previousSegmentStep))
            continue;
          count += countStepActions(segmentStep, { parserSafe: true, previousStep: previousSegmentStep, nextStep: segmentSteps[stepIndex + 1] });
          previousSegmentStep = segmentStep;
        }
      }
      segment.stepIds.forEach(stepId => emittedRepeatStepIds.add(stepId));
      continue;
    }
    if (emittedRepeatStepIds.has(step.id))
      continue;
    if (isIntermediateSameFieldFill(step, effectiveFlow.steps, index) || isPlaceholderSelectOptionClick(step))
      continue;
    const nextEffectiveStep = nextEffectiveStepForRedundantAction(effectiveFlow.steps, index, 'parserSafe');
    if (isRedundantFieldFocusClick(step, effectiveFlow.steps[index + 1]) || isRedundantParserSafeSelectFieldAction(step, nextEffectiveStep) || isRedundantSelectSearchClear(step, effectiveFlow.steps[index - 1]) || isRedundantDropdownEscape(step, effectiveFlow.steps[index - 1]))
      continue;
    if (isTruncatedSelectedValueDisplayEchoClick(step, previousEmittedStep))
      continue;
    if (isDuplicateSyntheticEchoClick(step, effectiveFlow.steps[index - 1]) || isRedundantExplicitPopoverConfirmStep(step, effectiveFlow.steps[index - 1]) || isRedundantExplicitDialogConfirmStep(step, effectiveFlow.steps[index - 1]) || isHiddenDialogContainerClickAfterConfirm(step, effectiveFlow.steps[index - 1]))
      continue;
    const dropdownOptionIdentity = dropdownOptionEmitIdentity(step);
    const dropdownOptionCompact = dropdownOptionEmitCompactIdentity(step);
    if (dropdownOptionIdentity && (dropdownOptionIdentity === lastDropdownOptionIdentity || dropdownOptionCompact === lastDropdownOptionCompact))
      continue;
    if (dropdownOptionIdentity) {
      lastDropdownOptionIdentity = dropdownOptionIdentity;
      lastDropdownOptionCompact = dropdownOptionCompact;
    } else if (step.action !== 'fill') {
      lastDropdownOptionIdentity = '';
      lastDropdownOptionCompact = '';
    }

    count += countStepActions(step, { parserSafe: true, previousStep: previousEmittedStep, nextStep: effectiveFlow.steps[index + 1] });
    previousEmittedStep = step;
  }
  return count;
}
