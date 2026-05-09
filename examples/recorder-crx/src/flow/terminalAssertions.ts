/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { BusinessFlow, FlowAssertion, FlowAssertionParams, FlowAssertionType, FlowStep } from './types';

export type TerminalStateAssertionType = Extract<FlowAssertionType,
  | 'row-exists'
  | 'row-not-exists'
  | 'modal-closed'
  | 'drawer-closed'
  | 'popover-closed'
  | 'selected-value-visible'
  | 'form-validation-visible'
  | 'toast-visible'
>;

export function createTerminalStateAssertion(type: TerminalStateAssertionType, id: string, params: FlowAssertionParams = {}, target?: FlowStep['target']): FlowAssertion {
  return {
    id,
    type,
    subject: subjectForTerminalState(type),
    target,
    expected: expectedForTerminalState(type, params),
    params: sanitizeTerminalAssertionParams(params),
    enabled: true,
  };
}

export function appendTerminalStateAssertions(flow: BusinessFlow): BusinessFlow {
  let changed = false;
  const steps = flow.steps.map((step, index) => {
    const suggestions = suggestTerminalStateAssertions(step, index, flow.steps[index - 1]);
    const missing = suggestions.filter(suggestion => !hasEquivalentAssertion(step.assertions, suggestion));
    if (!missing.length)
      return step;
    changed = true;
    return { ...step, assertions: [...step.assertions, ...missing] };
  });
  return changed ? { ...flow, steps, updatedAt: new Date().toISOString() } : flow;
}

export function suggestTerminalStateAssertions(step: FlowStep, stepIndex = 0, previousStep?: FlowStep): FlowAssertion[] {
  const suggestions: FlowAssertion[] = [];
  const beforeDialog = step.context?.before.dialog;
  const afterDialog = step.context?.after?.dialog;
  const selectedOption = step.context?.before.target?.selectedOption;
  const targetTestId = step.target?.testId || step.context?.before.target?.testId;

  const toast = step.context?.after?.toast;
  if (toast && isSubmitLikeStep(step) && isStableTerminalToast(toast))
    suggestions.push(createTerminalStateAssertion('toast-visible', terminalAssertionId(step.id, suggestions.length, stepIndex), { message: toast }));

  if (beforeDialog && afterDialog && beforeDialog.type === afterDialog.type && beforeDialog.visible && afterDialog.visible === false) {
    const type = dialogClosedType(beforeDialog.type);
    if (type)
      suggestions.push(createTerminalStateAssertion(type, terminalAssertionId(step.id, suggestions.length, stepIndex), compactParams({ title: beforeDialog.title, testId: beforeDialog.testId })));
  } else {
    const inferredClosed = inferClosedOverlayAssertion(step, stepIndex, suggestions.length);
    if (inferredClosed)
      suggestions.push(inferredClosed);
  }

  if (selectedOption && targetTestId && isMeaningfulSelectedValue(selectedOption, step)) {
    suggestions.push(createTerminalStateAssertion('selected-value-visible', terminalAssertionId(step.id, suggestions.length, stepIndex), {
      targetTestId,
      expected: selectedOption,
    }, step.target));
  } else {
    const selectedFromOptionClick = inferSelectedValueAssertion(step, previousStep, stepIndex, suggestions.length);
    if (selectedFromOptionClick)
      suggestions.push(selectedFromOptionClick);
  }

  const deleteTable = deletionTableScope(step, previousStep);
  if (isRowDeletionConfirmation(step, previousStep, deleteTable)) {
    suggestions.push(createTerminalStateAssertion('row-not-exists', terminalAssertionId(step.id, suggestions.length, stepIndex), compactParams({
      tableTestId: deleteTable?.testId,
      rowKey: deleteTable?.rowKey,
      rowKeyword: deleteTable?.rowText,
    }), step.target));
  }

  return suggestions;
}

export function sanitizeTerminalAssertionParams(params?: FlowAssertionParams): FlowAssertionParams | undefined {
  if (!params)
    return undefined;
  const allowed = new Set([
    'tableTestId',
    'tableSelector',
    'tableArea',
    'rowKey',
    'rowKeyword',
    'columnName',
    'columnValue',
    'columnText',
    'title',
    'testId',
    'targetTestId',
    'expected',
    'message',
    'fieldLabel',
    'timeout',
  ]);
  return compactParams(Object.fromEntries(Object.entries(params).filter(([key, value]) => {
    if (value === undefined || value === '')
      return false;
    if (/raw|diagnostic|private|secret|token|cookie|authorization|sourceCode|rawAction|dom/i.test(key))
      return false;
    return allowed.has(key);
  })) as FlowAssertionParams);
}

export function replayDiagnosticSummary(flow: BusinessFlow, options: { enabled?: boolean } = {}) {
  if (!options.enabled)
    return undefined;
  const terminalAssertions = flow.steps.flatMap(step => step.assertions
      .filter(assertion => isTerminalStateAssertionType(assertion.type))
      .map(assertion => ({ stepId: step.id, type: assertion.type, subject: assertion.subject })));
  return {
    schema: 'replay-diagnostics/v1',
    flowId: flow.flow.id,
    stepCount: flow.steps.length,
    terminalAssertions,
  };
}

