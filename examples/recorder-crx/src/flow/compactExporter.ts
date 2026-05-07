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
import { compactUiSemanticContext } from '../uiSemantics';
import type { BusinessFlow, FlowNetworkEvent, FlowStep } from './types';
import type { StepContextSnapshot } from './pageContextTypes';

type CompactValue = string | number | boolean | null | CompactValue[] | { [key: string]: CompactValue | undefined };

export function toCompactFlow(flow: BusinessFlow): string {
  const compact = {
    flow: flow.flow.name,
    id: flow.flow.id,
    app: flow.flow.app,
    repo: flow.flow.repo,
    module: flow.flow.module,
    page: flow.flow.page,
    role: flow.flow.role,
    priority: flow.flow.priority,
    goal: flow.flow.businessGoal,
    preconditions: flow.preconditions,
    testData: flow.testData.map(item => ({
      key: item.key,
      value: item.value,
      strategy: item.strategy,
      rule: item.rule,
    })),
    repeatSegments: flow.repeatSegments?.map(segment => ({
      id: segment.id,
      name: segment.name,
      stepIds: segment.stepIds,
      parameters: segment.parameters.filter(parameter => parameter.enabled).map(parameter => ({
        name: parameter.variableName,
        label: parameter.label,
        sourceStepId: parameter.sourceStepId,
        sample: parameter.currentValue,
      })),
      data: segment.rows.map(row => Object.fromEntries(segment.parameters
          .filter(parameter => parameter.enabled)
          .map(parameter => [parameter.variableName, row.values[parameter.id] ?? '']))),
      assertionTemplate: segment.assertionTemplate,
    })),
    steps: flow.steps.map(compactStep),
    network: flow.network.filter(event => event.selected).map(compactNetworkEvent),
  };

  return `${toYaml(compact)}\n`;
}

function compactStep(step: FlowStep) {
  return {
    id: step.id,
    order: step.order,
    intent: step.intent,
    comment: step.comment,
    intentSource: step.intentSource,
    suggestionConfidence: step.intentSuggestion?.confidence,
    action: step.action,
    target: summarizeTarget(step.target),
    ui: compactUiSemanticContext(step.context?.before.ui, step.uiRecipe),
    context: compactContext(step.context),
    url: step.url,
    value: step.value,
    assert: step.assertions.map(assertion => ({
      id: assertion.id,
      subject: assertion.subject,
      type: assertion.type,
      target: summarizeTarget(assertion.target),
      expected: assertion.expected,
      params: assertion.params,
      note: assertion.note,
      enabled: assertion.enabled,
    })),
    networkRefs: step.networkRefs,
  };
}

function compactContext(context?: StepContextSnapshot) {
  if (!context)
    return undefined;
  return {
    page: firstText(context.before.title, context.after?.title),
    tab: firstText(context.before.activeTab?.title, context.after?.activeTab?.title),
    section: context.before.section?.title,
    table: context.before.table?.title,
    row: firstText(context.before.table?.rowKey, compactRowText(context.before.table?.rowText)),
    dialog: context.before.dialog?.title,
    field: context.before.form?.label,
    target: firstText(context.before.target?.text, context.before.target?.title, context.before.target?.ariaLabel, context.before.target?.testId),
    resultDialog: context.after?.dialog?.title,
    selectedOption: context.before.target?.selectedOption,
  };
}

function compactNetworkEvent(event: FlowNetworkEvent) {
  return {
    id: event.id,
    stepId: event.stepId,
    method: event.method,
    url: event.urlPattern ?? event.url,
    status: event.status,
    resourceType: event.resourceType,
    alias: event.alias,
  };
}

function summarizeTarget(target: FlowStep['target']) {
  if (!target)
    return undefined;
  return target.testId ||
    [target.role, target.name].filter(Boolean).join(' ') ||
    target.label ||
    target.placeholder ||
    target.text ||
    target.locator ||
    target.selector;
}

function firstText(...values: Array<string | undefined>) {
  return values.map(value => value?.trim()).find(Boolean);
}

function compactRowText(value?: string) {
  return value?.split(/\s+/).find(token => token.length <= 40 && !/^(编辑|删除|操作|--)$/.test(token));
}

function toYaml(value: CompactValue, indent = 0): string {
  if (Array.isArray(value))
    return yamlArray(value, indent);
  if (value && typeof value === 'object')
    return yamlObject(value, indent);
  return formatScalar(value);
}

function yamlObject(value: { [key: string]: CompactValue | undefined }, indent: number) {
  const lines: string[] = [];
  const pad = ' '.repeat(indent);
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined || child === '' || (Array.isArray(child) && !child.length))
      continue;
    if (Array.isArray(child) || (child && typeof child === 'object')) {
      lines.push(`${pad}${key}:`);
      lines.push(toYaml(child, indent + 2));
    } else {
      lines.push(`${pad}${key}: ${formatScalar(child)}`);
    }
  }
  return lines.join('\n');
}

function yamlArray(value: CompactValue[], indent: number) {
  const pad = ' '.repeat(indent);
  if (!value.length)
    return `${pad}[]`;
  return value.map(item => {
    if (item && typeof item === 'object') {
      const rendered = toYaml(item, indent + 2);
      const childPad = ' '.repeat(indent + 2);
      const lines = rendered.split('\n').map(line => line.startsWith(childPad) ? line.slice(childPad.length) : line);
      return `${pad}- ${lines[0]}${lines.length > 1 ? `\n${lines.slice(1).map(line => `${pad}  ${line}`).join('\n')}` : ''}`;
    }
    return `${pad}- ${formatScalar(item)}`;
  }).join('\n');
}

function formatScalar(value: CompactValue) {
  if (value === null)
    return 'null';
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  const stringValue = String(value);
  if (!stringValue)
    return '""';
  if (/^[a-zA-Z0-9_./${}:@ -]+$/.test(stringValue) && !/^(true|false|null|[-+]?\d+(?:\.\d+)?)$/i.test(stringValue))
    return stringValue;
  return JSON.stringify(stringValue);
}
