/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 */

type ContextEventKind = 'click' | 'input' | 'change' | 'keydown';

const installKey = '__playwrightCrxBusinessFlowPageContextSidecar';
const maxAncestorDepth = 10;
const maxNearbyText = 8;
const maxTextLength = 60;
const sensitivePattern = /(password|passwd|pwd|token|cookie|authorization|auth|secret|session)/i;
let lastFieldContext: { label?: string; title?: string; time: number } | undefined;

if (!(window as any)[installKey]) {
  (window as any)[installKey] = true;
  document.addEventListener('click', event => recordEvent('click', event), true);
  document.addEventListener('input', event => recordEvent('input', event), true);
  document.addEventListener('change', event => recordEvent('change', event), true);
  document.addEventListener('keydown', event => recordEvent('keydown', event), true);
}

function recordEvent(kind: ContextEventKind, event: Event) {
  const target = event.target instanceof Element ? event.target : undefined;
  if (!target || shouldIgnoreTarget(target, kind))
    return;

  const time = performance.now();
  const before = collectPageContext(target);
  const emit = () => chrome.runtime.sendMessage({
    event: 'pageContextEvent',
    contextEvent: {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      time,
      wallTime: Date.now(),
      before,
      after: kind === 'click' ? collectAfterContext() : undefined,
    },
  }).catch(() => {});

  if (kind === 'click')
    window.setTimeout(emit, 160);
  else
    emit();
}

function collectPageContext(target: Element) {
  const form = collectForm(target);
  if (form?.label && !target.closest('.ant-select-dropdown, .ant-dropdown, [role="listbox"]'))
    lastFieldContext = { label: form.label, title: form.title, time: performance.now() };
  const dropdownField = target.closest('.ant-select-dropdown, .ant-dropdown, [role="listbox"]') && lastFieldContext && performance.now() - lastFieldContext.time < 3000 ? lastFieldContext : undefined;
  return compactObject({
    url: safeText(location.href, 180),
    title: safeText(document.title || headingText(document.body), maxTextLength),
    breadcrumb: collectBreadcrumb(),
    activeTab: collectActiveTab(),
    dialog: collectDialog(target) ?? collectVisibleOverlay(),
    section: collectSection(target),
    table: collectTable(target),
    form: form?.label ? form : dropdownField,
    target: collectElement(target),
    nearbyText: collectNearbyText(target),
  });
}

function collectAfterContext() {
  return compactObject({
    url: safeText(location.href, 180),
    title: safeText(document.title || headingText(document.body), maxTextLength),
    breadcrumb: collectBreadcrumb(),
    activeTab: collectActiveTab(),
    dialog: collectVisibleOverlay(),
    toast: textFromFirst('.ant-message-notice-content, .ant-notification-notice-message, .toast, [role="alert"]'),
  });
}

function collectElement(element: Element) {
  const anchor = actionAnchorForElement(element);
  const htmlElement = anchor as HTMLElement;
  const tag = anchor.tagName.toLowerCase();
  const text = elementText(anchor);
  return compactObject({
    tag,
    role: anchor.getAttribute('role') || inferredRole(anchor),
    testId: testIdOf(anchor),
    ariaLabel: safeText(anchor.getAttribute('aria-label') || undefined),
    title: safeText(anchor.getAttribute('title') || undefined),
    text,
    placeholder: safeText((htmlElement as HTMLInputElement).placeholder),
    selectedOption: selectedOptionText(anchor),
    normalizedText: normalizeText(text),
  });
}

function actionAnchorForElement(element: Element) {
  const candidates = [
    element,
    closestWithin(element, 'button, a, [role="button"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"]'),
    closestWithin(element, '[data-testid], [data-test-id], [data-e2e]'),
    closestWithin(element, 'input, textarea, select, [role="combobox"], [role="textbox"]'),
  ].filter(Boolean) as Element[];

  return candidates.sort((a, b) => anchorScore(b) - anchorScore(a))[0] ?? element;
}

function isDirectActionTarget(element: Element) {
  const tag = element.tagName.toLowerCase();
  return tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    isInteractiveRole(element.getAttribute('role')) ||
    !!testIdOf(element);
}

function isInteractiveRole(role?: string | null) {
  return !!role && /^(button|link|menuitem|option|tab|checkbox|radio|switch|combobox|textbox)$/i.test(role);
}

