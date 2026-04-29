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
import { AssertionEditor, type AssertionEditorSuggestion, type AssertionPickedTarget } from './AssertionEditor';
import { AiIntentBadge } from './AiIntentBadge';
import { actionLabel, summarizeStepSubject } from '../flow/display';
import type { FlowAssertion, FlowAssertionSubject, FlowAssertionType, FlowStep } from '../flow/types';

export const StepEditor: React.FC<{
  step: FlowStep;
  displayStepId?: string;
  isEditingAssertion: boolean;
  onUpdateStep: (stepId: string, patch: Partial<FlowStep>) => void;
  onBeginAddAssertion: (stepId: string) => void;
  onCancelAddAssertion: () => void;
  onSaveAssertion: (stepId: string, type: FlowAssertionType, patch: Partial<FlowAssertion>) => void;
  onDeleteStep: (stepId: string) => void;
  onRegenerateIntent?: (stepId: string) => void;
  onPickAssertionTarget: (stepId: string, subject: FlowAssertionSubject) => void;
  suggestion?: AssertionEditorSuggestion;
  pickedTarget?: AssertionPickedTarget;
  isPickingTarget?: boolean;
  isAiPending?: boolean;
}> = ({ step, displayStepId, isEditingAssertion, onUpdateStep, onBeginAddAssertion, onCancelAddAssertion, onSaveAssertion, onDeleteStep, onRegenerateIntent, onPickAssertionTarget, suggestion, pickedTarget, isPickingTarget, isAiPending }) => {
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);

  const updateAssertions = React.useCallback((assertions: FlowAssertion[]) => {
    onUpdateStep(step.id, { assertions });
  }, [step.id, onUpdateStep]);

  const deleteStep = React.useCallback(() => {
    onDeleteStep(step.id);
    setConfirmingDelete(false);
  }, [onDeleteStep, step.id]);

  return <div className={isEditingAssertion ? 'timeline-row active' : 'timeline-row'}>
    <div className='timeline-marker'>{step.order}</div>
    <article className='flow-step'>
      <header className='flow-step-header'>
        <div className='flow-step-title'>
          <strong>{displayStepId ?? step.id}</strong>
          <span>·</span>
          <span>{actionLabel[step.action]}</span>
        </div>
        <div className='step-actions'>
          <button className='step-icon-button' type='button' aria-label='更多'>⋮</button>
          <button className='step-icon-button danger' type='button' aria-label='删除步骤' onClick={() => setConfirmingDelete(true)}>删</button>
          {confirmingDelete && <div className='delete-step-popover'>
            <strong>删除这个步骤？</strong>
            <span>删除后会同时移除该步骤的断言。</span>
            <div>
              <button type='button' onClick={() => setConfirmingDelete(false)}>取消</button>
              <button type='button' className='danger' onClick={deleteStep}>删除</button>
            </div>
          </div>}
        </div>
      </header>
      <div className='flow-step-subject'>{summarizeStepSubject(step)}</div>
      <label>
        <span className='step-field-heading'>
          <span>业务意图</span>
          <AiIntentBadge step={step} pending={isAiPending} />
          {onRegenerateIntent && <button className='inline-link-button' type='button' onClick={() => onRegenerateIntent(step.id)} disabled={isAiPending}>AI 生成</button>}
        </span>
        <input
          type='text'
          value={step.intent ?? ''}
          onChange={e => onUpdateStep(step.id, { intent: e.target.value, intentSource: 'user' })}
        />
      </label>
      <label>
        备注
        <textarea rows={2} value={step.comment ?? ''} onChange={e => onUpdateStep(step.id, { comment: e.target.value })} />
      </label>
      <AssertionEditor
        step={step}
        isEditing={isEditingAssertion}
        suggestion={suggestion}
        pickedTarget={pickedTarget}
        isPickingTarget={isPickingTarget}
        onPickTarget={subject => onPickAssertionTarget(step.id, subject)}
        onBeginAddAssertion={() => onBeginAddAssertion(step.id)}
        onCancelAddAssertion={onCancelAddAssertion}
        onSaveAssertion={(type, patch) => onSaveAssertion(step.id, type, patch)}
        onChange={updateAssertions}
      />
    </article>
  </div>;
};
