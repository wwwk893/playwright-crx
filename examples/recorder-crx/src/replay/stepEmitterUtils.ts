/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { asLocator } from '@isomorphic/locatorGenerators';

export function normalizeGeneratedText(value?: string) {
  return value?.replace(/\s+/g, ' ').trim().replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, '$1$2');
}

export function normalizeComparableText(value?: string) {
  return value?.replace(/\s+/g, ' ').trim();
}

export function rawAction(value: unknown) {
  const record = value && typeof value === 'object' ? value as { action?: Record<string, unknown> } & Record<string, unknown> : {};
  const action = record.action && typeof record.action === 'object' ? record.action : record;
  return action as {
    name?: string;
    selector?: string;
    url?: string;
    text?: string;
    value?: string;
    timeout?: number;
    key?: string;
    searchText?: string;
    selectedText?: string;
    optionPath?: string[];
    options?: string[];
    files?: string[];
  };
}

export function textFromInternalTextSelector(selector?: string) {
  if (!selector)
    return undefined;
  const match = selector.match(/internal:text=(["'])(.*?)\1/i);
  return match?.[2]?.replace(/\\(["'\\])/g, '$1');
}

export function generatedTextCandidate(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string') {
      const normalized = normalizeGeneratedText(value);
      if (normalized && !isSerializedObjectText(normalized))
        return normalized;
    }
    if (typeof value === 'number' || typeof value === 'boolean')
      return String(value);
  }
  return undefined;
}

export function isSerializedObjectText(value: string) {
  return /^\[object(?:\s+Object)?\]$/i.test(value) || /^(undefined|null)$/i.test(value);
}

export function numberParam(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function stringParam(value: unknown) {
  return typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : undefined;
}

export function cssAttributeValue(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function rowTextRegexLiteral(value: string) {
  const tokens = value.split(/\s+/).map(token => token.trim()).filter(Boolean);
  const pattern = tokens.length ? tokens.map(escapeRegExp).join('[\\s\\S]*') : escapeRegExp(value);
  return `/${pattern}/`;
}

export function locatorExpressionForSelector(selector: unknown) {
  if (typeof selector !== 'string' || !selector.trim())
    return undefined;
  try {
    return `page.${asLocator('javascript', selector)}`;
  } catch {
    return `page.locator(${stringLiteral(selector)})`;
  }
}

export function stringLiteral(value: unknown) {
  return JSON.stringify(String(value ?? ''));
}

export function escapeRegExp(value: string) {
  return value.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
}
