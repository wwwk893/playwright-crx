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
import { summarizeTarget } from './display';
import type { BusinessFlow, FlowRepeatParameter, FlowRepeatRow, FlowRepeatSegment, FlowStep } from './types';

export function createRepeatSegment(flow: BusinessFlow, stepIds = flow.steps.map(step => step.id)): FlowRepeatSegment {
  const selectedSteps = flow.steps.filter(step => stepIds.includes(step.id));
  const parameters = inferRepeatParameters(selectedSteps);
  const now = new Date().toISOString();
  return {
    id: `repeat-${Date.now()}`,
    name: defaultSegmentName(flow),
    stepIds: selectedSteps.map(step => step.id),
    parameters,
    rows: createInitialRows(parameters),
    assertionTemplate: createAssertionTemplate(parameters),
    createdAt: now,
    updatedAt: now,
  };
}

export function upsertRepeatSegment(flow: BusinessFlow, segment: FlowRepeatSegment): BusinessFlow {
  const segments = flow.repeatSegments ?? [];
  const exists = segments.some(existing => existing.id === segment.id);
  const nextSegments = exists ? segments.map(existing => existing.id === segment.id ? segment : existing) : [...segments, segment];
  return {
    ...flow,
    repeatSegments: sanitizeRepeatSegments(flow, nextSegments),
    updatedAt: new Date().toISOString(),
  };
}

export function deleteRepeatSegment(flow: BusinessFlow, segmentId: string): BusinessFlow {
  return {
    ...flow,
    repeatSegments: (flow.repeatSegments ?? []).filter(segment => segment.id !== segmentId),
    updatedAt: new Date().toISOString(),
  };
}

export function sanitizeRepeatSegments(flow: BusinessFlow, segments = flow.repeatSegments ?? []): FlowRepeatSegment[] {
  const stepIds = new Set(flow.steps.map(step => step.id));
  return segments
      .map(segment => {
        const validStepIds = segment.stepIds.filter(stepId => stepIds.has(stepId));
        return {
          ...segment,
          stepIds: validStepIds,
          parameters: segment.parameters.filter(parameter => stepIds.has(parameter.sourceStepId) && validStepIds.includes(parameter.sourceStepId)),
        };
      })
      .filter(segment => segment.stepIds.length > 0);
}

export function repeatSegmentStats(flow: BusinessFlow) {
  const segments = flow.repeatSegments ?? [];
  return {
    segmentCount: segments.length,
    rowCount: segments.reduce((total, segment) => total + segment.rows.length, 0),
    parameterCount: segments.reduce((total, segment) => total + segment.parameters.filter(parameter => parameter.enabled).length, 0),
    expandedStepCount: segments.reduce((total, segment) => total + segment.stepIds.length * Math.max(segment.rows.length, 1), 0),
  };
}

function inferRepeatParameters(steps: FlowStep[]): FlowRepeatParameter[] {
  const usedNames = new Map<string, number>();
  const variableNameByValue = new Map<string, string>();
  const entries: { step: FlowStep, repeatValue: string, inheritedSelectLabel?: string }[] = [];
  let pendingSelectLabel: string | undefined;

  for (const step of steps) {
    const repeatValue = repeatParameterValue(step) || (pendingSelectLabel ? contextLightSelectOptionValue(step) : undefined);
    if (repeatValue)
      entries.push({ step, repeatValue, inheritedSelectLabel: pendingSelectLabel });

    const selectLabel = selectFieldLabelCandidate(step);
    if (selectLabel)
      pendingSelectLabel = selectLabel;
    else if (repeatValue && pendingSelectLabel)
      pendingSelectLabel = undefined;
  }

  return entries.map(({ step, repeatValue, inheritedSelectLabel }, index) => {
    const rawLabel = parameterLabel(step);
    const label = inheritedSelectLabel && shouldUseInheritedSelectLabel(rawLabel, repeatValue) ? inheritedSelectLabel : rawLabel;
    const currentValue = repeatValue || '';
    const sharedVariableName = currentValue ? variableNameByValue.get(currentValue) : undefined;
    const baseVariableName = sharedVariableName || variableNameFor(label, currentValue);
    if (currentValue && !sharedVariableName)
      variableNameByValue.set(currentValue, baseVariableName);
    const count = usedNames.get(baseVariableName) ?? 0;
    usedNames.set(baseVariableName, count + (sharedVariableName ? 0 : 1));
    return {
      id: `p${String(index + 1).padStart(3, '0')}`,
      label,
      sourceStepId: step.id,
      currentValue,
      variableName: sharedVariableName || (count ? `${baseVariableName}${count + 1}` : baseVariableName),
      enabled: true,
    };
  });
}

