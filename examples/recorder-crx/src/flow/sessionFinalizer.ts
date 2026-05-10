/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import { composeInputTransactionsFromFlow } from '../interactions/inputTransactions';
import { composeSelectTransactionsFromFlow } from '../interactions/selectTransactions';
import { eventJournalStats } from './eventJournal';
import { projectBusinessFlow } from './businessFlowProjection';
import type { BusinessFlow } from './types';

export type FinalizeRecordingReason = 'stop-recording' | 'enter-review' | 'export' | 'generate-code';

export type FinalizerCounts = {
  recorderActionCount: number;
  pageContextEventCount: number;
  pendingContextCount: number;
  openTransactionCount: number;
  lastEventAt?: number;
  lastRecorderActionAt?: number;
  lastPageContextEventAt?: number;
};

export type FinalizeDiagnosticEvent = {
  type: 'finalize.start' | 'finalize.sample' | 'finalize.stable' | 'finalize.timeout';
  level?: 'warn';
  message: string;
  data: {
    reason: FinalizeRecordingReason;
    elapsedMs: number;
    stableForMs: number;
    maxWaitMs: number;
    counts: FinalizerCounts;
  };
};

export type FinalizeRecordingOptions = {
  reason: FinalizeRecordingReason;
  drainRecorderActions?: () => Promise<void>;
  drainPageContextEvents?: () => Promise<void | BusinessFlow>;
  getCurrentFlow?: () => BusinessFlow;
  diagnostics?: (event: FinalizeDiagnosticEvent) => void;
  stableForMs?: number;
  maxWaitMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
};

const defaultStableForMs = 250;
const defaultMaxWaitMs = 1200;
const defaultPollIntervalMs = 50;

export async function finalizeRecordingSession(flow: BusinessFlow, options: FinalizeRecordingOptions): Promise<BusinessFlow> {
  const stableForMs = options.stableForMs ?? defaultStableForMs;
  const maxWaitMs = options.maxWaitMs ?? defaultMaxWaitMs;
  const pollIntervalMs = options.pollIntervalMs ?? defaultPollIntervalMs;
  const now = options.now ?? (() => Date.now());
  const wait = options.wait ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const startAt = now();
  let currentFlow = flow;
  let previousSignature: string | undefined;
  let stableSince = startAt;

  const emit = (type: FinalizeDiagnosticEvent['type'], counts: FinalizerCounts, level?: 'warn') => {
    options.diagnostics?.({
      type,
      level,
      message: diagnosticMessage(type, options.reason),
      data: {
        reason: options.reason,
        elapsedMs: Math.max(0, now() - startAt),
        stableForMs,
        maxWaitMs,
        counts,
      },
    });
  };

  emit('finalize.start', finalizerCounts(currentFlow));

  while (true) {
    await options.drainRecorderActions?.();
    const drainedFlow = await options.drainPageContextEvents?.();
    if (drainedFlow)
      currentFlow = drainedFlow;
    currentFlow = options.getCurrentFlow?.() ?? currentFlow;

    const counts = finalizerCounts(currentFlow);
    const signature = countsSignature(counts);
    const elapsedMs = Math.max(0, now() - startAt);
    if (signature !== previousSignature) {
      previousSignature = signature;
      stableSince = now();
      emit('finalize.sample', counts);
    }

    if (now() - stableSince >= stableForMs) {
      emit('finalize.stable', counts);
      return projectBusinessFlow(currentFlow, { commitOpen: true });
    }

    if (elapsedMs >= maxWaitMs) {
      emit('finalize.timeout', counts, 'warn');
      return projectBusinessFlow(currentFlow, { commitOpen: true });
    }

    const remainingUntilStable = Math.max(0, stableForMs - (now() - stableSince));
    const remainingUntilTimeout = Math.max(0, maxWaitMs - elapsedMs);
    await wait(Math.max(1, Math.min(pollIntervalMs, remainingUntilStable, remainingUntilTimeout)));
  }
}

export function finalizerCounts(flow: BusinessFlow): FinalizerCounts {
  const recorder = flow.artifacts?.recorder;
  if (!recorder) {
    return {
      recorderActionCount: 0,
      pageContextEventCount: 0,
      pendingContextCount: 0,
      openTransactionCount: 0,
    };
  }
  const stats = eventJournalStats(recorder);
  const inputTransactions = composeInputTransactionsFromFlow(flow, { commitOpen: false });
  const selectTransactions = composeSelectTransactionsFromFlow(flow, { commitOpen: false });
  const openTransactionCount = inputTransactions.openInputTransactions.length + selectTransactions.openSelectTransactions.length;
  return {
    recorderActionCount: stats.recorderActionCount,
    pageContextEventCount: stats.pageContextEventCount,
    pendingContextCount: openTransactionCount,
    openTransactionCount,
    lastEventAt: stats.lastEventAt,
    lastRecorderActionAt: stats.lastRecorderActionAt,
    lastPageContextEventAt: stats.lastPageContextEventAt,
  };
}

function countsSignature(counts: FinalizerCounts) {
  return JSON.stringify(counts);
}

function diagnosticMessage(type: FinalizeDiagnosticEvent['type'], reason: FinalizeRecordingReason) {
  switch (type) {
    case 'finalize.start': return `开始 finalize recording session: ${reason}`;
    case 'finalize.sample': return `录制事实层采样: ${reason}`;
    case 'finalize.stable': return `录制事实层已稳定: ${reason}`;
    case 'finalize.timeout': return `录制事实层等待超时: ${reason}`;
  }
}