export function isTerminalStateAssertionType(type: FlowAssertionType): type is TerminalStateAssertionType {
  return type === 'row-exists' ||
    type === 'row-not-exists' ||
    type === 'modal-closed' ||
    type === 'drawer-closed' ||
    type === 'popover-closed' ||
    type === 'selected-value-visible' ||
    type === 'form-validation-visible' ||
    type === 'toast-visible';
}

function subjectForTerminalState(type: TerminalStateAssertionType): FlowAssertion['subject'] {
  if (type === 'row-exists' || type === 'row-not-exists')
    return 'table';
  if (type === 'toast-visible')
    return 'toast';
  return 'element';
}

function expectedForTerminalState(type: TerminalStateAssertionType, params: FlowAssertionParams) {
  if (type === 'selected-value-visible')
    return stringParam(params.expected);
  if (type === 'toast-visible')
    return stringParam(params.message);
  if (type === 'form-validation-visible')
    return stringParam(params.message || params.expected);
  return stringParam(params.columnText || params.rowKeyword || params.rowKey || params.title);
}

function dialogClosedType(dialogType: string): TerminalStateAssertionType | undefined {
  if (dialogType === 'modal')
    return 'modal-closed';
  if (dialogType === 'drawer')
    return 'drawer-closed';
  if (dialogType === 'popover')
    return 'popover-closed';
  return undefined;
}

function isStableTerminalToast(message: string) {
  return !/成功|已保存|保存成功|创建成功|更新成功|success/i.test(message);
}

function isSubmitLikeStep(step: FlowStep) {
  if (step.action !== 'click')
    return false;
  const text = [step.target?.testId, step.target?.name, step.target?.text, step.target?.displayName, step.target?.label].filter(Boolean).join('|');
  return /save|submit|confirm|ok|保存|提交|确 定|确定|确认|完成/i.test(text);
}

function inferClosedOverlayAssertion(step: FlowStep, stepIndex: number, offset: number): FlowAssertion | undefined {
  const text = targetText(step);
  const testId = step.target?.testId;
  const dialog = step.target?.scope?.dialog || step.context?.before.dialog;
  const afterDialog = step.context?.after?.dialog;
  const openedDialog = step.context?.after?.openedDialog;
  if (openedDialog?.visible && (!dialog || !sameTerminalDialogScope(openedDialog, dialog)))
    return undefined;
  if (afterDialog?.visible && (!dialog || !sameTerminalDialogScope(afterDialog, dialog)))
    return undefined;
  const afterToast = step.context?.after?.toast;
  if (afterDialog?.visible && dialog && sameTerminalDialogScope(afterDialog, dialog) && afterToast && isStableTerminalToast(afterToast))
    return undefined;
  const joined = [text, testId].filter(Boolean).join('|');
  const confirmLike = /submit|confirm|cancel|ok|close|确 定|确定|确认|取消|关闭|保存/i.test(joined);
  const overlayOwnedActionTestId = /(^|[-_])(modal|drawer|popover|dialog)([-_].*)?(ok|confirm|submit|cancel|close|button)([-_]|$)/i.test(testId || '');
  if (dialog?.type && overlayOwnedActionTestId && confirmLike) {
    const type = dialogClosedType(dialog.type);
    if (type)
      return createTerminalStateAssertion(type, terminalAssertionId(step.id, offset, stepIndex), compactParams({ title: dialog.title, testId: dialog.testId }));
  }
  if (dialog?.type === 'modal' && /modal/.test(testId || '') && confirmLike)
    return createTerminalStateAssertion('modal-closed', terminalAssertionId(step.id, offset, stepIndex), compactParams({ title: dialog.title, testId: dialog.testId }));
  if (!dialog && /(^|[-_])modal([-_]|$)/i.test(testId || '') && confirmLike)
    return createTerminalStateAssertion('modal-closed', terminalAssertionId(step.id, offset, stepIndex), compactParams({ testId }));
  if (dialog?.type === 'popover' && /(popover|popconfirm|delete-confirm|remove-confirm)/i.test(testId || '') && /ok|confirm|delete|remove|确 定|确定|确认|删除|移除/i.test(joined))
    return createTerminalStateAssertion('popover-closed', terminalAssertionId(step.id, offset, stepIndex), compactParams({ title: dialog.title, testId: dialog.testId }));
  if (!dialog && /(popover|popconfirm|delete-confirm|remove-confirm)/i.test(testId || '') && /ok|confirm|delete|remove|确 定|确定|确认|删除|移除/i.test(joined))
    return createTerminalStateAssertion('popover-closed', terminalAssertionId(step.id, offset, stepIndex), compactParams({ testId }));
  return undefined;
}

