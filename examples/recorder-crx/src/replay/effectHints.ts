/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { FlowAssertionParams, FlowStep } from '../flow/types';
import type { TerminalStateAssertionType } from '../flow/terminalAssertions';
import type { UiActionRecipe } from './types';

export type EffectHintKind =
  | 'selected-value-visible'
  | 'row-exists'
  | 'row-disappears'
  | 'modal-closed'
  | 'drawer-closed'
  | 'popconfirm-closed';

export interface EffectHint {
  kind: EffectHintKind;
  assertionType: TerminalStateAssertionType;
  params: FlowAssertionParams;
  target?: FlowStep['target'];
  reason: string;
  confidence: number;
}

export type EffectHintContext = {
  previousStep?: FlowStep;
  previousSteps?: FlowStep[];
};

export function effectHintsForRecipe(recipe: UiActionRecipe | undefined, step: FlowStep, context: EffectHintContext = {}): EffectHint[] {
  if (!recipe)
    return [];
  const hints: EffectHint[] = [];
  const selectedValue = selectedValueEffectHint(recipe, step, context.previousStep);
  if (selectedValue)
    hints.push(selectedValue);

  const rowDisappears = rowDisappearsEffectHint(recipe, step, context.previousStep);
  if (rowDisappears)
    hints.push(rowDisappears);

  const rowExists = rowExistsEffectHint(recipe, step, context.previousSteps ?? []);
  if (rowExists)
    hints.push(rowExists);

  const overlayClosed = overlayClosedEffectHint(recipe, step, context.previousSteps ?? []);
  if (overlayClosed)
    hints.push(overlayClosed);

  return hints;
}

function selectedValueEffectHint(recipe: UiActionRecipe, step: FlowStep, previousStep?: FlowStep): EffectHint | undefined {
  if (recipe.operation !== 'selectOption')
    return undefined;
  if (step.action === 'select')
    return undefined;
  const expected = stringParam(recipe.option?.displayText || recipe.option?.text || recipe.optionText || step.value || step.context?.before.target?.selectedOption || step.target?.text);
  if (!expected)
    return undefined;
  const targetTestId = stringParam(recipe.target?.testId || step.target?.testId || previousStep?.target?.testId || previousStep?.context?.before.target?.testId);
  if (!targetTestId)
    return undefined;
  return {
    kind: 'selected-value-visible',
    assertionType: 'selected-value-visible',
    params: { targetTestId, expected },
    target: previousStep?.target || step.target,
    reason: 'select option recipe commits a visible selected value',
    confidence: 0.92,
  };
}

function rowDisappearsEffectHint(recipe: UiActionRecipe, step: FlowStep, previousStep?: FlowStep): EffectHint | undefined {
  if (recipe.operation !== 'rowAction' && recipe.operation !== 'confirm')
    return undefined;
  if (recipe.operation === 'rowAction' && !rowActionHasDeleteCommitEvidence(step))
    return undefined;
  const evidence = criticalText(recipe, step, previousStep);
  if (!/delete|remove|删除|移除/i.test(evidence))
    return undefined;
  const table = tableScopeFrom(recipe, step, previousStep);
  if (!table.tableTestId && !table.rowKey && !table.rowKeyword)
    return undefined;
  return {
    kind: 'row-disappears',
    assertionType: 'row-not-exists',
    params: compactParams({
      tableTestId: table.tableTestId,
      rowKey: table.rowKey,
      rowKeyword: table.rowKeyword,
    }),
    target: previousStep?.target || step.target,
    reason: 'delete/remove row action recipe should remove the scoped row',
    confidence: table.rowKey ? 0.94 : 0.82,
  };
}