function anchorScore(element: Element) {
  const tag = element.tagName.toLowerCase();
  const role = element.getAttribute('role');
  return (testIdOf(element) ? 100 : 0) +
    (tag === 'button' ? 50 : 0) +
    (role === 'button' ? 40 : 0) +
    (tag === 'input' || tag === 'textarea' || tag === 'select' ? 30 : 0) +
    (isInteractiveRole(role) ? 20 : 0) +
    (elementText(element) ? 10 : 0) +
    (isDirectActionTarget(element) ? 5 : 0);
}

function collectDialog(target: Element) {
  const dialog = closestWithin(target, '.ant-modal, .ant-drawer, [role="dialog"], .ant-popover, .ant-dropdown, .ant-select-dropdown');
  if (!dialog)
    return undefined;
  return dialogContext(dialog);
}

function collectVisibleOverlay() {
  const overlays = [...document.querySelectorAll('.ant-modal, .ant-drawer, [role="dialog"], .ant-popover, .ant-dropdown, .ant-select-dropdown')];
  const overlay = overlays.find(isVisible);
  return overlay ? dialogContext(overlay) : undefined;
}

function dialogContext(dialog: Element) {
  const className = (dialog.getAttribute('class') || '').toLowerCase();
  const type = className.includes('drawer') ? 'drawer' :
    className.includes('popover') ? 'popover' :
      className.includes('dropdown') || className.includes('select-dropdown') ? 'dropdown' :
        'modal';
  return compactObject({
    type,
    title: textFromFirst('.ant-modal-title, .ant-drawer-title, [class*="title"], h1, h2, h3, h4', dialog),
    visible: isVisible(dialog),
  });
}

function collectSection(target: Element) {
  const section = closestWithin(target, '.ant-card, .ant-collapse-item, section, fieldset, [data-testid], [data-e2e], [role="region"]');
  if (!section)
    return undefined;
  const className = section.getAttribute('class') || '';
  return compactObject({
    title: textFromFirst('.ant-card-head-title, .ant-collapse-header, legend, h1, h2, h3, h4, [class*="title"]', section) || headingText(section),
    kind: className.includes('card') ? 'card' : className.includes('collapse') ? 'panel' : section.tagName.toLowerCase() === 'fieldset' ? 'fieldset' : 'section',
    testId: testIdOf(section),
  });
}

function collectTable(target: Element) {
  const row = closestWithin(target, 'tr, [role="row"], .ant-table-row');
  const table = closestWithin(target, '.ant-table, table, [role="table"], [role="grid"]');
  if (!table && !row)
    return undefined;

  const headers = table ? [...table.querySelectorAll('th, [role="columnheader"]')].map(elementText).filter(Boolean).slice(0, 8) : [];
  const cell = closestWithin(target, 'td, th, [role="cell"], [role="gridcell"]');
  const rowChildren = row ? [...row.children] : [];
  const columnIndex = cell ? rowChildren.indexOf(cell) : -1;
  const rowText = row ? elementText(row, 120) : undefined;
  return compactObject({
    title: table ? tableTitle(table) : undefined,
    testId: table ? testIdOf(table) : undefined,
    rowKey: row?.getAttribute('data-row-key') || firstToken(rowText),
    rowText,
    columnName: columnIndex >= 0 ? headers[columnIndex] : undefined,
    headers,
  });
}

function collectForm(target: Element) {
  const item = closestWithin(target, '.ant-form-item, label, [role="group"]');
  const label = item ? textFromFirst('.ant-form-item-label label, label', item) || labelFromAria(target) : labelFromAria(target);
  return compactObject({
    title: titleFromAncestor(target, 'form, .ant-form, fieldset'),
    label,
    name: (target as HTMLInputElement).name || target.getAttribute('name') || undefined,
    required: !!closestWithin(target, '.ant-form-item-required, [aria-required="true"], [required]'),
  });
}

function collectActiveTab() {
  const tab = document.querySelector('.ant-tabs-tab-active, [role="tab"][aria-selected="true"], .active[role="tab"]');
  if (!tab)
    return undefined;
  return compactObject({
    title: elementText(tab),
    key: tab.getAttribute('data-node-key') || tab.getAttribute('data-key') || tab.getAttribute('aria-controls') || undefined,
  });
}

