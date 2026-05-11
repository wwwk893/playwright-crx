/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { UiLibrary } from '../uiSemantics/types';
import type { FlowStep } from '../flow/types';
import {
  type LegacyUiActionRecipeKind,
  type UiActionFramework,
  type UiActionOperation,
  type UiActionRecipe,
  type UiActionRecipeComponent,
  type UiActionRecipeOption,
  type UiActionRecipeTarget,
  type UiActionReplayContract,
} from '../uiSemantics/recipes';

export function buildRecipeForStep(step: FlowStep): UiActionRecipe | undefined {
  if (step.uiRecipe?.version === 1)
    return step.uiRecipe;

  if (step.action === 'fill')
    return fillRecipe(step);
  if (step.action === 'select')
    return selectRecipe(step);
  if (step.action === 'check' || step.action === 'uncheck')
    return toggleRecipe(step);
  if (step.action === 'click')
    return clickRecipe(step);
  return normalizeLegacyRecipe(step);
}

function fillRecipe(step: FlowStep): UiActionRecipe {
  const library = libraryForStep(step);
  const label = step.target?.label || step.context?.before.form?.label || step.target?.placeholder || step.target?.name;
  const name = step.context?.before.form?.name || step.target?.name;
  return makeRecipe({
    library,
    component: 'Input',
    operation: 'fill',
    kind: 'fill-form-field',
    target: targetForStep(step, { label }),
    value: step.value,
    fieldLabel: label,
    fieldName: name,
    fieldKind: step.context?.before.ui?.form?.fieldKind,
    formKind: step.context?.before.ui?.form?.formKind,
    targetText: step.target?.text || step.target?.displayName,
  });
}

function selectRecipe(step: FlowStep): UiActionRecipe {
  const library = libraryForStep(step, 'antd');
  const component = selectComponentForStep(step);
  const displayText = step.value || step.uiRecipe?.optionText || step.context?.before.ui?.option?.text || step.context?.before.target?.selectedOption || step.target?.text || '';
  const path = optionPathForStep(step);
  return makeRecipe({
    library,
    component,
    operation: 'selectOption',
    kind: 'select-option',
    target: targetForStep(step, { label: step.target?.label || step.context?.before.form?.label }),
    option: optionFromText(displayText, path),
    fieldLabel: step.target?.label || step.context?.before.form?.label || step.uiRecipe?.fieldLabel,
    fieldName: step.context?.before.form?.name || step.uiRecipe?.fieldName,
    fieldKind: step.context?.before.ui?.form?.fieldKind || step.uiRecipe?.fieldKind,
    formKind: step.context?.before.ui?.form?.formKind || step.uiRecipe?.formKind,
    optionText: displayText,
    overlayTitle: step.context?.before.dialog?.title || step.uiRecipe?.overlayTitle,
    targetText: step.target?.text || step.target?.displayName,
  });
}

function clickRecipe(step: FlowStep): UiActionRecipe {
  if (isPopconfirmStep(step)) {
    return makeRecipe({
      library: libraryForStep(step, 'antd'),
      component: 'PopconfirmButton',
      operation: 'confirm',
      kind: 'confirm-popconfirm',
      target: targetForStep(step),
      overlayTitle: step.context?.before.dialog?.title || step.context?.before.ui?.overlay?.title,
      targetText: step.target?.name || step.target?.text || step.context?.before.target?.text,
    });
  }
  if (isTableRowStep(step)) {
    const table = step.context?.before.table || step.target?.scope?.table;
    return makeRecipe({
      library: libraryForStep(step, 'pro-components'),
      component: 'TableRowAction',
      operation: 'rowAction',
      kind: 'table-row-action',
      target: targetForStep(step),
      tableTitle: table?.title,
      rowKey: table?.rowKey,
      columnTitle: step.context?.before.table?.columnName || step.target?.scope?.table?.columnName,
      targetText: step.target?.name || step.target?.text || step.context?.before.target?.text,
    });
  }
  if (isToggleStep(step))
    return toggleRecipe(step);
  return makeRecipe({
    library: libraryForStep(step),
    component: 'Button',
    operation: 'click',
    kind: 'click-button',
    target: targetForStep(step),
    targetText: step.target?.name || step.target?.text || step.context?.before.target?.text,
  });
}

function toggleRecipe(step: FlowStep): UiActionRecipe {
  const component = step.context?.before.ui?.component === 'switch' || step.target?.role === 'switch' ? 'Switch' : 'Checkbox';
  return makeRecipe({
    library: libraryForStep(step, 'antd'),
    component,
    operation: 'toggle',
    kind: 'toggle-control',
    target: targetForStep(step, { label: step.target?.label || step.context?.before.form?.label }),
    fieldLabel: step.target?.label || step.context?.before.form?.label,
    fieldName: step.context?.before.form?.name,
    targetText: step.target?.name || step.target?.text || step.context?.before.target?.text,
  });
}

function normalizeLegacyRecipe(step: FlowStep): UiActionRecipe | undefined {
  const legacy = step.uiRecipe;
  if (!legacy)
    return undefined;
  const operation = operationFromLegacyKind(legacy.kind);
  return makeRecipe({
    library: legacy.library,
    component: legacy.component,
    operation,
    kind: legacy.kind,
    target: targetForStep(step, { label: legacy.fieldLabel }),
    value: step.value,
    option: legacy.optionText ? optionFromText(legacy.optionText) : undefined,
    formKind: legacy.formKind,
    fieldKind: legacy.fieldKind,
    fieldLabel: legacy.fieldLabel,
    fieldName: legacy.fieldName,
    optionText: legacy.optionText,
    tableTitle: legacy.tableTitle,
    rowKey: legacy.rowKey,
    columnTitle: legacy.columnTitle,
    overlayTitle: legacy.overlayTitle,
    targetText: legacy.targetText,
  });
}

