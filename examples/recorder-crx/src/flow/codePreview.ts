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
import type { BusinessFlow, FlowAssertion, FlowRepeatSegment, FlowStep } from './types';
import { actionLabel, summarizeStepSubject } from './display';
import { asLocator } from '@isomorphic/locatorGenerators';

export function generateBusinessFlowPlaywrightCode(flow: BusinessFlow) {
  const lines = [
    `import { test, expect } from '@playwright/test';`,
    '',
    `test(${stringLiteral(flow.flow.name || 'business flow')}, async ({ page }) => {`,
  ];

  const emittedRepeatStepIds = new Set<string>();
  for (const step of flow.steps) {
    const segment = (flow.repeatSegments ?? []).find(segment => firstSegmentStepId(flow, segment) === step.id);
    if (segment) {
      emitRepeatSegment(lines, flow, segment);
      segment.stepIds.forEach(stepId => emittedRepeatStepIds.add(stepId));
      continue;
    }
    if (emittedRepeatStepIds.has(step.id))
      continue;

    emitStep(lines, step, '  ');
  }

  lines.push('});');
  return `${lines.join('\n')}\n`;
}

export function generateBusinessFlowPlaybackCode(flow: BusinessFlow) {
  const lines = [
    `import { test, expect } from '@playwright/test';`,
    '',
    `test(${stringLiteral(flow.flow.name || 'business flow')}, async ({ page }) => {`,
  ];

  const emittedRepeatStepIds = new Set<string>();
  for (const step of flow.steps) {
    const segment = (flow.repeatSegments ?? []).find(segment => firstSegmentStepId(flow, segment) === step.id);
    if (segment) {
      emitExpandedRepeatSegment(lines, flow, segment);
      segment.stepIds.forEach(stepId => emittedRepeatStepIds.add(stepId));
      continue;
    }
    if (emittedRepeatStepIds.has(step.id))
      continue;

    emitStep(lines, step, '  ');
  }

  lines.push('});');
  return `${lines.join('\n')}\n`;
}

export function countBusinessFlowPlaybackActions(flow: BusinessFlow) {
  let count = 0;
  const emittedRepeatStepIds = new Set<string>();
  for (const step of flow.steps) {
    const segment = (flow.repeatSegments ?? []).find(segment => firstSegmentStepId(flow, segment) === step.id);
    if (segment) {
      const rows = segment.rows.length ? segment.rows : [{ id: 'row-1', values: {} }];
      const segmentSteps = flow.steps.filter(step => segment.stepIds.includes(step.id));
      count += rows.length * segmentSteps.reduce((total, step) => total + countStepActions(step), 0);
      segment.stepIds.forEach(stepId => emittedRepeatStepIds.add(stepId));
      continue;
    }
    if (emittedRepeatStepIds.has(step.id))
      continue;

    count += countStepActions(step);
  }
  return count;
}

function emitRepeatSegment(lines: string[], flow: BusinessFlow, segment: FlowRepeatSegment) {
  const parameterById = new Map(segment.parameters.map(parameter => [parameter.id, parameter]));
  const data = segment.rows.map(row => Object.fromEntries(Object.entries(row.values).map(([parameterId, value]) => {
    const parameter = parameterById.get(parameterId);
    return [parameter?.variableName ?? parameterId, value];
  })));
  lines.push(`  // 循环片段: ${segment.name}`);
  lines.push(`  const ${segmentDataName(segment)} = ${JSON.stringify(data, null, 2).replace(/\n/g, '\n  ')};`);
  lines.push(`  for (const row of ${segmentDataName(segment)}) {`);
  for (const step of flow.steps.filter(step => segment.stepIds.includes(step.id)))
    emitStep(lines, step, '    ', segment);
  if (segment.assertionTemplate)
    lines.push(`    // template assertion: ${replaceTemplateValues(segment.assertionTemplate.description, segment)}`);
  lines.push('  }');
}

function firstSegmentStepId(flow: BusinessFlow, segment: FlowRepeatSegment) {
  return flow.steps.find(step => segment.stepIds.includes(step.id))?.id;
}

function emitExpandedRepeatSegment(lines: string[], flow: BusinessFlow, segment: FlowRepeatSegment) {
  const rows = segment.rows.length ? segment.rows : [{ id: 'row-1', values: {} }];
  rows.forEach((row, rowIndex) => {
    lines.push(`  // 循环片段 ${segment.name}: 第 ${rowIndex + 1} 行`);
    for (const step of flow.steps.filter(step => segment.stepIds.includes(step.id)))
      emitStep(lines, step, '  ', segment, row.values);
    if (segment.assertionTemplate)
      lines.push(`  // template assertion: ${replaceTemplateValuesWithRow(segment.assertionTemplate.description, segment, row.values)}`);
  });
}

