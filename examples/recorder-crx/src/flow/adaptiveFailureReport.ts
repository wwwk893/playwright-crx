/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import type {
  AdaptiveLocatorCandidate,
  AdaptiveTableRowSnapshot,
  AdaptiveTargetContextSnapshot,
  AdaptiveTargetCoreSnapshot,
} from './adaptiveTargetTypes';
import { createAdaptiveTargetSnapshot } from './adaptiveTargetSnapshot';
import { redactAdaptiveValue } from './adaptiveTargetRedactor';
import type { BusinessFlow, FlowActionType } from './types';
import { buildRecipeForStep } from '../replay/recipeBuilder';

export type ReplayFailureDiagnosticSource = 'generated-playwright' | 'parser-safe-runtime' | 'terminal-assertion';

export type ReplayFailureKind =
  | 'locator-missing'
  | 'strict-mode'
  | 'wrong-terminal-state'
  | 'timeout'
  | 'runtime-bridge-miss'
  | 'unknown';

export interface ReplayFailureSummary {
  message: string;
  kind: ReplayFailureKind;
}

export interface ReplayFailureDiagnostic {
  version: 1;
  stepId: string;
  action: FlowActionType;
  intent?: string;
  source: ReplayFailureDiagnosticSource;
  failure: ReplayFailureSummary;
  target?: AdaptiveTargetCoreSnapshot;
  tableRow?: AdaptiveTableRowSnapshot;
  context?: AdaptiveTargetContextSnapshot;
  candidates: AdaptiveLocatorCandidate[];
  replay?: {
    recipeComponent?: string;
    recipeOperation?: string;
    exportedStrategy?: string;
    parserSafeStrategy?: string;
    runtimeFallback?: string;
  };
  fallback: {
    autoFallback: false;
    reason: string;
  };
}

export function createReplayFailureDiagnostic(
  flow: BusinessFlow,
  stepId: string,
  failure: ReplayFailureSummary,
  options: { source?: ReplayFailureDiagnosticSource; now?: () => Date } = {},
): ReplayFailureDiagnostic | undefined {
  const step = flow.steps.find(step => step.id === stepId);
  if (!step)
    return undefined;

  const snapshot = createAdaptiveTargetSnapshot(step, options);
  const recipe = buildRecipeForStep(step);
  const replay = recipe ? compactObject({
    recipeComponent: recipe.component,
    recipeOperation: recipe.operation,
    exportedStrategy: recipe.replay?.exportedStrategy,
    parserSafeStrategy: recipe.replay?.parserSafeStrategy,
    runtimeFallback: recipe.replay?.runtimeFallback,
  }) : undefined;

  return redactReplayDiagnostic(compactObject({
    version: 1,
    stepId: step.id,
    action: step.action,
    intent: step.intent,
    source: options.source || 'generated-playwright',
    failure: sanitizeReplayFailureSummary(failure),
    target: sanitizeFailureTarget(snapshot?.target),
    tableRow: sanitizeFailureTableRow(snapshot?.tableRow),
    context: snapshot?.context,
    candidates: sanitizeFailureCandidates(snapshot?.candidates || []),
    replay,
    fallback: {
      autoFallback: false,
      reason: recipe?.replay?.runtimeFallback
        ? 'runtime fallback is declared for parser-safe replay, but diagnostics never auto-retry or self-heal generated replay failures'
        : 'adaptive diagnostics are report-only and do not select alternate locator candidates',
    },
  }) as ReplayFailureDiagnostic) as ReplayFailureDiagnostic;
}

export function sanitizeReplayFailureSummary(failure: ReplayFailureSummary): ReplayFailureSummary {
  return redactDiagnosticValue({
    kind: failure.kind,
    message: compactDiagnosticText(failure.message, 1200),
  }) as ReplayFailureSummary;
}

function sanitizeFailureTarget(target?: AdaptiveTargetCoreSnapshot): AdaptiveTargetCoreSnapshot | undefined {
  if (!target)
    return undefined;
  const sanitized = { ...target };
  delete sanitized.selector;
  delete sanitized.locator;
  return compactObject(sanitized) as AdaptiveTargetCoreSnapshot | undefined;
}

function sanitizeFailureTableRow(tableRow?: AdaptiveTableRowSnapshot): AdaptiveTableRowSnapshot | undefined {
  if (!tableRow)
    return undefined;
  const sanitized = { ...tableRow };
  delete sanitized.rowText;
  return compactObject(sanitized) as AdaptiveTableRowSnapshot | undefined;
}

function sanitizeFailureCandidates(candidates: AdaptiveLocatorCandidate[]) {
  return candidates.slice(0, 6).map(candidate => {
    if (candidate.kind === 'css') {
      return {
        ...candidate,
        value: '[css selector omitted]',
        reason: 'fallback selector omitted from diagnostics',
      };
    }
    return {
      ...candidate,
      value: compactDiagnosticText(candidate.value, 160),
      reason: compactDiagnosticText(candidate.reason, 120),
    };
  });
}

function redactReplayDiagnostic(diagnostic: ReplayFailureDiagnostic) {
  return redactDiagnosticValue(diagnostic) as ReplayFailureDiagnostic;
}

function redactDiagnosticValue(value: unknown): unknown {
  if (typeof value === 'string')
    return redactAdaptiveValue(stripDiagnosticUrls(value));
  if (!value || typeof value !== 'object')
    return value;
  if (Array.isArray(value))
    return value.map(redactDiagnosticValue);
  const record: Record<string, unknown> = {};
  for (const [key, childValue] of Object.entries(value))
    record[key] = redactDiagnosticValue(childValue);
  return redactAdaptiveValue(record);
}

function compactDiagnosticText(value: string, maxLength: number) {
  const compacted = value
      .replace(/<[^>]+>/g, '[dom omitted]')
      .replace(/\s+/g, ' ')
      .trim();
  if (compacted.length <= maxLength)
    return compacted;
  return `${compacted.slice(0, Math.max(0, maxLength - 18)).trim()}...***truncated***`;
}

function stripDiagnosticUrls(value: string) {
  return value.replace(/\bhttps?:\/\/[^\s"'<>),]+/g, match => compactUrl(match));
}

function compactUrl(value: string) {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return `${url.origin}${url.pathname}`;
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
