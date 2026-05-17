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
import type { FlowStep } from '../flow/types';
import { escapeRegExp, normalizeGeneratedText, rawAction, stringLiteral } from './stepEmitterUtils';

export function roleNameOptionsSource(step: FlowStep, role: string, targetName: string) {
  const nameSource = roleNameSource(role, targetName);
  if (!isRegexSource(nameSource) && hasExactRoleNameEvidence(step, role, targetName))
    return `{ name: ${nameSource}, exact: true }`;
  return `{ name: ${nameSource} }`;
}

export function roleNameSource(role: string, targetName: string) {
  return role === 'button' ? buttonNameSource(targetName) : stringLiteral(targetName);
}

function hasExactRoleNameEvidence(step: FlowStep, role: string, targetName: string) {
  const evidence = roleNameEvidenceText(step);
  if (!evidence)
    return false;
  const rolePattern = escapeRegExp(role);
  const targetPattern = escapeRegExp(targetName);
  const exactRoleSource = new RegExp(`getByRole\\(\\s*['"]${rolePattern}['"]\\s*,\\s*\\{(?=[^}]*name\\s*:\\s*['"]${targetPattern}['"])(?=[^}]*exact\\s*:\\s*true)[^}]*\\}`, 'i');
  if (exactRoleSource.test(evidence))
    return true;
  const exactInternalRole = new RegExp(`internal:role=${rolePattern}\\[[^\\]]*name\\s*=\\s*(?:\\\\?["'])?${targetPattern}(?:\\\\?["'])?s\\]`, 'i');
  return exactInternalRole.test(evidence);
}

function roleNameEvidenceText(step: FlowStep) {
  return [
    step.sourceCode,
    step.target?.selector,
    step.target?.locator,
    rawAction(step.rawAction).selector,
  ].filter(Boolean).join('\n');
}

function isRegexSource(value: string) {
  return /^\/.*\/[a-z]*$/i.test(value);
}

function buttonNameSource(targetName: string) {
  const compact = normalizeGeneratedText(targetName)?.replace(/\s+/g, '') || '';
  if (compact === '保存')
    return '/^(保存|保\\s*存)$/';
  if (compact === '确定')
    return '/^(确定|确\\s*定)$/';
  if (compact === '确认')
    return '/^(确认|确\\s*认)$/';
  return stringLiteral(targetName);
}
