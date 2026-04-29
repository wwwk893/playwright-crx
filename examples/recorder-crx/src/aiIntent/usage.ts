/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { AiUsageRecord, NormalizedTokenUsage } from './types';

export function normalizeOpenAiUsage(rawUsage: any): NormalizedTokenUsage {
  const inputTokens = numberOrZero(rawUsage?.prompt_tokens);
  const outputTokens = numberOrZero(rawUsage?.completion_tokens);
  const cachedInputTokens = rawUsage?.prompt_cache_hit_tokens ?? rawUsage?.prompt_tokens_details?.cached_tokens;
  const cacheMissInputTokens = rawUsage?.prompt_cache_miss_tokens;
  return {
    inputTokens,
    outputTokens,
    totalTokens: numberOrZero(rawUsage?.total_tokens) || inputTokens + outputTokens,
    cachedInputTokens: optionalNumber(cachedInputTokens),
    cacheMissInputTokens: optionalNumber(cacheMissInputTokens),
    reasoningTokens: optionalNumber(rawUsage?.completion_tokens_details?.reasoning_tokens) ?? 0,
  };
}

export function normalizeAnthropicUsage(rawUsage: any): NormalizedTokenUsage {
  const inputTokens = numberOrZero(rawUsage?.input_tokens);
  const outputTokens = numberOrZero(rawUsage?.output_tokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cacheCreationInputTokens: numberOrZero(rawUsage?.cache_creation_input_tokens),
    cacheReadInputTokens: numberOrZero(rawUsage?.cache_read_input_tokens),
  };
}

export function emptyUsage(): NormalizedTokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
  };
}

export function summarizeUsage(records: AiUsageRecord[]) {
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const successCalls = records.filter(record => record.success).length;
  const totalLatency = records.reduce((sum, record) => sum + record.latencyMs, 0);
  return {
    calls: records.length,
    successCalls,
    failedCalls: records.length - successCalls,
    successRate: records.length ? successCalls / records.length : 0,
    totalCost: records.reduce((sum, record) => sum + record.cost.total, 0),
    todayCost: records
        .filter(record => record.createdAt.slice(0, 10) === todayKey)
        .reduce((sum, record) => sum + record.cost.total, 0),
    totalInputTokens: records.reduce((sum, record) => sum + record.usage.inputTokens, 0),
    totalOutputTokens: records.reduce((sum, record) => sum + record.usage.outputTokens, 0),
    totalTokens: records.reduce((sum, record) => sum + record.usage.totalTokens, 0),
    avgLatencyMs: records.length ? totalLatency / records.length : 0,
  };
}

export function usageRecordsToJsonl(records: AiUsageRecord[]) {
  return records.map(record => JSON.stringify(record)).join('\n') + (records.length ? '\n' : '');
}

function numberOrZero(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function optionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
