/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { BusinessFlow, FlowStep } from '../flow/types';
import {
  createEffectiveReplayFlow,
  dropdownOptionEmitCompactIdentity,
  dropdownOptionEmitIdentity,
  emitRepeatSegment,
  emitStep,
  firstSegmentStepId,
  isDuplicateSyntheticEchoClick,
  isHiddenDialogContainerClickAfterConfirm,
  isIntermediateSameFieldFill,
  isPlaceholderSelectOptionClick,
  isRedundantDropdownEscape,
  isRedundantExplicitDialogConfirmStep,
  isRedundantExplicitPopoverConfirmStep,
  isRedundantExportedSelectFieldAction,
  isRedundantFieldFocusClick,
  isRedundantSelectSearchClear,
  isTruncatedSelectedValueDisplayEchoClick,
  nextEffectiveStepForRedundantAction,
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
  let lastDropdownOptionIdentity = '';
  let lastDropdownOptionCompact = '';
  let previousEmittedStep: FlowStep | undefined;
  for (const [index, step] of effectiveFlow.steps.entries()) {
    const nextEffectiveStep = nextEffectiveStepForRedundantAction(effectiveFlow.steps, index, 'exported');
    const segment = (effectiveFlow.repeatSegments ?? []).find(segment => firstSegmentStepId(effectiveFlow, segment) === step.id);
    if (segment) {
      emitRepeatSegment(lines, effectiveFlow, segment);
      segment.stepIds.forEach(stepId => emittedRepeatStepIds.add(stepId));
      continue;
    }
    if (emittedRepeatStepIds.has(step.id))
      continue;
    if (isIntermediateSameFieldFill(step, effectiveFlow.steps, index) || isPlaceholderSelectOptionClick(step))
      continue;
    if (isRedundantFieldFocusClick(step, effectiveFlow.steps[index + 1]) || isRedundantExportedSelectFieldAction(step, nextEffectiveStep) || isRedundantSelectSearchClear(step, effectiveFlow.steps[index - 1]) || isRedundantDropdownEscape(step, effectiveFlow.steps[index - 1]))
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

    emitStep(lines, step, '  ', undefined, undefined, { safetyGuard: true, previousStep: previousEmittedStep, nextStep: effectiveFlow.steps[index + 1] });
    previousEmittedStep = step;
  }

  lines.push('});');
  return `${lines.join('\n')}\n`;
}
