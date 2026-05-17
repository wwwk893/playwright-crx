/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { BusinessFlow, FlowStep } from '../flow/types';
import { normalizeComparableText, normalizeGeneratedText, rawAction } from './stepEmitterUtils';

type FlowDialogScope = NonNullable<NonNullable<NonNullable<FlowStep['target']>['scope']>['dialog']>;
type FlowTableScope = NonNullable<NonNullable<FlowStep['target']>['scope']>['table'];

export type EffectiveReplayFlowHooks = {
  choiceControlText: (step: FlowStep) => string | undefined;
  stepSynthesizesPopoverConfirm: (step?: FlowStep, options?: { parserSafe?: boolean }) => boolean;
  popoverOpenedAfterClick: (step: FlowStep) => FlowDialogScope | undefined;
  testIdFromSource: (source?: string) => string | undefined;
  isDeleteOrRemoveTestId: (testId: string) => boolean;
  looksLikeDropdownOptionStepForDedup: (step: FlowStep) => boolean;
  isAntdProjectedSelectStep: (step: FlowStep) => boolean;
  antdSelectOptionName: (step: FlowStep) => string | undefined;
  popupOptionName: (step: FlowStep) => string | undefined;
  optionTextTokens: (optionName: string, options?: { keepSecondaryTokens?: boolean; parserSafeRuntimeBridge?: boolean }) => string[];
  popupFieldLabelFromName: (value?: string) => string | undefined;
  isAntdSelectFieldStep: (step: FlowStep, nextStep?: FlowStep) => boolean;
  selectQueryForStep: (step: FlowStep) => string;
  isContextlessOptionTextClickAfterSelect: (step: FlowStep, selectStep: FlowStep, inheritedQuery?: string) => boolean;
  inheritedAntdSelectOptionStep: (step: FlowStep, activeSelectStep: FlowStep, activeSelectQuery?: string) => FlowStep;
};

export function createEffectiveReplayFlow(flow: BusinessFlow, hooks: EffectiveReplayFlowHooks): BusinessFlow {
  const withDialogContext = withInheritedDialogContext(flow);
  const withSelectContext = withInheritedAntdSelectOptionContext(withDialogContext, hooks);
  const withTableContext = withInheritedTableRowContext(withSelectContext);
  const withDropdownDedupe = withDedupedAdjacentDropdownOptionClicks(withTableContext, hooks);
  const withPopoverDedupe = withDedupedRepeatedPopoverOpenerClicks(withDropdownDedupe, hooks);
  return withDedupedSameEventChoiceClicks(withPopoverDedupe, hooks);
}

function withDedupedSameEventChoiceClicks(flow: BusinessFlow, hooks: EffectiveReplayFlowHooks): BusinessFlow {
  const keepByKey = new Map<string, FlowStep>();
  for (const step of flow.steps) {
    const key = sameEventChoiceClickKey(step, hooks);
    if (!key)
      continue;
    const previous = keepByKey.get(key);
    if (!previous || choiceClickDedupeScore(step) > choiceClickDedupeScore(previous))
      keepByKey.set(key, step);
  }
  if (!keepByKey.size)
    return flow;

  let changed = false;
  const steps = flow.steps.filter(step => {
    const key = sameEventChoiceClickKey(step, hooks);
    if (!key)
      return true;
    const keep = keepByKey.get(key);
    const shouldKeep = keep?.id === step.id;
    changed = changed || !shouldKeep;
    return shouldKeep;
  });
  if (!changed)
    return flow;
  const keptStepIds = new Set(steps.map(step => step.id));
  return {
    ...flow,
    steps,
    repeatSegments: flow.repeatSegments
        ?.map(segment => ({ ...segment, stepIds: segment.stepIds.filter(stepId => keptStepIds.has(stepId)) }))
        .filter(segment => segment.stepIds.length > 0),
  };
}

function sameEventChoiceClickKey(step: FlowStep, hooks: EffectiveReplayFlowHooks) {
  if (step.action !== 'click')
    return undefined;
  const eventId = step.context?.eventId;
  if (!eventId || !isChoiceControlStepForDedupe(step))
    return undefined;
  const identity = normalizeComparableText(step.target?.testId || step.context?.before.target?.testId || hooks.choiceControlText(step) || '');
  return identity ? `${eventId}::${identity}` : undefined;
}

