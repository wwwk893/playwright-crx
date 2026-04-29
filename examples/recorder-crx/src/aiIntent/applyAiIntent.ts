/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { BusinessFlow, FlowStep } from '../flow/types';
import type { AiIntentGenerationResult } from './types';

export function applyAiIntentResults(flow: BusinessFlow, results: AiIntentGenerationResult[]): BusinessFlow {
  if (!results.length)
    return flow;
  const byStepId = new Map(results.map(result => [result.stepId, result]));
  let changed = false;
  const steps = flow.steps.map(step => {
    const result = byStepId.get(step.id);
    if (!result || step.intentSource === 'user')
      return step;
    changed = true;
    return applyAiIntentToStep(step, result);
  });

  if (!changed)
    return flow;
  return {
    ...flow,
    steps,
    updatedAt: new Date().toISOString(),
  };
}

function applyAiIntentToStep(step: FlowStep, result: AiIntentGenerationResult): FlowStep {
  return {
    ...step,
    intent: result.intent,
    intentSource: 'ai',
    intentSuggestion: {
      text: result.intent,
      confidence: result.confidence,
      source: 'ai',
      provider: result.provider,
      model: result.model,
      requestId: result.requestId,
      latencyMs: result.latencyMs,
      usageRecordId: result.usageRecordId,
      reason: result.reason,
    },
  };
}
