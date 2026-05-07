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
import React from 'react';
import { actionLabel, summarizeStepSubject, summarizeTarget } from '../flow/display';
import type { FlowStep } from '../flow/types';
import type { AssertionEditorSuggestion } from './AssertionEditor';

export const AssertionStepContextCard: React.FC<{
  step: FlowStep;
  displayStepId: string;
  suggestion?: AssertionEditorSuggestion;
}> = ({ step, displayStepId, suggestion }) => {
  const action = actionLabel[step.action];
  const subject = summarizeStepSubject(step);
  const page = step.url || step.context?.after?.url || step.context?.before.url || '未知页面';
  const target = targetText(step);
  const recommendation = suggestion ? `StepList 规则 / ${suggestion.label}` : `StepList 规则 / ${action}后状态确认`;

  return <section className='assertion-step-context-card' aria-label={`Step Context：${displayStepId}`}>
    <div className='assertion-step-context-title'>Step Context：<span>{displayStepId}</span> · {action}</div>
    <p>这条断言会挂到 {displayStepId} 之后，用来确认{action}动作真的生效。</p>
    <div className='assertion-step-context-rows'>
      <ContextRow label='原动作' value={`${action}「${subject}」`} />
      <ContextRow label='页面' value={page} />
      <ContextRow label='目标元素' value={target} />
      <ContextRow label='推荐来源' value={recommendation} />
    </div>
  </section>;
};

const ContextRow: React.FC<{ label: string; value: string }> = ({ label, value }) => <div className='assertion-step-context-row'>
  <span>{label}</span>
  <strong>{value}</strong>
</div>;

function targetText(step: FlowStep) {
  const summary = summarizeTarget(step.target);
  if (summary !== '无目标' && summary !== '未知目标')
    return summary;

  const target = step.context?.before.target;
  if (!target)
    return summary;
  return [
    target.role || target.tag || target.controlType,
    target.testId ? `testId ${target.testId}` : undefined,
    target.ariaLabel || target.title || target.normalizedText || target.text || target.placeholder,
  ].filter(Boolean).join(' ') || summary;
}