function selectFieldLabelCandidate(step: FlowStep) {
  const label = step.context?.before?.form?.label || step.target?.scope?.form?.label || step.target?.label || step.target?.name || step.target?.text || '';
  const role = step.target?.role || '';
  if (step.action === 'click' && (/combobox|select/i.test(role) || /选择|select|WAN口|角色|类型|VRF|发布范围|出口路径/.test(label)))
    return label.trim() || undefined;
  return undefined;
}

function shouldUseInheritedSelectLabel(rawLabel: string, repeatValue: string) {
  return !rawLabel || rawLabel === repeatValue || variableNameFor(rawLabel, repeatValue) === 'param';
}

function contextLightSelectOptionValue(step: FlowStep) {
  if (step.action !== 'click')
    return undefined;
  const role = step.target?.role || '';
  if (/button|link/i.test(role))
    return undefined;
  return step.target?.text?.trim() || step.target?.name?.trim() || step.target?.displayName?.trim() || undefined;
}

function repeatParameterValue(step: FlowStep) {
  const value = step.value?.trim();
  if ((step.action === 'fill' || step.action === 'select') && value)
    return value;

  // AntD / ProComponents select options are often recorded as a click on a portal option
  // rather than a semantic select action. If the click happened inside a dropdown tied to
  // a form field, treat the clicked option text as a loop parameter value.
  if (step.action !== 'click')
    return undefined;
  const optionText = step.target?.text?.trim() || step.target?.name?.trim() || step.target?.displayName?.trim();
  if (!optionText)
    return undefined;
  const before = step.context?.before;
  const fieldLabel = before?.form?.label || step.target?.scope?.form?.label || step.target?.label;
  const inDropdown = before?.dialog?.type === 'dropdown' || /dropdown|select/i.test(step.target?.role || '');
  if (fieldLabel && inDropdown && !isOrdinaryFormLabelClick(step, fieldLabel, optionText))
    return optionText;
  if (!fieldLabel && inDropdown && isPopupOptionClick(step))
    return optionText;
  return undefined;
}

function isOrdinaryFormLabelClick(step: FlowStep, fieldLabel: string, optionText: string) {
  const tag = step.context?.before.target?.tag || String((step.target?.raw as { tag?: unknown } | undefined)?.tag || '');
  if (tag !== 'label')
    return false;
  if (normalizedText(fieldLabel) !== normalizedText(optionText))
    return false;
  const selector = rawActionSelector(step);
  return !/ant-select|ant-cascader|ant-tree|role=option|role=menuitem/.test(selector);
}

function isPopupOptionClick(step: FlowStep) {
  const beforeTarget = step.context?.before.target;
  const controlType = beforeTarget?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  const role = step.target?.role || beforeTarget?.role || '';
  const selector = rawActionSelector(step) || step.target?.selector || step.target?.locator || '';
  return /option/.test(controlType) || /^(option|menuitem)$/i.test(role) || /ant-select-tree|ant-select-item-option|ant-cascader-menu-item/.test(selector);
}

function normalizedText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function rawActionSelector(step: FlowStep) {
  const raw = step.rawAction && typeof step.rawAction === 'object' ? step.rawAction as { action?: unknown, selector?: unknown } : undefined;
  const action = raw?.action && typeof raw.action === 'object' ? raw.action as { selector?: unknown } : raw;
  return typeof action?.selector === 'string' ? action.selector : '';
}

function createInitialRows(parameters: FlowRepeatParameter[]): FlowRepeatRow[] {
  if (!parameters.length)
    return [{ id: `row-${Date.now()}`, values: {} }];
  return [0, 1, 2].map(index => ({
    id: `row-${Date.now()}-${index + 1}`,
    values: Object.fromEntries(parameters.map(parameter => [parameter.id, sampleValue(parameter, index)])),
  }));
}

