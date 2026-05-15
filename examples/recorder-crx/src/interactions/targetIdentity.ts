/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import type { FlowTarget } from '../flow/types';

type PageContextLike = {
  target?: {
    testId?: string;
    tag?: string;
    role?: string;
    controlType?: string;
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

type TargetIdentityLike = {
  targetKey?: string;
  aliases?: string[];
  field?: TargetIdentity['field'];
};

export function inputTargetIdentityFromPageContext(context?: PageContextLike): TargetIdentity | undefined {
  if (!context)
    return undefined;
  const bestHint = context.ui?.locatorHints?.slice().sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))[0];
  const actualTestId = actualInputTestIdFromPageContext(context);
  const wrapperTestId = inputFieldWrapperTestId(context.form?.testId || context.ui?.form?.testId) ||
    inputFieldWrapperTestId(context.ui?.targetTestId) ||
    inputFieldWrapperTestId(bestHint?.kind === 'testid' ? bestHint.value : undefined);
  const testId = actualTestId || wrapperTestId;
  const label = context.ui?.form?.label || context.form?.label;
  const name = context.ui?.form?.name || context.ui?.form?.dataIndex || context.form?.namePath?.join('.') || context.form?.name;
  const placeholder = context.ui?.form?.placeholder || context.target?.placeholder;
  const targetKey = inputTargetKeyFromEvidence({ actualTestId, wrapperTestId, name, placeholder, label });
  const aliases = normalizeKeys([
    targetKey,
    testId && `testid:${testId}`,
    wrapperTestId && `form-testid:${wrapperTestId}`,
    name && `name:${name}`,
    label && `label:${label}`,
    placeholder && `placeholder:${placeholder}`,
    context.target?.ariaLabel && `label:${context.target.ariaLabel}`,
    context.ui?.targetText && `text:${context.ui.targetText}`,
    context.target?.text && `text:${context.target.text}`,
    context.target?.title && `text:${context.target.title}`,
  ]);
  if (!targetKey)
    return undefined;
  return {
    targetKey,
    aliases,
    field: { testId, label, name, placeholder },
  };
}

function actualInputTestIdFromPageContext(context: PageContextLike) {
  const targetTestId = context.target?.testId;
  if (!targetTestId)
    return undefined;
  const role = context.target?.role || '';
  const controlType = context.target?.controlType || '';
  const tag = context.target?.tag?.toLowerCase?.() || '';
  const looksActualControl = role === 'textbox' ||
    /^(input|textarea)$/.test(tag) ||
    /^(input|textarea|text|number|password)$/.test(controlType);
  const formTestId = context.form?.testId || context.ui?.form?.testId;
  if (!looksActualControl || targetTestId === formTestId)
    return undefined;
  return targetTestId;
}

export function inputTargetIdentityFromFlowTarget(target?: FlowTarget): TargetIdentity | undefined {
  if (!target)
    return undefined;
  const scopeTestId = inputFieldWrapperTestId(target.scope?.form?.testId);
  const actualTestId = target.testId && target.testId !== scopeTestId ? target.testId : undefined;
  const wrapperTestId = scopeTestId || inputFieldWrapperTestId(target.testId);
  const label = target.label || target.scope?.form?.label;
  const name = target.name || target.scope?.form?.name;
  const placeholder = target.placeholder;
  const targetKey = inputTargetKeyFromEvidence({ actualTestId, wrapperTestId, name, placeholder, label, selector: target.selector || target.locator });
  const aliases = normalizeKeys([
    targetKey,
    target.testId && `testid:${target.testId}`,
    wrapperTestId && `form-testid:${wrapperTestId}`,
    name && `name:${name}`,
    label && `label:${label}`,
    placeholder && `placeholder:${placeholder}`,
    target.text && `text:${target.text}`,
    target.displayName && `text:${target.displayName}`,
    target.selector && `selector:${target.selector}`,
    target.locator && `selector:${target.locator}`,
  ]);
  if (!targetKey)
    return undefined;
  return {
    targetKey,
    aliases,
    field: {
      testId: target.testId || scopeTestId,
      label,
      name,
      placeholder,
    },
  };
}

