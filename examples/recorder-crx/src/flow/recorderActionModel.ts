/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import type { FlowActionType } from './types';

export type ActionLike = {
  name?: string;
  selector?: string;
  url?: string;
  text?: string;
  value?: string;
  timeout?: number;
  key?: string;
  options?: string[];
  files?: string[];
  substring?: boolean;
  checked?: boolean;
  signals?: Array<{ name?: string; url?: string }>;
};

export type ActionInContextLike = {
  action?: ActionLike;
  description?: string;
  wallTime?: number;
  endWallTime?: number;
};

export function normalizeRecorderAction(actionInContext: ActionInContextLike): ActionLike {
  if (actionInContext.action && typeof actionInContext.action === 'object')
    return actionInContext.action;
  return actionInContext as ActionLike;
}

export function mapRecorderActionType(name?: string): FlowActionType {
  switch (name) {
    case 'navigate':
    case 'goto':
    case 'openPage':
      return 'navigate';
    case 'click':
      return 'click';
    case 'fill':
      return 'fill';
    case 'select':
    case 'selectOption':
      return 'select';
    case 'check':
      return 'check';
    case 'uncheck':
      return 'uncheck';
    case 'press':
      return 'press';
    case 'wait':
    case 'waitForTimeout':
      return 'wait';
    case 'setInputFiles':
      return 'upload';
    default:
      return name?.startsWith('assert') ? 'assert' : 'unknown';
  }
}

export function extractRecorderActionUrl(action: ActionLike) {
  const directUrl = readString(action.url);
  if (directUrl)
    return directUrl;
  return action.signals?.find(signal => signal.name === 'navigation' && signal.url)?.url;
}

export function isNavigationRecorderAction(action: ActionLike) {
  return action.name === 'navigate' || action.name === 'goto' || action.name === 'openPage';
}

export function extractRecorderActionValue(action: ActionLike) {
  const text = readString(action.text);
  if (text !== undefined)
    return text;
  const value = readString(action.value);
  if (value !== undefined)
    return value;
  if (typeof action.timeout === 'number')
    return String(action.timeout);
  const key = readString(action.key);
  if (key !== undefined)
    return key;
  if (Array.isArray(action.options))
    return action.options.join(', ');
  if (Array.isArray(action.files))
    return action.files.join(', ');
  if (typeof action.checked === 'boolean')
    return String(action.checked);
  return undefined;
}

export function recorderActionSignature(rawAction: unknown) {
  const raw = asRecord(rawAction);
  const action = normalizeRecorderAction(raw as ActionInContextLike);
  try {
    return JSON.stringify({
      name: action.name,
      selector: action.selector,
      url: action.url,
      text: action.text,
      value: action.value,
      timeout: action.timeout,
      key: action.key,
      options: action.options,
      files: action.files,
      checked: action.checked,
      signals: action.signals?.map(signal => ({ name: signal.name, url: signal.url })),
    });
  } catch {
    return undefined;
  }
}

export function normalizeWaitMilliseconds(value: number) {
  if (!Number.isFinite(value))
    return 1000;
  return Math.max(0, Math.round(value));
}

export function renderStableWaitSource(milliseconds: number) {
  return [
    `await page.waitForLoadState('networkidle').catch(() => {});`,
    `await page.waitForTimeout(${milliseconds});`,
  ].join('\n');
}

export function stringLiteral(value: unknown) {
  return JSON.stringify(String(value ?? ''));
}

export function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}
