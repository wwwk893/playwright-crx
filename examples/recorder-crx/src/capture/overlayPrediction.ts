/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { DialogContext } from '../flow/pageContextTypes';

export type OverlayPredictionKind =
  | 'select-dropdown'
  | 'dropdown'
  | 'modal'
  | 'drawer'
  | 'popover'
  | 'popconfirm';

export type OverlayPredictionStatus = 'resolved' | 'expired' | 'ambiguous';

export interface OverlayPredictionCandidate extends DialogContext {
  overlayKind: OverlayPredictionKind;
  signature: string;
  observedAt?: number;
}

export interface OverlayPrediction {
  version: 1;
  status: OverlayPredictionStatus;
  expectedKind?: OverlayPredictionKind;
  reason: string;
  elapsedMs?: number;
  resolved?: OverlayPredictionCandidate;
  candidates?: OverlayPredictionCandidate[];
}

export type OverlayPredictionTriggerEvidence = {
  controlType?: string;
  role?: string;
  testId?: string;
  text?: string;
  ariaLabel?: string;
  title?: string;
};

export type OverlayPredictionObserverOptions = {
  root?: ParentNode;
  expectedKind: OverlayPredictionKind;
  timeoutMs?: number;
  settleMs?: number;
  now?: () => number;
  isVisible?: (element: Element) => boolean;
  titleForElement?: (element: Element) => string | undefined;
  testIdForElement?: (element: Element) => string | undefined;
};

export const overlayPredictionSelectors = [
  '.ant-modal',
  '.ant-drawer',
  '.ant-popover',
  '.ant-dropdown',
  '.ant-select-dropdown',
  '.ant-cascader-dropdown',
  '[role="dialog"]',
  '[role="listbox"]',
  '[role="tree"]',
].join(', ');

export function expectedOverlayKindForTrigger(evidence: OverlayPredictionTriggerEvidence | undefined): OverlayPredictionKind | undefined {
  const controlType = evidence?.controlType || '';
  const role = evidence?.role || '';
  const text = normalizeOverlayPredictionText([
    evidence?.testId,
    evidence?.text,
    evidence?.ariaLabel,
    evidence?.title,
  ].filter(Boolean).join(' '));

  if (/^(select|tree-select|cascader)$/.test(controlType) || role === 'combobox')
    return 'select-dropdown';
  if (controlType === 'dropdown-trigger' || controlType === 'menu-item')
    return 'dropdown';
  if (/(delete|remove|trash|destroy|删除|移除)/i.test(text))
    return 'popconfirm';
  if (/(drawer|抽屉)/i.test(text))
    return 'drawer';
  if (/(create|add|new|edit|open|新增|新建|添加|编辑|打开)/i.test(text))
    return 'modal';
  return undefined;
}

export function createOverlayPrediction(options: {
  expectedKind?: OverlayPredictionKind;
  candidates: OverlayPredictionCandidate[];
  elapsedMs?: number;
}): OverlayPrediction {
  const candidates = options.candidates
      .filter(candidate => !options.expectedKind || overlayCandidateMatchesExpectedKind(candidate, options.expectedKind));
  if (!candidates.length) {
    return compactOverlayPrediction({
      version: 1,
      status: 'expired',
      expectedKind: options.expectedKind,
      elapsedMs: options.elapsedMs,
      reason: options.expectedKind
        ? `no ${options.expectedKind} overlay observed before prediction timeout`
        : 'no overlay observed before prediction timeout',
    } as OverlayPrediction);
  }
  if (candidates.length > 1) {
    return compactOverlayPrediction({
      version: 1,
      status: 'ambiguous',
      expectedKind: options.expectedKind,
      elapsedMs: options.elapsedMs,
      candidates: candidates.slice(0, 4),
      reason: `multiple ${options.expectedKind || 'overlay'} candidates observed`,
    } as OverlayPrediction);
  }
  return compactOverlayPrediction({
    version: 1,
    status: 'resolved',
    expectedKind: options.expectedKind,
    elapsedMs: options.elapsedMs,
    resolved: candidates[0],
    reason: `resolved ${candidates[0].overlayKind} overlay`,
  } as OverlayPrediction);
}

export function overlayCandidateMatchesExpectedKind(candidate: OverlayPredictionCandidate, expectedKind: OverlayPredictionKind) {
  if (candidate.overlayKind === expectedKind)
    return true;
  return expectedKind === 'popconfirm' && candidate.overlayKind === 'popover' && looksLikePopconfirm(candidate);
}

export function collectOverlayPredictionCandidates(options: {
  root?: ParentNode;
  now?: () => number;
  isVisible?: (element: Element) => boolean;
  titleForElement?: (element: Element) => string | undefined;
  testIdForElement?: (element: Element) => string | undefined;
} = {}): OverlayPredictionCandidate[] {
  const root = options.root || document;
  const now = options.now || defaultNow;
  const elements = Array.from(root.querySelectorAll(overlayPredictionSelectors));
  return elements
      .filter(element => (options.isVisible || defaultIsVisible)(element))
      .map(element => overlayPredictionCandidateForElement(element, {
        observedAt: now(),
        titleForElement: options.titleForElement,
        testIdForElement: options.testIdForElement,
      }))
      .filter(Boolean) as OverlayPredictionCandidate[];
}