function emitStep(lines: string[], step: FlowStep, indent: string, segment?: FlowRepeatSegment, rowValues?: Record<string, string>) {
  lines.push(`${indent}// ${step.id} ${actionLabel[step.action]}: ${summarizeStepSubject(step)}`);
  const sourceCode = sourceCodeForStep(step);
  if (sourceCode)
    lines.push(...sourceCode.map(line => `${indent}${segment ? parameterizeLine(line, step, segment, rowValues) : line}`));
  else
    lines.push(`${indent}// ${step.id} has no runnable Playwright action source.`);

  for (const assertion of step.assertions.filter(assertion => assertion.enabled))
    lines.push(`${indent}${segment ? parameterizeLine(renderAssertion(assertion), step, segment, rowValues) : renderAssertion(assertion)}`);
}

function countStepActions(step: FlowStep) {
  const sourceActionCount = sourceCodeForStep(step)
      ?.filter(line => isRunnableLine(line))
      .length ?? 0;
  const assertionActionCount = step.assertions
      .filter(assertion => assertion.enabled)
      .map(renderAssertion)
      .filter(line => isRunnableLine(line))
      .length;
  return sourceActionCount + assertionActionCount;
}

function isRunnableLine(line: string) {
  return /^(await|const|let|var)\s/.test(line.trim());
}

function sourceCodeForStep(step: FlowStep) {
  const sourceCode = normalizeActionSource(step.sourceCode);
  const fallback = renderRawActionSource(step);
  if (fallback)
    return normalizeActionSource(fallback);
  if (sourceCode && sourceMatchesStep(sourceCode, step))
    return sourceCode;
  return sourceCode;
}

