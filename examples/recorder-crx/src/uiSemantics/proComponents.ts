/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { UiComponentKind, UiSemanticContext, UiTableContext } from './types';
import { addUnique, closestWithin, compactObject, elementText, labelTextForFormItem, safeText, testIdOf, textFromFirst } from './dom';

export function collectProComponentsContext(target: Element, base: UiSemanticContext): UiSemanticContext {
  const pro = closestProComponent(target);
  if (!pro)
    return base;
  const component = proComponentFor(target, pro, base);
  const componentPath = [...(base.componentPath ?? [base.component])];
  for (const item of proComponentPath(target))
    addUnique(componentPath, item);
  addUnique(componentPath, component);

  const form = mergeForm(base, target, component);
  const table = mergeTable(base, target, component, pro);
  const overlay = base.overlay ? { ...base.overlay } : undefined;
  const library = 'pro-components' as const;
  const weak = base.weak || /^(beta-schema-form|page-container|pro-card)$/.test(component);
  const reasons = [...(base.reasons ?? []), `matched ProComponents ${component}`];
  if (form?.formKind)
    reasons.push(`matched ${form.formKind}`);
  if (table?.tableKind)
    reasons.push(`matched ${table.tableKind}`);

  return compactObject({
    ...base,
    library,
    component,
    componentPath,
    form,
    table,
    overlay,
    weak,
    confidence: Math.max(base.confidence ?? 0, weak ? 0.62 : 0.84),
    reasons,
  }) as UiSemanticContext;
}

function closestProComponent(target: Element) {
  return closestWithin(target, [
    '.editable-pro-table',
    '.ant-pro-table',
    '.modal-form',
    '.drawer-form',
    '.steps-form',
    '.beta-schema-form',
    '.ant-pro-descriptions',
    '.ant-pro-page-container',
    '.ant-pro-card',
    '.ant-pro-list',
    '.ant-pro-form',
    '[class*="ant-pro-"]',
  ].join(', '));
}

function proComponentFor(target: Element, pro: Element, base: UiSemanticContext): UiComponentKind {
  const classes = pro.getAttribute('class') || '';
  if (classes.includes('editable-pro-table') || closestWithin(target, '.editable-pro-table'))
    return 'editable-pro-table';
  if (closestWithin(target, '.modal-form'))
    return 'modal-form';
  if (closestWithin(target, '.drawer-form'))
    return 'drawer-form';
  if (closestWithin(target, '.steps-form'))
    return 'steps-form';
  if (closestWithin(target, '.beta-schema-form'))
    return 'beta-schema-form';
  if (closestWithin(target, '.ant-pro-descriptions'))
    return 'pro-descriptions';
  if (closestWithin(target, '.ant-pro-list'))
    return 'pro-list';
  if (closestWithin(target, '.ant-pro-table'))
    return 'pro-table';
  if (closestWithin(target, '.ant-pro-card'))
    return 'pro-card';
  if (closestWithin(target, '.ant-pro-page-container'))
    return 'page-container';
  if (closestWithin(target, '.ant-pro-form'))
    return base.form ? 'pro-form-field' : 'pro-form';
  return 'pro-form';
}

function proComponentPath(target: Element): UiComponentKind[] {
  const path: UiComponentKind[] = [];
  if (closestWithin(target, '.ant-pro-page-container'))
    path.push('page-container');
  if (closestWithin(target, '.ant-pro-card'))
    path.push('pro-card');
  if (closestWithin(target, '.ant-pro-table'))
    path.push('pro-table');
  if (closestWithin(target, '.editable-pro-table'))
    path.push('editable-pro-table');
  if (closestWithin(target, '.ant-pro-list'))
    path.push('pro-list');
  if (closestWithin(target, '.ant-pro-form'))
    path.push('pro-form');
  if (closestWithin(target, '.modal-form'))
    path.push('modal-form');
  if (closestWithin(target, '.drawer-form'))
    path.push('drawer-form');
  if (closestWithin(target, '.steps-form'))
    path.push('steps-form');
  if (closestWithin(target, '.beta-schema-form'))
    path.push('beta-schema-form');
  if (closestWithin(target, '.ant-pro-descriptions'))
    path.push('pro-descriptions');
  return path;
}

function mergeForm(base: UiSemanticContext, target: Element, component: UiComponentKind) {
  const form = { ...(base.form ?? {}) };
  const proForm = closestWithin(target, '.ant-pro-form, .modal-form, .drawer-form, .steps-form, .beta-schema-form');
  if (!proForm && !base.form)
    return undefined;
  form.formKind = formKindFor(target, component) ?? form.formKind ?? 'pro-form';
  form.formTitle = form.formTitle || formTitle(target, proForm);
  form.formName = form.formName || proForm?.getAttribute('name') || undefined;
  const item = closestWithin(target, '.ant-form-item');
  form.label = form.label || labelTextForFormItem(item) || searchFormPrimaryLabel(target);
  form.name = form.name || target.getAttribute('name') || target.querySelector('input, textarea, select')?.getAttribute('name') || undefined;
  form.fieldKind = form.fieldKind || base.form?.fieldKind || fieldKindFromProWrapper(target);
  return compactObject(form);
}