function choiceClickDedupeScore(step: FlowStep) {
  return (step.kind === 'recorded' ? 100 : 0) +
    (step.sourceActionIds?.length ? 20 : 0) +
    (step.target?.testId || step.context?.before.target?.testId ? 5 : 0);
}

function isChoiceControlStepForDedupe(step: FlowStep) {
  const role = step.target?.role || step.context?.before.target?.role || '';
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { target?: { controlType?: unknown }; ui?: { form?: { fieldKind?: unknown } } } | undefined)?.target?.controlType || (step.target?.raw as { ui?: { form?: { fieldKind?: unknown } } } | undefined)?.ui?.form?.fieldKind || '');
  return /^(checkbox|radio|switch)$/.test(role) || /^(checkbox|radio|switch)$/.test(controlType);
}

function withDedupedAdjacentDropdownOptionClicks(flow: BusinessFlow, hooks: EffectiveReplayFlowHooks): BusinessFlow {
  let changed = false;
  const steps: FlowStep[] = [];
  for (const step of flow.steps) {
    const previous = steps[steps.length - 1];
    if (previous && areDuplicateDropdownOptionClicks(previous, step, hooks)) {
      const previousScore = dropdownOptionContextScore(previous);
      const currentScore = dropdownOptionContextScore(step);
      if (!hooks.isAntdProjectedSelectStep(previous) && currentScore > previousScore)
        steps[steps.length - 1] = mergeDuplicateDropdownStep(step, previous);
      else
        steps[steps.length - 1] = mergeDuplicateDropdownStep(previous, step);
      changed = true;
      continue;
    }
    steps.push(step);
  }
  return changed ? { ...flow, steps } : flow;
}

function mergeDuplicateDropdownStep(primary: FlowStep, duplicate: FlowStep) {
  if (!duplicate.assertions.length)
    return primary;
  const seenAssertionIds = new Set(primary.assertions.map(assertion => assertion.id));
  const mergedAssertions = [
    ...primary.assertions,
    ...duplicate.assertions.filter(assertion => !seenAssertionIds.has(assertion.id)),
  ];
  return mergedAssertions.length === primary.assertions.length ? primary : { ...primary, assertions: mergedAssertions };
}

function withDedupedRepeatedPopoverOpenerClicks(flow: BusinessFlow, hooks: EffectiveReplayFlowHooks): BusinessFlow {
  let changed = false;
  const steps: FlowStep[] = [];
  for (const step of flow.steps) {
    const previous = steps[steps.length - 1];
    if (previous && areRepeatedPopoverOpenerClicks(previous, step, hooks)) {
      changed = true;
      continue;
    }
    steps.push(step);
  }
  if (!changed)
    return flow;
  const keptStepIds = new Set(steps.map(step => step.id));
  return {
    ...flow,
    steps,
    repeatSegments: flow.repeatSegments
        ?.map(segment => ({ ...segment, stepIds: segment.stepIds.filter(stepId => keptStepIds.has(stepId)) }))
        .filter(segment => segment.stepIds.length > 0),
  };
}

function areRepeatedPopoverOpenerClicks(previous: FlowStep, step: FlowStep, hooks: EffectiveReplayFlowHooks) {
  if (previous.action !== 'click' || step.action !== 'click')
    return false;
  if (!hooks.stepSynthesizesPopoverConfirm(previous, { parserSafe: true }) || !hooks.stepSynthesizesPopoverConfirm(step, { parserSafe: true }))
    return false;
  const previousPopover = hooks.popoverOpenedAfterClick(previous);
  const currentPopover = hooks.popoverOpenedAfterClick(step);
  if (previousPopover?.title && currentPopover?.title && previousPopover.title !== currentPopover.title)
    return false;
  const previousIdentity = repeatedPopoverOpenerIdentity(previous, hooks);
  const currentIdentity = repeatedPopoverOpenerIdentity(step, hooks);
  return !!previousIdentity && previousIdentity === currentIdentity;
}

