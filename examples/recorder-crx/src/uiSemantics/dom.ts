/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

const maxAncestorDepth = 12;
const maxTextLength = 80;
const sensitivePattern = /(password|passwd|pwd|token|cookie|authorization|auth|secret|session|api[-_]?key)/i;

export function closestWithin(target: Element | undefined | null, selector: string, maxDepth = maxAncestorDepth): Element | undefined {
  for (let element: Element | null | undefined = target; element && maxDepth >= 0; element = element.parentElement, maxDepth--) {
    if (element.matches(selector))
      return element;
  }
  return undefined;
}

export function closestAny(target: Element | undefined | null, selectors: string[]): Element | undefined {
  for (const selector of selectors) {
    const element = closestWithin(target, selector);
    if (element)
      return element;
  }
  return undefined;
}

export function textFromFirst(selector: string, root: ParentNode = document): string | undefined {
  return elementText(root.querySelector(selector));
}

export function elementText(element?: Element | null, limit = maxTextLength): string | undefined {
  if (!element)
    return undefined;
  return safeText((element as HTMLElement).innerText || element.textContent || undefined, limit);
}

export function safeText(value?: string | null, limit = maxTextLength): string | undefined {
  if (!value)
    return undefined;
  const text = normalizeText(value);
  if (!text || sensitivePattern.test(text))
    return undefined;
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

export function normalizeText(value?: string | null): string | undefined {
  return value?.replace(/\s+/g, ' ').trim();
}

export function testIdOf(element?: Element | null): string | undefined {
  if (!element)
    return undefined;
  return safeText(element.getAttribute('data-testid') || element.getAttribute('data-test-id') || element.getAttribute('data-e2e') || undefined);
}

export function labelTextForFormItem(formItem?: Element): string | undefined {
  if (!formItem)
    return undefined;
  return textFromFirst('.ant-form-item-label label, label', formItem) || safeText(formItem.getAttribute('aria-label'));
}

export function fieldNameFor(anchor: Element): { name?: string; namePath?: string[]; source?: string } {
  const input = anchor.matches('input, textarea, select, [name], [id]') ? anchor : anchor.querySelector('input, textarea, select, [name], [id]');
  const direct = anchor.getAttribute('name') || (anchor as HTMLInputElement).name || input?.getAttribute('name') || undefined;
  if (direct)
    return { name: direct, namePath: direct.split(/[.[\]_]+/).filter(Boolean), source: 'name' };
  const dataName = anchor.getAttribute('data-name') || anchor.getAttribute('data-field') || input?.getAttribute('data-name') || input?.getAttribute('data-field') || undefined;
  if (dataName)
    return { name: dataName, namePath: dataName.split(/[.[\]_]+/).filter(Boolean), source: 'data-name' };
  const id = input?.getAttribute('id') || anchor.getAttribute('id') || undefined;
  if (id)
    return { name: id.replace(/^[^_]+_/, '').replace(/_/g, '.'), namePath: id.split(/[.[\]_]+/).filter(Boolean), source: 'id' };
  return {};
}

export function isVisible(element?: Element | null): boolean {
  if (!element)
    return false;
  const rect = element.getBoundingClientRect();
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style?.visibility !== 'hidden' && style?.display !== 'none';
}

export function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> | undefined {
  const result: Partial<T> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined || child === '' || (Array.isArray(child) && !child.length))
      continue;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      const compacted = compactObject(child as Record<string, unknown>);
      if (compacted && Object.keys(compacted).length)
        (result as Record<string, unknown>)[key] = compacted;
      continue;
    }
    (result as Record<string, unknown>)[key] = child;
  }
  return Object.keys(result).length ? result : undefined;
}

export function unique<T>(values: T[]): T[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

export function addUnique<T>(values: T[], value: T | undefined) {
  if (value !== undefined && !values.includes(value))
    values.push(value);
}

export function roleFor(anchor: Element, component?: string): string | undefined {
  const explicit = anchor.getAttribute('role') || undefined;
  if (explicit)
    return explicit;
  const tag = anchor.tagName.toLowerCase();
  if (tag === 'button' || component === 'button')
    return 'button';
  if (tag === 'a')
    return 'link';
  if (component === 'select' || component === 'tree-select' || component === 'cascader')
    return 'combobox';
  if (component === 'tabs')
    return 'tab';
  if (component === 'checkbox')
    return 'checkbox';
  if (component === 'radio-group')
    return 'radio';
  if (component === 'switch')
    return 'switch';
  if (tag === 'input' || tag === 'textarea')
    return 'textbox';
  return undefined;
}

export function visibleOverlays(document: Document, selector: string) {
  return Array.from(document.querySelectorAll(selector)).filter(isVisible);
}