function searchFormPrimaryLabel(target: Element) {
  const searchForm = closestWithin(target, '.ant-pro-table-search');
  return searchForm ? textFromFirst('.ant-form-item-label label, label', searchForm) : undefined;
}

function formKindFor(target: Element, component: UiComponentKind) {
  if (component === 'modal-form' || closestWithin(target, '.modal-form'))
    return 'modal-form';
  if (component === 'drawer-form' || closestWithin(target, '.drawer-form'))
    return 'drawer-form';
  if (component === 'steps-form' || closestWithin(target, '.steps-form'))
    return 'steps-form';
  if (component === 'beta-schema-form' || closestWithin(target, '.beta-schema-form'))
    return 'beta-schema-form';
  if (closestWithin(target, '.ant-pro-form'))
    return 'pro-form';
  return undefined;
}

function fieldKindFromProWrapper(target: Element) {
  const className = closestWithin(target, '.ant-form-item, [class*="pro-form"]')?.getAttribute('class') || '';
  if (/select/i.test(className))
    return 'select';
  if (/date/i.test(className))
    return 'date-picker';
  if (/switch/i.test(className))
    return 'switch';
  if (/checkbox/i.test(className))
    return 'checkbox';
  if (/radio/i.test(className))
    return 'radio';
  return undefined;
}

function formTitle(target: Element, proForm?: Element) {
  return textFromFirst('.ant-modal-title, .ant-drawer-title, .ant-steps-item-active, h1, h2, h3, h4, [class*="title"]', proForm || undefined) ||
    textFromFirst('.ant-modal-title, .ant-drawer-title', closestWithin(target, '.ant-modal, .ant-drawer') || undefined);
}

function mergeTable(base: UiSemanticContext, target: Element, component: UiComponentKind, pro: Element): UiTableContext | undefined {
  const table = { ...(base.table ?? {}) };
  if (!base.table && !/^(pro-table|editable-pro-table|pro-list)$/.test(component))
    return undefined;
  table.tableKind = tableKindFor(component);
  table.title = table.title || proTitle(pro, target);
  const row = closestWithin(target, 'tr[data-row-key], .ant-table-row, .ant-list-item[data-row-key], [role="row"]');
  table.rowKey = table.rowKey || row?.getAttribute('data-row-key') || row?.getAttribute('data-key') || undefined;
  table.rowText = table.rowText || elementText(row, 160);
  table.columnTitle = table.columnTitle || columnTitleFor(target, row);
  table.region = regionFor(target, component, table.region);
  return compactObject(table) as UiTableContext | undefined;
}

function tableKindFor(component: UiComponentKind): UiTableContext['tableKind'] {
  if (component === 'editable-pro-table')
    return 'editable-pro-table';
  if (component === 'pro-list')
    return 'pro-list';
  return 'pro-table';
}

function proTitle(pro: Element, target: Element) {
  return textFromFirst('.ant-pro-table-list-toolbar-title, .ant-pro-card-title, h1, h2, h3, h4, [class*="title"]', pro) ||
    textFromFirst('h1, h2, h3, h4, [class*="title"]', closestWithin(target, '.ant-pro-page-container, .ant-pro-card, .ant-pro-list') || undefined) ||
    safeText(pro.getAttribute('aria-label')) || testIdOf(pro);
}

function columnTitleFor(target: Element, row?: Element) {
  const cell = closestWithin(target, 'td, th, [role="cell"], [role="gridcell"]');
  if (!cell || !row)
    return undefined;
  const cells = Array.from(row.children);
  const index = cells.indexOf(cell);
  const table = closestWithin(row, 'table, .ant-table, [role="table"], [role="grid"]');
  const headers = table ? Array.from(table.querySelectorAll('th, [role="columnheader"]')).map(header => elementText(header)).filter(Boolean) : [];
  return index >= 0 ? headers[index] : undefined;
}

function regionFor(target: Element, component: UiComponentKind, current?: UiTableContext['region']): UiTableContext['region'] {
  if (closestWithin(target, '.ant-pro-table-search'))
    return 'search';
  if (closestWithin(target, '.ant-pro-table-list-toolbar'))
    return 'toolbar';
  if (component === 'editable-pro-table')
    return 'editable-cell';
  if (component === 'pro-list')
    return 'row-action';
  return current || 'table-body';
}
