/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { UiComponentKind, UiFormContext, UiLibrary, UiLocatorHint, UiOverlayContext, UiSemanticContext, UiTableContext } from './types';
import { addUnique, closestWithin, compactObject, safeText, testIdOf } from './dom';

const businessHintSelector = [
  '[data-testid]',
  '[data-test-id]',
  '[data-e2e]',
  '[data-e2e-component]',
  '[data-e2e-role]',
  '[data-e2e-action]',
  '[data-e2e-field-name]',
  '[data-e2e-field-kind]',
  '[data-e2e-form-kind]',
  '[data-e2e-table]',
  '[data-row-key]',
  '[data-column-key]',
  '[data-e2e-overlay]',
].join(', ');

const componentMap: Record<string, UiComponentKind> = {
  'button': 'button',
  'form': 'form',
  'form-item': 'form-item',
  'input': 'input',
  'textarea': 'textarea',
  'select': 'select',
  'tree-select': 'tree-select',
  'cascader': 'cascader',
  'modal': 'modal',
  'drawer': 'drawer',
  'dropdown': 'dropdown',
  'popover': 'popover',
  'popconfirm': 'popconfirm',
  'tooltip': 'tooltip',
  'table': 'table',
  'tabs': 'tabs',
  'switch': 'switch',
  'checkbox': 'checkbox',
  'radio-group': 'radio-group',
  'pro-form': 'pro-form',
  'pro-form-field': 'pro-form-field',
  'pro-table': 'pro-table',
  'pro-table-search': 'pro-table-search',
  'pro-table-toolbar': 'pro-table-toolbar',
  'editable-pro-table': 'editable-pro-table',
  'modal-form': 'modal-form',
  'drawer-form': 'drawer-form',
  'steps-form': 'steps-form',
  'beta-schema-form': 'beta-schema-form',
  'pro-descriptions': 'pro-descriptions',
  'page-container': 'page-container',
  'pro-card': 'pro-card',
  'pro-list': 'pro-list',
};

const proComponents = new Set<UiComponentKind>([
  'pro-form',
  'pro-form-field',
  'pro-table',
  'pro-table-search',
  'pro-table-toolbar',
  'editable-pro-table',
  'modal-form',
  'drawer-form',
  'steps-form',
  'beta-schema-form',
  'pro-descriptions',
  'page-container',
  'pro-card',
  'pro-list',
]);

const formKinds = new Set<UiFormContext['formKind']>(['antd-form', 'pro-form', 'modal-form', 'drawer-form', 'steps-form', 'beta-schema-form']);
const tableRegions = new Set<UiTableContext['region']>(['search', 'toolbar', 'table-body', 'row-action', 'pagination', 'batch-toolbar', 'editable-cell', 'unknown']);
const overlayTypes = new Set<UiOverlayContext['type']>(['modal', 'drawer', 'dropdown', 'select-dropdown', 'picker-dropdown', 'popover', 'popconfirm', 'tooltip']);

export function mergeBusinessHints(target: Element, base: UiSemanticContext): UiSemanticContext {
  const hintRoot = closestBusinessHint(target);
  if (!hintRoot)
    return base;

  const componentElement = closestWithAttr(target, 'data-e2e-component');
  const component = componentFor(componentElement?.getAttribute('data-e2e-component'));
  const targetTestId = nearestTestId(target) || base.targetTestId;
  const form = mergeBusinessForm(base.form, target);
  const table = mergeBusinessTable(base.table, target, component);
  const overlay = mergeBusinessOverlay(base.overlay, target);
  const locatorHints = mergeBusinessLocatorHints(base.locatorHints, targetTestId);
  const reasons = mergeReasons(base.reasons, componentElement || hintRoot, form, table, overlay, targetTestId);
  const componentPath = [...(base.componentPath ?? [base.component])];
  if (component)
    addUnique(componentPath, component);

  const library = component ? libraryFor(component) : base.library;
  const weak = component === 'unknown' ? true : base.weak;
  const confidence = Math.max(base.confidence ?? 0, targetTestId ? 0.9 : component ? 0.82 : 0.72);

  return compactObject({
    ...base,
    library,
    component: component || base.component,
    componentPath,
    targetTestId,
    form,
    table,
    overlay,
    locatorHints,
    confidence,
    weak,
    reasons,
  }) as UiSemanticContext;
}

function closestBusinessHint(target: Element) {
  return target.matches(businessHintSelector) ? target : closestWithin(target, businessHintSelector);
}

function closestWithAttr(target: Element, attr: string) {
  const selector = `[${attr}]`;
  return target.matches(selector) ? target : closestWithin(target, selector);
}

function nearestTestId(target: Element) {
  for (let current: Element | null = target; current; current = current.parentElement) {
    const testId = testIdOf(current);
    if (testId)
      return testId;
  }
  return undefined;
}

function componentFor(value?: string | null): UiComponentKind | undefined {
  const key = safeText(value, 60)?.toLowerCase();
  if (!key)
    return undefined;
  return componentMap[key] || 'unknown';
}

function libraryFor(component: UiComponentKind): UiLibrary {
  if (component === 'unknown')
    return 'unknown';
  return proComponents.has(component) ? 'pro-components' : 'antd';
}