function isMeaningfulSelectedValue(value: string, step: FlowStep) {
  const normalized = normalizeTerminalText(value).replace(/^\*\s*/, '');
  if (!normalized)
    return false;
  const contextTarget = step.context?.before.target;
  const candidates = [
    step.target?.label,
    step.target?.placeholder,
    step.target?.scope?.form?.label,
    step.target?.scope?.form?.name,
    contextTarget?.ariaLabel,
    contextTarget?.placeholder,
    step.context?.before.form?.label,
    step.context?.before.form?.name,
  ].map(value => normalizeTerminalText(value).replace(/^\*\s*/, '')).filter(Boolean);
  if (candidates.some(candidate => candidate === normalized))
    return false;
  if (/^选择/.test(normalized) && candidates.some(candidate => normalized.includes(candidate) || candidate.includes(normalized)))
    return false;
  return true;
}

function normalizeTerminalText(value: unknown) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function inferSelectedValueAssertion(step: FlowStep, previousStep: FlowStep | undefined, stepIndex: number, offset: number): FlowAssertion | undefined {
  const targetTestId = previousStep?.target?.testId;
  if (!targetTestId || step.target?.testId)
    return undefined;
  const triggerText = targetText(previousStep);
  const optionText = targetText(step);
  if (!optionText || optionText === triggerText || !isMeaningfulSelectedValue(optionText, previousStep))
    return undefined;
  const contextTarget = previousStep.context?.before.target;
  const ui = previousStep.context?.before.ui;
  const joined = [
    previousStep?.target?.role,
    previousStep?.target?.testId,
    previousStep?.target?.scope?.form?.label,
    previousStep?.target?.scope?.form?.name,
    contextTarget?.role,
    contextTarget?.testId,
    contextTarget?.controlType,
    contextTarget?.ariaLabel,
    contextTarget?.placeholder,
    ui?.component,
    ui?.form?.fieldKind,
    ui?.form?.label,
    ui?.recipe?.kind,
    ui?.recipe?.component,
    ui?.recipe?.fieldKind,
  ].filter(Boolean).join('|');
  if (/cascader/i.test(joined))
    return undefined;
  if (!/select|combobox|listbox|tree|选择|标签/i.test(joined))
    return undefined;
  return createTerminalStateAssertion('selected-value-visible', terminalAssertionId(step.id, offset, stepIndex), {
    targetTestId,
    expected: optionText,
  }, previousStep.target);
}

function sameTerminalDialogScope(left?: { type?: string; title?: string; testId?: string }, right?: { type?: string; title?: string; testId?: string }) {
  if (!left || !right)
    return false;
  if (left.testId && right.testId)
    return left.testId === right.testId;
  return !!left.title && left.title === right.title && left.type === right.type;
}

function targetText(step?: FlowStep) {
  return stringParam(step?.target?.text || step?.target?.name || step?.target?.displayName || step?.target?.label || step?.value);
}

function deletionTableScope(step: FlowStep, previousStep?: FlowStep) {
  const table = step.target?.scope?.table || previousStep?.target?.scope?.table;
  if (table)
    return table;
  const testId = step.target?.testId || step.context?.before.target?.testId || '';
  const match = testId.match(/^(.+?)(?:-row)?-delete-confirm-(?:ok|confirm)$/i);
  const rowText = targetText(previousStep);
  if (match?.[1] && rowText)
    return { testId: `${match[1]}-table`, rowText };
  return undefined;
}

function isRowDeletionConfirmation(step: FlowStep, previousStep?: FlowStep, table = deletionTableScope(step, previousStep)) {
  const beforeDialog = step.context?.before.dialog;
  const afterDialog = step.context?.after?.dialog;
  if (!table?.testId && !table?.rowKey && !table?.rowText)
    return false;
  const hasPopoverClosedEvidence = beforeDialog?.type === 'popover' && beforeDialog.visible === true && afterDialog?.type === 'popover' && afterDialog.visible === false;
  const text = [step.target?.testId, step.target?.name, step.target?.text, step.target?.displayName, previousStep?.target?.testId, previousStep?.target?.name, previousStep?.target?.text, previousStep?.target?.displayName, beforeDialog?.title].filter(Boolean).join('|');
  const hasDeleteEvidence = /delete|remove|删除|移除/i.test(text);
  const hasConfirmEvidence = /confirm|确 定|确定|确认/i.test(text);
  return hasDeleteEvidence && (hasPopoverClosedEvidence || hasConfirmEvidence);
}

function hasEquivalentAssertion(assertions: FlowAssertion[], suggestion: FlowAssertion) {
  return assertions.some(assertion => assertion.type === suggestion.type && JSON.stringify(assertion.params || {}) === JSON.stringify(suggestion.params || {}));
}

function terminalAssertionId(stepId: string, offset: number, stepIndex: number) {
  return `${stepId || `s${stepIndex + 1}`}-terminal-${offset + 1}`;
}

function compactParams(params: FlowAssertionParams): FlowAssertionParams {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== '')) as FlowAssertionParams;
}

function stringParam(value: unknown) {
  if (typeof value === 'string')
    return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return undefined;
}
