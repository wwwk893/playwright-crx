/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { UiComponentKind, UiLibrary, UiSemanticContext } from './types';

export type UiActionFramework = 'antd' | 'procomponents' | 'generic';

export type UiActionRecipeComponent =
  | 'Input'
  | 'Select'
  | 'TreeSelect'
  | 'Cascader'
  | 'TableRowAction'
  | 'ModalButton'
  | 'PopconfirmButton'
  | 'Switch'
  | 'Checkbox'
  | 'Button'
  | UiComponentKind;

export type UiActionOperation = 'fill' | 'selectOption' | 'click' | 'confirm' | 'toggle' | 'rowAction';

export type LegacyUiActionRecipeKind =
  | 'click-button'
  | 'fill-form-field'
  | 'select-option'
  | 'pick-date'
  | 'pick-range'
  | 'pick-time'
  | 'toggle-control'
  | 'upload-file'
  | 'submit-form'
  | 'reset-form'
  | 'protable-search'
  | 'protable-reset-search'
  | 'protable-toolbar-action'
  | 'table-row-action'
  | 'table-batch-action'
  | 'editable-table-cell'
  | 'editable-table-save-row'
  | 'editable-table-cancel-row'
  | 'paginate'
  | 'sort-table'
  | 'filter-table'
  | 'modal-action'
  | 'drawer-action'
  | 'confirm-popconfirm'
  | 'dropdown-menu-action'
  | 'show-tooltip'
  | 'switch-tab'
  | 'switch-step'
  | 'assert-description-field'
  | 'raw-dom-action';

export type UiActionRecipeTarget = {
  testId?: string;
  label?: string;
  name?: string;
  placeholder?: string;
  fieldName?: string;
  role?: string;
  text?: string;
  dialog?: unknown;
  table?: unknown;
  row?: unknown;
};

export type UiActionRecipeOption = {
  text?: string;
  searchText?: string;
  displayText?: string;
  exactTokens?: string[];
  path?: string[];
};

export type UiReplayRuntimeFallback =
  | 'active-antd-popup-option'
  | 'duplicate-testid-ordinal'
  | 'active-popconfirm-confirm';

export type UiReplayExportedStrategy =
  | 'locator-click'
  | 'locator-fill'
  | 'native-select-option'
  | 'antd-owned-option-dispatch'
  | 'antd-tree-option-dispatch'
  | 'antd-cascader-path-dispatch'
  | 'table-row-action'
  | 'dialog-scoped-button'
  | 'popover-confirm'
  | 'control-toggle';

export type UiReplayParserSafeStrategy =
  | 'simple-locator-action'
  | 'native-select-option'
  | 'field-trigger-search-option'
  | 'active-popup-option'
  | 'table-row-scoped-action'
  | 'dialog-scoped-action';

export type UiActionReplayContract = {
  exportedStrategy?: UiReplayExportedStrategy;
  parserSafeStrategy?: UiReplayParserSafeStrategy;
  runtimeFallback?: UiReplayRuntimeFallback;
};

export interface UiActionRecipe {
  // PR-07 structured recipe contract. Optional while legacy page-context recipes
  // continue to feed the current code preview/runtime until PR-08 renderer split.
  version?: 1;
  framework?: UiActionFramework;
  operation?: UiActionOperation;
  target?: UiActionRecipeTarget;
  value?: string;
  option?: UiActionRecipeOption;
  replay?: UiActionReplayContract;

  // Legacy compact fields stay source-compatible so existing codePreview,
  // compact export, and AI-intent surfaces do not change behavior in PR-07.
  kind: LegacyUiActionRecipeKind;
  library: UiLibrary;
  component: UiActionRecipeComponent;
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
}

export function buildUiRecipe(ui: UiSemanticContext): UiActionRecipe {
  const targetText = ui.targetText;
  const fieldLabel = ui.form?.label;
  const fieldName = ui.form?.name;
  const optionText = ui.option?.text;
  const tableTitle = ui.table?.title || ui.table?.tableId || ui.table?.testId;
  const rowKey = ui.table?.rowKey;
  const columnTitle = ui.table?.columnTitle || ui.table?.columnKey;
  const overlayTitle = ui.overlay?.title;
  const formKind = ui.form?.formKind;
  const fieldKind = ui.form?.fieldKind;
  const component = ui.component;
  const base = {
    library: ui.library,
    component,
    formKind,
    fieldKind,
    fieldLabel,
    fieldName,
    optionText,
    tableTitle,
    rowKey,
    columnTitle,
    overlayTitle,
    targetText,
  };

  if (component === 'pro-descriptions')
    return { ...base, kind: 'assert-description-field' };
  if (component === 'steps-form')
    return { ...base, kind: 'switch-step' };
  if (ui.table?.region === 'search')
    return { ...base, kind: isResetText(targetText) ? 'protable-reset-search' : 'protable-search' };
  if (ui.table?.region === 'toolbar')
    return { ...base, kind: 'protable-toolbar-action' };
  if (component === 'editable-pro-table' || ui.table?.region === 'editable-cell')
    return { ...base, kind: 'editable-table-cell' };
  if ((component === 'pro-list' || ui.table?.region === 'row-action') && (rowKey || tableTitle))
    return { ...base, kind: 'table-row-action' };
  if (component === 'pagination')
    return { ...base, kind: 'paginate' };

  if (component === 'select' || component === 'tree-select' || component === 'cascader')
    return { ...base, kind: optionText ? 'select-option' : 'raw-dom-action' };
  if (component === 'date-picker')
    return { ...base, kind: 'pick-date' };
  if (component === 'range-picker')
    return { ...base, kind: 'pick-range' };
  if (component === 'time-picker')
    return { ...base, kind: 'pick-time' };
  if (component === 'switch' || component === 'checkbox' || component === 'radio-group')
    return { ...base, kind: 'toggle-control' };
  if (component === 'upload')
    return { ...base, kind: 'upload-file' };
  if (component === 'tabs')
    return { ...base, kind: 'switch-tab' };
  if (component === 'dropdown')
    return { ...base, kind: 'dropdown-menu-action' };
  if (component === 'popconfirm')
    return { ...base, kind: 'confirm-popconfirm' };
  if (component === 'tooltip')
    return { ...base, kind: 'show-tooltip' };
  if (component === 'popover')
    return { ...base, kind: 'raw-dom-action' };

  if (fieldLabel && isFillFieldComponent(component))
    return { ...base, kind: 'fill-form-field' };
  if (formKind === 'modal-form' || component === 'modal-form')
    return { ...base, kind: isResetText(targetText) ? 'reset-form' : 'submit-form' };
  if (formKind === 'drawer-form' || component === 'drawer-form')
    return { ...base, kind: isResetText(targetText) ? 'reset-form' : 'submit-form' };
  if (component === 'modal')
    return { ...base, kind: 'modal-action' };
  if (component === 'drawer')
    return { ...base, kind: 'drawer-action' };

  if (component === 'form')
    return { ...base, kind: isResetText(targetText) ? 'reset-form' : isSubmitText(targetText) ? 'submit-form' : 'raw-dom-action' };
  if (component === 'button' || targetText)
    return { ...base, kind: 'click-button' };
  return { ...base, kind: 'raw-dom-action' };
}

function isFillFieldComponent(component: string) {
  return /^(input|input-number|textarea|date-picker|range-picker|time-picker|pro-form-field|beta-schema-form)$/.test(component);
}

function isSubmitText(text?: string) {
  return !!text && /提交|保存|确定|确 定|确认|完成|创建|新建/.test(text);
}

function isResetText(text?: string) {
  return !!text && /重置|清空|取消/.test(text);
}