function makeRecipe(options: {
  library: UiLibrary;
  component: UiActionRecipeComponent;
  operation: UiActionOperation;
  kind: LegacyUiActionRecipeKind;
  target: UiActionRecipeTarget;
  value?: string;
  option?: UiActionRecipeOption;
  formKind?: string;
  fieldKind?: string;
  fieldLabel?: string;
  fieldName?: string;
  optionText?: string;
  tableTitle?: string;
  rowKey?: string;
  columnTitle?: string;
  overlayTitle?: string;
  targetText?: string;
}): UiActionRecipe {
  return {
    version: 1,
    framework: frameworkFromLibrary(options.library),
    replay: replayFor(options.operation),
    ...options,
  };
}

function frameworkFromLibrary(library?: UiLibrary): UiActionFramework {
  if (library === 'antd')
    return 'antd';
  if (library === 'pro-components')
    return 'procomponents';
  return 'generic';
}

function replayFor(operation: UiActionOperation): UiActionReplayContract {
  if (operation === 'selectOption')
    return { exportedStrategy: 'active-popup-option', parserSafeStrategy: 'active-popup-option', runtimeFallback: 'runtime-bridge' };
  if (operation === 'rowAction')
    return { exportedStrategy: 'table-row-action', parserSafeStrategy: 'table-row-action' };
  if (operation === 'confirm')
    return { exportedStrategy: 'visible-popconfirm', parserSafeStrategy: 'visible-popconfirm' };
  if (operation === 'fill')
    return { exportedStrategy: 'field-locator-fill', parserSafeStrategy: 'field-locator-fill' };
  if (operation === 'toggle')
    return { exportedStrategy: 'control-toggle', parserSafeStrategy: 'control-toggle' };
  return { exportedStrategy: 'semantic-click', parserSafeStrategy: 'semantic-click' };
}

function optionFromText(displayText: string, path?: string[]): UiActionRecipeOption {
  return {
    displayText,
    exactTokens: exactTokens(displayText),
    ...(path?.length ? { path } : {}),
  };
}

function exactTokens(text: string) {
  return Array.from(new Set(text.split(/[\s/\\|,，、>\-–—:：()（）\[\]【】]+/).map(token => token.trim()).filter(Boolean)));
}

function targetForStep(step: FlowStep, fallback: { label?: string } = {}): UiActionRecipeTarget {
  const table = step.context?.before.table || step.target?.scope?.table;
  const dialog = step.context?.before.dialog || step.target?.scope?.dialog;
  const rowKey = step.context?.before.table?.rowKey || step.target?.scope?.table?.rowKey;
  return {
    testId: step.target?.testId || step.context?.before.target?.testId,
    label: fallback.label || step.target?.label || step.context?.before.form?.label,
    role: step.target?.role || step.context?.before.target?.role,
    text: step.target?.text || step.target?.name || step.context?.before.target?.text,
    dialog: dialog ? { title: dialog.title, type: dialog.type, testId: dialog.testId } : undefined,
    table: table ? { title: table.title, testId: table.testId } : undefined,
    row: rowKey ? { key: rowKey, text: step.context?.before.table?.rowText || step.target?.scope?.table?.rowText } : undefined,
  };
}

function libraryForStep(step: FlowStep, fallback: UiLibrary = 'unknown'): UiLibrary {
  const library = step.context?.before.ui?.library || step.uiRecipe?.library;
  if (library === 'antd' || library === 'pro-components')
    return library;
  return fallback;
}

function selectComponentForStep(step: FlowStep): UiActionRecipeComponent {
  const component = step.context?.before.ui?.component || step.uiRecipe?.component;
  if (component === 'tree-select' || component === 'TreeSelect')
    return 'TreeSelect';
  if (component === 'cascader' || component === 'Cascader')
    return 'Cascader';
  return 'Select';
}

function optionPathForStep(step: FlowStep) {
  const path = step.context?.before.ui?.option?.path || step.uiRecipe?.option?.path;
  return Array.isArray(path) ? path.filter(entry => typeof entry === 'string' && entry && entry !== '[object Object]') : undefined;
}

function operationFromLegacyKind(kind: LegacyUiActionRecipeKind): UiActionOperation {
  if (kind === 'fill-form-field')
    return 'fill';
  if (kind === 'select-option')
    return 'selectOption';
  if (kind === 'confirm-popconfirm')
    return 'confirm';
  if (kind === 'toggle-control')
    return 'toggle';
  if (kind === 'table-row-action')
    return 'rowAction';
  return 'click';
}

function isPopconfirmStep(step: FlowStep) {
  return (step.context?.before.dialog?.type as string | undefined) === 'popconfirm' || step.context?.before.ui?.overlay?.type === 'popconfirm' || step.uiRecipe?.kind === 'confirm-popconfirm';
}

function isTableRowStep(step: FlowStep) {
  return !!(step.context?.before.table?.rowKey || step.target?.scope?.table?.rowKey || step.uiRecipe?.kind === 'table-row-action');
}

function isToggleStep(step: FlowStep) {
  const component = step.context?.before.ui?.component;
  return component === 'switch' || component === 'checkbox' || step.target?.role === 'switch' || step.target?.role === 'checkbox';
}
