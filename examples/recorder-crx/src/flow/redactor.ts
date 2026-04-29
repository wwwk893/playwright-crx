/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import type { BusinessFlow } from './types';

const sensitiveKeyPattern = /(password|passwd|pwd|token|cookie|authorization|auth|secret|session)/i;
const jwtPattern = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const base64LikePattern = /\b[A-Za-z0-9+/=_-]{64,}\b/g;
const phonePattern = /\b1[3-9]\d{9}\b/g;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const idPattern = /\b\d{6}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g;

export function redactBusinessFlow(flow: BusinessFlow): BusinessFlow {
  return redactValue(flow) as BusinessFlow;
}

export function redactValue(value: unknown): unknown {
  return redact(value, undefined, new WeakMap<object, unknown>());
}

function redact(value: unknown, key: string | undefined, seen: WeakMap<object, unknown>): unknown {
  if (key && sensitiveKeyPattern.test(key))
    return '***';

  if (typeof value === 'string')
    return redactString(value);
  if (typeof value !== 'object' || value === null)
    return value;

  const cached = seen.get(value);
  if (cached)
    return cached;

  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    seen.set(value, clone);
    for (const item of value)
      clone.push(redact(item, undefined, seen));
    return clone;
  }

  const clone: Record<string, unknown> = {};
  seen.set(value, clone);
  for (const [childKey, childValue] of Object.entries(value))
    clone[childKey] = redact(childValue, childKey, seen);
  return clone;
}

function redactString(value: string) {
  let result = value
      .replace(jwtPattern, '***token***')
      .replace(base64LikePattern, '***token***')
      .replace(phonePattern, '***phone***')
      .replace(emailPattern, '***email***')
      .replace(idPattern, '***id***');

  if (result.length > 2000)
    result = `${result.slice(0, 2000)}...***truncated***`;
  return result;
}