function mergeBusinessForm(base: UiFormContext | undefined, target: Element): UiFormContext | undefined {
  const field = closestWithAttr(target, 'data-e2e-field-name') || closestWithAttr(target, 'data-e2e-field-kind') || closestWithAttr(target, 'data-e2e-form-kind');
  if (!field)
    return base;
  return compactObject({
    ...(base || {}),
    formKind: formKindFor(field.getAttribute('data-e2e-form-kind')) || base?.formKind,
    fieldKind: safeText(field.getAttribute('data-e2e-field-kind'), 60) || base?.fieldKind,
    name: safeText(field.getAttribute('data-e2e-field-name'), 80) || base?.name,
    testId: testIdOf(field) || base?.testId,
  }) as UiFormContext | undefined;
}

function mergeBusinessTable(base: UiTableContext | undefined, target: Element, component?: UiComponentKind): UiTableContext | undefined {
  const table = closestWithAttr(target, 'data-e2e-table') || closestWithin(target, '[data-testid][data-e2e-component="pro-table"], [data-testid][data-e2e-component="editable-pro-table"], [data-testid][data-e2e-component="pro-list"]');
  const row = closestWithAttr(target, 'data-row-key');
  const column = closestWithAttr(target, 'data-column-key');
  const role = closestWithAttr(target, 'data-e2e-role');
  const action = closestWithAttr(target, 'data-e2e-action');
  if (!table && !row && !column && !role && !action)
    return base;
  const region = tableRegionFor(role?.getAttribute('data-e2e-role'), action?.getAttribute('data-e2e-action'), component) || base?.region;
  return compactObject({
    ...(base || {}),
    tableKind: tableKindFor(component) || base?.tableKind,
    tableId: safeText(table?.getAttribute('data-e2e-table'), 80) || base?.tableId,
    testId: (table ? testIdOf(table) : undefined) || base?.testId,
    title: base?.title,
    rowKey: safeText(row?.getAttribute('data-row-key'), 80) || base?.rowKey,
    columnKey: safeText(column?.getAttribute('data-column-key'), 80) || base?.columnKey,
    region,
  }) as UiTableContext | undefined;
}

function mergeBusinessOverlay(base: UiOverlayContext | undefined, target: Element): UiOverlayContext | undefined {
  const overlay = closestWithAttr(target, 'data-e2e-overlay');
  if (!overlay)
    return base;
  return compactObject({
    ...(base || {}),
    type: overlayTypeFor(overlay.getAttribute('data-e2e-overlay')) || base?.type,
    title: base?.title,
    visible: base?.visible,
  }) as UiOverlayContext | undefined;
}

function mergeBusinessLocatorHints(base: UiLocatorHint[], targetTestId?: string): UiLocatorHint[] {
  if (!targetTestId || base.some(hint => hint.kind === 'testid' && hint.value === targetTestId))
    return base;
  return [{ kind: 'testid', value: targetTestId, score: 0.99, reason: 'business test id', scope: 'page' }, ...base];
}

function mergeReasons(base: string[], componentElement: Element, form?: UiFormContext, table?: UiTableContext, overlay?: UiOverlayContext, targetTestId?: string) {
  const reasons = [...(base || [])];
  addUnique(reasons, 'matched business e2e hints');
  if (componentElement.getAttribute('data-e2e-component'))
    addUnique(reasons, 'matched business component hint');
  if (form?.name || form?.fieldKind)
    addUnique(reasons, 'matched business form field hint');
  if (table?.tableId || table?.rowKey || table?.columnKey)
    addUnique(reasons, 'matched business table hint');
  if (overlay?.type)
    addUnique(reasons, 'matched business overlay hint');
  if (targetTestId)
    addUnique(reasons, 'matched business test id');
  return reasons;
}

function formKindFor(value?: string | null): UiFormContext['formKind'] | undefined {
  const normalized = safeText(value, 60) as UiFormContext['formKind'] | undefined;
  return normalized && formKinds.has(normalized) ? normalized : undefined;
}

function tableKindFor(component?: UiComponentKind): UiTableContext['tableKind'] | undefined {
  if (component === 'editable-pro-table')
    return 'editable-pro-table';
  if (component === 'pro-list')
    return 'pro-list';
  if (component === 'pro-table' || component === 'pro-table-toolbar' || component === 'pro-table-search')
    return 'pro-table';
  return undefined;
}

function tableRegionFor(role?: string | null, action?: string | null, component?: UiComponentKind): UiTableContext['region'] | undefined {
  const normalizedRole = safeText(role, 40) as UiTableContext['region'] | undefined;
  if (normalizedRole && tableRegions.has(normalizedRole))
    return normalizedRole;
  const normalizedAction = safeText(action, 40)?.toLowerCase();
  if (component === 'pro-table-toolbar' || /^(create|new|batch|import|export)$/.test(normalizedAction || ''))
    return normalizedAction === 'batch' ? 'batch-toolbar' : 'toolbar';
  if (/^(edit|delete|remove|copy|view|detail)$/.test(normalizedAction || ''))
    return 'row-action';
  if (component === 'pro-table-search')
    return 'search';
  return undefined;
}

function overlayTypeFor(value?: string | null): UiOverlayContext['type'] | undefined {
  const normalized = safeText(value, 60) as UiOverlayContext['type'] | undefined;
  return normalized && overlayTypes.has(normalized) ? normalized : undefined;
}
