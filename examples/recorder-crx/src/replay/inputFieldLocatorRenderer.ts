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
import { cssAttributeValue, normalizeGeneratedText, rawAction, stringLiteral } from './stepEmitterUtils';

export interface InputFieldLocatorHooks {
  popupFieldLabelFromName(value?: string): string | undefined;
  normalizeRequiredLabel(label: string): string;
  hasExplicitTextFieldContext(step: FlowStep): boolean;
  testIdLocatorWithOrdinal(step: FlowStep, testId: string, source: 'target' | 'context'): string;
  dialogRootLocator(dialog?: any): string;
  antdSelectFieldLocator(step: FlowStep): string | undefined;
  globalTestIdLocator(step: FlowStep): string | undefined;
  looksLikeStructuralContainerTestId(testId: string): boolean;
}

export function fillTestIdLocator(step: FlowStep, hooks: InputFieldLocatorHooks) {
  const testId = step.target?.testId;
  const preferred = fieldLocator(step, hooks);
  if (testId && preferred && (isContainerTestIdForFill(step, testId, hooks) || isFieldWrapperTestId(step, testId)))
    return undefined;
  return hooks.globalTestIdLocator(step);
}

export function fieldLocator(step: FlowStep, hooks: InputFieldLocatorHooks, options: { allowSelectLike?: boolean } = {}) {
  const targetText = step.target?.name || step.target?.text || step.target?.displayName;
  const label = step.target?.label ||
    step.target?.scope?.form?.label ||
    step.context?.before.form?.label ||
    step.context?.before.ui?.form?.label ||
    hooks.popupFieldLabelFromName(targetText);
  const labelForLocator = label ? hooks.normalizeRequiredLabel(label) : undefined;
  const placeholder = fillFieldPlaceholder(step);
  const fieldName = fillFieldName(step);
  const fieldTestId = fillFieldTestId(step);
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  const role = step.target?.role || step.context?.before.target?.role || '';
  const isTextLikeField = step.action === 'fill' || role === 'textbox' || /^(input|textarea|text|number|password)$/.test(controlType) || !!placeholder;
  const preferFieldContext = shouldPreferWrapperInputLocator(step, { label: labelForLocator, placeholder, fieldName });
  const source = `${step.sourceCode || ''}\n${JSON.stringify(rawAction(step.rawAction))}\n${step.target?.selector || ''}\n${step.target?.locator || ''}`;
  const isSelectLikeField = options.allowSelectLike !== false && !hooks.hasExplicitTextFieldContext(step) && (/^(select|tree-select|cascader)$/.test(controlType) || step.target?.role === 'combobox' || /ant-select|ant-cascader|role=combobox/.test(source));
  if ((step.target?.role === 'button' || controlType === 'button') && !isSelectLikeField)
    return undefined;
  if (isTextLikeField && fieldTestId && isFieldWrapperTestId(step, fieldTestId) && preferFieldContext) {
    const root = hooks.testIdLocatorWithOrdinal(step, fieldTestId, step.target?.testId === fieldTestId ? 'target' : 'context');
    if (placeholder)
      return `${root}.getByPlaceholder(${stringLiteral(placeholder)})`;
    if (fieldName)
      return `${root}.locator(${stringLiteral(fieldNameInputSelector(fieldName))}).first()`;
    if (isFieldWrapperTestId(step, fieldTestId))
      return `${root}.locator(${stringLiteral('input:visible, textarea:visible, [contenteditable="true"]')}).first()`;
  }
  if (isTextLikeField && placeholder && preferFieldContext) {
    const root = hooks.dialogRootLocator(step.target?.scope?.dialog || step.context?.before.dialog);
    return `${root}.getByPlaceholder(${stringLiteral(placeholder)})`;
  }
  if (isTextLikeField && fieldName && preferFieldContext) {
    const root = hooks.dialogRootLocator(step.target?.scope?.dialog || step.context?.before.dialog);
    return `${root}.locator(${stringLiteral(fieldNameInputSelector(fieldName))}).first()`;
  }
  if (labelForLocator && isSelectLikeField)
    return hooks.antdSelectFieldLocator(step) || `page.getByRole('combobox', { name: ${stringLiteral(labelForLocator)} })`;
  if (labelForLocator) {
    const root = hooks.dialogRootLocator(step.target?.scope?.dialog || step.context?.before.dialog);
    return `${root}.getByLabel(${stringLiteral(labelForLocator)})`;
  }
  return undefined;
}

