/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { UiActionRecipe, UiSemanticContext } from './types';

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

  if (formKind === 'modal-form' || component === 'modal-form')
    return { ...base, kind: isResetText(targetText) ? 'reset-form' : 'submit-form' };
  if (formKind === 'drawer-form' || component === 'drawer-form')
    return { ...base, kind: isResetText(targetText) ? 'reset-form' : 'submit-form' };
  if (component === 'modal')
    return { ...base, kind: 'modal-action' };
  if (component === 'drawer')
    return { ...base, kind: 'drawer-action' };

  if (fieldLabel && isFillFieldComponent(component))
    return { ...base, kind: 'fill-form-field' };
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
