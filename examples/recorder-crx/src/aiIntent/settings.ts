/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { AiIntentSettings, AiProviderProfile } from './types';

const now = () => new Date().toISOString();

export const defaultAiIntentSettings: AiIntentSettings = {
  enabled: false,
  mode: 'ai-first',
  activeProfileId: 'deepseek-v4-flash',
  batchSize: 5,
  debounceMs: 1500,
  maxBatchSize: 10,
  timeoutMs: 15000,
};

export function createDeepSeekV4FlashProfile(): AiProviderProfile {
  const createdAt = now();
  return {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    enabled: true,
    protocol: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    apiKeyStorageKey: 'ai-intent-api-key-deepseek-v4-flash',
    temperature: 0.1,
    maxTokens: 400,
    timeoutMs: 15000,
    responseMode: 'json_object',
    thinking: 'disabled',
    pricing: {
      currency: 'USD',
      unit: 'per_1m_tokens',
      cachedInputPer1M: 0.0028,
      cacheMissInputPer1M: 0.14,
      outputPer1M: 0.28,
    },
    createdAt,
    updatedAt: createdAt,
  };
}

export function createBlankProfile(protocol: AiProviderProfile['protocol'] = 'openai-compatible'): AiProviderProfile {
  const createdAt = now();
  const id = `profile-${Date.now()}`;
  return {
    id,
    name: protocol === 'anthropic-compatible' ? 'Anthropic-compatible Profile' : 'OpenAI-compatible Profile',
    enabled: true,
    protocol,
    baseUrl: protocol === 'anthropic-compatible' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1',
    model: '',
    apiKeyStorageKey: `ai-intent-api-key-${id}`,
    temperature: 0.1,
    maxTokens: 400,
    timeoutMs: 15000,
    responseMode: protocol === 'anthropic-compatible' ? 'prompt_json_only' : 'json_object',
    thinking: 'omit',
    pricing: {
      currency: 'USD',
      unit: 'per_1m_tokens',
    },
    createdAt,
    updatedAt: createdAt,
  };
}

export function normalizeAiIntentSettings(settings?: Partial<AiIntentSettings>): AiIntentSettings {
  const maxBatchSize = clamp(settings?.maxBatchSize ?? defaultAiIntentSettings.maxBatchSize, 1, 10);
  return {
    ...defaultAiIntentSettings,
    ...settings,
    maxBatchSize,
    batchSize: clamp(settings?.batchSize ?? defaultAiIntentSettings.batchSize, 1, maxBatchSize),
    debounceMs: Math.max(0, settings?.debounceMs ?? defaultAiIntentSettings.debounceMs),
    timeoutMs: Math.max(1000, settings?.timeoutMs ?? defaultAiIntentSettings.timeoutMs),
  };
}

export function normalizeProfiles(profiles?: AiProviderProfile[]): AiProviderProfile[] {
  const normalized = profiles?.length ? profiles : [createDeepSeekV4FlashProfile()];
  return normalized.map(profile => ({
    ...profile,
    enabled: profile.enabled !== false,
    apiKeyStorageKey: profile.apiKeyStorageKey || `ai-intent-api-key-${profile.id}`,
    responseMode: profile.responseMode || (profile.protocol === 'anthropic-compatible' ? 'prompt_json_only' : 'json_object'),
    pricing: {
      ...profile.pricing,
      currency: profile.pricing?.currency || 'USD',
      unit: 'per_1m_tokens',
    },
  }));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