export function inputTargetIdentityFromRecorderAction(action?: ActionLike): TargetIdentity | undefined {
  const selector = action?.selector;
  if (!selector)
    return undefined;
  const testId = extractTestId(selector);
  const roleName = cleanupSelectorText(firstMatch(selector.match(/internal:role=[^\[]*\[name=(?:\"([^\"]+)\"|'([^']+)'|([^\]]+?))(?:[si])?\]/)));
  const label = cleanupSelectorText(firstMatch(selector.match(/internal:label=(?:\"([^\"]+)\"|'([^']+)'|([^\]]+))/))) || roleName;
  const placeholder = cleanupSelectorText(firstMatch(selector.match(/internal:attr=\[placeholder=(?:\"([^\"]+)\"|'([^']+)'|([^\]]+))/)));
  const name = extractCssName(selector);
  const targetKey = inputTargetKeyFromEvidence({ actualTestId: testId, name, placeholder, label, selector });
  const aliases = normalizeKeys([
    targetKey,
    testId && `testid:${testId}`,
    name && `name:${name}`,
    label && `label:${label}`,
    placeholder && `placeholder:${placeholder}`,
    `selector:${selector}`,
  ]);
  if (!targetKey)
    return undefined;
  return {
    targetKey,
    aliases,
    field: { testId, label, name, placeholder },
  };
}

function extractCssName(selector: string) {
  if (/internal:role=[^\[]*\[name=/.test(selector))
    return undefined;
  return cleanupSelectorText(firstMatch(selector.match(/\[name=(?:\"([^\"]+)\"|'([^']+)'|([^\]]+))/)));
}

export function inputTargetIdentitiesCompatible(left: TargetIdentityLike | undefined, right: TargetIdentityLike | undefined) {
  if (!left || !right)
    return false;
  if (!dialogScopesCompatible(left.aliases, right.aliases))
    return false;
  if (left.targetKey && right.targetKey && left.targetKey === right.targetKey)
    return true;

  const sharedAliases = sharedNormalizedAliases(left.aliases, right.aliases);
  if (sharedAliases.some(alias => !isTestIdAlias(alias)))
    return true;
  if (sharedAliases.length) {
    const leftHasField = hasFieldSpecificEvidence(left.field);
    const rightHasField = hasFieldSpecificEvidence(right.field);
    if (!leftHasField || !rightHasField)
      return true;
    return inputFieldEvidenceCompatible(left.field, right.field);
  }

  return inputFieldEvidenceCompatible(left.field, right.field);
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

function inputTargetKeyFromEvidence(evidence: { actualTestId?: string; wrapperTestId?: string; name?: string; placeholder?: string; label?: string; selector?: string }) {
  const key = evidence.actualTestId ? `testid:${evidence.actualTestId}` :
    evidence.wrapperTestId && evidence.name ? `field:${evidence.wrapperTestId}|name:${evidence.name}` :
      evidence.wrapperTestId && evidence.placeholder ? `field:${evidence.wrapperTestId}|placeholder:${evidence.placeholder}` :
        evidence.wrapperTestId && evidence.label ? `field:${evidence.wrapperTestId}|label:${evidence.label}` :
          evidence.name ? `name:${evidence.name}` :
            evidence.placeholder ? `placeholder:${evidence.placeholder}` :
              evidence.label ? `label:${evidence.label}` :
                evidence.wrapperTestId ? `testid:${evidence.wrapperTestId}` :
                  evidence.selector ? `selector:${evidence.selector}` : undefined;
  return normalizeKeys([key])[0];
}

function inputFieldWrapperTestId(testId?: string) {
  if (!testId || looksLikeStructuralFormTestId(testId))
    return undefined;
  return testId;
}

function looksLikeStructuralFormTestId(testId: string) {
  return /(^|[-_])(modal|dialog|drawer|form|container|wrapper|root)([-_]|$)/i.test(testId);
}

function sharedNormalizedAliases(left: string[] | undefined, right: string[] | undefined) {
  if (!left?.length || !right?.length)
    return [];
  const rightSet = new Set(right);
  return left.filter(alias => rightSet.has(alias));
}

function isTestIdAlias(alias: string) {
  return /^testid:|^form-testid:/.test(stripDialogScope(alias));
}

function hasFieldSpecificEvidence(field: TargetIdentity['field'] | undefined) {
  return !!(field?.name || field?.placeholder || field?.label);
}

function inputFieldEvidenceCompatible(left: TargetIdentity['field'] | undefined, right: TargetIdentity['field'] | undefined) {
  if (!left || !right)
    return false;
  if (left.name && right.name)
    return normalizeKey(left.name) === normalizeKey(right.name);
  if (left.placeholder && right.placeholder && prefixCompatibleText(left.placeholder, right.placeholder))
    return true;
  const leftTexts = [left.placeholder, left.label].filter(Boolean) as string[];
  const rightTexts = [right.placeholder, right.label].filter(Boolean) as string[];
  return leftTexts.some(leftText => rightTexts.some(rightText => prefixCompatibleText(leftText, rightText)));
}

function prefixCompatibleText(left: string, right: string) {
  const normalizedLeft = normalizeKey(left);
  const normalizedRight = normalizeKey(right);
  if (!normalizedLeft || !normalizedRight)
    return false;
  return normalizedLeft === normalizedRight || normalizedLeft.startsWith(normalizedRight) || normalizedRight.startsWith(normalizedLeft);
}

function stripDialogScope(alias: string) {
  return alias.replace(/\|dialog:.+$/, '');
}

function dialogScopesCompatible(left: string[] | undefined, right: string[] | undefined) {
  const leftScope = dialogScopeFromAliases(left);
  const rightScope = dialogScopeFromAliases(right);
  return !leftScope || !rightScope || leftScope === rightScope;
}

function dialogScopeFromAliases(aliases: string[] | undefined) {
  for (const alias of aliases ?? []) {
    const match = alias.match(/\|dialog:(.+)$/);
    if (match)
      return match[1];
  }
  return undefined;
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
