/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { BusinessFlow, FlowStep } from '../flow/types';
import { buildAiIntentInput, buildTestConnectionInput } from './prompt';
import { calculateAiCost } from './pricing';
import { suggestAiIntentBatch } from './providerClient';
import { appendAiUsageRecords } from './storage';
import { emptyUsage } from './usage';
import type { AiIntentGenerationResult, AiIntentMode, AiIntentSettings, AiProviderProfile, AiUsageRecord } from './types';

export interface GenerateAiIntentsOptions {
  flow: BusinessFlow;
  settings: AiIntentSettings;
  profile: AiProviderProfile;
  apiKey: string;
  stepIds?: string[];
  mode?: AiUsageRecord['mode'];
}

export async function generateAiIntentsForFlow(options: GenerateAiIntentsOptions): Promise<{
  results: AiIntentGenerationResult[];
  records: AiUsageRecord[];
}> {
  const steps = selectAiIntentSteps(options.flow, options.settings.mode, options.stepIds);
  const batches = chunk(steps, Math.min(options.settings.batchSize || 5, options.settings.maxBatchSize || 10));
  const allResults: AiIntentGenerationResult[] = [];
  const records: AiUsageRecord[] = [];

  for (const batch of batches) {
    const input = buildAiIntentInput(options.flow, batch);
    const requestSizeChars = JSON.stringify(input).length;
    const startedAt = performance.now();
    const usageRecordId = `ai-usage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const response = await suggestAiIntentBatch(input, options.profile, options.apiKey);
      const cost = calculateAiCost(response.usage, options.profile.pricing);
      const record = createUsageRecord({
        id: usageRecordId,
        flow: options.flow,
        profile: options.profile,
        stepIds: batch.map(step => step.id),
        mode: options.mode ?? (batch.length > 1 ? 'batch' : 'single'),
        success: true,
        latencyMs: response.latencyMs,
        usage: response.usage,
        cost,
        requestSizeChars,
        responseSizeChars: response.rawText.length,
      });
      records.push(record);
      for (const item of response.output.items) {
        if (!batch.some(step => step.id === item.stepId))
          continue;
        allResults.push({
          stepId: item.stepId,
          intent: item.intent,
          confidence: item.confidence ?? 0.8,
          reason: item.reason,
          provider: options.profile.name,
          model: options.profile.model,
          requestId: response.requestId,
          latencyMs: response.latencyMs,
          usageRecordId: record.id,
        });
      }
    } catch (error) {
      const latencyMs = Math.round(performance.now() - startedAt);
      records.push(createUsageRecord({
        id: usageRecordId,
        flow: options.flow,
        profile: options.profile,
        stepIds: batch.map(step => step.id),
        mode: options.mode ?? (batch.length > 1 ? 'batch' : 'single'),
        success: false,
        error: error instanceof Error ? error.message : String(error),
        latencyMs,
        usage: emptyUsage(),
        cost: calculateAiCost(emptyUsage(), options.profile.pricing),
        requestSizeChars,
        responseSizeChars: 0,
      }));
    }
  }

  await appendAiUsageRecords(records);
  return { results: allResults, records };
}

export async function testAiProviderConnection(profile: AiProviderProfile, apiKey: string): Promise<{
  intent?: string;
  record: AiUsageRecord;
}> {
  const input = buildTestConnectionInput();
  const requestSizeChars = JSON.stringify(input).length;
  const startedAt = performance.now();
  const usageRecordId = `ai-usage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const response = await suggestAiIntentBatch(input, profile, apiKey);
    const record = createUsageRecord({
      id: usageRecordId,
      flow: { flow: { id: 'test-connection' } } as BusinessFlow,
      profile,
      stepIds: ['test-001'],
      mode: 'test',
      success: true,
      latencyMs: response.latencyMs,
      usage: response.usage,
      cost: calculateAiCost(response.usage, profile.pricing),
      requestSizeChars,
      responseSizeChars: response.rawText.length,
    });
    await appendAiUsageRecords([record]);
    return { intent: response.output.items[0]?.intent, record };
  } catch (error) {
    const record = createUsageRecord({
      id: usageRecordId,
      flow: { flow: { id: 'test-connection' } } as BusinessFlow,
      profile,
      stepIds: ['test-001'],
      mode: 'test',
      success: false,
      error: error instanceof Error ? error.message : String(error),
      latencyMs: Math.round(performance.now() - startedAt),
      usage: emptyUsage(),
      cost: calculateAiCost(emptyUsage(), profile.pricing),
      requestSizeChars,
      responseSizeChars: 0,
    });
    await appendAiUsageRecords([record]);
    return { record };
  }
}

export function selectAiIntentSteps(flow: BusinessFlow, mode: AiIntentMode, stepIds?: string[]): FlowStep[] {
  const allowedStepIds = stepIds ? new Set(stepIds) : undefined;
  return flow.steps.filter(step => {
    if (allowedStepIds && !allowedStepIds.has(step.id))
      return false;
    if (step.intentSource === 'user')
      return false;
    if (!allowedStepIds && step.intentSource === 'ai')
      return false;
    if (!allowedStepIds && mode === 'rule-fallback' && step.intent && (step.intentSuggestion?.confidence ?? 0) >= 0.75)
      return false;
    if (step.action === 'unknown' && !step.context && !step.target)
      return false;
    return !!step.context || !!step.target;
  });
}

function createUsageRecord(args: {
  id: string;
  flow: BusinessFlow;
  profile: AiProviderProfile;
  stepIds: string[];
  mode: AiUsageRecord['mode'];
  success: boolean;
  error?: string;
  latencyMs: number;
  usage: AiUsageRecord['usage'];
  cost: AiUsageRecord['cost'];
  requestSizeChars: number;
  responseSizeChars: number;
}): AiUsageRecord {
  return {
    id: args.id,
    createdAt: new Date().toISOString(),
    flowId: args.flow.flow.id,
    recordId: args.flow.flow.id,
    stepIds: args.stepIds,
    providerProfileId: args.profile.id,
    providerName: args.profile.name,
    protocol: args.profile.protocol,
    baseUrl: args.profile.baseUrl,
    model: args.profile.model,
    mode: args.mode,
    success: args.success,
    error: args.error,
    latencyMs: args.latencyMs,
    usage: args.usage,
    pricingSnapshot: args.profile.pricing,
    cost: args.cost,
    requestSizeChars: args.requestSizeChars,
    responseSizeChars: args.responseSizeChars,
  };
}

function chunk<T>(items: T[], size: number) {
  const result: T[][] = [];
  const batchSize = Math.max(1, size);
  for (let i = 0; i < items.length; i += batchSize)
    result.push(items.slice(i, i + batchSize));
  return result;
}