function rowExistsEffectHint(recipe: UiActionRecipe, step: FlowStep, previousSteps: FlowStep[]): EffectHint | undefined {
  if (!isCreateCommitStep(recipe, step))
    return undefined;
  const dialog = step.context?.before.dialog || step.target?.scope?.dialog;
  if (sameOverlayRemainsVisible(step, dialog) && hasValidationFeedback(step))
    return undefined;
  const createOpener = createOpenerForCurrentOverlay(previousSteps, dialog);
  if (!createOpener)
    return undefined;
  const tableTestId = tableScopeFromStep(createOpener).tableTestId;
  if (!tableTestId)
    return undefined;
  const rowKeyword = createdRowKeyword(previousSteps);
  if (!rowKeyword)
    return undefined;
  return {
    kind: 'row-exists',
    assertionType: 'row-exists',
    params: { tableTestId, rowKeyword },
    target: step.target,
    reason: 'create/save recipe should leave the created row visible',
    confidence: 0.78,
  };
}

function overlayClosedEffectHint(recipe: UiActionRecipe, step: FlowStep, previousSteps: FlowStep[]): EffectHint | undefined {
  const dialog = step.context?.before.dialog || step.target?.scope?.dialog;
  if (!isOverlayCommitActionStep(step))
    return undefined;
  if (blocksOverlayClosedEffect(step, dialog))
    return undefined;
  if (sameOverlayRemainsVisible(step, dialog) && hasValidationFeedback(step))
    return undefined;
  if (sameOverlayRemainsVisible(step, dialog) && !hasSuccessfulOverlayCommitEvidence(recipe, step, previousSteps))
    return undefined;
  if (recipe.component === 'PopconfirmButton' || dialog?.type === 'popover' || step.context?.before.ui?.overlay?.type === 'popconfirm') {
    return {
      kind: 'popconfirm-closed',
      assertionType: 'popover-closed',
      params: compactParams({ title: dialog?.title, testId: dialog?.testId }),
      target: step.target,
      reason: 'popconfirm confirmation should close the visible popconfirm',
      confidence: 0.9,
    };
  }
  if (!dialog?.type || !/confirm|ok|submit|save|cancel|close|确定|确 定|确认|保存|取消|关闭/i.test(criticalText(recipe, step)))
    return undefined;
  if (dialog.type === 'modal') {
    return {
      kind: 'modal-closed',
      assertionType: 'modal-closed',
      params: compactParams({ title: dialog.title, testId: dialog.testId }),
      target: step.target,
      reason: 'modal-scoped commit action should close the modal',
      confidence: 0.84,
    };
  }
  if (dialog.type === 'drawer') {
    return {
      kind: 'drawer-closed',
      assertionType: 'drawer-closed',
      params: compactParams({ title: dialog.title, testId: dialog.testId }),
      target: step.target,
      reason: 'drawer-scoped commit action should close the drawer',
      confidence: 0.84,
    };
  }
  return undefined;
}

function blocksOverlayClosedEffect(step: FlowStep, dialog?: { type?: string; title?: string; testId?: string }) {
  const afterDialog = step.context?.after?.dialog;
  const openedDialog = step.context?.after?.openedDialog;
  return isDifferentVisibleOverlay(afterDialog, dialog) || isDifferentVisibleOverlay(openedDialog, dialog);
}

function sameOverlayRemainsVisible(step: FlowStep, dialog?: { type?: string; title?: string; testId?: string }) {
  return !!step.context?.after?.dialog?.visible && sameOverlayScope(step.context.after.dialog, dialog);
}

function hasValidationFeedback(step: FlowStep) {
  const toast = stringParam(step.context?.after?.toast);
  return !!toast && isValidationFeedbackMessage(toast);
}

function isValidationFeedbackMessage(message: string) {
  return !/成功|已保存|保存成功|创建成功|更新成功|success/i.test(message);
}

function hasSuccessfulOverlayCommitEvidence(recipe: UiActionRecipe, step: FlowStep, previousSteps: FlowStep[]) {
  return !!rowExistsEffectHint(recipe, step, previousSteps) || isExplicitOverlayOwnedAction(recipe, step);
}

