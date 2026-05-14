/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { equivalentAnchorCandidates, groundingConfidence, rankAnchorCandidates, scoreAnchorCandidateEvidence } from './anchorDiagnostics';
import type { AnchorCandidateContext, AnchorCandidateEvidence, AnchorCandidateSource, BusinessActionGroundingEvidence } from './anchorDiagnostics';
import type { RectLike } from './visualOverlap';

export interface AnchorGroundingOptions {
  event?: Event;
  document?: Document;
  chosenAnchor?: Element;
  maxDepth?: number;
  maxCandidates?: number;
  textForElement?: (element: Element, limit?: number) => string | undefined;
  testIdForElement?: (element: Element) => string | undefined;
  controlTypeForElement?: (element: Element) => string | undefined;
  roleForElement?: (element: Element, controlType?: string) => string | undefined;
  contextForElement?: (element: Element) => AnchorCandidateContext | undefined;
}

export function shouldCollectAnchorGroundingDiagnostics(options: { anchorGroundingDiagnosticsEnabled?: boolean; semanticAdapterDiagnosticsEnabled?: boolean } = {}) {
  return options.anchorGroundingDiagnosticsEnabled === true;
}

type CandidateEntry = {
  element: Element;
  source: AnchorCandidateSource;
  depthFromTarget: number;
};

const defaultMaxDepth = 10;
const defaultMaxCandidates = 14;

export function collectAnchorGroundingEvidence(target: Element, options: AnchorGroundingOptions = {}): BusinessActionGroundingEvidence {
  const maxDepth = options.maxDepth ?? defaultMaxDepth;
  const candidates = anchorCandidateEntries(target, { ...options, maxDepth });
  const evidenceByElement = new Map<Element, AnchorCandidateEvidence>();
  for (const entry of candidates)
    evidenceByElement.set(entry.element, candidateEvidence(entry, options));

  const rawTargetEvidence = evidenceByElement.get(target) ?? candidateEvidence({ element: target, source: 'target', depthFromTarget: 0 }, options);
  const chosenEvidence = options.chosenAnchor ? evidenceByElement.get(options.chosenAnchor) : undefined;
  const missingChosenEvidence = !chosenEvidence && options.chosenAnchor
    ? candidateEvidence({ element: options.chosenAnchor, source: 'ancestor', depthFromTarget: ancestorDistance(target, options.chosenAnchor, maxDepth) }, options)
    : undefined;
  const ranked = rankAnchorCandidates([...evidenceByElement.values(), ...(missingChosenEvidence ? [missingChosenEvidence] : [])])
      .slice(0, options.maxCandidates ?? defaultMaxCandidates);
  const rawTarget = ranked.find(candidate => candidate.id === rawTargetEvidence.id) ?? scoreAnchorCandidateEvidence(rawTargetEvidence);
  const chosenAnchor = options.chosenAnchor
    ? ranked.find(candidate => candidate.id === (chosenEvidence ?? missingChosenEvidence)?.id) ?? rawTarget
    : ranked[0] ?? rawTarget;
  const equivalentAnchors = equivalentAnchorCandidates(chosenAnchor, ranked);

  return {
    rawTarget,
    chosenAnchor,
    equivalentAnchors: equivalentAnchors.length ? equivalentAnchors : [chosenAnchor],
    candidates: ranked,
    confidence: groundingConfidence(chosenAnchor, ranked),
    reasons: groundingReasons(chosenAnchor, equivalentAnchors),
  };
}

function anchorCandidateEntries(target: Element, options: AnchorGroundingOptions & { maxDepth: number }): CandidateEntry[] {
  const entries: CandidateEntry[] = [];
  const add = (element: Element | undefined, source: AnchorCandidateSource) => {
    if (!element || entries.some(entry => entry.element === element))
      return;
    entries.push({ element, source, depthFromTarget: ancestorDistance(target, element, options.maxDepth) });
  };

  add(target, 'target');

  const path = typeof options.event?.composedPath === 'function' ? options.event.composedPath() : [];
  for (const candidate of path) {
    if (candidate instanceof Element)
      add(candidate, 'composedPath');
  }

  const pointed = pointedElement(options.event, options.document ?? target.ownerDocument);
  add(pointed, 'pointed');

  for (let current: Element | null = target.parentElement, depth = 1; current && depth <= options.maxDepth; current = current.parentElement, depth++)
    add(current, 'ancestor');

  const tableRow = closestWithin(target, 'tr[data-row-key], .ant-table-row, [data-row-key], [role="row"]', options.maxDepth);
  add(tableRow, 'tableScope');

  const portal = closestWithin(target, '.ant-select-dropdown, .ant-cascader-dropdown, .ant-dropdown, .ant-popover, [role="listbox"], [role="tree"]', options.maxDepth);
  add(portal, 'portal');

  return entries;
}