function collectBreadcrumb() {
  const root = document.querySelector('.ant-breadcrumb, [aria-label*="breadcrumb" i]');
  if (!root)
    return undefined;
  const items = [...root.querySelectorAll('li, a, span')]
      .map(elementText)
      .filter(Boolean)
      .filter((item, index, all) => all.indexOf(item) === index)
      .slice(-6);
  return items.length ? items : undefined;
}

function collectNearbyText(target: Element) {
  const values: string[] = [];
  for (let element: Element | null = target, depth = 0; element && depth < maxAncestorDepth; element = element.parentElement, depth++) {
    for (const candidate of element.querySelectorAll('h1, h2, h3, h4, label, button, th, .ant-card-head-title, .ant-collapse-header')) {
      const text = elementText(candidate);
      if (text && !values.includes(text))
        values.push(text);
      if (values.length >= maxNearbyText)
        return values;
    }
  }
  return values.length ? values : undefined;
}

function closestWithin(target: Element, selector: string) {
  for (let element: Element | null = target, depth = 0; element && depth < maxAncestorDepth; element = element.parentElement, depth++) {
    if (element.matches(selector))
      return element;
  }
  return undefined;
}

function elementText(element?: Element | null, limit = maxTextLength) {
  if (!element)
    return undefined;
  const text = safeText((element as HTMLInputElement).innerText || element.textContent || undefined, limit);
  return text && !sensitivePattern.test(text) ? text : undefined;
}

function safeText(value?: string | null, limit = maxTextLength) {
  if (!value)
    return undefined;
  const text = normalizeText(value);
  if (!text || sensitivePattern.test(text))
    return undefined;
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function normalizeText(value?: string) {
  return value?.replace(/\s+/g, ' ').trim();
}

function testIdOf(element: Element) {
  return safeText(element.getAttribute('data-testid') || element.getAttribute('data-test-id') || element.getAttribute('data-e2e') || undefined);
}

function inferredRole(element: Element) {
  const tag = element.tagName.toLowerCase();
  if (tag === 'button')
    return 'button';
  if (tag === 'input' || tag === 'textarea' || tag === 'select')
    return 'textbox';
  if (tag === 'a')
    return 'link';
  return undefined;
}

function labelFromAria(element: Element) {
  const labelledBy = element.getAttribute('aria-labelledby');
  if (!labelledBy)
    return undefined;
  return labelledBy.split(/\s+/).map(id => element.ownerDocument.getElementById(id)).map(element => elementText(element)).find(Boolean);
}

function selectedOptionText(element: Element) {
  if (element instanceof HTMLSelectElement)
    return safeText(element.selectedOptions[0]?.textContent);
  if (element.closest('.ant-select-item-option, [role="option"]'))
    return elementText(element.closest('.ant-select-item-option, [role="option"]'));
  return undefined;
}

function textFromFirst(selector: string, root: ParentNode = document) {
  return elementText(root.querySelector(selector));
}

function titleFromAncestor(target: Element, selector: string) {
  const ancestor = closestWithin(target, selector);
  return ancestor ? textFromFirst('legend, h1, h2, h3, h4, [class*="title"]', ancestor) : undefined;
}

function headingText(root: ParentNode) {
  return textFromFirst('h1, h2, h3, h4, [class*="title"]', root);
}

function tableTitle(table: Element) {
  const parent = table.parentElement;
  return textFromFirst('h1, h2, h3, h4, .ant-card-head-title, [class*="title"]', parent ?? table);
}

function firstToken(value?: string) {
  return value?.split(/\s+/).find(token => token.length <= 40 && !/^(编辑|删除|操作)$/.test(token));
}

function shouldIgnoreTarget(element: Element, kind?: ContextEventKind) {
  if (kind === 'keydown' && (element === document.body || element === document.documentElement))
    return true;
  const input = element.closest('input, textarea') as HTMLInputElement | HTMLTextAreaElement | null;
  return !!input && (sensitivePattern.test(input.name || input.id || input.placeholder || '') || input.type === 'password');
}

function isVisible(element: Element) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined || child === '' || (Array.isArray(child) && !child.length))
      continue;
    result[key as keyof T] = child as T[keyof T];
  }
  return result;
}