function isExplicitOverlayOwnedAction(recipe: UiActionRecipe, step: FlowStep) {
  const text = criticalText(recipe, step);
  const testId = step.target?.testId || recipe.target?.testId || '';
  return /(modal|drawer|popover|dialog)/i.test(testId) && /confirm|ok|submit|save|cancel|close|确定|确认|保存|取消|关闭/i.test(text);
}

function isDifferentVisibleOverlay(next?: { type?: string; title?: string; testId?: string; visible?: boolean }, current?: { type?: string; title?: string; testId?: string }) {
  if (!next?.visible)
    return false;
  if (!current)
    return true;
  return !sameOverlayScope(next, current);
}

function sameOverlayScope(left?: { type?: string; title?: string; testId?: string }, right?: { type?: string; title?: string; testId?: string }) {
  if (!left || !right)
    return false;
  if (left.testId && right.testId)
    return left.testId === right.testId;
  return !!left.title && left.title === right.title && left.type === right.type;
}

function isCreateCommitStep(recipe: UiActionRecipe, step: FlowStep) {
  if (!isOverlayCommitActionStep(step))
    return false;
  const dialog = step.context?.before.dialog || step.target?.scope?.dialog;
  if (dialog?.type !== 'modal' && dialog?.type !== 'drawer')
    return false;
  return /save|submit|confirm|ok|保存|提交|确 定|确定|确认|完成/i.test(criticalText(recipe, step));
}

function isOverlayCommitActionStep(step: FlowStep) {
  return step.action === 'click' || step.action === 'press';
}

function rowActionHasDeleteCommitEvidence(step: FlowStep) {
  if (step.context?.after?.openedDialog?.visible)
    return false;
  const beforeDialog = step.context?.before.dialog || step.target?.scope?.dialog;
  const afterDialog = step.context?.after?.dialog;
  if (beforeDialog?.type === 'popover' && beforeDialog.visible && afterDialog?.type === 'popover' && afterDialog.visible === false)
    return true;
  const text = [
    step.target?.testId,
    step.target?.name,
    step.target?.text,
    step.target?.displayName,
    step.context?.before.target?.testId,
    step.context?.before.target?.text,
  ].filter(Boolean).join('|');
  return /(?:delete|remove).*?(?:confirm|ok)|(?:confirm|ok).*?(?:delete|remove)|删除.*?(?:确定|确认)|(?:确定|确认).*?删除/i.test(text);
}

function isCreateOpenerStep(step: FlowStep) {
  if (step.action !== 'click')
    return false;
  return /create|add|new|新增|新建/i.test([
    step.target?.testId,
    step.target?.name,
    step.target?.text,
    step.target?.displayName,
    step.context?.before.target?.testId,
    step.context?.before.target?.text,
  ].filter(Boolean).join('|'));
}

function createOpenerForCurrentOverlay(previousSteps: FlowStep[], dialog?: { type?: string; title?: string; testId?: string }) {
  if (!dialog)
    return [...previousSteps].reverse().find(isCreateOpenerStep);

  const explicitOpenIndex = lastIndexOf(previousSteps, step => stepOpensOverlay(step, dialog));
  if (explicitOpenIndex >= 0)
    return [...previousSteps.slice(explicitOpenIndex)].reverse().find(isCreateOpenerStep);

  const overlayWindowStart = currentOverlayWindowStart(previousSteps, dialog);
  if (overlayWindowStart > 0 && isCreateOpenerStep(previousSteps[overlayWindowStart - 1]))
    return previousSteps[overlayWindowStart - 1];

  return undefined;
}

function lastIndexOf<T>(values: T[], predicate: (value: T) => boolean) {
  for (let index = values.length - 1; index >= 0; index--) {
    if (predicate(values[index]))
      return index;
  }
  return -1;
}

