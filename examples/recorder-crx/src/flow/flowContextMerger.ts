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
import { suggestIntent, stepContextFromEvent } from './intentRules';
import { matchPageContextEvent } from './pageContextMatcher';
import type { PageContextEvent } from './pageContextTypes';
import type { BusinessFlow, FlowStep } from './types';

const autoIntentThreshold = 0.6;

export function mergePageContextIntoFlow(flow: BusinessFlow, events: PageContextEvent[]): BusinessFlow {
  if (!events.length)
    return normalizeIntentSources(flow);

  let changed = false;
  const steps = flow.steps.map(step => {
    const normalizedStep = normalizeIntentSource(step);
    const event = matchPageContextEvent(normalizedStep, events);
    if (!event)
      return normalizedStep;

    const actionIndex = actionIndexForStep(flow, normalizedStep.id);
    const context = stepContextFromEvent(event, actionIndex);
    const suggestion = suggestIntent(normalizedStep, context);
    const nextStep = applySuggestion({
      ...normalizedStep,
      context,
      intentSuggestion: suggestion ?? normalizedStep.intentSuggestion,
    }, suggestion);
    changed = changed || nextStep !== step;
    return nextStep;
  });

  if (!changed)
    return { ...flow, steps };
  return {
    ...flow,
    steps,
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeIntentSources(flow: BusinessFlow): BusinessFlow {
  return {
    ...flow,
    steps: flow.steps.map(normalizeIntentSource),
  };
}

function normalizeIntentSource(step: FlowStep): FlowStep {
  if ((step.intentSource as string | undefined) === 'auto')
    return { ...step, intentSource: 'rule' };
  if (step.intent && !step.intentSource)
    return { ...step, intentSource: 'user' };
  return step;
}

function applySuggestion(step: FlowStep, suggestion: FlowStep['intentSuggestion']): FlowStep {
  if (!suggestion)
    return step;
  if (step.intentSource === 'user')
    return step;
  if (suggestion.confidence < autoIntentThreshold)
    return step;
  if (step.intent && step.intentSource !== 'rule')
    return step;
  return {
    ...step,
    intent: suggestion.text,
    intentSource: 'rule',
  };
}

function actionIndexForStep(flow: BusinessFlow, stepId: string) {
  const step = flow.steps.find(step => step.id === stepId);
  const actionId = step?.sourceActionIds?.[0];
  const action = flow.artifacts?.recorder?.actionLog.find(action => action.id === actionId);
  if (typeof action?.recorderIndex === 'number')
    return action.recorderIndex;
  const legacyActionIndex = flow.artifacts?.stepActionIndexes?.[stepId];
  return typeof legacyActionIndex === 'number' ? legacyActionIndex : undefined;
}
