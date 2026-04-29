/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { AiCostBreakdown, AiModelPricing, NormalizedTokenUsage } from './types';

export function calculateAiCost(usage: NormalizedTokenUsage, pricing: AiModelPricing): AiCostBreakdown {
  const per = 1_000_000;
  const cachedInputCost = ((usage.cachedInputTokens ?? 0) * (pricing.cachedInputPer1M ?? pricing.inputPer1M ?? 0)) / per;
  const cacheMissInputCost = ((usage.cacheMissInputTokens ?? 0) * (pricing.cacheMissInputPer1M ?? pricing.inputPer1M ?? 0)) / per;
  const inputWithoutCacheBreakdown = usage.cacheMissInputTokens === undefined && usage.cachedInputTokens === undefined ? usage.inputTokens : 0;
  const inputCost = (inputWithoutCacheBreakdown * (pricing.inputPer1M ?? 0)) / per;
  const outputCost = (usage.outputTokens * (pricing.outputPer1M ?? 0)) / per;
  const cacheWriteCost = ((usage.cacheCreationInputTokens ?? 0) * (pricing.cacheWritePer1M ?? 0)) / per;
  const cacheReadCost = ((usage.cacheReadInputTokens ?? 0) * (pricing.cacheReadPer1M ?? pricing.cachedInputPer1M ?? 0)) / per;
  const reasoningCost = ((usage.reasoningTokens ?? 0) * (pricing.reasoningOutputPer1M ?? 0)) / per;
  const requestCost = pricing.requestFee ?? 0;
  const total = inputCost + outputCost + cachedInputCost + cacheMissInputCost + cacheWriteCost + cacheReadCost + reasoningCost + requestCost;

  return {
    currency: pricing.currency || 'USD',
    total,
    inputCost,
    outputCost,
    cachedInputCost,
    cacheMissInputCost,
    cacheWriteCost,
    cacheReadCost,
    reasoningCost,
    requestCost,
  };
}