function createAssertionTemplate(parameters: FlowRepeatParameter[]): FlowRepeatSegment['assertionTemplate'] {
  const nameParameter = parameters.find(parameter => /名称|name|pool/i.test(`${parameter.label} ${parameter.variableName}`));
  if (!nameParameter)
    return undefined;
  return {
    subject: 'table',
    type: 'tableRowExists',
    description: `表格行存在：${nameParameter.label} = {{${nameParameter.variableName}}}`,
    params: {
      rowKeyword: `{{${nameParameter.variableName}}}`,
      columnName: nameParameter.label,
      columnValue: `{{${nameParameter.variableName}}}`,
    },
  };
}

function defaultSegmentName(flow: BusinessFlow) {
  const flowName = flow.flow.name?.trim();
  if (/^(创建|新增|添加|新建)/.test(flowName))
    return `批量${flowName}`;
  return flowName ? `批量执行 ${flowName}` : '批量创建配置项';
}

function parameterLabel(step: FlowStep) {
  return step.context?.before?.form?.label ||
    step.target?.scope?.form?.label ||
    step.target?.label ||
    step.target?.name ||
    step.target?.placeholder ||
    step.target?.text ||
    summarizeTarget(step.target);
}

function variableNameFor(label: string, value?: string) {
  const source = `${label} ${value ?? ''}`;
  if (/发布范围|scope|华东生产区|华南办公区|新加坡边缘区/i.test(source))
    return 'scope';
  if (/出口路径|egress|NAT集群|一号机房|二号机房|上海|深圳/i.test(source))
    return 'egressPath';
  if (/关联?VRF|\bVRF\b|生产VRF|办公VRF|灾备VRF/i.test(source))
    return 'vrf';
  if (/资源名称|resourceName/i.test(source) || /^res[-_]/i.test(value ?? ''))
    return 'resourceName';
  if (/服务名称|service/i.test(source))
    return 'serviceName';
  if (/监听端口|listen/i.test(source))
    return 'listenPort';
  if (/源端口|sourcePort/i.test(source))
    return 'sourcePort';
  if (/探测地址|health|probe/i.test(source))
    return 'healthUrl';
  if (/地址池|pool/i.test(source))
    return 'poolName';
  if (/用户名|账号|account|user/i.test(source))
    return 'username';
  if (/角色|权限|role/i.test(source))
    return 'role';
  if (/描述|备注|comment|description/i.test(source))
    return 'description';
  if (/wan/i.test(source))
    return 'wanPort';
  if (/类型|type/i.test(source))
    return 'type';
  if (/起始|开始|start/i.test(source))
    return 'startIp';
  if (/结束|end/i.test(source))
    return 'endIp';
  if (/名称|name/i.test(source))
    return 'name';
  if (/地址|ip/i.test(source))
    return 'ipAddress';
  return 'param';
}

function sampleValue(parameter: FlowRepeatParameter, rowIndex: number) {
  const value = parameter.currentValue;
  if (rowIndex === 0)
    return value;
  if (parameter.variableName === 'poolName')
    return numberedValue(value, rowIndex + 1, 'pool-test');
  if (/^(wanPort|role|vrf|scope|egressPath|type)/.test(parameter.variableName))
    return value;
  if (parameter.variableName === 'startIp')
    return ipValue(value, rowIndex + 1, 1);
  if (parameter.variableName === 'endIp')
    return ipValue(value, rowIndex + 1, 254);
  return numberedValue(value, rowIndex + 1, parameter.variableName);
}

function numberedValue(value: string, index: number, fallbackPrefix: string) {
  if (/\d+/.test(value))
    return value.replace(/\d+(?!.*\d)/, String(index));
  return `${fallbackPrefix}-${index}`;
}

function ipValue(value: string, index: number, fallbackLast: number) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(value)) {
    const parts = value.split('.');
    parts[0] = String(Number(parts[0]) + index);
    parts[3] = String(fallbackLast);
    return parts.join('.');
  }
  return `${index}.${index}.${index}.${fallbackLast}`;
}