function sourceMatchesStep(sourceCode: string[], step: FlowStep) {
  const joined = sourceCode.join('\n');
  switch (step.action) {
    case 'click':
      return /\.click\(/.test(joined) && sourceMentionsStepTarget(joined, step);
    case 'fill':
      return /\.fill\(/.test(joined) && (!step.value || joined.includes(step.value));
    case 'press':
      return /\.press\(/.test(joined) && (!step.value || joined.includes(step.value));
    case 'wait':
      return /\.waitForTimeout\(/.test(joined) && (!step.value || joined.includes(step.value));
    case 'select':
      return /\.selectOption\(/.test(joined) || /\.click\(/.test(joined);
    case 'check':
      return /\.check\(/.test(joined);
    case 'uncheck':
      return /\.uncheck\(/.test(joined);
    case 'upload':
      return /\.setInputFiles\(/.test(joined);
    case 'navigate':
      return /\.goto\(/.test(joined) && (!step.url || joined.includes(step.url));
    default:
      return true;
  }
}

function sourceMentionsStepTarget(sourceCode: string, step: FlowStep) {
  const targetTokens = [
    step.target?.testId,
    step.target?.name,
    step.target?.label,
    step.target?.text,
    step.target?.placeholder,
    step.target?.displayName,
  ].filter(Boolean) as string[];
  return !targetTokens.length || targetTokens.some(token => sourceCode.includes(token));
}

function renderRawActionSource(step: FlowStep) {
  const action = rawAction(step.rawAction);
  const selector = action.selector || step.target?.selector || step.target?.locator;
  switch (action.name || step.action) {
    case 'navigate':
    case 'goto':
    case 'openPage':
      return action.url || step.url ? `await page.goto(${stringLiteral(action.url || step.url)});` : undefined;
    case 'click':
      return selector ? `await ${locatorExpressionForSelector(selector)}.click();` : targetClickFallback(step);
    case 'fill':
      return selector ? `await ${locatorExpressionForSelector(selector)}.fill(${stringLiteral(action.text ?? action.value ?? step.value ?? '')});` : undefined;
    case 'press':
      return selector ? `await ${locatorExpressionForSelector(selector)}.press(${stringLiteral(action.key ?? step.value ?? '')});` : undefined;
    case 'wait':
    case 'waitForTimeout':
      return `await page.waitForTimeout(${waitMilliseconds(step.value ?? action.timeout ?? action.value ?? action.text)});`;
    case 'check':
      return selector ? `await ${locatorExpressionForSelector(selector)}.check();` : undefined;
    case 'uncheck':
      return selector ? `await ${locatorExpressionForSelector(selector)}.uncheck();` : undefined;
    case 'select':
    case 'selectOption':
      return selector ? `await ${locatorExpressionForSelector(selector)}.selectOption(${stringLiteral(action.options?.[0] ?? step.value ?? '')});` : undefined;
    case 'setInputFiles':
    case 'upload':
      return selector ? `await ${locatorExpressionForSelector(selector)}.setInputFiles(${stringLiteral(action.files?.[0] ?? step.value ?? '')});` : undefined;
    default:
      return undefined;
  }
}

function waitMilliseconds(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric))
    return 1000;
  return Math.max(0, Math.round(numeric));
}

function targetClickFallback(step: FlowStep) {
  if (step.target?.testId)
    return `await page.getByTestId(${stringLiteral(step.target.testId)}).click();`;
  if (step.target?.role && (step.target.name || step.target.text))
    return `await page.getByRole(${stringLiteral(step.target.role)}, { name: ${stringLiteral(step.target.name || step.target.text)} }).click();`;
  const text = step.target?.text || step.target?.name || step.target?.label || step.target?.displayName;
  return text ? `await page.getByText(${stringLiteral(text)}).click();` : undefined;
}

function rawAction(value: unknown) {
  const record = value && typeof value === 'object' ? value as { action?: Record<string, unknown> } & Record<string, unknown> : {};
  const action = record.action && typeof record.action === 'object' ? record.action : record;
  return action as {
    name?: string;
    selector?: string;
    url?: string;
    text?: string;
    value?: string;
    timeout?: number;
    key?: string;
    options?: string[];
    files?: string[];
  };
}

export function generateAssertionCodePreview(flow: BusinessFlow) {
  const lines: string[] = [];
  for (const step of flow.steps) {
    const assertions = step.assertions.filter(assertion => assertion.enabled);
    if (!assertions.length)
      continue;

    lines.push(`// ${step.id} ${step.intent || step.comment || step.action}`);
    for (const assertion of assertions)
      lines.push(renderAssertion(assertion));
  }
  return lines.join('\n');
}

function renderAssertion(assertion: FlowAssertion) {
  switch (assertion.subject) {
    case 'page':
      return `// assert page URL matches ${stringLiteral(assertion.expected || assertion.params?.url || '')}`;
    case 'element': {
      const targetExpression = locatorExpressionForSelector(assertion.target?.selector) ||
        `page.getByText(${stringLiteral(assertion.params?.targetSummary || assertion.target?.label || assertion.target?.text || '目标元素')})`;
      if (assertion.type === 'visible')
        return `await expect(${targetExpression}).toBeVisible();`;
      if (assertion.type === 'valueEquals')
        return `await expect(${targetExpression}).toHaveValue(${stringLiteral(assertion.expected || '')});`;
      if (assertion.type === 'textEquals')
        return `await expect(${targetExpression}).toHaveText(${stringLiteral(assertion.expected || '')});`;
      return `await expect(${targetExpression}).toContainText(${stringLiteral(assertion.expected || '')});`;
    }
    case 'table': {
      const tableLocator = locatorExpressionForSelector(assertion.params?.tableSelector) ||
        `page.getByText(${stringLiteral(assertion.params?.tableArea || '表格/列表')}).locator('..')`;
      const rowKeyword = stringLiteral(assertion.params?.rowKeyword || assertion.expected || '');
      const columnName = assertion.params?.columnName;
      const columnValue = assertion.params?.columnValue;
      const rowLocator = `${tableLocator}.getByRole('row').filter({ hasText: ${rowKeyword} })`;
      if (columnName && columnValue)
        return `await expect(${rowLocator}).toContainText(${stringLiteral(columnValue)});`;
      return `await expect(${rowLocator}).toBeVisible();`;
    }
    case 'toast':
      return `await expect(page.getByText(${stringLiteral(assertion.expected || assertion.params?.message || '')})).toBeVisible();`;
    case 'api':
      return `// expect response ${[assertion.params?.method, assertion.params?.url, assertion.params?.status || assertion.params?.requestContains].filter(Boolean).join(' ')}`;
    default:
      return `// custom assertion: ${assertion.expected || assertion.note || assertion.type}`;
  }
}

function normalizeActionSource(sourceCode?: string) {
  return sourceCode
      ?.split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
}

function parameterizeLine(line: string, step: FlowStep, segment: FlowRepeatSegment, rowValues?: Record<string, string>) {
  const parameter = segment.parameters.find(parameter => parameter.enabled && parameter.sourceStepId === step.id);
  if (!parameter?.currentValue)
    return line;
  const replacement = rowValues ? stringLiteral(rowValues[parameter.id] ?? parameter.currentValue) : `String(row.${parameter.variableName})`;
  return line
      .replaceAll(JSON.stringify(parameter.currentValue), replacement)
      .replaceAll(`'${escapeSingleQuoted(parameter.currentValue)}'`, replacement)
      .replaceAll(`"${parameter.currentValue.replace(/"/g, '\\"')}"`, replacement);
}

function replaceTemplateValues(value: string, segment: FlowRepeatSegment) {
  return segment.parameters.reduce((current, parameter) => {
    return current.replaceAll(`{{${parameter.variableName}}}`, `row.${parameter.variableName}`);
  }, value);
}

function replaceTemplateValuesWithRow(value: string, segment: FlowRepeatSegment, rowValues: Record<string, string>) {
  return segment.parameters.reduce((current, parameter) => {
    return current.replaceAll(`{{${parameter.variableName}}}`, rowValues[parameter.id] ?? parameter.currentValue);
  }, value);
}

function segmentDataName(segment: FlowRepeatSegment) {
  return `${segment.id.replace(/[^a-zA-Z0-9_$]/g, '_')}Data`;
}

function escapeSingleQuoted(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function locatorExpressionForSelector(selector: unknown) {
  if (typeof selector !== 'string' || !selector.trim())
    return undefined;
  try {
    return `page.${asLocator('javascript', selector)}`;
  } catch {
    return `page.locator(${stringLiteral(selector)})`;
  }
}

function stringLiteral(value: unknown) {
  return JSON.stringify(String(value ?? ''));
}