function repeatedPopoverOpenerIdentity(step: FlowStep, hooks: EffectiveReplayFlowHooks) {
  const testId = step.target?.testId || step.context?.before.target?.testId || hooks.testIdFromSource(step.sourceCode) || hooks.testIdFromSource(JSON.stringify(rawAction(step.rawAction))) || '';
  if (!hooks.isDeleteOrRemoveTestId(testId))
    return '';
  const table = step.target?.scope?.table || step.context?.before.table;
  const tableId = normalizeComparableText(table?.testId || table?.title || '');
  const rowKey = normalizeComparableText(table?.rowKey || '');
  const rowText = normalizeComparableText(table?.rowText || step.target?.text || step.target?.name || step.target?.displayName || step.context?.before.target?.text || step.context?.before.target?.normalizedText || '');
  const discriminator = rowKey ? `row-key:${rowKey}` : rowText ? `row-text:${rowText}` : '';
  if (!discriminator)
    return '';
  return [normalizeComparableText(testId), tableId, discriminator].join('::');
}

function areDuplicateDropdownOptionClicks(a: FlowStep, b: FlowStep, hooks: EffectiveReplayFlowHooks) {
  if (!isDropdownOptionDedupAction(a, hooks) || !isDropdownOptionDedupAction(b, hooks))
    return false;
  if (!hooks.looksLikeDropdownOptionStepForDedup(a) || !hooks.looksLikeDropdownOptionStepForDedup(b))
    return false;
  const fieldA = dropdownOptionFieldLabel(a, hooks);
  const fieldB = dropdownOptionFieldLabel(b, hooks);
  if (fieldA && fieldB && normalizeComparableText(fieldA) !== normalizeComparableText(fieldB))
    return false;
  const compactA = compactDropdownOptionIdentity(hooks.antdSelectOptionName(a) || hooks.popupOptionName(a) || '');
  const compactB = compactDropdownOptionIdentity(hooks.antdSelectOptionName(b) || hooks.popupOptionName(b) || '');
  if (compactA && compactB && compactA === compactB)
    return true;
  const tokensA = hooks.optionTextTokens(hooks.antdSelectOptionName(a) || hooks.popupOptionName(a) || '', { keepSecondaryTokens: true }).map(normalizeComparableText).filter(Boolean);
  const tokensB = hooks.optionTextTokens(hooks.antdSelectOptionName(b) || hooks.popupOptionName(b) || '', { keepSecondaryTokens: true }).map(normalizeComparableText).filter(Boolean);
  if (!tokensA.length || !tokensB.length)
    return false;
  return tokensA.every(token => tokensB.includes(token)) || tokensB.every(token => tokensA.includes(token));
}

function isDropdownOptionDedupAction(step: FlowStep, hooks: EffectiveReplayFlowHooks) {
  return step.action === 'click' || hooks.isAntdProjectedSelectStep(step);
}

function dropdownOptionFieldLabel(step: FlowStep, hooks: EffectiveReplayFlowHooks) {
  return step.context?.before.form?.label || step.target?.scope?.form?.label || step.target?.label || hooks.popupFieldLabelFromName(step.target?.name || step.target?.text || step.target?.displayName);
}

function compactDropdownOptionIdentity(value: string) {
  return normalizeGeneratedText(value)
      ?.replace(/\s+/g, '')
      .trim();
}

export function dropdownOptionEmitIdentity(step: FlowStep, hooks: EffectiveReplayFlowHooks) {
  const optionIdentity = dropdownOptionEmitCompactIdentity(step, hooks);
  if (!optionIdentity)
    return '';
  const field = normalizeComparableText(dropdownOptionFieldLabel(step, hooks) || '');
  return `${field || 'dropdown'}::${optionIdentity}`;
}

export function dropdownOptionEmitCompactIdentity(step: FlowStep, hooks: EffectiveReplayFlowHooks) {
  if (!hooks.looksLikeDropdownOptionStepForDedup(step))
    return '';
  return compactDropdownOptionIdentity(hooks.antdSelectOptionName(step) || hooks.popupOptionName(step) || '') || '';
}

function dropdownOptionContextScore(step: FlowStep) {
  let score = 0;
  if (step.context?.before.dialog?.type === 'dropdown' || step.target?.scope?.dialog?.type === 'dropdown')
    score += 4;
  if (step.context?.before.form?.label || step.target?.scope?.form?.label)
    score += 3;
  if (step.context?.before.target?.framework === 'antd' || step.context?.before.target?.framework === 'procomponents')
    score += 2;
  if (step.context?.before.target?.selectedOption || step.context?.before.target?.optionPath?.length)
    score += 1;
  return score;
}

