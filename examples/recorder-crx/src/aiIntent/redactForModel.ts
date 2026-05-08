/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { AiIntentInput } from './types';

const sensitiveKeyPattern = /(password|token|cookie|authorization|secret|api[-_]?key)/i;
const dropKeyPattern = /^(value|rawAction|sourceCode|selector|locator|locatorHints|reasons|rowText|nearbyText|network|responseBody|storageState)$/i;
const jwtPattern = /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g;
const base64LikePattern = /\b[A-Za-z0-9+/=_-]{80,}\b/g;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phonePattern = /\b(?:\+?86[- ]?)?1[3-9]\d{9}\b/g;
const idPattern = /\b\d{17}[\dXx]\b/g;

export function redactAiIntentInput(input: AiIntentInput): AiIntentInput {
  return redactValue(input) as AiIntentInput;
}

function redactValue(value: unknown, key = ''): unknown {
  if (dropKeyPattern.test(key))
    return undefined;
  if (sensitiveKeyPattern.test(key))
    return '***';
  if (typeof value === 'string')
    return redactString(value);
  if (Array.isArray(value))
    return value.map(item => redactValue(item)).filter(item => item !== undefined);
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      const redacted = redactValue(childValue, childKey);
      if (redacted !== undefined && redacted !== '')
        result[childKey] = redacted;
    }
    return result;
  }
  return value;
}

function redactString(value: string) {
  return value
      .replace(jwtPattern, '***token***')
      .replace(base64LikePattern, '***token***')
      .replace(emailPattern, '***email***')
      .replace(phonePattern, '***phone***')
      .replace(idPattern, '***id***')
      .slice(0, 160);
}
