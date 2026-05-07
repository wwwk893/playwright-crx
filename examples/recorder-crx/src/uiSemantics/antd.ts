/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { UiComponentKind, UiFormContext, UiLibrary, UiLocatorHint, UiOverlayContext, UiSemanticContext, UiTableContext } from './types';
import { addUnique, closestWithin, compactObject, elementText, fieldNameFor, isVisible, labelTextForFormItem, roleFor, safeText, testIdOf, textFromFirst, unique, visibleOverlays } from './dom';

const overlaySelector = '.ant-modal, .ant-drawer, .ant-dropdown, .ant-select-dropdown, .ant-cascader-dropdown, .ant-popover, .ant-tooltip, [role="dialog"]';

export function collectAntdSemanticContext(target: Element, document: Document): UiSemanticContext {
  const anchor = actionAnchorForElement(target);
  const component = detectAntdComponent(anchor, target);
  const componentPath = collectAntdComponentPath(anchor, target, component);
  const overlay = collectOverlay(anchor, target, document);
  const form = collectForm(anchor, component);
  const table = collectTable(anchor, component);
  const option = collectOption(anchor, component);
  const targetText = safeText(anchor.getAttribute('aria-label')) || option?.text || elementText(anchor) || safeText(anchor.getAttribute('title'));
  const targetTestId = testIdOf(anchor);
  const targetRole = roleFor(anchor, component);
  const library: UiLibrary = component === 'unknown' ? 'unknown' : 'antd';
  const reasons = collectReasons({ component, componentPath, overlay, form, table, option, targetTestId, targetText });
  const locatorHints = buildLocatorHints(anchor, { component, targetText, targetTestId, targetRole, form, table, overlay });
  const weak = component === 'unknown' || component === 'popover' || component === 'tooltip';
  return compactObject({
    library,
    component,
    componentPath: unique(componentPath.length ? componentPath : [component]),
    targetText,
    targetTestId,
    targetRole,
    form,
    table,
    overlay,
    option,
    locatorHints,
    confidence: confidenceFor(component, locatorHints, weak),
    weak,
    reasons,
  }) as UiSemanticContext;
}

export function actionAnchorForElement(element: Element): Element {
  const candidates: Element[] = [];
  for (let current: Element | null = element, depth = 0; current && depth < 12; current = current.parentElement, depth++) {
    if (isPotentialAnchor(current))
      candidates.push(current);
  }
  return (candidates.length ? candidates : [element]).sort((a, b) => anchorScore(b, element) - anchorScore(a, element))[0];
}

function isPotentialAnchor(element: Element) {
  const tag = element.tagName.toLowerCase();
  return !!testIdOf(element) || /^(button|a|input|textarea|select|label)$/i.test(tag) ||
    element.matches([
      '.ant-btn', '.ant-select-selector', '.ant-select', '.ant-tree-select', '.ant-cascader', '.ant-cascader-picker',
      '.ant-select-item-option', '.ant-select-tree-treenode', '.ant-tree-treenode', '.ant-select-tree-node-content-wrapper', '.ant-cascader-menu-item',
      '.ant-dropdown-menu-item', '.ant-menu-item', '.ant-pagination-item', '.ant-tabs-tab', '.ant-picker', '.ant-upload', '.ant-upload-select',
      '.ant-switch', '.ant-checkbox-wrapper', '.ant-checkbox', '.ant-radio-wrapper', '.ant-radio-button-wrapper', '.ant-radio', '.ant-radio-button',
      '.ant-descriptions-item', '.ant-list-item', 'td', 'th', '[role="button"]', '[role="option"]', '[role="treeitem"]', '[role="menuitem"]', '[role="tab"]', '[role="switch"]', '[role="checkbox"]', '[role="radio"]', '[role="row"]',
    ].join(', '));
}