function candidateEvidence(entry: CandidateEntry, options: AnchorGroundingOptions): AnchorCandidateEvidence {
  const element = entry.element;
  const controlType = options.controlTypeForElement?.(element);
  const role = options.roleForElement?.(element, controlType) || element.getAttribute('role') || inferredRole(element, controlType);
  const text = options.textForElement?.(element, 80) || undefined;
  const ariaLabel = safeAttribute(element, 'aria-label');
  const title = safeAttribute(element, 'title');
  const testId = options.testIdForElement?.(element);
  const dataE2e = safeAttribute(element, 'data-e2e');
  const dataE2eAction = safeAttribute(element, 'data-e2e-action');
  const classTokens = classTokensFor(element);
  const context = safeContextForElement(element, options);
  return {
    id: candidateId(element, entry.source, entry.depthFromTarget),
    tag: element.tagName.toLowerCase(),
    role,
    text,
    accessibleName: ariaLabel || title || text,
    testId,
    dataE2e,
    dataE2eAction,
    classTokens,
    depthFromTarget: entry.depthFromTarget,
    source: entry.source,
    ruleScore: 0,
    reasons: [],
    risks: initialRisks(element),
    bbox: rectFor(element),
    context,
  };
}

function safeContextForElement(element: Element, options: AnchorGroundingOptions) {
  try {
    return options.contextForElement?.(element);
  } catch {
    return undefined;
  }
}

function groundingReasons(chosen: AnchorCandidateEvidence, equivalentAnchors: AnchorCandidateEvidence[]) {
  const reasons = new Set<string>(chosen.reasons);
  if (equivalentAnchors.length > 1)
    reasons.add('visual equivalent anchor group');
  if (chosen.context?.rowKey)
    reasons.add('chosen anchor is row scoped');
  if (chosen.context?.dialogTitle || chosen.context?.dialogTestId)
    reasons.add('chosen anchor is dialog scoped');
  return [...reasons];
}

function pointedElement(event: Event | undefined, document: Document) {
  if (!event || typeof MouseEvent === 'undefined' || !(event instanceof MouseEvent))
    return undefined;
  if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY))
    return undefined;
  const pointed = document.elementFromPoint(event.clientX, event.clientY);
  return pointed instanceof Element ? pointed : undefined;
}

function rectFor(element: Element): RectLike | undefined {
  const rect = element.getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0)
    return undefined;
  return {
    left: round(rect.left),
    top: round(rect.top),
    right: round(rect.right),
    bottom: round(rect.bottom),
    width: round(rect.width),
    height: round(rect.height),
  };
}

function classTokensFor(element: Element) {
  const tokens = (element.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 10);
  return tokens.length ? tokens : undefined;
}

function initialRisks(element: Element) {
  const risks: string[] = [];
  if (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true')
    risks.push('disabled');
  if (element.getAttribute('hidden') !== null)
    risks.push('hidden');
  return risks;
}

function candidateId(element: Element, source: AnchorCandidateSource, depth: number) {
  const tag = element.tagName.toLowerCase();
  const testId = safeAttribute(element, 'data-testid') || safeAttribute(element, 'data-test-id') || safeAttribute(element, 'data-e2e');
  const role = element.getAttribute('role') || '';
  const key = testId || safeAttribute(element, 'data-e2e-action') || role || tag;
  return `${source}:${depth}:${tag}:${key}`;
}

function closestWithin(target: Element, selector: string, maxDepth: number) {
  for (let element: Element | null = target; element && maxDepth >= 0; element = element.parentElement, maxDepth--) {
    if (element.matches(selector))
      return element;
  }
  return undefined;
}

function ancestorDistance(from: Element, candidate: Element, maxDepth: number) {
  let distance = 0;
  for (let current: Element | null = from; current && distance <= maxDepth; current = current.parentElement) {
    if (current === candidate)
      return distance;
    distance += 1;
  }
  return maxDepth + 1;
}

function inferredRole(element: Element, controlType?: string) {
  const tag = element.tagName.toLowerCase();
  if (controlType === 'button' || tag === 'button')
    return 'button';
  if (controlType === 'select-option')
    return 'option';
  if (controlType === 'menu-item')
    return 'menuitem';
  if (controlType === 'checkbox')
    return 'checkbox';
  if (controlType === 'radio')
    return 'radio';
  if (controlType === 'tab')
    return 'tab';
  if (controlType === 'switch')
    return 'switch';
  if (tag === 'a')
    return 'link';
  if (tag === 'input' || tag === 'textarea' || tag === 'select')
    return 'textbox';
  return undefined;
}

function safeAttribute(element: Element, name: string) {
  const value = element.getAttribute(name);
  return value && !/(password|passwd|pwd|token|cookie|authorization|auth|secret|session)/i.test(value) ? value : undefined;
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}
