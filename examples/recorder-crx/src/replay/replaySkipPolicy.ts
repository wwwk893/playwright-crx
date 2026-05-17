/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { FlowStep } from '../flow/types';

export type ReplaySkipMode = 'exported' | 'parserSafe';

export interface ReplayDropdownDedupeState {
  lastIdentity: string;
  lastCompact: string;
}

export interface ReplaySkipPolicyHooks {
  isPlaceholderSelectOptionClick(step: FlowStep): boolean;
  nextEffectiveStepForRedundantAction(steps: FlowStep[], index: number, mode: ReplaySkipMode): FlowStep | undefined;
  isIntermediateSameFieldFill(step: FlowStep, steps: FlowStep[], index: number): boolean;
  isRedundantFieldFocusClick(step: FlowStep, nextStep?: FlowStep): boolean;
  isRedundantExportedSelectFieldAction(step: FlowStep, nextStep?: FlowStep): boolean;
  isRedundantParserSafeSelectFieldAction(step: FlowStep, nextStep?: FlowStep): boolean;
  isRedundantSelectSearchClear(step: FlowStep, previousStep?: FlowStep): boolean;
  isRedundantDropdownEscape(step: FlowStep, previousStep?: FlowStep): boolean;
  isRedundantExplicitPopoverConfirmStep(step: FlowStep, previous?: FlowStep): boolean;
  isRedundantExplicitDialogConfirmStep(step: FlowStep, previous?: FlowStep): boolean;
  isHiddenDialogContainerClickAfterConfirm(step: FlowStep, previous?: FlowStep): boolean;
  isTruncatedSelectedValueDisplayEchoClick(step: FlowStep, previousStep?: FlowStep): boolean;
  isDuplicateSyntheticEchoClick(step: FlowStep, previous?: FlowStep): boolean;
  dropdownOptionEmitIdentity(step: FlowStep): string | undefined;
  dropdownOptionEmitCompactIdentity(step: FlowStep): string | undefined;
}

export interface TopLevelReplaySkipContext {
  step: FlowStep;
  steps: FlowStep[];
  index: number;
  previousEmittedStep?: FlowStep;
  dropdownState: ReplayDropdownDedupeState;
}

export interface RepeatReplaySkipContext {
  step: FlowStep;
  steps: FlowStep[];
  index: number;
  previousEmittedStep?: FlowStep;
  skipPlaceholderSelectOption?: boolean;
}

export function createReplaySkipPolicy(mode: ReplaySkipMode, hooks: ReplaySkipPolicyHooks) {
  return {
    createDropdownDedupeState(): ReplayDropdownDedupeState {
      return { lastIdentity: '', lastCompact: '' };
    },

    shouldSkipTopLevelStep(context: TopLevelReplaySkipContext) {
      if (shouldSkipCommonStep(context, mode, hooks))
        return true;
      if (hooks.isDuplicateSyntheticEchoClick(context.step, context.steps[context.index - 1]))
        return true;
      return shouldSkipDuplicateDropdownOption(context.step, context.dropdownState, hooks);
    },

    shouldSkipRepeatStep(context: RepeatReplaySkipContext) {
      return shouldSkipRepeatStep(context, mode, hooks);
    },
  };
}

function shouldSkipCommonStep(context: RepeatReplaySkipContext, mode: ReplaySkipMode, hooks: ReplaySkipPolicyHooks) {
  const { step, steps, index, previousEmittedStep } = context;
  const previousStep = steps[index - 1];
  const nextStep = steps[index + 1];
  const nextEffectiveStep = hooks.nextEffectiveStepForRedundantAction(steps, index, mode);
  if (hooks.isIntermediateSameFieldFill(step, steps, index) || hooks.isPlaceholderSelectOptionClick(step))
    return true;
  if (hooks.isRedundantFieldFocusClick(step, nextStep) || isRedundantSelectFieldAction(step, nextEffectiveStep, mode, hooks))
    return true;
  if (hooks.isRedundantSelectSearchClear(step, previousStep) || hooks.isRedundantDropdownEscape(step, previousStep))
    return true;
  if (hooks.isTruncatedSelectedValueDisplayEchoClick(step, previousEmittedStep))
    return true;
  return hooks.isRedundantExplicitPopoverConfirmStep(step, previousStep) ||
    hooks.isRedundantExplicitPopoverConfirmStep(step, previousEmittedStep) ||
    hooks.isRedundantExplicitDialogConfirmStep(step, previousStep) ||
    hooks.isRedundantExplicitDialogConfirmStep(step, previousEmittedStep) ||
    hooks.isHiddenDialogContainerClickAfterConfirm(step, previousStep);
}

function shouldSkipRepeatStep(context: RepeatReplaySkipContext, mode: ReplaySkipMode, hooks: ReplaySkipPolicyHooks) {
  const { step, steps, index, previousEmittedStep } = context;
  const previousStep = steps[index - 1];
  const nextStep = steps[index + 1];
  const nextEffectiveStep = hooks.nextEffectiveStepForRedundantAction(steps, index, mode);
  if (context.skipPlaceholderSelectOption && hooks.isPlaceholderSelectOptionClick(step))
    return true;
  if (hooks.isIntermediateSameFieldFill(step, steps, index))
    return true;
  if (hooks.isRedundantFieldFocusClick(step, nextStep) || isRedundantSelectFieldAction(step, nextEffectiveStep, mode, hooks))
    return true;
  if (hooks.isRedundantSelectSearchClear(step, previousStep))
    return true;
  if (hooks.isRedundantExplicitPopoverConfirmStep(step, previousStep) ||
    hooks.isRedundantExplicitPopoverConfirmStep(step, previousEmittedStep) ||
    hooks.isRedundantExplicitDialogConfirmStep(step, previousStep) ||
    hooks.isRedundantExplicitDialogConfirmStep(step, previousEmittedStep) ||
    hooks.isHiddenDialogContainerClickAfterConfirm(step, previousStep))
    return true;
  return hooks.isTruncatedSelectedValueDisplayEchoClick(step, previousEmittedStep);
}

function isRedundantSelectFieldAction(step: FlowStep, nextStep: FlowStep | undefined, mode: ReplaySkipMode, hooks: ReplaySkipPolicyHooks) {
  return mode === 'exported' ?
    hooks.isRedundantExportedSelectFieldAction(step, nextStep) :
    hooks.isRedundantParserSafeSelectFieldAction(step, nextStep);
}

function shouldSkipDuplicateDropdownOption(step: FlowStep, state: ReplayDropdownDedupeState, hooks: ReplaySkipPolicyHooks) {
  const dropdownOptionIdentity = hooks.dropdownOptionEmitIdentity(step);
  const dropdownOptionCompact = hooks.dropdownOptionEmitCompactIdentity(step);
  if (dropdownOptionIdentity && (dropdownOptionIdentity === state.lastIdentity || dropdownOptionCompact === state.lastCompact))
    return true;
  if (dropdownOptionIdentity) {
    state.lastIdentity = dropdownOptionIdentity;
    state.lastCompact = dropdownOptionCompact || '';
  } else if (step.action !== 'fill') {
    state.lastIdentity = '';
    state.lastCompact = '';
  }
  return false;
}