function isContainerTestIdForFill(step: FlowStep, testId: string, hooks: InputFieldLocatorHooks) {
  const dialogTestId = step.target?.scope?.dialog?.testId || step.context?.before.dialog?.testId;
  if (dialogTestId && dialogTestId === testId)
    return true;
  if (/(modal|drawer|dialog|form)$/i.test(testId))
    return true;
  return hooks.looksLikeStructuralContainerTestId(testId);
}

function fillFieldTestId(step: FlowStep) {
  return step.target?.testId ||
    step.target?.scope?.form?.testId ||
    step.context?.before.form?.testId ||
    step.context?.before.ui?.form?.testId ||
    step.context?.before.target?.testId;
}

function fillFieldName(step: FlowStep) {
  return step.target?.name ||
    step.target?.scope?.form?.name ||
    step.context?.before.ui?.form?.name ||
    step.context?.before.ui?.form?.dataIndex ||
    step.context?.before.form?.name;
}

function fillFieldPlaceholder(step: FlowStep) {
  return step.target?.placeholder ||
    step.context?.before.ui?.form?.placeholder ||
    step.context?.before.target?.placeholder;
}

function isFieldWrapperTestId(step: FlowStep, testId: string) {
  if (looksLikeStructuralFormTestId(testId))
    return false;
  if (testId === step.target?.testId && looksLikeActualControlTestId(testId))
    return false;
  if (stepHasActualControlTestId(step, testId))
    return false;
  return hasObservedFieldWrapperTestId(step, testId);
}

function shouldPreferWrapperInputLocator(step: FlowStep, field: { label?: string; placeholder?: string; fieldName?: string }) {
  const library = step.context?.before.ui?.library || step.uiRecipe?.library;
  if (library === 'pro-components')
    return true;
  const label = normalizeGeneratedText(field.label);
  return !label;
}

function fieldNameInputSelector(name: string) {
  return `input[name="${cssAttributeValue(name)}"], textarea[name="${cssAttributeValue(name)}"]`;
}

function stepHasActualControlTestId(step: FlowStep, testId: string) {
  const contextTarget = step.context?.before.target;
  const rawTarget = rawPageContextTarget(step.target?.raw);
  if (contextTarget?.testId === testId)
    return isActualTextControl(contextTarget, step.target?.role);
  if (rawTarget?.testId === testId)
    return isActualTextControl(rawTarget, step.target?.role);
  if (hasObservedFieldWrapperTestId(step, testId) || step.target?.testId !== testId)
    return false;
  return isActualTextControl({
    role: step.target?.role,
    controlType: String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || ''),
  });
}

function hasObservedFieldWrapperTestId(step: FlowStep, testId: string) {
  const rawPageContext = rawPageContextFromTarget(step.target?.raw);
  return step.context?.before.form?.testId === testId ||
    step.context?.before.ui?.form?.testId === testId ||
    rawPageContextFormTestId(rawPageContext) === testId;
}

function rawPageContextFromTarget(raw: unknown, depth = 0): any {
  if (!raw || typeof raw !== 'object' || depth > 4)
    return undefined;
  const record = raw as { pageContext?: unknown; incoming?: unknown; previous?: unknown; inputTransaction?: { target?: { raw?: unknown } } };
  return record.pageContext ||
    rawPageContextFromTarget(record.inputTransaction?.target?.raw, depth + 1) ||
    rawPageContextFromTarget(record.incoming, depth + 1) ||
    rawPageContextFromTarget(record.previous, depth + 1);
}

function rawPageContextTarget(raw: unknown): any {
  return rawPageContextFromTarget(raw)?.target;
}

function rawPageContextFormTestId(pageContext: any) {
  return pageContext?.form?.testId || pageContext?.ui?.form?.testId;
}

function isActualTextControl(target: { role?: unknown; controlType?: unknown; tag?: unknown }, fallbackRole?: string) {
  const role = String(target.role || fallbackRole || '');
  const controlType = String(target.controlType || '');
  const tag = String(target.tag || '').toLowerCase();
  return role === 'textbox' || /^(input|textarea)$/.test(tag) || /^(input|textarea|text|number|password)$/.test(controlType);
}

function looksLikeActualControlTestId(testId: string) {
  return /(^|[-_])(input|textarea|textbox|digit|number|password)([-_]|$)/i.test(testId);
}

export function looksLikeStructuralFormTestId(testId: string) {
  return /(^|[-_])(modal|dialog|drawer|form|container|wrapper|root)([-_]|$)/i.test(testId);
}
