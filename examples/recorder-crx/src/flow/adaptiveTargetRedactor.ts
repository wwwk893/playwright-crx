/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import type { AdaptiveTargetSnapshot } from './adaptiveTargetTypes';
import { redactValue } from './redactor';

const sensitiveAssignmentPattern = /\b(password|passwd|pwd|token|secret|authorization|auth|cookie|session)\s*[:=]\s*["']?[^"'\s,;)\]]+["']?/gi;
const sensitiveAttributePattern = /\b(data-(?:password|passwd|pwd|token|secret|authorization|auth|cookie|session))=(["'])[^"']*\2/gi;

export function redactAdaptiveTargetSnapshot(snapshot: AdaptiveTargetSnapshot): AdaptiveTargetSnapshot {
  return redactAdaptiveValue(snapshot) as AdaptiveTargetSnapshot;
}

export function redactAdaptiveValue(value: unknown): unknown {
  return redactAdaptive(redactValue(value), undefined, new WeakMap<object, unknown>());
}

function redactAdaptive(value: unknown, key: string | undefined, seen: WeakMap<object, unknown>): unknown {
  if (key && /password|passwd|pwd|token|secret|authorization|auth|cookie|session/i.test(key))
    return '***';
  if (typeof value === 'string')
    return redactAdaptiveString(value);
  if (!value || typeof value !== 'object')
    return value;

  const cached = seen.get(value);
  if (cached)
    return cached;

  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    seen.set(value, clone);
    for (const item of value)
      clone.push(redactAdaptive(item, undefined, seen));
    return clone;
  }

  const clone: Record<string, unknown> = {};
  seen.set(value, clone);
  for (const [childKey, childValue] of Object.entries(value))
    clone[childKey] = redactAdaptive(childValue, childKey, seen);
  return clone;
}

function redactAdaptiveString(value: string) {
  return value
      .replace(sensitiveAttributePattern, '$1=$2***$2')
      .replace(sensitiveAssignmentPattern, '$1=***');
}
