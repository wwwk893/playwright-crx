/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { INTENT_SYSTEM_PROMPT } from './prompt';
import { endpointWithPath, fetchJsonWithTimeout, normalizeAiIntentOutput, parseJsonObject } from './providerUtils';
import { normalizeAnthropicUsage } from './usage';
import type { AiIntentClientResult, AiIntentInput, AiProviderProfile } from './types';

export async function callAnthropicCompatible(input: AiIntentInput, profile: AiProviderProfile, apiKey: string): Promise<AiIntentClientResult> {
  const body = {
    model: profile.model,
    system: INTENT_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: JSON.stringify(input) }],
    temperature: profile.temperature ?? 0.1,
    max_tokens: profile.maxTokens ?? 400,
  };

  const result = await fetchJsonWithTimeout(endpointWithPath(profile.baseUrl, '/v1/messages'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  }, profile.timeoutMs ?? 15000);

  const raw = result.raw as any;
  const rawText = Array.isArray(raw?.content) ?
    raw.content.filter((block: any) => block?.type === 'text').map((block: any) => block.text).join('\n') :
    '';
  return {
    output: normalizeAiIntentOutput(parseJsonObject(rawText)),
    rawText,
    rawResponse: raw,
    usage: normalizeAnthropicUsage(raw?.usage),
    latencyMs: result.latencyMs,
    requestId: result.requestId || raw?.id,
  };
}
