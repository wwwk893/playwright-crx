/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { UiLibrary, UiSemanticContext } from './types';

export type SemanticDiagnosticLevel = 'debug' | 'info' | 'warn';

export type SemanticDiagnosticEvent =
  | 'semantic.detect'
  | 'semantic.weak'
  | 'semantic.fallback-css'
  | 'semantic.disabled'
  | 'semantic.compact-sanitized';

export interface SemanticDiagnosticEntry {
  id: string;
  time: string;
  level: SemanticDiagnosticLevel;
  event: SemanticDiagnosticEvent;
  library: UiLibrary;
  component: string;
  confidence?: number;
  weak?: boolean;
  targetTestId?: string;
  targetText?: string;
  recipeKind?: string;
  reasons?: string[];
  locatorHints?: Array<{
    kind: string;
    score: number;
    scope?: string;
    reason?: string;
    valuePreview?: string;
  }>;
  fallbackReasons?: string[];
}

export interface SemanticDiagnosticsBuffer {
  push(entry?: SemanticDiagnosticEntry): void;
  entries(): SemanticDiagnosticEntry[];
  clear(): void;
}

const defaultLimit = 200;
const maxPreviewLength = 80;
const maxReasonLength = 80;
const sensitivePattern = /(password|passwd|pwd|token|cookie|authorization|auth|secret|session|api[-_]?key)/ig;
const sensitiveAssignmentPattern = /\b(password|passwd|pwd|token|cookie|authorization|auth|secret|session|api[-_]?key)\b\s*[:=]\s*[^\s,;&]+|\b(password|passwd|pwd|token|cookie|authorization|auth|secret|session|api[-_]?key)[-_][A-Za-z0-9._~+\-/]+/ig;
const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+\-/]+=*/ig;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phonePattern = /\b(?:\+?86[- ]?)?1[3-9]\d{9}\b/g;
const idPattern = /\b\d{17}[\dXx]\b/g;

let nextEntryId = 1;
export const semanticDiagnostics = createSemanticDiagnosticsBuffer(defaultLimit);

export function createSemanticDiagnosticsBuffer(limit = defaultLimit): SemanticDiagnosticsBuffer {
  const entries: SemanticDiagnosticEntry[] = [];
  const boundedLimit = Math.max(1, Math.floor(limit));
  return {
    push(entry?: SemanticDiagnosticEntry) {
      if (!entry)
        return;
      entries.push(entry);
      if (entries.length > boundedLimit)
        entries.splice(0, entries.length - boundedLimit);
    },
    entries() {
      return entries.map(entry => ({
        ...entry,
        reasons: entry.reasons ? [...entry.reasons] : undefined,
        locatorHints: entry.locatorHints ? entry.locatorHints.map(hint => ({ ...hint })) : undefined,
        fallbackReasons: entry.fallbackReasons ? [...entry.fallbackReasons] : undefined,
      }));
    },
    clear() {
      entries.splice(0, entries.length);
    },
  };
}

export function compactSemanticDiagnostic(ui?: UiSemanticContext): SemanticDiagnosticEntry | undefined {
  if (!ui)
    return undefined;
  const fallbackHints = ui.locatorHints?.filter(hint => hint.kind === 'css') ?? [];
  const event: SemanticDiagnosticEvent = fallbackHints.length ? 'semantic.fallback-css' : ui.weak ? 'semantic.weak' : 'semantic.detect';
  return compactDiagnosticObject({
    id: nextDiagnosticId(),
    time: new Date().toISOString(),
    level: ui.weak || fallbackHints.length ? 'warn' : 'debug',
    event,
    library: ui.library,
    component: ui.component,
    confidence: ui.confidence,
    weak: ui.weak || undefined,
    targetTestId: compactString(ui.targetTestId),
    targetText: compactString(ui.targetText),
    recipeKind: ui.recipe?.kind,
    reasons: compactStringList(ui.reasons),
    locatorHints: compactLocatorHints(ui.locatorHints),
    fallbackReasons: compactStringList(fallbackHints.map(hint => hint.reason)),
  }) as SemanticDiagnosticEntry;
}

export function compactSemanticDisabledDiagnostic(): SemanticDiagnosticEntry {
  return {
    id: nextDiagnosticId(),
    time: new Date().toISOString(),
    level: 'info',
    event: 'semantic.disabled',
    library: 'unknown',
    component: 'unknown',
  };
}

export function recordSemanticDiagnostic(entry?: SemanticDiagnosticEntry) {
  semanticDiagnostics.push(entry);
}

function compactLocatorHints(hints?: UiSemanticContext['locatorHints']) {
  const compactHints = (hints ?? []).slice(0, 5).map(hint => compactDiagnosticObject({
    kind: hint.kind,
    score: hint.score,
    scope: hint.scope,
    reason: compactString(hint.reason, maxReasonLength),
    valuePreview: compactString(hint.value, maxPreviewLength),
  })).filter(Boolean) as SemanticDiagnosticEntry['locatorHints'];
  return compactHints?.length ? compactHints : undefined;
}

function compactStringList(values?: string[]) {
  const result = (values ?? []).map(value => compactString(value, maxReasonLength)).filter(Boolean) as string[];
  return result.length ? result.slice(0, 5) : undefined;
}

function compactString(value?: string, maxLength = maxPreviewLength) {
  if (!value)
    return undefined;
  const redacted = value
      .replace(sensitiveAssignmentPattern, '$1=***')
      .replace(bearerPattern, 'Bearer ***')
      .replace(sensitivePattern, '***')
      .replace(emailPattern, '***email***')
      .replace(phonePattern, '***phone***')
      .replace(idPattern, '***id***')
      .replace(/\s+/g, ' ')
      .trim();
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength - 1)}…` : redacted;
}

function compactDiagnosticObject<T extends Record<string, unknown>>(object: T): Partial<T> | undefined {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined || value === '' || (Array.isArray(value) && !value.length))
      continue;
    result[key as keyof T] = value as T[keyof T];
  }
  return Object.keys(result).length ? result : undefined;
}

function nextDiagnosticId() {
  return `sem-${nextEntryId++}`;
}

const globalWithDiagnostics = globalThis as typeof globalThis & {
  __playwrightCrxSemanticDiagnostics?: SemanticDiagnosticsBuffer;
};

globalWithDiagnostics.__playwrightCrxSemanticDiagnostics = semanticDiagnostics;
