/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import {
  createReplayFailureDiagnostic,
  sanitizeReplayFailureSummary,
  type ReplayFailureDiagnostic,
  type ReplayFailureDiagnosticSource,
  type ReplayFailureKind,
  type ReplayFailureSummary,
} from './adaptiveFailureReport';
import type { BusinessFlow } from './types';

export interface ReplayFailureDiagnosticsArtifact {
  version: 1;
  source: ReplayFailureDiagnosticSource;
  generatedAt: string;
  failure: ReplayFailureSummary;
  inferredStepIds: string[];
  diagnostics: ReplayFailureDiagnostic[];
}

export function createReplayFailureDiagnosticsArtifact(
  flow: BusinessFlow,
  failure: Partial<ReplayFailureSummary> & { message: string },
  options: {
    source?: ReplayFailureDiagnosticSource;
    stepIds?: string[];
    generatedSource?: string;
    output?: string;
    now?: () => Date;
  } = {},
): ReplayFailureDiagnosticsArtifact | undefined {
  const source = options.source || 'generated-playwright';
  const summary = sanitizeReplayFailureSummary({
    kind: failure.kind || classifyReplayFailureKind(failure.message),
    message: failure.message,
  });
  const stepIds = diagnosticStepIds(flow, {
    stepIds: options.stepIds,
    generatedSource: options.generatedSource,
    output: options.output || failure.message,
  });
  const diagnostics = stepIds
      .map(stepId => createReplayFailureDiagnostic(flow, stepId, summary, { source, now: options.now }))
      .filter(Boolean) as ReplayFailureDiagnostic[];
  if (!diagnostics.length)
    return undefined;
  return {
    version: 1,
    source,
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    failure: summary,
    inferredStepIds: diagnostics.map(diagnostic => diagnostic.stepId),
    diagnostics,
  };
}

export function classifyReplayFailureKind(message: string): ReplayFailureKind {
  if (/strict mode violation/i.test(message))
    return 'strict-mode';
  if (/runtime bridge|active[- ]antd[- ]popup|popup option/i.test(message))
    return 'runtime-bridge-miss';
  if (/timed out|timeout/i.test(message))
    return 'timeout';
  if (/toBeVisible|toBeHidden|toHaveCount|terminal-state|expect\(/i.test(message))
    return 'wrong-terminal-state';
  if (/locator|waiting for|not found|No node found|Unable to find/i.test(message))
    return 'locator-missing';
  return 'unknown';
}

function diagnosticStepIds(flow: BusinessFlow, options: { stepIds?: string[]; generatedSource?: string; output?: string }) {
  const explicit = uniqueStepIds(flow, options.stepIds || []);
  if (explicit.length)
    return explicit;

  const lineNumbers = generatedSourceLineNumbers(options.output || '');
  const fromLines = uniqueStepIds(flow, lineNumbers.map(line => stepIdForGeneratedSourceLine(options.generatedSource || '', line)).filter(Boolean) as string[]);
  if (fromLines.length)
    return fromLines;

  const assertionSteps = flow.steps.filter(step => step.assertions.some(assertion => assertion.enabled)).map(step => step.id);
  if (assertionSteps.length)
    return assertionSteps.slice(-2);
  return flow.steps.length ? [flow.steps[flow.steps.length - 1].id] : [];
}

function generatedSourceLineNumbers(output: string) {
  const matches = Array.from(output.matchAll(/generated-replay\.spec\.ts:(\d+):\d+/g));
  return matches.map(match => Number(match[1])).filter(Number.isFinite);
}

function stepIdForGeneratedSourceLine(source: string, lineNumber: number) {
  if (!source || !Number.isFinite(lineNumber))
    return undefined;
  const lines = source.split('\n');
  for (let index = Math.min(lines.length - 1, lineNumber - 1); index >= 0; index--) {
    const match = lines[index].match(/^\s*\/\/\s+(s\d{3,})\b/);
    if (match)
      return match[1];
  }
  return undefined;
}

function uniqueStepIds(flow: BusinessFlow, stepIds: string[]) {
  const valid = new Set(flow.steps.map(step => step.id));
  return [...new Set(stepIds.filter(stepId => valid.has(stepId)))];
}
