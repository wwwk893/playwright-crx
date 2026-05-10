/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import type { FlowTarget } from '../flow/types';

type PageContextLike = {
  target?: {
    testId?: string;
    ariaLabel?: string;
    title?: string;
    text?: string;
    placeholder?: string;
    selectedOption?: string;
    normalizedText?: string;
  };
  form?: {
    testId?: string;
    label?: string;
    name?: string;
    namePath?: string[];
  };
  ui?: {
    targetTestId?: string;
    targetText?: string;
    form?: {
      testId?: string;
      label?: string;
      name?: string;
      dataIndex?: string;
      placeholder?: string;
      valuePreview?: string;
    };
    locatorHints?: Array<{ kind?: string; value?: string; score?: number }>;
  };
};

type ActionLike = {
  selector?: string;
};

export type TargetIdentity = {
  targetKey: string;
  aliases: string[];
  field: {
    testId?: string;
    label?: string;
    name?: string;
    placeholder?: string;
  };
};

export function inputTargetIdentityFromPageContext(context?: PageContextLike): TargetIdentity | undefined {
  if (!context)
    return undefined;
  const bestHint = context.ui?.locatorHints?.slice().sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))[0];
  const testId = context.target?.testId || context.ui?.targetTestId || (bestHint?.kind === 'testid' ? bestHint.value : undefined) || context.form?.testId || context.ui?.form?.testId;
  const label = context.ui?.form?.label || context.form?.label;
  const name = context.ui?.form?.name || context.ui?.form?.dataIndex || context.form?.namePath?.join('.') || context.form?.name;
  const placeholder = context.ui?.form?.placeholder || context.target?.placeholder;
  const aliases = normalizeKeys([
    testId && `testid:${testId}`,
    context.form?.testId && `form-testid:${context.form.testId}`,
    name && `name:${name}`,
    label && `label:${label}`,
    placeholder && `placeholder:${placeholder}`,
    context.target?.ariaLabel && `label:${context.target.ariaLabel}`,
    context.ui?.targetText && `text:${context.ui.targetText}`,
    context.target?.text && `text:${context.target.text}`,
    context.target?.title && `text:${context.target.title}`,
  ]);
  const targetKey = aliases[0];
  if (!targetKey)
    return undefined;
  return {
    targetKey,
    aliases,
    field: { testId, label, name, placeholder },
  };
}

export function inputTargetIdentityFromFlowTarget(target?: FlowTarget): TargetIdentity | undefined {
  if (!target)
    return undefined;
  const aliases = normalizeKeys([
    target.testId && `testid:${target.testId}`,
    target.scope?.form?.testId && `form-testid:${target.scope.form.testId}`,
    target.scope?.form?.name && `name:${target.scope.form.name}`,
    target.name && `name:${target.name}`,
    target.label && `label:${target.label}`,
    target.scope?.form?.label && `label:${target.scope.form.label}`,
    target.placeholder && `placeholder:${target.placeholder}`,
    target.text && `text:${target.text}`,
    target.displayName && `text:${target.displayName}`,
    target.selector && `selector:${target.selector}`,
    target.locator && `selector:${target.locator}`,
  ]);
  const targetKey = aliases[0];
  if (!targetKey)
    return undefined;
  return {
    targetKey,
    aliases,
    field: {
      testId: target.testId || target.scope?.form?.testId,
      label: target.label || target.scope?.form?.label,
      name: target.name || target.scope?.form?.name,
      placeholder: target.placeholder,
    },
  };
}

export function inputTargetIdentityFromRecorderAction(action?: ActionLike): TargetIdentity | undefined {
  const selector = action?.selector;
  if (!selector)
    return undefined;
  const testId = extractTestId(selector);
  const label = cleanupSelectorText(firstMatch(selector.match(/internal:label=(?:\"([^\"]+)\"|'([^']+)'|([^\]]+))/)));
  const placeholder = cleanupSelectorText(firstMatch(selector.match(/internal:attr=\[placeholder=(?:\"([^\"]+)\"|'([^']+)'|([^\]]+))/)));
  const name = cleanupSelectorText(firstMatch(selector.match(/\[name=(?:\"([^\"]+)\"|'([^']+)'|([^i\]]+))/)));
  const aliases = normalizeKeys([
    testId && `testid:${testId}`,
    name && `name:${name}`,
    label && `label:${label}`,
    placeholder && `placeholder:${placeholder}`,
    `selector:${selector}`,
  ]);
  return {
    targetKey: aliases[0],
    aliases,
    field: { testId, label, name, placeholder },
  };
}

export function targetAliasesOverlap(left: string[] | undefined, right: string[] | undefined) {
  if (!left?.length || !right?.length)
    return false;
  const rightSet = new Set(right);
  return left.some(alias => rightSet.has(alias));
}

export function normalizeKeys(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const value of values) {
    const key = normalizeKey(value);
    if (!key || seen.has(key))
      continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function normalizeKey(value?: string) {
  return value?.replace(/\s+/g, ' ').trim().toLowerCase();
}

function extractTestId(selector: string) {
  const internalMatch = selector.match(/internal:testid=\[(?:data-testid|data-test-id|data-e2e)=(?:\"([^\"]+)\"|'([^']+)')[si]?\]/i);
  if (internalMatch)
    return cleanupSelectorText(firstMatch(internalMatch));
  const attributeMatch = selector.match(/\[(?:data-testid|data-test-id|data-e2e)=(?:\"([^\"]+)\"|'([^']+)')\]/i);
  return cleanupSelectorText(firstMatch(attributeMatch));
}

function firstMatch(match: RegExpMatchArray | null) {
  return match?.slice(1).find(Boolean);
}

function cleanupSelectorText(value?: string) {
  return value?.replace(/\\([\"'])/g, '$1').trim();
}
