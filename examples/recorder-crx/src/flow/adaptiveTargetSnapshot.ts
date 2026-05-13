/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import type { AdaptiveTargetSnapshot } from './adaptiveTargetTypes';
import { redactAdaptiveTargetSnapshot } from './adaptiveTargetRedactor';
import { rankAdaptiveLocatorCandidates } from './locatorCandidates';
import type { BusinessFlow, FlowRecorderState, FlowStep } from './types';

export function createAdaptiveTargetSnapshot(step: FlowStep, options: { now?: () => Date } = {}): AdaptiveTargetSnapshot | undefined {
  const target = compactObject({
    testId: firstText(step.target?.testId, step.context?.before.target?.testId, step.context?.before.ui?.targetTestId),
    role: firstText(step.target?.role, step.context?.before.target?.role, step.context?.before.ui?.targetRole),
    name: step.target?.name,
    displayName: step.target?.displayName,
    label: firstText(step.target?.label, step.context?.before.form?.label, step.context?.before.ui?.form?.label),
    placeholder: firstText(step.target?.placeholder, step.context?.before.target?.placeholder),
    text: firstText(step.target?.text, step.context?.before.target?.text, step.context?.before.ui?.targetText),
    title: step.context?.before.target?.title,
    ariaLabel: step.context?.before.target?.ariaLabel,
    selector: step.target?.selector,
    locator: step.target?.locator,
    controlType: step.context?.before.target?.controlType || step.context?.before.ui?.form?.fieldKind,
  });
  const table = step.target?.scope?.table || step.context?.before.table;
  const tableRow = compactObject({
    tableTestId: firstText(table?.testId, step.context?.before.ui?.table?.testId),
    tableTitle: firstText(table?.title, step.context?.before.ui?.table?.title),
    rowKey: firstText(table?.rowKey, step.context?.before.ui?.table?.rowKey),
    rowText: table?.rowText,
    rowIdentity: table?.rowIdentity,
    columnName: firstText(table?.columnName, step.context?.before.ui?.table?.columnTitle),
    nestingLevel: table?.nestingLevel,
    fixedSide: table?.fixedSide,
  });
  const context = compactObject({
    url: compactUrl(step.context?.before.url),
    pageTitle: step.context?.before.title,
    dialogTitle: step.target?.scope?.dialog?.title || step.context?.before.dialog?.title,
    sectionTitle: step.target?.scope?.section?.title || step.context?.before.section?.title,
    formLabel: step.target?.scope?.form?.label || step.context?.before.form?.label,
    formName: step.target?.scope?.form?.name || step.context?.before.form?.name,
  });
  const candidates = rankAdaptiveLocatorCandidates(step);

  if (!target && !tableRow && !candidates.length)
    return undefined;

  return redactAdaptiveTargetSnapshot(compactObject({
    version: 1,
    stepId: step.id,
    action: step.action,
    capturedAt: (options.now?.() ?? new Date()).toISOString(),
    target: target || {},
    tableRow,
    context,
    candidates,
  }) as AdaptiveTargetSnapshot);
}

export function withAdaptiveTargetSnapshot(flow: BusinessFlow, stepId: string, options: { now?: () => Date } = {}): BusinessFlow {
  const step = flow.steps.find(step => step.id === stepId);
  if (!step)
    return flow;
  const snapshot = createAdaptiveTargetSnapshot(step, options);
  if (!snapshot)
    return flow;
  const recorder = flow.artifacts?.recorder ?? createEmptyRecorderState();
  return {
    ...flow,
    artifacts: {
      ...flow.artifacts,
      recorder: {
        ...recorder,
        adaptiveTargets: {
          ...recorder.adaptiveTargets,
          [stepId]: snapshot,
        },
      },
    },
  };
}

function createEmptyRecorderState(): FlowRecorderState {
  return {
    version: 3,
    actionLog: [],
    nextActionSeq: 1,
    nextStepSeq: 1,
    sessions: [],
  };
}

function firstText(...values: Array<string | undefined>) {
  return values.map(value => value?.replace(/\s+/g, ' ').trim()).find(Boolean);
}

function compactUrl(value?: string) {
  if (!value)
    return undefined;
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.origin === 'null' ? url.href : `${url.origin}${url.pathname}`;
  } catch {
    return value.split(/[?#]/)[0];
  }
}

function compactObject<T extends Record<string, unknown>>(object: T): Partial<T> | undefined {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined || value === '' || (Array.isArray(value) && !value.length))
      continue;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const compacted = compactObject(value as Record<string, unknown>);
      if (compacted)
        result[key as keyof T] = compacted as T[keyof T];
      continue;
    }
    result[key as keyof T] = value as T[keyof T];
  }
  return Object.keys(result).length ? result : undefined;
}
