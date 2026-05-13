/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import type { AdaptiveLocatorCandidate, AdaptiveLocatorCandidateKind } from './adaptiveTargetTypes';
import type { FlowStep } from './types';

const priority: Record<AdaptiveLocatorCandidateKind, number> = {
  testid: 0,
  'table-row': 1,
  role: 2,
  label: 3,
  text: 4,
  css: 5,
};

export function rankAdaptiveLocatorCandidates(step: FlowStep): AdaptiveLocatorCandidate[] {
  const candidates: AdaptiveLocatorCandidate[] = [];
  const target = step.target;
  const context = step.context?.before;
  const contextTarget = context?.target;
  const ui = context?.ui;
  const table = target?.scope?.table || context?.table;

  addCandidate(candidates, 'testid', firstText(target?.testId, contextTarget?.testId, ui?.targetTestId), 0.98, 'stable test id', scopeForStep(step));

  const rowValue = firstText(table?.rowKey, table?.rowIdentity?.value, table?.rowText);
  if (rowValue) {
    const tableName = firstText(table?.testId, table?.title, ui?.table?.testId, ui?.table?.title);
    addCandidate(candidates, 'table-row', [tableName, rowValue].filter(Boolean).join(' row '), 0.94, 'table row identity', 'table');
  }

  const role = firstText(target?.role, contextTarget?.role, ui?.targetRole);
  const roleName = firstText(target?.name, target?.displayName, target?.text, contextTarget?.ariaLabel, contextTarget?.text, ui?.targetText);
  if (role)
    addCandidate(candidates, 'role', roleName ? `${role}:${roleName}` : role, 0.88, 'role and accessible name', scopeForStep(step));

  addCandidate(candidates, 'label', firstText(target?.label, context?.form?.label, ui?.form?.label), 0.82, 'form label', 'form');
  addCandidate(candidates, 'text', firstText(target?.text, target?.displayName, contextTarget?.text, contextTarget?.title, ui?.targetText), 0.64, 'visible text', scopeForStep(step));

  const selector = firstText(target?.selector, target?.locator, rawSelector(step.rawAction));
  if (selector)
    addCandidate(candidates, 'css', selector, 0.3, 'fallback selector', scopeForStep(step));

  return dedupeCandidates(candidates)
      .sort((left, right) => priority[left.kind] - priority[right.kind] || right.score - left.score);
}

function addCandidate(candidates: AdaptiveLocatorCandidate[], kind: AdaptiveLocatorCandidateKind, value: string | undefined, score: number, reason: string, scope?: AdaptiveLocatorCandidate['scope']) {
  const normalized = normalizeCandidateValue(value);
  if (!normalized)
    return;
  candidates.push({ kind, value: normalized, score, reason, scope });
}

function dedupeCandidates(candidates: AdaptiveLocatorCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter(candidate => {
    const key = `${candidate.kind}:${candidate.value}`;
    if (seen.has(key))
      return false;
    seen.add(key);
    return true;
  });
}

function scopeForStep(step: FlowStep): AdaptiveLocatorCandidate['scope'] {
  const dialogType = step.target?.scope?.dialog?.type || step.context?.before.dialog?.type;
  if (dialogType === 'drawer')
    return 'drawer';
  if (dialogType)
    return dialogType === 'dropdown' || dialogType === 'popover' ? 'overlay' : 'dialog';
  if (step.target?.scope?.table || step.context?.before.table)
    return 'table';
  if (step.target?.scope?.form || step.context?.before.form)
    return 'form';
  if (step.target?.scope?.section || step.context?.before.section)
    return 'section';
  return 'page';
}

function rawSelector(rawAction: unknown) {
  const record = rawAction && typeof rawAction === 'object' ? rawAction as { action?: Record<string, unknown>; selector?: unknown } : undefined;
  const action = record?.action && typeof record.action === 'object' ? record.action : record;
  return typeof action?.selector === 'string' ? action.selector : undefined;
}

function firstText(...values: Array<string | undefined>) {
  return values.map(value => normalizeCandidateValue(value)).find(Boolean);
}

function normalizeCandidateValue(value?: string) {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  return normalized || undefined;
}
