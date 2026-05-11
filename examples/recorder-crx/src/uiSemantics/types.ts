/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import type { UiActionRecipe } from './recipes';
export type { UiActionRecipe } from './recipes';

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
  testId?: string;
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
  tableId?: string;
  testId?: string;
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