function withInheritedTableRowContext(flow: BusinessFlow): BusinessFlow {
  let previousTableRow: { table: FlowTableScope; rowText?: string; stepText?: string } | undefined;
  let changed = false;
  const steps = flow.steps.map(step => {
    const currentTable = step.target?.scope?.table || step.context?.before.table;
    const currentRowText = normalizeGeneratedText(currentTable?.rowText || step.target?.text || step.target?.name || step.target?.displayName);
    const shouldInherit = !currentTable && !!previousTableRow?.table && isRunnableRowClick(step) && sameBusinessRow(previousTableRow, step);
    const nextStep = shouldInherit ? {
      ...step,
      target: {
        ...step.target,
        scope: {
          ...step.target?.scope,
          table: previousTableRow!.table,
        },
      },
      context: {
        ...step.context,
        before: {
          ...step.context?.before,
          table: previousTableRow!.table,
        },
      },
    } as FlowStep : step;
    changed = changed || shouldInherit;

    const table = nextStep.target?.scope?.table || nextStep.context?.before.table;
    if (table?.testId && (table.rowKey || table.rowIdentity?.stable || table.rowText)) {
      previousTableRow = {
        table,
        rowText: normalizeGeneratedText(table.rowText),
        stepText: normalizeGeneratedText(nextStep.target?.text || nextStep.target?.name || nextStep.target?.displayName || currentRowText),
      };
    } else if (!isRowLikeStep(nextStep)) {
      previousTableRow = undefined;
    }

    return nextStep;
  });
  return changed ? { ...flow, steps } : flow;
}

function isRunnableRowClick(step: FlowStep) {
  return step.action === 'click' && isRowLikeStep(step) && !step.target?.scope?.table && !step.context?.before.table;
}

function isRowLikeStep(step: FlowStep) {
  const role = step.target?.role || step.context?.before.target?.role;
  const text = normalizeGeneratedText(step.target?.text || step.target?.name || step.target?.displayName);
  return role === 'row' || !!text && /\brow\b/i.test(step.target?.displayName || '');
}

function sameBusinessRow(previous: { rowText?: string; stepText?: string }, step: FlowStep) {
  const currentText = normalizeGeneratedText(step.target?.text || step.target?.name || step.target?.displayName);
  if (!currentText)
    return false;
  const candidates = [previous.rowText, previous.stepText].filter(Boolean) as string[];
  return candidates.some(candidate => normalizedRowComparable(candidate) === normalizedRowComparable(currentText) || normalizedRowComparable(candidate).includes(normalizedRowComparable(currentText)) || normalizedRowComparable(currentText).includes(normalizedRowComparable(candidate)));
}

function normalizedRowComparable(value?: string) {
  return normalizeGeneratedText(value)?.replace(/\s+/g, '') || '';
}

function withInheritedDialogContext(flow: BusinessFlow): BusinessFlow {
  let activeDialog: FlowDialogScope | undefined;
  let changed = false;
  const steps = flow.steps.map(step => {
    if (step.action === 'navigate')
      activeDialog = undefined;

    const opensDialog = stepOpensPersistentDialog(step);
    const beforeDialog = step.context?.before.dialog;
    const stepDialog = isPersistentDialog(beforeDialog) ? beforeDialog : activeDialog;
    const scopedDialog = step.target?.scope?.dialog;
    const needsDialog = !opensDialog && !!stepDialog && canInheritDialogContext(step) && !isPersistentDialog(beforeDialog) && !isPersistentDialog(scopedDialog);
    const nextStep = needsDialog ? {
      ...step,
      target: {
        ...step.target,
        scope: {
          ...step.target?.scope,
          dialog: stepDialog,
        },
      },
      context: {
        ...step.context,
        before: {
          ...step.context?.before,
          dialog: stepDialog,
        },
      },
    } as FlowStep : step;
    changed = changed || needsDialog;

    const afterDialog = openedDialogAfterStep(nextStep);
    if (isPersistentDialog(afterDialog))
      activeDialog = afterDialog;
    else if (isDialogClosingClick(nextStep) || isDialogButtonClickWithoutRemainingDialog(nextStep))
      activeDialog = undefined;
    else if (isPersistentDialog(nextStep.context?.before.dialog))
      activeDialog = nextStep.context?.before.dialog;

    return nextStep;
  });
  return changed ? { ...flow, steps } : flow;
}