function anchorScore(element: Element, original: Element) {
  const className = element.getAttribute('class') || '';
  const tag = element.tagName.toLowerCase();
  const role = element.getAttribute('role') || '';
  let score = 0;
  if (testIdOf(element)) {
    const testId = testIdOf(element) || '';
    score += element === original || /(^|[-_])(button|btn|link|tab|switch|checkbox|radio|select|input|create|add|new|save|delete|remove|edit|confirm|cancel|submit|ok|option|menu)([-_]|$)/i.test(testId) ? (ancestorDistance(original, element) <= 2 ? 1000 : 180) : 140;
  }
  if (tag === 'button' || className.includes('ant-btn') || role === 'button')
    score += 520;
  if (className.includes('ant-radio-button-wrapper') || className.includes('ant-checkbox-wrapper') || className.includes('ant-radio-wrapper'))
    score += 500;
  if (className.includes('ant-select-tree-treenode') || className.includes('ant-tree-treenode') || role === 'treeitem')
    score += 485;
  if (className.includes('ant-cascader-menu-item'))
    score += 480;
  if (className.includes('ant-select-item-option') || role === 'option')
    score += 470;
  if (className.includes('ant-select-selector') || className.includes('ant-cascader-picker'))
    score += 430;
  if (className.includes('ant-picker') || className.includes('ant-upload'))
    score += 390;
  if (className.includes('ant-switch') || role === 'switch')
    score += 380;
  if (className.includes('ant-checkbox') || role === 'checkbox' || className.includes('ant-radio') || role === 'radio')
    score += 360;
  if (className.includes('ant-tabs-tab') || role === 'tab')
    score += 350;
  if (className.includes('ant-dropdown-menu-item') || className.includes('ant-menu-item') || role === 'menuitem')
    score += 340;
  if (tag === 'input' || tag === 'textarea' || tag === 'select')
    score += 330;
  if (tag === 'svg' || className.includes('anticon'))
    score -= 400;
  return score - ancestorDistance(original, element);
}

function ancestorDistance(original: Element, candidate: Element) {
  let distance = 0;
  for (let current: Element | null = original; current; current = current.parentElement) {
    if (current === candidate)
      return distance;
    distance += 1;
  }
  return 20;
}

function detectAntdComponent(anchor: Element, rawTarget: Element): UiComponentKind {
  const className = anchor.getAttribute('class') || '';
  const tag = anchor.tagName.toLowerCase();
  const role = anchor.getAttribute('role') || '';
  if (closestWithin(anchor, '.ant-tooltip') || tooltipForTrigger(anchor))
    return 'tooltip';
  const triggerPopover = popoverForTrigger(anchor);
  if (triggerPopover)
    return isPopconfirm(triggerPopover) ? 'popconfirm' : 'popover';
  if (isPopconfirm(anchor))
    return 'popconfirm';
  if (closestWithin(anchor, '.ant-popover'))
    return 'popover';
  if (closestWithin(anchor, '.ant-dropdown') || className.includes('ant-dropdown-menu-item') || className.includes('ant-menu-item') || role === 'menuitem')
    return 'dropdown';
  if (className.includes('ant-select-tree-treenode') || className.includes('ant-tree-treenode') || role === 'treeitem' || closestWithin(anchor, '.ant-select-tree-treenode, .ant-tree-treenode'))
    return 'tree-select';
  if (className.includes('ant-cascader-menu-item') || closestWithin(anchor, '.ant-cascader-dropdown') || closestWithin(anchor, '.ant-cascader'))
    return 'cascader';
  if (className.includes('ant-select-item-option') || role === 'option' || closestWithin(anchor, '.ant-select-dropdown') || closestWithin(anchor, '.ant-select'))
    return 'select';
  if (className.includes('ant-picker-range') || closestWithin(anchor, '.ant-picker-range'))
    return 'range-picker';
  if (className.includes('ant-picker'))
    return 'date-picker';
  if (className.includes('ant-upload') || closestWithin(anchor, '.ant-upload'))
    return 'upload';
  if (className.includes('ant-switch') || role === 'switch')
    return 'switch';
  if (className.includes('ant-checkbox') || role === 'checkbox' || closestWithin(anchor, '.ant-checkbox-wrapper'))
    return 'checkbox';
  if (className.includes('ant-radio') || role === 'radio' || closestWithin(anchor, '.ant-radio-wrapper, .ant-radio-button-wrapper'))
    return 'radio-group';
  if (className.includes('ant-tabs-tab') || role === 'tab')
    return 'tabs';
  if (className.includes('ant-pagination') || closestWithin(anchor, '.ant-pagination'))
    return 'pagination';
  if (closestWithin(anchor, '.ant-modal'))
    return 'modal';
  if (closestWithin(anchor, '.ant-drawer'))
    return 'drawer';
  if (closestWithin(anchor, '.ant-table-wrapper, .ant-table, table, [role="table"], [role="grid"]') || closestWithin(rawTarget, 'tr[data-row-key], .ant-table-row, [role="row"]'))
    return 'table';
  if (tag === 'textarea')
    return 'textarea';
  if (closestWithin(anchor, '.ant-input-number'))
    return 'input-number';
  if (tag === 'input' || tag === 'select')
    return 'input';
  if (closestWithin(anchor, '.ant-form-item, .ant-form'))
    return tag === 'button' || className.includes('ant-btn') ? 'form' : 'form-item';
  if (tag === 'button' || className.includes('ant-btn') || role === 'button')
    return 'button';
  return 'unknown';
}

