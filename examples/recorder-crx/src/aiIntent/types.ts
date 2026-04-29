/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { FlowActionType } from '../flow/types';

export type AiProviderProtocol = 'openai-compatible' | 'anthropic-compatible';
export type AiResponseMode = 'json_object' | 'json_schema' | 'prompt_json_only';
export type AiThinkingMode = 'disabled' | 'enabled' | 'omit';
export type AiIntentMode = 'ai-first' | 'rule-fallback' | 'manual';

export interface AiModelPricing {
  currency: 'USD' | 'CNY' | string;
  unit: 'per_1m_tokens';
  inputPer1M?: number;
  outputPer1M?: number;
  cachedInputPer1M?: number;
  cacheMissInputPer1M?: number;
  cacheWritePer1M?: number;
  cacheReadPer1M?: number;
  reasoningOutputPer1M?: number;
  requestFee?: number;
}

export interface AiProviderProfile {
  id: string;
  name: string;
  enabled: boolean;
  protocol: AiProviderProtocol;
  baseUrl: string;
  model: string;
  apiKeyStorageKey: string;
  apiKeyPreview?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  responseMode: AiResponseMode;
  thinking?: AiThinkingMode;
  pricing: AiModelPricing;
  createdAt: string;
  updatedAt: string;
}

export interface AiIntentSettings {
  enabled: boolean;
  mode: AiIntentMode;
  activeProfileId?: string;
  batchSize: number;
  debounceMs: number;
  maxBatchSize: number;
  timeoutMs: number;
}

export interface NormalizedTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
  cacheMissInputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  reasoningTokens?: number;
}

export interface AiCostBreakdown {
  currency: string;
  total: number;
  inputCost: number;
  outputCost: number;
  cachedInputCost: number;
  cacheMissInputCost: number;
  cacheWriteCost: number;
  cacheReadCost: number;
  reasoningCost: number;
  requestCost: number;
}

export interface AiUsageRecord {
  id: string;
  createdAt: string;
  flowId?: string;
  recordId?: string;
  stepIds: string[];
  providerProfileId: string;
  providerName: string;
  protocol: AiProviderProtocol;
  baseUrl: string;
  model: string;
  mode: 'single' | 'batch' | 'test';
  success: boolean;
  error?: string;
  latencyMs: number;
  usage: NormalizedTokenUsage;
  pricingSnapshot: AiModelPricing;
  cost: AiCostBreakdown;
  requestSizeChars: number;
  responseSizeChars: number;
}

export interface AiIntentTargetInput {
  role?: string;
  text?: string;
  testId?: string;
  ariaLabel?: string;
  placeholder?: string;
}

export interface AiIntentContextInput {
  page?: string;
  url?: string;
  breadcrumb?: string[];
  activeTab?: string;
  section?: string;
  table?: string;
  row?: string;
  column?: string;
  form?: string;
  field?: string;
  dialog?: string;
  dropdown?: string;
  target?: AiIntentTargetInput;
}

export interface AiIntentAfterInput {
  activeTab?: string;
  dialog?: string;
  toast?: string;
  url?: string;
  selectedOption?: string;
}

export interface AiIntentStepInput {
  stepId: string;
  order: number;
  action: FlowActionType;
  target?: AiIntentTargetInput;
  before?: AiIntentContextInput;
  after?: AiIntentAfterInput;
}

export interface AiIntentInput {
  flow: {
    id?: string;
    name?: string;
    module?: string;
    page?: string;
    role?: string;
    businessGoal?: string;
  };
  steps: AiIntentStepInput[];
}

export interface AiIntentBatchItem {
  stepId: string;
  intent: string;
  confidence?: number;
  reason?: string;
}

export interface AiIntentBatchOutput {
  items: AiIntentBatchItem[];
}

export interface AiIntentClientResult {
  output: AiIntentBatchOutput;
  rawText: string;
  rawResponse?: unknown;
  usage: NormalizedTokenUsage;
  latencyMs: number;
  requestId?: string;
}

export interface AiIntentGenerationResult {
  stepId: string;
  intent: string;
  confidence: number;
  reason?: string;
  provider: string;
  model: string;
  requestId?: string;
  latencyMs: number;
  usageRecordId: string;
}
