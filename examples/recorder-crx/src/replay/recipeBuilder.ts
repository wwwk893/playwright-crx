/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { UiLibrary } from '../uiSemantics/types';
import type { FlowStep } from '../flow/types';
import { buildLocatorContract } from './locatorCandidates';
import { buildSafetyPreflight } from './safetyGuard';
import {
  type LegacyUiActionRecipeKind,
  type UiActionFramework,
  type UiActionOperation,
  type UiActionRecipe,
  type UiActionRecipeComponent,
  type UiActionRecipeOption,
  type UiActionRecipeTarget,
  type UiActionReplayContract,
} from './types';

export function buildRecipeForStep(step: FlowStep): UiActionRecipe | undefined {
  const recipe = step.uiRecipe?.version === 1 ? step.uiRecipe :
    step.action === 'fill' ? fillRecipe(step) :
      step.action === 'select' ? selectRecipe(step) :
        step.action === 'check' || step.action === 'uncheck' ? toggleRecipe(step) :
          step.action === 'click' ? clickRecipe(step) :
            normalizeLegacyRecipe(step);
  return recipe ? withLocatorContract(recipe, step) : undefined;
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

function selectRecipe(step: FlowStep): UiActionRecipe | undefined {
  const library = libraryForStep(step);
  const component = selectComponentForStep(step);
  const displayText = optionDisplayTextForStep(step);
  if (!displayText)
    return undefined;
  const path = optionPathForStep(step);
  const searchText = selectSearchTextForStep(step);
  return makeRecipe({
    library,
    component,
    operation: 'selectOption',
    kind: 'select-option',
    target: targetForStep(step, { label: step.target?.label || step.context?.before.form?.label }),
    option: optionFromText(displayText, path, searchText),
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
  const optionRecipe = selectOptionClickRecipe(step);
  if (optionRecipe)
    return optionRecipe;
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

function selectOptionClickRecipe(step: FlowStep): UiActionRecipe | undefined {
  if (!isSelectOptionClickStep(step))
    return undefined;
  const displayText = optionDisplayTextForStep(step);
  if (!displayText)
    return undefined;
  const library = libraryForStep(step);
  const component = selectComponentForStep(step);
  const path = optionPathForStep(step);
  const searchText = selectSearchTextForStep(step);
  return makeRecipe({
    library,
    component,
    operation: 'selectOption',
    kind: 'select-option',
    target: targetForStep(step, { label: step.target?.label || step.context?.before.form?.label }),
    option: optionFromText(displayText, path, searchText),
    fieldLabel: step.target?.label || step.context?.before.form?.label || step.uiRecipe?.fieldLabel,
    fieldName: step.context?.before.form?.name || step.uiRecipe?.fieldName,
    fieldKind: step.context?.before.ui?.form?.fieldKind || step.uiRecipe?.fieldKind,
    formKind: step.context?.before.ui?.form?.formKind || step.uiRecipe?.formKind,
    optionText: displayText,
    overlayTitle: step.context?.before.dialog?.title || step.uiRecipe?.overlayTitle,
    targetText: step.target?.text || step.target?.displayName,
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
  const framework = frameworkFromLibrary(options.library);
  return {
    version: 1,
    framework,
    replay: replayFor({ operation: options.operation, framework, component: options.component }),
    ...options,
  };
}

function withLocatorContract(recipe: UiActionRecipe, step: FlowStep): UiActionRecipe {
  const withLocator = {
    ...recipe,
    locatorContract: buildLocatorContract(recipe, step),
  };
  return {
    ...withLocator,
    safetyPreflight: buildSafetyPreflight(withLocator, step),
  };
}

function frameworkFromLibrary(library?: UiLibrary): UiActionFramework {
  if (library === 'antd')
    return 'antd';
  if (library === 'pro-components')
    return 'procomponents';
  return 'generic';
}

function replayFor(input: { operation: UiActionOperation; framework: UiActionFramework; component: UiActionRecipeComponent }): UiActionReplayContract {
  if (input.operation === 'selectOption') {
    if (input.framework === 'antd' || input.framework === 'procomponents') {
      if (input.component === 'TreeSelect')
        return { exportedStrategy: 'antd-tree-option-dispatch', parserSafeStrategy: 'active-popup-option', runtimeFallback: 'active-antd-popup-option' };
      if (input.component === 'Cascader')
        return { exportedStrategy: 'antd-cascader-path-dispatch', parserSafeStrategy: 'active-popup-option', runtimeFallback: 'active-antd-popup-option' };
      return { exportedStrategy: 'antd-owned-option-dispatch', parserSafeStrategy: 'field-trigger-search-option', runtimeFallback: 'active-antd-popup-option' };
    }
    return { exportedStrategy: 'native-select-option', parserSafeStrategy: 'native-select-option' };
  }
  if (input.operation === 'rowAction')
    return { exportedStrategy: 'table-row-action', parserSafeStrategy: 'table-row-scoped-action' };
  if (input.operation === 'confirm')
    return { exportedStrategy: 'popover-confirm', parserSafeStrategy: 'dialog-scoped-action', runtimeFallback: 'active-popconfirm-confirm' };
  if (input.operation === 'fill')
    return { exportedStrategy: 'locator-fill', parserSafeStrategy: 'simple-locator-action' };
  if (input.operation === 'toggle')
    return { exportedStrategy: 'control-toggle', parserSafeStrategy: 'simple-locator-action' };
  return { exportedStrategy: 'locator-click', parserSafeStrategy: 'simple-locator-action' };
}

function optionFromText(displayText: string, path?: string[], searchText?: string): UiActionRecipeOption {
  return {
    text: displayText,
    displayText,
    searchText,
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
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  if (controlType === 'tree-select' || controlType === 'tree-select-option')
    return 'TreeSelect';
  if (controlType === 'cascader' || controlType === 'cascader-option')
    return 'Cascader';
  if (component === 'tree-select' || component === 'TreeSelect')
    return 'TreeSelect';
  if (component === 'cascader' || component === 'Cascader')
    return 'Cascader';
  return 'Select';
}

function optionDisplayTextForStep(step: FlowStep) {
  const value = step.value || step.uiRecipe?.option?.displayText || step.uiRecipe?.option?.text || step.uiRecipe?.optionText || step.context?.before.ui?.option?.text || step.context?.before.target?.selectedOption || step.context?.before.target?.text || step.target?.text;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionPathForStep(step: FlowStep) {
  const path = step.context?.before.ui?.option?.path || step.uiRecipe?.option?.path;
  return Array.isArray(path) ? path.filter(entry => typeof entry === 'string' && entry && entry !== '[object Object]') : undefined;
}

function selectSearchTextForStep(step: FlowStep) {
  const action = rawAction(step.rawAction);
  const searchText = action.searchText || step.uiRecipe?.option?.searchText;
  return typeof searchText === 'string' && searchText.trim() ? searchText.trim() : undefined;
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
  const table = step.context?.before.table || step.target?.scope?.table;
  return !!(table?.rowKey || table?.rowText || step.uiRecipe?.kind === 'table-row-action');
}

function isSelectOptionClickStep(step: FlowStep) {
  if (step.action !== 'click')
    return false;
  if (step.uiRecipe?.kind === 'select-option')
    return true;
  const target = step.context?.before.target;
  const framework = target?.framework;
  const controlType = target?.controlType;
  return (framework === 'antd' || framework === 'procomponents') && /^(select-option|tree-select-option|cascader-option)$/.test(controlType || '');
}

function isToggleStep(step: FlowStep) {
  const component = step.context?.before.ui?.component;
  return component === 'switch' || component === 'checkbox' || step.target?.role === 'switch' || step.target?.role === 'checkbox';
}

function rawAction(value: unknown) {
  const record = value && typeof value === 'object' ? value as { action?: Record<string, unknown> } & Record<string, unknown> : {};
  const action = record.action && typeof record.action === 'object' ? record.action : record;
  return action as {
    searchText?: string;
  };
}