function collectAntdComponentPath(anchor: Element, rawTarget: Element, component: UiComponentKind): UiComponentKind[] {
  const path: UiComponentKind[] = [];
  addUnique(path, component);
  if (closestWithin(anchor, '.ant-form-item'))
    addUnique(path, 'form-item');
  if (closestWithin(anchor, '.ant-form'))
    addUnique(path, 'form');
  if (closestWithin(anchor, '.ant-table-wrapper, .ant-table, table, [role="table"], [role="grid"]') || closestWithin(rawTarget, 'tr[data-row-key], .ant-table-row, [role="row"]'))
    addUnique(path, 'table');
  const overlay = closestWithin(anchor, overlaySelector) || tooltipForTrigger(anchor) || popoverForTrigger(anchor);
  const overlayType = overlay ? overlayTypeFor(overlay) : undefined;
  if (overlayType === 'modal')
    addUnique(path, 'modal');
  if (overlayType === 'drawer')
    addUnique(path, 'drawer');
  if (overlayType === 'dropdown')
    addUnique(path, 'dropdown');
  if (overlayType === 'popover' && overlay)
    addUnique(path, isPopconfirm(overlay) ? 'popconfirm' : 'popover');
  if (overlayType === 'tooltip')
    addUnique(path, 'tooltip');
  return path;
}

function collectForm(anchor: Element, component: UiComponentKind): UiFormContext | undefined {
  const item = closestWithin(anchor, '.ant-form-item, .ant-pro-form-group, .ant-pro-form-list, [role="group"]') || closestWithin(anchor, 'label');
  const form = closestWithin(anchor, 'form, .ant-form');
  if (!item && !form && !isFormControlComponent(component))
    return undefined;
  const input = anchor.matches('input, textarea, select') ? anchor : anchor.querySelector('input, textarea, select');
  const nameInfo = fieldNameFor(anchor);
  const label = labelTextForFormItem(item) || safeText(anchor.getAttribute('aria-label')) || safeText((input as HTMLInputElement | null)?.placeholder) || elementText(closestWithin(anchor, 'label'));
  const status = statusForFormItem(item);
  return compactObject({
    formKind: 'antd-form',
    formTitle: textFromFirst('legend, h1, h2, h3, h4, [class*="title"]', form || undefined),
    formName: form?.getAttribute('name') || undefined,
    fieldKind: fieldKindFor(component),
    label,
    name: nameInfo.name,
    dataIndex: anchor.getAttribute('data-index') || undefined,
    namePath: nameInfo.namePath,
    required: !!item?.querySelector('.ant-form-item-required, [aria-required="true"], [required]') || item?.classList.contains('ant-form-item-required') || input?.hasAttribute('required'),
    placeholder: safeText((input as HTMLInputElement | null)?.placeholder || anchor.querySelector<HTMLInputElement>('input[placeholder], textarea[placeholder]')?.placeholder),
    helpText: textFromFirst('.ant-form-item-explain, .ant-form-item-extra', item || undefined),
    status,
  }) as UiFormContext | undefined;
}

function isFormControlComponent(component: UiComponentKind) {
  return /^(input|input-number|textarea|select|tree-select|cascader|date-picker|range-picker|time-picker|upload|switch|checkbox|radio-group)$/.test(component);
}

function fieldKindFor(component: UiComponentKind) {
  if (component === 'radio-group')
    return 'radio';
  if (component === 'range-picker')
    return 'range-picker';
  return isFormControlComponent(component) ? component : undefined;
}

function statusForFormItem(item?: Element): UiFormContext['status'] | undefined {
  const className = item?.getAttribute('class') || '';
  if (className.includes('has-error'))
    return 'error';
  if (className.includes('has-warning'))
    return 'warning';
  if (className.includes('has-success'))
    return 'success';
  if (className.includes('is-validating'))
    return 'validating';
  return undefined;
}

