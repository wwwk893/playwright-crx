/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { FlowStep } from '../flow/types';
import type { UiActionRecipe } from './types';
import type { LocatorCandidate, LocatorCandidateKind, LocatorContract, LocatorRisk } from './locatorTypes';
import { looksLikeDialogOpenerTestId, looksLikeStructuralDialogTargetTestId } from './dialogLocatorGuards';
import { aggregateLocatorRisks, createLocatorCandidate, rankLocatorCandidates } from './locatorRobustnessScorer';

type TargetScope = {
  title?: string;
  type?: string;
  testId?: string;
};

type TargetTable = {
  title?: string;
  testId?: string;
};

type TargetRow = {
  key?: string;
  text?: string;
};

export function buildLocatorContract(recipe: UiActionRecipe, step?: FlowStep): LocatorContract {
  const candidates = rankLocatorCandidates([
    ...stableBusinessCandidates(recipe, step),
    ...rawDiagnosticCandidates(step),
  ].filter((candidate): candidate is LocatorCandidate => !!candidate));
  const risks = aggregateLocatorRisks(candidates, rawRiskScanValues(step));
  const primaryDiagnostic = candidates.find(candidate => candidate.risk !== 'critical') || candidates[0];
  const primaryExecutable = executablePrimaryCandidate(candidates, recipe, step);
  return {
    version: 1,
    diagnosticsOnly: !primaryExecutable,
    primary: primaryExecutable || primaryDiagnostic,
    primaryDiagnostic,
    primaryExecutable,
    candidates,
    risks,
  };
}

function executablePrimaryCandidate(candidates: LocatorCandidate[], recipe: UiActionRecipe, step?: FlowStep) {
  const candidate = candidates.find(candidate => isExecutableCandidate(candidate, recipe, step));
  return candidate ? { ...candidate, diagnosticsOnly: false } : undefined;
}

function isExecutableCandidate(candidate: LocatorCandidate, recipe: UiActionRecipe, step?: FlowStep) {
  if (candidate.risk === 'critical' || candidate.risk === 'high')
    return false;
  switch (candidate.kind) {
    case 'row-scoped-testid':
      return !!candidate.payload?.tableTestId && !!candidate.payload?.rowKey && !!candidate.payload?.testId;
    case 'row-scoped-role':
      return !!candidate.payload?.tableTestId && !!candidate.payload?.rowKey && !!candidate.payload?.role && !!(candidate.payload?.name || candidate.payload?.text);
    case 'dialog-scoped-testid': {
      const testId = candidate.payload?.testId;
      return candidate.payload?.dialogType !== 'dropdown' && !!testId && !looksLikeStructuralDialogTargetTestId(testId, candidate.payload?.dialogTestId, { isDialogOpener: !!step && isDialogOpenerTestIdClick(step, testId) }) && !!(candidate.payload?.dialogTestId || candidate.payload?.dialogTitle);
    }
    case 'dialog-scoped-role':
      return candidate.payload?.dialogType !== 'dropdown' && !!candidate.payload?.role && !!(candidate.payload?.name || candidate.payload?.text) && !!(candidate.payload?.dialogTestId || candidate.payload?.dialogTitle);
    case 'active-popup-option':
      return !!candidate.payload?.optionText && hasAntdPopupOptionEvidence(recipe, step);
    case 'visible-popconfirm-confirm':
      return !!(candidate.payload?.name || candidate.payload?.text);
    case 'testid': {
      const testId = candidate.payload?.testId;
      return !!testId && !looksLikeStructuralDialogTargetTestId(testId, undefined, { isDialogOpener: !!step && isDialogOpenerTestIdClick(step, testId) });
    }
    default:
      return false;
  }
}

