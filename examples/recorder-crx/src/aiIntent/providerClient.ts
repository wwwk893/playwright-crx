/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { callAnthropicCompatible } from './anthropicCompatibleClient';
import { callOpenAiCompatible } from './openaiCompatibleClient';
import type { AiIntentClientResult, AiIntentInput, AiProviderProfile } from './types';

export async function suggestAiIntentBatch(input: AiIntentInput, profile: AiProviderProfile, apiKey: string): Promise<AiIntentClientResult> {
  if (!apiKey.trim())
    throw new Error('API key 不能为空。');
  if (!profile.baseUrl.trim())
    throw new Error('Base URL 不能为空。');
  if (!profile.model.trim())
    throw new Error('Model 不能为空。');

  if (profile.protocol === 'anthropic-compatible')
    return callAnthropicCompatible(input, profile, apiKey);
  return callOpenAiCompatible(input, profile, apiKey);
}
