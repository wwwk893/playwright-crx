/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import type { ActionLike } from '../flow/recorderActionModel';
import { readString } from '../flow/recorderActionModel';
import type { FlowTarget } from '../flow/types';

export function extractTargetFromRecorderAction(action: ActionLike): FlowTarget | undefined {
  const selector = readString(action.selector);
  if (!selector)
    return undefined;

  const target: FlowTarget = {
    selector,
    raw: { selector },
  };

  Object.assign(target, inferTargetFromSelector(selector));
  return target;
}

export function inferTargetFromSelector(selector: string): Partial<FlowTarget> {
  const target: Partial<FlowTarget> = {};
  const roleMatch = selector.match(/internal:role=([a-zA-Z0-9_-]+)/);
  const nameMatch = selector.match(/\[name=(?:"([^"]+)"|'([^']+)'|([^i\]]+))/);
  const labelMatch = selector.match(/internal:label=(?:"([^"]+)"|'([^']+)'|([^\]]+))/);
  const placeholderMatch = selector.match(/internal:attr=\[placeholder=(?:"([^"]+)"|'([^']+)'|([^\]]+))/);
  const textMatch = selector.match(/internal:text=(?:"([^"]+)"|'([^']+)'|([^\]]+))/);

  target.testId = extractTestId(selector);
  target.role = firstMatch(roleMatch);
  target.name = cleanupSelectorText(firstMatch(nameMatch));
  target.label = cleanupSelectorText(firstMatch(labelMatch));
  target.placeholder = cleanupSelectorText(firstMatch(placeholderMatch));
  target.text = cleanupSelectorText(firstMatch(textMatch));
  target.locator = selector;
  if (target.testId) {
    const ordinalHint = locatorHintFromSelectorOrdinal(selector);
    if (ordinalHint)
      target.locatorHint = ordinalHint;
  }
  return target;
}

export function extractTestId(selector: string) {
  const internalMatch = selector.match(/internal:testid=\[(?:data-testid|data-test-id|data-e2e)=(?:"([^"]+)"|'([^']+)')[si]?\]/i);
  if (internalMatch)
    return cleanupSelectorText(firstMatch(internalMatch));
  const attributeMatch = selector.match(/\[(?:data-testid|data-test-id|data-e2e)=(?:"([^"]+)"|'([^']+)')\]/i);
  if (attributeMatch)
    return cleanupSelectorText(firstMatch(attributeMatch));
  const bareInternalMatch = selector.match(/internal:testid=(?:"([^"]+)"|'([^']+)'|([^\]\s]+))/i);
  if (bareInternalMatch)
    return cleanupSelectorText(firstMatch(bareInternalMatch));
  const looseAttributeMatch = selector.match(/\[(?:data-testid|data-test-id|data-e2e)=(?:"([^"]+)"|'([^']+)'|([^\]\s]+))/i);
  if (looseAttributeMatch)
    return cleanupSelectorText(firstMatch(looseAttributeMatch));
  return undefined;
}

export function cleanupSelectorText(value?: string) {
  return value?.replace(/\\(["'])/g, '$1').trim();
}

function locatorHintFromSelectorOrdinal(selector: string) {
  const nthMatch = selector.match(/(?:>>\s*)?nth=(-?\d+)/);
  if (!nthMatch)
    return undefined;
  const pageIndex = Number(nthMatch[1]);
  if (!Number.isInteger(pageIndex) || pageIndex < 0)
    return undefined;
  return { strategy: 'global-testid' as const, confidence: 0.9, pageCount: pageIndex + 1, pageIndex };
}

function firstMatch(match: RegExpMatchArray | null) {
  if (!match)
    return undefined;
  return match.slice(1).find(Boolean);
}