function hasAntdPopupOptionEvidence(recipe: UiActionRecipe, step?: FlowStep) {
  if (recipe.replay?.runtimeFallback === 'active-antd-popup-option')
    return true;
  const framework = recipe.framework;
  const component = recipe.component;
  const hasAntdFrameworkEvidence = isAntdOrProFramework(framework) ||
    isAntdOrProFramework(step?.context?.before.target?.framework) ||
    isAntdOrProFramework(step?.context?.before.ui?.library) ||
    isAntdOrProFramework(step?.uiRecipe?.library);
  if (!hasAntdFrameworkEvidence)
    return false;
  const recipeSelectComponent = component === 'Select' || component === 'TreeSelect' || component === 'Cascader';
  if (recipeSelectComponent)
    return true;
  const controlType = step?.context?.before.target?.controlType || String((step?.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  if (/^(select-option|tree-select-option|cascader-option)$/.test(controlType))
    return true;
  const uiComponent = step?.context?.before.ui?.component || step?.uiRecipe?.component;
  if (uiComponent === 'select' || uiComponent === 'tree-select' || uiComponent === 'cascader' || uiComponent === 'Select' || uiComponent === 'TreeSelect' || uiComponent === 'Cascader')
    return true;
  return false;
}

function isAntdOrProFramework(value?: string) {
  return /^(antd|procomponents|pro-components)$/i.test(value || '');
}

function isDialogOpenerTestIdClick(step: FlowStep, testId: string) {
  if (step.action !== 'click' || !looksLikeDialogOpenerTestId(testId))
    return false;
  const opened = step.context?.after?.openedDialog || step.context?.after?.dialog;
  if (!opened || opened.type === 'dropdown' || opened.type === 'popover' || opened.visible === false)
    return false;
  const before = step.context?.before.dialog;
  return !(before?.type === opened.type && before?.title === opened.title && before?.testId === opened.testId);
}

function stableBusinessCandidates(recipe: UiActionRecipe, step?: FlowStep) {
  const candidates: Array<LocatorCandidate | undefined> = [];
  const target = recipe.target;
  const dialog = target?.dialog as TargetScope | undefined;
  const table = mergedTable(target?.table as TargetTable | undefined, step);
  const row = mergedRow(target?.row as TargetRow | undefined, recipe, step);
  const targetText = recipe.targetText || target?.text;
  const targetRole = target?.role || roleForOperation(recipe);
  const rowActionRisks = rowActionIdentityRisks(recipe, row, targetText);

  if (recipe.operation === 'rowAction') {
    candidates.push(createLocatorCandidate({
      kind: target?.testId ? 'row-scoped-testid' : 'row-scoped-role',
      value: rowScopedValue({ table, row, testId: target?.testId, role: targetRole, text: targetText }),
      scope: 'table-row',
      baseScore: target?.testId && row?.key ? 980 : row?.key ? 820 : 640,
      payload: { tableTestId: table?.testId, tableTitle: table?.title, rowKey: row?.key, rowText: row?.text, testId: target?.testId, role: targetRole, name: targetText, text: targetText },
      reasons: ['table row action', row?.key ? 'row key scoped' : 'row text scoped', target?.testId ? 'business test id' : 'semantic row action'],
      risks: rowActionRisks,
    }));
  }

  if (recipe.operation === 'selectOption' && recipe.option?.displayText) {
    candidates.push(createLocatorCandidate({
      kind: 'active-popup-option',
      value: activePopupOptionValue(recipe),
      scope: 'active-popup',
      baseScore: recipe.replay?.runtimeFallback === 'active-antd-popup-option' ? 940 : 760,
      payload: { label: recipe.fieldLabel, optionText: recipe.option.displayText, searchText: recipe.option.searchText },
      reasons: ['active popup option', recipe.option.searchText ? 'search text available' : 'option text only'],
    }));
  }

  if (recipe.operation === 'confirm' || recipe.component === 'PopconfirmButton') {
    candidates.push(createLocatorCandidate({
      kind: 'visible-popconfirm-confirm',
      value: popconfirmConfirmValue(recipe),
      scope: 'popconfirm',
      baseScore: 930,
      payload: { dialogTitle: recipe.overlayTitle, role: 'button', name: recipe.targetText, text: recipe.targetText },
      reasons: ['visible popconfirm root', recipe.overlayTitle ? 'popover title scoped' : 'confirm button scoped'],
      risks: popconfirmEvidenceRisks(recipe),
    }));
  }

  if (dialog && (target?.testId || targetRole || targetText)) {
    candidates.push(createLocatorCandidate({
      kind: target?.testId ? 'dialog-scoped-testid' : 'dialog-scoped-role',
      value: dialogScopedValue({ dialog, testId: target?.testId, role: targetRole, text: targetText }),
      scope: dialog.type === 'drawer' ? 'drawer' : 'dialog',
      baseScore: target?.testId ? 900 : 760,
      payload: { dialogTitle: dialog.title, dialogTestId: dialog.testId, dialogType: dialog.type, testId: target?.testId, role: targetRole, name: targetText, text: targetText },
      reasons: ['dialog scoped action', dialog.title ? 'dialog title scoped' : 'visible dialog scope'],
    }));
  }

  if (target?.testId) {
    candidates.push(createLocatorCandidate({
      kind: 'testid',
      value: `testid=${target.testId}`,
      scope: 'page',
      baseScore: recipe.operation === 'rowAction' && !row?.key ? 580 : 780,
      payload: { testId: target.testId },
      reasons: ['business test id'],
      risks: rowActionRisks,
    }));
  }

  if (recipe.fieldLabel || target?.label) {
    candidates.push(createLocatorCandidate({
      kind: 'field-label',
      value: `label=${recipe.fieldLabel || target?.label}`,
      scope: 'form',
      baseScore: 720,
      payload: { label: recipe.fieldLabel || target?.label },
      reasons: ['field label'],
    }));
  }

  if (targetRole && targetText) {
    candidates.push(createLocatorCandidate({
      kind: 'role',
      value: `role=${targetRole}; name=${targetText}`,
      scope: 'page',
      baseScore: 620,
      payload: { role: targetRole, name: targetText, text: targetText },
      reasons: ['role and accessible name'],
      risks: rowActionRisks,
    }));
  } else if (targetText) {
    candidates.push(createLocatorCandidate({
      kind: 'text',
      value: `text=${targetText}`,
      scope: 'page',
      baseScore: 420,
      payload: { text: targetText },
      reasons: ['visible text fallback diagnostic'],
      risks: rowActionRisks,
    }));
  }

  return candidates;
}

function rawDiagnosticCandidates(step?: FlowStep) {
  return rawLocatorValues(step).map(value => createLocatorCandidate({
    kind: rawCandidateKind(value),
    value,
    scope: 'unknown',
    baseScore: 180,
    reasons: ['raw recorder locator diagnostic'],
  }));
}

function rawLocatorValues(step?: FlowStep) {
  const values = new Set<string>();
  const target = step?.target as (FlowStep['target'] & { locator?: string }) | undefined;
  add(values, target?.selector);
  add(values, target?.locator);
  const rawAction = rawActionObject(step?.rawAction);
  add(values, stringValue(rawAction.selector));
  add(values, stringValue(rawAction.locator));
  return [...values];
}

function rawRiskScanValues(step?: FlowStep) {
  const values = new Set(rawLocatorValues(step));
  add(values, step?.sourceCode);
  return [...values];
}

function rawCandidateKind(value: string): LocatorCandidateKind {
  if (/xpath=|\/\/|\/html\//i.test(value))
    return 'xpath';
  if (/\.(?:nth|first|last)\s*\(/.test(value))
    return 'ordinal';
  if (/^[.#\[]|css=/.test(value))
    return 'css';
  return 'raw-selector';
}

function mergedTable(targetTable: TargetTable | undefined, step?: FlowStep): TargetTable | undefined {
  const table = step?.context?.before.table || step?.target?.scope?.table;
  if (!targetTable && !table)
    return undefined;
  return {
    title: targetTable?.title || table?.title,
    testId: targetTable?.testId || table?.testId,
  };
}

function mergedRow(targetRow: TargetRow | undefined, recipe: UiActionRecipe, step?: FlowStep): TargetRow | undefined {
  const table = step?.context?.before.table || step?.target?.scope?.table;
  const key = targetRow?.key || recipe.rowKey || table?.rowKey;
  const text = targetRow?.text || table?.rowText;
  return key || text ? { key, text } : undefined;
}

function rowActionIdentityRisks(recipe: UiActionRecipe, row: TargetRow | undefined, targetText?: string): LocatorRisk[] {
  if (recipe.operation !== 'rowAction' || row?.key)
    return [];
  return [{
    severity: 'high',
    code: 'row-action-without-row-key',
    reason: 'Table row actions need rowKey or equivalent stable row identity before they can become executable locators',
    evidence: row?.text || targetText || recipe.target?.testId,
  }];
}

function popconfirmEvidenceRisks(recipe: UiActionRecipe): LocatorRisk[] {
  if (recipe.operation !== 'confirm' && recipe.component !== 'PopconfirmButton')
    return [];
  if (recipe.overlayTitle || recipe.targetText)
    return [];
  return [{
    severity: 'medium',
    code: 'popconfirm-without-visible-evidence',
    reason: 'Popconfirm confirm candidates should include visible title or button text evidence',
  }];
}

function rowScopedValue(input: { table?: TargetTable; row?: TargetRow; testId?: string; role?: string; text?: string }) {
  const table = input.table?.testId ? `tableTestId=${input.table.testId}` : input.table?.title ? `tableTitle=${input.table.title}` : 'table';
  const row = input.row?.key ? `rowKey=${input.row.key}` : input.row?.text ? `rowText=${input.row.text}` : 'row';
  const action = input.testId ? `testId=${input.testId}` : input.role && input.text ? `role=${input.role}; name=${input.text}` : input.text ? `text=${input.text}` : 'action';
  return `${table}; ${row}; ${action}`;
}

function activePopupOptionValue(recipe: UiActionRecipe) {
  const field = recipe.fieldLabel ? `field=${recipe.fieldLabel}; ` : '';
  const search = recipe.option?.searchText ? `search=${recipe.option.searchText}; ` : '';
  return `${field}${search}option=${recipe.option?.displayText || recipe.optionText}`;
}

function popconfirmConfirmValue(recipe: UiActionRecipe) {
  const title = recipe.overlayTitle ? `title=${recipe.overlayTitle}; ` : '';
  const text = recipe.targetText ? `button=${recipe.targetText}` : 'button=confirm';
  return `${title}${text}`;
}

function dialogScopedValue(input: { dialog: TargetScope; testId?: string; role?: string; text?: string }) {
  const dialog = input.dialog.testId ? `dialogTestId=${input.dialog.testId}` : input.dialog.title ? `dialogTitle=${input.dialog.title}` : `dialogType=${input.dialog.type || 'dialog'}`;
  const action = input.testId ? `testId=${input.testId}` : input.role && input.text ? `role=${input.role}; name=${input.text}` : input.text ? `text=${input.text}` : 'action';
  return `${dialog}; ${action}`;
}

function roleForOperation(recipe: UiActionRecipe) {
  if (recipe.operation === 'confirm' || recipe.operation === 'click' || recipe.operation === 'rowAction')
    return 'button';
  if (recipe.operation === 'selectOption')
    return 'option';
  return recipe.target?.role;
}

function rawActionObject(value: unknown) {
  const record = value && typeof value === 'object' ? value as { action?: Record<string, unknown> } & Record<string, unknown> : {};
  return record.action && typeof record.action === 'object' ? record.action : record;
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function add(values: Set<string>, value?: string) {
  if (value?.trim())
    values.add(value.trim());
}
