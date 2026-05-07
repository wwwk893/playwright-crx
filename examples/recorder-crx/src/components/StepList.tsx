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
import type { AssertionEditorSuggestion, AssertionPickedTarget } from './AssertionEditor';
import { StepEditor } from './StepEditor';
import { summarizeTarget } from '../flow/display';
import type { FlowAssertion, FlowAssertionSubject, FlowAssertionType, FlowStep } from '../flow/types';
import { ScrollJumpDock } from './ScrollJumpDock';

export const StepList: React.FC<{
  steps: FlowStep[];
  editingAssertionStepId?: string;
  onUpdateStep: (stepId: string, patch: Partial<FlowStep>) => void;
  onBeginAddAssertion: (stepId: string) => void;
  onCancelAddAssertion: () => void;
  onSaveAssertion: (stepId: string, type: FlowAssertionType, patch: Partial<FlowAssertion>) => void;
  onDeleteStep: (stepId: string) => void;
  onRegenerateIntent?: (stepId: string) => void;
  onPickAssertionTarget: (stepId: string, subject: FlowAssertionSubject) => void;
  pickedTarget?: AssertionPickedTarget;
  pickingStepId?: string;
  insertRecordingAfterStepId?: string;
  aiPendingStepIds?: Set<string>;
}> = ({ steps, editingAssertionStepId, onUpdateStep, onBeginAddAssertion, onCancelAddAssertion, onSaveAssertion, onDeleteStep, onRegenerateIntent, onPickAssertionTarget, pickedTarget, pickingStepId, insertRecordingAfterStepId, aiPendingStepIds }) => {
  const insertSlotRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!insertRecordingAfterStepId || !insertSlotRef.current)
      return;
    window.requestAnimationFrame(() => {
      insertSlotRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }, [insertRecordingAfterStepId]);

  return <section className='step-timeline-section'>
    <ScrollJumpDock />
    <div className='section-title'><strong>步骤时间线</strong><span>点击单步进入断言工作台</span></div>
    {steps.length === 0 && <div className='business-flow-empty'>还没有录制到操作。填写流程信息后点击“开始录制”。</div>}
    <div className='flow-step-list' role='list'>
      {steps.map((step, index) => {
        return <React.Fragment key={step.id}>
          <StepEditor
            step={step}
            displayStepId={`step-${String(index + 1).padStart(3, '0')}`}
            isEditingAssertion={editingAssertionStepId === step.id}
            suggestion={buildSuggestion(steps, index)}
            onUpdateStep={onUpdateStep}
            onBeginAddAssertion={onBeginAddAssertion}
            onCancelAddAssertion={onCancelAddAssertion}
            onSaveAssertion={onSaveAssertion}
            onDeleteStep={onDeleteStep}
            onRegenerateIntent={onRegenerateIntent}
            onPickAssertionTarget={onPickAssertionTarget}
            pickedTarget={pickedTarget}
            isPickingTarget={pickingStepId === step.id}
            isAiPending={aiPendingStepIds?.has(step.id)}
          />
          {insertRecordingAfterStepId === step.id && <div className='timeline-insert-recording-slot' ref={insertSlotRef}>
            <div className='timeline-insert-marker'></div>
            <div className='timeline-insert-card'>
              <div>
                <strong>插入录制位置</strong>
                <span>接下来录制的新操作会出现在这里</span>
              </div>
              <div className='timeline-insert-placeholder'>
                <span className='pulse-dot'></span>
                <strong>新步骤将插入到这里</strong>
                <em>等待操作...</em>
              </div>
            </div>
          </div>}
        </React.Fragment>;
      })}
    </div>
  </section>;
};

export function buildSuggestion(steps: FlowStep[], index: number): AssertionEditorSuggestion | undefined {
  const step = steps[index];
  const targetText = summarizeTarget(step.target);
  const previousValues = latestPreviousValues(steps, index);
  const rowKeyword = previousValues[0];

  if (step.action === 'click' && rowKeyword && /确定|确认|新增|新建|添加|OK/i.test(targetText)) {
    const tableArea = /wan/i.test(rowKeyword) ? '共享 WAN 表格' : '当前表格/列表';
    return {
      subject: 'table',
      type: 'tableRowExists',
      label: `${tableArea}中存在 ${rowKeyword}`,
      tableArea,
      rowKeyword,
      columnName: '名称',
      columnValue: rowKeyword,
      note: `弹窗确认后，${rowKeyword} 应出现在${tableArea}中`,
      candidates: previousValues,
    };
  }

  if (step.action === 'click' && /保存|提交|下发/i.test(targetText)) {
    return {
      subject: 'api',
      type: 'apiStatus',
      label: '保存接口返回 200',
      apiMethod: 'POST',
      apiStatus: '200',
      note: '保存配置接口调用成功',
      candidates: previousValues,
    };
  }

  return undefined;
}

function latestPreviousValues(steps: FlowStep[], index: number) {
  const values: string[] = [];
  for (let i = index - 1; i >= 0; i--) {
    const value = steps[i].value?.trim();
    if (!value || values.includes(value))
      continue;
    values.push(value);
    if (values.length >= 4)
      break;
  }
  return values;
}
