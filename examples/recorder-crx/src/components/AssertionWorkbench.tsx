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
import { AssertionStepContextCard } from './AssertionStepContextCard';
import type { FlowAssertion, FlowAssertionSubject, FlowAssertionType, FlowStep } from '../flow/types';

export const AssertionWorkbench: React.FC<{
  step: FlowStep;
  displayStepId: string;
  suggestion?: AssertionEditorSuggestion;
  pickedTarget?: AssertionPickedTarget;
  isPickingTarget?: boolean;
  onPickAssertionTarget: (stepId: string, subject: FlowAssertionSubject) => void;
  onCancelAddAssertion: () => void;
  onSaveAssertion: (stepId: string, type: FlowAssertionType, patch: Partial<FlowAssertion>) => void;
  onChangeAssertions: (stepId: string, assertions: FlowAssertion[]) => void;
  onBackToFlow: () => void;
}> = ({ step, displayStepId, suggestion, pickedTarget, isPickingTarget, onPickAssertionTarget, onCancelAddAssertion, onSaveAssertion, onChangeAssertions, onBackToFlow }) => {
  return <section className='assertion-workbench'>
    <AssertionStepContextCard step={step} displayStepId={displayStepId} suggestion={suggestion} onBackToFlow={onBackToFlow} />
    <div className='assertion-workbench-editor'>
      <AssertionEditor
        step={step}
        isEditing={true}
        suggestion={suggestion}
        pickedTarget={pickedTarget}
        isPickingTarget={isPickingTarget}
        onPickTarget={subject => onPickAssertionTarget(step.id, subject)}
        onBeginAddAssertion={() => {}}
        onCancelAddAssertion={onCancelAddAssertion}
        onSaveAssertion={(type, patch) => onSaveAssertion(step.id, type, patch)}
        onChange={assertions => onChangeAssertions(step.id, assertions)}
        saveButtonLabel={`保存到 ${displayStepId}`}
      />
    </div>
  </section>;
};