function collectTable(anchor: Element, component: UiComponentKind): UiTableContext | undefined {
  const row = closestWithin(anchor, 'tr[data-row-key], .ant-table-row, [role="row"], .ant-list-item[data-row-key]');
  const tableRoot = closestWithin(anchor, '.ant-table-wrapper, .ant-table, table, [role="table"], [role="grid"], .ant-pro-table, .ant-pro-list');
  if (!row && !tableRoot && component !== 'pagination')
    return undefined;
  const table = closestWithin(anchor, 'table, .ant-table, [role="table"], [role="grid"]') || tableRoot;
  const headers = table ? Array.from(table.querySelectorAll('th, [role="columnheader"]')).map(header => elementText(header)).filter((text): text is string => !!text).slice(0, 16) : [];
  const cell = closestWithin(anchor, 'td, th, [role="cell"], [role="gridcell"]');
  const rowChildren = row ? Array.from(row.children) : [];
  const columnIndex = cell ? rowChildren.indexOf(cell) : -1;
  const rowKey = row?.getAttribute('data-row-key') || row?.getAttribute('data-key') || undefined;
  const rowText = elementText(row, 160);
  const title = tableTitle(tableRoot || table || row);
  return compactObject({
    tableKind: 'antd-table',
    title,
    rowKey,
    rowText,
    columnTitle: columnIndex >= 0 ? headers[columnIndex] : undefined,
    columnKey: cell?.getAttribute('data-column-key') || undefined,
    headers,
    currentPage: component === 'pagination' ? elementText(anchor) : textFromFirst('.ant-pagination-item-active', tableRoot || undefined),
    region: tableRegion(anchor, component, columnIndex),
  }) as UiTableContext | undefined;
}

function tableTitle(root?: Element | null) {
  if (!root)
    return undefined;
  return textFromFirst('.ant-pro-table-list-toolbar-title, .ant-pro-card-title, .ant-card-head-title, h1, h2, h3, h4, [class*="title"]', root) || textFromFirst('h1, h2, h3, h4, [class*="title"]', root.parentElement || undefined);
}

function tableRegion(anchor: Element, component: UiComponentKind, columnIndex: number): UiTableContext['region'] {
  if (component === 'pagination' || closestWithin(anchor, '.ant-pagination'))
    return 'pagination';
  if (closestWithin(anchor, '.ant-pro-table-search'))
    return 'search';
  if (closestWithin(anchor, '.ant-pro-table-list-toolbar'))
    return 'toolbar';
  if (component === 'input' && closestWithin(anchor, 'td, [role="cell"], [role="gridcell"]'))
    return 'editable-cell';
  if (columnIndex >= 0)
    return 'row-action';
  return 'table-body';
}

function collectOverlay(anchor: Element, rawTarget: Element, document: Document): UiOverlayContext | undefined {
  const overlay = closestWithin(anchor, overlaySelector) || closestWithin(rawTarget, overlaySelector) || tooltipForTrigger(anchor) || popoverForTrigger(anchor) || visibleOverlayForTrigger(anchor, document);
  if (!overlay)
    return undefined;
  const type = overlayTypeFor(overlay);
  return compactObject({
    type: isPopconfirm(overlay) ? 'popconfirm' : type,
    title: overlayTitle(overlay, type),
    text: elementText(overlay, 120),
    visible: isVisible(overlay),
  }) as UiOverlayContext | undefined;
}

function tooltipForTrigger(anchor: Element) {
  const describedBy = anchor.getAttribute('aria-describedby');
  if (!describedBy)
    return undefined;
  const tooltip = anchor.ownerDocument.getElementById(describedBy);
  return tooltip?.matches('.ant-tooltip, [role="tooltip"]') ? tooltip : undefined;
}

function popoverForTrigger(anchor: Element) {
  const text = elementText(anchor) || '';
  if (!text)
    return undefined;
  return visibleOverlays(anchor.ownerDocument, '.ant-popover')
      .find(popover => {
        const title = overlayTitle(popover, 'popover') || '';
        return title && text.includes(title);
      });
}

function visibleOverlayForTrigger(anchor: Element, document: Document) {
  if (closestWithin(anchor, '.ant-select, .ant-cascader, .ant-dropdown, .ant-picker'))
    return visibleOverlays(document, overlaySelector)[0];
  return undefined;
}

function overlayTypeFor(overlay: Element): UiOverlayContext['type'] {
  const className = overlay.getAttribute('class') || '';
  if (className.includes('ant-tooltip'))
    return 'tooltip';
  if (className.includes('ant-popover'))
    return 'popover';
  if (className.includes('ant-drawer'))
    return 'drawer';
  if (className.includes('ant-dropdown'))
    return 'dropdown';
  if (className.includes('ant-select-dropdown'))
    return 'select-dropdown';
  if (className.includes('ant-cascader-dropdown'))
    return 'select-dropdown';
  return 'modal';
}

function overlayTitle(overlay: Element, type?: UiOverlayContext['type']) {
  if (type === 'tooltip')
    return textFromFirst('.ant-tooltip-inner, [role="tooltip"]', overlay);
  return textFromFirst('.ant-modal-title, .ant-drawer-title, .ant-popover-title, .ant-popconfirm-title, h1, h2, h3, h4, [class*="title"]', overlay);
}

