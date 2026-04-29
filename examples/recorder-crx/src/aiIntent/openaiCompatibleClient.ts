/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { INTENT_SYSTEM_PROMPT } from './prompt';
import { endpointWithPath, fetchJsonWithTimeout, normalizeAiIntentOutput, parseJsonObject } from './providerUtils';
import { normalizeOpenAiUsage } from './usage';
import type { AiIntentClientResult, AiIntentInput, AiProviderProfile } from './types';

export async function callOpenAiCompatible(input: AiIntentInput, profile: AiProviderProfile, apiKey: string): Promise<AiIntentClientResult> {
  const body: Record<string, unknown> = {
    model: profile.model,
    messages: [
      { role: 'system', content: INTENT_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(input) },
    ],
    temperature: profile.temperature ?? 0.1,
    max_tokens: profile.maxTokens ?? 400,
    stream: false,
  };

  if (profile.responseMode === 'json_object')
    body.response_format = { type: 'json_object' };
  if (profile.responseMode === 'json_schema') {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: 'intent_suggestions',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  stepId: { type: 'string' },
                  intent: { type: 'string' },
                  confidence: { type: 'number' },
                  reason: { type: 'string' },
                },
                required: ['stepId', 'intent', 'confidence'],
              },
            },
          },
          required: ['items'],
        },
      },
    };
  }
  if (profile.thinking === 'disabled')
    body.thinking = { type: 'disabled' };

  const result = await fetchJsonWithTimeout(endpointWithPath(profile.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  }, profile.timeoutMs ?? 15000);

  const raw = result.raw as any;
  const rawText = raw?.choices?.[0]?.message?.content ?? '';
  return {
    output: normalizeAiIntentOutput(parseJsonObject(rawText)),
    rawText,
    rawResponse: raw,
    usage: normalizeOpenAiUsage(raw?.usage),
    latencyMs: result.latencyMs,
    requestId: result.requestId || raw?.id,
  };
}
