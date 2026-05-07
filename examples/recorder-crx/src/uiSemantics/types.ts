/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

export type UiLibrary = 'antd' | 'pro-components' | 'unknown';

export type UiComponentKind =
  | 'button'
  | 'form'
  | 'form-item'
  | 'input'
  | 'input-number'
  | 'textarea'
  | 'select'
  | 'tree-select'
  | 'cascader'
  | 'auto-complete'
  | 'date-picker'
  | 'range-picker'
  | 'time-picker'
  | 'modal'
  | 'drawer'
  | 'dropdown'
  | 'menu'
  | 'popover'
  | 'popconfirm'
  | 'tooltip'
  | 'table'
  | 'pagination'
  | 'tabs'
  | 'steps'
  | 'upload'
  | 'switch'
  | 'checkbox'
  | 'radio-group'
  | 'tree'
  | 'collapse'
  | 'card'
  | 'pro-form'
  | 'pro-form-field'
  | 'pro-table'
  | 'pro-table-search'
  | 'pro-table-toolbar'
  | 'editable-pro-table'
  | 'modal-form'
  | 'drawer-form'
  | 'steps-form'
  | 'beta-schema-form'
  | 'pro-descriptions'
  | 'page-container'
  | 'pro-card'
  | 'pro-list'
  | 'unknown';

export interface UiLocatorHint {
  kind: 'testid' | 'role' | 'label' | 'text' | 'css';
  value: string;
  score: number;
  reason: string;
  scope?: 'page' | 'dialog' | 'drawer' | 'form' | 'table' | 'section' | 'overlay';
}

export interface UiOverlayContext {
  type?: 'modal' | 'drawer' | 'dropdown' | 'select-dropdown' | 'picker-dropdown' | 'popover' | 'popconfirm' | 'tooltip';
  title?: string;
  text?: string;
  visible?: boolean;
}

export interface UiFormContext {
  formKind?: 'antd-form' | 'pro-form' | 'modal-form' | 'drawer-form' | 'steps-form' | 'beta-schema-form';
  formTitle?: string;
  formName?: string;
  fieldKind?: string;
  label?: string;
  name?: string;
  dataIndex?: string;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  status?: 'error' | 'warning' | 'success' | 'validating';
  valuePreview?: string;
}

export interface UiTableContext {
  tableKind?: 'antd-table' | 'pro-table' | 'editable-pro-table' | 'pro-list';
  title?: string;
  rowKey?: string;
  rowText?: string;
  columnKey?: string;
  columnTitle?: string;
  dataIndex?: string;
  headers?: string[];
  selectedRowCount?: number;
  totalText?: string;
  currentPage?: string;
  pageSize?: string;
  region?: 'search' | 'toolbar' | 'table-body' | 'row-action' | 'pagination' | 'batch-toolbar' | 'editable-cell' | 'unknown';
}

export interface UiOptionContext {
  text?: string;
  value?: string;
  path?: string[];
}

export interface UiActionRecipe {
  kind:
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
  library: UiLibrary;
  component: UiComponentKind;
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

export interface UiSemanticContext {
  library: UiLibrary;
  component: UiComponentKind;
  componentPath?: UiComponentKind[];
  targetText?: string;
  targetTestId?: string;
  targetRole?: string;
  form?: UiFormContext;
  table?: UiTableContext;
  overlay?: UiOverlayContext;
  option?: UiOptionContext;
  locatorHints: UiLocatorHint[];
  recipe?: UiActionRecipe;
  confidence: number;
  weak?: boolean;
  reasons: string[];
}