export function observeOverlayPrediction(options: OverlayPredictionObserverOptions): Promise<OverlayPrediction> {
  const root = options.root || document;
  const target = root instanceof Document ? root.body || root.documentElement : root;
  const timeoutMs = options.timeoutMs ?? 1000;
  const settleMs = options.settleMs ?? 80;
  const now = options.now || defaultNow;
  const startedAt = now();
  const beforeSignatureCounts = overlayPredictionSignatureCounts(collectOverlayPredictionCandidates(options));
  let done = false;
  let observer: MutationObserver | undefined;
  let settleTimer: number | undefined;
  let timeoutTimer: number | undefined;

  return new Promise(resolve => {
    const finish = () => {
      if (done)
        return;
      done = true;
      if (settleTimer)
        window.clearTimeout(settleTimer);
      if (timeoutTimer)
        window.clearTimeout(timeoutTimer);
      observer?.disconnect();
      const candidates = newOverlayPredictionCandidates(
          collectOverlayPredictionCandidates(options),
          beforeSignatureCounts,
      );
      resolve(createOverlayPrediction({
        expectedKind: options.expectedKind,
        candidates,
        elapsedMs: Math.max(0, Math.round(now() - startedAt)),
      }));
    };

    const scheduleSettle = () => {
      if (done)
        return;
      if (settleTimer)
        window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(finish, settleMs);
    };

    observer = new MutationObserver(scheduleSettle);
    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-hidden'],
    });
    timeoutTimer = window.setTimeout(finish, timeoutMs);
  });
}

export function overlayPredictionSignatureCounts(candidates: OverlayPredictionCandidate[]) {
  const counts = new Map<string, number>();
  for (const candidate of candidates)
    counts.set(candidate.signature, (counts.get(candidate.signature) || 0) + 1);
  return counts;
}

export function newOverlayPredictionCandidates(candidates: OverlayPredictionCandidate[], beforeSignatureCounts: ReadonlyMap<string, number>) {
  const seenAfterCounts = new Map<string, number>();
  return candidates.filter(candidate => {
    const seenAfterCount = (seenAfterCounts.get(candidate.signature) || 0) + 1;
    seenAfterCounts.set(candidate.signature, seenAfterCount);
    return seenAfterCount > (beforeSignatureCounts.get(candidate.signature) || 0);
  });
}

function overlayPredictionCandidateForElement(element: Element, options: {
  observedAt?: number;
  titleForElement?: (element: Element) => string | undefined;
  testIdForElement?: (element: Element) => string | undefined;
}): OverlayPredictionCandidate | undefined {
  const overlayKind = overlayPredictionKindForElement(element);
  if (!overlayKind)
    return undefined;
  const title = options.titleForElement?.(element);
  const testId = options.testIdForElement?.(element);
  return compactOverlayPredictionCandidate({
    type: dialogTypeForOverlayPredictionKind(overlayKind),
    overlayKind,
    title,
    testId,
    visible: true,
    observedAt: options.observedAt,
    signature: overlayPredictionSignature({ overlayKind, title, testId }),
  });
}

function overlayPredictionKindForElement(element: Element): OverlayPredictionKind | undefined {
  const className = (element.getAttribute('class') || '').toLowerCase();
  const role = element.getAttribute('role') || '';
  if (className.includes('ant-drawer'))
    return 'drawer';
  if (className.includes('ant-popover'))
    return element.querySelector('.ant-popconfirm, .ant-popconfirm-buttons') ? 'popconfirm' : 'popover';
  if (className.includes('ant-select-dropdown') || className.includes('ant-cascader-dropdown') || role === 'listbox' || role === 'tree')
    return 'select-dropdown';
  if (className.includes('ant-dropdown'))
    return 'dropdown';
  if (className.includes('ant-modal') || role === 'dialog')
    return 'modal';
  return undefined;
}

function dialogTypeForOverlayPredictionKind(kind: OverlayPredictionKind): DialogContext['type'] {
  if (kind === 'drawer')
    return 'drawer';
  if (kind === 'popover' || kind === 'popconfirm')
    return 'popover';
  if (kind === 'select-dropdown' || kind === 'dropdown')
    return 'dropdown';
  return 'modal';
}

function looksLikePopconfirm(candidate: OverlayPredictionCandidate) {
  const text = normalizeOverlayPredictionText([candidate.title, candidate.testId].filter(Boolean).join(' '));
  return /(popconfirm|confirm|delete|remove|删除|移除|确认|确定)/i.test(text);
}

function overlayPredictionSignature(candidate: Pick<OverlayPredictionCandidate, 'overlayKind' | 'title' | 'testId'>) {
  return [
    candidate.overlayKind,
    candidate.testId,
    normalizeOverlayPredictionText(candidate.title || ''),
  ].filter(Boolean).join(':');
}

function normalizeOverlayPredictionText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function compactOverlayPrediction(value: OverlayPrediction): OverlayPrediction {
  return compactObject(value as unknown as Record<string, unknown>) as unknown as OverlayPrediction;
}

function compactOverlayPredictionCandidate(value: OverlayPredictionCandidate): OverlayPredictionCandidate {
  return compactObject(value as unknown as Record<string, unknown>) as unknown as OverlayPredictionCandidate;
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

function defaultNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

function defaultIsVisible(element: Element) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
}
