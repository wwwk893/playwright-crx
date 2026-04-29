/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { AiIntentBatchOutput } from './types';

export function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith('{'))
    return JSON.parse(trimmed);
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match)
    throw new Error('模型没有返回 JSON 对象。');
  return JSON.parse(match[0]);
}

export function normalizeAiIntentOutput(value: unknown): AiIntentBatchOutput {
  const items = Array.isArray((value as any)?.items) ? (value as any).items : [];
  return {
    items: items
        .map((item: any) => ({
          stepId: typeof item?.stepId === 'string' ? item.stepId : '',
          intent: typeof item?.intent === 'string' ? item.intent.trim() : '',
          confidence: typeof item?.confidence === 'number' ? clamp(item.confidence, 0, 1) : 0.8,
          reason: typeof item?.reason === 'string' ? item.reason.slice(0, 160) : undefined,
        }))
        .filter((item: { stepId: string; intent: string }) => item.stepId && item.intent),
  };
}

export function endpointWithPath(baseUrl: string, path: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed.endsWith(path))
    return trimmed;
  if (path === '/chat/completions' && trimmed.endsWith('/v1'))
    return `${trimmed}${path}`;
  if (path === '/v1/messages' && trimmed.endsWith('/v1'))
    return `${trimmed}/messages`;
  return `${trimmed}${path}`;
}

export async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const text = await response.text();
    const latencyMs = Math.round(performance.now() - startedAt);
    if (!response.ok)
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 240) || response.statusText}`);
    return {
      raw: text ? JSON.parse(text) : {},
      text,
      latencyMs,
      requestId: response.headers.get('x-request-id') || response.headers.get('request-id') || undefined,
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
