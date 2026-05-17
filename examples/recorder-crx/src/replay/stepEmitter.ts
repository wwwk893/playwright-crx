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
import type { BusinessFlow, FlowAssertion, FlowRepeatSegment, FlowStep } from '../flow/types';
import { actionLabel, summarizeStepSubject } from '../flow/display';
import {
  activePopupOptionDispatchSource,
  isRecipeBackedAntdSelectOption,
  recipeOptionSearchText,
  recipeOptionText,
  renderAntdPopupOptionClickSource,
  renderAntdSelectOptionClickSource,
} from './antDRecipeRenderers';
import { isTerminalAssertionParserUnsafe, renderAssertion } from './assertionSourceRenderer';
import {
  createEffectiveReplayFlow as buildEffectiveReplayFlow,
  dropdownOptionEmitCompactIdentity as effectiveDropdownOptionEmitCompactIdentity,
  dropdownOptionEmitIdentity as effectiveDropdownOptionEmitIdentity,
  isPersistentDialog,
  looksLikeDialogOwnedTestId,
  openedDialogAfterStep,
  sameDialogScope,
  stepOpensPersistentDialog,
  type EffectiveReplayFlowHooks,
} from './effectiveReplayFlow';
import {
  fieldLocator as renderInputFieldLocator,
  fillTestIdLocator as renderInputFillTestIdLocator,
  looksLikeStructuralFormTestId,
  type InputFieldLocatorHooks,
} from './inputFieldLocatorRenderer';
import type { LocatorCandidate } from './locatorTypes';
import { looksLikeDialogOpenerTestId, looksLikeStructuralDialogTargetTestId } from './dialogLocatorGuards';
import { buildRecipeForStep } from './recipeBuilder';
import { roleNameOptionsSource, roleNameSource } from './roleLocatorOptions';
import {
  emitExpandedRepeatSegment as renderExpandedRepeatSegment,
  emitRepeatSegment as renderRepeatSegment,
  firstSegmentStepId as firstRepeatSegmentStepId,
  parameterizeLine as parameterizeRepeatLine,
  type RepeatRendererHooks,
} from './repeatRenderer';
import { applySafetyPreflightToSource } from './safetyGuard';
import { renderRepeatAssertionTemplate } from './terminalAssertions';
import {
  cssAttributeValue,
  escapeRegExp,
  generatedTextCandidate,
  isSerializedObjectText,
  locatorExpressionForSelector,
  normalizeComparableText,
  normalizeGeneratedText,
  rawAction,
  rowTextRegexLiteral,
  stringLiteral,
  stringParam,
  textFromInternalTextSelector,
} from './stepEmitterUtils';

export { renderAssertionCodePreview } from './assertionSourceRenderer';
export { stringLiteral } from './stepEmitterUtils';

type FlowDialogScope = NonNullable<NonNullable<NonNullable<FlowStep['target']>['scope']>['dialog']>;
type FlowTableScope = NonNullable<NonNullable<FlowStep['target']>['scope']>['table'];
type FlowAncestorScope = NonNullable<NonNullable<NonNullable<FlowStep['target']>['scope']>['ancestor']>;

const effectiveReplayFlowHooks: EffectiveReplayFlowHooks = {
  choiceControlText,
  stepSynthesizesPopoverConfirm,
  popoverOpenedAfterClick,
  testIdFromSource,
  isDeleteOrRemoveTestId,
  looksLikeDropdownOptionStepForDedup,
  isAntdProjectedSelectStep,
  antdSelectOptionName,
  popupOptionName,
  optionTextTokens,
  popupFieldLabelFromName,
  isAntdSelectFieldStep,
  selectQueryForStep,
  isContextlessOptionTextClickAfterSelect,
  inheritedAntdSelectOptionStep,
};

const inputFieldLocatorHooks: InputFieldLocatorHooks = {
  popupFieldLabelFromName,
  normalizeRequiredLabel,
  hasExplicitTextFieldContext,
  testIdLocatorWithOrdinal,
  dialogRootLocator,
  antdSelectFieldLocator,
  globalTestIdLocator,
  looksLikeStructuralContainerTestId,
};

export function createEffectiveReplayFlow(flow: BusinessFlow): BusinessFlow {
  return buildEffectiveReplayFlow(flow, effectiveReplayFlowHooks);
}

export function dropdownOptionEmitIdentity(step: FlowStep) {
  return effectiveDropdownOptionEmitIdentity(step, effectiveReplayFlowHooks);
}

export function dropdownOptionEmitCompactIdentity(step: FlowStep) {
  return effectiveDropdownOptionEmitCompactIdentity(step, effectiveReplayFlowHooks);
}

function compactDropdownOptionIdentity(value: string) {
  return normalizeGeneratedText(value)
      ?.replace(/\s+/g, '')
      .trim();
}