function stepOpensOverlay(step: FlowStep, dialog: { type?: string; title?: string; testId?: string }) {
  const afterDialog = step.context?.after?.openedDialog || step.context?.after?.dialog;
  return !!afterDialog?.visible && sameOverlayScope(afterDialog, dialog) && !sameOverlayScope(step.context?.before.dialog, dialog);
}

function currentOverlayWindowStart(previousSteps: FlowStep[], dialog: { type?: string; title?: string; testId?: string }) {
  const lastOverlayIndex = lastIndexOf(previousSteps, step => stepHasOverlayScope(step, dialog));
  if (lastOverlayIndex < 0)
    return -1;

  let start = lastOverlayIndex;
  for (let index = lastOverlayIndex - 1; index >= 0; index--) {
    if (!stepHasOverlayScope(previousSteps[index], dialog))
      break;
    start = index;
  }
  return start;
}

function stepHasOverlayScope(step: FlowStep, dialog: { type?: string; title?: string; testId?: string }) {
  return sameOverlayScope(step.context?.before.dialog, dialog) ||
    sameOverlayScope(step.context?.after?.dialog, dialog) ||
    sameOverlayScope(step.context?.after?.openedDialog, dialog) ||
    sameOverlayScope(step.target?.scope?.dialog, dialog);
}

function createdRowKeyword(previousSteps: FlowStep[]) {
  const candidates = previousSteps
      .filter(step => (step.action === 'fill' || step.action === 'select') && typeof step.value === 'string')
      .map(step => ({ step, value: String(step.value || '').trim() }))
      .filter(candidate => isMeaningfulRowKeyword(candidate.value));
  const preferred = candidates.filter(({ step }) => /name|名称|资源|地址池|用户名|user|id/i.test([
    step.target?.label,
    step.target?.placeholder,
    step.target?.name,
    step.target?.testId,
    step.context?.before.form?.label,
    step.context?.before.form?.name,
  ].filter(Boolean).join('|')));
  return preferred[preferred.length - 1]?.value || candidates[candidates.length - 1]?.value;
}

function isMeaningfulRowKeyword(value: string) {
  return !!value &&
    value.length <= 120 &&
    !/^https?:\/\//i.test(value) &&
    !/^\d{1,3}(?:\.\d+)?$/.test(value) &&
    !/password|secret|token|cookie|authorization/i.test(value);
}

function tableScopeFrom(recipe: UiActionRecipe, step: FlowStep, previousStep?: FlowStep) {
  const payload = recipe.locatorContract?.primaryDiagnostic?.payload || recipe.locatorContract?.primary?.payload;
  const table = step.target?.scope?.table || previousStep?.target?.scope?.table || step.context?.before.table || previousStep?.context?.before.table;
  return {
    tableTestId: stringParam(payload?.tableTestId || table?.testId),
    rowKey: stringParam(payload?.rowKey || recipe.rowKey || table?.rowKey),
    rowKeyword: stringParam(payload?.rowText || table?.rowText),
  };
}

function tableScopeFromStep(step?: FlowStep) {
  const table = step?.target?.scope?.table || step?.context?.before.table;
  return {
    tableTestId: stringParam(table?.testId),
    rowKey: stringParam(table?.rowKey),
    rowKeyword: stringParam(table?.rowText),
  };
}

function criticalText(recipe: UiActionRecipe, step: FlowStep, previousStep?: FlowStep) {
  return [
    recipe.targetText,
    recipe.target?.text,
    recipe.target?.testId,
    recipe.kind,
    step.target?.testId,
    step.target?.name,
    step.target?.text,
    step.target?.displayName,
    step.context?.before.target?.text,
    step.context?.before.dialog?.title,
    previousStep?.target?.testId,
    previousStep?.target?.name,
    previousStep?.target?.text,
    previousStep?.target?.displayName,
  ].filter(Boolean).join('|');
}

function stringParam(value: unknown) {
  if (typeof value === 'string')
    return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return undefined;
}

function compactParams(params: FlowAssertionParams): FlowAssertionParams {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== '')) as FlowAssertionParams;
}
