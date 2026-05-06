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
import type { BusinessFlow, FlowActionType, FlowAssertion, FlowAssertionSubject, FlowAssertionType, FlowStep, FlowTarget } from './types';

export const actionLabel: Record<FlowActionType, string> = {
  navigate: '导航',
  click: '点击',
  fill: '填写',
  select: '选择',
  check: '勾选',
  uncheck: '取消勾选',
  press: '按键',
  wait: '等待',
  upload: '上传',
  assert: '断言',
  unknown: '未识别',
};

export const assertionLabel: Record<FlowAssertionType, string> = {
  visible: '可见',
  textContains: '文本包含',
  textEquals: '文本等于',
  valueEquals: '值等于',
  urlMatches: 'URL 匹配',
  toastContains: '包含',
  tableRowExists: '行存在',
  apiStatus: '接口状态',
  apiRequestContains: '请求参数包含',
  custom: '自定义',
};

export const assertionSubjectLabel: Record<FlowAssertionSubject, string> = {
  page: '页面',
  element: '页面元素',
  table: '表格/列表',
  toast: '提示消息',
  api: '接口/网络',
  custom: '自定义',
};

export function summarizeTarget(target?: FlowTarget) {
  if (!target)
    return '无目标';
  if (target.testId) {
    const readable = normalizeReadableTargetText(target.name || target.text || target.displayName || target.label);
    return readable ? `${readable} (testId ${target.testId})` : `testId ${target.testId}`;
  }
  if (target.role && target.name)
    return `${target.role} ${target.name}`;
  return target.label ||
    target.placeholder ||
    target.text ||
    target.selector ||
    target.locator ||
    '未知目标';
}

export function summarizeStepSubject(step: FlowStep) {
  if (step.action === 'wait')
    return `等待 ${formatWaitSeconds(step.value)} 秒`;
  if (step.url)
    return step.url;
  const tableSubject = summarizeTableStepSubject(step);
  if (tableSubject)
    return tableSubject;
  const target = summarizeTarget(step.target);
  if (step.value)
    return `${target}（值：${step.value}）`;
  return target;
}

function summarizeTableStepSubject(step: FlowStep) {
  if (step.action !== 'click')
    return undefined;
  const table = step.target?.scope?.table;
  if (!table)
    return undefined;
  const rowText = normalizeReadableTargetText(table.rowText);
  if (rowText)
    return rowText;
  return table.rowKey ? `row ${table.rowKey}` : undefined;
}

function normalizeReadableTargetText(value?: string) {
  return value?.replace(/\s+/g, ' ').trim().replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, '$1$2');
}

function formatWaitSeconds(value?: string) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0)
    return '0';
  const seconds = milliseconds / 1000;
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1).replace(/\.0$/, '');
}

export function summarizeAssertion(assertion: FlowAssertion) {
  const subject = assertion.subject ?? assertionSubjectForType(assertion.type);
  const expected = assertionSummaryValue(assertion);
  return expected ?
    `${assertionSubjectLabel[subject]}：${assertionLabel[assertion.type]} ${expected}` :
    `${assertionSubjectLabel[subject]}：${assertionLabel[assertion.type]}`;
}

export function assertionSubjectForType(type: FlowAssertionType): FlowAssertionSubject {
  if (type === 'urlMatches')
    return 'page';
  if (type === 'tableRowExists')
    return 'table';
  if (type === 'toastContains')
    return 'toast';
  if (type === 'apiStatus' || type === 'apiRequestContains')
    return 'api';
  if (type === 'custom')
    return 'custom';
  return 'element';
}

function assertionSummaryValue(assertion: FlowAssertion) {
  if (assertion.subject === 'api' || assertion.type === 'apiStatus' || assertion.type === 'apiRequestContains') {
    const method = String(assertion.params?.method ?? '').trim();
    const url = String(assertion.params?.url ?? '').trim();
    const status = String(assertion.params?.status ?? '').trim();
    const requestContains = String(assertion.params?.requestContains ?? '').trim();
    return [method, url, status || requestContains].filter(Boolean).join(' ') || assertion.expected?.trim();
  }
  if (assertion.subject === 'table' || assertion.type === 'tableRowExists')
    return String(assertion.params?.rowKeyword ?? assertion.expected ?? '').trim();
  return assertion.expected?.trim();
}

export function flowStats(flow: BusinessFlow) {
  const assertionCount = flow.steps.reduce((total, step) => total + step.assertions.filter(assertion => assertion.enabled).length, 0);
  const missingAssertionCount = flow.steps.filter(step => !step.assertions.some(assertion => assertion.enabled)).length;
  const repeatSegments = flow.repeatSegments ?? [];
  return {
    stepCount: flow.steps.length,
    assertionCount,
    missingAssertionCount,
    repeatSegmentCount: repeatSegments.length,
    repeatRowCount: repeatSegments.reduce((total, segment) => total + segment.rows.length, 0),
    repeatParameterCount: repeatSegments.reduce((total, segment) => total + segment.parameters.filter(parameter => parameter.enabled).length, 0),
    expandedStepCount: repeatSegments.reduce((total, segment) => total + segment.stepIds.length * Math.max(segment.rows.length, 1), flow.steps.length),
  };
}
