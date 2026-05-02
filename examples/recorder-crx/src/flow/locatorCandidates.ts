/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import type { LocatorCandidate, RecordedTargetSnapshot } from './adaptiveTargetTypes';

export function buildLocatorCandidates(snapshot: RecordedTargetSnapshot): LocatorCandidate[] {
  const candidates: LocatorCandidate[] = [];

  if (snapshot.testId) {
    candidates.push({
      kind: 'testid',
      value: snapshot.testId,
      score: 100,
      scope: bestScope(snapshot),
      pageCount: snapshot.locatorHint?.pageCount,
      scopeCount: snapshot.locatorHint?.scopeCount,
      strict: true,
      reason: 'data-testid is present and preferred as the most stable locator signal',
    });
  }

  if (snapshot.dataE2E) {
    candidates.push({
      kind: 'data-e2e',
      value: snapshot.dataE2E,
      score: 98,
      scope: bestScope(snapshot),
      strict: true,
      reason: 'data-e2e is present and treated as a stable business locator signal',
    });
  }

  if (snapshot.row && (snapshot.row.tableTestId || snapshot.row.rowIdentity?.value || snapshot.row.rowTextSummary)) {
    const rowIdentity = snapshot.row.rowIdentity?.value || snapshot.row.rowKey || snapshot.row.rowTextSummary;
    const action = [snapshot.row.actionRole, snapshot.row.actionName].filter(Boolean).join(':');
    candidates.push({
      kind: 'table-row',
      value: [snapshot.row.tableTestId, rowIdentity, action].filter(Boolean).join(' > '),
      score: snapshot.row.rowIdentity?.stable || snapshot.row.rowKey ? 96 : 86,
      scope: 'table',
      scopeCount: snapshot.locatorHint?.scopeCount,
      strict: !!snapshot.row.tableTestId && !!rowIdentity,
      reason: 'table row context is first-class; row action must stay scoped to its row identity',
    });
  }

  if (snapshot.role && (snapshot.accessibleName || snapshot.normalizedText)) {
    candidates.push({
      kind: 'role',
      value: `${snapshot.role}:${snapshot.accessibleName || snapshot.normalizedText}`,
      score: bestScope(snapshot) === 'page' ? 70 : 90,
      scope: bestScope(snapshot),
      pageCount: snapshot.locatorHint?.pageCount,
      scopeCount: snapshot.locatorHint?.scopeCount,
      strict: snapshot.locatorHint?.scopeCount === 1 || snapshot.locatorHint?.pageCount === 1,
      reason: 'role/name candidate can be stable when unique within the recorded scope',
    });
  }

  if (snapshot.labelText) {
    candidates.push({
      kind: 'label',
      value: snapshot.labelText,
      score: 82,
      scope: 'form',
      strict: true,
      reason: 'form label is available from the existing step context',
    });
  }

  if (snapshot.placeholder) {
    candidates.push({
      kind: 'placeholder',
      value: snapshot.placeholder,
      score: 78,
      scope: 'form',
      reason: 'placeholder is available as a field-level semantic locator',
    });
  }

  const optionCandidate = optionCandidateKind(snapshot.controlType);
  if (optionCandidate && snapshot.normalizedText) {
    candidates.push({
      kind: optionCandidate,
      value: snapshot.normalizedText,
      score: 76,
      scope: bestScope(snapshot),
      reason: 'AntD/ProComponents option candidate preserves component type and option text/path context',
    });
  }

  if (snapshot.normalizedText) {
    candidates.push({
      kind: 'text',
      value: snapshot.normalizedText,
      score: snapshot.locatorHint?.scopeCount === 1 ? 62 : 42,
      scope: bestScope(snapshot),
      pageCount: snapshot.locatorHint?.pageCount,
      scopeCount: snapshot.locatorHint?.scopeCount,
      strict: snapshot.locatorHint?.scopeCount === 1,
      reason: 'short text is diagnostic only unless it is unique within the recorded scope',
    });
  }

  return candidates.sort((left, right) => right.score - left.score);
}

function bestScope(snapshot: RecordedTargetSnapshot): LocatorCandidate['scope'] {
  if (snapshot.scope?.table)
    return 'table';
  if (snapshot.scope?.dialog)
    return 'dialog';
  if (snapshot.scope?.section)
    return 'section';
  if (snapshot.scope?.form)
    return 'form';
  return 'page';
}

function optionCandidateKind(controlType: RecordedTargetSnapshot['controlType']): LocatorCandidate['kind'] | undefined {
  if (controlType === 'select-option')
    return 'antd-select-option';
  if (controlType === 'tree-select-option')
    return 'antd-tree-select-option';
  if (controlType === 'cascader-option')
    return 'antd-cascader-option';
  return undefined;
}