export function isPersistentDialog(dialog?: FlowDialogScope) {
  return !!(dialog && dialog.type !== 'dropdown' && dialog.type !== 'popover' && (dialog.title || dialog.testId));
}

function isOwnDialogScope(dialog?: FlowDialogScope) {
  return !!(dialog && dialog.type !== 'dropdown' && (dialog.title || dialog.testId));
}

export function openedDialogAfterStep(step: FlowStep) {
  return step.context?.after?.openedDialog ?? step.context?.after?.dialog;
}

export function stepOpensPersistentDialog(step: FlowStep) {
  const opened = openedDialogAfterStep(step);
  if (step.action !== 'click' || !isPersistentDialog(opened))
    return false;
  return !sameDialogScope(step.context?.before.dialog, opened);
}

function hasOwnPageContext(step: FlowStep) {
  const raw = step.target?.raw as { pageContext?: unknown } | undefined;
  return !!(step.context?.before.target || step.context?.before.form || raw?.pageContext);
}

function canInheritDialogContext(step: FlowStep) {
  if (!hasOwnPageContext(step))
    return false;
  const hasOwnDialog = isOwnDialogScope(step.context?.before.dialog) || isOwnDialogScope(step.target?.scope?.dialog);
  if (!hasOwnDialog) {
    if (step.context?.before.section || step.target?.scope?.section)
      return false;
    if (step.context?.before.table || step.target?.scope?.table)
      return false;
    const testId = step.target?.testId || step.context?.before.target?.testId || step.context?.before.form?.testId || step.target?.scope?.form?.testId;
    if (testId && !looksLikeDialogOwnedTestId(testId))
      return false;
  }
  const label = normalizeGeneratedText(step.target?.label || step.target?.name || step.target?.displayName || step.context?.before.form?.label || step.target?.scope?.form?.label);
  if (/^下方/.test(label || ''))
    return false;
  return true;
}

export function looksLikeDialogOwnedTestId(testId: string) {
  return /(modal|drawer|dialog|popup|popover|overlay)/i.test(testId);
}

function isDialogClosingClick(step: FlowStep) {
  if (step.action !== 'click')
    return false;
  const text = normalizeGeneratedText(step.target?.name || step.target?.text || step.target?.displayName || step.target?.label);
  const testId = step.target?.testId || step.context?.before.target?.testId || '';
  return /^(确定|确认|取消|关闭|保存)$/.test(text || '') || /(confirm|cancel|close|ok|save)$/i.test(testId);
}

function isDialogButtonClickWithoutRemainingDialog(step: FlowStep) {
  if (step.action !== 'click')
    return false;
  if (!isPersistentDialog(step.context?.before.dialog))
    return false;
  if (isPersistentDialog(step.context?.after?.dialog))
    return false;
  const role = step.target?.role || step.context?.before.target?.role;
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  const source = step.sourceCode || JSON.stringify(rawAction(step.rawAction));
  return role === 'button' ||
    controlType === 'button' ||
    /getByRole\(["']button["']|role=button|button/i.test(source) ||
    !!(step.target?.testId || step.context?.before.target?.testId);
}

function withInheritedAntdSelectOptionContext(flow: BusinessFlow, hooks: EffectiveReplayFlowHooks): BusinessFlow {
  let activeSelectStep: FlowStep | undefined;
  let activeSelectQuery = '';
  let changed = false;
  const steps = flow.steps.map((step, index) => {
    if (hooks.isAntdSelectFieldStep(step, flow.steps[index + 1])) {
      const query = hooks.selectQueryForStep(step);
      if (query)
        activeSelectQuery = query;
      activeSelectStep = step;
      return step;
    }

    if (activeSelectStep && hooks.isContextlessOptionTextClickAfterSelect(step, activeSelectStep, activeSelectQuery)) {
      changed = true;
      return hooks.inheritedAntdSelectOptionStep(step, activeSelectStep, activeSelectQuery);
    }

    if (step.action !== 'fill' && step.action !== 'press') {
      activeSelectStep = undefined;
      activeSelectQuery = '';
    }
    return step;
  });
  return changed ? { ...flow, steps } : flow;
}

export function sameDialogScope(left?: FlowDialogScope, right?: FlowDialogScope) {
  if (!left || !right)
    return false;
  if (left.testId && right.testId)
    return left.testId === right.testId;
  return !!left.title && left.title === right.title && left.type === right.type;
}