function isPopconfirm(element: Element) {
  const popover = closestWithin(element, '.ant-popover') || (element.matches('.ant-popover') ? element : undefined);
  if (!popover)
    return false;
  const text = elementText(popover, 140) || '';
  return popover.className.includes('popconfirm') || /确认|确定|取消|删除/.test(text) && !!popover.querySelector('button, .ant-btn');
}

function collectOption(anchor: Element, component: UiComponentKind) {
  if (!/^(select|tree-select|cascader|dropdown)$/.test(component))
    return undefined;
  const text = optionText(anchor, component);
  const path = optionPath(anchor, component, text);
  return compactObject({ text, value: anchor.getAttribute('data-value') || anchor.getAttribute('title') || text, path });
}

function optionText(anchor: Element, component: UiComponentKind) {
  if (component === 'select' || component === 'tree-select' || component === 'cascader' || component === 'dropdown')
    return safeText(anchor.getAttribute('title')) || elementText(anchor);
  return undefined;
}

function optionPath(anchor: Element, component: UiComponentKind, text?: string) {
  if (component === 'cascader') {
    const dropdown = closestWithin(anchor, '.ant-cascader-dropdown');
    if (!dropdown)
      return text ? [text] : undefined;
    const values = Array.from(dropdown.querySelectorAll('.ant-cascader-menu')).map(menu => {
      const active = menu.querySelector('.ant-cascader-menu-item-active, [aria-selected="true"], .ant-cascader-menu-item-expand') || (menu.contains(anchor) ? anchor : undefined);
      return elementText(active);
    }).filter((value): value is string => !!value);
    if (text && values[values.length - 1] !== text)
      values.push(text);
    return values.length ? values : undefined;
  }
  if (component === 'tree-select' && text)
    return [text];
  return text ? [text] : undefined;
}

function buildLocatorHints(anchor: Element, context: { component: UiComponentKind; targetText?: string; targetTestId?: string; targetRole?: string; form?: UiFormContext; table?: UiTableContext; overlay?: UiOverlayContext }): UiLocatorHint[] {
  const hints: UiLocatorHint[] = [];
  if (context.targetTestId)
    hints.push({ kind: 'testid', value: context.targetTestId, score: 0.98, reason: 'explicit test id', scope: 'page' });
  if (context.table?.rowKey)
    hints.push({ kind: 'text', value: context.table.rowKey, score: 0.86, reason: 'stable table row key', scope: 'table' });
  if (context.form?.label)
    hints.push({ kind: 'label', value: context.form.label, score: 0.82, reason: 'form item label', scope: context.overlay?.type === 'modal' ? 'dialog' : 'form' });
  if (context.targetRole && context.targetText)
    hints.push({ kind: 'role', value: `${context.targetRole}:${context.targetText}`, score: 0.74, reason: 'semantic role and accessible text', scope: context.overlay?.type === 'modal' ? 'dialog' : 'page' });
  if (context.targetText)
    hints.push({ kind: 'text', value: context.targetText, score: 0.58, reason: 'visible text fallback', scope: context.overlay?.type ? 'overlay' : 'page' });
  if (!hints.length)
    hints.push({ kind: 'css', value: anchor.tagName.toLowerCase(), score: 0.25, reason: 'diagnostic css fallback', scope: 'page' });
  return hints;
}

function confidenceFor(component: UiComponentKind, locatorHints: UiLocatorHint[], weak: boolean) {
  if (component === 'unknown')
    return 0.25;
  return Math.min(0.98, (weak ? 0.45 : 0.72) + Math.max(...locatorHints.map(hint => hint.score), 0) * 0.2);
}

function collectReasons(context: { component: UiComponentKind; componentPath: UiComponentKind[]; overlay?: UiOverlayContext; form?: UiFormContext; table?: UiTableContext; option?: { text?: string }; targetTestId?: string; targetText?: string }) {
  const reasons: string[] = [];
  if (context.component !== 'unknown')
    reasons.push(`matched AntD ${context.component}`);
  for (const component of context.componentPath) {
    if (component !== context.component)
      reasons.push(`within AntD ${component}`);
  }
  if (context.form?.label)
    reasons.push('matched AntD Form.Item label');
  if (context.table?.rowKey || context.table?.title)
    reasons.push('matched AntD Table context');
  if (context.overlay?.type)
    reasons.push(`matched AntD overlay ${context.overlay.type}`);
  if (context.option?.text)
    reasons.push('matched visible option text');
  if (context.targetTestId)
    reasons.push('matched explicit test id');
  if (!reasons.length && context.targetText)
    reasons.push('weak visible text annotation');
  return reasons;
}