function looksLikeDropdownOptionStepForDedup(step: FlowStep) {
  if (isAntdProjectedSelectStep(step) || isAntdSelectOptionStep(step))
    return true;
  const selector = rawAction(step.rawAction).selector || step.target?.selector || step.target?.locator || '';
  const text = popupOptionName(step) || rawSelectOptionTitle(step);
  return step.action === 'click' && !!text && (
    step.target?.role === 'option' ||
    step.context?.before.target?.role === 'option' ||
    step.context?.before.dialog?.type === 'dropdown' ||
    step.target?.scope?.dialog?.type === 'dropdown' ||
    /ant-select|role=option|internal:has-text|internal:attr=\[title=|internal:text=/.test(selector) ||
    (/internal:text=/.test(selector) && !!bestCompactIpRangeMatch(text))
  );
}

function inheritedAntdSelectOptionStep(step: FlowStep, activeSelectStep: FlowStep, activeSelectQuery = '') {
  const rawOptionTitle = rawSelectOptionTitle(step);
  const recordedOptionText = recordedActiveDropdownOptionTextFromSource(step.sourceCode || '');
  const query = activeSelectQuery || selectQueryForStep(activeSelectStep);
  const optionText = completeOptionTextFromSelectQuery(rawOptionTitle || recordedOptionText || step.target?.text || step.target?.name || step.target?.displayName || '', query) || rawOptionTitle || recordedOptionText || step.target?.text || step.target?.name || step.target?.displayName;
  const activeForm = selectStepFormContext(activeSelectStep);
  return {
    ...step,
    target: {
      ...step.target,
      scope: {
        ...step.target?.scope,
        dialog: selectTriggerDialog(activeSelectStep),
        form: activeForm,
      },
    },
    context: {
      ...step.context,
      before: {
        ...step.context?.before,
        dialog: { type: 'dropdown', visible: true },
        form: activeForm,
        target: {
          ...step.context?.before.target,
          framework: activeSelectStep.context?.before.target?.framework || 'antd',
          controlType: inheritedPopupOptionControlType(activeForm?.label),
          text: optionText,
          normalizedText: optionText,
        },
      },
      after: {
        ...step.context?.after,
        dialog: selectTriggerDialog(activeSelectStep),
      },
    },
  } as FlowStep;
}

function inheritedPopupOptionControlType(label?: string) {
  if (/范围/.test(label || ''))
    return 'tree-select-option';
  if (/路径/.test(label || ''))
    return 'cascader-option';
  return 'select-option';
}

function isAntdSelectFieldStep(step: FlowStep, nextStep?: FlowStep) {
  const controlType = step.context?.before.target?.controlType;
  const framework = step.context?.before.target?.framework;
  const label = selectStepFormContext(step)?.label;
  const selector = rawAction(step.rawAction).selector || step.target?.selector || step.target?.locator || '';
  const source = step.sourceCode || '';
  const explicitTextField = hasExplicitTextFieldContext(step);
  const sourceCombobox = !explicitTextField && (/getByRole\(["']combobox["']/.test(source) || /role=combobox/.test(selector));
  const isAntdLike = framework === 'antd' || framework === 'procomponents' || step.target?.role === 'combobox' || sourceCombobox;
  const isPopupField = !explicitTextField && (controlType === 'select' || controlType === 'tree-select' || controlType === 'cascader' || step.target?.role === 'combobox' || sourceCombobox);
  if (step.action === 'fill' && isPopupField && !explicitTextField && !(nextStep && looksLikeDropdownOptionStepForDedup(nextStep))) {
    const hasOnlyWeakSelectEvidence = !step.target?.role && !/getByRole\(["']combobox["']|role=combobox/.test(source) && !/role=combobox/.test(selector);
    if (hasOnlyWeakSelectEvidence)
      return false;
  }
  return !!label && isAntdLike && isPopupField && (step.action === 'click' || step.action === 'fill');
}

function hasExplicitTextFieldContext(step: FlowStep) {
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  const role = step.target?.role || step.context?.before.target?.role || '';
  const tag = step.context?.before.target?.tag || String((step.target?.raw as { tag?: unknown } | undefined)?.tag || '');
  if (/^(input|textarea)$/.test(controlType))
    return true;
  if (role === 'textbox')
    return true;
  return /^(input|textarea)$/i.test(tag) && role !== 'combobox' && !/^(select|tree-select|cascader)$/.test(controlType);
}

function selectStepFormContext(step: FlowStep) {
  const form = step.context?.before.form || step.target?.scope?.form;
  if (form?.label)
    return form;
  const label = step.target?.label || popupFieldLabelFromName(step.target?.name || step.target?.text || step.target?.displayName) || comboboxNameFromSource(step.sourceCode || '');
  return label ? { ...form, label } : form;
}

function popupFieldLabelFromName(value?: string) {
  const text = value
      ?.replace(/^[*＊]\s*/, '')
      .replace(/\s*question-circle\b.*$/i, '')
      .trim();
  if (!text)
    return undefined;
  if (/选择|select|范围|路径|角色|类型|标签|分类|名称|端口|地址|WAN口|LAN口/i.test(text))
    return text;
  return undefined;
}

function comboboxNameFromSource(source: string) {
  const match = source.match(/getByRole\(["']combobox["'],\s*\{\s*name:\s*["']([^"']+)["']/);
  return match?.[1];
}

function formItemLabelFromSource(source: string) {
  const matches = [...source.matchAll(/\.locator\(["'][^"']*ant-form-item[^"']*["']\)\.filter\(\{\s*hasText:\s*["']([^"']+)["']\s*\}\)/g)];
  return matches.length ? matches[matches.length - 1]?.[1] : undefined;
}

function isContextlessOptionTextClickAfterSelect(step: FlowStep, selectStep: FlowStep, inheritedQuery = '') {
  if (step.action !== 'click')
    return false;
  const isRecordedActiveDropdownSource = isRecordedActiveAntdSelectOptionSource(step.sourceCode || '');
  if (isAntdSelectOptionStep(step) && !isRecordedActiveDropdownSource)
    return false;
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  if (/^(checkbox|radio|switch)$/.test(controlType) || /^(checkbox|radio|switch)$/.test(step.target?.role || ''))
    return false;
  if (/^(tree-select-option|cascader-option|menu-item)$/.test(controlType))
    return false;
  const rawTitle = rawSelectOptionTitle(step);
  const recordedOptionText = recordedActiveDropdownOptionTextFromSource(step.sourceCode || '');
  const hasDropdownOptionEvidence = isRecordedActiveDropdownSource ||
    !!rawTitle ||
    /^(option|select-option)$/.test(controlType) ||
    step.target?.role === 'option' ||
    step.context?.before.target?.role === 'option' ||
    step.context?.before.dialog?.type === 'dropdown' ||
    step.target?.scope?.dialog?.type === 'dropdown';
  if (selectStep.action === 'select' && !hasDropdownOptionEvidence)
    return false;
  const optionText = rawTitle || recordedOptionText || step.target?.text || step.target?.name || step.target?.displayName;
  if (!optionText)
    return false;
  const selector = rawAction(step.rawAction).selector || step.target?.selector || step.target?.locator || '';
  if (selector && !selector.includes('internal:text') && !/getByText|text=|getByTitle|hasText/.test(step.sourceCode || '') && !/internal:attr=\[title=.*>>/.test(selector) && !isRecordedActiveDropdownSource)
    return false;
  const query = inheritedQuery || selectQueryForStep(selectStep);
  return !query || optionText.includes(query) || !!completeOptionTextFromSelectQuery(optionText, query);
}

function selectQueryForStep(selectStep: FlowStep) {
  return String(selectStep.value || rawAction(selectStep.rawAction).text || rawAction(selectStep.rawAction).value || '').trim();
}

function completeOptionTextFromSelectQuery(optionText: string, query: string) {
  if (!optionText || !query || optionText.includes(query))
    return undefined;
  for (let length = Math.min(optionText.length, query.length); length >= 2; length--) {
    const queryPrefix = query.slice(0, length);
    if (optionText.endsWith(queryPrefix))
      return `${optionText}${query.slice(length)}`;
  }
  return undefined;
}

export function emitRepeatSegment(lines: string[], flow: BusinessFlow, segment: FlowRepeatSegment) {
  renderRepeatSegment(lines, flow, segment, repeatRendererHooks);
}

export function firstSegmentStepId(flow: BusinessFlow, segment: FlowRepeatSegment) {
  return firstRepeatSegmentStepId(flow, segment);
}

export type EmitStepOptions = {
  parserSafe?: boolean;
  previousStep?: FlowStep;
  nextStep?: FlowStep;
  safetyGuard?: boolean;
  suppressRowExistsAssertions?: boolean;
};

const repeatRendererHooks: RepeatRendererHooks = {
  emitStep,
  isPlaceholderSelectOptionClick,
  nextEffectiveStepForRedundantAction,
  isIntermediateSameFieldFill,
  isRedundantFieldFocusClick,
  isRedundantExportedSelectFieldAction,
  isRedundantParserSafeSelectFieldAction,
  isRedundantSelectSearchClear,
  isRedundantExplicitPopoverConfirmStep,
  isRedundantExplicitDialogConfirmStep,
  isHiddenDialogContainerClickAfterConfirm,
  isTruncatedSelectedValueDisplayEchoClick,
  renderRepeatAssertionTemplate,
  activePopupOptionDispatchSource,
};

export function emitExpandedRepeatSegment(lines: string[], flow: BusinessFlow, segment: FlowRepeatSegment, options: EmitStepOptions = {}) {
  renderExpandedRepeatSegment(lines, flow, segment, repeatRendererHooks, options);
}

export function isPlaceholderSelectOptionClick(step: FlowStep) {
  if (step.action !== 'click')
    return false;
  const selector = [rawAction(step.rawAction).selector, step.target?.selector, step.target?.locator, step.sourceCode].filter(Boolean).join('\n');
  const explicitTargetText = generatedTextCandidate(step.target?.text, step.target?.name, step.target?.displayName);
  if ((step.target?.testId || /internal:testid=/.test(selector)) && explicitTargetText && !/^请?选择(?:一个)?\S*/.test(explicitTargetText))
    return false;
  const controlType = String(step.context?.before.target?.controlType || '');
  const role = step.target?.role || step.context?.before.target?.role || '';
  const looksLikeSelectOption = /ant-select-item-option|role=option|internal:role=option/.test(selector) ||
    !!step.context?.before.target?.optionPath?.length ||
    role === 'option' ||
    /^(option|select-option|tree-select-option|cascader-option)$/.test(controlType);
  if (!looksLikeSelectOption)
    return false;
  const optionName = generatedTextCandidate(
      step.context?.before.target?.selectedOption,
      step.context?.before.target?.text,
      step.context?.before.target?.normalizedText,
      step.context?.before.target?.ariaLabel,
      step.target?.text,
      step.target?.name,
      step.target?.displayName,
      rawSelectOptionTitle(step),
      placeholderOptionTextFromSource(selector),
  );
  return !!optionName && /^请?选择(?:一个)?\S*/.test(optionName);
}

function isPlaceholderSelectOptionSourceLine(line: string) {
  return /ant-select-item-option|role=option|internal:role=option/.test(line) && /请?选择(?:一个)?\S*/.test(line);
}

function placeholderOptionTextFromSource(source: string) {
  return source.match(/(?:has-text=|text=|name:\s*)[\\"'`](请?选择(?:一个)?[^\\"'`),]+)/)?.[1];
}

export function isIntermediateSameFieldFill(step: FlowStep, steps: FlowStep[], index: number) {
  if (step.action !== 'fill' || !step.value || step.assertions.some(assertion => assertion.enabled))
    return false;
  const value = String(step.value);
  for (let nextIndex = index + 1; nextIndex < Math.min(steps.length, index + 6); nextIndex++) {
    const next = steps[nextIndex];
    if (next.action === 'fill' && sameFieldIdentityIgnoringDialog(step, next)) {
      const nextValue = String(next.value || '');
      return nextValue.length > value.length && nextValue.startsWith(value);
    }
    if (next.action === 'press' && sameFieldIdentityIgnoringDialog(step, next))
      continue;
    if (next.action === 'click' && isRedundantFieldFocusClick(next, steps[nextIndex + 1]) && sameFieldIdentityIgnoringDialog(step, next))
      continue;
    if (next.action === 'fill')
      continue;
    break;
  }
  return false;
}

export type RedundantLookaheadMode = 'exported' | 'parserSafe';

export function nextEffectiveStepForRedundantAction(steps: FlowStep[], index: number, mode: RedundantLookaheadMode) {
  for (let nextIndex = index + 1; nextIndex < steps.length; nextIndex++) {
    if (isSkippedByRedundantActionLookahead(steps[nextIndex], steps, nextIndex, mode))
      continue;
    return steps[nextIndex];
  }
  return undefined;
}

function isSkippedByRedundantActionLookahead(step: FlowStep, steps: FlowStep[], index: number, mode: RedundantLookaheadMode) {
  const previousStep = steps[index - 1];
  const nextStep = steps[index + 1];
  if (isIntermediateSameFieldFill(step, steps, index) || isPlaceholderSelectOptionClick(step))
    return true;
  if (isRedundantFieldFocusClick(step, nextStep))
    return true;
  if (mode === 'exported' && isRedundantExportedSelectFieldAction(step, nextStep))
    return true;
  if (mode === 'parserSafe' && isRedundantParserSafeSelectFieldAction(step, nextStep))
    return true;
  if (isRedundantSelectSearchClear(step, previousStep) || isRedundantDropdownEscape(step, previousStep))
    return true;
  return isDuplicateSyntheticEchoClick(step, previousStep) ||
    isRedundantExplicitPopoverConfirmStep(step, previousStep) ||
    isRedundantExplicitDialogConfirmStep(step, previousStep) ||
    isHiddenDialogContainerClickAfterConfirm(step, previousStep);
}

export function isRedundantFieldFocusClick(step: FlowStep, nextStep?: FlowStep) {
  if (step.action !== 'click' || nextStep?.action !== 'fill')
    return false;
  if (step.assertions.some(assertion => assertion.enabled))
    return false;
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  const role = step.target?.role || step.context?.before.target?.role || '';
  const looksLikeTextField = /^(input|textarea)$/.test(controlType) || role === 'textbox' || !!(step.target?.placeholder || step.context?.before.target?.placeholder);
  return looksLikeTextField && sameFieldIdentity(step, nextStep);
}

function isRedundantSelectFieldAction(step: FlowStep, nextStep?: FlowStep) {
  if (step.action !== 'fill' || !nextStep || step.assertions.some(assertion => assertion.enabled))
    return false;
  if (!isAntdSelectFieldStep(step, nextStep))
    return false;
  if (isAntdSelectFieldStep(nextStep) && sameFieldIdentityIgnoringDialog(step, nextStep))
    return true;
  return looksLikeDropdownOptionStepForDedup(nextStep) && (sameFieldIdentityIgnoringDialog(step, nextStep) || isContextlessOptionTextClickAfterSelect(nextStep, step, selectQueryForStep(step)));
}

export function isRedundantExportedSelectFieldAction(step: FlowStep, nextStep?: FlowStep) {
  return isRedundantSelectFieldAction(step, nextStep) ||
    isRedundantCascaderSearchFillBeforePath(step, nextStep) ||
    isRedundantSelectTriggerFocusClick(step, nextStep) ||
    isRedundantExportedSelectTriggerBeforeOption(step, nextStep);
}

export function isRedundantParserSafeSelectFieldAction(step: FlowStep, nextStep?: FlowStep) {
  return isRedundantSelectTriggerFocusClick(step, nextStep) ||
    isRedundantEmptySelectSearchFillBeforeOption(step, nextStep);
}

function isRedundantEmptySelectSearchFillBeforeOption(step: FlowStep, nextStep?: FlowStep) {
  if (step.action !== 'fill' || !nextStep || step.assertions.some(assertion => assertion.enabled))
    return false;
  const value = String(step.value ?? rawAction(step.rawAction).text ?? rawAction(step.rawAction).value ?? '');
  if (value !== '')
    return false;
  if (!isAntdSelectFieldStep(step, nextStep))
    return false;
  return looksLikeDropdownOptionStepForDedup(nextStep) && sameFieldIdentityIgnoringDialog(step, nextStep);
}

function isRedundantCascaderSearchFillBeforePath(step: FlowStep, nextStep?: FlowStep) {
  if (step.action !== 'fill' || !nextStep || step.assertions.some(assertion => assertion.enabled))
    return false;
  if (!isAntdSelectFieldStep(step, nextStep))
    return false;
  const path = cascaderOptionPath(nextStep);
  if (path.length < 2)
    return false;
  const filledValue = normalizeGeneratedText(String(step.value ?? rawAction(step.rawAction).text ?? rawAction(step.rawAction).value ?? '')) || '';
  const leafValue = normalizeGeneratedText(path[path.length - 1]) || '';
  return !!filledValue && !!leafValue && (filledValue === leafValue || leafValue.includes(filledValue) || filledValue.includes(leafValue));
}

function isRedundantExportedSelectTriggerBeforeOption(step: FlowStep, nextStep?: FlowStep) {
  if (step.action !== 'click' || !nextStep || step.assertions.some(assertion => assertion.enabled))
    return false;
  if (!isAntdSelectFieldStep(step, nextStep))
    return false;
  return isAntdSelectOptionStep(nextStep) && sameFieldIdentityIgnoringDialog(step, nextStep);
}

function isRedundantSelectTriggerFocusClick(step: FlowStep, nextStep?: FlowStep) {
  if (step.action !== 'click' || !nextStep || step.assertions.some(assertion => assertion.enabled))
    return false;
  if (!isAntdSelectFieldStep(step, nextStep))
    return false;
  if (isAntdProjectedSelectStep(nextStep))
    return sameFieldIdentityIgnoringDialog(step, nextStep);
  return false;
}

function isRedundantSelectedValueDisplayClick(step: FlowStep, previousStep?: FlowStep) {
  if (step.action !== 'click' || !previousStep || !isAntdProjectedSelectStep(previousStep))
    return false;
  if (isAntdSelectOptionStep(step))
    return false;
  const selectedText = normalizeGeneratedText(String(previousStep.value || previousStep.uiRecipe?.optionText || '')) || '';
  const clickedText = normalizeGeneratedText(selectedDisplayClickText(step) || '') || '';
  if (!selectedText || !clickedText)
    return false;
  const isExactOrCompactMatch = selectedText === clickedText || compactDropdownOptionIdentity(selectedText) === compactDropdownOptionIdentity(clickedText);
  const isTruncatedSelectedEcho = selectedText.startsWith(clickedText) && clickedText.length >= 4;
  if (!isExactOrCompactMatch && !isTruncatedSelectedEcho)
    return false;
  const source = `${step.sourceCode || ''}\n${JSON.stringify(rawAction(step.rawAction))}`;
  if (!/getByText|internal:text=|text=/.test(source))
    return false;
  const fieldScoped = sameSelectedValueDisplayFieldIdentity(step, previousStep);
  const selectedDisplayEcho = isSelectedValueDisplayEchoTarget(step);
  const currentAssertionTied = hasSelectedValueAssertionForPreviousField(step, previousStep, selectedText, clickedText, 'current');
  const assertionTied = selectedDisplayEcho && hasSelectedValueAssertionForPreviousField(step, previousStep, selectedText, clickedText);
  const selectedDisplayTied = selectedDisplayEcho && hasSelectedValueAssertionForPreviousValue(previousStep, selectedText, clickedText);
  const pollutedFieldIdentityTied = isWeakUnscopedSelectedTextClick(step) && previousFieldIdentityIsSelectedValue(previousStep, selectedText);
  if (!fieldScoped && !currentAssertionTied && !assertionTied && !selectedDisplayTied && !pollutedFieldIdentityTied)
    return false;
  return true;
}

function isWeakUnscopedSelectedTextClick(step: FlowStep) {
  const contextTarget = step.context?.before.target as Record<string, unknown> | undefined;
  const role = String(step.target?.role || contextTarget?.role || '');
  if (step.target?.testId || contextTarget?.testId || role === 'button' || role === 'link')
    return false;
  if (step.target?.scope?.table || step.context?.before.table)
    return false;
  const source = `${step.sourceCode || ''}\n${JSON.stringify(rawAction(step.rawAction))}`;
  return /getByText|internal:text=|text=/.test(source);
}

function previousFieldIdentityIsSelectedValue(step: FlowStep, selectedText: string) {
  const normalizedSelectedText = normalizeFieldIdentityToken(selectedText);
  if (!normalizedSelectedText)
    return false;
  return selectedValuePreviousFieldTokens(step).some(token => token === normalizedSelectedText);
}

function isSelectedValueDisplayEchoTarget(step: FlowStep) {
  const contextTarget = step.context?.before.target as Record<string, unknown> | undefined;
  const rawTarget = step.target?.raw as Record<string, unknown> | undefined;
  const role = String(step.target?.role || contextTarget?.role || '');
  if (step.target?.testId || contextTarget?.testId || role === 'button' || role === 'link')
    return false;
  const tag = String(contextTarget?.tag || rawTarget?.tag || '');
  const className = String(contextTarget?.className || contextTarget?.class || rawTarget?.className || rawTarget?.class || '');
  const source = `${step.sourceCode || ''}\n${JSON.stringify(rawAction(step.rawAction))}`;
  return /^span$/i.test(tag) || /ant-select-selection-item|selection-item/.test(className) || /ant-select-selection-item|selection-item/.test(source);
}

function sameSelectedValueDisplayFieldIdentity(step: FlowStep, previousStep: FlowStep) {
  const clickedFieldTokens = selectedValueDisplayClickFieldTokens(step);
  const previousFieldTokens = selectedValuePreviousFieldTokens(previousStep);
  return clickedFieldTokens.some(leftToken => previousFieldTokens.some(rightToken => fieldsMatch(leftToken, rightToken)));
}

function selectedValueDisplayClickFieldTokens(step: FlowStep) {
  return uniqueValues([
    step.target?.label,
    step.target?.scope?.form?.label,
    step.context?.before.form?.label,
    step.target?.placeholder,
    step.context?.before.target?.placeholder,
  ].map(normalizeFieldIdentityToken).filter(Boolean) as string[]);
}

function selectedValuePreviousFieldTokens(step: FlowStep) {
  return uniqueValues([
    step.target?.label,
    step.target?.scope?.form?.label,
    step.context?.before.form?.label,
    step.target?.placeholder,
    step.context?.before.target?.placeholder,
    step.target?.name,
    step.target?.displayName,
    popupFieldLabelFromName(step.target?.name || step.target?.text || step.target?.displayName),
    comboboxNameFromSource(step.sourceCode || ''),
    formItemLabelFromSource(step.sourceCode || ''),
  ].map(normalizeFieldIdentityToken).filter(Boolean) as string[]);
}

export function isTruncatedSelectedValueDisplayEchoClick(step: FlowStep, previousStep?: FlowStep) {
  if (!isRedundantSelectedValueDisplayClick(step, previousStep))
    return false;
  const selectedText = normalizeGeneratedText(String(previousStep?.value || previousStep?.uiRecipe?.optionText || '')) || '';
  const clickedText = normalizeGeneratedText(selectedDisplayClickText(step) || '') || '';
  return !!selectedText && !!clickedText &&
    selectedText.startsWith(clickedText) &&
    selectedText !== clickedText &&
    compactDropdownOptionIdentity(selectedText) !== compactDropdownOptionIdentity(clickedText);
}

function selectedDisplayClickText(step: FlowStep) {
  const action = rawAction(step.rawAction);
  return generatedTextCandidate(
      step.target?.text,
      step.target?.name,
      step.target?.displayName,
      step.context?.before.target?.text,
      step.context?.before.target?.normalizedText,
      action.text,
      action.value,
      textFromInternalTextSelector(action.selector),
  );
}

function hasSelectedValueAssertionForPreviousField(step: FlowStep, previousStep: FlowStep, selectedText: string, clickedText?: string, assertionSource: 'current' | 'any' = 'any') {
  const previousTestIds = uniqueValues([
    previousStep.target?.testId,
    previousStep.context?.before.form?.testId,
    previousStep.target?.scope?.form?.testId,
    previousStep.context?.before.target?.testId,
  ].filter(Boolean) as string[]);
  const previousFieldTokens = selectedValuePreviousFieldTokens(previousStep);
  if (!previousTestIds.length && !previousFieldTokens.length)
    return false;
  const normalizedSelectedText = normalizeGeneratedText(selectedText);
  const assertions = assertionSource === 'current' ? step.assertions : [...step.assertions, ...previousStep.assertions];
  return assertions.some(assertion => {
    if (!selectedValueAssertionMatchesText(assertion, normalizedSelectedText, clickedText))
      return false;
    const assertionTargetTestId = stringParam(assertion.params?.targetTestId || assertion.target?.testId);
    if (assertionTargetTestId && previousTestIds.includes(assertionTargetTestId))
      return true;
    const assertionFieldTokens = uniqueValues([
      assertion.target?.label,
      assertion.target?.scope?.form?.label,
      assertion.target?.name,
      assertion.target?.displayName,
      stringParam(assertion.params?.fieldLabel),
      stringParam(assertion.params?.label),
    ].map(normalizeFieldIdentityToken).filter(Boolean) as string[]);
    return assertionFieldTokens.some(leftToken => previousFieldTokens.some(rightToken => fieldsMatch(leftToken, rightToken)));
  });
}

function hasSelectedValueAssertionForPreviousValue(previousStep: FlowStep, selectedText: string, clickedText?: string) {
  const normalizedSelectedText = normalizeGeneratedText(selectedText);
  return previousStep.assertions.some(assertion => selectedValueAssertionMatchesText(assertion, normalizedSelectedText, clickedText));
}

function selectedValueAssertionMatchesText(assertion: FlowAssertion, normalizedSelectedText?: string, clickedText?: string) {
  if (assertion.type !== 'selected-value-visible' || !assertion.enabled)
    return false;
  const expected = normalizeGeneratedText(stringParam(assertion.expected || assertion.params?.expected) || '');
  const normalizedClickedText = normalizeGeneratedText(clickedText || '') || '';
  const matchesSelectedText = expected === normalizedSelectedText;
  const matchesTruncatedClickedText = !!normalizedClickedText && expected === normalizedClickedText && normalizedSelectedText?.startsWith(normalizedClickedText) && normalizedClickedText.length >= 4;
  return !!expected && (matchesSelectedText || matchesTruncatedClickedText);
}

function isAntdProjectedSelectStep(step: FlowStep) {
  if (step.action !== 'select')
    return false;
  const recipe = buildRecipeForStep(step);
  if (isRecipeBackedAntdSelectOption(recipe))
    return true;
  const source = `${step.sourceCode || ''}\n${JSON.stringify(rawAction(step.rawAction))}`;
  return step.uiRecipe?.kind === 'select-option' ||
    /ant-select-selector|ant-cascader-picker|ant-select-dropdown|ant-cascader-dropdown/.test(source);
}

export function isRedundantSelectSearchClear(step: FlowStep, previousStep?: FlowStep) {
  if (step.action !== 'fill' || step.value !== '')
    return false;
  if (!previousStep || !looksLikeDropdownOptionStepForDedup(previousStep))
    return false;
  if (step.assertions.some(assertion => assertion.enabled))
    return false;
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  const role = step.target?.role || step.context?.before.target?.role || '';
  const source = step.sourceCode || JSON.stringify(rawAction(step.rawAction));
  const looksLikeSelectSearch = controlType === 'select' || role === 'combobox' || /ant-select-selector/.test(source);
  return looksLikeSelectSearch && sameFieldIdentityIgnoringDialog(step, previousStep);
}

export function isRedundantDropdownEscape(step: FlowStep, previousStep?: FlowStep) {
  if (step.action !== 'press' || step.value !== 'Escape')
    return false;
  if (!previousStep || !looksLikeDropdownOptionStepForDedup(previousStep))
    return false;
  if (step.assertions.some(assertion => assertion.enabled))
    return false;
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  const role = step.target?.role || step.context?.before.target?.role || '';
  const source = `${step.sourceCode || ''}\n${JSON.stringify(rawAction(step.rawAction))}`;
  const looksLikeSelectEscape = controlType === 'select' || role === 'combobox' || /ant-select|combobox/i.test(source);
  return looksLikeSelectEscape && sameFieldIdentityIgnoringDialog(step, previousStep);
}

function sameFieldIdentity(left: FlowStep, right: FlowStep) {
  const leftDialog = left.target?.scope?.dialog?.title || left.context?.before.dialog?.title;
  const rightDialog = right.target?.scope?.dialog?.title || right.context?.before.dialog?.title;
  if (leftDialog && rightDialog && leftDialog !== rightDialog)
    return false;

  const leftTokens = fieldIdentityTokens(left);
  const rightTokens = fieldIdentityTokens(right);
  return leftTokens.some(leftToken => rightTokens.some(rightToken => fieldsMatch(leftToken, rightToken)));
}

function sameFieldIdentityIgnoringDialog(left: FlowStep, right: FlowStep) {
  const leftTokens = fieldIdentityTokens(left);
  const rightTokens = fieldIdentityTokens(right);
  return leftTokens.some(leftToken => rightTokens.some(rightToken => fieldsMatch(leftToken, rightToken)));
}

function fieldIdentityTokens(step: FlowStep) {
  return uniqueValues([
    step.target?.label,
    step.target?.scope?.form?.label,
    step.context?.before.form?.label,
    step.target?.placeholder,
    step.context?.before.target?.placeholder,
    step.target?.name,
    step.target?.displayName,
    popupFieldLabelFromName(step.target?.name || step.target?.text || step.target?.displayName),
    formItemLabelFromSource(step.sourceCode || ''),
  ].map(normalizeFieldIdentityToken).filter(Boolean) as string[]);
}

function fieldsMatch(left: string, right: string) {
  return left === right || left.includes(right) || right.includes(left);
}

function normalizeFieldIdentityToken(value?: string) {
  return normalizeGeneratedText(value)
      ?.replace(/^(?:combobox|textbox|spinbutton)\s+/i, '')
      ?.replace(/^[*＊]\s*/, '')
      .replace(/[：:]\s*$/, '')
      .replace(/\s+/g, '');
}

function uniqueValues(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export function emitStep(lines: string[], step: FlowStep, indent: string, segment?: FlowRepeatSegment, rowValues?: Record<string, string>, options: EmitStepOptions = {}) {
  lines.push(`${indent}// ${step.id} ${actionLabel[step.action]}: ${summarizeStepSubject(step)}`);
  const sourceCode = sourceCodeWithSafetyPreflight(step, options);
  if (sourceCode) {
    const parameterizedSource = sourceCode
        .map(line => segment ? parameterizeRepeatLine(line, step, segment, rowValues, activePopupOptionDispatchSource) : line);
    const emittedSource = parameterizedSource.some(line => isPlaceholderSelectOptionSourceLine(line)) ? [] : parameterizedSource;
    if (emittedSource.length)
      lines.push(...emittedSource.map(line => `${indent}${line}`));
    else
      lines.push(`${indent}// ${step.id} skipped unsafe placeholder select option replay.`);
  } else {
    lines.push(`${indent}// ${step.id} has no runnable Playwright action source.`);
  }

  const emittedAssertions = stepAssertionsForEmission(step, { ...options, suppressRowExistsAssertions: options.suppressRowExistsAssertions || !!segment?.assertionTemplate });
  for (const assertion of emittedAssertions)
    lines.push(`${indent}${segment ? parameterizeRepeatLine(renderAssertion(assertion), step, segment, rowValues, activePopupOptionDispatchSource) : renderAssertion(assertion)}`);
}

export function countStepActions(step: FlowStep, options: EmitStepOptions = {}) {
  const sourceActionCount = sourceCodeWithSafetyPreflight(step, options)
      ?.filter(line => isRunnableLine(line))
      .length ?? 0;
  const assertionActionCount = stepAssertionsForEmission(step, options)
      .map(renderAssertion)
      .filter(line => isRunnableLine(line))
      .length;
  return sourceActionCount + assertionActionCount;
}

function sourceCodeWithSafetyPreflight(step: FlowStep, options: EmitStepOptions = {}) {
  const sourceCode = sourceCodeForStep(step, options);
  if (options.safetyGuard === false)
    return sourceCode;
  const safety = buildRecipeForStep(step)?.safetyPreflight;
  return applySafetyPreflightToSource(sourceCode, safety, step, { parserSafe: options.parserSafe });
}

function stepAssertionsForEmission(step: FlowStep, options: EmitStepOptions = {}) {
  if (isNonInteractiveContainerClick(step))
    return [];
  return step.assertions.filter(assertion => assertion.enabled &&
    (!options.suppressRowExistsAssertions || assertion.type !== 'row-exists') &&
    (!options.parserSafe || !isTerminalAssertionParserUnsafe(assertion)) &&
    !isOverlayClosedAssertionSupersededByNextDialog(assertion, options.nextStep) &&
    !isNoisyDropdownOptionSelectedValueAssertion(step, assertion));
}

function isOverlayClosedAssertionSupersededByNextDialog(assertion: FlowAssertion, nextStep?: FlowStep) {
  if (assertion.type !== 'modal-closed' && assertion.type !== 'drawer-closed')
    return false;
  const nextDialog = nextStep?.target?.scope?.dialog || nextStep?.context?.before.dialog;
  if (!isPersistentDialog(nextDialog))
    return false;
  const assertionDialog: FlowDialogScope = {
    type: assertion.type === 'drawer-closed' ? 'drawer' : 'modal',
    visible: false,
    title: stringParam(assertion.params?.title),
    testId: stringParam(assertion.params?.testId),
  };
  return !sameDialogScope(nextDialog, assertionDialog);
}

function isNoisyDropdownOptionSelectedValueAssertion(step: FlowStep, assertion: FlowAssertion) {
  if (assertion.type !== 'selected-value-visible')
    return false;
  const generatedSource = sourceCodeForStep(step)?.join('\n') || '';
  const optionLike = isDropdownOptionLikeClick(step) || /ant-select-dropdown|ant-cascader-menu|ant-tree-select-dropdown/.test(generatedSource);
  if (step.action !== 'click' || !optionLike)
    return false;
  const expected = stringParam(assertion.expected || assertion.params?.expected);
  if (!expected)
    return false;
  const optionText = rawSelectOptionTitle(step) || step.context?.before.target?.text || step.context?.before.target?.normalizedText || step.target?.text || step.target?.name || step.target?.displayName || '';
  const normalizedExpected = normalizeGeneratedText(expected) || '';
  const normalizedOption = normalizeGeneratedText(optionText) || '';
  if (!normalizedExpected || normalizedExpected === normalizedOption)
    return false;
  const noisyLength = normalizedExpected.length > Math.max(60, normalizedOption.length * 4);
  if (!noisyLength)
    return false;
  return true;
}

function isDropdownOptionLikeClick(step: FlowStep) {
  const controlType = step.context?.before.target?.controlType || '';
  if (/(select|tree-select|cascader)-option/.test(controlType))
    return true;
  if (step.target?.role === 'option')
    return true;
  if (rawSelectOptionTitle(step))
    return true;
  const haystack = JSON.stringify({ rawAction: step.rawAction, raw: step.target?.raw, sourceCode: step.sourceCode }).toLowerCase();
  return /select-dropdown|tree-select-dropdown|cascader|role=option|internal:attr=\[title=/.test(haystack);
}

function isRunnableLine(line: string) {
  return /^(await|const|let|var)\s/.test(line.trim());
}

function sourceCodeForStep(step: FlowStep, options: EmitStepOptions = {}) {
  if (isNonInteractiveContainerClick(step))
    return undefined;
  if (isRedundantSelectedValueDisplayClick(step, options.previousStep))
    return undefined;
  const sourceCode = normalizeActionSource(step.sourceCode);
  if (sourceCode && sourceMatchesStep(sourceCode, step) && shouldPreserveRecordedDisambiguatedSource(sourceCode, step))
    return appendSyntheticFollowUpSource(sourceCode, step, options);
  if (sourceCode && sourceMatchesStep(sourceCode, step) && shouldPreserveRecordedOpenerTestIdSource(sourceCode, step))
    return appendSyntheticFollowUpSource(sourceCode, step, options);
  const contractSource = contractPrimarySourceForStep(step, options);
  if (contractSource) {
    const normalized = normalizeActionSource(contractSource);
    return normalized ? appendSyntheticFollowUpSource(normalized, step, options) : normalized;
  }
  const fallback = renderRawActionSource(step, options);
  if (fallback) {
    const fallbackSource = normalizeActionSource(fallback);
    return fallbackSource ? appendSyntheticFollowUpSource(fallbackSource, step, options) : fallbackSource;
  }
  if (sourceCode && sourceMatchesStep(sourceCode, step))
    return appendSyntheticFollowUpSource(sourceCode, step, options);
  return sourceCode;
}

function contractPrimarySourceForStep(step: FlowStep, options: EmitStepOptions = {}) {
  const recipe = buildRecipeForStep(step);
  const candidate = recipe?.locatorContract?.primaryExecutable;
  if (!candidate)
    return undefined;
  if (candidate.kind === 'active-popup-option')
    return contractActivePopupOptionSource(candidate, step, options);
  if (shouldPreserveCapturedTestIdOrdinalForContract(step, candidate))
    return undefined;
  if (isAntdSelectFieldStep(step, options.nextStep))
    return undefined;
  if (step.action !== 'click')
    return undefined;
  const locator = contractPrimaryClickLocator(candidate, step, options);
  return locator ? `await ${locator}.click();` : undefined;
}

function shouldPreserveCapturedTestIdOrdinalForContract(step: FlowStep, candidate: LocatorCandidate) {
  if (candidate.kind !== 'row-scoped-testid' && candidate.kind !== 'testid')
    return false;
  const testId = candidate.payload?.testId;
  if (!testId)
    return false;
  const source = step.target?.testId === testId ? 'target' : 'context';
  return duplicatePageIndex(step, testId, source) !== undefined && !isReusableRowActionTestId(testId);
}

function contractActivePopupOptionSource(candidate: LocatorCandidate, step: FlowStep, options: EmitStepOptions = {}) {
  const optionText = candidate.payload?.optionText;
  if (!optionText || (step.action !== 'click' && step.action !== 'select'))
    return undefined;
  if (isOrdinaryFormLabelClick(step))
    return undefined;
  const recipe = buildRecipeForStep(step);
  if (recipe?.component === 'TreeSelect') {
    const treeOption = antdTreeSelectOptionLocator(step, options);
    if (treeOption)
      return options.parserSafe ? `await ${treeOption}.click();` : antdPopupOptionClickSource(step, treeOption, { clickFirstMatch: true });
  }
  if (recipe?.component === 'Cascader') {
    const cascaderPath = antdCascaderPathClickSource(step, options);
    if (cascaderPath)
      return cascaderPath;
    const cascaderOption = antdCascaderOptionLocator(step, options);
    if (cascaderOption)
      return options.parserSafe ? `await ${cascaderOption}.click();\nawait page.waitForTimeout(120);` : antdPopupOptionClickSource(step, cascaderOption, { stabilizeAfterClickMs: 120, clickFirstMatch: true });
  }
  const projected = projectedAntdSelectOptionSource(step, options);
  if (projected)
    return projected;
  if (options.parserSafe && recipe?.component === 'Select')
    return antdSelectOptionParserSafeSource(step, options);
  const locator = optionLocatorWithTextTokens(
      `page.locator(${stringLiteral(activePopupOptionRowsSelector(options))})`,
      optionText,
      { parserSafeRuntimeBridge: options.parserSafe },
  );
  if (options.parserSafe)
    return `await ${locator}.click();`;
  if (recipe?.component === 'Select')
    return antdSelectOptionClickSource(step, antdSelectOptionLocator(step, options) || locator);
  return antdPopupOptionClickSource(step, locator);
}

function contractPrimaryClickLocator(candidate: LocatorCandidate, step: FlowStep, options: EmitStepOptions = {}) {
  switch (candidate.kind) {
    case 'row-scoped-testid':
    case 'row-scoped-role':
      return contractRowScopedLocator(candidate, step);
    case 'dialog-scoped-testid':
    case 'dialog-scoped-role':
      return contractDialogScopedLocator(candidate, step);
    case 'visible-popconfirm-confirm':
      return contractPopconfirmConfirmLocator(candidate, options);
    case 'testid':
      return contractTestIdLocator(candidate, step);
    default:
      return undefined;
  }
}

function contractRowScopedLocator(candidate: LocatorCandidate, step: FlowStep) {
  const payload = candidate.payload;
  if (!payload?.tableTestId)
    return undefined;
  const table = `page.getByTestId(${stringLiteral(payload.tableTestId)})`;
  const row = payload.rowKey
    ? `${table}.locator(${stringLiteral(`tr[data-row-key="${cssAttributeValue(payload.rowKey)}"], [data-row-key="${cssAttributeValue(payload.rowKey)}"]`)}).first()`
    : payload.rowText
      ? `${table}.locator(${stringLiteral('tr, [role="row"]')}).filter({ hasText: ${rowTextRegexLiteral(payload.rowText)} }).first()`
      : undefined;
  if (!row)
    return undefined;
  if (payload.testId)
    return `${row}.getByTestId(${stringLiteral(payload.testId)})`;
  const role = payload.role || step.target?.role || step.context?.before.target?.role || 'button';
  if (role === 'row' || role === 'cell' || role === 'gridcell')
    return row;
  const name = payload.name || payload.text || targetNameForLocator(step);
  return name ? `${row}.getByRole(${stringLiteral(role)}, ${roleNameOptionsSource(step, role, name)})` : undefined;
}

function contractDialogScopedLocator(candidate: LocatorCandidate, step: FlowStep) {
  const payload = candidate.payload;
  if (!payload)
    return undefined;
  const dialog: FlowDialogScope = {
    type: payload.dialogType === 'drawer' ? 'drawer' : payload.dialogType === 'popover' ? 'popover' : 'modal',
    visible: true,
    title: payload.dialogTitle,
    testId: payload.dialogTestId,
  };
  if (!payload.dialogTestId && !payload.dialogTitle)
    return undefined;
  if (step.action === 'click' && dialogOpenedByThisStep(step, dialog))
    return undefined;
  const root = dialogRootLocator(dialog);
  if (payload.testId && looksLikeStructuralDialogTargetTestId(payload.testId, payload.dialogTestId))
    return undefined;
  if (payload.testId)
    return `${root}.getByTestId(${stringLiteral(payload.testId)})`;
  const payloadRole = payload.role || step.target?.role || step.context?.before.target?.role;
  const role = dialog.type === 'popover' && payloadRole === 'tooltip' ? 'button' : payloadRole || 'button';
  const name = payload.name || payload.text || targetNameForLocator(step);
  return name ? `${root}.getByRole(${stringLiteral(role)}, ${roleNameOptionsSource(step, role, name)})` : undefined;
}

function isDialogOpenerTestIdClick(step: FlowStep, testId: string) {
  if (step.action !== 'click' || !looksLikeDialogOpenerTestId(testId))
    return false;
  if (stepOpensPersistentDialog(step))
    return true;
  const scopedDialog = step.target?.scope?.dialog;
  return !!(scopedDialog && isPersistentDialog(scopedDialog) && !sameDialogScope(step.context?.before.dialog, scopedDialog) && hasNonTestIdTargetText(step, testId));
}

function contractPopconfirmConfirmLocator(candidate: LocatorCandidate, options: EmitStepOptions = {}) {
  const payload = candidate.payload;
  const name = payload?.name || payload?.text || '确定';
  const root = payload?.dialogTitle && !options.parserSafe
    ? `page.locator(${stringLiteral(popconfirmRootSelector())}).filter({ hasText: ${stringLiteral(payload.dialogTitle)} })`
    : `page.locator(${stringLiteral(popconfirmRootSelector())}).last()`;
  return `${root}.getByRole("button", { name: ${popconfirmButtonNameSource(name)} })`;
}

function popconfirmButtonNameSource(targetName: string) {
  const compact = normalizeGeneratedText(targetName)?.replace(/\s+/g, '') || '';
  if (compact === '确定')
    return '/^(确定|确 定)$/';
  return roleNameSource('button', targetName);
}

function contractTestIdLocator(candidate: LocatorCandidate, step: FlowStep) {
  const testId = candidate.payload?.testId;
  if (!testId)
    return undefined;
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  const role = step.target?.role || step.context?.before.target?.role || '';
  if (isChoiceControlKind(controlType, role) || isStructuralLabelChoiceClick(step))
    return undefined;
  if (looksLikeStructuralFormTestId(testId) || looksLikeStructuralContainerTestId(testId))
    return undefined;
  const rowScoped = rowScopedActionTestIdLocator(step, testId);
  if (rowScoped)
    return rowScoped;
  if (isReusableRowActionTestId(testId))
    return undefined;
  const source = testIdSourceForStep(step, testId);
  if (duplicatePageIndex(step, testId, source) !== undefined)
    return undefined;
  return `page.getByTestId(${stringLiteral(testId)})`;
}

function shouldPreserveRecordedDisambiguatedSource(sourceCode: string[], step: FlowStep) {
  if (step.action !== 'click')
    return false;
  const testId = step.target?.testId || step.context?.before.target?.testId;
  if (testId)
    return false;
  if (isAntdSelectFieldStep(step))
    return false;
  if (isDropdownOptionLikeClick(step))
    return false;
  if (hasStrongerStructuredRoleScope(step))
    return false;
  const role = step.target?.role || step.context?.before.target?.role || '';
  if (role === 'tooltip')
    return false;
  const targetLabel = normalizeGeneratedText(targetNameForLocator(step) || step.context?.before.target?.text || step.context?.before.target?.normalizedText || '')
      ?.replace(/^(button|link)\s+/i, '')
      .trim() || '';
  if (targetLabel && (isLikelyDialogConfirmButton(targetLabel) || /(?:^|\b)(delete|remove)(?:\b|$)|删除|移除/i.test(targetLabel)))
    return false;
  const joined = sourceCode.join('\n');
  if (/internal:role=tooltip|ant-popover|popconfirm/i.test(joined))
    return false;
  if (/getByRole\(/.test(joined) && /exact\s*:\s*true/.test(joined))
    return true;
  if (/getByRole\(/.test(joined) && /\.(?:nth|first|last)\s*\(/.test(joined))
    return true;
  if (/(?:getByTestId|locator)\([^)]*\)\.getBy(?:Role|Text|Label)\(/.test(joined) || /\.filter\([^)]*\)\.getBy(?:Role|Text|Label)\(/.test(joined))
    return true;
  return false;
}

function hasStrongerStructuredRoleScope(step: FlowStep) {
  const role = step.target?.role || step.context?.before.target?.role;
  const targetName = targetNameForLocator(step);
  if (!role || !targetName)
    return false;

  const table = step.target?.scope?.table || step.context?.before.table;
  if (table?.testId && (table.rowKey || table.rowIdentity?.stable || table.rowText))
    return true;

  const dialog = step.target?.scope?.dialog || step.context?.before.dialog;
  if (dialog && (dialog.testId || dialog.title) && dialog.visible !== false)
    return true;

  const section = step.target?.scope?.section || step.context?.before.section;
  return !!section?.testId;
}

function shouldPreserveRecordedOpenerTestIdSource(sourceCode: string[], step: FlowStep) {
  if (step.action !== 'click')
    return false;
  const testId = step.target?.testId || step.context?.before.target?.testId || testIdFromSource(JSON.stringify(rawAction(step.rawAction))) || testIdFromSource(sourceCode.join('\n')) || '';
  const dialog = step.target?.scope?.dialog || step.context?.before.dialog;
  if (looksLikeStructuralDialogTargetTestId(testId, dialog?.testId, { isDialogOpener: isDialogOpenerTestIdClick(step, testId) }))
    return false;
  if (testId && ancestorScopedTestIdLocator(step, testId, testIdSourceForStep(step, testId)))
    return false;
  if (!looksLikeDialogOpenerTestId(testId))
    return false;
  const joined = sourceCode.join('\n');
  const testIdPattern = new RegExp(`page\\.getByTestId\\(["']${escapeRegExp(testId)}["']\\)(?:\\.nth\\(\\d+\\))?\\.click\\(`);
  return testIdPattern.test(joined);
}

function appendSyntheticFollowUpSource(sourceCode: string[], step: FlowStep, options: EmitStepOptions = {}) {
  if (step.action !== 'click')
    return sourceCode;
  const joined = sourceCode.join('\n');
  if (/\.ant-popover|role=\\"tooltip\\"|role="tooltip"/.test(joined))
    return sourceCode;
  const popconfirmSource = antdPopoverConfirmAfterClickSource(step, options);
  return popconfirmSource ? [...sourceCode, ...(normalizeActionSource(popconfirmSource) ?? [])] : sourceCode;
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

function isNonInteractiveContainerClick(step: FlowStep) {
  if (step.action !== 'click')
    return false;
  const testId = step.target?.testId || step.context?.before.target?.testId;
  const role = step.target?.role || step.context?.before.target?.role;
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  const contextTag = step.context?.before.target?.tag || String((step.target?.raw as { tag?: unknown } | undefined)?.tag || '');
  const dialogType = step.target?.scope?.dialog?.type || step.context?.before.dialog?.type;
  const looksLikeOverlayRoot = !!testId && (/(modal|drawer|dialog)$/i.test(testId) || (/(container|root)$/i.test(testId) && /^(modal|drawer|dialog)$/i.test(dialogType || '')));
  const rootLikeOverlayElement = looksLikeOverlayRoot && !role && /^(|div|section|article|main|aside)$/i.test(contextTag || '');
  if (rootLikeOverlayElement)
    return true;
  if (/^(button|link|checkbox|radio|switch|combobox|option|menuitem|tab)$/i.test(role || ''))
    return false;
  if (/^(button|checkbox|radio|switch|select|tree-select|cascader|select-option|tree-select-option|cascader-option|input|textarea|upload|tab)$/i.test(controlType || ''))
    return false;
  if (isTableScopedClick(step))
    return false;

  const contextFramework = step.context?.before.target?.framework || String((step.target?.raw as { framework?: unknown } | undefined)?.framework || '');
  const sectionKind = step.context?.before.section?.kind || step.target?.scope?.section?.kind || '';
  const hasTargetText = hasNonTestIdTargetText(step, testId);
  if (looksLikeOverlayRoot)
    return true;
  if (testId && looksLikeActionTestId(testId))
    return false;
  if (/^heading$/i.test(role || '') || /^h[1-6]$/i.test(contextTag))
    return true;
  if (isStructuralLabelChoiceClick(step))
    return false;

  const looksLikeStructuralContainer =
    (!!testId && looksLikeStructuralContainerTestId(testId)) ||
    /^(section|article|main|aside|header|footer)$/i.test(contextTag) ||
    /^(card|panel|section|fieldset)$/i.test(sectionKind) ||
    /procomponents|antd/i.test(contextFramework) && /card|section|container|wrapper/i.test(String(testId || ''));
  if (!looksLikeStructuralContainer)
    return false;
  return !hasTargetText || !!testId;
}

function isTableScopedClick(step: FlowStep) {
  if (step.action !== 'click')
    return false;
  const table = step.target?.scope?.table || step.context?.before.table;
  if (!table?.testId)
    return false;
  return !!(table.rowKey || table.rowIdentity?.value || table.rowText || step.context?.before.target?.role === 'row' || step.target?.role === 'row');
}

function hasNonTestIdTargetText(step: FlowStep, testId?: string) {
  const values = [
    step.target?.text,
    step.target?.name,
    step.target?.label,
    step.target?.displayName,
    step.context?.before.target?.text,
    step.context?.before.target?.normalizedText,
    step.context?.before.target?.ariaLabel,
    step.context?.before.target?.placeholder,
  ].map(value => normalizeGeneratedText(value)).filter(Boolean) as string[];
  return values.some(value => value !== normalizeGeneratedText(testId));
}

function looksLikeStructuralContainerTestId(testId: string) {
  return /(^|[-_])(section|container|card|wrapper|content|region)([-_]|$)/i.test(testId);
}

function looksLikeActionTestId(testId: string) {
  return /(^|[-_])(button|btn|link|tab|switch|checkbox|radio|select|input|create|add|new|save|delete|remove|edit|confirm|cancel|submit|ok|option|menu)([-_]|$)/i.test(testId);
}

function renderRawActionSource(step: FlowStep, options: EmitStepOptions = {}) {
  const action = rawAction(step.rawAction);
  const selector = action.selector || step.target?.selector || step.target?.locator;
  switch (action.name || step.action) {
    case 'navigate':
    case 'goto':
    case 'openPage':
      return action.url || step.url ? `await page.goto(${stringLiteral(action.url || step.url)});` : undefined;
    case 'click': {
      const inheritedOption = inheritedOptionClickSourceFromPreviousStep(step, options.previousStep, options);
      if (inheritedOption)
        return inheritedOption;
      const selectTriggerLocator = selectTriggerClickLocator(step);
      if (selectTriggerLocator)
        return `await ${selectTriggerLocator}.click();`;
      const testIdLocator = globalTestIdLocator(step);
      if (testIdLocator) {
        const clickSource = `await ${testIdLocator}.click();`;
        const popconfirmSource = antdPopoverConfirmAfterClickSource(step, options);
        if (popconfirmSource)
          return `${clickSource}\n${popconfirmSource}`;
        const parserSafeDuplicateLocator = options.parserSafe && /\.nth\(/.test(testIdLocator) && shouldPreferParserSafeDuplicateRole(step) ? duplicateRoleLocator(step) : undefined;
        if (parserSafeDuplicateLocator)
          return `await page.waitForTimeout(300);\nawait ${parserSafeDuplicateLocator}.click({ force: true });`;
        return options.parserSafe && duplicatePageIndex(step) !== undefined ? `await page.waitForTimeout(300);\n${clickSource}` : clickSource;
      }
      const selectOption = hasPageContextAntdOption(step) ? antdSelectOptionLocator(step) : undefined;
      if (selectOption)
        return options.parserSafe ? antdSelectOptionParserSafeSource(step, options) : antdSelectOptionClickSource(step, selectOption);
      const rawSelectOption = rawSelectOptionClickSource(step);
      if (rawSelectOption)
        return options.parserSafe ? rawSelectOptionParserSafeSource(step) : rawSelectOption;
      const treeOption = antdTreeSelectOptionLocator(step, options);
      if (treeOption)
        return options.parserSafe ? `await ${treeOption}.click();` : antdPopupOptionClickSource(step, treeOption, { clickFirstMatch: true });
      const cascaderPath = antdCascaderPathClickSource(step, options);
      if (cascaderPath)
        return cascaderPath;
      const cascaderOption = antdCascaderOptionLocator(step, options);
      if (cascaderOption)
        return options.parserSafe ? `await ${cascaderOption}.click();\nawait page.waitForTimeout(120);` : antdPopupOptionClickSource(step, cascaderOption, { stabilizeAfterClickMs: 120, clickFirstMatch: true });
      const activePopupOption = activeDropdownOptionLocator(step, options);
      if (activePopupOption)
        return options.parserSafe ? `await ${activePopupOption}.click();` : antdPopupOptionClickSource(step, activePopupOption);
      const preferred = preferredTargetLocator(step, options);
      if (preferred)
        return `await ${preferred}.click();`;
      return selector ? `await ${locatorExpressionForSelector(selector)}.click();` : targetClickFallback(step, options);
    }
    case 'fill': {
      const value = stringLiteral(action.text ?? action.value ?? step.value ?? '');
      const isComboboxFill = isAntdSelectFieldStep(step, options.nextStep);
      const selectTrigger = isComboboxFill ? antdSelectFieldLocator(step) : undefined;
      if (selectTrigger)
        return `await ${options.parserSafe ? parserSafeLocator(selectTrigger) : selectTrigger}.locator(${stringLiteral('input:visible')})${options.parserSafe ? '' : '.first()'}.fill(${value});`;
      const preferred = fieldLocator(step, { allowSelectLike: !!selectTrigger });
      const testIdLocator = fillTestIdLocator(step);
      if (testIdLocator)
        return `await ${testIdLocator}.fill(${value});`;
      if (preferred)
        return `await ${preferred}.fill(${value});`;
      return selector ? `await ${locatorExpressionForSelector(selector)}.fill(${value});` : undefined;
    }
    case 'press': {
      if (!selector)
        return undefined;
      const key = String(action.key ?? step.value ?? '');
      const locator = locatorExpressionForSelector(selector);
      if (!locator)
        return undefined;
      return `await ${locator}.press(${stringLiteral(key)});`;
    }
    case 'wait':
    case 'waitForTimeout':
      return renderStableWaitSource(waitMilliseconds(step.value ?? action.timeout ?? action.value ?? action.text), options);
    case 'check':
      return selector ? `await ${locatorExpressionForSelector(selector)}.check();` : undefined;
    case 'uncheck':
      return selector ? `await ${locatorExpressionForSelector(selector)}.uncheck();` : undefined;
    case 'select':
    case 'selectOption': {
      const projectedAntdSelectOption = projectedAntdSelectOptionSource(step, options);
      if (projectedAntdSelectOption)
        return projectedAntdSelectOption;
      return selector ? `await ${locatorExpressionForSelector(selector)}.selectOption(${stringLiteral(action.options?.[0] ?? step.value ?? '')});` : undefined;
    }
    case 'setInputFiles':
    case 'upload':
      return selector ? `await ${locatorExpressionForSelector(selector)}.setInputFiles(${stringLiteral(action.files?.[0] ?? step.value ?? '')});` : undefined;
    default:
      return undefined;
  }
}

function antdPopoverConfirmAfterClickSource(step: FlowStep, options: EmitStepOptions = {}) {
  const testId = step.target?.testId || step.context?.before.target?.testId || testIdFromSource(step.sourceCode) || testIdFromSource(JSON.stringify(rawAction(step.rawAction))) || '';
  if (!isDeleteOrRemoveTestId(testId))
    return undefined;
  const popover = popoverOpenedAfterClick(step);
  if (!popover)
    return undefined;
  const visibleRoot = `page.locator(${stringLiteral(popconfirmRootSelector())}).last()`;
  const root = !options.parserSafe && popover.title
    ? `page.locator(${stringLiteral(dialogRootSelector({ type: 'popover', visible: true }))}).filter({ hasText: ${stringLiteral(popover.title)} })`
    : visibleRoot;
  const clickSource = `await ${root}.getByRole("button", { name: /^(确定|确 定)$/ }).click();`;
  if (options.parserSafe) {
    return [
      `await page.waitForTimeout(300);`,
      clickSource,
    ].join('\n');
  }
  return [
    clickSource,
    `await ${root}.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});`,
  ].join('\n');
}

function popoverOpenedAfterClick(step: FlowStep) {
  const opened = step.context?.after?.openedDialog;
  if (opened?.type === 'popover')
    return opened;
  const dialog = step.context?.after?.dialog;
  if (dialog?.type === 'popover')
    return dialog;
  return undefined;
}

function testIdFromSource(source?: string) {
  if (!source)
    return undefined;
  return source.match(/getByTestId\(["']([^"']+)["']\)/)?.[1] ||
    source.match(/data-testid=["']([^"']+)["']/)?.[1];
}

function isDeleteOrRemoveTestId(testId: string) {
  return /(^|[-_])(delete|remove)([-_]|$)/i.test(testId);
}

function stepSynthesizesPopoverConfirm(step?: FlowStep, options: EmitStepOptions = { parserSafe: true }) {
  return !!step && !!antdPopoverConfirmAfterClickSource(step, options);
}

export function isRedundantExplicitPopoverConfirmStep(step: FlowStep, previous?: FlowStep) {
  if (!previous || step.action !== 'click' || previous.action !== 'click')
    return false;
  if (!stepSynthesizesPopoverConfirm(previous, { parserSafe: true }))
    return false;
  const popover = popoverOpenedAfterClick(previous);
  if (!popover)
    return false;
  const currentTestId = step.target?.testId || step.context?.before.target?.testId || testIdFromSource(step.sourceCode) || testIdFromSource(JSON.stringify(rawAction(step.rawAction))) || '';
  if (/(^|[-_])delete-confirm-(?:ok|confirm)([-_]|$)/i.test(currentTestId))
    return true;
  const currentSource = `${step.sourceCode || ''}\n${JSON.stringify(rawAction(step.rawAction))}\n${step.target?.selector || ''}\n${step.target?.locator || ''}`;
  const currentLabel = normalizeGeneratedText(step.target?.name || step.target?.text || step.target?.displayName || step.context?.before.target?.text || step.context?.before.target?.normalizedText || '');
  if (/\.ant-popover|internal:role=tooltip|role=\\?"tooltip\\?/i.test(currentSource) && isLikelyPopconfirmConfirmButton(currentLabel || ''))
    return true;
  if (!popover.title)
    return false;
  return isExplicitPopoverConfirmStep(step, popover.title);
}

function isExplicitPopoverConfirmStep(step: FlowStep | undefined, title: string) {
  if (!step || step.action !== 'click')
    return false;
  const dialog = step.context?.before.dialog || step.target?.scope?.dialog;
  const source = `${step.sourceCode || ''}\n${JSON.stringify(rawAction(step.rawAction))}\n${step.target?.selector || ''}\n${step.target?.locator || ''}`;
  const currentTestId = step.target?.testId || step.context?.before.target?.testId || testIdFromSource(step.sourceCode) || testIdFromSource(JSON.stringify(rawAction(step.rawAction))) || '';
  const sourceMentionsPopover = /\.ant-popover|role=\\?"tooltip\\?"|internal:role=tooltip/i.test(source) || step.target?.role === 'tooltip' || step.context?.before.target?.role === 'tooltip' || /(^|[-_])(popover|confirm|ok)([-_]|$)/i.test(currentTestId);
  if (dialog?.type !== 'popover' && !sourceMentionsPopover)
    return false;
  if (dialog?.title && dialog.title !== title)
    return false;
  if (sourceMentionsPopover && title && source.includes('hasText') && !source.includes(title) && !source.includes('ant-popover'))
    return false;
  const label = normalizeGeneratedText(step.target?.name || step.target?.text || step.target?.displayName || step.context?.before.target?.text || step.context?.before.target?.normalizedText);
  return isLikelyPopconfirmConfirmButton(label || '');
}

function isLikelyPopconfirmConfirmButton(label: string) {
  const compact = normalizeGeneratedText(label)?.replace(/\s+/g, '') || '';
  return /^(确定|确认|是|好的|删除|移除|保存|提交|继续|ok|yes|delete|remove|save|submit|continue)$/i.test(compact) || /(?:^|\s)(确定|确认|删除|移除|ok|yes|delete|remove)(?:\s|$)/i.test(label);
}

export function isRedundantExplicitDialogConfirmStep(step: FlowStep, previous?: FlowStep) {
  if (!previous || step.action !== 'click' || previous.action !== 'click')
    return false;
  const currentTestId = step.target?.testId || step.context?.before.target?.testId || '';
  if (currentTestId)
    return false;
  const previousTestId = previous.target?.testId || previous.context?.before.target?.testId || testIdFromSource(previous.sourceCode) || '';
  if (!/(^|[-_])(confirm|ok|save|submit|apply)([-_]|$)/i.test(previousTestId))
    return false;
  const currentLabel = normalizeGeneratedText(step.target?.name || step.target?.text || step.target?.displayName || step.context?.before.target?.text || step.context?.before.target?.normalizedText || '');
  const previousDialog = previous.target?.scope?.dialog || previous.context?.before.dialog;
  const currentDialog = step.target?.scope?.dialog || step.context?.before.dialog;
  if (!isPersistentDialog(previousDialog) || !isPersistentDialog(currentDialog) || !sameDialogScope(previousDialog, currentDialog))
    return false;
  const afterDialog = previous.context?.after?.openedDialog || previous.context?.after?.dialog;
  if (isPersistentDialog(afterDialog) && !sameDialogScope(afterDialog, previousDialog))
    return false;
  return isLikelyDialogConfirmButton(currentLabel || '');
}

export function isHiddenDialogContainerClickAfterConfirm(step: FlowStep, previous?: FlowStep) {
  if (!previous || step.action !== 'click' || !isDialogConfirmActivation(previous))
    return false;
  if (!isNonInteractiveDialogContainerClick(step))
    return false;
  const previousDialog = previous.target?.scope?.dialog || previous.context?.before.dialog;
  const currentDialog = step.target?.scope?.dialog || step.context?.before.dialog || step.context?.after?.dialog;
  if (!isPersistentDialog(previousDialog) || !isPersistentDialog(currentDialog) || !sameDialogScope(previousDialog, currentDialog))
    return false;
  const afterDialog = previous.context?.after?.dialog || previous.context?.after?.openedDialog;
  if (isPersistentDialog(afterDialog) && !sameDialogScope(afterDialog, previousDialog))
    return false;
  const confirmClosedDialog = !!afterDialog && sameDialogScope(afterDialog, previousDialog) && afterDialog.visible === false;
  const containerCapturedHidden = currentDialog?.visible === false || step.context?.after?.dialog?.visible === false;
  return confirmClosedDialog || containerCapturedHidden;
}

function isDialogConfirmActivation(step: FlowStep) {
  if (step.action !== 'click' && step.action !== 'press')
    return false;
  const testId = step.target?.testId || step.context?.before.target?.testId || testIdFromSource(step.sourceCode) || testIdFromSource(JSON.stringify(rawAction(step.rawAction))) || '';
  const label = normalizeGeneratedText(step.target?.name || step.target?.text || step.target?.displayName || step.context?.before.target?.text || step.context?.before.target?.normalizedText || '');
  if (/(^|[-_])(confirm|ok|save|submit|apply)([-_]|$)/i.test(testId))
    return true;
  if (label && isLikelyDialogConfirmButton(label))
    return true;
  const key = step.value || rawAction(step.rawAction).key || rawAction(step.rawAction).text;
  return step.action === 'press' && /^(Enter|NumpadEnter)$/i.test(String(key || '')) && !!testId;
}

function isNonInteractiveDialogContainerClick(step: FlowStep) {
  if (step.action !== 'click')
    return false;
  const role = step.target?.role || step.context?.before.target?.role || '';
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  if (isTableScopedClick(step))
    return false;
  const dialog = step.target?.scope?.dialog || step.context?.before.dialog || step.context?.after?.dialog;
  const testId = step.target?.testId || step.context?.before.target?.testId || testIdFromSource(step.sourceCode) || testIdFromSource(JSON.stringify(rawAction(step.rawAction))) || '';
  const contextTag = step.context?.before.target?.tag || String((step.target?.raw as { tag?: unknown } | undefined)?.tag || '');
  const rootByTestId = !!testId && (/(^|[-_])(modal|dialog|drawer|popover|overlay)([-_]|$)/i.test(testId) || /(^|[-_])(container|wrapper|region|root)([-_]|$)/i.test(testId));
  const rootContainerByTestId = rootByTestId && /^(div|section|article|main|aside)$/i.test(contextTag || '') && !role;
  if (/^(button|link|checkbox|radio|switch|combobox|select|option|menuitem|tab|treeitem|textbox)$/i.test(role))
    return false;
  if (/^(button|link|table-row-action|checkbox|radio|switch|select|tree-select|cascader|select-option|tree-select-option|cascader-option|menu-item|dropdown-trigger|tab|date-picker|upload|input|textarea)$/i.test(controlType) && !rootContainerByTestId)
    return false;
  const plainContainer = rootContainerByTestId || !controlType || controlType === 'unknown';
  const targetText = normalizeGeneratedText(step.target?.text || step.target?.name || step.target?.displayName || step.context?.before.target?.text || step.context?.before.target?.normalizedText || '');
  const title = normalizeGeneratedText(dialog?.title || '');
  const rootByText = !!targetText && !!title && targetText.includes(title) && /^(div|section|article|main|aside)$/i.test(contextTag || 'div');
  return !!isPersistentDialog(dialog) && plainContainer && (rootByTestId || rootByText);
}

function isLikelyDialogConfirmButton(label: string) {
  const compact = normalizeGeneratedText(label)?.replace(/\s+/g, '') || '';
  return /^(确定|确认|保存|提交|应用|完成|ok|yes|save|submit|apply|done)$/i.test(compact) || /(?:^|\s)(确定|确认|保存|提交|ok|yes|save|submit)(?:\s|$)/i.test(label);
}

export function isDuplicateSyntheticEchoClick(step: FlowStep, previous?: FlowStep) {
  if (!previous || step.action !== 'click' || previous.action !== 'click')
    return false;
  const testId = step.target?.testId || step.context?.before.target?.testId;
  const previousTestId = previous.target?.testId || previous.context?.before.target?.testId;
  if (!testId || testId !== previousTestId)
    return false;
  const label = normalizeGeneratedText(step.target?.displayName || step.target?.text || step.target?.name || step.target?.label);
  return !label || label === `testId ${testId}`;
}

function waitMilliseconds(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric))
    return 1000;
  return Math.max(0, Math.round(numeric));
}

function renderStableWaitSource(milliseconds: number, options: EmitStepOptions = {}) {
  const timeoutSource = `await page.waitForTimeout(${milliseconds});`;
  if (options.parserSafe)
    return timeoutSource;
  return [
    `await page.waitForLoadState('networkidle').catch(() => {});`,
    timeoutSource,
  ].join('\n');
}

function targetClickFallback(step: FlowStep, options: EmitStepOptions = {}) {
  if (options.parserSafe)
    return undefined;
  const preferred = preferredTargetLocator(step, options);
  if (preferred)
    return `await ${preferred}.click();`;
  const text = step.target?.text || step.target?.name || step.target?.label || step.target?.displayName;
  return text ? `await page.getByText(${stringLiteral(text)}).click();` : undefined;
}

function selectTriggerClickLocator(step: FlowStep) {
  if (step.action !== 'click')
    return undefined;
  if (!isAntdSelectFieldStep(step))
    return undefined;
  return fieldLocator(step);
}

function preferredTargetLocator(step: FlowStep, options: EmitStepOptions = {}) {
  return globalTestIdLocator(step) ||
    antdTreeSelectOptionLocator(step) ||
    antdCascaderOptionLocator(step) ||
    antdSelectOptionLocator(step) ||
    activeDropdownOptionLocator(step) ||
    tableScopedLocator(step) ||
    choiceControlLocator(step) ||
    fieldLocator(step) ||
    popoverConfirmButtonLocator(step) ||
    dialogScopedLocator(step) ||
    visibleDialogConfirmButtonLocator(step) ||
    sectionScopedLocator(step) ||
    modalConfirmButtonLocator(step) ||
    duplicateRoleLocator(step) ||
    globalRoleLocator(step) ||
    (options.parserSafe ? undefined : fallbackTextLocator(step));
}

function visibleDialogConfirmButtonLocator(step: FlowStep) {
  if (step.action !== 'click')
    return undefined;
  const testId = step.target?.testId || step.context?.before.target?.testId || testIdFromSource(step.sourceCode) || testIdFromSource(JSON.stringify(rawAction(step.rawAction))) || '';
  if (testId)
    return undefined;
  const role = step.target?.role || step.context?.before.target?.role || '';
  if (role && role !== 'button')
    return undefined;
  const name = dialogConfirmLabel(step) || '';
  const compactName = name.replace(/\s+/g, '');
  if (!/^(确定|确认|OK|YES)$/i.test(compactName))
    return undefined;
  return `page.locator(${stringLiteral('.ant-modal:not(.ant-zoom-big-leave):not(.ant-zoom-big-leave-active), .ant-drawer:not(.ant-drawer-hidden), [role="dialog"]')}).last().getByRole("button", { name: /^(确定|确 定|确认|OK|Ok|ok|Yes|yes)$/ })`;
}

function popoverConfirmButtonLocator(step: FlowStep) {
  const targetName = targetNameForLocator(step);
  const selector = rawAction(step.rawAction).selector || step.target?.selector || step.target?.locator || '';
  const role = step.target?.role || step.context?.before.target?.role || '';
  if (role !== 'tooltip' && !/internal:role=tooltip|role=["']?tooltip/i.test(selector))
    return undefined;
  if (!isLikelyPopconfirmConfirmButton(normalizeGeneratedText(targetName) || ''))
    return undefined;
  const dialog = step.target?.scope?.dialog || step.context?.before.dialog;
  if (dialog?.type === 'popover' && dialog.title)
    return `${dialogRootLocator(dialog)}.getByRole("button", { name: /^(确定|确 定)$/ })`;
  return `page.locator(${stringLiteral(popconfirmRootSelector())}).last().getByRole("button", { name: /^(确定|确 定)$/ })`;
}

function modalConfirmButtonLocator(step: FlowStep) {
  const currentTestId = step.target?.testId || step.context?.before.target?.testId || testIdFromSource(step.sourceCode) || testIdFromSource(JSON.stringify(rawAction(step.rawAction))) || '';
  if (currentTestId)
    return undefined;
  const role = step.target?.role || step.context?.before.target?.role || 'button';
  if (role !== 'button')
    return undefined;
  const label = dialogConfirmLabel(step);
  if (!label || !isLikelyDialogConfirmButton(label))
    return undefined;
  const dialog = step.target?.scope?.dialog || step.context?.before.dialog;
  const nameSource = roleNameSource('button', label);
  if (dialog?.testId)
    return `page.getByTestId(${stringLiteral(dialog.testId)}).getByRole("button", { name: ${nameSource} })`;
  if (isPersistentDialog(dialog) && dialog?.title)
    return `page.locator(${stringLiteral(dialogRootSelector(dialog))}).filter({ hasText: ${stringLiteral(dialog.title)} }).getByRole("button", { name: ${nameSource} })`;
  return `page.locator(${stringLiteral('.ant-modal, .ant-drawer, [role="dialog"]')}).last().getByRole("button", { name: ${nameSource} })`;
}

function dialogConfirmLabel(step: FlowStep) {
  return normalizeGeneratedText(targetNameForLocator(step) || step.context?.before.target?.text || step.context?.before.target?.normalizedText || '')
      ?.replace(/^(button|link)\s+/i, '')
      .trim();
}

function antdSelectOptionLocator(step: FlowStep, options: EmitStepOptions = {}) {
  if (!isAntdSelectOptionStep(step))
    return undefined;
  const optionName = antdSelectOptionName(step);
  if (!optionName)
    return undefined;
  return optionLocatorWithTextTokens(
      options.parserSafe
        ? `page.locator("${activeSelectDropdownSelector(options)} .ant-select-item-option")`
        : `page.locator("${activeSelectDropdownSelector(options)}").last().locator(".ant-select-item-option")`,
      optionName,
      { parserSafeRuntimeBridge: options.parserSafe },
  );
}

function hasPageContextAntdOption(step: FlowStep) {
  const target = step.context?.before.target;
  return !!target && (target.framework === 'antd' || target.framework === 'procomponents') && /^(select-option|tree-select-option|cascader-option)$/.test(target.controlType || '');
}

function isAntdSelectOptionStep(step: FlowStep) {
  const recipe = buildRecipeForStep(step);
  if (isRecipeBackedAntdSelectOption(recipe))
    return true;
  if (isOrdinaryFormLabelClick(step))
    return false;
  const contextTarget = step.context?.before.target;
  const selector = rawAction(step.rawAction).selector || step.target?.selector || step.target?.locator || '';
  const framework = contextTarget?.framework;
  const controlType = contextTarget?.controlType;
  const role = step.target?.role || contextTarget?.role || '';
  if (isChoiceControlKind(controlType, role))
    return false;
  if (/^(select|tree-select|cascader)$/.test(controlType || '') && role !== 'option')
    return false;
  const hasAntdSelector = /\.ant-select-item-option|\.ant-select-dropdown/.test(selector) || isRecordedActiveAntdSelectOptionSource(step.sourceCode || '');
  const hasRawTitle = !!rawSelectOptionTitle(step);
  const fieldLabel = step.context?.before.form?.label || step.target?.scope?.form?.label || step.target?.label;
  if (/tree-select-option|cascader-option/.test(controlType || ''))
    return false;
  const optionName = step.target?.text || step.target?.name || step.target?.displayName || contextTarget?.text || contextTarget?.normalizedText;
  const isFormScopedDropdownOption = step.action === 'click' && !!fieldLabel && !!optionName && (
    step.context?.before.dialog?.type === 'dropdown' || step.target?.scope?.dialog?.type === 'dropdown'
  );
  return ((framework === 'antd' || framework === 'procomponents') && controlType === 'select-option') ||
    hasAntdSelector ||
    isFormScopedDropdownOption ||
    (hasRawTitle && controlType === 'select-option' && (framework === 'antd' || framework === 'procomponents'));
}

function isRecordedActiveAntdSelectOptionSource(sourceCode: string) {
  return /ant-select-dropdown(?::visible|:not\(\.ant-select-dropdown-hidden\))/.test(sourceCode) &&
    /\.ant-select-item-option/.test(sourceCode) &&
    /\.filter\(\{\s*hasText:/.test(sourceCode) &&
    /\.click\(\)/.test(sourceCode);
}

function isOrdinaryFormLabelClick(step: FlowStep) {
  if (step.action !== 'click')
    return false;
  const contextTarget = step.context?.before.target;
  const tag = contextTarget?.tag || String((step.target?.raw as { tag?: unknown } | undefined)?.tag || '');
  if (tag !== 'label')
    return false;
  const targetText = normalizeComparableText(step.target?.text || step.target?.name || step.target?.displayName || contextTarget?.text || contextTarget?.normalizedText);
  const formLabel = normalizeComparableText(step.context?.before.form?.label || step.target?.scope?.form?.label || step.target?.label);
  if (!targetText || !formLabel || targetText !== formLabel)
    return false;
  const selector = rawAction(step.rawAction).selector || step.target?.selector || step.target?.locator || '';
  return !/ant-select|ant-cascader|ant-tree|role=option|role=menuitem/.test(selector);
}

function antdTreeSelectOptionLocator(step: FlowStep, options: EmitStepOptions = {}) {
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  const selector = rawAction(step.rawAction).selector || step.target?.selector || step.target?.locator || '';
  if (controlType !== 'tree-select-option' && !/ant-select-tree/.test(selector))
    return undefined;
  const optionName = generatedTextCandidate(step.target?.text, step.target?.name, step.target?.displayName, step.context?.before.target?.text);
  if (!optionName)
    return undefined;
  const root = options.parserSafe
    ? `page.locator("${activeSelectDropdownSelector(options)} .ant-select-tree-node-content-wrapper")`
    : `page.locator("${activeSelectDropdownSelector(options)}").last().locator(".ant-select-tree-node-content-wrapper")`;
  return `${root}.filter({ hasText: ${stringLiteral(optionName)} })`;
}

function antdCascaderOptionLocator(step: FlowStep, options: EmitStepOptions = {}) {
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  const selector = rawAction(step.rawAction).selector || step.target?.selector || step.target?.locator || '';
  if (controlType !== 'cascader-option' && !/ant-cascader-menu-item/.test(selector))
    return undefined;
  const optionName = generatedTextCandidate(step.target?.text, step.target?.name, step.target?.displayName, step.context?.before.target?.text);
  if (!optionName)
    return undefined;
  const root = options.parserSafe
    ? `page.locator("${activeCascaderDropdownSelector(options)} .ant-cascader-menu-item")`
    : `page.locator("${activeCascaderDropdownSelector(options)}").last().locator(".ant-cascader-menu-item")`;
  return `${root}.filter({ hasText: ${stringLiteral(optionName)} })`;
}

function antdCascaderPathClickSource(step: FlowStep, options: EmitStepOptions = {}) {
  if (options.parserSafe)
    return undefined;
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  const selector = rawAction(step.rawAction).selector || step.target?.selector || step.target?.locator || '';
  if (controlType !== 'cascader-option' && !/ant-cascader-menu-item/.test(selector))
    return undefined;
  const path = cascaderOptionPath(step);
  if (path.length < 2)
    return undefined;
  const optionRows = `page.locator("${activeCascaderDropdownSelector(options)}").last().locator(".ant-cascader-menu-item")`;
  const firstOption = `${optionRows}.filter({ hasText: ${stringLiteral(path[0])} })`;
  const trigger = popupOptionTriggerLocator(step);
  const lines = [
    trigger ? `if (!await ${firstOption}.first().isVisible().catch(() => false))\n  await ${trigger}.click();` : undefined,
  ];
  for (const part of path) {
    lines.push(activePopupOptionDispatchSource(optionRows, stringLiteral(part)));
    lines.push('await page.waitForTimeout(120);');
  }
  return lines.filter(Boolean).join('\n');
}

function cascaderOptionPath(step: FlowStep) {
  const action = rawAction(step.rawAction);
  const contextPath = step.context?.before.target?.optionPath ||
    step.context?.before.ui?.option?.path ||
    step.uiRecipe?.option?.path ||
    action.optionPath;
  if (Array.isArray(contextPath)) {
    const cleanPath = contextPath
        .filter(value => typeof value === 'string')
        .map(value => normalizeGeneratedText(value))
        .filter((value): value is string => !!value && !isSerializedObjectText(value));
    if (cleanPath.length > 1)
      return cleanPath;
  }
  const optionName = generatedTextCandidate(step.target?.text, step.target?.name, step.target?.displayName, step.context?.before.target?.text);
  return optionName?.split(/\s*\/\s*/).map(part => normalizeGeneratedText(part)).filter((part): part is string => !!part) ?? [];
}

function activeDropdownOptionLocator(step: FlowStep, options: EmitStepOptions = {}) {
  if (step.action !== 'click' || isOrdinaryFormLabelClick(step))
    return undefined;
  const optionName = popupOptionName(step);
  if (!optionName)
    return undefined;
  const selector = rawAction(step.rawAction).selector || step.target?.selector || step.target?.locator || '';
  const dropdown = step.context?.before.dialog || step.target?.scope?.dialog;
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  const role = step.target?.role || step.context?.before.target?.role || '';
  if (isChoiceControlKind(controlType, role))
    return undefined;
  if (/^(select|tree-select|cascader)$/.test(controlType) && role !== 'option')
    return undefined;
  const framework = step.context?.before.target?.framework || String((step.target?.raw as { framework?: unknown } | undefined)?.framework || '');
  const looksLikeActivePopupOption = dropdown?.type === 'dropdown' || (/option/.test(controlType) && /^(antd|procomponents)$/.test(framework)) || /ant-select|ant-cascader/.test(selector);
  if (!looksLikeActivePopupOption)
    return undefined;
  return optionLocatorWithTextTokens(
      `page.locator(${stringLiteral(activePopupOptionRowsSelector(options))})`,
      optionName,
      { parserSafeRuntimeBridge: options.parserSafe },
  );
}

function optionLocatorWithTextTokens(baseLocator: string, optionName: string, options: { keepSecondaryTokens?: boolean; parserSafeRuntimeBridge?: boolean } = {}) {
  return optionTextTokens(optionName, options).reduce((locator, token) => {
    return `${locator}.filter({ hasText: ${stringLiteral(token)} })`;
  }, baseLocator);
}

function activeSelectDropdownSelector(options: EmitStepOptions = {}) {
  return options.parserSafe ? '.ant-select-dropdown:not(.ant-select-dropdown-hidden)' : '.ant-select-dropdown:visible';
}

function activeCascaderDropdownSelector(options: EmitStepOptions = {}) {
  return options.parserSafe ? '.ant-cascader-dropdown:not(.ant-cascader-dropdown-hidden)' : '.ant-cascader-dropdown:visible';
}

function activePopupOptionRowsSelector(options: EmitStepOptions = {}) {
  const selectDropdown = activeSelectDropdownSelector(options);
  const cascaderDropdown = activeCascaderDropdownSelector(options);
  return [
    `${selectDropdown} .ant-select-item-option`,
    `${selectDropdown} .ant-select-tree-node-content-wrapper`,
    `${selectDropdown} .ant-select-tree-title`,
    `${cascaderDropdown} .ant-cascader-menu-item`,
  ].join(', ');
}

function optionTextTokens(optionName: string, options: { keepSecondaryTokens?: boolean; parserSafeRuntimeBridge?: boolean } = {}) {
  const normalized = normalizeGeneratedText(optionName) || '';
  const parserSafeRuntimeBridgeTokens = parserSafeRuntimeBridgeOptionTextTokens(normalized, options);
  if (parserSafeRuntimeBridgeTokens?.length)
    return parserSafeRuntimeBridgeTokens;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) {
    const compactTokens = compactOptionTextTokens(normalized, options);
    if (compactTokens.length)
      return compactTokens;
  }
  const identityTokens = tokens.length > 2 && !options.keepSecondaryTokens ? tokens.filter(token => !isSecondaryOptionToken(token)) : tokens;
  return uniqueValues(identityTokens.length ? identityTokens : [optionName]);
}

function parserSafeRuntimeBridgeOptionTextTokens(text: string, options: { parserSafeRuntimeBridge?: boolean } = {}) {
  const rangeMatch = bestCompactIpRangeMatch(text);
  if (!options.parserSafeRuntimeBridge || !rangeMatch)
    return undefined;
  const prefixTokens = text.slice(0, rangeMatch.index).trim().split(/\s+/).filter(Boolean);
  const suffixTokens = text.slice(rangeMatch.index + rangeMatch.text.length).trim().split(/\s+/).filter(Boolean);
  const compactRange = rangeMatch.text.replace(/\s+/g, '');
  const orderedTokens = [...prefixTokens, compactRange, ...suffixTokens].filter(Boolean);
  const compact = text.replace(/\s+/g, '');
  if (!orderedTokens.some(isSecondaryOptionToken))
    return compact && compact !== text ? [compact] : undefined;
  if (!compact)
    return undefined;
  return [compact];
}

function isSecondaryOptionToken(token: string) {
  return /^(共享|独享|shared|dedicated)$/i.test(token);
}

function compactOptionTextTokens(text: string, options: { keepSecondaryTokens?: boolean } = {}) {
  const rangeMatch = bestCompactIpRangeMatch(text);
  if (!rangeMatch)
    return [];
  const prefix = text.slice(0, rangeMatch.index).trim();
  const suffix = text.slice(rangeMatch.index + rangeMatch.text.length).trim();
  return uniqueValues([
    prefix,
    rangeMatch.text.replace(/\s+/g, ''),
    suffix && (options.keepSecondaryTokens || !isSecondaryOptionToken(suffix)) ? suffix : undefined,
  ].filter(Boolean) as string[]);
}

function bestCompactIpRangeMatch(text: string) {
  const candidates: Array<{ text: string; index: number; score: number }> = [];
  for (let index = 0; index < text.length; index++) {
    const match = text.slice(index).match(/^((?:\d{1,3}\.){3}\d{1,3})\s*(?:--|~|至|到|-)\s*((?:\d{1,3}\.){3}\d{1,3})/);
    if (!match)
      continue;
    const start = ipAddressValue(match[1]);
    const end = ipAddressValue(match[2]);
    if (start === undefined || end === undefined)
      continue;
    const rangeText = match[0];
    const prefix = text.slice(0, index).trim();
    const suffix = text.slice(index + rangeText.length).trim();
    candidates.push({
      text: rangeText,
      index,
      score: (start <= end ? 100 : 0) + (prefix ? 10 : 0) + (isSecondaryOptionToken(suffix) ? 5 : 0) - index / 1000,
    });
  }
  return candidates.sort((left, right) => right.score - left.score)[0];
}

function ipAddressValue(address: string) {
  const parts = address.split('.').map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255))
    return undefined;
  return parts.reduce((value, part) => value * 256 + part, 0);
}

function popupOptionName(step: FlowStep) {
  const action = rawAction(step.rawAction);
  return generatedTextCandidate(
      step.target?.text,
      step.target?.name,
      step.target?.displayName,
      step.context?.before.target?.text,
      action.text,
      action.value,
      textFromInternalTextSelector(action.selector),
  );
}

function rawSelectOptionClickSource(step: FlowStep) {
  const optionLocator = antdSelectOptionLocator(step);
  if (!optionLocator)
    return undefined;
  return antdSelectOptionClickSource(step, optionLocator);
}

function antdSelectOptionParserSafeSource(step: FlowStep, options: EmitStepOptions = {}) {
  const field = antdSelectFieldLocator(step);
  const optionName = antdSelectOptionName(step);
  if (!field || !optionName)
    return rawSelectOptionParserSafeSource(step) || `await ${parserSafeLocator(antdSelectOptionLocator(step) || activeDropdownOptionLocator(step) || 'page.locator(".ant-select-item-option")')}.click();`;
  const trigger = parserSafeLocator(field);
  const input = `${trigger}.locator(${stringLiteral('input:visible')})`;
  const value = stringLiteral(parserSafeSelectSearchTextForStep(step, optionName));
  const optionLocator = antdSelectOptionLocator(step, options) || activeDropdownOptionLocator(step, options);
  if (!optionLocator && !isAntdProjectedSelectStep(step))
    return rawSelectOptionParserSafeSource(step) || `await ${parserSafeLocator('page.locator(".ant-select-item-option")')}.click();`;
  const parserSafeOptionLocator = optionLocatorWithTextTokens(
      `page.locator("${activeSelectDropdownSelector({ parserSafe: true })} .ant-select-item-option")`,
      optionName,
      { parserSafeRuntimeBridge: true },
  );
  const previousStepTargetsField = previousStepAlreadyTargetsAntdSelectField(options.previousStep, step);
  const lines = [
    `await ${parserSafeLocator(parserSafeOptionLocator)}.click();`,
  ];
  if (shouldParserSafeSearchAntdSelectOption(step, optionName) && !previousStepTargetsField)
    lines.unshift(`await ${input}.fill(${value});`);
  if (!previousStepTargetsField)
    lines.unshift(`await ${trigger}.click();`);
  return lines.join('\n');
}

function shouldParserSafeSearchAntdSelectOption(step: FlowStep, optionName: string) {
  if (projectedSelectSearchText(step, optionName))
    return true;
  // AntD/ProComponents ReactNode labels (for example, an IPv4 pool label with a custom
  // `searchText` prop) can render correctly in the open dropdown while typing the primary
  // token filters the list to "No data". In those compound-label cases the token-filtered
  // active dropdown click is more reliable than an extra search fill.
  return !bestCompactIpRangeMatch(optionName);
}

function parserSafeSelectSearchText(optionName: string) {
  const tokens = optionTextTokens(optionName).filter(token => !bestCompactIpRangeMatch(token));
  return tokens[0] || optionTextTokens(optionName)[0] || optionName;
}

function parserSafeSelectSearchTextForStep(step: FlowStep, optionName: string) {
  return projectedSelectSearchText(step, optionName) || parserSafeSelectSearchText(optionName);
}

function projectedSelectSearchText(step?: FlowStep, selectedOptionText?: string) {
  if (!step || (step.action !== 'select' && !selectedOptionText))
    return undefined;
  const recipeSearchText = recipeOptionSearchText(buildRecipeForStep(step));
  return normalizeGeneratedText(recipeSearchText || rawAction(step.rawAction).searchText || '') || inferredOwnedSelectSearchText(step, selectedOptionText);
}

function inferredOwnedSelectSearchText(step: FlowStep, selectedOptionText?: string) {
  const optionText = generatedTextCandidate(
      selectedOptionText,
      rawAction(step.rawAction).selectedText,
      step.uiRecipe?.optionText,
      step.value,
      step.context?.before.target?.selectedOption,
      step.context?.before.target?.text,
      step.context?.before.target?.normalizedText,
  );
  if (!optionText || bestCompactIpRangeMatch(optionText))
    return undefined;
  const prefixMatch = optionText.match(/^([^:：]{2,})[:：](.+)$/);
  const prefix = normalizeGeneratedText(prefixMatch?.[1] || '');
  const suffix = normalizeGeneratedText(prefixMatch?.[2] || '');
  if (prefix && suffix && !/\d/.test(prefix) && /\d/.test(suffix) && !bestCompactIpRangeMatch(suffix))
    return suffix;
  return prefix;
}

function previousStepAlreadyTargetsAntdSelectField(previousStep: FlowStep | undefined, optionStep: FlowStep) {
  if (!previousStep || !sameFieldIdentityIgnoringDialog(previousStep, optionStep))
    return false;
  const source = previousStep.sourceCode || JSON.stringify(rawAction(previousStep.rawAction));
  const role = previousStep.target?.role || previousStep.context?.before.target?.role || '';
  const controlType = previousStep.context?.before.target?.controlType || String((previousStep.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  const targetsAntdSelect = role === 'combobox' || /^(select|tree-select|cascader)$/.test(controlType) || /ant-select-selector/.test(source);
  return targetsAntdSelect && (previousStep.action === 'click' || previousStep.action === 'fill');
}

function rawSelectOptionParserSafeSource(step: FlowStep) {
  const optionLocator = antdSelectOptionLocator(step, { parserSafe: true });
  return optionLocator ? `await ${optionLocator}.click();` : undefined;
}

function projectedAntdSelectOptionSource(step: FlowStep, options: EmitStepOptions = {}) {
  const recipe = buildRecipeForStep(step);
  if (!isRecipeBackedAntdSelectOption(recipe) && !isAntdProjectedSelectStep(step))
    return undefined;
  const triggerLocator = antdSelectFieldLocator(step);
  const optionName = recipeOptionText(recipe) || antdSelectOptionName(step);
  if (!triggerLocator || !optionName)
    return undefined;
  if (options.parserSafe)
    return antdSelectOptionParserSafeSource(step, options);
  return renderAntdSelectOptionClickSource(triggerLocator, antdSelectOptionLocator(step) || activeDropdownOptionLocator(step) || 'page.locator(".ant-select-item-option")', optionName, recipeOptionSearchText(recipe) || projectedSelectSearchText(step, optionName));
}

function inheritedOptionClickSourceFromPreviousStep(step: FlowStep, previousStep: FlowStep | undefined, options: EmitStepOptions = {}) {
  const recordedActiveDropdownSource = isRecordedActiveAntdSelectOptionSource(step.sourceCode || '');
  const previousLooksLikeSelectTrigger = !!previousStep && (isAntdSelectFieldStep(previousStep) || (recordedActiveDropdownSource && !!antdSelectFieldLocator(previousStep)));
  if (!previousStep || !previousLooksLikeSelectTrigger || !isContextlessOptionTextClickAfterSelect(step, previousStep, selectQueryForStep(previousStep)))
    return undefined;
  const inheritedStep = inheritedAntdSelectOptionStep(step, previousStep, selectQueryForStep(previousStep));
  const selectOption = antdSelectOptionLocator(inheritedStep) || activeDropdownOptionLocator(inheritedStep);
  if (!selectOption)
    return undefined;
  return options.parserSafe ? antdSelectOptionParserSafeSource(inheritedStep, options) : antdSelectOptionClickSource(inheritedStep, selectOption);
}

function parserSafeLocator(locator: string) {
  return locator
      .replace(/\.locator\((["'])\.ant-select-selector, \.ant-cascader-picker, \.ant-select\1\)\.(?:first|last)\(\)/g, '.locator($1.ant-select-selector, .ant-cascader-picker$1)')
      .replace(/\.locator\((["'])\.ant-select-selector, \.ant-cascader-picker, \.ant-cascader\1\)\.(?:first|last)\(\)/g, '.locator($1.ant-select-selector, .ant-cascader-picker$1)')
      .replace(/\.(?:first|last)\(\)/g, '');
}

function antdSelectOptionClickSource(step: FlowStep | undefined, optionLocator: string) {
  const triggerLocator = step ? antdSelectTriggerLocator(step) : `page.locator(".ant-select-selector").last()`;
  const optionName = step ? antdSelectOptionName(step) : undefined;
  return renderAntdSelectOptionClickSource(triggerLocator, optionLocator, optionName, optionName ? projectedSelectSearchText(step, optionName) : undefined);
}

function antdSelectOptionName(step: FlowStep) {
  const recipeText = recipeOptionText(buildRecipeForStep(step));
  if (recipeText)
    return recipeText;
  const contextTarget = step.context?.before.target;
  const rawTitle = rawSelectOptionTitle(step);
  const recordedOptionText = recordedActiveDropdownOptionTextFromSource(step.sourceCode || '');
  const action = rawAction(step.rawAction);
  if (step.action === 'select') {
    return generatedTextCandidate(
        step.value,
        action.selectedText,
        step.uiRecipe?.optionText,
        contextTarget?.selectedOption,
        contextTarget?.optionPath?.[contextTarget.optionPath.length - 1],
        recordedOptionText,
        rawTitle,
        step.target?.text,
        step.target?.name,
        step.target?.displayName,
        contextTarget?.title,
        contextTarget?.text,
        contextTarget?.normalizedText,
        contextTarget?.ariaLabel,
    );
  }
  return generatedTextCandidate(
      contextTarget?.title,
      contextTarget?.selectedOption,
      contextTarget?.optionPath?.[contextTarget.optionPath.length - 1],
      contextTarget?.text,
      contextTarget?.normalizedText,
      contextTarget?.ariaLabel,
      step.uiRecipe?.optionText,
      action.selectedText,
      step.target?.text,
      step.target?.name,
      step.target?.displayName,
      rawTitle,
      recordedOptionText,
  );
}

function recordedActiveDropdownOptionTextFromSource(sourceCode: string) {
  if (!isRecordedActiveAntdSelectOptionSource(sourceCode))
    return undefined;
  const match = sourceCode.match(/\.filter\(\{\s*hasText:\s*(["'])([\s\S]*?)\1\s*\}\)/);
  return match?.[2]?.replace(/\\(["'\\])/g, '$1');
}

function antdSelectTriggerLocator(step: FlowStep) {
  return antdSelectFieldLocator(step) || `page.locator(".ant-select-selector").last()`;
}

function antdSelectFieldLocator(step: FlowStep) {
  const targetTestId = step.target?.testId || step.context?.before.target?.testId;
  const label = step.context?.before.form?.label ||
    step.target?.scope?.form?.label ||
    step.target?.label ||
    popupFieldLabelFromName(step.target?.name || step.target?.text || step.target?.displayName);
  if (targetTestId) {
    const testIdLocator = `page.getByTestId(${stringLiteral(targetTestId)})`;
    return isContainerTestIdForSelectField(targetTestId) ? selectFieldLocatorWithinRoot(testIdLocator, label) || `${testIdLocator}.locator(${stringLiteral('.ant-select-selector, .ant-cascader-picker, .ant-select')}).first()` : testIdLocator;
  }
  const formTestId = step.context?.before.form?.testId || step.target?.scope?.form?.testId;
  if (formTestId) {
    const formRoot = `page.getByTestId(${stringLiteral(formTestId)})`;
    return isContainerTestIdForSelectField(formTestId) ? selectFieldLocatorWithinRoot(formRoot, label) || `${formRoot}.locator(${stringLiteral('.ant-select-selector, .ant-cascader-picker, .ant-select')}).first()` : `${formRoot}.locator(${stringLiteral('.ant-select-selector, .ant-cascader-picker, .ant-select')}).first()`;
  }
  if (!label)
    return undefined;
  const dialog = selectTriggerDialog(step);
  const root = dialogRootLocator(dialog);
  return selectFieldLocatorWithinRoot(root, label);
}

function selectFieldLocatorWithinRoot(root: string, label: string | undefined) {
  if (!label)
    return undefined;
  return `${root}.locator(${stringLiteral('.ant-form-item')}).filter({ hasText: ${stringLiteral(formItemSearchText(label))} }).locator(${stringLiteral('.ant-select-selector, .ant-cascader-picker, .ant-select')}).first()`;
}

function isContainerTestIdForSelectField(testId: string) {
  return /(modal|drawer|dialog|form)$/i.test(testId) || looksLikeStructuralContainerTestId(testId);
}

function formItemSearchText(label: string) {
  return normalizeRequiredLabel(label) || label;
}

function normalizeRequiredLabel(label: string) {
  return label.replace(/^\s*\*\s*/, '').trim();
}

function dialogRootLocator(dialog?: FlowDialogScope) {
  if (dialog?.testId)
    return `page.getByTestId(${stringLiteral(dialog.testId)})`;
  if (dialog?.title)
    return `page.locator(${stringLiteral(dialogRootSelector(dialog))}).filter({ hasText: ${stringLiteral(dialog.title)} })`;
  return 'page';
}

function selectTriggerDialog(step: FlowStep) {
  const scoped = step.target?.scope?.dialog;
  if ((scoped?.title || scoped?.testId) && scoped.type !== 'dropdown')
    return scoped;
  const before = step.context?.before.dialog;
  if ((before?.title || before?.testId) && before.type !== 'dropdown')
    return before;
  const after = step.context?.after?.dialog;
  if ((after?.title || after?.testId) && after.type !== 'dropdown')
    return after;
  return undefined;
}

function antdPopupOptionClickSource(step: FlowStep, locator: string, options: { stabilizeAfterClickMs?: number; clickFirstMatch?: boolean } = {}) {
  return renderAntdPopupOptionClickSource(locator, popupOptionName(step), popupOptionTriggerLocator(step), options);
}

function popupOptionTriggerLocator(step: FlowStep) {
  return antdSelectFieldLocator(step) || popupOptionTriggerLocatorFromHint(step);
}

function popupOptionTriggerLocatorFromHint(step: FlowStep) {
  const hint = popupTriggerHint(step);
  if (!hint)
    return undefined;
  const root = dialogRootLocator(selectTriggerDialog(step));
  return `${root}.locator(${stringLiteral('.ant-form-item')}).filter({ hasText: ${stringLiteral(formItemSearchText(hint))} }).locator(${stringLiteral('.ant-select-selector, .ant-cascader-picker, .ant-cascader')}).first()`;
}

function popupTriggerHint(step: FlowStep) {
  const direct = generatedTextCandidate(step.context?.before.form?.label, step.target?.scope?.form?.label, step.target?.label);
  if (direct)
    return direct;
  const toast = generatedTextCandidate(step.context?.after?.toast);
  if (!toast)
    return undefined;
  const stripped = toast.replace(/^请?选择(?:一个)?/, '').trim();
  return stripped || toast;
}

function rawSelectOptionTitle(step: FlowStep) {
  const selector = rawAction(step.rawAction).selector || step.target?.selector || step.target?.locator || '';
  const match = selector.match(/internal:attr=\[title=(?:\\"|\")([^\\"]+)(?:\\"|")(?:i|s)?\]/) || selector.match(/\[title=["']([^"']+)["']\]/);
  return match?.[1];
}

function globalTestIdLocator(step: FlowStep) {
  const table = step.target?.scope?.table || step.context?.before.table;
  const tableHasStableRow = !!(table?.rowKey || table?.rowIdentity?.stable);
  if (step.target?.testId) {
    if (tableHasStableRow && step.target.testId === table?.testId)
      return undefined;
    return scopedOrGlobalTestIdLocator(step, step.target.testId, 'target');
  }
  const contextControlType = step.context?.before.target?.controlType || '';
  const contextDialogType = step.context?.before.dialog?.type;
  if (/(select|tree-select|cascader)-option/.test(contextControlType) || contextDialogType === 'dropdown')
    return undefined;
  const testId = step.context?.before.target?.testId;
  if (testId) {
    if (tableHasStableRow && testId === table?.testId)
      return undefined;
    return scopedOrGlobalTestIdLocator(step, testId, 'context');
  }
  return undefined;
}

function scopedOrGlobalTestIdLocator(step: FlowStep, testId: string, source: 'target' | 'context') {
  const rowScoped = rowScopedActionTestIdLocator(step, testId);
  if (rowScoped)
    return rowScoped;
  const ownDialog = step.target?.scope?.dialog || step.context?.before.dialog;
  if (step.action === 'click' && ownDialog?.testId === testId && !dialogOpenedByThisStep(step, ownDialog))
    return undefined;
  if (step.action === 'click' && looksLikeOverlayRootClickTestId(step, testId))
    return undefined;
  const dialog = step.action === 'click' ? testIdDialogScope(step) : undefined;
  if (dialog && !looksLikeDialogOwnedTestId(testId))
    return `${dialogRootLocator(dialog)}.getByTestId(${stringLiteral(testId)})`;
  const ancestorScoped = ancestorScopedTestIdLocator(step, testId, source);
  if (ancestorScoped)
    return ancestorScoped;
  return testIdLocatorWithOrdinal(step, testId, source);
}

function testIdSourceForStep(step: FlowStep, testId: string): 'target' | 'context' {
  return step.target?.testId === testId ? 'target' : 'context';
}

function ancestorScopedTestIdLocator(step: FlowStep, testId: string, source: 'target' | 'context') {
  if (duplicatePageIndex(step, testId, source) === undefined)
    return undefined;
  const ancestor = step.target?.scope?.ancestor || step.context?.before.ancestor;
  if (!ancestor?.testId || ancestor.testId === testId)
    return undefined;
  const root = ancestorRootLocator(ancestor);
  if (!root)
    return undefined;
  return `${root}.getByTestId(${stringLiteral(testId)})`;
}

function ancestorRootLocator(ancestor: FlowAncestorScope) {
  if (!ancestor.testId)
    return undefined;
  const attributes = Object.entries(ancestor.attributes || {}).filter(([key, value]) => /^data-[\w-]+$/.test(key) && !!value);
  if (!attributes.length)
    return undefined;
  const attributeSelector = attributes
      .map(([key, value]) => `[${key}="${cssAttributeValue(value)}"]`)
      .join('');
  const testId = cssAttributeValue(ancestor.testId);
  return `page.locator(${stringLiteral([
    `[data-testid="${testId}"]${attributeSelector}`,
    `[data-test-id="${testId}"]${attributeSelector}`,
    `[data-e2e="${testId}"]${attributeSelector}`,
  ].join(', '))})`;
}

function looksLikeOverlayRootClickTestId(step: FlowStep, testId: string) {
  if (isDialogOpenerTestIdClick(step, testId))
    return false;
  if (!/(^|[-_])(modal|drawer|dialog|popup|popover|overlay|form)([-_]|$)/i.test(testId))
    return false;
  return hasNonTestIdTargetText(step, testId);
}

function testIdDialogScope(step: FlowStep) {
  const scoped = step.target?.scope?.dialog;
  if (scoped && isPersistentDialog(scoped) && !dialogOpenedByThisStep(step, scoped))
    return scoped;
  const before = step.context?.before.dialog;
  if (before && isPersistentDialog(before) && !dialogOpenedByThisStep(step, before))
    return before;
  return undefined;
}

function dialogOpenedByThisStep(step: FlowStep, dialog: FlowDialogScope) {
  if (step.action !== 'click')
    return false;
  const opened = openedDialogAfterStep(step);
  if (isPersistentDialog(opened) && sameDialogScope(opened, dialog) && !sameDialogScope(step.context?.before.dialog, dialog))
    return true;
  const dialogTitle = normalizeGeneratedText(dialog.title || '');
  const label = normalizeGeneratedText(step.target?.name || step.target?.text || step.target?.displayName || step.target?.label || step.context?.before.target?.text || step.context?.before.target?.normalizedText);
  if (!dialogTitle)
    return false;
  const testId = step.target?.testId || step.context?.before.target?.testId || '';
  const openerHint = `${testId} ${label || ''}`;
  if (!isPersistentDialog(step.context?.before.dialog) && looksLikeDialogOpenerTestId(testId))
    return true;
  return (/新建|创建|添加|新增|打开|编辑/i.test(openerHint) || looksLikeDialogOpenerTestId(testId)) &&
    (!!label && (dialogTitle.includes(label) || label.includes(dialogTitle)));
}

function testIdLocatorWithOrdinal(step: FlowStep, testId: string, source: 'target' | 'context') {
  const locator = `page.getByTestId(${stringLiteral(testId)})`;
  if (shouldIgnoreDuplicateOrdinalForStableControl(step, testId))
    return locator;
  const pageIndex = duplicatePageIndex(step, testId, source);
  return pageIndex === undefined ? locator : `${locator}.nth(${pageIndex})`;
}

function shouldIgnoreDuplicateOrdinalForStableControl(step: FlowStep, testId: string) {
  if (isReusableRowActionTestId(testId) || /(^|[-_])(button|btn|save|delete|remove|edit|confirm|cancel|submit|ok)([-_]|$)/i.test(testId))
    return false;
  const role = step.target?.role || step.context?.before.target?.role || '';
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  return /^(combobox|textbox|spinbutton)$/i.test(role) || /^(select|tree-select|cascader|input|textarea|number)$/i.test(controlType) || /(^|[-_])(select|input|field|cascader)([-_]|$)/i.test(testId);
}

function rowScopedActionTestIdLocator(step: FlowStep, testId: string) {
  if (step.action !== 'click' || !looksLikeActionTestId(testId))
    return undefined;
  if (!isReusableRowActionTestId(testId))
    return undefined;
  const table = step.target?.scope?.table || step.context?.before.table;
  if (table?.testId) {
    const rowLocator = tableRowLocatorExpression(table, testIdDialogScope(step));
    if (rowLocator)
      return `${rowLocator}.getByTestId(${stringLiteral(testId)})`;
  }
  const fallbackRowText = fallbackRowActionText(step, testId);
  if (fallbackRowText) {
    const root = testIdDialogScope(step) ? dialogRootLocator(testIdDialogScope(step)) : 'page';
    return `${root}.locator(${stringLiteral(rowActionContainerSelector())}).filter({ hasText: ${rowTextRegexLiteral(fallbackRowText)} }).getByTestId(${stringLiteral(testId)}).first()`;
  }
  return undefined;
}

function fallbackRowActionText(step: FlowStep, testId: string) {
  const value = generatedTextCandidate(
      step.target?.scope?.table?.rowText,
      step.context?.before.table?.rowText,
      step.target?.scope?.table?.rowIdentity?.value,
      step.context?.before.table?.rowIdentity?.value,
      step.target?.name,
      step.target?.text,
      step.target?.displayName,
      step.context?.before.target?.ariaLabel,
      step.context?.before.target?.normalizedText,
      step.context?.before.target?.text,
  );
  if (!value)
    return undefined;
  const stripped = value.replace(new RegExp(escapeRegExp(testId), 'g'), '').replace(/^(button|link|操作|action)\s*/i, '').trim();
  if (/^(确定|确 定|OK|Yes|Confirm|保存|应用|删除|移除|编辑)$/i.test(stripped))
    return undefined;
  return stripped && stripped !== testId ? stripped : undefined;
}

function rowActionContainerSelector() {
  return 'tr, [role="row"], .ant-table-row, .ant-list-item, .ant-descriptions-row, .ant-space, .ant-card, .ant-table-cell';
}

function isReusableRowActionTestId(testId: string) {
  return /(^|[-_])(row|list-item|table-row)[-_].*[-_](edit|delete|remove|action)([-_]|$)/i.test(testId) ||
    /(^|[-_])(edit|delete|remove)[-_]action$/i.test(testId);
}

function tableRowLocatorExpression(table: NonNullable<FlowTableScope>, dialog?: FlowDialogScope) {
  const root = dialog ? dialogRootLocator(dialog) : 'page';
  const tableLocator = `${root}.getByTestId(${stringLiteral(table.testId)})`;
  const stableRowValue = table.rowKey || (table.rowIdentity?.stable ? table.rowIdentity.value : undefined);
  if (stableRowValue) {
    const rowSelector = `tr[data-row-key="${stableRowValue}"], [data-row-key="${stableRowValue}"]`;
    return `${tableLocator}.locator(${stringLiteral(rowSelector)}).first()`;
  }
  const fallbackRowText = table.rowIdentity?.value || table.rowText;
  if (!fallbackRowText)
    return undefined;
  return `${tableLocator}.locator(${stringLiteral('tr, [role="row"]')}).filter({ hasText: ${stringLiteral(fallbackRowText)} }).first()`;
}

function duplicateRoleLocator(step: FlowStep) {
  const pageIndex = duplicatePageIndex(step);
  if (pageIndex === undefined)
    return undefined;
  const role = step.target?.role || step.context?.before.target?.role || (looksLikeButtonText(step) ? 'button' : undefined);
  if (!role)
    return undefined;
  const name = generatedTextCandidate(step.target?.name, step.target?.text, step.target?.displayName, step.context?.before.target?.ariaLabel, step.context?.before.target?.text);
  if (!name)
    return undefined;
  const actionName = normalizeGeneratedText(name)?.replace(/^(button|link)\s+/i, '').trim() || name;
  if (isLikelyDialogConfirmButton(actionName) || /(?:^|\b)(delete|remove)(?:\b|$)|删除|移除/i.test(actionName))
    return undefined;
  return `page.getByRole(${stringLiteral(role)}, ${roleNameOptionsSource(step, role, name)}).nth(${pageIndex})`;
}

function shouldPreferParserSafeDuplicateRole(step: FlowStep) {
  const role = step.target?.role || step.context?.before.target?.role;
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  return role === 'button' || (!role && controlType === 'button');
}

function looksLikeButtonText(step: FlowStep) {
  const testId = step.target?.testId || step.context?.before.target?.testId || '';
  const text = generatedTextCandidate(step.target?.text, step.target?.name, step.target?.displayName, step.context?.before.target?.text) || '';
  return /button|btn|save|submit|confirm|cancel|create|add|edit|delete/i.test(testId) || /保存|确定|取消|新建|编辑|删除|提交/.test(text);
}

function duplicatePageIndex(step: FlowStep, expectedTestId?: string, source: 'target' | 'context' = 'context') {
  const hints = [
    step.target?.locatorHint,
    source === 'context' && (!expectedTestId || step.context?.before.target?.testId === expectedTestId) ? step.context?.before.target?.uniqueness : undefined,
    expectedTestId && rawTargetTestId(step.target?.raw) !== expectedTestId ? undefined : uniquenessFromRawTarget(step.target?.raw),
  ];
  for (const hint of hints) {
    const pageCount = Number(hint?.pageCount);
    const pageIndex = Number(hint?.pageIndex);
    if (Number.isInteger(pageIndex) && pageIndex >= 0 && Number.isFinite(pageCount) && pageCount > 1)
      return pageIndex;
  }
  return undefined;
}

function rawTargetTestId(raw: unknown) {
  if (!raw || typeof raw !== 'object')
    return undefined;
  return (raw as { testId?: unknown; pageContext?: { testId?: unknown } }).pageContext?.testId || (raw as { testId?: unknown }).testId;
}

function uniquenessFromRawTarget(raw: unknown) {
  if (!raw || typeof raw !== 'object')
    return undefined;
  const record = raw as { uniqueness?: { pageCount?: number; pageIndex?: number }; pageContext?: { uniqueness?: { pageCount?: number; pageIndex?: number } } };
  return record.pageContext?.uniqueness || record.uniqueness;
}

function tableScopedLocator(step: FlowStep) {
  const table = step.target?.scope?.table || step.context?.before.table;
  const targetName = targetNameForLocator(step);
  const role = step.target?.role || step.context?.before.target?.role || 'button';
  if (!table?.testId || !targetName)
    return undefined;

  const rowIdentity = table.rowIdentity;
  const stableRowValue = table.rowKey || (rowIdentity?.stable ? rowIdentity.value : undefined);
  if (stableRowValue) {
    const rowSelector = `tr[data-row-key="${stableRowValue}"], [data-row-key="${stableRowValue}"]`;
    const rowLocator = `page.getByTestId(${stringLiteral(table.testId)}).locator(${stringLiteral(rowSelector)})`;
    if (role === 'row' || role === 'cell' || role === 'gridcell' || isRowContainerClick(step, targetName, table))
      return `${rowLocator}.first()`;
    const roleNameOptions = roleNameOptionsSource(step, role, targetName);
    return rowLocator +
      `.filter({ has: page.getByRole(${stringLiteral(role)}, ${roleNameOptions}) })` +
      `.first()` +
      `.getByRole(${stringLiteral(role)}, ${roleNameOptions})`;
  }

  const fallbackRowText = rowIdentity?.value || table.rowText;
  if (fallbackRowText) {
    const rowLocator = `page.getByTestId(${stringLiteral(table.testId)})` +
      `.locator(${stringLiteral('tr, [role="row"]')})` +
      `.filter({ hasText: ${stringLiteral(fallbackRowText)} })`;
    if (role === 'row')
      return `${rowLocator}.first()`;
    return `${rowLocator}.getByRole(${stringLiteral(role)}, ${roleNameOptionsSource(step, role, targetName)})`;
  }
  return undefined;
}

function isRowContainerClick(step: FlowStep, targetName: string, table: NonNullable<FlowTableScope>) {
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  if (/^(button|link|checkbox|radio|switch|select|input|textarea)$/i.test(controlType))
    return false;
  const rowText = normalizeComparableText(table.rowText || table.rowIdentity?.value || '');
  const name = normalizeComparableText(targetName);
  return !!rowText && !!name && name.includes(rowText);
}

function dialogScopedLocator(step: FlowStep) {
  const dialog = step.target?.scope?.dialog || step.context?.before.dialog;
  const targetName = targetNameForLocator(step);
  if (!dialog || !targetName)
    return undefined;
  const role = dialog.type === 'popover' && step.target?.role === 'tooltip' ? 'button' : step.target?.role || 'button';
  const nameOptions = roleNameOptionsSource(step, role, targetName);
  if (dialog.testId)
    return `page.getByTestId(${stringLiteral(dialog.testId)}).getByRole(${stringLiteral(role)}, ${nameOptions})`;
  if (dialog.type === 'popover')
    return `page.locator(${stringLiteral(dialogRootSelector(dialog))}).last().getByRole(${stringLiteral(role)}, ${nameOptions})`;
  if (!dialog.title)
    return undefined;
  return `page.locator(${stringLiteral(dialogRootSelector(dialog))})` +
    `.filter({ hasText: ${stringLiteral(dialog.title)} })` +
    `.getByRole(${stringLiteral(role)}, ${nameOptions})`;
}

function dialogRootSelector(dialog?: FlowDialogScope) {
  if (dialog?.type === 'popover')
    return '.ant-popover:not(.ant-popover-hidden):not(.ant-zoom-big-leave):not(.ant-zoom-big-leave-active)';
  if (dialog?.type === 'dropdown')
    return '.ant-dropdown, .ant-select-dropdown, .ant-cascader-dropdown, [role="listbox"], [role="menu"]';
  if (dialog?.type === 'drawer')
    return '.ant-drawer, [role="dialog"]';
  return '.ant-modal, .ant-drawer, [role="dialog"]';
}

function popconfirmRootSelector() {
  return `${dialogRootSelector({ type: 'popover', visible: true })}:has(.ant-popconfirm-buttons)`;
}

function sectionScopedLocator(step: FlowStep) {
  const section = step.target?.scope?.section || step.context?.before.section;
  const targetName = targetNameForLocator(step);
  if (!section?.testId || !targetName)
    return undefined;
  const role = step.target?.role || 'button';
  return `page.getByTestId(${stringLiteral(section.testId)}).getByRole(${stringLiteral(role)}, ${roleNameOptionsSource(step, role, targetName)})`;
}

function choiceControlLocator(step: FlowStep) {
  if (step.action !== 'click' && step.action !== 'check' && step.action !== 'uncheck')
    return undefined;
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  if (!isChoiceControlKind(controlType, step.target?.role || step.context?.before.target?.role || '') && !isStructuralLabelChoiceClick(step))
    return undefined;
  const text = choiceControlText(step);
  if (!text)
    return undefined;
  const dialog = selectTriggerDialog(step);
  const base = dialog?.title ? `page.getByRole('dialog', { name: ${stringLiteral(dialog.title)} })` : 'page';
  return `${base}.locator('label').filter({ hasText: ${stringLiteral(text)} })`;
}

function isStructuralLabelChoiceClick(step: FlowStep) {
  if (step.action !== 'click')
    return false;
  const text = choiceControlText(step);
  if (!text)
    return false;
  const testId = step.target?.testId || step.context?.before.target?.testId || '';
  if (!testId || !looksLikeLabelChoiceContainerTestId(testId) || looksLikeActionTestId(testId))
    return false;
  const source = `${step.sourceCode || ''}\n${JSON.stringify(rawAction(step.rawAction))}\n${step.target?.selector || ''}\n${step.target?.locator || ''}`;
  return /getByLabel\(["'`]/.test(source) || /internal:text=/.test(source) || /locator\(["']label["']\)\.filter\(\{\s*hasText\s*:/.test(source);
}

function looksLikeLabelChoiceContainerTestId(testId: string) {
  return looksLikeStructuralContainerTestId(testId) || /(^|[-_])form([-_]|$)/i.test(testId);
}

function isChoiceControlKind(controlType?: string, role?: string) {
  return /^(checkbox|radio|switch)$/.test(controlType || '') || /^(checkbox|radio|switch)$/.test(role || '');
}

function choiceControlText(step: FlowStep) {
  return generatedTextCandidate(
      step.context?.before.target?.text,
      step.context?.before.target?.normalizedText,
      step.context?.before.target?.ariaLabel,
      step.uiRecipe?.targetText,
      step.target?.text,
      step.target?.name,
      step.target?.displayName,
      step.target?.label,
  );
}

function fillTestIdLocator(step: FlowStep) {
  return renderInputFillTestIdLocator(step, inputFieldLocatorHooks);
}

function fieldLocator(step: FlowStep, options: { allowSelectLike?: boolean } = {}) {
  return renderInputFieldLocator(step, inputFieldLocatorHooks, options);
}

function globalRoleLocator(step: FlowStep) {
  const targetName = targetNameForLocator(step);
  const role = step.target?.role || step.context?.before.target?.role;
  const pageCount = step.target?.locatorHint?.pageCount ?? step.context?.before.target?.uniqueness?.pageCount;
  if (pageCount && pageCount > 1)
    return undefined;
  if (role && targetName)
    return `page.getByRole(${stringLiteral(role)}, ${roleNameOptionsSource(step, role, targetName)})`;
  return undefined;
}

function fallbackTextLocator(step: FlowStep) {
  const text = step.target?.text || step.target?.displayName || step.target?.name;
  return text ? `page.getByText(${stringLiteral(text)})` : undefined;
}

function targetNameForLocator(step: FlowStep) {
  return step.target?.name || step.target?.text || step.target?.displayName;
}

function normalizeActionSource(sourceCode?: string) {
  return sourceCode
      ?.split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
}
