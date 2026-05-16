/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import { buildAiIntentInput } from '../aiIntent/prompt';
import { collectOverlayPredictionCandidates, createOverlayPrediction, expectedOverlayKindForTrigger, newOverlayPredictionCandidates, overlayPredictionSignatureCounts, type OverlayPredictionCandidate } from '../capture/overlayPrediction';
import { extractTargetFromRecorderAction } from '../capture/targetFromRecorderSelector';
import { equivalentAnchorCandidates, rankAnchorCandidates } from '../uiSemantics/anchorDiagnostics';
import { collectAnchorGroundingEvidence, shouldCollectAnchorGroundingDiagnostics } from '../uiSemantics/anchorGrounding';
import { compactSemanticDiagnostic, createSemanticDiagnosticsBuffer } from '../uiSemantics/diagnostics';
import { composeInputTransactionsFromJournal } from '../interactions/inputTransactions';
import { composeSelectTransactionsFromJournal } from '../interactions/selectTransactions';
import type { UiActionRecipe, UiComponentKind } from '../uiSemantics/types';
import { countBusinessFlowPlaybackActions, generateAssertionCodePreview, generateBusinessFlowPlaybackCode, generateBusinessFlowPlaywrightCode } from './codePreview';
import { projectBusinessFlow } from './businessFlowProjection';
import { toCompactFlow } from './compactExporter';
import { prepareBusinessFlowForExport } from './exportSanitizer';
import { appendSyntheticPageContextSteps, appendSyntheticPageContextStepsWithResult, clearFlowRecordingHistory, deleteStepFromFlow, insertEmptyStepAfter, insertWaitStepAfter, mergeActionsIntoFlow } from './flowBuilder';
import { migrateFlowToStableStepModel } from './flowMigration';
import { appendSyntheticPageContextStepsWithResult as reconcileSyntheticPageContextStepsWithResult, upgradeSyntheticStepsCoveredByRecordedDrafts } from './syntheticReconciler';
import { buildRecipeForStep } from '../replay/recipeBuilder';
import { createAdaptiveTargetSnapshot, withAdaptiveTargetSnapshot } from './adaptiveTargetSnapshot';
import { redactAdaptiveTargetSnapshot } from './adaptiveTargetRedactor';
import { createReplayFailureDiagnostic } from './adaptiveFailureReport';
import { rankAdaptiveLocatorCandidates } from './locatorCandidates';
import { createReplayFailureDiagnosticsArtifact } from './replayDiagnostics';
import { mergeRecorderActionsIntoFlow } from './recorderActionMerge';
import {
  countBusinessFlowPlaybackActions as countBusinessFlowPlaybackActionsFromReplay,
  generateAssertionCodePreview as generateAssertionCodePreviewFromReplay,
  generateBusinessFlowPlaybackCode as generateBusinessFlowPlaybackCodeFromReplay,
  generateBusinessFlowPlaywrightCode as generateBusinessFlowPlaywrightCodeFromReplay,
} from '../replay';
import { generateBusinessFlowPlaybackCode as generateParserSafeBusinessFlowCode } from '../replay/parserSafeRenderer';
import { generateBusinessFlowPlaywrightCode as generateExportedBusinessFlowCode } from '../replay/exportedRenderer';
import { countBusinessFlowPlaybackActions as countParserSafeBusinessFlowActions } from '../replay/actionCounter';
import type { UiActionRecipe as ReplayUiActionRecipe } from '../replay/types';
import { filterPageContextEventsForCapture } from './pageContextCapture';
import { finalizeRecordingSession } from './sessionFinalizer';
import { appendTerminalStateAssertions, createTerminalStateAssertion, replayDiagnosticSummary } from './terminalAssertions';
import { eventJournalStats } from './eventJournal';
import { mergePageContextIntoFlow } from './flowContextMerger';
import { hasPendingOverlayPrediction, pageContextEventsForIngestion, shouldQueueSyntheticPageContextEvent, updatePageContextEventSignatures } from './pageContextIngestion';
import { suggestIntent } from './intentRules';
import { createRepeatSegment } from './repeatSegments';
import { redactBusinessFlow } from './redactor';
import type { PageContextEvent, ElementContext, StepContextSnapshot } from './pageContextTypes';
import type { BusinessFlow, FlowStep } from './types';
import { createEmptyBusinessFlow } from './types';

type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

const tests: TestCase[] = [
  {
    name: 'finalizeRecordingSession waits for journal counts to stay stable and emits diagnostics',
    run: async () => {
      let now = 0;
      let flow = mergeActionsIntoFlow(createNamedFlow(), [clickActionWithWallTime('保存', 1000)], [], {});
      const diagnostics: Array<{ type: string; data?: any }> = [];
      let drainCount = 0;

      const finalized = await finalizeRecordingSession(flow, {
        reason: 'export',
        stableForMs: 100,
        maxWaitMs: 500,
        pollIntervalMs: 50,
        now: () => now,
        wait: async ms => { now += ms; },
        getCurrentFlow: () => flow,
        drainPageContextEvents: async () => {
          drainCount += 1;
          if (drainCount === 2)
            flow = mergePageContextIntoFlow(flow, [pageClickEvent('ctx-finalize-save', 1100, '保存')]);
        },
        diagnostics: event => diagnostics.push(event),
      });

      const recorder = finalized.artifacts?.recorder;
      assert(recorder?.eventJournal, 'finalized flow should keep event journal');
      assertEqual(eventJournalStats(recorder).pageContextEventCount, 1);
      assert(now >= 100, 'finalizer should wait until counts are stable for stableForMs');
      assert(diagnostics.some(event => event.type === 'finalize.stable'), 'finalizer should emit stable diagnostics');
      assert(diagnostics.some(event => event.data?.reason === 'export'), 'diagnostics should include finalization reason');
      assert(diagnostics.some(event => event.data?.counts?.pageContextEventCount === 1), 'diagnostics should include page context counts');
    },
  },
  {
    name: 'finalizeRecordingSession times out with bounded diagnostics when counts keep changing',
    run: async () => {
      let now = 0;
      let flow = mergeActionsIntoFlow(createNamedFlow(), [clickActionWithWallTime('打开', 1000)], [], {});
      let seq = 0;
      const diagnostics: Array<{ type: string; data?: any }> = [];

      const finalized = await finalizeRecordingSession(flow, {
        reason: 'enter-review',
        stableForMs: 100,
        maxWaitMs: 160,
        pollIntervalMs: 50,
        now: () => now,
        wait: async ms => { now += ms; },
        getCurrentFlow: () => flow,
        drainPageContextEvents: async () => {
          seq += 1;
          flow = mergePageContextIntoFlow(flow, [pageClickEvent(`ctx-changing-${seq}`, 1000 + seq, `事件 ${seq}`)]);
        },
        diagnostics: event => diagnostics.push(event),
      });

      assertEqual(finalized.artifacts?.recorder?.eventJournal?.highWaterMarks.pageContextEventCount, seq);
      assert(now >= 160, 'finalizer should respect maxWaitMs when facts keep changing');
      assert(diagnostics.some(event => event.type === 'finalize.timeout'), 'finalizer should emit timeout diagnostics');
      assert(diagnostics.some(event => event.data?.reason === 'enter-review'), 'timeout diagnostics should include reason');
    },
  },
  {
    name: 'overlay prediction shadow mode resolves expected overlay outcomes without changing steps',
    run: () => {
      assertEqual(expectedOverlayKindForTrigger({ controlType: 'select', text: 'IP地址池' }), 'select-dropdown');
      assertEqual(expectedOverlayKindForTrigger({ testId: 'network-resource-create-button', text: '新增' }), 'modal');
      assertEqual(expectedOverlayKindForTrigger({ testId: 'wan-row-delete-button', text: '删除' }), 'popconfirm');
      assertEqual(expectedOverlayKindForTrigger({ text: '打开详情' }), undefined);
      assertEqual(expectedOverlayKindForTrigger({ role: 'link', text: '打开详情' }), undefined);
      assertEqual(expectedOverlayKindForTrigger({ role: 'button', text: '新增' }), 'modal');
      assertEqual(expectedOverlayKindForTrigger({ testId: 'open-user-modal-button', text: '打开' }), 'modal');

      const selectPrediction = createOverlayPrediction({
        expectedKind: 'select-dropdown',
        candidates: [overlayPredictionCandidate('select-dropdown', 'IP地址池')],
        elapsedMs: 120,
      });
      assertEqual(selectPrediction.status, 'resolved');
      assertEqual(selectPrediction.resolved?.overlayKind, 'select-dropdown');

      const expiredPrediction = createOverlayPrediction({
        expectedKind: 'modal',
        candidates: [],
        elapsedMs: 420,
      });
      assertEqual(expiredPrediction.status, 'expired');

      const ambiguousPrediction = createOverlayPrediction({
        expectedKind: 'popconfirm',
        candidates: [
          overlayPredictionCandidate('popconfirm', '删除此行？', 'delete-confirm-1'),
          overlayPredictionCandidate('popconfirm', '删除此行？', 'delete-confirm-2'),
        ],
      });
      assertEqual(ambiguousPrediction.status, 'ambiguous');
      assertEqual(ambiguousPrediction.candidates?.length, 2);
    },
  },
  {
    name: 'overlay prediction resolves nested AntD select dropdown DOM as one visual overlay',
    run: () => {
      const listbox = testOverlayElement({ role: 'listbox' });
      const dropdown = testOverlayElement({ class: 'ant-select-dropdown' }, [listbox]);
      const candidates = collectOverlayPredictionCandidates({
        root: testOverlayRoot([dropdown]),
        isVisible: () => true,
        now: () => 42,
      });

      assertEqual(candidates.length, 1);
      assertEqual(candidates[0].overlayKind, 'select-dropdown');
      assertEqual(candidates[0].signature, 'select-dropdown');
      assertEqual(createOverlayPrediction({
        expectedKind: 'select-dropdown',
        candidates,
      }).status, 'resolved');
    },
  },
  {
    name: 'overlay prediction duplicate filtering preserves stable signatures across transitions',
    run: () => {
      const existing = overlayPredictionCandidate('popconfirm', '删除此行？');
      const newDuplicate = overlayPredictionCandidate('popconfirm', '删除此行？');
      const observedAfter = [existing, newDuplicate];
      const newCandidates = newOverlayPredictionCandidates(
          observedAfter,
          overlayPredictionSignatureCounts([existing]),
      );

      assertEqual(newCandidates.length, 1);
      assertEqual(newCandidates[0].signature, existing.signature);
      assert(!newCandidates[0].signature.includes(':#'), 'duplicate overlay signature should remain stable');
      assertEqual(createOverlayPrediction({
        expectedKind: 'popconfirm',
        candidates: newCandidates,
      }).status, 'resolved');

      assertEqual(createOverlayPrediction({
        expectedKind: 'popconfirm',
        candidates: newOverlayPredictionCandidates(observedAfter, overlayPredictionSignatureCounts([])),
      }).status, 'ambiguous');
    },
  },
  {
    name: 'event journal preserves overlay prediction diagnostics without changing exported flow context',
    run: async () => {
      const prediction = createOverlayPrediction({
        expectedKind: 'modal',
        candidates: [overlayPredictionCandidate('modal', '新建网络资源')],
        elapsedMs: 96,
      });
      const event = pageClickEvent('ctx-overlay-prediction', 1100, '新增');
      event.after = {
        dialog: { type: 'modal', title: '新建网络资源', visible: true },
        overlayPrediction: prediction,
      };
      const flow = mergePageContextIntoFlow(createNamedFlow(), [event]);
      const recorder = flow.artifacts?.recorder;
      assert(recorder?.eventJournal, 'event journal should exist');
      const stats = eventJournalStats(recorder);
      assertEqual(stats.pageContextEventCount, 1);
      assertEqual(stats.overlayPredictionCount, 1);
      assertEqual(stats.overlayPredictionResolvedCount, 1);
      const envelope = recorder.eventJournal.eventsById['page-context:ctx-overlay-prediction'];
      assertEqual((envelope.payload as PageContextEvent).after?.overlayPrediction?.status, 'resolved');

      const diagnostics: Array<{ type: string; data?: any }> = [];
      await finalizeRecordingSession(flow, {
        reason: 'export',
        stableForMs: 0,
        maxWaitMs: 0,
        now: () => 0,
        wait: async () => {},
        diagnostics: event => diagnostics.push(event),
      });
      assert(diagnostics.some(event => event.data?.counts?.overlayPredictionResolvedCount === 1), 'finalizer diagnostics should include overlay prediction counts');

      const exported = JSON.stringify(prepareBusinessFlowForExport(flow));
      assert(!exported.includes('overlayPrediction'), 'exported flow should omit internal overlay prediction diagnostics');
      assert(!toCompactFlow(flow).includes('overlayPrediction'), 'compact flow should omit internal overlay prediction diagnostics');
    },
  },
  {
    name: 'event journal upgrades same-id page context overlay prediction updates',
    run: () => {
      const baseEvent = pageClickEvent('ctx-overlay-update', 1100, '新增');
      const baseFlow = mergePageContextIntoFlow(createNamedFlow(), [baseEvent]);
      const baseRecorder = baseFlow.artifacts?.recorder;
      assert(baseRecorder?.eventJournal, 'base page context event should be journaled');
      assertEqual(eventJournalStats(baseRecorder).pageContextEventCount, 1);
      assertEqual(eventJournalStats(baseRecorder).overlayPredictionCount, 0);

      const prediction = createOverlayPrediction({
        expectedKind: 'modal',
        candidates: [overlayPredictionCandidate('modal', '新建网络资源')],
        elapsedMs: 96,
      });
      const updatedEvent = pageClickEvent('ctx-overlay-update', 1100, '新增');
      updatedEvent.after = {
        dialog: { type: 'modal', title: '新建网络资源', visible: true },
        overlayPrediction: prediction,
      };
      const updatedFlow = mergePageContextIntoFlow(baseFlow, [updatedEvent]);
      const updatedRecorder = updatedFlow.artifacts?.recorder;
      assert(updatedRecorder?.eventJournal, 'same-id overlay prediction update should be stored');
      const stats = eventJournalStats(updatedRecorder);
      assertEqual(stats.pageContextEventCount, 1);
      assertEqual(stats.overlayPredictionCount, 1);
      assertEqual(stats.overlayPredictionResolvedCount, 1);
      assertEqual(updatedRecorder.eventJournal.eventOrder, ['page-context:ctx-overlay-update']);
      const envelope = updatedRecorder.eventJournal.eventsById['page-context:ctx-overlay-update'];
      assertEqual((envelope.payload as PageContextEvent).after?.overlayPrediction?.status, 'resolved');
    },
  },
  {
    name: 'page context ingestion queues same-id richer overlay prediction updates',
    run: () => {
      const baseEvent = pageClickEventWithTarget('ctx-richer-update', 1100, {
        tag: 'div',
        role: 'combobox',
        controlType: 'select',
        text: 'IP地址池',
      });
      const signaturesById = new Map<string, string>();
      updatePageContextEventSignatures([baseEvent], signaturesById);

      const afterEvent: PageContextEvent = {
        ...baseEvent,
        after: {
          dialog: { type: 'dropdown', visible: true },
        },
      };
      const afterIngestion = pageContextEventsForIngestion({
        events: [afterEvent],
        lastEventId: baseEvent.id,
        signaturesById,
      });
      assertEqual(afterIngestion.eventsToProcess.map(event => event.id), ['ctx-richer-update']);
      assert(afterIngestion.changedEventIds.has('ctx-richer-update'), 'same-id after snapshot should be detected as a changed payload');
      assert(shouldQueueSyntheticPageContextEvent({
        event: afterEvent,
        changedEventIds: afterIngestion.changedEventIds,
        pendingEventIds: new Set(['ctx-richer-update']),
        scheduledEventIds: new Set(['ctx-richer-update']),
      }), 'changed same-id click should still replace the pending queued event after scheduling');

      const prediction = createOverlayPrediction({
        expectedKind: 'select-dropdown',
        candidates: [overlayPredictionCandidate('select-dropdown', 'IP地址池')],
      });
      const predictionEvent: PageContextEvent = {
        ...afterEvent,
        after: {
          ...afterEvent.after,
          overlayPrediction: prediction,
        },
      };
      const predictionIngestion = pageContextEventsForIngestion({
        events: [predictionEvent],
        lastEventId: afterEvent.id,
        signaturesById,
      });
      assertEqual(predictionIngestion.eventsToProcess.map(event => event.after?.overlayPrediction?.status), ['resolved']);
      assert(shouldQueueSyntheticPageContextEvent({
        event: predictionEvent,
        changedEventIds: predictionIngestion.changedEventIds,
        pendingEventIds: new Set(['ctx-richer-update']),
        scheduledEventIds: new Set(['ctx-richer-update']),
      }), 'late overlayPrediction update should replace a still-pending queued event');
      assert(!shouldQueueSyntheticPageContextEvent({
        event: predictionEvent,
        changedEventIds: predictionIngestion.changedEventIds,
        pendingEventIds: new Set(),
        scheduledEventIds: new Set(['ctx-richer-update']),
      }), 'late same-id update after the synthetic queue has flushed should not create another click step');
      assert(!shouldQueueSyntheticPageContextEvent({
        event: predictionEvent,
        changedEventIds: new Set(),
        scheduledEventIds: new Set(['ctx-richer-update']),
      }), 'unchanged already scheduled click should still be suppressed');
    },
  },
  {
    name: 'page context ingestion keeps post-action merged clicks available for live synthetic queue',
    run: () => {
      const previousEvent = pageClickEvent('ctx-previous', 900, '保存');
      const pageOnlyEvent = pageClickEventWithTarget('ctx-page-only-radio', 1200, {
        tag: 'label',
        role: 'radio',
        controlType: 'radio',
        text: '独享地址池',
        normalizedText: '独享地址池',
      });
      const signaturesById = new Map<string, string>();
      updatePageContextEventSignatures([previousEvent], signaturesById);

      const ingestion = pageContextEventsForIngestion({
        events: [previousEvent, pageOnlyEvent],
        lastEventId: previousEvent.id,
        signaturesById,
      });

      assertEqual(ingestion.eventsToProcess.map(event => event.id), ['ctx-page-only-radio']);
      assert(shouldQueueSyntheticPageContextEvent({
        event: pageOnlyEvent,
        changedEventIds: ingestion.changedEventIds,
        scheduledEventIds: new Set(),
      }), 'post-action page-context-only click should still enter the live synthetic queue on the interval pass');
    },
  },
  {
    name: 'page context settle waits while expected overlay prediction is pending',
    run: () => {
      const pendingSelect = pageClickEventWithTarget('ctx-pending-select', 1100, {
        tag: 'div',
        role: 'combobox',
        controlType: 'select',
        text: 'IP地址池',
      });
      pendingSelect.after = {
        dialog: { type: 'dropdown', visible: true },
      };
      assert(hasPendingOverlayPrediction([pendingSelect], { now: () => 1500 }), 'expected select overlay without overlayPrediction should keep settle pending while it is still fresh');
      assert(hasPendingOverlayPrediction([pendingSelect], { now: () => 2480 }), 'pending overlay prediction should cover after delay observer timeout and a settle tick');
      assert(!hasPendingOverlayPrediction([pendingSelect], { now: () => 2800 }), 'stale unresolved overlay prediction should not hold every later stop/export flush');

      const resolvedSelect: PageContextEvent = {
        ...pendingSelect,
        after: {
          ...pendingSelect.after,
          overlayPrediction: createOverlayPrediction({
            expectedKind: 'select-dropdown',
            candidates: [overlayPredictionCandidate('select-dropdown', 'IP地址池')],
          }),
        },
      };
      assert(!hasPendingOverlayPrediction([resolvedSelect], { now: () => 1500 }), 'resolved overlayPrediction should release settle');

      const ordinaryOpenLink = pageClickEventWithTarget('ctx-open-link', 1200, {
        tag: 'a',
        role: 'link',
        text: '打开详情',
      });
      assert(!hasPendingOverlayPrediction([ordinaryOpenLink], { now: () => 1500 }), 'ordinary open link should not hold stop/export settle');
    },
  },
  {
    name: 'event journal initializes for legacy recorder state without changing steps',
    run: () => {
      const legacyFlow = mergeActionsIntoFlow(createNamedFlow(), [clickAction('保存')], [], {});
      const legacyRecorder = legacyFlow.artifacts?.recorder;
      assert(legacyRecorder, 'legacy recorder should exist');
      const legacyV2Flow: BusinessFlow = {
        ...legacyFlow,
        artifacts: {
          ...legacyFlow.artifacts,
          recorder: {
            version: 2,
            actionLog: legacyRecorder.actionLog,
            nextActionSeq: legacyRecorder.nextActionSeq,
            nextStepSeq: legacyRecorder.nextStepSeq,
            sessions: legacyRecorder.sessions,
          } as any,
        },
      };

      const migrated = mergeActionsIntoFlow(legacyV2Flow, [clickAction('保存')], [], {});
      const recorder = migrated.artifacts?.recorder;

      assertEqual(migrated.steps.map(step => step.id), legacyFlow.steps.map(step => step.id));
      assertEqual(recorder?.version, 3 as any);
      assert(recorder?.eventJournal, 'v2 recorder state should be upgraded with an event journal');
      assertEqual(eventJournalStats(recorder as any).recorderActionCount, 1);
    },
  },
  {
    name: 'mergeActionsIntoFlow appends recorder action facts to event journal without changing projected steps',
    run: () => {
      const flow = mergeActionsIntoFlow(createNamedFlow(), [clickAction('新建'), fillAction('地址池名称', 'pool-a')], [], {});
      const recorder = flow.artifacts?.recorder;
      assert(recorder?.eventJournal, 'recorder action journal should exist');

      const stats = eventJournalStats(recorder);
      assertEqual(flow.steps.map(step => step.action), ['click', 'fill']);
      assertEqual(recorder.actionLog.length, 2);
      assertEqual(stats.recorderActionCount, 2);
      assertEqual(stats.pageContextEventCount, 0);
      assertEqual(recorder.eventJournal.eventOrder.length, 2);
      assertEqual(recorder.eventJournal.eventOrder.map(id => recorder.eventJournal?.eventsById[id]?.source), ['playwright-recorder', 'playwright-recorder']);
    },
  },
  {
    name: 'flowBuilder facade delegates recorder action merge without changing stable projection',
    run: () => {
      const actions = [clickAction('新建'), fillAction('地址池名称', 'pool-a'), clickAction('保存')];
      const sources = recordedSource([
        'await page.getByRole("button", { name: "新建" }).click();',
        'await page.getByLabel("地址池名称").fill("pool-a");',
        'await page.getByRole("button", { name: "保存" }).click();',
      ]);
      const options = { recordingSessionId: 'session-pr13-facade' };

      const viaFacade = mergeActionsIntoFlow(createNamedFlow(), actions, sources, options);
      const viaInternal = mergeRecorderActionsIntoFlow(createNamedFlow(), actions, sources, options);

      assertEqual(flowMergeSummary(viaFacade), flowMergeSummary(viaInternal));
    },
  },
  {
    name: 'raw selector target extraction preserves test id ordinal hints after module split',
    run: () => {
      const target = extractTargetFromRecorderAction({
        name: 'click',
        selector: 'internal:testid=[data-testid="wan-edit-action"i] >> nth=2',
      });

      assertEqual(target?.testId, 'wan-edit-action');
      assertEqual(target?.locatorHint?.strategy, 'global-testid');
      assertEqual(target?.locatorHint?.pageIndex, 2);
      assertEqual(target?.locatorHint?.pageCount, 3);
    },
  },
  {
    name: 'page context synthetic append records page context facts in event journal',
    run: () => {
      const flow = mergeActionsIntoFlow(createNamedFlow(), [clickActionWithWallTime('打开', 1000)], [], {});
      const event = pageClickEvent('ctx-save', 2000, '保存');
      const result = reconcileSyntheticPageContextStepsWithResult(flow, [event]);
      const recorder = result.flow.artifacts?.recorder;

      assert(recorder?.eventJournal, 'page context journal should exist');
      assertEqual(eventJournalStats(recorder).pageContextEventCount, 1);
      assertEqual(recorder.eventJournal.eventOrder.map(id => recorder.eventJournal?.eventsById[id]?.source).includes('page-context'), true);
      assertEqual(result.insertedStepIds.length, 1);
    },
  },
  {
    name: 'mergePageContextIntoFlow records matched page context facts in event journal',
    run: () => {
      const flow = mergeActionsIntoFlow(createNamedFlow(), [clickActionWithWallTime('保存', 1000)], [], {});
      const event = pageClickEvent('ctx-merge-save', 1100, '保存');

      const merged = mergePageContextIntoFlow(flow, [event]);
      const recorder = merged.artifacts?.recorder;

      assert(recorder?.eventJournal, 'merged flow should keep event journal');
      assertEqual(eventJournalStats(recorder).recorderActionCount, 1);
      assertEqual(eventJournalStats(recorder).pageContextEventCount, 1);
      assert(recorder.eventJournal.eventsById[`page-context:${event.id}`], 'matched page context event should be recorded as a fact');
      assertEqual(merged.steps.map(step => step.id), flow.steps.map(step => step.id));
    },
  },
  {
    name: 'mergePageContextIntoFlow records ignored page context facts without changing steps',
    run: () => {
      const flow = mergeActionsIntoFlow(createNamedFlow(), [clickActionWithWallTime('保存', 1000)], [], {});
      const event = pageClickEventWithTarget('ctx-ignored-option', 1100, {
        role: 'option',
        controlType: 'select-option',
        text: '不匹配的选项',
        normalizedText: '不匹配的选项',
      });

      const merged = mergePageContextIntoFlow(flow, [event]);
      const recorder = merged.artifacts?.recorder;

      assert(recorder?.eventJournal, 'ignored context should still be captured as a fact');
      assertEqual(eventJournalStats(recorder).pageContextEventCount, 1);
      assert(recorder.eventJournal.eventsById[`page-context:${event.id}`], 'ignored page context event should be recorded as a fact');
      assertEqual(merged.steps, flow.steps);
    },
  },
  {
    name: 'page context event journal preserves anchor grounding diagnostics without changing steps',
    run: () => {
      const flow = mergeActionsIntoFlow(createNamedFlow(), [clickActionWithWallTime('保存', 1000)], [], {});
      const event = pageClickEvent('ctx-grounded-save', 1100, '保存');
      event.before.grounding = anchorGroundingFixture();

      const merged = mergePageContextIntoFlow(flow, [event]);
      const envelope = merged.artifacts?.recorder?.eventJournal?.eventsById[`page-context:${event.id}`];

      assert(envelope, 'grounded page context should be recorded');
      assertEqual((envelope.payload as PageContextEvent).before.grounding?.chosenAnchor.testId, 'save-button');
      assertEqual((envelope.payload as PageContextEvent).before.grounding?.equivalentAnchors.length, 2);
      assertEqual(merged.steps.map(step => step.id), flow.steps.map(step => step.id));
    },
  },
  {
    name: 'anchor diagnostics rank checkbox wrapper above inner input',
    run: () => {
      const [wrapper, input] = rankAnchorCandidates([
        {
          id: 'target:0:input:checkbox',
          tag: 'input',
          role: 'checkbox',
          classTokens: ['ant-checkbox-input'],
          depthFromTarget: 0,
          source: 'target',
          ruleScore: 0,
          reasons: [],
          risks: [],
        },
        {
          id: 'ancestor:1:label:checkbox-wrapper',
          tag: 'label',
          role: 'checkbox',
          text: '启用',
          classTokens: ['ant-checkbox-wrapper'],
          depthFromTarget: 1,
          source: 'ancestor',
          ruleScore: 0,
          reasons: [],
          risks: [],
        },
      ]);

      assertEqual(wrapper.id, 'ancestor:1:label:checkbox-wrapper');
      assert(input.risks.includes('inner native input'), 'inner checkbox input should be marked as a weaker anchor');
      assert(wrapper.ruleScore > input.ruleScore, 'wrapper should outrank inner input');
    },
  },
  {
    name: 'anchor diagnostics keep visually equivalent icon and button anchors together',
    run: () => {
      const candidates = rankAnchorCandidates([
        {
          id: 'target:0:svg:icon',
          tag: 'svg',
          classTokens: ['anticon'],
          depthFromTarget: 0,
          source: 'target',
          ruleScore: 0,
          reasons: [],
          risks: [],
          bbox: { left: 104, top: 104, right: 116, bottom: 116, width: 12, height: 12 },
        },
        {
          id: 'ancestor:2:button:save',
          tag: 'button',
          role: 'button',
          text: '保存',
          testId: 'save-button',
          classTokens: ['ant-btn'],
          depthFromTarget: 2,
          source: 'ancestor',
          ruleScore: 0,
          reasons: [],
          risks: [],
          bbox: { left: 100, top: 100, right: 140, bottom: 124, width: 40, height: 24 },
        },
      ]);
      const chosen = candidates[0];
      const equivalents = equivalentAnchorCandidates(chosen, candidates);

      assertEqual(chosen.id, 'ancestor:2:button:save');
      assert(equivalents.some(candidate => candidate.id === 'target:0:svg:icon'), 'icon inside button should remain in the visual equivalent anchor group');
    },
  },
  {
    name: 'anchor diagnostics do not mark a table row as equivalent to its action button',
    run: () => {
      const candidates = rankAnchorCandidates([
        {
          id: 'target:0:button:edit-action',
          tag: 'button',
          role: 'button',
          text: '编辑',
          classTokens: ['ant-btn'],
          depthFromTarget: 0,
          source: 'target',
          ruleScore: 0,
          reasons: [],
          risks: [],
          bbox: { left: 220, top: 108, right: 252, bottom: 132, width: 32, height: 24 },
        },
        {
          id: 'tableScope:1:tr:user-42',
          tag: 'tr',
          text: 'user-42 编辑 删除',
          depthFromTarget: 1,
          source: 'tableScope',
          ruleScore: 0,
          reasons: [],
          risks: [],
          bbox: { left: 40, top: 96, right: 560, bottom: 144, width: 520, height: 48 },
          context: { tableTestId: 'users-table', rowKey: 'user-42' },
        },
      ]);
      const button = candidates.find(candidate => candidate.id === 'target:0:button:edit-action');
      const row = candidates.find(candidate => candidate.id === 'tableScope:1:tr:user-42');

      assert(button && row, 'button and row candidates should exist');
      assert(!equivalentAnchorCandidates(button, candidates).some(candidate => candidate.id === row.id), 'table row containers must not be equivalent to row action buttons');
    },
  },
  {
    name: 'anchor diagnostics do not mark a form item as equivalent to its inner input',
    run: () => {
      const candidates = rankAnchorCandidates([
        {
          id: 'target:0:input:name',
          tag: 'input',
          role: 'textbox',
          depthFromTarget: 0,
          source: 'target',
          ruleScore: 0,
          reasons: [],
          risks: [],
          bbox: { left: 180, top: 120, right: 360, bottom: 152, width: 180, height: 32 },
        },
        {
          id: 'ancestor:1:div:form-item',
          tag: 'div',
          text: '资源名称',
          classTokens: ['ant-form-item'],
          depthFromTarget: 1,
          source: 'ancestor',
          ruleScore: 0,
          reasons: [],
          risks: [],
          bbox: { left: 80, top: 96, right: 420, bottom: 176, width: 340, height: 80 },
          context: { formLabel: '资源名称', fieldName: 'name' },
        },
      ]);
      const input = candidates.find(candidate => candidate.id === 'target:0:input:name');
      const formItem = candidates.find(candidate => candidate.id === 'ancestor:1:div:form-item');

      assert(input && formItem, 'input and form item candidates should exist');
      assert(!equivalentAnchorCandidates(input, candidates).some(candidate => candidate.id === formItem.id), 'form item containers must not be equivalent to inner inputs');
    },
  },
  {
    name: 'anchor diagnostics score ProTable row actions with table and row key evidence',
    run: () => {
      const [rowAction, globalText] = rankAnchorCandidates([
        {
          id: 'ancestor:1:button:edit-action',
          tag: 'button',
          role: 'button',
          text: '编辑',
          dataE2eAction: 'edit',
          depthFromTarget: 1,
          source: 'ancestor',
          ruleScore: 0,
          reasons: [],
          risks: [],
          context: { tableTestId: 'user-table', rowKey: 'user-42', columnKey: '操作', proComponent: 'pro-table' },
        },
        {
          id: 'target:0:span:edit-text',
          tag: 'span',
          text: '编辑',
          depthFromTarget: 0,
          source: 'target',
          ruleScore: 0,
          reasons: [],
          risks: [],
        },
      ]);

      assertEqual(rowAction.id, 'ancestor:1:button:edit-action');
      assert(rowAction.reasons.includes('row key context'), 'row action should explain row key evidence');
      assert(rowAction.reasons.includes('table scope context'), 'row action should explain table scope evidence');
      assert(rowAction.ruleScore > globalText.ruleScore, 'row-scoped action should outrank unscoped text');
    },
  },
  {
    name: 'anchor diagnostics identify select triggers and portal options',
    run: () => {
      const [trigger] = rankAnchorCandidates([
        {
          id: 'ancestor:1:div:wan-select',
          tag: 'div',
          role: 'combobox',
          text: 'WAN口',
          classTokens: ['ant-select-selector'],
          depthFromTarget: 1,
          source: 'ancestor',
          ruleScore: 0,
          reasons: [],
          risks: [],
          context: { formLabel: 'WAN口', fieldName: 'wan' },
        },
        {
          id: 'target:0:span:wan-text',
          tag: 'span',
          text: 'WAN口',
          depthFromTarget: 0,
          source: 'target',
          ruleScore: 0,
          reasons: [],
          risks: [],
        },
      ]);
      const [portalOption] = rankAnchorCandidates([
        {
          id: 'portal:1:div:wan-option',
          tag: 'div',
          role: 'option',
          text: 'xtest16:WAN1',
          classTokens: ['ant-select-item-option'],
          depthFromTarget: 1,
          source: 'portal',
          ruleScore: 0,
          reasons: [],
          risks: [],
          context: { formLabel: 'WAN口', fieldName: 'wan' },
        },
      ]);

      assertEqual(trigger.id, 'ancestor:1:div:wan-select');
      assert(trigger.reasons.includes('select trigger semantic'), 'select trigger should explain combobox/select-selector evidence');
      assert(trigger.reasons.includes('form field context'), 'select trigger should keep field context');
      assertEqual(portalOption.id, 'portal:1:div:wan-option');
      assert(portalOption.reasons.includes('option semantic'), 'portal option should explain option evidence');
    },
  },
  {
    name: 'anchor diagnostics do not mark dropdown roots as equivalent to selected options',
    run: () => {
      const candidates = rankAnchorCandidates([
        {
          id: 'target:0:div:wan-option',
          tag: 'div',
          role: 'option',
          text: 'edge-lab:WAN-extra-18',
          classTokens: ['ant-select-item-option'],
          depthFromTarget: 0,
          source: 'target',
          ruleScore: 0,
          reasons: [],
          risks: [],
          bbox: { left: 120, top: 220, right: 420, bottom: 252, width: 300, height: 32 },
        },
        {
          id: 'portal:1:div:dropdown-root',
          tag: 'div',
          classTokens: ['ant-select-dropdown'],
          depthFromTarget: 1,
          source: 'portal',
          ruleScore: 0,
          reasons: [],
          risks: [],
          bbox: { left: 100, top: 200, right: 460, bottom: 420, width: 360, height: 220 },
        },
      ]);
      const option = candidates.find(candidate => candidate.id === 'target:0:div:wan-option');
      const dropdown = candidates.find(candidate => candidate.id === 'portal:1:div:dropdown-root');

      assert(option && dropdown, 'option and dropdown candidates should exist');
      assert(!equivalentAnchorCandidates(option, candidates).some(candidate => candidate.id === dropdown.id), 'dropdown roots must not be equivalent to selected option rows');
    },
  },
  {
    name: 'anchor diagnostics ranking is idempotent',
    run: () => {
      const once = rankAnchorCandidates([
        {
          id: 'target:0:span:save-text',
          tag: 'span',
          text: '保存',
          depthFromTarget: 0,
          source: 'target',
          ruleScore: 0,
          reasons: [],
          risks: [],
        },
        {
          id: 'ancestor:1:button:save',
          tag: 'button',
          role: 'button',
          text: '保存',
          testId: 'save-button',
          depthFromTarget: 1,
          source: 'ancestor',
          ruleScore: 0,
          reasons: [],
          risks: [],
        },
      ]);
      const twice = rankAnchorCandidates(once);

      assertEqual(twice.map(candidate => [candidate.id, candidate.ruleScore]), once.map(candidate => [candidate.id, candidate.ruleScore]));
    },
  },
  {
    name: 'anchor grounding scores raw target consistently with candidates',
    run: () => {
      const target = fakeAnchorElement('button', { 'data-testid': 'save-button' }, '保存', { left: 100, top: 100, right: 148, bottom: 124, width: 48, height: 24 });
      const grounding = collectAnchorGroundingEvidence(target as unknown as Element, {
        maxDepth: 0,
        textForElement: element => (element as unknown as FakeAnchorElement).mockText,
        testIdForElement: element => element.getAttribute('data-testid') || undefined,
      });
      const rawFromCandidates = grounding.candidates.find(candidate => candidate.id === grounding.rawTarget.id);

      assert(grounding.rawTarget.ruleScore > 0, 'raw target should be scored');
      assert(rawFromCandidates, 'raw target should appear in scored candidates');
      assertEqual(grounding.rawTarget.ruleScore, rawFromCandidates.ruleScore);
      assert(grounding.rawTarget.reasons.includes('business action test id'), 'raw target should keep scored reasons');
    },
  },
  {
    name: 'anchor grounding diagnostics gate is independent from semantic adapter diagnostics',
    run: () => {
      assertEqual(shouldCollectAnchorGroundingDiagnostics({ semanticAdapterDiagnosticsEnabled: true }), false);
      assertEqual(shouldCollectAnchorGroundingDiagnostics({ anchorGroundingDiagnosticsEnabled: true }), true);
    },
  },
  {
    name: 'page context event without wallTime uses Date.now wall time and preserves performanceTime',
    run: () => {
      const nowBefore = Date.now();
      const event = pageClickEvent('ctx-no-wall', 1234, '保存');
      delete (event as Partial<PageContextEvent>).wallTime;
      event.time = 1234;

      const flow = appendSyntheticPageContextStepsWithResult(createNamedFlow(), [event]).flow;
      const envelope = flow.artifacts?.recorder?.eventJournal?.eventsById[`page-context:${event.id}`];

      assert(envelope, 'page context envelope should exist');
      assert(envelope.timestamp.wallTime >= nowBefore, 'missing wallTime should fall back to current wall time');
      assertEqual(envelope.timestamp.performanceTime, 1234);
      assert(!envelope.createdAt.startsWith('1970-'), 'createdAt should not be derived from performance.now');
    },
  },
  {
    name: 'export sanitization strips event journal recorder internals',
    run: () => {
      const flow = mergeActionsIntoFlow(createNamedFlow(), [clickAction('保存')], [], {});
      const exported = prepareBusinessFlowForExport(flow);
      const exportedJson = JSON.stringify(exported);
      const yaml = toCompactFlow(exported);

      assert(!exported.artifacts?.recorder, 'export should remove recorder internals');
      assert(!exportedJson.includes('eventJournal'), 'export json should not contain event journal');
      assert(!exportedJson.includes('playwright-recorder'), 'export json should not contain recorder event facts');
      assert(!yaml.includes('eventJournal'), 'compact yaml should not contain event journal');
    },
  },
  {
    name: 'page context capture ignores events older than the current recording session',
    run: () => {
      const events = [
        pageClickEventWithTarget('old-click', 1000, { role: 'button', text: '上一轮' }),
        pageClickEventWithTarget('current-click', 2000, { role: 'button', text: '本轮' }),
      ];

      assertEqual(filterPageContextEventsForCapture(events, 1500).map(event => event.id), ['current-click']);
    },
  },
  {
    name: 'continue recording appends only new actions and keeps user edits',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [clickAction('新建'), fillAction('地址池名称', 'pool-a')], [], {});
      const edited: BusinessFlow = {
        ...initial,
        steps: initial.steps.map(step => step.id === 's002' ? { ...step, intent: '用户编辑过的意图' } : step),
      };

      const continued = mergeActionsIntoFlow(edited, [
        clickAction('新建'),
        fillAction('地址池名称', 'pool-a'),
        clickAction('确定'),
      ], [], {
        appendNewActions: true,
        insertBaseActionCount: 2,
      });

      assertEqual(continued.steps.map(step => step.id), ['s001', 's002', 's003']);
      assertEqual(continued.steps.find(step => step.id === 's002')?.intent, '用户编辑过的意图');
      assertEqual(continued.artifacts?.recorder?.actionLog.length, 3);
    },
  },
  {
    name: 'deleted steps do not revive after subsequent recorder payloads',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [
        clickAction('新建'),
        fillAction('地址池名称', 'pool-a'),
        clickAction('确定'),
      ], [], {});
      const deleted = deleteStepFromFlow(initial, 's002');
      const continued = mergeActionsIntoFlow(deleted, [
        clickAction('新建'),
        fillAction('地址池名称', 'pool-a'),
        clickAction('确定'),
        clickAction('保存'),
      ], [], {
        appendNewActions: true,
        insertBaseActionCount: 3,
      });

      assertEqual(continued.steps.map(step => step.id), ['s001', 's003', 's004']);
      assert(!continued.steps.some(step => step.id === 's002'), 'deleted s002 should not return');
      assertEqual(continued.steps.map(step => step.order), [1, 2, 3]);
    },
  },
  {
    name: 'clearing all visible steps resets hidden recorder history before continuation',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [
        clickAction('新建'),
        fillAction('地址池名称', 'pool-a'),
        clickAction('确定'),
      ], [], {});
      const deletedAll = initial.steps.reduce((flow, step) => deleteStepFromFlow(flow, step.id), initial);

      assertEqual(deletedAll.steps.length, 0);
      assertEqual(deletedAll.artifacts?.recorder?.actionLog.length, 3);

      const cleared = clearFlowRecordingHistory(deletedAll);
      assertEqual(cleared.steps.length, 0);
      assertEqual(cleared.artifacts?.recorder?.actionLog.length, 0);
      assertEqual(countBusinessFlowPlaybackActions(cleared), 0);

      const continued = mergeActionsIntoFlow(cleared, [
        clickAction('新增IP端口池'),
        fillAction('地址池名称', 'pool-b'),
      ], [], {
        appendNewActions: true,
        insertBaseActionCount: 0,
      });

      assertEqual(continued.steps.map(step => step.action), ['click', 'fill']);
      assertEqual(continued.steps.map(step => step.id), ['s001', 's002']);
      assertEqual(continued.artifacts?.recorder?.actionLog.length, 2);
    },
  },
  {
    name: 'manual insert creates a stable non-recorded step without renumbering existing steps',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [
        clickAction('新建'),
        fillAction('地址池名称', 'pool-a'),
        clickAction('确定'),
      ], [], {});
      const inserted = insertEmptyStepAfter(initial, 's001');

      assertEqual(inserted.steps.map(step => step.id), ['s001', 's004', 's002', 's003']);
      assertEqual(inserted.steps.map(step => step.order), [1, 2, 3, 4]);
      const manual = inserted.steps.find(step => step.id === 's004');
      assertEqual(manual?.kind, 'manual');
      assertEqual(manual?.sourceActionIds, []);
    },
  },
  {
    name: 'manual wait insert emits runnable timeout code without renumbering existing steps',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [
        clickAction('新建'),
        clickAction('确定'),
      ], [], {});
      const inserted = insertWaitStepAfter(initial, 's001', 2500);
      const code = generateBusinessFlowPlaywrightCode(inserted);

      assertEqual(inserted.steps.map(step => step.id), ['s001', 's003', 's002']);
      assertEqual(inserted.steps[1].action, 'wait');
      assertEqual(inserted.steps[1].value, '2500');
      assert(code.includes('await page.waitForTimeout(2500);'), 'wait step should emit a runnable timeout');
    },
  },
  {
    name: 'manual wait after async save waits for page stability before timeout',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [
        fillAction('条目名称', 'item-a'),
        clickAction('保存'),
        fillAction('下方表单使用条目', 'item-a'),
      ], [], {});
      const inserted = insertWaitStepAfter(initial, 's002', 2000);
      const waitStep = inserted.steps.find(step => step.action === 'wait');
      const code = generateBusinessFlowPlaywrightCode(inserted);

      assertEqual(waitStep?.intent, '等待保存完成，页面稳定后继续');
      assert(code.includes("await page.waitForLoadState('networkidle').catch(() => {});"), 'wait step should wait for network idle before continuing');
      assert(code.includes('await page.waitForTimeout(2000);'), 'wait step should still include explicit timeout fallback');
    },
  },
  {
    name: 'rule intent is generated without AI for common business actions',
    run: () => {
      const flow = mergeActionsIntoFlow(undefined, [
        clickAction('新建'),
        fillAction('条目名称', 'item-a'),
        clickAction('保存'),
      ], [], {});

      assertEqual(flow.steps.map(step => step.intentSource), ['rule', 'rule', 'rule']);
      assertEqual(flow.steps.map(step => step.intent), ['打开新建入口', '填写条目名称', '保存当前配置']);
    },
  },
  {
    name: 'middle inserted recording keeps following steps and advances the anchor between batches',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [
        clickAction('打开'),
        clickAction('高级'),
        clickAction('保存'),
      ], [], {});
      const insertedFirstBatch = mergeActionsIntoFlow(initial, [
        clickAction('打开'),
        clickAction('高级'),
        clickAction('保存'),
        fillAction('描述', 'batch-1'),
      ], [], {
        insertAfterStepId: 's001',
        insertBaseActionCount: 3,
      });
      const insertedSecondBatch = mergeActionsIntoFlow(insertedFirstBatch, [
        clickAction('打开'),
        clickAction('高级'),
        clickAction('保存'),
        fillAction('描述', 'batch-1'),
        fillAction('备注', 'batch-2'),
      ], [], {
        insertAfterStepId: 's004',
        insertBaseActionCount: 4,
      });

      assertEqual(insertedSecondBatch.steps.map(step => step.id), ['s001', 's004', 's005', 's002', 's003']);
      assertEqual(insertedSecondBatch.steps.map(step => step.order), [1, 2, 3, 4, 5]);
    },
  },
  {
    name: 'select trigger search and option compose into one select transaction',
    run: () => {
      const composition = composeSelectTransactionsFromJournal(journalFromPageEvents([
        pageSelectTriggerEvent('ctx-wan-trigger', 1000, 'WAN口'),
        pageSelectSearchEvent('ctx-wan-search', 1050, 'WAN口', 'wan'),
        pageSelectOptionEvent('ctx-wan-option', 1100, 'WAN口', 'WAN1'),
      ]));

      assertEqual(composition.selectTransactions.length, 1);
      assertEqual(composition.openSelectTransactions.length, 0);
      assertEqual(composition.selectTransactions[0].component, 'Select');
      assertEqual(composition.selectTransactions[0].field.label, 'WAN口');
      assertEqual(composition.selectTransactions[0].searchText, 'wan');
      assertEqual(composition.selectTransactions[0].selectedText, 'WAN1');
      assertEqual(composition.selectTransactions[0].commitReason, 'option-click');
      assertEqual(composition.selectTransactions[0].sourceEventIds, ['page-context:ctx-wan-trigger', 'page-context:ctx-wan-search', 'page-context:ctx-wan-option']);
    },
  },
  {
    name: 'TreeSelect and Cascader select transactions preserve option paths',
    run: () => {
      const composition = composeSelectTransactionsFromJournal(journalFromPageEvents([
        pageSelectTriggerEvent('ctx-scope-trigger', 1000, '发布范围', 'tree-select'),
        pageSelectOptionEvent('ctx-scope-option', 1100, '发布范围', '华东生产区', 'tree-select-option', ['中国', '华东', '生产区']),
        pageSelectTriggerEvent('ctx-egress-trigger', 1200, '出口路径', 'cascader'),
        pageSelectOptionEvent('ctx-egress-option', 1300, '出口路径', 'NAT集群A', 'cascader-option', ['默认路径', 'NAT集群A']),
      ]));

      assertEqual(composition.selectTransactions.map(transaction => transaction.component), ['TreeSelect', 'Cascader']);
      assertEqual(composition.selectTransactions[0].optionPath, ['中国', '华东', '生产区']);
      assertEqual(composition.selectTransactions[1].optionPath, ['默认路径', 'NAT集群A']);
    },
  },
  {
    name: 'open select transaction at stop does not create fake completed select step',
    run: () => {
      const composition = composeSelectTransactionsFromJournal(journalFromPageEvents([
        pageSelectTriggerEvent('ctx-open-trigger', 1000, 'WAN口'),
        pageSelectSearchEvent('ctx-open-search', 1050, 'WAN口', 'wan'),
      ]), { commitOpen: false });
      const projected = mergePageContextIntoFlow(createNamedFlow(), [
        pageSelectTriggerEvent('ctx-open-trigger', 1000, 'WAN口'),
        pageSelectSearchEvent('ctx-open-search', 1050, 'WAN口', 'wan'),
      ]);

      assertEqual(composition.selectTransactions.length, 0);
      assertEqual(composition.openSelectTransactions.length, 1);
      assertEqual(projected.steps.length, 0);
    },
  },
  {
    name: 'projectBusinessFlow facade projects input and select transactions once',
    run: () => {
      const base = createNamedFlow();
      const flow: BusinessFlow = {
        ...base,
        artifacts: {
          ...base.artifacts,
          recorder: {
            version: 3,
            actionLog: [],
            eventJournal: journalFromPageEvents([
              pageInputEvent('ctx-projection-name', 900, '名称', 'edge-lab'),
              pageSelectTriggerEvent('ctx-projection-wan-trigger', 1000, 'WAN口'),
              pageSelectSearchEvent('ctx-projection-wan-search', 1050, 'WAN口', 'wan'),
              pageSelectOptionEvent('ctx-projection-wan-option', 1100, 'WAN口', 'WAN1'),
            ]),
            nextActionSeq: 1,
            nextStepSeq: 1,
            sessions: [],
          },
        },
      } as BusinessFlow;

      const projected = projectBusinessFlow(flow, { commitOpen: true });
      const projectedAgain = projectBusinessFlow(projected, { commitOpen: true });

      assertEqual(projected.steps.map(step => step.action), ['fill', 'select']);
      assertEqual(projected.steps.map(step => step.value), ['edge-lab', 'WAN1']);
      assertEqual(projectedAgain.steps.map(step => step.id), projected.steps.map(step => step.id));
      assertEqual(projectedAgain.steps.map(step => step.action), ['fill', 'select']);
      const fillRecipe = buildRecipeForStep(projected.steps[0]);
      const selectRecipe = buildRecipeForStep(projected.steps[1]);
      assertEqual(fillRecipe?.version, 1);
      assertEqual(fillRecipe?.operation, 'fill');
      assertEqual(fillRecipe?.target?.label, '名称');
      assertEqual(fillRecipe?.value, 'edge-lab');
      assertEqual(selectRecipe?.version, 1);
      assertEqual(selectRecipe?.framework, 'antd');
      assertEqual(selectRecipe?.component, 'Select');
      assertEqual(selectRecipe?.operation, 'selectOption');
      assertEqual(selectRecipe?.option?.displayText, 'WAN1');
      assertEqual(selectRecipe?.replay?.exportedStrategy, 'antd-owned-option-dispatch');
      assertEqual(selectRecipe?.replay?.parserSafeStrategy, 'field-trigger-search-option');
      assertEqual(selectRecipe?.replay?.runtimeFallback, 'active-antd-popup-option');
      const replayRecipe: ReplayUiActionRecipe = selectRecipe!;
      assertEqual(replayRecipe.operation, 'selectOption');
    },
  },
  {
    name: 'recipeBuilder derives table row and popconfirm recipes from FlowStep context',
    run: () => {
      const rowRecipe = buildRecipeForStep({
        id: 's-table-edit',
        order: 1,
        kind: 'recorded',
        action: 'click',
        target: { role: 'button', name: '编辑', scope: { table: { title: '用户管理', rowKey: 'user-42' } } },
        context: {
          eventId: 'ctx-table-edit',
          capturedAt: 1000,
          before: {
            target: { tag: 'button', role: 'button', text: '编辑' },
            table: { title: '用户管理', rowKey: 'user-42', columnName: '操作' },
          } as any,
        },
        assertions: [],
      });
      assertEqual(rowRecipe?.version, 1);
      assertEqual(rowRecipe?.operation, 'rowAction');
      assertEqual(rowRecipe?.component, 'TableRowAction');
      assertEqual(rowRecipe?.replay?.exportedStrategy, 'table-row-action');
      assertEqual(rowRecipe?.replay?.parserSafeStrategy, 'table-row-scoped-action');
      assertEqual((rowRecipe?.target?.table as any)?.title, '用户管理');
      assertEqual((rowRecipe?.target?.row as any)?.key, 'user-42');

      const confirmRecipe = buildRecipeForStep({
        id: 's-delete-ok',
        order: 2,
        kind: 'recorded',
        action: 'click',
        target: { role: 'button', name: '确定' },
        context: {
          eventId: 'ctx-delete-ok',
          capturedAt: 1100,
          before: {
            target: { tag: 'button', role: 'button', text: '确定' },
            dialog: { type: 'popconfirm', title: '确定删除？', visible: true },
          } as any,
        },
        assertions: [],
      });
      assertEqual(confirmRecipe?.version, 1);
      assertEqual(confirmRecipe?.operation, 'confirm');
      assertEqual(confirmRecipe?.component, 'PopconfirmButton');
      assertEqual(confirmRecipe?.replay?.exportedStrategy, 'popover-confirm');
      assertEqual(confirmRecipe?.replay?.parserSafeStrategy, 'dialog-scoped-action');
      assertEqual(confirmRecipe?.replay?.runtimeFallback, 'active-popconfirm-confirm');
      assertEqual((confirmRecipe?.target?.dialog as any)?.title, '确定删除？');
    },
  },
  {
    name: 'recipeBuilder derives effect hints from select row and overlay recipes',
    run: () => {
      const selectRecipe = buildRecipeForStep({
        id: 's-select-wan',
        order: 1,
        kind: 'recorded',
        action: 'click',
        target: { testId: 'network-resource-wan-select', label: 'WAN口', text: 'edge-lab:WAN-extra-18' },
        context: {
          eventId: 'ctx-select-wan',
          capturedAt: 1000,
          before: {
            form: { label: 'WAN口', name: 'wan' },
            target: { framework: 'procomponents', controlType: 'select-option', text: 'edge-lab:WAN-extra-18' },
            ui: { library: 'pro-components', component: 'select', form: { label: 'WAN口', name: 'wan' }, option: { text: 'edge-lab:WAN-extra-18' } },
          } as any,
        },
        assertions: [],
      });
      assertEqual(selectRecipe?.effectHints?.[0]?.kind, 'selected-value-visible');
      assertEqual(selectRecipe?.effectHints?.[0]?.params.targetTestId, 'network-resource-wan-select');

      const deleteRecipe = buildRecipeForStep({
        id: 's-row-delete',
        order: 2,
        kind: 'recorded',
        action: 'click',
        target: { testId: 'wan-transport-row-delete-action', text: '删除', scope: { table: { testId: 'wan-transport-table', rowKey: 'nova_public', rowText: '公网 Nova 删除' } } },
        context: {
          eventId: 'ctx-row-delete',
          capturedAt: 1100,
          before: {
            target: { tag: 'button', testId: 'wan-transport-row-delete-action', text: '删除' },
            table: { testId: 'wan-transport-table', rowKey: 'nova_public', rowText: '公网 Nova 删除' },
          } as any,
          after: { openedDialog: { type: 'popover', title: '删除此行？', visible: true } },
        },
        assertions: [],
      });
      const rowDisappears = deleteRecipe?.effectHints?.find(hint => hint.kind === 'row-disappears');
      assert(!rowDisappears, 'delete opener that only opens Popconfirm must not assert row disappearance before confirm');

      const modalRecipe = buildRecipeForStep({
        id: 's-modal-save',
        order: 3,
        kind: 'recorded',
        action: 'click',
        target: { testId: 'network-resource-save', text: '保存' },
        context: {
          eventId: 'ctx-modal-save',
          capturedAt: 1200,
          before: {
            dialog: { type: 'modal', title: '新建网络资源', visible: true },
            target: { tag: 'button', testId: 'network-resource-save', text: '保存' },
          } as any,
        },
        assertions: [],
      });
      assert(modalRecipe?.effectHints?.some(hint => hint.kind === 'modal-closed'), 'modal save should advertise a modal-closed effect hint');

      const popconfirmRecipe = buildRecipeForStep({
        id: 's-popconfirm-ok',
        order: 4,
        kind: 'recorded',
        action: 'click',
        target: { role: 'button', name: '确定', scope: { table: { testId: 'wan-transport-table', rowKey: 'nova_public', rowText: '公网 Nova 删除' } } },
        context: {
          eventId: 'ctx-popconfirm-ok',
          capturedAt: 1300,
          before: {
            dialog: { type: 'popconfirm', title: '删除此行？', visible: true },
            target: { tag: 'button', role: 'button', text: '确定' },
          } as any,
        },
        assertions: [],
      });
      assert(popconfirmRecipe?.effectHints?.some(hint => hint.kind === 'popconfirm-closed'), 'popconfirm confirm should advertise a popconfirm-closed effect hint');
      const confirmedRowDisappears = popconfirmRecipe?.effectHints?.find(hint => hint.kind === 'row-disappears');
      assertEqual(confirmedRowDisappears?.assertionType, 'row-not-exists');
      assertEqual(confirmedRowDisappears?.params.rowKey, 'nova_public');
    },
  },
  {
    name: 'locator contract diagnostics rank row dialog popup and select candidates',
    run: () => {
      const rowRecipe = buildRecipeForStep({
        id: 's-row-edit',
        order: 1,
        kind: 'recorded',
        action: 'click',
        target: { testId: 'user-row-edit', role: 'button', name: '编辑', scope: { table: { title: '用户管理', rowKey: 'user-42', testId: 'users-table' } } },
        context: {
          eventId: 'ctx-row-edit',
          capturedAt: 1000,
          before: {
            target: { tag: 'button', role: 'button', testId: 'user-row-edit', text: '编辑' },
            table: { title: '用户管理', testId: 'users-table', rowKey: 'user-42', columnName: '操作' },
          } as any,
        },
        assertions: [],
      });
      const selectRecipe = buildRecipeForStep({
        id: 's-select-wan',
        order: 2,
        kind: 'recorded',
        action: 'select',
        target: { label: 'WAN口' },
        value: 'edge-lab:WAN-extra-18',
        context: {
          eventId: 'ctx-select-wan',
          capturedAt: 1100,
          before: {
            form: { label: 'WAN口', name: 'wan' },
            target: { framework: 'procomponents', controlType: 'select-option', selectedOption: 'edge-lab:WAN-extra-18' },
            ui: { library: 'pro-components', component: 'select', form: { label: 'WAN口', name: 'wan' } },
          } as any,
        },
        rawAction: { action: { name: 'select', searchText: 'WAN-extra-18' } },
        assertions: [],
      });
      const modalRecipe = buildRecipeForStep({
        id: 's-modal-save',
        order: 3,
        kind: 'recorded',
        action: 'click',
        target: { testId: 'network-resource-save', role: 'button', name: '保存' },
        context: {
          eventId: 'ctx-modal-save',
          capturedAt: 1200,
          before: {
            dialog: { type: 'modal', title: '新建网络资源', visible: true },
            target: { tag: 'button', role: 'button', testId: 'network-resource-save', text: '保存' },
          } as any,
        },
        assertions: [],
      });
      const popconfirmRecipe = buildRecipeForStep({
        id: 's-popconfirm-ok',
        order: 4,
        kind: 'recorded',
        action: 'click',
        target: { role: 'button', name: '确定' },
        context: {
          eventId: 'ctx-popconfirm-ok',
          capturedAt: 1300,
          before: {
            dialog: { type: 'popconfirm', title: '删除此行？', visible: true },
            target: { tag: 'button', role: 'button', text: '确定' },
          } as any,
        },
        assertions: [],
      });

      assertEqual(rowRecipe?.locatorContract?.primary?.kind, 'row-scoped-testid');
      assert(rowRecipe?.locatorContract?.primary?.value.includes('rowKey=user-42'), 'row-scoped locator should keep row key evidence');
      assertEqual(rowRecipe?.locatorContract?.primary?.payload?.rowKey, 'user-42');
      assertEqual(rowRecipe?.locatorContract?.primaryDiagnostic?.kind, rowRecipe?.locatorContract?.primary?.kind);
      assertEqual(rowRecipe?.locatorContract?.primaryExecutable?.kind, 'row-scoped-testid');
      assertEqual(rowRecipe?.locatorContract?.primaryExecutable?.diagnosticsOnly, false);
      assertEqual(selectRecipe?.locatorContract?.primary?.kind, 'active-popup-option');
      assertEqual(selectRecipe?.locatorContract?.primaryExecutable?.kind, 'active-popup-option');
      assert(selectRecipe?.locatorContract?.primary?.value.includes('option=edge-lab:WAN-extra-18'), 'select candidate should keep option text');
      assertEqual(selectRecipe?.locatorContract?.primary?.payload?.optionText, 'edge-lab:WAN-extra-18');
      assertEqual(modalRecipe?.locatorContract?.primary?.kind, 'dialog-scoped-testid');
      assertEqual(modalRecipe?.locatorContract?.primaryExecutable?.kind, 'dialog-scoped-testid');
      assert(modalRecipe?.locatorContract?.primary?.value.includes('dialogTitle=新建网络资源'), 'modal candidate should keep dialog scope');
      assertEqual(modalRecipe?.locatorContract?.primary?.payload?.dialogTitle, '新建网络资源');
      assertEqual(popconfirmRecipe?.locatorContract?.primary?.kind, 'visible-popconfirm-confirm');
      assertEqual(popconfirmRecipe?.locatorContract?.primaryExecutable?.kind, 'visible-popconfirm-confirm');
      assert(popconfirmRecipe?.locatorContract?.primary?.value.includes('title=删除此行？'), 'popconfirm candidate should keep visible popconfirm scope');
    },
  },
  {
    name: 'locator contract primary drives row scoped renderer output in exported and parser-safe replay',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          action: 'click',
          target: {
            testId: 'wan-transport-row-delete-action',
            role: 'button',
            name: '删除',
            text: '删除',
            scope: {
              table: {
                title: 'WAN传输网络',
                testId: 'wan-transport-table',
                rowKey: 'wan-42',
                rowText: 'wan-42 default 删除',
              },
            },
          },
          context: {
            eventId: 'ctx-row-contract-delete',
            capturedAt: 1000,
            before: {
              target: { tag: 'button', role: 'button', testId: 'wan-transport-row-delete-action', text: '删除', controlType: 'button' },
              table: { title: 'WAN传输网络', testId: 'wan-transport-table', rowKey: 'wan-42', rowText: 'wan-42 default 删除', columnName: '操作' },
            } as any,
          },
          rawAction: { action: { name: 'click', selector: 'internal:testid=[data-testid="wan-transport-row-delete-action"s]' } },
          sourceCode: 'await page.getByTestId("wan-transport-row-delete-action").nth(3).click();',
          assertions: [],
        }],
      };
      const recipe = buildRecipeForStep(flow.steps[0]);
      const exported = generateBusinessFlowPlaywrightCode(flow);
      const parserSafe = generateBusinessFlowPlaybackCode(flow);

      assertEqual(recipe?.locatorContract?.primaryExecutable?.kind, 'row-scoped-testid');
      for (const code of [exported, parserSafe]) {
        assert(code.includes('page.getByTestId("wan-transport-table")'), 'renderer should scope row action to the table contract primary');
        assert(code.includes('tr[data-row-key=\\"wan-42\\"]'), 'renderer should use the contract row key');
        assert(code.includes('.getByTestId("wan-transport-row-delete-action").click();'), 'renderer should click the row-scoped action test id');
        assert(!code.includes('getByTestId("wan-transport-row-delete-action").nth'), 'row action must not replay through global nth');
        assert(!code.includes('page.getByText("删除")'), 'delete row action must not replay through global text');
      }
    },
  },
  {
    name: 'locator contract active-popup-option keeps parser-safe select bridge and exported owned dispatch',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          action: 'click',
          target: {
            text: 'edge-lab:WAN-extra-18',
            displayName: 'edge-lab:WAN-extra-18',
            label: 'WAN口',
          },
          context: {
            eventId: 'ctx-select-contract-option',
            capturedAt: 1000,
            before: {
              form: { label: 'WAN口', name: 'wan' },
              dialog: { type: 'dropdown', visible: true },
              target: {
                tag: 'div',
                role: 'option',
                framework: 'procomponents',
                controlType: 'select-option',
                text: 'edge-lab:WAN-extra-18',
                normalizedText: 'edge-lab:WAN-extra-18',
              },
              ui: { library: 'pro-components', component: 'select', form: { label: 'WAN口', name: 'wan' } },
            } as any,
          },
          rawAction: { action: { name: 'legacyRecordedSource', searchText: 'WAN-extra-18' } },
          sourceCode: 'await page.getByText("edge-lab:WAN-extra-18").click();',
          assertions: [],
        }],
      };
      const recipe = buildRecipeForStep(flow.steps[0]);
      const exported = generateBusinessFlowPlaywrightCode(flow);
      const parserSafe = generateBusinessFlowPlaybackCode(flow);

      assertEqual(recipe?.locatorContract?.primaryExecutable?.kind, 'active-popup-option');
      assert(exported.includes('selectOwnedOption(true)'), 'exported renderer should keep the trigger-owned AntD dispatch workaround');
      assert(parserSafe.includes('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option'), 'parser-safe renderer should keep the explicit active-popup-option bridge');
      for (const code of [exported, parserSafe]) {
        assert(code.includes('edge-lab:WAN-extra-18'), 'renderers should use the contract option text');
        assert(!code.includes('page.getByText("edge-lab:WAN-extra-18")'), 'select option must not replay through global page text');
        assert(!code.includes('rc_select_'), 'select option replay must not use dynamic rc_select ids');
      }
      assertEqual(countBusinessFlowPlaybackActions(flow), runnableLineCount(parserSafe));
    },
  },
  {
    name: 'locator contract does not execute structural dialog test ids as button clicks',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          action: 'click',
          target: {
            testId: 'real-create-item-modal',
            text: '保存',
            name: '保存',
            scope: { dialog: { type: 'modal', title: '新建条目', visible: true } },
          },
          context: {
            eventId: 'ctx-dialog-save-structural-testid',
            capturedAt: 1000,
            before: {
              dialog: { type: 'modal', title: '新建条目', visible: true },
              target: { tag: 'button', role: 'button', text: '保 存', normalizedText: '保 存', controlType: 'button', framework: 'antd' },
            } as any,
          },
          rawAction: { action: { name: 'click', selector: 'internal:testid=[data-testid="real-create-item-modal"s]' } },
          sourceCode: 'await page.getByTestId("real-create-item-modal").click();',
          assertions: [],
        }],
      };
      const recipe = buildRecipeForStep(flow.steps[0]);
      const code = stepCodeBlock(generateBusinessFlowPlaywrightCode(flow), 's001');

      assert(recipe?.locatorContract?.primaryExecutable?.kind !== 'testid', 'structural dialog root test id should not be an executable primary');
      assert(recipe?.locatorContract?.primaryExecutable?.kind !== 'dialog-scoped-testid', 'structural dialog root test id should not be an executable dialog primary');
      assert(code.includes('filter({ hasText: "新建条目" })'), 'dialog save should keep dialog title scope');
      assert(code.includes('getByRole("button"'), 'dialog save should click the button inside the dialog');
      assert(!code.includes('getByTestId("real-create-item-modal").click()'), 'dialog root test id must not become the action target');
    },
  },
  {
    name: 'locator contract keeps native selectOption out of active popup replay',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          action: 'select',
          target: {
            label: 'Country',
            selector: 'select[name="country"]',
          },
          value: 'CN',
          rawAction: { action: { name: 'selectOption', selector: 'select[name="country"]', options: ['CN'] } },
          sourceCode: 'await page.locator("select[name=\\"country\\"]").selectOption("CN");',
          assertions: [],
        }],
      };
      const recipe = buildRecipeForStep(flow.steps[0]);
      const exported = generateBusinessFlowPlaywrightCode(flow);
      const parserSafe = generateBusinessFlowPlaybackCode(flow);

      assertEqual(recipe?.operation, 'selectOption');
      assertEqual(recipe?.framework, 'generic');
      assertEqual(recipe?.locatorContract?.primaryExecutable, undefined);
      for (const code of [exported, parserSafe]) {
        assert(code.includes('.selectOption("CN")'), 'native select should keep Playwright selectOption replay');
        assert(!code.includes('.ant-select-dropdown'), 'native select must not use AntD active popup replay');
        assert(!code.includes('active popup option'), 'native select must not emit active popup bridge comments');
      }
    },
  },
  {
    name: 'recorded opener test id ending with modal keeps page-level test id source',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          action: 'click',
          target: {
            testId: 'open-user-modal',
            text: '新建用户',
            displayName: '新建用户',
          },
          context: {
            eventId: 'ctx-open-user-modal',
            capturedAt: 1000,
            before: {
              target: { tag: 'button', role: 'button', testId: 'open-user-modal', text: '新建用户', normalizedText: '新建用户', controlType: 'button' },
            } as any,
            after: {
              openedDialog: { type: 'modal', title: '新建用户', visible: true },
            },
          },
          rawAction: { action: { name: 'click', selector: 'internal:testid=[data-testid="open-user-modal"s]' } },
          sourceCode: 'await page.getByTestId("open-user-modal").click();',
          assertions: [],
        }],
      };
      const code = stepCodeBlock(generateBusinessFlowPlaywrightCode(flow), 's001');

      assert(code.includes('await page.getByTestId("open-user-modal").click();'), 'recorded opener test id should stay page-level');
      assert(!code.includes('filter({ hasText: "新建用户" }).getByTestId("open-user-modal")'), 'opener test id should not be scoped into the dialog it opens');
      assert(!code.includes('page.getByRole("button"') && !code.includes("page.getByRole('button'"), 'opener test id should not be widened to role/text');
    },
  },
  {
    name: 'locator contract diagnostics mark row actions without rowKey as high risk',
    run: () => {
      const recipe = buildRecipeForStep({
        id: 's-row-without-key',
        order: 1,
        kind: 'recorded',
        action: 'click',
        target: {
          testId: 'user-row-edit',
          role: 'button',
          name: '编辑',
          scope: { table: { title: '用户管理', testId: 'users-table', rowText: 'NAT集群A 编辑' } },
        },
        uiRecipe: { kind: 'table-row-action', library: 'pro-components', component: 'TableRowAction' } as any,
        context: {
          eventId: 'ctx-row-without-key',
          capturedAt: 1000,
          before: {
            target: { tag: 'button', role: 'button', testId: 'user-row-edit', text: '编辑' },
            table: { title: '用户管理', testId: 'users-table', rowText: 'NAT集群A 编辑', columnName: '操作' },
          } as any,
        },
        assertions: [],
      });
      const contract = recipe?.locatorContract;
      const riskCodes = new Set(contract?.risks.map(risk => risk.code));
      const globalTestIdCandidate = contract?.candidates.find(candidate => candidate.kind === 'testid');

      assertEqual(contract?.primary?.kind, 'row-scoped-testid');
      assertEqual(contract?.primary?.risk, 'high');
      assertEqual(contract?.primaryExecutable, undefined);
      assert(contract?.primary?.value.includes('rowText=NAT集群A 编辑'), 'row action without rowKey should keep row text as diagnostic evidence');
      assert(riskCodes.has('row-action-without-row-key'), 'row action without rowKey should carry a semantic high-risk diagnostic');
      assertEqual(globalTestIdCandidate?.risk, 'high');
    },
  },
  {
    name: 'locator contract diagnostics flag dynamic rc select nth and long selector risks',
    run: () => {
      const longCss = '.ant-form .ant-row .ant-col .ant-form-item .ant-select .ant-select-selector .ant-select-selection-search input[data-secret="nope"] .deep .deeper';
      const recipe = buildRecipeForStep({
        id: 's-brittle-locator',
        order: 1,
        kind: 'recorded',
        action: 'click',
        target: { selector: '#rc_select_14', role: 'button', name: '保存' },
        rawAction: { action: { name: 'click', selector: longCss, locator: 'xpath=//div[@class="ant-modal"]//button[2]' } },
        sourceCode: 'await page.getByLabel("密码").fill("secret-value"); await page.locator("[aria-activedescendant=rc_select_14_list_0]").nth(2).click();',
        assertions: [],
      });
      const riskCodes = new Set(recipe?.locatorContract?.risks.map(risk => risk.code));
      const candidateValues = recipe?.locatorContract?.candidates.map(candidate => candidate.value).join('\n') || '';

      assert(riskCodes.has('dynamic-rc-select-id'), 'dynamic rc_select ids should be critical risk diagnostics');
      assert(riskCodes.has('ordinal-locator'), 'ordinal locators should be high risk diagnostics');
      assert(riskCodes.has('long-css-locator'), 'long css selectors should be high risk diagnostics');
      assert(riskCodes.has('xpath-locator'), 'xpath selectors should be high risk diagnostics');
      assert(!candidateValues.includes('secret-value'), 'sourceCode fill values must not become locator candidate values');
      assert(!candidateValues.includes('getByLabel("密码")'), 'sourceCode action statements must not become raw locator candidates');
      assert(recipe?.locatorContract?.candidates.every(candidate => candidate.diagnosticsOnly === true), 'locator candidates should stay diagnostics-only in BAGLC-02');
    },
  },
  {
    name: 'safety guard blocks table row actions without rowKey in exported and parser-safe replay',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          action: 'click',
          target: {
            testId: 'wan-transport-row-delete-action',
            displayName: '删除',
            scope: { table: { title: 'WAN传输网络', testId: 'wan-transport-table', rowText: 'Nova专线 default 删除' } },
          },
          context: {
            eventId: 'ctx-delete-without-row-key',
            capturedAt: 1000,
            before: {
              target: { tag: 'a', testId: 'wan-transport-row-delete-action', text: '删除', framework: 'antd', controlType: 'link' },
              table: { title: 'WAN传输网络', testId: 'wan-transport-table', rowText: 'Nova专线 default 删除', columnName: '操作' },
            } as any,
          },
          assertions: [],
        }],
      };
      const recipe = buildRecipeForStep(flow.steps[0]);
      const exported = generateBusinessFlowPlaywrightCode(flow);
      const parserSafe = generateBusinessFlowPlaybackCode(flow);

      assertEqual(recipe?.operation, 'rowAction');
      assertEqual(recipe?.safetyPreflight?.status, 'blocked');
      assertEqual(recipe?.safetyPreflight?.findings[0]?.code, 'row-action-without-row-key');
      assert(exported.includes('BAGLC safety guard blocked s001: row-action-without-row-key'), 'exported replay should fail closed for row actions without rowKey');
      assert(parserSafe.includes('BAGLC safety guard blocked s001: row-action-without-row-key'), 'parser-safe replay should fail closed for row actions without rowKey');
      assert(parserSafe.includes('data-baglc-reason=') && parserSafe.includes('row-action-without-row-key'), 'parser-safe blocked replay should expose the guard reason in the missing selector');
      assert(parserSafe.includes('click({ timeout: 1 });'), 'parser-safe blocked replay should fail fast instead of waiting for the default action timeout');
      assert(!exported.includes('getByTestId("wan-transport-row-delete-action").click()'), 'blocked row action must not fall back to the reusable global test id');
    },
  },
  {
    name: 'safety guard does not block non-critical row actions without rowKey',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          action: 'click',
          target: {
            testId: 'wan-transport-row-view-action',
            displayName: '查看',
            scope: { table: { title: 'WAN传输网络', testId: 'wan-transport-table', rowText: 'Nova专线 default 查看' } },
          },
          context: {
            eventId: 'ctx-view-without-row-key',
            capturedAt: 1000,
            before: {
              target: { tag: 'a', testId: 'wan-transport-row-view-action', text: '查看', framework: 'antd', controlType: 'link' },
              table: { title: 'WAN传输网络', testId: 'wan-transport-table', rowText: 'Nova专线 default 查看', columnName: '操作' },
            } as any,
          },
          assertions: [],
        }],
      };
      const recipe = buildRecipeForStep(flow.steps[0]);
      const exported = generateBusinessFlowPlaywrightCode(flow);
      const parserSafe = generateBusinessFlowPlaybackCode(flow);

      assertEqual(recipe?.operation, 'rowAction');
      assertEqual(recipe?.safetyPreflight?.impact, 'normal');
      assert(recipe?.safetyPreflight?.status !== 'blocked', 'non-critical row actions without rowKey should not fail closed');
      assert(!exported.includes('row-action-without-row-key'), 'exported replay should not block non-critical row actions without rowKey');
      assert(!parserSafe.includes('row-action-without-row-key'), 'parser-safe replay should not block non-critical row actions without rowKey');
      assert(exported.includes('wan-transport-row-view-action'), 'non-critical row action should still emit a scoped action locator');
    },
  },
  {
    name: 'safety guard blocks critical actions that would use text fallback',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          action: 'click',
          target: { text: '删除', displayName: '删除' },
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);

      assert(code.includes('critical-action-emitted-text-fallback'), 'critical delete/remove actions must not replay through text fallback');
      assert(!code.includes('page.getByText("删除").click()'), 'unsafe critical fallback should not be emitted');
    },
  },
  {
    name: 'locator contract primary replaces unsafe recorded source before safety guard',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            kind: 'recorded',
            action: 'click',
            target: { testId: 'userDeleteButton', role: 'button', name: '删除', text: '删除' },
            rawAction: { action: { name: 'legacyRecordedSource' } },
            sourceCode: 'await page.getByText("删除").click();',
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            kind: 'recorded',
            action: 'click',
            target: { testId: 'removeUserButton', role: 'button', name: '移除用户' },
            rawAction: { action: { name: 'legacyRecordedSource' } },
            sourceCode: 'await page.getByTestId("removeUserButton").nth(1).click();',
            assertions: [],
          },
          {
            id: 's003',
            order: 3,
            kind: 'recorded',
            action: 'click',
            target: { testId: 'confirmDeleteButton', role: 'button', name: '确认删除' },
            rawAction: { action: { name: 'legacyRecordedSource' } },
            sourceCode: 'await page.locator("[aria-activedescendant=rc_select_14_list_0]").click();',
            assertions: [],
          },
        ],
      };
      const firstRecipe = buildRecipeForStep(flow.steps[0]);
      const code = generateBusinessFlowPlaywrightCode(flow);

      assertEqual(firstRecipe?.locatorContract?.primaryExecutable?.kind, 'testid');
      assert(code.includes('page.getByTestId("userDeleteButton").click();'), 'stable contract test id should replace unsafe recorded text fallback');
      assert(code.includes('page.getByTestId("removeUserButton").click();'), 'stable contract test id should replace unsafe recorded ordinal source');
      assert(code.includes('page.getByTestId("confirmDeleteButton").click();'), 'stable contract test id should replace unsafe recorded rc_select source');
      assert(!code.includes('critical-action-emitted-text-fallback'), 'contract-driven renderer should not emit unsafe text fallback for stable targets');
      assert(!code.includes('critical-action-emitted-ordinal-locator'), 'contract-driven renderer should not emit unsafe ordinal source for stable targets');
      assert(!code.includes('critical-action-emitted-dynamic-rc-select-id'), 'contract-driven renderer should not emit unsafe rc_select source for stable targets');
      assert(!code.includes('page.getByText("删除").click()'), 'unsafe emitted text fallback should be blocked');
      assert(!code.includes('page.getByTestId("removeUserButton").nth(1).click()'), 'unsafe emitted ordinal source should be blocked');
      assert(!code.includes('aria-activedescendant=rc_select_14_list_0'), 'unsafe emitted rc_select source should be blocked');
    },
  },
  {
    name: 'safety guard treats row-text scoped ordinal as contextual evidence only',
    run: () => {
      const scopedRowTextSource = 'await page.locator("tr, [role=\\"row\\"], .ant-table-row, .ant-list-item, .ant-descriptions-row, .ant-space, .ant-card, .ant-table-cell").filter({ hasText: /Nova专线[\\s\\S]*default/ }).getByTestId("wan-transport-row-delete-action").first().click();';
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          action: 'click',
          target: { role: 'button', name: 'wan-transport-row-delete-action', displayName: '删除' },
          rawAction: { action: { name: 'legacyRecordedSource' } },
          sourceCode: scopedRowTextSource,
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);

      assert(code.includes(scopedRowTextSource), 'row-text scoped ordinal should not be treated like a page-global ordinal fallback');
      assert(!code.includes('critical-action-emitted-ordinal-locator'), 'row-text scoped ordinal should not trigger the ordinary emitted ordinal block');
      assert(!code.includes('BAGLC safety guard blocked s001'), 'row-text scoped ordinal evidence alone should not block when the recipe is not a rowAction without rowKey');
    },
  },
  {
    name: 'safety guard does not exempt bare locator row-text ordinals',
    run: () => {
      const bareLocatorSource = 'await page.locator("tr, [role=\\"row\\"], .ant-table-row").filter({ hasText: /Nova专线[\\s\\S]*default/ }).locator(".ant-btn").first().click();';
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          action: 'click',
          target: { role: 'button', name: '.ant-btn' },
          context: {
            eventId: 'ctx-bare-row-text-ordinal',
            capturedAt: 1000,
            before: { target: { tag: 'button', role: 'button', text: '删除' } } as any,
          },
          rawAction: { action: { name: 'legacyRecordedSource' } },
          sourceCode: bareLocatorSource,
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);

      assert(code.includes('critical-action-emitted-ordinal-locator'), 'bare locator row-text ordinal should remain blocked for critical actions');
      assert(!code.includes(bareLocatorSource), 'bare locator row-text ordinal must not be emitted as an executable critical action');
    },
  },
  {
    name: 'safety guard detects camelCase and spaced critical action names',
    run: () => {
      const criticalTargets = [
        { testId: 'deleteButton' },
        { testId: 'removeUser' },
        { testId: 'confirmDelete' },
        { testId: 'okButton' },
        { role: 'button', name: '确 定' },
      ];

      for (const [index, target] of criticalTargets.entries()) {
        const recipe = buildRecipeForStep({
          id: `s-critical-${index}`,
          order: index + 1,
          kind: 'recorded',
          action: 'click',
          target,
          assertions: [],
        });

        assertEqual(recipe?.safetyPreflight?.impact, 'critical');
      }

      const saveRecipe = buildRecipeForStep({
        id: 's-save',
        order: 10,
        kind: 'recorded',
        action: 'click',
        target: { role: 'button', name: '保存' },
        assertions: [],
      });

      assertEqual(saveRecipe?.safetyPreflight?.impact, 'normal');
    },
  },
  {
    name: 'safety guard emits modal and popconfirm uniqueness preflight checks',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            kind: 'recorded',
            action: 'click',
            target: { role: 'button', name: '保存', scope: { dialog: { type: 'modal', title: '新建用户', visible: true } } },
            context: {
              eventId: 'ctx-modal-save',
              capturedAt: 1000,
              before: {
                dialog: { type: 'modal', title: '新建用户', visible: true },
                target: { tag: 'button', role: 'button', text: '保存' },
              } as any,
            },
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            kind: 'recorded',
            action: 'click',
            target: { role: 'tooltip', name: '确 定', scope: { dialog: { type: 'popover', title: '删除此行？', visible: true } } },
            context: {
              eventId: 'ctx-popconfirm-ok',
              capturedAt: 1100,
              before: {
                dialog: { type: 'popover', title: '删除此行？', visible: true },
                target: { tag: 'button', role: 'tooltip', text: '确 定' },
              } as any,
            },
            assertions: [],
          },
        ],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      const modalPreflight = 'BAGLC safety guard requires exactly one visible modal/drawer root before a dialog action: s001';
      const popconfirmPreflight = 'BAGLC safety guard requires exactly one visible Popconfirm before confirming: s002';

      assert(code.includes(modalPreflight), 'modal actions should preflight one visible dialog root');
      assert(code.includes('filter({ hasText: "新建用户" })'), 'modal preflight should keep dialog title scope');
      assert(code.includes(popconfirmPreflight), 'Popconfirm confirms should preflight one visible Popconfirm root');
      const popconfirmPreflightIndex = code.indexOf(popconfirmPreflight);
      const popconfirmClickIndex = code.indexOf('getByRole("button"', popconfirmPreflightIndex);
      assert(popconfirmPreflightIndex >= 0 && popconfirmClickIndex > popconfirmPreflightIndex, 'Popconfirm preflight should run before the confirm click');
    },
  },
  {
    name: 'safety guard does not block low-risk navigation',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          action: 'navigate',
          url: '/settings',
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);

      assert(code.includes('page.goto("/settings")'), 'low-risk navigation should still emit normally');
      assert(!code.includes('BAGLC safety guard'), 'low-risk navigation should not be blocked or preflighted');
    },
  },
  {
    name: 'recipeBuilder does not force AntD replay strategy for generic select steps',
    run: () => {
      const recipe = buildRecipeForStep({
        id: 's-generic-select',
        order: 1,
        kind: 'recorded',
        action: 'select',
        target: { label: 'Country' },
        value: 'US',
        assertions: [],
      });
      assertEqual(recipe?.framework, 'generic');
      assertEqual(recipe?.operation, 'selectOption');
      assertEqual(recipe?.option?.displayText, 'US');
      assertEqual(recipe?.replay?.exportedStrategy, 'native-select-option');
      assertEqual(recipe?.replay?.parserSafeStrategy, 'native-select-option');
      assertEqual(recipe?.replay?.runtimeFallback, undefined);
    },
  },
  {
    name: 'recipeBuilder emits AntD Select recipe with field option search text and runtime fallback',
    run: () => {
      const recipe = buildRecipeForStep({
        id: 's-antd-select',
        order: 1,
        kind: 'recorded',
        action: 'select',
        target: { label: 'IP地址池' },
        value: 'test1共享1.1.1.1--2.2.2.2',
        context: {
          eventId: 'ctx-antd-select',
          capturedAt: 1000,
          before: {
            form: { label: 'IP地址池' },
            target: { framework: 'procomponents', controlType: 'select-option', selectedOption: 'test1共享1.1.1.1--2.2.2.2' },
            ui: { library: 'pro-components', component: 'select', form: { label: 'IP地址池' } },
          } as any,
        },
        rawAction: { action: { name: 'select', searchText: 'test1', selectedText: 'test1共享1.1.1.1--2.2.2.2' } },
        assertions: [],
      });

      assertEqual(recipe?.version, 1);
      assertEqual(recipe?.framework, 'procomponents');
      assertEqual(recipe?.component, 'Select');
      assertEqual(recipe?.operation, 'selectOption');
      assertEqual(recipe?.target?.label, 'IP地址池');
      assertEqual(recipe?.option?.displayText, 'test1共享1.1.1.1--2.2.2.2');
      assertEqual(recipe?.option?.searchText, 'test1');
      assertEqual(recipe?.replay?.exportedStrategy, 'antd-owned-option-dispatch');
      assertEqual(recipe?.replay?.parserSafeStrategy, 'field-trigger-search-option');
      assertEqual(recipe?.replay?.runtimeFallback, 'active-antd-popup-option');
    },
  },
  {
    name: 'recipeBuilder keeps TreeSelect option recipes out of owned Select renderer strategy',
    run: () => {
      const recipe = buildRecipeForStep({
        id: 's-tree-option',
        order: 1,
        kind: 'recorded',
        action: 'click',
        target: { text: '华东生产区', displayName: '华东生产区' },
        context: {
          eventId: 'ctx-tree-option',
          capturedAt: 1000,
          before: {
            form: { label: '范围' },
            dialog: { type: 'dropdown', visible: true },
            target: { tag: 'div', role: 'treeitem', framework: 'procomponents', controlType: 'tree-select-option', text: '华东生产区' },
            ui: { library: 'pro-components', component: 'tree-select', form: { label: '范围' } },
          } as any,
        },
        assertions: [],
      });

      assertEqual(recipe?.version, 1);
      assertEqual(recipe?.framework, 'procomponents');
      assertEqual(recipe?.component, 'TreeSelect');
      assertEqual(recipe?.operation, 'selectOption');
      assertEqual(recipe?.replay?.exportedStrategy, 'antd-tree-option-dispatch');
      assertEqual(recipe?.replay?.parserSafeStrategy, 'active-popup-option');
      assertEqual(recipe?.replay?.runtimeFallback, 'active-antd-popup-option');
    },
  },
  {
    name: 'recipeBuilder fail-closes generic options and plain delete buttons without runtime fallback',
    run: () => {
      const genericOptionRecipe = buildRecipeForStep({
        id: 's-generic-option',
        order: 1,
        kind: 'recorded',
        action: 'click',
        target: { role: 'option', text: 'US East' },
        context: {
          eventId: 'ctx-generic-option',
          capturedAt: 1000,
          before: { target: { tag: 'div', role: 'option', text: 'US East' } } as any,
        },
        assertions: [],
      });
      assertEqual(genericOptionRecipe?.operation, 'click');
      assert(genericOptionRecipe?.replay?.runtimeFallback !== 'active-antd-popup-option', 'generic ARIA option must not get AntD runtime fallback');

      const plainDeleteRecipe = buildRecipeForStep({
        id: 's-plain-delete',
        order: 2,
        kind: 'recorded',
        action: 'click',
        target: { testId: 'delete-row', role: 'button', name: '删除' },
        context: {
          eventId: 'ctx-plain-delete',
          capturedAt: 1100,
          before: { target: { tag: 'button', role: 'button', text: '删除', testId: 'delete-row' } } as any,
        },
        assertions: [],
      });
      assertEqual(plainDeleteRecipe?.operation, 'click');
      assert(plainDeleteRecipe?.replay?.runtimeFallback !== 'active-popconfirm-confirm', 'plain delete without popover evidence must not become a Popconfirm recipe');
    },
  },
  {
    name: 'recipeBuilder does not emit selectOption recipe without option text',
    run: () => {
      const recipe = buildRecipeForStep({
        id: 's-empty-select',
        order: 1,
        kind: 'recorded',
        action: 'select',
        target: { label: 'Country' },
        assertions: [],
      });
      assertEqual(recipe, undefined);
    },
  },
  {
    name: 'replay compiler modules back the codePreview facade and parser-safe action count',
    run: () => {
      const flow = mergePageContextIntoFlow(createNamedFlow(), [
        pageSelectTriggerEvent('ctx-compiler-trigger', 1000, 'WAN口'),
        pageSelectSearchEvent('ctx-compiler-search', 1050, 'WAN口', 'wan'),
        pageSelectOptionEvent('ctx-compiler-option', 1100, 'WAN口', 'WAN1'),
      ]);
      const exportedFromFacade = generateBusinessFlowPlaywrightCode(flow);
      const exportedFromReplay = generateBusinessFlowPlaywrightCodeFromReplay(flow);
      const parserSafeFromFacade = generateBusinessFlowPlaybackCode(flow);
      const parserSafeFromReplay = generateBusinessFlowPlaybackCodeFromReplay(flow);
      const assertionPreviewFromFacade = generateAssertionCodePreview(flow);

      assertEqual(exportedFromReplay, exportedFromFacade);
      assertEqual(generateExportedBusinessFlowCode(flow), exportedFromFacade);
      assertEqual(parserSafeFromReplay, parserSafeFromFacade);
      assertEqual(generateParserSafeBusinessFlowCode(flow), parserSafeFromFacade);
      assert(parserSafeFromReplay.includes('.ant-select-item-option'), 'parser-safe renderer should preserve select option replay');
      assert(!parserSafeFromReplay.includes('if (!await'), 'parser-safe renderer must not emit exported-only control flow');
      assertEqual(countBusinessFlowPlaybackActionsFromReplay(flow), countBusinessFlowPlaybackActions(flow));
      assertEqual(countParserSafeBusinessFlowActions(flow), countBusinessFlowPlaybackActions(flow));
      assertEqual(countBusinessFlowPlaybackActionsFromReplay(flow), runnableLineCount(parserSafeFromReplay));
      assertEqual(generateAssertionCodePreviewFromReplay(flow), assertionPreviewFromFacade);
    },
  },
  {
    name: 'replay preserves recorded exact role locator for duplicate Create-like buttons',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's002',
          order: 2,
          kind: 'recorded',
          action: 'click',
          sourceCode: `await page.getByRole('button', { name: 'Create', exact: true }).click();`,
          rawAction: { action: { name: 'click', selector: 'internal:role=button[name="Create"s]' } },
          target: {
            selector: 'internal:role=button[name="Create"s]',
            role: 'button',
            name: 'Create',
            text: 'Create',
            displayName: 'Create',
            locatorHint: {
              strategy: 'global-role',
              confidence: 0.62,
              pageCount: 1,
              pageIndex: 0,
            },
          },
          assertions: [],
        }],
      };

      const exported = generateBusinessFlowPlaywrightCode(flow);
      const playback = generateBusinessFlowPlaybackCode(flow);

      assert(exported.includes('exact: true'), 'exported replay should preserve exact role matching');
      assert(playback.includes('exact: true'), 'parser-safe playback should preserve exact role matching');
      assert(!exported.includes('getByRole("button", { name: "Create" }).click()'), 'exported replay must not widen the recorded exact role locator');
      assert(!playback.includes('getByRole("button", { name: "Create" }).click()'), 'parser-safe playback must not widen the recorded exact role locator');
    },
  },
  {
    name: 'internal exact role selector emits exact role options without recorded source',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's002',
          order: 2,
          kind: 'recorded',
          action: 'click',
          rawAction: { action: { name: 'click', selector: 'internal:role=button[name="Create"s]' } },
          target: {
            selector: 'internal:role=button[name="Create"s]',
            role: 'button',
            name: 'Create',
            text: 'Create',
            displayName: 'Create',
            locatorHint: {
              strategy: 'global-role',
              confidence: 0.62,
              pageCount: 1,
              pageIndex: 0,
            },
          },
          assertions: [],
        }],
      };

      const exported = generateBusinessFlowPlaywrightCode(flow);
      const playback = generateBusinessFlowPlaybackCode(flow);

      assert(exported.includes('page.getByRole("button", { name: "Create", exact: true }).click();'), 'exported replay should rebuild exact role matching from internal selector suffix s');
      assert(playback.includes('page.getByRole("button", { name: "Create", exact: true }).click();'), 'parser-safe playback should rebuild exact role matching from internal selector suffix s');
    },
  },
  {
    name: 'duplicate role locator preserves exact matching and ordinal disambiguation',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's002',
          order: 2,
          kind: 'recorded',
          action: 'click',
          rawAction: { action: { name: 'click', selector: 'internal:role=button[name="Create"s]' } },
          target: {
            selector: 'internal:role=button[name="Create"s]',
            role: 'button',
            name: 'Create',
            text: 'Create',
            displayName: 'Create',
            locatorHint: {
              strategy: 'global-role',
              confidence: 0.62,
              pageCount: 2,
              pageIndex: 0,
            },
          },
          assertions: [],
        }],
      };
      const exported = generateBusinessFlowPlaywrightCode(flow);
      const playback = generateBusinessFlowPlaybackCode(flow);
      const expected = 'page.getByRole("button", { name: "Create", exact: true }).nth(0).click();';

      assert(exported.includes(expected), 'exported replay should preserve exact role matching before applying nth(pageIndex)');
      assert(playback.includes(expected), 'parser-safe playback should preserve exact role matching before applying nth(pageIndex)');
      assert(!exported.includes('page.getByRole("button", { name: "Create" }).click();'), 'duplicate role replay must not fall back to a bare global role locator');
    },
  },
  {
    name: 'non-exact role evidence does not force exact role matching',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's002',
          order: 2,
          kind: 'recorded',
          action: 'click',
          sourceCode: `await page.getByRole('button', { name: 'Create' }).click();`,
          rawAction: { action: { name: 'click', selector: 'internal:role=button[name="Create"i]' } },
          target: {
            selector: 'internal:role=button[name="Create"i]',
            role: 'button',
            name: 'Create',
            text: 'Create',
            displayName: 'Create',
          },
          assertions: [],
        }],
      };
      const exported = generateBusinessFlowPlaywrightCode(flow);
      const playback = generateBusinessFlowPlaybackCode(flow);

      assert(!exported.includes('exact: true'), 'exported replay should not invent exact matching without exact evidence');
      assert(!playback.includes('exact: true'), 'parser-safe playback should not invent exact matching without exact evidence');
      assert(/page\.getByRole\(["']button["'], \{ name: ["']Create["'] \}\)\.click\(\);/.test(exported), 'non-exact evidence should keep the existing role/name fallback shape');
    },
  },
  {
    name: 'section scoped role locator preserves recorded exact role matching',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's002',
          order: 2,
          kind: 'recorded',
          action: 'click',
          rawAction: { action: { name: 'click', selector: 'internal:role=button[name="Create"s]' } },
          target: {
            selector: 'internal:role=button[name="Create"s]',
            role: 'button',
            name: 'Create',
            text: 'Create',
            displayName: 'Create',
            scope: { section: { testId: 'environment-toolbar', kind: 'section' } },
          },
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);

      assert(code.includes('page.getByTestId("environment-toolbar").getByRole("button", { name: "Create", exact: true }).click();'), 'section-scoped role locator should not widen exact role evidence');
    },
  },
  {
    name: 'dialog scoped role locator preserves recorded exact role matching',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's002',
          order: 2,
          kind: 'recorded',
          action: 'click',
          rawAction: { action: { name: 'click', selector: 'internal:role=button[name="Create"s]' } },
          target: {
            selector: 'internal:role=button[name="Create"s]',
            role: 'button',
            name: 'Create',
            text: 'Create',
            displayName: 'Create',
            scope: { dialog: { title: 'Create Environment', type: 'modal', visible: true } },
          },
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);

      assert(code.includes('page.locator(".ant-modal, .ant-drawer, [role=\\"dialog\\"]").filter({ hasText: "Create Environment" }).getByRole("button", { name: "Create", exact: true }).click();'), 'dialog-scoped role locator should not widen exact role evidence');
    },
  },
  {
    name: 'recorded exact role source with dialog scope prefers dialog scoped exact locator',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's002',
          order: 2,
          kind: 'recorded',
          action: 'click',
          sourceCode: `await page.getByRole('button', { name: 'Create', exact: true }).click();`,
          rawAction: { action: { name: 'click', selector: 'internal:role=button[name="Create"s]' } },
          target: {
            selector: 'internal:role=button[name="Create"s]',
            role: 'button',
            name: 'Create',
            text: 'Create',
            displayName: 'Create',
            scope: { dialog: { title: 'Create Environment', type: 'modal', visible: true } },
          },
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);

      assert(code.includes('page.locator(".ant-modal, .ant-drawer, [role=\\"dialog\\"]").filter({ hasText: "Create Environment" }).getByRole("button", { name: "Create", exact: true }).click();'), 'dialog scope should be stronger than preserving a global exact recorded source');
      assert(!code.includes(`page.getByRole('button', { name: 'Create', exact: true }).click();`), 'dialog-scoped replay must not be replaced by the recorded global exact source');
    },
  },
  {
    name: 'recorded exact role source with section scope prefers section scoped exact locator',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's002',
          order: 2,
          kind: 'recorded',
          action: 'click',
          sourceCode: `await page.getByRole('button', { name: 'Create', exact: true }).click();`,
          rawAction: { action: { name: 'click', selector: 'internal:role=button[name="Create"s]' } },
          target: {
            selector: 'internal:role=button[name="Create"s]',
            role: 'button',
            name: 'Create',
            text: 'Create',
            displayName: 'Create',
            scope: { section: { testId: 'environment-toolbar', kind: 'section' } },
          },
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);

      assert(code.includes('page.getByTestId("environment-toolbar").getByRole("button", { name: "Create", exact: true }).click();'), 'section scope should be stronger than preserving a global exact recorded source');
      assert(!code.includes(`page.getByRole('button', { name: 'Create', exact: true }).click();`), 'section-scoped replay must not be replaced by the recorded global exact source');
    },
  },
  {
    name: 'replay compiler omits redundant AntD select trigger and search before option workaround',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            kind: 'recorded',
            action: 'click',
            target: { role: 'combobox', name: 'WAN口' },
            context: { eventId: 'ctx-trigger', capturedAt: 1000, before: { form: { label: 'WAN口' }, target: { role: 'combobox', framework: 'antd', controlType: 'select' } } },
            sourceCode: `await page.getByRole("combobox", { name: "WAN口" }).click();`,
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            kind: 'recorded',
            action: 'fill',
            value: 'xtest16',
            target: { role: 'combobox', name: 'WAN口' },
            context: { eventId: 'ctx-search', capturedAt: 1050, before: { form: { label: 'WAN口' }, target: { role: 'combobox', framework: 'antd', controlType: 'select' } } },
            sourceCode: `await page.getByRole('combobox', { name: 'WAN口' }).fill("xtest16");`,
            assertions: [],
          },
          {
            id: 's003',
            order: 3,
            kind: 'recorded',
            action: 'click',
            target: { text: 'xtest16:WAN1', displayName: 'xtest16:WAN1' },
            rawAction: { action: { name: 'click', selector: 'internal:attr=[title="xtest16:WAN1"i] >> div' } },
            sourceCode: `await page.getByTitle('xtest16:WAN1').locator('div').click();`,
            assertions: [],
          },
          {
            id: 's004',
            order: 4,
            kind: 'recorded',
            action: 'click',
            target: {},
            rawAction: { action: { name: 'click', selector: 'internal:text="xtest16:WAN1"i' } },
            sourceCode: `await page.getByText('xtest16:WAN1').click();`,
            assertions: [],
          },
        ],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      const playback = generateBusinessFlowPlaybackCode(flow);

      assert(!code.includes('.fill("xtest16")'), 'exported replay should omit redundant AntD select search fills before the option workaround');
      assert(code.includes('selectOwnedOption(false)'), 'exported replay should check the trigger-owned target option before opening the select');
      assert(!code.includes('.ant-select-dropdown:visible'), 'exported replay should not rely on global visible AntD dropdowns for trigger-owned option replay');
      assert(!playback.includes("getByText('xtest16:WAN1')"), 'parser-safe replay should dedupe follow-up raw text clicks after selecting the same AntD option');
      assert(playback.includes('.ant-select-dropdown:not(.ant-select-dropdown-hidden)'), 'parser-safe replay must keep the current CrxPlayer active option selector contract');
      assert(!playback.includes('.ant-select-dropdown:visible'), 'parser-safe replay must not use exported-only :visible active dropdown selectors before the runtime bridge supports them');
      assert(!playback.includes('if (!await'), 'parser-safe replay should remain flat parser-safe actions');
      assertEqual(countBusinessFlowPlaybackActions(flow), runnableLineCount(playback));
      assertEqual(countBusinessFlowPlaybackActions(flow), countBusinessFlowPlaybackActionsFromReplay(flow));
      assert(code.includes('getByRole("combobox", { name: "WAN口" })') || code.includes('page.locator(".ant-form-item").filter({ hasText: "WAN口" })'), 'exported replay should still open the select before choosing the option');
      assert(code.includes('xtest16:WAN1'), 'exported replay should still choose the intended option');
    },
  },
  {
    name: 'exported AntD select recipe prefers exact option before prefix fallback',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            kind: 'recorded',
            action: 'select',
            target: { role: 'combobox', label: '集群', name: '集群' },
            value: 'NAT集群A',
            context: {
              eventId: 'ctx-prefix-select',
              capturedAt: 1000,
              before: {
                form: { label: '集群' },
                target: { role: 'option', framework: 'antd', controlType: 'select-option', selectedOption: 'NAT集群A' },
                ui: { library: 'antd', component: 'select', form: { label: '集群' } },
              } as any,
            },
            rawAction: { action: { name: 'select', selectedText: 'NAT集群A' } },
            assertions: [],
          },
        ],
      };

      const code = generateBusinessFlowPlaywrightCode(flow);

      assert(code.includes('const optionMatches = options.map(element =>'), 'owned select replay should classify option candidates before dispatch');
      assert(code.includes('optionMatches.find(match => match.exact)?.element || optionMatches.find(match => match.partial)?.element'), 'owned select replay should prefer exact option text before prefix fallback');
    },
  },
  {
    name: 'exported replay omits selected value display click immediately after projected AntD select',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            kind: 'recorded',
            action: 'select',
            target: {
              role: 'combobox',
              label: 'WAN口',
              name: 'WAN口',
              displayName: 'WAN口',
              testId: 'network-resource-wan-select',
              scope: { form: { label: 'WAN口', testId: 'network-resource-wan-select' } },
            },
            value: 'edge-lab:WAN1',
            uiRecipe: {
              kind: 'select-option',
              library: 'antd',
              component: 'Select',
              fieldKind: 'select',
              fieldLabel: 'WAN口',
              optionText: 'edge-lab:WAN1',
            },
            rawAction: {
              name: 'select',
              transactionId: 'select-wan',
              searchText: 'edge-lab',
              selectedText: 'edge-lab:WAN1',
            },
            sourceCode: [
              `await page.locator(".ant-form-item").filter({ hasText: "WAN口" }).locator(".ant-select-selector, .ant-cascader-picker, .ant-select").first().click();`,
              `await page.locator(".ant-form-item").filter({ hasText: "WAN口" }).locator("input:visible").first().fill("edge-lab");`,
              `await page.locator(".ant-select-dropdown:visible, .ant-cascader-dropdown:visible").last().locator(".ant-select-item-option, .ant-cascader-menu-item, .ant-select-tree-treenode, .ant-select-tree-node-content-wrapper").filter({ hasText: "edge-lab:WAN1" }).first().click();`,
            ].join('\n'),
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            kind: 'recorded',
            action: 'click',
            target: {
              text: 'edge-lab:WAN1',
              displayName: 'edge-lab:WAN1',
              scope: { form: { label: 'WAN口' } },
            },
            context: {
              eventId: 'ctx-wan-selected-echo',
              capturedAt: 1100,
              before: {
                form: { label: 'WAN口' },
                target: { tag: 'span', text: 'edge-lab:WAN1', normalizedText: 'edge-lab:WAN1' },
              },
            },
            rawAction: { action: { name: 'click', selector: 'internal:text="edge-lab:WAN1"i' } },
            sourceCode: `await page.getByText("edge-lab:WAN1").click();`,
            assertions: [{
              id: 's002-selected',
              type: 'selected-value-visible',
              subject: 'element',
              target: { testId: 'network-resource-wan-select' },
              expected: 'edge-lab:WAN1',
              params: { targetTestId: 'network-resource-wan-select', expected: 'edge-lab:WAN1' },
              enabled: true,
            }],
          },
        ],
        repeatSegments: [{
          id: 'repeat-network-resource',
          name: '批量新建网络资源',
          stepIds: ['s001', 's002'],
          parameters: [{
            id: 'port-param',
            label: 'WAN口',
            sourceStepId: 's001',
            currentValue: 'edge-lab:WAN1',
            variableName: 'port',
            enabled: true,
          }],
          rows: [{ id: 'row-1', values: { 'port-param': 'edge-lab:WAN1' } }],
          createdAt: '2026-05-12T00:00:00.000Z',
          updatedAt: '2026-05-12T00:00:00.000Z',
        }],
      };

      const code = generateBusinessFlowPlaywrightCode(flow);
      const playback = generateBusinessFlowPlaybackCode(flow);

      assert(!code.includes('page.getByText("edge-lab:WAN1").click()'), 'exported replay should omit the redundant selected-value display click');
      assert(!playback.includes('page.getByText("edge-lab:WAN1").click()'), 'parser-safe replay should omit the redundant selected-value display click');
      assert(code.includes('await expect(page.getByTestId("network-resource-wan-select")).toContainText("edge-lab:WAN1");') ||
        code.includes('await expect(page.getByTestId("network-resource-wan-select")).toContainText(String(row.port));'), 'exported replay should preserve the selected-value terminal assertion');
      assert(code.includes('String(row.port)'), 'repeat rendering should still parameterize the real select option');

      const flowWithoutSelectedValueAssertion: BusinessFlow = {
        ...flow,
        steps: flow.steps.map(step => step.id === 's002' ? { ...step, assertions: [] } : step),
      };
      const exportedWithoutAssertion = generateBusinessFlowPlaywrightCode(flowWithoutSelectedValueAssertion);
      const parserSafeWithoutAssertion = generateBusinessFlowPlaybackCode(flowWithoutSelectedValueAssertion);
      assert(!exportedWithoutAssertion.includes('page.getByText("edge-lab:WAN1").click()'), 'exported replay should dedupe an exact selected-value echo even without a terminal selected-value assertion');
      assert(!parserSafeWithoutAssertion.includes('page.getByText("edge-lab:WAN1").click()'), 'parser-safe replay should dedupe an exact selected-value echo even without a terminal selected-value assertion');
      assertEqual(countBusinessFlowPlaybackActions(flowWithoutSelectedValueAssertion), runnableLineCount(parserSafeWithoutAssertion));

      const flowWithPreviousSelectedValueAssertion: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 'vrf-select',
            order: 1,
            kind: 'recorded',
            action: 'select',
            target: { role: 'combobox', label: '关联VRF', name: '关联VRF' },
            value: '生产VRF',
            context: {
              eventId: 'ctx-vrf-select',
              capturedAt: 1000,
              before: {
                form: { label: '关联VRF' },
                target: {
                  role: 'option',
                  framework: 'antd',
                  controlType: 'select-option',
                  selectedOption: '生产VRF',
                },
                ui: { library: 'antd', component: 'select', form: { label: '关联VRF' } },
              } as any,
            },
            rawAction: { action: { name: 'select', selectedText: '生产VRF' } },
            assertions: [{
              id: 'vrf-selected',
              type: 'selected-value-visible',
              subject: 'element',
              target: { role: 'combobox', label: '关联VRF', name: '关联VRF' },
              expected: '生产VRF',
              enabled: true,
            }],
          },
          {
            id: 'vrf-selected-echo',
            order: 2,
            kind: 'recorded',
            action: 'click',
            target: { text: '生产VRF', displayName: '生产VRF' },
            sourceCode: `await page.getByText("生产VRF").click();`,
            context: {
              eventId: 'ctx-vrf-selected-echo',
              capturedAt: 1100,
              before: {
                target: { tag: 'span', text: '生产VRF', normalizedText: '生产VRF' },
              } as any,
            },
            rawAction: { action: { name: 'click', selector: 'internal:text="生产VRF"i', text: '生产VRF' } },
            assertions: [],
          },
        ],
      };
      const exportedWithPreviousAssertion = generateBusinessFlowPlaywrightCode(flowWithPreviousSelectedValueAssertion);
      const parserSafeWithPreviousAssertion = generateBusinessFlowPlaybackCode(flowWithPreviousSelectedValueAssertion);
      assert(!exportedWithPreviousAssertion.includes('page.getByText("生产VRF").click()'), 'exported replay should dedupe a selected-value echo tied by the previous select assertion');
      assert(!parserSafeWithPreviousAssertion.includes('page.getByText("生产VRF").click()'), 'parser-safe replay should dedupe a selected-value echo tied by the previous select assertion');
      assert(exportedWithPreviousAssertion.includes('生产VRF'), 'exported replay should keep the selected-value assertion text');
      assertEqual(countBusinessFlowPlaybackActions(flowWithPreviousSelectedValueAssertion), runnableLineCount(parserSafeWithPreviousAssertion));

      const flowWithSourceScopedPreviousAssertion: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 'vrf-source-scoped-select',
            order: 1,
            kind: 'recorded',
            action: 'select',
            target: { role: 'combobox', displayName: 'combobox 关联VRF' },
            value: '生产VRF',
            context: {
              eventId: 'ctx-vrf-source-scoped-select',
              capturedAt: 1000,
              before: {
                target: {
                  framework: 'antd',
                  controlType: 'select-option',
                  selectedOption: '生产VRF',
                },
                ui: { library: 'antd', component: 'select' },
              } as any,
            },
            rawAction: { action: { name: 'select', selectedText: '生产VRF' } },
            sourceCode: 'await page.locator(".ant-modal, .ant-drawer, [role=\\"dialog\\"]").filter({ hasText: "新建网络资源" }).locator(".ant-form-item").filter({ hasText: "关联VRF" }).locator(".ant-select-selector, .ant-cascader-picker, .ant-select").first().click();',
            assertions: [{
              id: 'vrf-source-selected',
              type: 'selected-value-visible',
              subject: 'element',
              target: { label: '关联VRF' },
              expected: '生产VRF',
              enabled: true,
            }],
          },
          {
            id: 'vrf-source-selected-echo',
            order: 2,
            kind: 'recorded',
            action: 'click',
            target: { text: '生产VRF', displayName: '生产VRF' },
            sourceCode: `await page.getByText("生产VRF").click();`,
            context: {
              eventId: 'ctx-vrf-source-selected-echo',
              capturedAt: 1100,
              before: {
                target: { tag: 'span', text: '生产VRF', normalizedText: '生产VRF' },
              } as any,
            },
            rawAction: { action: { name: 'click', selector: 'internal:text="生产VRF"i', text: '生产VRF' } },
            assertions: [],
          },
        ],
      };
      const exportedWithSourceScopedAssertion = generateBusinessFlowPlaywrightCode(flowWithSourceScopedPreviousAssertion);
      const parserSafeWithSourceScopedAssertion = generateBusinessFlowPlaybackCode(flowWithSourceScopedPreviousAssertion);
      assert(!exportedWithSourceScopedAssertion.includes('page.getByText("生产VRF").click()'), 'exported replay should dedupe a selected-value echo tied by source-scoped form item identity');
      assert(!parserSafeWithSourceScopedAssertion.includes('page.getByText("生产VRF").click()'), 'parser-safe replay should dedupe a selected-value echo tied by source-scoped form item identity');
      assertEqual(countBusinessFlowPlaybackActions(flowWithSourceScopedPreviousAssertion), runnableLineCount(parserSafeWithSourceScopedAssertion));

      const flowWithPollutedPreviousIdentity: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 'vrf-polluted-select',
            order: 1,
            kind: 'recorded',
            action: 'select',
            target: { role: 'combobox', displayName: 'combobox 生产VRF' },
            value: '生产VRF',
            context: {
              eventId: 'ctx-vrf-polluted-select',
              capturedAt: 1000,
              before: {
                target: {
                  framework: 'antd',
                  controlType: 'select-option',
                  selectedOption: '生产VRF',
                },
                ui: { library: 'antd', component: 'select' },
              } as any,
            },
            rawAction: { action: { name: 'select', selectedText: '生产VRF' } },
            assertions: [],
          },
          {
            id: 'vrf-polluted-selected-echo',
            order: 2,
            kind: 'recorded',
            action: 'click',
            target: { text: '生产VRF', displayName: '生产VRF' },
            sourceCode: `await page.getByText("生产VRF").click();`,
            rawAction: { action: { name: 'click', selector: 'internal:text="生产VRF"i', text: '生产VRF' } },
            assertions: [],
          },
        ],
      };
      const exportedWithPollutedIdentity = generateBusinessFlowPlaywrightCode(flowWithPollutedPreviousIdentity);
      const parserSafeWithPollutedIdentity = generateBusinessFlowPlaybackCode(flowWithPollutedPreviousIdentity);
      assert(!exportedWithPollutedIdentity.includes('page.getByText("生产VRF").click()'), 'exported replay should dedupe selected-value echoes when the previous select identity is polluted by the selected value');
      assert(!parserSafeWithPollutedIdentity.includes('page.getByText("生产VRF").click()'), 'parser-safe replay should dedupe selected-value echoes when the previous select identity is polluted by the selected value');
      assertEqual(countBusinessFlowPlaybackActions(flowWithPollutedPreviousIdentity), runnableLineCount(parserSafeWithPollutedIdentity));

      const repeatFlowWithPollutedPreviousIdentity: BusinessFlow = {
        ...flowWithPollutedPreviousIdentity,
        steps: flowWithPollutedPreviousIdentity.steps.map(step => step.id === 'vrf-polluted-select' ? {
          ...step,
          assertions: [{
            id: 'vrf-polluted-selected',
            type: 'selected-value-visible',
            subject: 'element',
            target: { label: '关联VRF' },
            expected: '生产VRF',
            enabled: true,
          }],
        } : step),
        repeatSegments: [{
          id: 'repeat-network-resource',
          name: '批量新建网络资源',
          stepIds: ['vrf-polluted-select', 'vrf-polluted-selected-echo'],
          parameters: [{
            id: 'p-context',
            label: '关联VRF',
            sourceStepId: 'vrf-polluted-select',
            currentValue: '生产VRF',
            variableName: 'context',
            enabled: true,
          }],
          rows: [{ id: 'row-1', values: { 'p-context': '生产VRF' } }],
          createdAt: '2026-05-14T00:00:00.000Z',
          updatedAt: '2026-05-14T00:00:00.000Z',
        }],
      };
      const exportedRepeatWithPollutedIdentity = generateBusinessFlowPlaywrightCode(repeatFlowWithPollutedPreviousIdentity);
      assert(!exportedRepeatWithPollutedIdentity.includes('page.getByText("生产VRF").click()'), 'repeat exported replay should dedupe selected-value echoes when the previous select identity is polluted by the selected value');
      assert(exportedRepeatWithPollutedIdentity.includes('String(row.context)'), 'repeat replay should still parameterize the selected value');
    },
  },
  {
    name: 'selected-value echo dedupe does not drop same-text follow-up click outside the select field',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            kind: 'recorded',
            action: 'select',
            target: { role: 'combobox', label: '集群', name: '集群' },
            value: 'NAT集群A',
            context: {
              eventId: 'ctx-select-cluster',
              capturedAt: 1000,
              before: {
                form: { label: '集群' },
                target: {
                  role: 'option',
                  framework: 'antd',
                  controlType: 'select-option',
                  selectedOption: 'NAT集群A',
                },
                ui: { library: 'antd', component: 'select', form: { label: '集群' } },
              } as any,
            },
            rawAction: { action: { name: 'select', selectedText: 'NAT集群A' } },
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            kind: 'recorded',
            action: 'click',
            target: { text: 'NAT集群A', displayName: 'NAT集群A' },
            sourceCode: `await page.getByText("NAT集群A").click();`,
            context: {
              eventId: 'ctx-click-cluster-card',
              capturedAt: 1100,
              before: {
                target: { tag: 'div', text: 'NAT集群A', normalizedText: 'NAT集群A' },
              } as any,
            },
            rawAction: { action: { name: 'click', text: 'NAT集群A' } },
            assertions: [],
          },
        ],
      };

      const exported = generateBusinessFlowPlaywrightCode(flow);
      const parserSafe = generateBusinessFlowPlaybackCode(flow);
      const hasSameTextClick = (code: string) => code.includes('page.getByText("NAT集群A").click()') || code.includes("page.getByText('NAT集群A').click()");

      assert(hasSameTextClick(exported), 'exported replay must keep a same-text click that is not scoped to the previous select field');
      assert(hasSameTextClick(parserSafe), 'parser-safe replay must keep a same-text click that is not scoped to the previous select field');
      assertEqual(countBusinessFlowPlaybackActions(flow), runnableLineCount(parserSafe));

      const flowWithPreviousAssertion: BusinessFlow = {
        ...flow,
        steps: flow.steps.map(step => step.id === 's001' ? {
          ...step,
          assertions: [{
            id: 'cluster-selected',
            type: 'selected-value-visible',
            subject: 'element',
            target: { label: '集群' },
            expected: 'NAT集群A',
            enabled: true,
          }],
        } : step),
      };
      const exportedWithPreviousAssertion = generateBusinessFlowPlaywrightCode(flowWithPreviousAssertion);
      const parserSafeWithPreviousAssertion = generateBusinessFlowPlaybackCode(flowWithPreviousAssertion);
      assert(hasSameTextClick(exportedWithPreviousAssertion), 'exported replay must keep a same-text div click even when the previous select has a selected-value assertion');
      assert(hasSameTextClick(parserSafeWithPreviousAssertion), 'parser-safe replay must keep a same-text div click even when the previous select has a selected-value assertion');
    },
  },
  {
    name: 'parser-safe AntD IPv4 pool option preserves secondary marker order after range',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            kind: 'recorded',
            action: 'click',
            target: {
              role: 'combobox',
              name: 'IP地址池',
            },
            context: { eventId: 'ctx-address-pool-trigger', capturedAt: 1000, before: { form: { label: 'IP地址池' }, target: { role: 'combobox', framework: 'procomponents', controlType: 'select' } } },
            sourceCode: `await page.locator(".ant-form-item").filter({ hasText: "IP地址池" }).locator(".ant-select-selector").first().click();`,
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            kind: 'recorded',
            action: 'click',
            target: { text: 'test1 1.1.1.1--2.2.2.2 共享', displayName: 'test1 1.1.1.1--2.2.2.2 共享' },
            context: {
              eventId: 'ctx-address-pool-option',
              capturedAt: 1100,
              before: {
                form: { label: 'IP地址池' },
                dialog: { type: 'dropdown', title: 'IP地址池', visible: true },
                target: {
                  tag: 'div',
                  role: 'option',
                  title: '[object Object]',
                  text: 'test1 1.1.1.1--2.2.2.2 共享',
                  normalizedText: 'test1 1.1.1.1--2.2.2.2 共享',
                  selectedOption: 'test1 1.1.1.1--2.2.2.2 共享',
                  framework: 'procomponents',
                  controlType: 'select-option',
                },
              },
            },
            rawAction: { action: { name: 'click', selector: 'internal:text="test11.1.1.1--2.2.2.2共享"i' } },
            sourceCode: `await page.getByText('test11.1.1.1--2.2.2.2共享').click();`,
            assertions: [],
          },
        ],
      };

      const playback = generateBusinessFlowPlaybackCode(flow);
      const optionStep = stepCodeBlock(playback, 's002');

      assert(optionStep.includes('.ant-select-dropdown:not(.ant-select-dropdown-hidden)'), 'parser-safe replay should keep the active dropdown runtime bridge contract');
      assertParserSafeIpOptionCompactToken(optionStep, 'test11.1.1.1--2.2.2.2共享');
      assertEqual(countBusinessFlowPlaybackActions(flow), runnableLineCount(playback));
    },
  },
  {
    name: 'parser-safe AntD IPv4 pool option preserves secondary marker order before range',
    run: () => {
      const flow = createIpPoolSelectFlow('test1 共享 1.1.1.1--2.2.2.2');
      const playback = generateBusinessFlowPlaybackCode(flow);
      const optionStep = stepCodeBlock(playback, 's002');

      assert(optionStep.includes('.ant-select-dropdown:not(.ant-select-dropdown-hidden)'), 'parser-safe replay should keep the active dropdown runtime bridge contract');
      assertParserSafeIpOptionCompactToken(optionStep, 'test1共享1.1.1.1--2.2.2.2');
      assertEqual(countBusinessFlowPlaybackActions(flow), runnableLineCount(playback));
    },
  },
  {
    name: 'parser-safe contextless required WAN combobox search uses scoped AntD input',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            kind: 'recorded',
            action: 'click',
            target: { role: 'combobox', name: '* WAN口' },
            rawAction: { action: { name: 'click', selector: 'internal:role=combobox[name="* WAN口"i]' } },
            sourceCode: `await page.getByRole("combobox", { name: "* WAN口" }).click();`,
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            kind: 'recorded',
            action: 'fill',
            target: { role: 'combobox', name: '* WAN口' },
            value: 'xtest16',
            rawAction: { action: { name: 'fill', selector: 'internal:role=combobox[name="* WAN口"i]', text: 'xtest16' } },
            sourceCode: `await page.getByRole("combobox", { name: "* WAN口" }).fill("xtest16");`,
            assertions: [],
          },
          {
            id: 's003',
            order: 3,
            kind: 'recorded',
            action: 'click',
            target: { text: 'xtest16:WAN1', displayName: 'xtest16:WAN1' },
            rawAction: { action: { name: 'click', selector: 'internal:text="xtest16:WAN1"s' } },
            sourceCode: `await page.getByText("xtest16:WAN1").click();`,
            assertions: [],
          },
        ],
      };
      const playback = generateBusinessFlowPlaybackCode(flow);
      const searchStep = stepCodeBlock(playback, 's002');

      assert(searchStep.includes('filter({ hasText: "WAN口" })'), 'parser-safe search fill should infer required WAN form item from combobox name');
      assert(searchStep.includes('.locator("input:visible").fill("xtest16")'), 'parser-safe search fill should target the visible AntD search input');
      assert(!searchStep.includes('input[name="* WAN口"]'), 'parser-safe search fill must not treat the combobox accessible name as an input name');
    },
  },
  {
    name: 'exported replay omits non-adjacent redundant required combobox click before projected select transaction',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            kind: 'recorded',
            sourceActionIds: ['a001'],
            action: 'click',
            target: {
              role: 'combobox',
              name: '* WAN口',
            },
            rawAction: { action: { name: 'click', selector: 'internal:role=combobox[name="* WAN口"i]' } },
            sourceCode: `await page.getByRole("combobox", { name: "* WAN口" }).click();`,
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            kind: 'recorded',
            sourceActionIds: ['a002'],
            action: 'click',
            target: {
              role: 'option',
              text: '选择一个WAN口',
              displayName: '选择一个WAN口',
            },
            context: {
              eventId: 'ctx-placeholder-option',
              capturedAt: 1050,
              before: {
                form: { label: 'WAN口', name: 'wan' },
                dialog: { type: 'dropdown', visible: true },
                target: {
                  tag: 'div',
                  role: 'option',
                  title: '选择一个WAN口',
                  text: '选择一个WAN口',
                  normalizedText: '选择一个WAN口',
                  framework: 'antd',
                  controlType: 'select-option',
                },
              },
            },
            rawAction: { action: { name: 'click', selector: 'internal:role=option[name="选择一个WAN口"i]' } },
            sourceCode: `await page.getByRole("option", { name: "选择一个WAN口" }).click();`,
            assertions: [],
          },
          {
            id: 's003',
            order: 3,
            kind: 'recorded',
            sourceActionIds: ['a002', 'a003', 'a004'],
            action: 'select',
            target: {
              role: 'combobox',
              label: 'WAN口',
              name: 'WAN口',
              displayName: 'WAN口',
              testId: 'ipv4-address-pool-form',
              scope: { form: { label: 'WAN口', name: 'wan' } },
            },
            value: 'xtest16:WAN1',
            context: {
              eventId: 'ctx-wan-option',
              capturedAt: 1100,
              before: {
                form: { label: 'WAN口', name: 'wan' },
                dialog: { type: 'dropdown', visible: true },
                target: {
                  tag: 'div',
                  role: 'option',
                  title: 'xtest16:WAN1',
                  text: 'xtest16:WAN1',
                  normalizedText: 'xtest16:WAN1',
                  framework: 'antd',
                  controlType: 'select-option',
                },
              },
            },
            uiRecipe: {
              kind: 'select-option',
              library: 'antd',
              component: 'Select',
              fieldKind: 'select',
              fieldLabel: 'WAN口',
              fieldName: 'wan',
              optionText: 'xtest16:WAN1',
            },
            rawAction: {
              name: 'select',
              transactionId: 'select-wan',
              searchText: 'xtest16',
              selectedText: 'xtest16:WAN1',
            },
            sourceCode: [
              `await page.locator(".ant-form-item").filter({ hasText: "WAN口" }).locator(".ant-select-selector, .ant-cascader-picker, .ant-select").first().click();`,
              `await page.locator(".ant-form-item").filter({ hasText: "WAN口" }).locator("input:visible").first().fill("xtest16");`,
              `await page.locator(".ant-select-dropdown:visible, .ant-cascader-dropdown:visible").last().locator(".ant-select-item-option, .ant-cascader-menu-item, .ant-select-tree-treenode, .ant-select-tree-node-content-wrapper").filter({ hasText: "xtest16:WAN1" }).first().click();`,
            ].join('\n'),
            assertions: [],
          },
        ],
      };

      const code = generateBusinessFlowPlaywrightCode(flow);
      const playback = generateBusinessFlowPlaybackCode(flow);

      assert(!code.includes('// s001 '), 'non-adjacent redundant combobox focus click should be omitted from exported generated code');
      assert(!code.includes('// s002 '), 'interleaved placeholder option step should be omitted from exported generated code');
      assert(!/getByRole\(["']combobox["'],\s*\{\s*name:\s*["']\*? ?WAN口["']/.test(code), 'exported replay should not keep the brittle required combobox focus click');
      assert(code.includes('// s003 选择: WAN口'), 'projected select transaction should still be emitted');
      assert(code.includes('.locator(".ant-select-selector, .ant-cascader-picker, .ant-select").first()'), 'projected select transaction should open the concrete AntD trigger inside the scoped field');
      assert(code.includes('xtest16:WAN1'), 'projected select transaction should still select the intended WAN option');
      assert(!playback.includes('// s001 '), 'non-adjacent redundant combobox focus click should be omitted from parser-safe runtime playback');
      assert(!playback.includes('// s002 '), 'interleaved placeholder option step should be omitted from parser-safe runtime playback');
      assert(!/getByRole\(["']combobox["'],\s*\{\s*name:\s*["']\*? ?WAN口["']/.test(playback), 'parser-safe runtime playback should not keep the brittle required combobox focus click');
      assert(playback.includes('// s003 选择: WAN口'), 'parser-safe runtime playback should still emit the projected select transaction');
      assert(playback.includes('.locator(".ant-select-selector, .ant-cascader-picker")'), 'parser-safe runtime playback should open the concrete AntD trigger inside the scoped field');
      assert(!playback.includes('.locator(".ant-select-selector, .ant-cascader-picker, .ant-select")'), 'parser-safe runtime playback should avoid a multi-match selector that includes both AntD root and selector');
      assertEqual(countBusinessFlowPlaybackActions(flow), runnableLineCount(playback));

      const repeatFlow: BusinessFlow = {
        ...flow,
        repeatSegments: [{
          id: 'repeat-wan',
          name: '批量选择WAN口',
          stepIds: ['s001', 's002', 's003'],
          parameters: [],
          rows: [{ id: 'row-1', values: {} }],
          createdAt: flow.createdAt,
          updatedAt: flow.updatedAt,
        }],
      };
      const repeatPlayback = generateBusinessFlowPlaybackCode(repeatFlow);
      assert(!repeatPlayback.includes('// s001 '), 'repeat parser-safe runtime playback should also omit the non-adjacent redundant combobox focus click');
      assert(!repeatPlayback.includes('// s002 '), 'repeat parser-safe runtime playback should omit the interleaved placeholder option step');
      assert(repeatPlayback.includes('// s003 选择: WAN口'), 'repeat parser-safe runtime playback should keep the projected select transaction');
      assertEqual(countBusinessFlowPlaybackActions(repeatFlow), runnableLineCount(repeatPlayback));
    },
  },
  {
    name: 'parser-safe runtime bridge does not globally heal text-only non-popup clicks',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's-text-only-click',
            order: 1,
            kind: 'recorded',
            action: 'click',
            target: { text: '保存' },
            assertions: [],
          },
        ],
      };
      const playback = generateBusinessFlowPlaybackCode(flow);

      assert(!playback.includes('getByText("保存")') && !playback.includes("getByText('保存')"), 'parser-safe runtime playback must not heal non-popup clicks through global text fallback');
      assertEqual(countBusinessFlowPlaybackActions(flow), runnableLineCount(playback));
    },
  },
  {
    name: 'page select transaction projects trigger search option into one select step',
    run: () => {
      const flow = mergePageContextIntoFlow(createNamedFlow(), [
        pageSelectTriggerEvent('ctx-project-trigger', 1000, 'WAN口'),
        pageSelectSearchEvent('ctx-project-search', 1050, 'WAN口', 'wan'),
        pageSelectOptionEvent('ctx-project-option', 1100, 'WAN口', 'WAN1'),
      ]);
      const code = generateBusinessFlowPlaywrightCode(flow);
      const playback = generateBusinessFlowPlaybackCode(flow);

      assertEqual(flow.steps.length, 1);
      assertEqual(flow.steps[0].action, 'select');
      assertEqual(flow.steps[0].value, 'WAN1');
      assertEqual(flow.steps[0].target?.label, 'WAN口');
      assertEqual(flow.steps[0].uiRecipe?.kind, 'select-option');
      assertTextInOrder(code, [/WAN口/, /wan/, /WAN1/]);
      assert(code.includes('selectOwnedOption(false)'), 'projected select transaction should use trigger-owned option replay');
      assert(code.includes('const expectedText = "WAN1";'), 'projected select transaction should pin the selected option text');
      assert(code.includes('querySelectorAll(".ant-select-item-option")'), 'select option code should target option rows, not nested text nodes');
      assert(!code.includes('.ant-select-dropdown:visible, .ant-cascader-dropdown:visible'), 'projected select transaction should not replay through a broad visible dropdown');
      assert(!code.includes('.getByText("WAN1", { exact: true })'), 'select option code should avoid getByText strict-mode duplicates inside AntD option rows');
      assertTextInOrder(playback, [/WAN口/, /WAN1/]);
    },
  },
  {
    name: 'recorded select trigger search option are replaced by one select step',
    run: () => {
      const recorded = mergeActionsIntoFlow(createNamedFlow(), [
        selectTriggerAction('WAN口', 1000),
        selectSearchFillAction('WAN口', 'wan', 1050),
        selectOptionAction('WAN1', 1100),
      ], recordedSource([
        `await page.getByRole('combobox', { name: 'WAN口' }).click();`,
        `await page.getByRole('combobox', { name: 'WAN口' }).fill('wan');`,
        `await page.getByRole('option', { name: 'WAN1' }).click();`,
      ]), {});
      const firstLowLevelStepId = recorded.steps[0].id;
      const merged = mergePageContextIntoFlow(recorded, [
        pageSelectTriggerEvent('ctx-recorded-select-trigger', 1000, 'WAN口'),
        pageSelectSearchEvent('ctx-recorded-select-search', 1050, 'WAN口', 'wan'),
        pageSelectOptionEvent('ctx-recorded-select-option', 1100, 'WAN口', 'WAN1'),
      ]);
      const code = generateBusinessFlowPlaywrightCode(merged);

      assertEqual(merged.steps.map(step => step.action), ['select']);
      assertEqual(merged.steps[0].id, firstLowLevelStepId);
      assertEqual(merged.steps[0].value, 'WAN1');
      assert((merged.steps[0].sourceActionIds?.length ?? 0) >= 3, 'select step should preserve low-level recorder sourceActionIds');
      assertEqual(merged.steps.filter(step => step.action === 'fill' && step.value === 'wan').length, 0);
      assert(code.includes('const searchText = "wan";'), 'select replay should preserve the transaction search text inside the owned helper');
      assert(code.includes('.fill(searchText);'), 'select replay should search through the trigger-owned input');
      assert(!code.includes('const selectField_'), 'select code must stay parser-safe for in-panel runtime playback');
    },
  },
  {
    name: 'unclassified recorder option action does not close an open page-context select transaction',
    run: () => {
      const recorded = mergeActionsIntoFlow(createNamedFlow(), [
        {
          ...rawClickAction('internal:attr=[title="WAN1"] >> div'),
          wallTime: 1075,
        },
      ], recordedSource([
        `await page.getByTitle('WAN1').locator('div').click();`,
      ]), {});
      const merged = mergePageContextIntoFlow(recorded, [
        pageSelectTriggerEvent('ctx-unclassified-select-trigger', 1000, 'WAN口'),
        pageSelectSearchEvent('ctx-unclassified-select-search', 1050, 'WAN口', 'wan'),
        pageSelectOptionEvent('ctx-unclassified-select-option', 1100, 'WAN口', 'WAN1'),
      ]);
      const selectSteps = merged.steps.filter(step => step.action === 'select');

      assertEqual(merged.steps.map(step => step.action), ['select']);
      assertEqual(selectSteps.length, 1);
      assertEqual(selectSteps[0].value, 'WAN1');
      assertEqual(merged.steps.filter(step => step.action === 'fill' && step.value === 'wan').length, 0);
    },
  },
  {
    name: 'delayed page-context select transaction replaces earlier recorder trigger and search steps',
    run: () => {
      const recorded = mergeActionsIntoFlow(createNamedFlow(), [
        selectTriggerAction('WAN口', 1000),
        selectSearchFillAction('WAN口', 'wan', 1050),
      ], recordedSource([
        `await page.getByRole('combobox', { name: '* WAN口' }).click();`,
        `await page.locator('.ant-form-item').filter({ hasText: 'WAN口' }).locator('.ant-select-selector').first().locator('input:visible').first().fill('wan');`,
      ]), {});
      const firstLowLevelStepId = recorded.steps[0].id;
      const merged = mergePageContextIntoFlow(recorded, [
        pageSelectTriggerEvent('ctx-delayed-trigger', 1700, 'WAN口'),
        pageSelectSearchEvent('ctx-delayed-search', 1750, 'WAN口', 'wan'),
        pageSelectOptionEvent('ctx-delayed-option', 1850, 'WAN口', 'WAN1'),
      ]);
      const code = generateBusinessFlowPlaywrightCode(merged);

      assertEqual(merged.steps.map(step => step.action), ['select']);
      assertEqual(merged.steps[0].id, firstLowLevelStepId);
      assertEqual(merged.steps[0].value, 'WAN1');
      assert(code.includes('const searchText = "wan";'), 'delayed select transaction should preserve the recorded search text inside the owned helper');
      assert(code.includes('.fill(searchText);'), 'delayed select transaction should search through the trigger-owned input');
    },
  },
  {
    name: 'projected AntD select infers colon-prefix search text when explicit search evidence is missing',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          action: 'select',
          target: { label: 'WAN口', name: 'WAN口', scope: { form: { label: 'WAN口' } } },
          value: 'xtest16:WAN1',
          context: {
            eventId: 'ctx-wan-select',
            capturedAt: 1000,
            before: {
              form: { label: 'WAN口' },
              target: {
                role: 'option',
                text: 'xtest16:WAN1',
                selectedOption: 'xtest16:WAN1',
                normalizedText: 'xtest16:WAN1',
                framework: 'antd',
                controlType: 'select-option',
              },
            },
          },
          uiRecipe: {
            kind: 'select-option',
            library: 'antd',
            component: 'Select',
            fieldKind: 'select',
            fieldLabel: 'WAN口',
            optionText: 'xtest16:WAN1',
          },
          rawAction: {
            name: 'select',
            selectedText: 'xtest16:WAN1',
          },
          assertions: [],
        }],
      };

      const code = generateBusinessFlowPlaywrightCode(flow);
      const playback = generateBusinessFlowPlaybackCode(flow);

      assert(code.includes('const searchText = "xtest16";'), 'exported owned select replay should infer the stable search prefix from colon-delimited option text');
      assert(code.includes('.fill(searchText);'), 'exported owned select replay should use the inferred search prefix before dispatching');
      assert(playback.includes('.locator("input:visible").fill("xtest16");'), 'parser-safe replay should keep the inferred search prefix as a flat fill action');
      assertEqual(countBusinessFlowPlaybackActions(flow), runnableLineCount(playback));
    },
  },
  {
    name: 'select option ignores object-like option path and replays by selected text',
    run: () => {
      const flow = mergePageContextIntoFlow(createNamedFlow(), [
        pageSelectTriggerEvent('ctx-object-path-trigger', 1000, 'IP地址池'),
        pageSelectOptionEvent('ctx-object-path-option', 1100, 'IP地址池', 'test1 1.1.1.1--2.2.2.2 共享', 'select-option', ['[object Object]']),
      ]);
      const code = generateBusinessFlowPlaywrightCode(flow);

      assert(!code.includes('[object Object]'), 'select option replay must not use object-like optionPath text');
      assert(!code.includes('.fill("test1")'), 'select option replay should not infer a search fill for ReactNode/object-valued options');
      assert(code.includes('selectOwnedOption(false)'), 'select option replay should use the trigger-owned dropdown helper');
      assert(code.includes('const expectedText = "test1 1.1.1.1--2.2.2.2 共享";'), 'select option replay should preserve the selected option text in the owned helper');
      assert(!code.includes('.ant-select-dropdown:visible, .ant-cascader-dropdown:visible'), 'select option replay should not fall back to a broad visible dropdown');
      assert(code.includes('test1 1.1.1.1--2.2.2.2 共享'), 'select option replay should preserve selected text in the business step');
    },
  },
  {
    name: 'page select transaction stays after untimed navigation and opener steps',
    run: () => {
      const flow = mergeActionsIntoFlow(createNamedFlow(), [
        navigateAction('http://127.0.0.1:3107/antd-pro-form-fields.html'),
        testIdClickAction('network-resource-add'),
      ], [], {});
      const merged = mergePageContextIntoFlow(flow, [
        pageSelectTriggerEvent('ctx-vrf-trigger-after-open', 1000, '关联VRF'),
        pageSelectOptionEvent('ctx-vrf-option-after-open', 1100, '关联VRF', '生产VRF'),
      ]);
      const code = generateBusinessFlowPlaywrightCode(merged);

      assertEqual(merged.steps.map(step => step.action), ['navigate', 'click', 'select']);
      assertTextInOrder(code, [/page\.goto/, /network-resource-add/, /生产VRF/]);
    },
  },
  {
    name: 'page input transaction projects consecutive input events into one fill step',
    run: () => {
      const flow = mergePageContextIntoFlow(createNamedFlow(), [
        pageInputEvent('ctx-input-name-1', 1000, '地址池名称', 'p'),
        pageInputEvent('ctx-input-name-2', 1050, '地址池名称', 'po'),
        pageInputEvent('ctx-input-name-3', 1100, '地址池名称', 'pool'),
      ]);

      assertEqual(flow.steps.length, 1);
      assertEqual(flow.steps[0].action, 'fill');
      assertEqual(flow.steps[0].value, 'pool');
      assertEqual(flow.steps[0].target?.label, '地址池名称');
      assertEqual(flow.steps[0].context?.eventId, 'ctx-input-name-3');
      assertEqual(flow.artifacts?.recorder?.eventJournal?.highWaterMarks.pageContextEventCount, 3);
    },
  },
  {
    name: 'recorder fill plus page input transaction keeps final page value',
    run: () => {
      const flow = mergeActionsIntoFlow(createNamedFlow(), [
        fillActionWithWallTime('地址池名称', 'po', 1000),
      ], [], {});
      const merged = mergePageContextIntoFlow(flow, [
        pageInputEvent('ctx-input-name-final', 1100, '地址池名称', 'pool'),
      ]);
      const code = generateBusinessFlowPlaywrightCode(merged);

      assertEqual(merged.steps.length, 1);
      assertEqual(merged.steps[0].id, 's001');
      assertEqual(merged.steps[0].action, 'fill');
      assertEqual(merged.steps[0].value, 'pool');
      assertEqual(merged.steps[0].assertions[0]?.expected, 'pool');
      assert(/\.fill\((['"])pool\1\)/.test(code), `generated code should use final input transaction value\n${code}`);
      assertEqual(merged.steps[0].sourceActionIds?.length, 1);
    },
  },
  {
    name: 'page input transaction without captured value does not emit an empty fill',
    run: () => {
      const flow = mergeActionsIntoFlow(createNamedFlow(), [
        fillActionWithWallTime('地址池名称', 'pool', 1000),
      ], [], {});
      const merged = mergePageContextIntoFlow(flow, [
        pageFieldEvent('ctx-input-no-value', 'input', 1050, '地址池名称'),
        pageFieldEvent('ctx-change-no-value', 'change', 1100, '地址池名称'),
      ]);
      const code = generateBusinessFlowPlaywrightCode(merged);

      assertEqual(merged.steps.length, 1);
      assertEqual(merged.steps[0].value, 'pool');
      assert(/\.fill\((['"])pool\1\)/.test(code), `generated code should keep recorder value\n${code}`);
      assert(!/\.fill\((['"])\1\)/.test(code), `generated code should not add an empty page-context fill\n${code}`);
      assertEqual(merged.artifacts?.recorder?.eventJournal?.highWaterMarks.pageContextEventCount, 2);
    },
  },
  {
    name: 'page input transaction inserts page-only fill before later recorded click',
    run: () => {
      const flow = mergeActionsIntoFlow(createNamedFlow(), [
        clickActionWithWallTime('保存', 2000),
      ], [], {});
      const merged = mergePageContextIntoFlow(flow, [
        pageInputEvent('ctx-input-before-save', 1000, '地址池名称', 'pool'),
      ]);
      const code = generateBusinessFlowPlaywrightCode(merged);

      assertEqual(merged.steps.map(step => step.action), ['fill', 'click']);
      assertEqual(merged.steps[0].value, 'pool');
      assertTextInOrder(code, [/\.fill\((['"])pool\1\)/, /\.click\(/]);
    },
  },
  {
    name: 'input transaction preserves scoped recorder fill source when page value finalizes',
    run: () => {
      const scopedSource = `await page.locator(".ant-modal, .ant-drawer, [role=\\"dialog\\"]").filter({ hasText: "新建IPv4地址池" }).getByLabel("地址池名称").fill("po");`;
      const flow = mergeActionsIntoFlow(createNamedFlow(), [
        fillActionWithWallTime('地址池名称', 'po', 1000),
      ], recordedSource([scopedSource]), {});
      const merged = mergePageContextIntoFlow(flow, [
        pageDialogInputEvent('ctx-input-name-final-dialog', 1100, '地址池名称', 'pool', '新建IPv4地址池'),
      ]);
      const code = generateBusinessFlowPlaywrightCode(merged);

      assertEqual(merged.steps.length, 1);
      assertEqual(merged.steps[0].value, 'pool');
      assert(merged.steps[0].sourceCode?.includes('新建IPv4地址池'), 'stored fill source should keep dialog scope');
      assert(/\.fill\((['"])pool\1\)/.test(merged.steps[0].sourceCode || ''), 'stored fill source should only update the final value');
      assert(code.includes('新建IPv4地址池'), `generated code should keep dialog-scoped locator\n${code}`);
      assert(/\.fill\((['"])pool\1\)/.test(code), `generated code should use final transaction value\n${code}`);
    },
  },
  {
    name: 'non-contiguous edits of the same field remain separate fill steps',
    run: () => {
      const flow = mergeActionsIntoFlow(createNamedFlow(), [
        clickActionWithWallTime('查询', 1100),
        clickActionWithWallTime('保存', 1300),
      ], [], {});
      const merged = mergePageContextIntoFlow(flow, [
        pageInputEvent('ctx-name-alice', 1000, '用户名', 'alice'),
        pageInputEvent('ctx-name-bob', 1200, '用户名', 'bob'),
      ]);
      const code = generateBusinessFlowPlaywrightCode(merged);

      assertEqual(merged.steps.map(step => `${step.action}:${step.value || step.target?.text || step.target?.name || step.target?.displayName}`), [
        'fill:alice',
        'click:查询',
        'fill:bob',
        'click:保存',
      ]);
      assertTextInOrder(code, [
        /\.fill\((['"])alice\1\)/,
        /查询|\.click\(/,
        /\.fill\((['"])bob\1\)/,
        /保存|\.click\(/,
      ]);
    },
  },
  {
    name: 'starting input on another field commits the previous open transaction',
    run: () => {
      const composition = composeInputTransactionsFromJournal(journalFromPageEvents([
        pageInputEvent('ctx-user-alice', 1000, '用户名', 'alice'),
        pageInputEvent('ctx-email-a', 1100, '邮箱', 'a@example.com'),
      ]), { commitOpen: false });

      assertEqual(composition.inputTransactions.length, 1);
      assertEqual(composition.inputTransactions[0].field.label, '用户名');
      assertEqual(composition.inputTransactions[0].finalValue, 'alice');
      assertEqual(composition.inputTransactions[0].commitReason, 'next-action');
      assertEqual(composition.openInputTransactions.length, 1);
      assertEqual(composition.openInputTransactions[0].field.label, '邮箱');
      assertEqual(composition.openInputTransactions[0].finalValue, 'a@example.com');
    },
  },
  {
    name: 'non-input page event commits all open input transactions',
    run: () => {
      const composition = composeInputTransactionsFromJournal(journalFromPageEvents([
        pageInputEvent('ctx-user-alice', 1000, '用户名', 'alice'),
        pageInputEvent('ctx-email-a', 1100, '邮箱', 'a@example.com'),
        pageClickEvent('ctx-search-after-fields', 1200, '查询'),
      ]), { commitOpen: false });

      assertEqual(composition.inputTransactions.map(transaction => transaction.field.label), ['用户名', '邮箱']);
      assertEqual(composition.inputTransactions.map(transaction => transaction.commitReason), ['next-action', 'next-action']);
      assertEqual(composition.openInputTransactions.length, 0);
    },
  },
  {
    name: 'input focus click context with ProComponents metadata upgrades weak recorder fill target',
    run: () => {
      const flow = issue60RangeInputFlow();
      const step = flow.steps.find(step => step.action === 'fill' && step.value === '1.1.1.1');

      assert(step, 'projected fill step should exist');
      assertEqual(step?.target?.testId, 'site-ip-address-pool-range-field');
      assertEqual(step?.target?.placeholder, '开始地址，例如：192.168.1.1');
      assertEqual(step?.target?.name, 'pool.start');
      assert(!JSON.stringify(step?.target).includes('internal:role=textbox[name="开始地址，例如："i]'), 'weak recorder selector must not be the field identity');
    },
  },
  {
    name: 'pending input focus is cleared by non-input next-action boundaries before weak fill',
    run: () => {
      const staleFocus = proComponentsRangeInputFocusEvent('ctx-range-start-focus', 1000, {
        testId: 'site-ip-address-pool-range-field',
        label: '开始地址，例如：192.168.1.1',
        placeholder: '开始地址，例如：192.168.1.1',
        fieldName: 'pool.start',
      });
      const weakFill = weakTextboxFillAction('开始地址，例如：', '1.1.1.1', 1300);
      const cases = [
        {
          name: 'page-context non-input click',
          actions: [weakFill],
          pageEvents: [staleFocus, pageClickEvent('ctx-search-after-focus', 1100, '查询')],
        },
        {
          name: 'page-context select trigger',
          actions: [weakFill],
          pageEvents: [staleFocus, pageSelectTriggerEvent('ctx-vrf-select-after-focus', 1100, '关联VRF')],
        },
        {
          name: 'recorder select-like action',
          actions: [selectSearchFillAction('关联VRF', 'default', 1100), weakFill],
          pageEvents: [staleFocus],
        },
      ];

      for (const testCase of cases) {
        const withRecorder = mergeActionsIntoFlow(createNamedFlow(), testCase.actions, [], {});
        const flow = mergePageContextIntoFlow(withRecorder, testCase.pageEvents);
        const composition = composeInputTransactionsFromJournal(flow.artifacts?.recorder?.eventJournal, { commitOpen: true });
        const transaction = composition.inputTransactions.find(transaction => transaction.finalValue === '1.1.1.1');

        assert(transaction, `${testCase.name}: weak fill should still become an input transaction`);
        assertEqual(transaction?.targetKey, 'label:开始地址，例如：');
        assert(!transaction?.contextEventId, `${testCase.name}: stale focus event should not be attached to the later weak fill`);
        assert(!JSON.stringify(transaction).includes('site-ip-address-pool-range-field'), `${testCase.name}: stale wrapper field identity should not be inherited`);
      }
    },
  },
  {
    name: 'ProComponents range inputs sharing wrapper test id stay separate by field identity',
    run: () => {
      const withRecorder = mergeActionsIntoFlow(createNamedFlow(), [
        weakTextboxFillAction('开始地址，例如：', '1.1.1.1', 1200),
        weakTextboxFillAction('结束地址，例如：', '1.1.1.10', 1500),
      ], recordedSource([
        `await page.getByRole('textbox', { name: '开始地址，例如：' }).fill('1.1.1.1');`,
        `await page.getByRole('textbox', { name: '结束地址，例如：' }).fill('1.1.1.10');`,
      ]), {});
      const flow = mergePageContextIntoFlow(withRecorder, [
        proComponentsRangeInputFocusEvent('ctx-range-start-focus', 1000, {
          testId: 'site-ip-address-pool-range-field',
          label: '开始地址，例如：192.168.1.1',
          placeholder: '开始地址，例如：192.168.1.1',
          fieldName: 'pool.start',
        }),
        proComponentsRangeInputFocusEvent('ctx-range-end-focus', 1300, {
          testId: 'site-ip-address-pool-range-field',
          label: '结束地址，例如：192.168.1.254',
          placeholder: '结束地址，例如：192.168.1.254',
          fieldName: 'pool.end',
        }),
      ]);

      const fills = flow.steps.filter(step => step.action === 'fill');
      assertEqual(fills.length, 2);
      assertEqual(fills.map(step => step.value), ['1.1.1.1', '1.1.1.10']);
      assertEqual(fills.map(step => step.target?.name), ['pool.start', 'pool.end']);
      assertEqual(fills.map(step => step.target?.placeholder), ['开始地址，例如：192.168.1.1', '结束地址，例如：192.168.1.254']);
      const composition = composeInputTransactionsFromJournal(flow.artifacts?.recorder?.eventJournal, { commitOpen: true });
      const targetKeys = composition.inputTransactions.map(transaction => transaction.targetKey).filter(key => key.includes('site-ip-address-pool-range-field'));
      assertEqual(targetKeys.length, 2);
      assert(targetKeys.some(key => key.includes('|name:pool.start')), 'start range input target key should include fieldName');
      assert(targetKeys.some(key => key.includes('|name:pool.end')), 'end range input target key should include fieldName');
      assertEqual(new Set(targetKeys).size, 2);
    },
  },
  {
    name: 'input target merge preserves top-level page context evidence',
    run: () => {
      const composition = composeInputTransactionsFromJournal(journalFromPageEvents([
        proComponentsRangeInputEvent('ctx-range-start-input-1', 1000, {
          testId: 'site-ip-address-pool-range-field',
          label: '开始地址，例如：192.168.1.1',
          placeholder: '开始地址，例如：192.168.1.1',
          fieldName: 'pool.start',
        }, '1'),
        proComponentsRangeInputEvent('ctx-range-start-input-2', 1050, {
          testId: 'site-ip-address-pool-range-field',
          label: '开始地址，例如：192.168.1.1',
          placeholder: '开始地址，例如：192.168.1.1',
          fieldName: 'pool.start',
        }, '1.1'),
      ]), { commitOpen: true });

      const raw = composition.inputTransactions[0]?.target?.raw as any;
      assert(raw?.pageContext, 'merged input target raw should keep top-level pageContext evidence');
      assertEqual(raw.pageContext.ui?.form?.name, 'pool.start');
      assertEqual(composition.inputTransactions[0]?.finalValue, '1.1');
    },
  },
  {
    name: 'exported replay uses wrapper test id plus full placeholder for ProComponents range fill',
    run: () => {
      const code = generateBusinessFlowPlaywrightCode(issue60RangeInputFlow());

      assert(code.includes('page.getByTestId("site-ip-address-pool-range-field").getByPlaceholder("开始地址，例如：192.168.1.1").fill("1.1.1.1")'), 'exported code should use stable wrapper test id plus full placeholder');
      assert(!code.includes('getByLabel("开始地址，例如：")'), 'exported code must not downgrade to truncated label');
    },
  },
  {
    name: 'parser-safe replay does not emit truncated internal label for ProComponents range fill',
    run: () => {
      const playback = generateBusinessFlowPlaybackCode(issue60RangeInputFlow());

      assert(playback.includes('page.getByTestId("site-ip-address-pool-range-field").getByPlaceholder("开始地址，例如：192.168.1.1").fill("1.1.1.1")'), 'parser-safe replay should keep stable field context');
      assert(!playback.includes('internal:label="开始地址，例如："'), 'parser-safe replay must not emit the weak truncated internal label');
      assert(!playback.includes('getByLabel("开始地址，例如：")'), 'parser-safe replay must not use truncated label fallback when stronger context exists');
    },
  },
  {
    name: 'ordinary label-only input fill keeps label fallback without stronger field context',
    run: () => {
      const flow = mergeActionsIntoFlow(undefined, [
        fillAction('地址池名称', 'pool-a'),
      ], [], {});
      const code = generateBusinessFlowPlaywrightCode(flow);

      assert(code.includes('page.getByLabel("地址池名称").fill("pool-a")'), 'ordinary label-only input should keep label fallback');
    },
  },
  {
    name: 'input transaction ignores single-character press and Tab without creating business steps',
    run: () => {
      const flow = mergePageContextIntoFlow(createNamedFlow(), [
        pageKeydownEvent('ctx-input-name-a', 1000, '地址池名称', 'a'),
        pageKeydownEvent('ctx-input-name-tab', 1050, '地址池名称', 'Tab'),
      ]);

      assertEqual(flow.steps.length, 0);
      assertEqual(flow.artifacts?.recorder?.eventJournal?.highWaterMarks.pageContextEventCount, 2);
    },
  },
  {
    name: 'typing-like fills and key presses compact into one business step',
    run: () => {
      const flow = mergeActionsIntoFlow(undefined, [
        fillAction('地址池名称', 'p'),
        fillAction('地址池名称', 'po'),
        fillAction('地址池名称', 'pool'),
        pressAction('地址池名称', 'Shift'),
      ], [], {});

      assertEqual(flow.steps.length, 1);
      assertEqual(flow.steps[0].id, 's001');
      assertEqual(flow.steps[0].action, 'fill');
      assertEqual(flow.steps[0].value, 'pool');
      assertEqual(flow.steps[0].sourceActionIds?.length, 4);
      assertEqual(flow.artifacts?.recorder?.actionLog.length, 4);
      assertEqual(flow.steps[0].assertions[0]?.expected, 'pool');
    },
  },
  {
    name: 'code preview omits intermediate prefix fills on the same field',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            action: 'fill',
            value: '2.2.',
            target: { label: '结束地址，例如：192.168.1.254', displayName: '* 结束地址，例如：' },
            context: { eventId: 'ctx-end-prefix', capturedAt: 1000, before: { form: { label: '结束地址，例如：192.168.1.254', testId: 'ipv4-address-pool-form' } } },
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            action: 'fill',
            value: '2.2.2.2',
            target: { label: '结束地址，例如：192.168.1.254', displayName: '* 结束地址，例如：' },
            context: { eventId: 'ctx-end-final', capturedAt: 1100, before: { form: { label: '结束地址，例如：192.168.1.254', testId: 'ipv4-address-pool-form' } } },
            assertions: [],
          },
        ],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      const playbackCode = generateBusinessFlowPlaybackCode(flow);

      assert(!code.includes('.fill("2.2.");'), 'exported code should not replay a prefix value that is superseded by a final same-field fill');
      assert(code.includes('.fill("2.2.2.2");'), 'exported code should keep the final fill value');
      assert(!playbackCode.includes('.fill("2.2.");'), 'runtime playback should also omit superseded prefix fills');
      assert(playbackCode.includes('.fill("2.2.2.2");'), 'runtime playback should keep the final fill value');
    },
  },
  {
    name: 'code preview omits placeholder select option clicks before the real option',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            action: 'click',
            target: { role: 'option', text: '选择一个VRF', displayName: 'option 选择一个VRF' },
            rawAction: { name: 'click' } as any,
            sourceCode: 'await page.locator(".ant-select-dropdown:visible >> .ant-select-item-option >> internal:has-text=\\"选择一个VRF\\"i").click();',
            context: {
              eventId: 'ctx-vrf-placeholder',
              capturedAt: 1000,
              before: {
                form: { label: '关联VRF' },
                target: { role: 'option' as any, text: '选择一个VRF', normalizedText: '选择一个VRF', optionPath: ['选择一个VRF'] },
                dialog: { type: 'modal', title: '新建IP端口地址池', visible: true },
              },
            },
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            action: 'click',
            target: { role: 'option', text: 'default', displayName: 'default' },
            rawAction: { name: 'click', selector: '.ant-select-dropdown:visible >> .ant-select-item-option >> internal:has-text="default"i' } as any,
            context: {
              eventId: 'ctx-vrf-default',
              capturedAt: 1100,
              before: {
                form: { label: '关联VRF' },
                target: { role: 'option' as any, text: 'default', normalizedText: 'default', optionPath: ['default'] },
                dialog: { type: 'modal', title: '新建IP端口地址池', visible: true },
              },
            },
            assertions: [],
          },
        ],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      const playbackCode = generateBusinessFlowPlaybackCode(flow);

      for (const generated of [code, playbackCode]) {
        assert(!generated.includes('选择一个VRF'), 'placeholder option text should not be emitted as a replay click');
        assert(generated.includes('default'), 'real selected option should still be emitted');
      }
      const repeatFlow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            action: 'click',
            target: { role: 'option', text: 'default', displayName: 'default' },
            rawAction: { name: 'click' } as any,
            sourceCode: 'await page.locator(".ant-select-dropdown:visible >> .ant-select-item-option >> internal:has-text=\\"default\\"i").click();',
            context: { eventId: 'ctx-vrf-default-repeat', capturedAt: 1200, before: { form: { label: '关联VRF' }, target: { role: 'option' as any, text: 'default', normalizedText: 'default', optionPath: ['default'] } } },
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            action: 'click',
            target: { role: 'option', text: 'default', displayName: 'default' },
            rawAction: { name: 'click', selector: '.ant-select-dropdown:visible >> .ant-select-item-option >> internal:has-text="default"i' } as any,
            context: { eventId: 'ctx-vrf-default-repeat-real', capturedAt: 1300, before: { form: { label: '关联VRF' }, target: { role: 'option' as any, text: 'default', normalizedText: 'default', optionPath: ['default'] } } },
            assertions: [],
          },
        ],
        repeatSegments: [{
          id: 'segment-vrf',
          name: 'VRF rows',
          stepIds: ['s001', 's002'],
          parameters: [{ id: 'param-vrf', variableName: 'vrf', label: 'VRF', sourceStepId: 's001', currentValue: 'default', enabled: true }],
          rows: [{ id: 'row-placeholder', values: { 'param-vrf': '选择一个VRF' } }],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }],
      };
      const repeatPlayback = generateBusinessFlowPlaybackCode(repeatFlow);
      assert(!repeatPlayback.includes('internal:has-text=\\"选择一个VRF\\"i'), 'placeholder produced only after repeat row parameterization should still be dropped');
      assert(!repeatPlayback.includes('选择一个VRF'), 'parameterized placeholder text should not leak into runtime playback');
    },
  },
  {
    name: 'placeholder select option replay drops the whole multiline dispatch block',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          action: 'click',
          target: { role: 'button', text: '选择一个WAN口', displayName: 'button 选择一个WAN口' },
          rawAction: { name: 'click', selector: 'internal:role=button[name="选择一个WAN口"i]' } as any,
          context: {
            eventId: 'ctx-wan-placeholder',
            capturedAt: 1000,
            before: {
              form: { label: 'WAN口' },
              target: { role: 'option' as any, framework: 'antd', controlType: 'select-option', text: '选择一个WAN口', normalizedText: '选择一个WAN口' },
              dialog: { type: 'dropdown', title: '选择一个WAN口', visible: true },
            },
          },
          assertions: [],
        }],
        repeatSegments: [{
          id: 'segment-wan',
          name: 'WAN rows',
          stepIds: ['s001'],
          parameters: [],
          rows: [{ id: 'row-1', values: {} }],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);

      assert(code.includes('skipped unsafe placeholder select option replay'), 'placeholder block should be represented as an explicit skipped step comment');
      assert(!code.includes('const normalize = (value)'), 'orphaned evaluateAll callback body must not be emitted');
      assert(!code.includes('expectedText'), 'orphaned evaluateAll argument references must not be emitted');
      assert(!code.includes('}, "选择一个WAN口");'), 'orphaned evaluateAll closing line must not be emitted');
    },
  },
  {
    name: 'page context matcher falls back to exact test id when table action timing is delayed',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            action: 'click',
            target: { testId: 'ha-wan-row-edit-action', displayName: 'WAN1 HS专线 HS Internet IPv4' },
            rawAction: { name: 'click', selector: 'internal:testid=[data-testid="ha-wan-row-edit-action"s]', wallTime: 10_000, endWallTime: 10_010 } as any,
            assertions: [],
          },
        ],
      };
      const merged = mergePageContextIntoFlow(flow, [{
        id: 'ctx-delayed-row-action',
        kind: 'click',
        time: 1000,
        wallTime: 13_500,
        before: {
          target: { testId: 'ha-wan-row-edit-action', role: 'button', text: 'WAN1 HS专线 HS Internet IPv4' },
          table: { testId: 'wan-config-table', rowKey: '1', rowIdentity: { stable: true } },
        },
      } as PageContextEvent]);

      assertEqual(merged.steps[0].target?.scope?.table?.testId, 'wan-config-table');
      assertEqual(merged.steps[0].target?.scope?.table?.rowKey, '1');
      assert(generateBusinessFlowPlaywrightCode(merged).includes('wan-config-table'), 'row-scoped code should survive delayed exact-testid page context');
    },
  },
  {
    name: 'same label fills in different dialogs stay as separate business steps',
    run: () => {
      const flow = mergeActionsIntoFlow(undefined, [
        fillAction('地址池名称', 'test1'),
        fillAction('地址池名称', 'test12'),
      ], recordedSource([
        `await page.locator(".ant-modal, .ant-drawer, [role=\\"dialog\\"]").filter({ hasText: "新建IPv4地址池" }).getByLabel("地址池名称").fill("test1");`,
        `await page.locator(".ant-modal, .ant-drawer, [role=\\"dialog\\"]").filter({ hasText: "新建IP端口地址池" }).getByLabel("地址池名称").fill("test12");`,
      ]), {});

      assertEqual(flow.steps.length, 2);
      assertEqual(flow.steps.map(step => step.value), ['test1', 'test12']);
      assert(flow.steps[0].sourceCode?.includes('新建IPv4地址池'), 'first dialog scope should be preserved');
      assert(flow.steps[1].sourceCode?.includes('新建IP端口地址池'), 'second dialog scope should be preserved');
    },
  },
  {
    name: 'recorder in-place fill updates refresh existing steps when action count is unchanged',
    run: () => {
      const firstPayload = mergeActionsIntoFlow(undefined, [
        fillAction('开始地址，例如：192.168.1.1', '1'),
        fillAction('结束地址，例如：192.168.1.254', '2'),
      ], [], {});
      const updatedPayload = mergeActionsIntoFlow(firstPayload, [
        fillAction('开始地址，例如：192.168.1.1', '1.1.1.1'),
        fillAction('结束地址，例如：192.168.1.254', '2.2.2.2'),
      ], [], {});

      assertEqual(updatedPayload.steps.map(step => step.id), ['s001', 's002']);
      assertEqual(updatedPayload.steps.map(step => step.value), ['1.1.1.1', '2.2.2.2']);
      assertEqual(updatedPayload.steps.map(step => step.assertions[0]?.expected), ['1.1.1.1', '2.2.2.2']);
      assertEqual(updatedPayload.artifacts?.recorder?.actionLog.length, 2);
    },
  },
  {
    name: 'in-place fill refresh preserves manually edited value assertions',
    run: () => {
      const firstPayload = mergeActionsIntoFlow(undefined, [
        fillAction('地址池名称', 'test'),
      ], [], {});
      const editedAssertion: BusinessFlow = {
        ...firstPayload,
        steps: firstPayload.steps.map(step => ({
          ...step,
          assertions: step.assertions.map(assertion => ({
            ...assertion,
            expected: '用户手工固定的断言',
            enabled: true,
          })),
        })),
      };
      const refreshed = mergeActionsIntoFlow(editedAssertion, [
        fillAction('地址池名称', 'test1'),
      ], [], {});

      assertEqual(refreshed.steps[0].value, 'test1');
      assertEqual(refreshed.steps[0].assertions[0]?.expected, '用户手工固定的断言');
      assertEqual(refreshed.steps[0].assertions[0]?.enabled, true);
    },
  },
  {
    name: 'in-place fill refresh updates source code without creating a new step',
    run: () => {
      const firstPayload = mergeActionsIntoFlow(undefined, [
        fillAction('开始地址，例如：192.168.1.1', '1'),
      ], recordedSource([`await page.getByLabel('开始地址').fill('1');`]), {});
      const refreshed = mergeActionsIntoFlow(firstPayload, [
        fillAction('开始地址，例如：192.168.1.1', '1.1.1.1'),
      ], recordedSource([`await page.getByLabel('开始地址').fill('1.1.1.1');`]), {});

      assertEqual(refreshed.steps.map(step => step.id), ['s001']);
      assertEqual(refreshed.steps[0].value, '1.1.1.1');
      assertEqual(refreshed.steps[0].sourceCode, `await page.getByLabel('开始地址').fill('1.1.1.1');`);
      assertEqual(refreshed.artifacts?.recorder?.actionLog.length, 1);
    },
  },
  {
    name: 'source text without actions still provides runnable step source code',
    run: () => {
      const flow = mergeActionsIntoFlow(undefined, [
        clickAction('新增IP端口池'),
        fillAction('地址池名称', 'testPort'),
      ], recordedSourceText(`
import { test } from '@playwright/test';
test('demo', async ({ page }) => {
  await page.getByTestId('site-ip-port-pool-create-button').click();
  await page.getByRole('textbox', { name: '地址池名称' }).fill('testPort');
});
`), {});

      assertEqual(flow.steps.length, 2);
      assertEqual(flow.steps[0].sourceCode, `await page.getByTestId('site-ip-port-pool-create-button').click();`);
      assertEqual(flow.steps[1].sourceCode, `await page.getByRole('textbox', { name: '地址池名称' }).fill('testPort');`);
    },
  },
  {
    name: 'raw actions generate runnable source code when recorder source is missing',
    run: () => {
      const flow = mergeActionsIntoFlow(undefined, [
        clickAction('新增IP端口池'),
        fillAction('地址池名称', 'testPort'),
      ], [], {});

      assertEqual(flow.steps.length, 2);
      assertEqual(flow.steps[0].sourceCode, `await page.getByRole('button', { name: '新增IP端口池' }).click();`);
      assertEqual(flow.steps[1].sourceCode, `await page.getByLabel('地址池名称').fill("testPort");`);
    },
  },
  {
    name: 'typing press from a later recorder payload merges into the previous fill step',
    run: () => {
      const firstPayload = mergeActionsIntoFlow(undefined, [
        clickAction('新建'),
        fillAction('地址池名称', 'test'),
      ], [], {});
      const withCapsLock = mergeActionsIntoFlow(firstPayload, [
        clickAction('新建'),
        fillAction('地址池名称', 'test'),
        pressAction('地址池名称', 'CapsLock'),
      ], [], {});
      const finalFill = mergeActionsIntoFlow(withCapsLock, [
        clickAction('新建'),
        fillAction('地址池名称', 'test'),
        pressAction('地址池名称', 'CapsLock'),
        fillAction('地址池名称', 'test1'),
      ], [], {});

      assertEqual(withCapsLock.steps.map(step => step.id), ['s001', 's002']);
      assertEqual(withCapsLock.steps[1].sourceActionIds?.length, 2);
      assertEqual(finalFill.steps.map(step => step.id), ['s001', 's002']);
      assertEqual(finalFill.steps[1].value, 'test1');
      assertEqual(finalFill.steps[1].sourceActionIds?.length, 3);
    },
  },
  {
    name: 'backspace and final fill across payloads keep only the final input value',
    run: () => {
      const firstPayload = mergeActionsIntoFlow(undefined, [
        fillAction('地址池名称', 'abc'),
      ], [], {});
      const withBackspace = mergeActionsIntoFlow(firstPayload, [
        fillAction('地址池名称', 'abc'),
        pressAction('地址池名称', 'Backspace'),
      ], [], {});
      const finalFill = mergeActionsIntoFlow(withBackspace, [
        fillAction('地址池名称', 'abc'),
        pressAction('地址池名称', 'Backspace'),
        fillAction('地址池名称', 'ab'),
      ], [], {});

      assertEqual(finalFill.steps.length, 1);
      assertEqual(finalFill.steps[0].value, 'ab');
      assertEqual(finalFill.steps[0].assertions[0]?.expected, 'ab');
      assertEqual(finalFill.steps[0].sourceActionIds?.length, 3);
    },
  },
  {
    name: 'single-character key presses on the same input are absorbed as typing noise',
    run: () => {
      const firstPayload = mergeActionsIntoFlow(undefined, [
        fillAction('地址池名称', 'tes'),
      ], [], {});
      const withKeyPress = mergeActionsIntoFlow(firstPayload, [
        fillAction('地址池名称', 'tes'),
        pressAction('地址池名称', 't'),
      ], [], {});
      const finalFill = mergeActionsIntoFlow(withKeyPress, [
        fillAction('地址池名称', 'tes'),
        pressAction('地址池名称', 't'),
        fillAction('地址池名称', 'test'),
      ], [], {});

      assertEqual(withKeyPress.steps.length, 1);
      assertEqual(finalFill.steps.length, 1);
      assertEqual(finalFill.steps[0].value, 'test');
      assertEqual(finalFill.steps[0].sourceActionIds?.length, 3);
    },
  },
  {
    name: 'navigation keys on the same input are absorbed but the final value remains authoritative',
    run: () => {
      const firstPayload = mergeActionsIntoFlow(undefined, [
        fillAction('开始地址', '1.1.1.1'),
      ], [], {});
      const withNavigationKeys = mergeActionsIntoFlow(firstPayload, [
        fillAction('开始地址', '1.1.1.1'),
        pressAction('开始地址', 'ArrowLeft'),
        pressAction('开始地址', 'ArrowRight'),
        pressAction('开始地址', 'Tab'),
      ], [], {});

      assertEqual(withNavigationKeys.steps.length, 1);
      assertEqual(withNavigationKeys.steps[0].value, '1.1.1.1');
      assertEqual(withNavigationKeys.steps[0].sourceActionIds?.length, 4);
    },
  },
  {
    name: 'space typing noise merges and keeps the final spaced value',
    run: () => {
      const firstPayload = mergeActionsIntoFlow(undefined, [
        fillAction('描述', 'hello'),
      ], [], {});
      const withSpace = mergeActionsIntoFlow(firstPayload, [
        fillAction('描述', 'hello'),
        pressAction('描述', 'Space'),
        fillAction('描述', 'hello world'),
      ], [], {});

      assertEqual(withSpace.steps.length, 1);
      assertEqual(withSpace.steps[0].value, 'hello world');
      assertEqual(withSpace.steps[0].assertions[0]?.expected, 'hello world');
    },
  },
  {
    name: 'typing noise on a different target is not merged into the previous fill',
    run: () => {
      const flow = mergeActionsIntoFlow(undefined, [
        fillAction('地址池名称', 'test'),
        pressAction('描述', 'CapsLock'),
      ], [], {});

      assertEqual(flow.steps.map(step => step.action), ['fill', 'press']);
      assertEqual(flow.steps.map(step => step.value), ['test', 'CapsLock']);
      assertEqual(flow.steps.map(step => step.id), ['s001', 's002']);
    },
  },
  {
    name: 'different input targets stay as separate business steps even when recorded in one batch',
    run: () => {
      const flow = mergeActionsIntoFlow(undefined, [
        fillAction('地址池名称', 'pool-a'),
        fillAction('描述', '研发网段'),
        fillAction('开始地址', '1.1.1.1'),
        fillAction('结束地址', '2.2.2.2'),
      ], [], {});

      assertEqual(flow.steps.map(step => step.value), ['pool-a', '研发网段', '1.1.1.1', '2.2.2.2']);
      assertEqual(flow.steps.map(step => step.id), ['s001', 's002', 's003', 's004']);
    },
  },
  {
    name: 'deleted fill step is not recreated when its recorder action is refreshed in place',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [
        fillAction('地址池名称', 'test'),
        fillAction('描述', 'old'),
      ], [], {});
      const deleted = deleteStepFromFlow(initial, 's002');
      const refreshed = mergeActionsIntoFlow(deleted, [
        fillAction('地址池名称', 'test'),
        fillAction('描述', 'new'),
      ], [], {});

      assertEqual(refreshed.steps.map(step => step.id), ['s001']);
      assertEqual(refreshed.steps[0].value, 'test');
      assert(!refreshed.steps.some(step => step.value === 'new'), 'deleted refreshed action should not recreate a step');
    },
  },
  {
    name: 'existing fill can continue across payloads while later different fields remain separate',
    run: () => {
      const firstPayload = mergeActionsIntoFlow(undefined, [
        fillAction('地址池名称', 'tes'),
      ], [], {});
      const finalPayload = mergeActionsIntoFlow(firstPayload, [
        fillAction('地址池名称', 'tes'),
        fillAction('地址池名称', 'test1'),
        fillAction('开始地址', '1.1.1.1'),
        fillAction('结束地址', '2.2.2.2'),
      ], [], {});

      assertEqual(finalPayload.steps.map(step => step.value), ['test1', '1.1.1.1', '2.2.2.2']);
      assertEqual(finalPayload.steps.map(step => step.id), ['s001', 's003', 's004']);
      assertEqual(finalPayload.steps[0].sourceActionIds?.length, 2);
    },
  },
  {
    name: 'repeat segment references stay stable and dangling parameters are removed on delete',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [
        clickAction('新建'),
        fillAction('地址池名称', 'pool-a'),
        fillAction('起始地址', '1.1.1.1'),
        clickAction('确定'),
      ], [], {});
      const segment = createRepeatSegment(initial, ['s002', 's003']);
      const withSegment: BusinessFlow = {
        ...initial,
        repeatSegments: [segment],
      };
      const deleted = deleteStepFromFlow(withSegment, 's002');

      assertEqual(deleted.repeatSegments?.[0]?.stepIds, ['s003']);
      assert(!deleted.repeatSegments?.[0]?.parameters.some(parameter => parameter.sourceStepId === 's002'), 'deleted source step parameter should be removed');
    },
  },
  {
    name: 'repeat segment infers AntD option click as selectable WAN parameter',
    run: () => {
      const flow = createNamedFlow();
      const withSteps: BusinessFlow = {
        ...flow,
        steps: [
          { id: 's001', order: 1, action: 'click', target: { testId: 'site-ip-address-pool-create-button', text: '新建' }, assertions: [] },
          { id: 's002', order: 2, action: 'fill', target: { label: '地址池名称' }, value: 'test1', assertions: [] },
          { id: 's003', order: 3, action: 'click', target: { role: 'combobox', text: '选择一个WAN口' }, context: { eventId: 'ctx-s003', capturedAt: 3, before: { form: { label: 'WAN口' }, dialog: { title: '新建IPv4地址池', type: 'modal', visible: true } }, after: { dialog: { title: '选择一个WAN口', type: 'dropdown', visible: true } } }, assertions: [] },
          { id: 's004', order: 4, action: 'click', target: { text: 'xtest16:WAN1' }, context: { eventId: 'ctx-s004', capturedAt: 4, before: { form: { label: 'WAN口' }, dialog: { title: '选择一个WAN口', type: 'dropdown', visible: true } }, after: { dialog: { title: '新建IPv4地址池', type: 'modal', visible: true } } }, assertions: [] },
          { id: 's005', order: 5, action: 'fill', target: { label: '开始地址' }, value: '1.1.1.1', assertions: [] },
          { id: 's006', order: 6, action: 'fill', target: { label: '结束地址' }, value: '2.2.2.2', assertions: [] },
          { id: 's007', order: 7, action: 'click', target: { text: '确 定' }, assertions: [] },
        ],
      };

      const segment = createRepeatSegment(withSteps, withSteps.steps.map(step => step.id));
      const portParameter = segment.parameters.find(parameter => parameter.variableName === 'port');

      assert(portParameter, 'WAN option click should become repeat parameter');
      assertEqual(portParameter?.label, 'WAN口');
      assertEqual(portParameter?.currentValue, 'xtest16:WAN1');
      assertEqual(segment.rows.map(row => row.values[portParameter!.id]), ['xtest16:WAN1', 'xtest16:WAN1', 'xtest16:WAN1']);
    },
  },
  {
    name: 'repeat segment inherits role select label for context-light option click',
    run: () => {
      const flow = createNamedFlow();
      const withSteps: BusinessFlow = {
        ...flow,
        steps: [
          { id: 'u001', order: 1, action: 'click', target: { testId: 'create-user-btn', text: '新建用户' }, assertions: [] },
          { id: 'u002', order: 2, action: 'fill', target: { placeholder: '请输入用户名', label: '用户名' }, value: 'alice.qa', assertions: [] },
          { id: 'u003', order: 3, action: 'click', target: { role: 'combobox', text: '角色' }, context: { eventId: 'ctx-u003', capturedAt: 3, before: { form: { label: '角色' }, dialog: { title: '新建用户', type: 'modal', visible: true } }, after: { dialog: { title: '角色选项', type: 'dropdown', visible: true } } }, assertions: [] },
          { id: 'u004', order: 4, action: 'click', target: { text: '审计员' }, context: { eventId: 'ctx-u004', capturedAt: 4, before: { dialog: { title: '角色选项', type: 'dropdown', visible: true } }, after: { dialog: { title: '新建用户', type: 'modal', visible: true } } }, assertions: [] },
          { id: 'u005', order: 5, action: 'click', target: { testId: 'modal-confirm', text: '确定' }, assertions: [] },
        ],
      };

      const segment = createRepeatSegment(withSteps, withSteps.steps.map(step => step.id));
      const usernameParameter = segment.parameters.find(parameter => parameter.variableName === 'username');
      const roleParameter = segment.parameters.find(parameter => parameter.variableName === 'role');

      assert(usernameParameter, 'username input should use stable username variable');
      assert(roleParameter, 'role option click should inherit role label instead of generic param');
      assertEqual(roleParameter?.label, '角色');
      assertEqual(roleParameter?.currentValue, '审计员');
      assertEqual(segment.rows.map(row => row.values[roleParameter!.id]), ['审计员', '审计员', '审计员']);
    },
  },
  {
    name: 'repeat segment extracts AntD option text from raw title selector when page context is late',
    run: () => {
      const flow = createNamedFlow();
      const withSteps: BusinessFlow = {
        ...flow,
        steps: [
          { id: 'u001', order: 1, action: 'click', target: { testId: 'create-user-btn', text: '新建用户' }, assertions: [] },
          { id: 'u002', order: 2, action: 'fill', target: { placeholder: '请输入用户名', label: '用户名' }, value: 'alice.qa', assertions: [] },
          {
            id: 'u003',
            order: 3,
            action: 'click',
            target: {},
            rawAction: { action: { name: 'click', selector: 'internal:attr=[title="管理员"i]' } },
            sourceCode: `await page.getByTitle('管理员').click();`,
            assertions: [],
          },
          {
            id: 'u004',
            order: 4,
            action: 'click',
            target: {},
            rawAction: { action: { name: 'click', selector: 'internal:attr=[title="审计员"i] >> div' } },
            sourceCode: `await page.getByTitle('审计员').locator('div').click();`,
            assertions: [],
          },
          { id: 'u005', order: 5, action: 'click', target: { testId: 'modal-confirm', text: '确定' }, assertions: [] },
        ],
      };

      const segment = createRepeatSegment(withSteps, withSteps.steps.map(step => step.id));
      const roleParameters = segment.parameters.filter(parameter => parameter.variableName.startsWith('role'));
      const code = generateBusinessFlowPlaywrightCode({ ...withSteps, repeatSegments: [segment] });

      assertEqual(roleParameters.map(parameter => parameter.currentValue), ['审计员']);
      assert(code.includes('String(row.role)'), 'raw title option should be parameterized as row.role');
      assert(!code.includes('row.role2'), 'selected trigger title should not become a second role parameter');
    },
  },
  {
    name: 'repeat segment infers context-light tree select option values as parameters',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            text: '华东生产区',
            name: '华东生产区',
          },
          context: {
            eventId: 'ctx-tree-option',
            capturedAt: 1000,
            before: {
              dialog: { type: 'dropdown', visible: true },
              target: {
                tag: 'span',
                text: '华东生产区',
                normalizedText: '华东生产区',
                framework: 'antd',
                controlType: 'tree-select-option',
              },
            },
          },
          rawAction: {
            action: {
              name: 'click',
              selector: 'internal:text="华东生产区"i',
            },
          },
          assertions: [],
        }],
      };
      const segment = createRepeatSegment(flow);

      assertEqual(segment.parameters.map(parameter => parameter.variableName), ['scope']);
      assertEqual(segment.parameters[0]?.currentValue, '华东生产区');
    },
  },
  {
    name: 'repeat segment keeps generated rows valid for duplicate network select parameters',
    run: () => {
      const flow = createNamedFlow();
      const withSteps: BusinessFlow = {
        ...flow,
        steps: [
          { id: 'n001', order: 1, action: 'fill', target: { placeholder: '地址池名称', label: '资源名称' }, value: 'res-web-01', assertions: [] },
          { id: 'n002', order: 2, action: 'click', target: { role: 'combobox', text: '关联VRF' }, context: { eventId: 'ctx-n002', capturedAt: 2, before: { form: { label: '关联VRF' } }, after: { dialog: { title: '关联VRF选项', type: 'dropdown', visible: true } } }, assertions: [] },
          { id: 'n003', order: 3, action: 'click', target: { text: '生产VRF' }, context: { eventId: 'ctx-n003', capturedAt: 3, before: { dialog: { title: '关联VRF选项', type: 'dropdown', visible: true } } }, assertions: [] },
          { id: 'n004', order: 4, action: 'click', target: { role: 'combobox', text: '关联VRF' }, context: { eventId: 'ctx-n004', capturedAt: 4, before: { form: { label: '关联VRF' } }, after: { dialog: { title: '关联VRF选项', type: 'dropdown', visible: true } } }, assertions: [] },
          { id: 'n005', order: 5, action: 'click', target: { text: '生产VRF' }, context: { eventId: 'ctx-n005', capturedAt: 5, before: { dialog: { title: '关联VRF选项', type: 'dropdown', visible: true } } }, assertions: [] },
          { id: 'n006', order: 6, action: 'click', target: { role: 'combobox', text: '发布范围' }, context: { eventId: 'ctx-n006', capturedAt: 6, before: { form: { label: '发布范围' } }, after: { dialog: { title: '发布范围选项', type: 'dropdown', visible: true } } }, assertions: [] },
          { id: 'n007', order: 7, action: 'click', target: { text: '华东生产区' }, context: { eventId: 'ctx-n007', capturedAt: 7, before: { dialog: { title: '发布范围选项', type: 'dropdown', visible: true } } }, assertions: [] },
        ],
      };

      const segment = createRepeatSegment(withSteps, withSteps.steps.map(step => step.id));
      const selectParameters = segment.parameters.filter(parameter => /^(context|scope)/.test(parameter.variableName));

      assert(selectParameters.some(parameter => parameter.variableName === 'context'), 'related-context parameter should exist');
      assert(selectParameters.some(parameter => parameter.variableName === 'scope'), 'scope/range parameter should exist');
      for (const parameter of selectParameters)
        assertEqual(segment.rows.map(row => row.values[parameter.id]), [parameter.currentValue, parameter.currentValue, parameter.currentValue]);
    },
  },
  {
    name: 'repeat segment maps Chinese remark fields to remark variable',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          { id: 'n001', order: 1, action: 'fill', target: { label: '备注', placeholder: '填写策略备注' }, value: '生产访问策略', assertions: [] },
        ],
      };
      const segment = createRepeatSegment(flow);

      assertEqual(segment.parameters.map(parameter => parameter.variableName), ['remark']);
    },
  },
  {
    name: 'playback action count expands repeat segments for continue-recording boundaries',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [
        fillAction('地址池名称', 'pool-a'),
        fillAction('开始地址', '1.1.1.1'),
        clickAction('确定'),
      ], recordedSource([
        `await page.getByLabel('地址池名称').fill('pool-a');`,
        `await page.getByLabel('开始地址').fill('1.1.1.1');`,
        `await page.getByRole('button', { name: '确定' }).click();`,
      ]), {});
      const segment = createRepeatSegment(initial, ['s001', 's002']);
      const flow: BusinessFlow = {
        ...initial,
        repeatSegments: [segment],
      };

      assertEqual(segment.rows.length, 3);
      assertEqual(countBusinessFlowPlaybackActions(flow), 7);
    },
  },
  {
    name: 'short reset payload after repeat skips stale actions and incidental navigation',
    run: () => {
      const initialActions = [
        fillAction('地址池名称', 'pool-a'),
        fillAction('开始地址', '1.1.1.1'),
        clickAction('确定'),
      ];
      const initialSources = recordedSource([
        `await page.getByLabel('地址池名称').fill('pool-a');`,
        `await page.getByLabel('开始地址').fill('1.1.1.1');`,
        `await page.getByRole('button', { name: '确定' }).click();`,
      ]);
      const initial = mergeActionsIntoFlow(undefined, initialActions, initialSources, {});
      const segment = createRepeatSegment(initial, ['s001', 's002']);
      const withSegment: BusinessFlow = {
        ...initial,
        repeatSegments: [segment],
      };
      const withSave = mergeActionsIntoFlow(withSegment, [...initialActions, clickAction('保存配置')], recordedSource([
        `await page.getByLabel('地址池名称').fill('pool-a');`,
        `await page.getByLabel('开始地址').fill('1.1.1.1');`,
        `await page.getByRole('button', { name: '确定' }).click();`,
        `await page.getByTestId('site-save-button').click();`,
      ]), {
        appendNewActions: true,
        insertBaseActionCount: initialActions.length,
      });
      const boundary = countBusinessFlowPlaybackActions(withSave);
      const continued = mergeActionsIntoFlow(withSave, [
        clickAction('保存配置'),
        navigateAction('https://nova-sdwan.example.com/site/edit/basic-info?p=true'),
        clickAction('保存配置'),
        clickAction('新增IP端口池'),
      ], [], {
        appendNewActions: true,
        insertBaseActionCount: boundary,
      });

      assert(boundary > 4, 'repeat playback boundary should exceed short reset payload size');
      assertEqual(continued.steps.map(step => step.id), ['s001', 's002', 's003', 's004', 's005']);
      assertEqual(continued.steps.map(step => step.action), ['fill', 'fill', 'click', 'click', 'click']);
      assertEqual(continued.steps[continued.steps.length - 1]?.target?.name, '新增IP端口池');
      assert(!continued.steps.some(step => step.action === 'navigate'), 'incidental same-page navigation should not become a business step');
      assertEqual(continued.steps.filter(step => step.target?.name === '保存配置').length, 1);
    },
  },
  {
    name: 'short continuation payload uses local cursor instead of global action signatures',
    run: () => {
      const existing = mergeActionsIntoFlow(undefined, [
        clickAction('保存配置'),
        clickAction('新增IP端口池'),
        fillAction('地址池名称', 'old'),
      ], [], {});
      const sessionId = 'short-continuation-session';
      const basePayload = [clickAction('保存配置'), clickAction('保存配置')];
      const noChange = mergeActionsIntoFlow(existing, basePayload, [], {
        appendNewActions: true,
        insertBaseActionCount: 2,
        recordingSessionId: sessionId,
      });
      const withRepeatedClick = mergeActionsIntoFlow(noChange, [...basePayload, clickAction('新增IP端口池')], [], {
        appendNewActions: true,
        insertBaseActionCount: 2,
        recordingSessionId: sessionId,
      });
      const withName = mergeActionsIntoFlow(withRepeatedClick, [...basePayload, clickAction('新增IP端口池'), fillAction('地址池名称', 't')], [], {
        appendNewActions: true,
        insertBaseActionCount: 3,
        recordingSessionId: sessionId,
      });
      const refreshedName = mergeActionsIntoFlow(withName, [...basePayload, clickAction('新增IP端口池'), fillAction('地址池名称', 'test1')], [], {
        appendNewActions: true,
        insertBaseActionCount: 4,
        recordingSessionId: sessionId,
      });
      const withPrefix = mergeActionsIntoFlow(refreshedName, [...basePayload, clickAction('新增IP端口池'), fillAction('地址池名称', 'test1'), fillAction('IP/前缀，例如：192.168.1.1或192.168.1.0/24', '1.1.1.1')], [], {
        appendNewActions: true,
        insertBaseActionCount: 4,
        recordingSessionId: sessionId,
      });

      assertEqual(noChange.steps.length, 3);
      assertEqual(withRepeatedClick.steps.map(step => step.id), ['s001', 's002', 's003', 's004']);
      assertEqual(refreshedName.steps.map(step => step.value).filter(Boolean), ['old', 'test1']);
      assertEqual(withPrefix.steps.map(step => step.value).filter(Boolean), ['old', 'test1', '1.1.1.1']);
      assertEqual(withPrefix.steps.slice(-3).map(step => step.action), ['click', 'fill', 'fill']);
    },
  },
  {
    name: 'page context click is synthesized when recorder misses the action',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [
        clickAction('保存配置'),
      ], [], {});
      const event = pageClickEvent('ctx-new-port-pool', Date.now() - 2000, '新建');
      const withSynthetic = appendSyntheticPageContextSteps(initial, [event]);

      assertEqual(withSynthetic.steps.map(step => step.action), ['click', 'click']);
      assertEqual(withSynthetic.steps[1].kind, 'manual');
      assertEqual(withSynthetic.steps[1].target?.text, '新建');
      assertEqual(withSynthetic.steps[1].sourceCode, `await page.getByRole("button", { name: "新建" }).click();`);
      assertEqual(withSynthetic.steps[1].context?.eventId, 'ctx-new-port-pool');
    },
  },
  {
    name: 'AntD select option click is synthesized even when a combobox click was recorded nearby',
    run: () => {
      const wallTime = Date.now() - 2000;
      const initial = mergeActionsIntoFlow(undefined, [{
        action: {
          name: 'click',
          selector: 'internal:role=combobox[name="下方表单使用条目"i]',
        },
        wallTime,
      }, {
        action: {
          name: 'fill',
          selector: 'internal:role=textbox[name="使用备注"i]',
          text: '下方表单使用刚保存的条目',
        },
        wallTime: wallTime + 520,
      }], [], {});
      const optionEvent = pageClickEventWithTarget('ctx-select-option', wallTime + 260, {
        tag: 'div',
        role: 'option',
        text: 'real-item-a',
        normalizedText: 'real-item-a',
        framework: 'antd',
        controlType: 'select-option',
        locatorQuality: 'semantic',
      } as ElementContext);
      const withSynthetic = appendSyntheticPageContextSteps(initial, [optionEvent]);
      const code = generateBusinessFlowPlaywrightCode(withSynthetic);

      assertEqual(withSynthetic.steps.map(step => step.action), ['click', 'click', 'fill']);
      assertEqual(withSynthetic.steps[1].target?.text, 'real-item-a');
      assert(code.includes('ant-select-item-option'), 'select option synthetic step should use visible AntD option content in replay code');
    },
  },
  {
    name: 'repeat steps inherit dialog opened by the preceding create action',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            action: 'click',
            target: { testId: 'site-ip-address-pool-create-button', text: '新 建' },
            context: { eventId: 'ctx-open', capturedAt: 1000, before: { target: { tag: 'button', testId: 'site-ip-address-pool-create-button', text: '新 建' } }, after: { dialog: { type: 'modal', title: '新建IPv4地址池', visible: true } } },
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            action: 'fill',
            target: { role: 'textbox', label: '地址池名称', placeholder: '地址池名称' },
            context: { eventId: 'ctx-name', capturedAt: 1200, before: { form: { label: '地址池名称', name: 'name' }, target: { tag: 'input', role: 'textbox', placeholder: '地址池名称', controlType: 'input' } } },
            value: 'test1',
            assertions: [],
          },
          {
            id: 's003',
            order: 3,
            action: 'click',
            target: { role: 'combobox', name: '* WAN口', label: 'WAN口' },
            rawAction: { action: { name: 'click', selector: 'internal:role=combobox[name="* WAN口"i]' } },
            assertions: [],
          },
        ],
        repeatSegments: [{ id: 'r001', name: '批量创建IPv4地址池', stepIds: ['s001', 's002', 's003'], parameters: [], rows: [{ id: 'row-1', values: {} }], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      assert(code.includes('新建IPv4地址池'), 'repeat field locators should stay scoped to the modal opened by the create step');
      assert(code.includes('filter({ hasText: "新建IPv4地址池" })'), 'repeat select trigger should use modal-scoped locator');
    },
  },
  {
    name: 'late synthetic AntD option upgrades matching truncated raw recorder click instead of duplicating it',
    run: () => {
      const wallTime = Date.now() - 2000;
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            kind: 'recorded',
            sourceActionIds: ['a001'],
            action: 'click',
            target: {
              role: 'combobox',
              name: '* WAN口',
              label: 'WAN口',
              scope: {
                dialog: { title: '新建网络资源', type: 'modal', visible: true },
                form: { label: 'WAN口', name: 'wan' },
              },
            },
            rawAction: { wallTime, action: { name: 'click', selector: 'internal:role=combobox[name="* WAN口"i]' } },
            sourceCode: `await page.getByRole('combobox', { name: '* WAN口' }).click();`,
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            kind: 'recorded',
            sourceActionIds: ['a002'],
            action: 'click',
            target: {
              text: 'edge-lab:WAN-extra-',
              locator: 'internal:text="edge-lab:WAN-extra-"i',
            },
            rawAction: { wallTime: wallTime + 660, action: { name: 'click', selector: 'internal:text="edge-lab:WAN-extra-"i' } },
            sourceCode: `await page.getByText('edge-lab:WAN-extra-').click();`,
            assertions: [],
          },
        ],
      };
      const event = pageClickEventWithTarget('ctx-late-wan-option', wallTime + 700, {
        tag: 'div',
        role: 'option',
        title: 'edge-lab:WAN-extra-18',
        text: 'edge-lab:WAN-extra-18',
        normalizedText: 'edge-lab:WAN-extra-18',
        framework: 'procomponents',
        controlType: 'select-option',
        locatorQuality: 'semantic',
      } as ElementContext);
      event.before.form = { label: 'WAN口', name: 'wan' };
      event.before.dialog = { type: 'dropdown', visible: true };
      const merged = appendSyntheticPageContextSteps(flow, [event]);
      const code = generateBusinessFlowPlaywrightCode(merged);
      assertEqual(merged.steps.length, 2);
      assertEqual(merged.steps[1].target?.text, 'edge-lab:WAN-extra-18');
      assert(code.includes('AntD Select virtual dropdown replay workaround'), 'upgraded option should use stable AntD replay');
      assert(!code.includes(`getByText('edge-lab:WAN-extra-')`) && !code.includes(`getByText("edge-lab:WAN-extra-")`), 'truncated raw text click should be upgraded, not replayed');
    },
  },
  {
    name: 'late dropdown option page context is inserted immediately after its trigger',
    run: () => {
      const wallTime = Date.now() - 2000;
      const initial = mergeActionsIntoFlow(undefined, [{
        action: { name: 'click', selector: 'internal:role=combobox[name="共享WAN"i]' },
        wallTime,
      }, {
        action: { name: 'fill', selector: 'internal:role=textbox[name="使用备注"i]', text: '循环后继续补步骤' },
        wallTime: wallTime + 120,
      }, {
        action: { name: 'click', selector: 'internal:testid=[data-testid="site-post-save-action"s]' },
        wallTime: wallTime + 240,
      }], [], {});
      const optionEvent = pageClickEventWithTarget('ctx-wan-option', wallTime + 1000, {
        tag: 'div',
        role: 'option',
        title: 'WAN1',
        text: 'WAN1',
        normalizedText: 'WAN1',
        framework: 'antd',
        controlType: 'select-option',
        locatorQuality: 'semantic',
      } as ElementContext);
      optionEvent.before.form = { label: '共享WAN', name: 'wanPort' };
      optionEvent.before.dialog = { type: 'dropdown', visible: true };

      const withSynthetic = appendSyntheticPageContextSteps(initial, [optionEvent]);

      assertEqual(withSynthetic.steps.map(step => step.target?.text || step.target?.name || step.value || step.target?.testId), ['共享WAN', 'WAN1', '使用备注', 'site-post-save-action']);
      assertEqual(withSynthetic.steps[2]?.value, '循环后继续补步骤');
    },
  },
  {
    name: 'late cascader option does not inherit the previous tree-select insertion cursor',
    run: () => {
      const wallTime = Date.now() - 2000;
      const initial = mergeActionsIntoFlow(undefined, [{
        action: { name: 'click', selector: 'internal:role=combobox[name="* 发布范围"i]' },
      }, {
        action: { name: 'click', selector: 'internal:role=combobox[name="* 出口路径"i]' },
      }], [], {});
      const treeOption = pageClickEventWithTarget('ctx-tree-option', wallTime + 100, {
        tag: 'span',
        role: 'treeitem',
        text: '华东生产区',
        normalizedText: '华东生产区',
        framework: 'antd',
        controlType: 'tree-select-option',
        locatorQuality: 'semantic',
      } as ElementContext);
      treeOption.before.form = { label: '发布范围', name: 'scope' };
      treeOption.before.dialog = { type: 'dropdown', visible: true };
      const cascaderOption = pageClickEventWithTarget('ctx-cascader-option', wallTime + 200, {
        tag: 'li',
        role: 'menuitemcheckbox',
        text: '上海',
        normalizedText: '上海',
        framework: 'antd',
        controlType: 'cascader-option',
        locatorQuality: 'semantic',
      } as ElementContext);
      cascaderOption.before.dialog = { type: 'dropdown', visible: true };

      const withSynthetic = appendSyntheticPageContextSteps(initial, [treeOption, cascaderOption]);

      assertEqual(withSynthetic.steps.map(step => step.target?.text || step.target?.name || step.value), ['* 发布范围', '华东生产区', '* 出口路径', '上海']);
    },
  },
  {
    name: 'synthetic page context click prefers a captured test id selector',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [
        clickAction('保存配置'),
      ], [], {});
      const event = pageClickEventWithTarget('ctx-new-port-pool-testid', Date.now() - 2000, {
        tag: 'button',
        role: 'button',
        testId: 'site-ip-port-pool-create-button',
        text: '新建',
        normalizedText: '新建',
      });
      const withSynthetic = appendSyntheticPageContextSteps(initial, [event]);
      const synthetic = withSynthetic.steps[1];

      assertEqual(synthetic.target?.testId, 'site-ip-port-pool-create-button');
      assertEqual(synthetic.sourceCode, `await page.getByTestId("site-ip-port-pool-create-button").click();`);
      assertEqual(synthetic.comment, '页面侧已捕获点击，并根据页面上下文自动补录为业务步骤。');
    },
  },
  {
    name: 'synthetic page context skips non-interactive structural containers',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [
        clickAction('保存配置'),
      ], [], {});
      const event = pageClickEventWithTarget('ctx-structural-section', Date.now() - 2000, {
        tag: 'div',
        testId: 'site-global-ip-pools-section',
        text: '地址池与端口池',
        normalizedText: '地址池与端口池',
        framework: 'procomponents',
        controlType: 'unknown',
        locatorQuality: 'testid',
      } as ElementContext);

      const result = appendSyntheticPageContextStepsWithResult(initial, [event]);

      assertEqual(result.insertedStepIds, []);
      assertEqual(result.flow.steps.map(step => step.target?.testId || step.target?.name), ['保存配置']);
      assertEqual(result.skippedEventIds, ['ctx-structural-section']);
    },
  },
  {
    name: 'synthetic page context skips hidden modal root click after confirm close',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [
        clickAction('保存配置'),
      ], [], {});
      const wallTime = Date.now() - 2000;
      const rootEvent = pageClickEventWithTarget('ctx-hidden-create-user-modal-root', wallTime, {
        tag: 'div',
        testId: 'create-user-modal',
        text: '新建用户',
        normalizedText: '新建用户',
        framework: 'antd',
        controlType: 'select',
        locatorQuality: 'testid',
      } as ElementContext);
      rootEvent.before.dialog = { type: 'modal', title: '新建用户', visible: false };
      rootEvent.after = { dialog: { type: 'modal', title: '新建用户', visible: false } };

      const result = appendSyntheticPageContextStepsWithResult(initial, [rootEvent]);

      assertEqual(result.insertedStepIds.length, 0);
      assert(!result.flow.steps.some(step => step.target?.testId === 'create-user-modal'), 'hidden modal root click should stay in the journal but not become a business click step');
      assertEqual(result.skippedEventIds, ['ctx-hidden-create-user-modal-root']);
    },
  },
  {
    name: 'synthetic page context keeps interactive modal confirm children',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [
        clickAction('保存配置'),
      ], [], {});
      const confirmEvent = pageClickEventWithTarget('ctx-modal-confirm-button', Date.now() - 2000, {
        tag: 'button',
        role: 'button',
        testId: 'modal-confirm',
        text: '确定',
        normalizedText: '确定',
        framework: 'antd',
        controlType: 'button',
        locatorQuality: 'testid',
      } as ElementContext);
      confirmEvent.before.dialog = { type: 'modal', title: '新建用户', visible: true };
      confirmEvent.after = { dialog: { type: 'modal', title: '新建用户', visible: false } };

      const result = appendSyntheticPageContextStepsWithResult(initial, [confirmEvent]);

      assertEqual(result.insertedStepIds.length, 1);
      assert(result.flow.steps.some(step => step.target?.testId === 'modal-confirm'), 'interactive modal confirm should still be projected as a business step');
    },
  },
  {
    name: 'synthetic page context click dedupes nested targets from the same user click',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [
        clickAction('保存配置'),
      ], [], {});
      const wallTime = Date.now() - 2000;
      const buttonEvent = pageClickEventWithTarget('ctx-button', wallTime, {
        tag: 'button',
        role: 'button',
        testId: 'site-ip-port-pool-create-button',
        text: '新建',
        normalizedText: '新建',
      });
      const spanEvent = pageClickEventWithTarget('ctx-span', wallTime + 240, {
        tag: 'span',
        text: '新建',
        normalizedText: '新建',
      });
      const withButton = appendSyntheticPageContextSteps(initial, [buttonEvent]);
      const withSpan = appendSyntheticPageContextSteps(withButton, [spanEvent]);

      assertEqual(withSpan.steps.map(step => step.id), ['s001', 's002']);
      assertEqual(withSpan.steps[1].target?.testId, 'site-ip-port-pool-create-button');
    },
  },
  {
    name: 'page context duplicate nested targets choose button test id in one arbitration window',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [
        clickAction('保存配置'),
      ], [], {});
      const wallTime = Date.now() - 2000;
      const spanEvent = pageClickEventWithTarget('ctx-span', wallTime, {
        tag: 'span',
        text: '新建',
        normalizedText: '新建',
      });
      const buttonEvent = pageClickEventWithTarget('ctx-button', wallTime + 200, {
        tag: 'button',
        role: 'button',
        testId: 'site-ip-port-pool-create-button',
        text: '新建',
        normalizedText: '新建',
      });
      const result = appendSyntheticPageContextStepsWithResult(initial, [spanEvent, buttonEvent]);

      assertEqual(result.insertedStepIds.length, 1);
      assertEqual(result.flow.steps.map(step => step.id), ['s001', 's002']);
      assertEqual(result.flow.steps[1].target?.testId, 'site-ip-port-pool-create-button');
    },
  },
  {
    name: 'antd adapter prefers outer button testId over nested span and svg events',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [
        clickAction('保存配置'),
      ], [], {});
      const wallTime = Date.now() - 2000;
      const svgEvent = pageClickEventWithTarget('ctx-svg', wallTime, {
        tag: 'svg',
        role: 'img',
      });
      const spanEvent = pageClickEventWithTarget('ctx-span', wallTime + 120, {
        tag: 'span',
        text: '新建',
        normalizedText: '新建',
      });
      const buttonEvent = pageClickEventWithTarget('ctx-button', wallTime + 180, {
        tag: 'button',
        role: 'button',
        testId: 'site-ip-port-pool-create-button',
        text: '新建',
        normalizedText: '新建',
        framework: 'antd',
        controlType: 'button',
        locatorQuality: 'testid',
      } as ElementContext);
      const withSynthetic = appendSyntheticPageContextSteps(initial, [svgEvent, spanEvent, buttonEvent]);

      assertEqual(withSynthetic.steps.map(step => step.id), ['s001', 's002']);
      assertEqual(withSynthetic.steps[1].target?.testId, 'site-ip-port-pool-create-button');
      assertEqual(withSynthetic.steps[1].sourceCode, `await page.getByTestId("site-ip-port-pool-create-button").click();`);
    },
  },
  {
    name: 'bare svg icon click without semantic parent is not synthesized',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [
        clickAction('保存配置'),
      ], [], {});
      const withSynthetic = appendSyntheticPageContextSteps(initial, [
        pageClickEventWithTarget('ctx-svg-only', Date.now() - 2000, {
          tag: 'svg',
          role: 'img',
        }),
      ]);

      assertEqual(withSynthetic.steps.map(step => step.id), ['s001']);
    },
  },
  {
    name: 'page context upgrades weird recorded click selector to test id target',
    run: () => {
      const wallTime = Date.now();
      const recorded = mergeActionsIntoFlow(undefined, [
        {
          action: {
            name: 'click',
            selector: 'div >> internal:has-text="新建"i >> nth=1',
          },
          wallTime,
        },
      ], [], {});
      const upgraded = mergePageContextIntoFlow(recorded, [
        pageClickEventWithTarget('ctx-button-testid', wallTime + 120, {
          tag: 'button',
          role: 'button',
          testId: 'site-ip-port-pool-create-button',
          text: '新建',
          normalizedText: '新建',
          framework: 'antd',
          controlType: 'button',
          locatorQuality: 'testid',
        } as ElementContext),
      ]);

      assertEqual(upgraded.steps[0].target?.testId, 'site-ip-port-pool-create-button');
      assertEqual(upgraded.steps[0].target?.displayName, '新建');
    },
  },
  {
    name: 'page context upgrades ProForm checkbox click with form label scope',
    run: () => {
      const wallTime = Date.now();
      const recorded = mergeActionsIntoFlow(undefined, [{
        action: {
          name: 'click',
          selector: 'label >> nth=6',
        },
        wallTime,
      }], [], {});
      const event = pageClickEventWithTarget('ctx-proform-checkbox', wallTime + 120, {
        tag: 'span',
        role: 'checkbox',
        framework: 'procomponents',
        controlType: 'checkbox',
        locatorQuality: 'semantic',
      } as ElementContext);
      event.before.form = {
        label: '开启代理ARP',
        name: 'arpProxy',
      };
      event.before.dialog = {
        type: 'modal',
        title: '新建网络资源',
        visible: true,
      };

      const upgraded = mergePageContextIntoFlow(recorded, [event]);
      const code = generateBusinessFlowPlaywrightCode(upgraded);
      const firstStep = stepCodeBlock(code, 's001');

      assertEqual(upgraded.steps[0].target?.label, '开启代理ARP');
      assertEqual(upgraded.steps[0].target?.scope?.form?.name, 'arpProxy');
      assert(firstStep.includes('getByLabel("开启代理ARP").click()') || firstStep.includes("locator('label').filter({ hasText: \"开启代理ARP\" }).click();"), 'ProForm checkbox click should replay by a semantic choice locator instead of a brittle label nth selector');
    },
  },
  {
    name: 'form-labeled ProForm checkbox page click is not suppressed by a nearby weak recorder click',
    run: () => {
      const wallTime = Date.now();
      const initial = mergeActionsIntoFlow(undefined, [{
        action: {
          name: 'click',
          selector: 'label >> nth=6',
        },
        wallTime,
      }], [], {});
      const event = pageClickEventWithTarget('ctx-proform-checkbox-synthetic', wallTime + 200, {
        tag: 'span',
        role: 'checkbox',
        framework: 'procomponents',
        controlType: 'checkbox',
        locatorQuality: 'semantic',
      } as ElementContext);
      event.before.form = {
        label: '开启代理ARP',
        name: 'arpProxy',
      };
      const withSynthetic = appendSyntheticPageContextSteps(initial, [event]);

      assertEqual(withSynthetic.steps.length, 2);
      assertEqual(withSynthetic.steps[1].target?.label, '开启代理ARP');
      assertEqual(withSynthetic.steps[1].sourceCode, 'await page.locator(\'label\').filter({ hasText: "开启代理ARP" }).click();');
    },
  },
  {
    name: 'text-labeled ProForm radio page click is not suppressed by a nearby weak recorder click',
    run: () => {
      const wallTime = Date.now();
      const initial = mergeActionsIntoFlow(undefined, [{
        action: {
          name: 'click',
          selector: 'internal:testid=[data-testid="network-resource-form"]',
        },
        wallTime,
      }], [], {});
      const event = pageClickEventWithTarget('ctx-proform-radio-synthetic', wallTime + 200, {
        tag: 'label',
        role: 'radio',
        text: '独享地址池',
        normalizedText: '独享地址池',
        framework: 'procomponents',
        controlType: 'radio',
        locatorQuality: 'semantic',
      } as ElementContext);
      const withSynthetic = appendSyntheticPageContextSteps(initial, [event]);

      assertEqual(withSynthetic.steps.length, 2);
      assertEqual(withSynthetic.steps[1].target?.text, '独享地址池');
      assertEqual(withSynthetic.steps[1].sourceCode, 'await page.locator(\'label\').filter({ hasText: "独享地址池" }).click();');
    },
  },
  {
    name: 'recorded ProForm radio label click on a structural form test id replays by visible label',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          action: 'click',
          target: {
            testId: 'network-resource-form',
            label: '独享地址池',
          },
          sourceCode: 'await page.getByLabel("独享地址池").click();',
          rawAction: {
            action: {
              name: 'click',
              selector: 'internal:testid=[data-testid="network-resource-form"]',
            },
          },
          assertions: [],
        }],
      };

      const code = generateBusinessFlowPlaywrightCode(flow);
      const firstStep = stepCodeBlock(code, 's001');

      assert(firstStep.includes(`page.locator('label').filter({ hasText: "独享地址池" }).click();`), 'structural form radio replay should click the visible AntD label instead of the hidden radio input');
      assert(!firstStep.includes('getByLabel("独享地址池").click()'), 'structural form radio replay must not use getByLabel for a hidden input click');
    },
  },
  {
    name: 'choice control synthetic step is not overwritten by a later broad recorded click',
    run: () => {
      const wallTime = Date.now();
      const initial = mergeActionsIntoFlow(undefined, [{
        action: {
          name: 'click',
          selector: 'internal:testid=[data-testid="network-resource-form"]',
        },
        wallTime,
      }], [], {});
      const event = pageClickEventWithTarget('ctx-proform-radio-synthetic-late', wallTime + 200, {
        tag: 'label',
        role: 'radio',
        text: '独享地址池',
        normalizedText: '独享地址池',
        framework: 'procomponents',
        controlType: 'radio',
        locatorQuality: 'semantic',
      } as ElementContext);
      const withSynthetic = appendSyntheticPageContextSteps(initial, [event]);
      const reconciled = upgradeSyntheticStepsCoveredByRecordedDrafts(withSynthetic.steps, [{
        step: {
          ...withSynthetic.steps[0],
          id: 's003',
          sourceActionIds: ['act_000003'],
          target: { testId: 'network-resource-form', displayName: '开启代理ARP' },
          rawAction: { wallTime: wallTime + 1600 },
        },
        entries: [{
          id: 'act_000003',
          index: 3,
          wallTime: wallTime + 1600,
          rawAction: { action: { name: 'click', selector: 'internal:testid=[data-testid="network-resource-form"]' } },
        } as any],
      }]);

      assertEqual(reconciled.upgradedStepIds, []);
      assertEqual(reconciled.remainingDrafts.length, 1);
      assert(withSynthetic.steps.some(step => step.target?.text === '独享地址池'), 'radio choice synthetic step should remain available for export');
    },
  },
  {
    name: 'choice control synthetic step is not suppressed by a broad context-matched form click',
    run: () => {
      const wallTime = Date.now();
      const event = pageClickEventWithTarget('ctx-proform-radio-late-context', wallTime, {
        tag: 'label',
        role: 'radio',
        text: '独享地址池',
        normalizedText: '独享地址池',
        framework: 'procomponents',
        controlType: 'radio',
        locatorQuality: 'semantic',
      } as ElementContext);
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's008',
          order: 8,
          kind: 'recorded',
          action: 'click',
          sourceActionIds: ['act_000008'],
          target: { testId: 'network-resource-form', displayName: 'network-resource-form' },
          context: {
            eventId: 'ctx-broad-form-click',
            capturedAt: wallTime,
            before: { target: event.before.target },
          },
          rawAction: { action: { name: 'click', selector: 'internal:testid=[data-testid="network-resource-form"]' }, wallTime },
          assertions: [],
        }],
      };

      const result = appendSyntheticPageContextStepsWithResult(flow, [event]);

      assertEqual(result.insertedStepIds.length, 1);
      assert(result.flow.steps.some(step => step.target?.text === '独享地址池'), 'late radio page context should not be swallowed by a broad form test id click');
    },
  },
  {
    name: 'choice control synthetic step is suppressed by a matching recorded switch test id',
    run: () => {
      const wallTime = Date.now();
      const flow = mergeActionsIntoFlow(undefined, [{
        ...rawClickAction('internal:text="启用健康检查"i'),
        wallTime,
      }], [], {});
      const event = pageClickEventWithTarget('ctx-health-switch-recorded', wallTime + 100, {
        tag: 'button',
        role: 'switch',
        testId: 'network-resource-health-switch',
        framework: 'procomponents',
        controlType: 'button',
        locatorQuality: 'testid',
      } as ElementContext);
      event.before.form = { label: '启用健康检查' };

      const result = appendSyntheticPageContextStepsWithResult(flow, [event]);

      assertEqual(result.insertedStepIds, []);
      assertEqual(result.flow.steps.filter(step => step.target?.text === '启用健康检查' || step.target?.displayName === '启用健康检查').length, 1);
    },
  },
  {
    name: 'code preview prefers upgraded test id over weird raw click selector',
    run: () => {
      const flow = mergeActionsIntoFlow(undefined, [
        rawClickAction('div >> internal:has-text="新建"i >> nth=1'),
      ], [], {});
      const upgraded: BusinessFlow = {
        ...flow,
        steps: flow.steps.map(step => ({
          ...step,
          target: {
            ...step.target,
            testId: 'site-ip-port-pool-create-button',
            role: 'button',
            name: '新建',
            displayName: '新建',
          },
        })),
      };
      const code = generateBusinessFlowPlaywrightCode(upgraded);
      const firstStep = stepCodeBlock(code, 's001');

      assert(firstStep.includes(`page.getByTestId("site-ip-port-pool-create-button").click();`), 'click should prefer upgraded test id');
      assert(!firstStep.includes('internal:has-text'), 'weird raw selector should not be used when test id exists');
    },
  },
  {
    name: 'antd select option keeps previous form field label context',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [
        clickAction('保存配置'),
      ], [], {});
      const optionEvent = pageClickEventWithTarget('ctx-select-option', Date.now() - 2000, {
        tag: 'div',
        role: 'option',
        text: 'WAN2',
        normalizedText: 'WAN2',
        framework: 'antd',
        controlType: 'select-option',
        locatorQuality: 'semantic',
      } as ElementContext);
      optionEvent.before.form = {
        label: 'WAN',
        name: 'wan',
      };
      optionEvent.before.dialog = {
        type: 'modal',
        title: '新建共享 WAN',
        visible: true,
      };
      const withSynthetic = appendSyntheticPageContextSteps(initial, [optionEvent]);

      assertEqual(withSynthetic.steps[1].target?.role, 'option');
      assertEqual(withSynthetic.steps[1].target?.text, 'WAN2');
      assertEqual(withSynthetic.steps[1].context?.before.form?.label, 'WAN');
    },
  },
  {
    name: 'pro table row action context keeps table title row key and action text',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [
        clickAction('保存配置'),
      ], [], {});
      const editEvent = pageClickEventWithTarget('ctx-row-edit', Date.now() - 2000, {
        tag: 'button',
        role: 'button',
        text: '编辑',
        normalizedText: '编辑',
        framework: 'antd',
        controlType: 'table-row-action',
        locatorQuality: 'semantic',
      } as ElementContext);
      editEvent.before.table = {
        title: '共享 WAN',
        rowKey: 'WAN1',
        rowText: 'WAN1 启用 1000',
        columnName: '操作',
        headers: ['名称', '状态', '权重', '操作'],
      };
      const withSynthetic = appendSyntheticPageContextSteps(initial, [editEvent]);

      assertEqual(withSynthetic.steps[1].target?.text, '编辑');
      assertEqual(withSynthetic.steps[1].context?.before.table?.title, '共享 WAN');
      assertEqual(withSynthetic.steps[1].context?.before.table?.rowKey, 'WAN1');
      assertEqual(withSynthetic.steps[1].context?.before.table?.columnName, '操作');
    },
  },
  {
    name: 'merge page context stores scope for table row actions',
    run: () => {
      const wallTime = Date.now();
      const recorded = mergeActionsIntoFlow(undefined, [
        {
          action: {
            name: 'click',
            selector: 'div >> internal:has-text="编辑"i >> nth=4',
          },
          wallTime,
        },
      ], [], {});
      const event = pageClickEventWithTarget('ctx-row-scope', wallTime + 120, {
        tag: 'button',
        role: 'button',
        text: '编辑',
        normalizedText: '编辑',
        framework: 'procomponents',
        controlType: 'table-row-action',
        locatorQuality: 'semantic',
      } as ElementContext);
      event.before.table = {
        title: '用户列表',
        testId: 'users-table',
        rowKey: 'user-42',
        rowText: 'Alice 管理员 编辑',
        columnName: '操作',
        headers: ['用户名', '角色', '操作'],
      };
      const merged = mergePageContextIntoFlow(recorded, [event]);

      assertEqual(merged.steps[0].target?.scope?.table?.testId, 'users-table');
      assertEqual(merged.steps[0].target?.scope?.table?.rowKey, 'user-42');
      assertEqual(merged.steps[0].target?.scope?.table?.columnName, '操作');
    },
  },
  {
    name: 'table row action code preview uses table scoped locator when button text repeats',
    run: () => {
      const flow = mergeActionsIntoFlow(undefined, [rawClickAction('div >> internal:has-text="编辑"i >> nth=4')], [], {});
      const scoped: BusinessFlow = {
        ...flow,
        steps: flow.steps.map(step => ({
          ...step,
          target: {
            ...step.target,
            role: 'button',
            text: '编辑',
            displayName: '编辑',
            scope: {
              table: {
                title: '用户列表',
                testId: 'users-table',
                rowKey: 'user-42',
                rowText: 'Alice 管理员 编辑',
                columnName: '操作',
              },
            },
          },
        })),
      };
      const code = generateBusinessFlowPlaywrightCode(scoped);
      const firstStep = stepCodeBlock(code, 's001');

      assert(firstStep.includes('page.getByTestId("users-table")'), 'should use table test id scope');
      assert(firstStep.includes('data-row-key=\\"user-42\\"') || firstStep.includes('data-row-key="user-42"'), 'should scope by row key');
      assert(firstStep.includes('getByRole("button", { name: "编辑" })'), 'should still click the row action by role/name');
      assert(!firstStep.includes('await page.getByRole("button", { name: "编辑" }).click();'), 'should not use global repeated button locator');
    },
  },
  {
    name: 'table row code preview scopes row target without nesting row locator inside itself',
    run: () => {
      const flow = mergeActionsIntoFlow(undefined, [rawClickAction('tr >> internal:has-text="Alice 管理员 编辑"i')], [], {});
      const scoped: BusinessFlow = {
        ...flow,
        steps: flow.steps.map(step => ({
          ...step,
          target: {
            ...step.target,
            role: 'row',
            name: 'Alice 管理员 编辑',
            text: 'Alice 管理员 编辑',
            displayName: 'Alice 管理员 编辑',
            scope: {
              table: {
                title: '用户列表',
                testId: 'users-table',
                rowKey: 'user-42',
                rowText: 'Alice 管理员 编辑',
                columnName: '操作',
              },
            },
          },
        })),
      };
      const firstStep = stepCodeBlock(generateBusinessFlowPlaywrightCode(scoped), 's001');

      assert(firstStep.includes('page.getByTestId("users-table").locator('), 'row target should start from table scope');
      assert(firstStep.includes('data-row-key=\\"user-42\\"') || firstStep.includes('data-row-key="user-42"'), 'row target should scope by row key');
      assert(firstStep.includes('.first().click();'), 'row target should click the scoped row directly');
      assert(!firstStep.includes('filter({ has: page.getByRole("row"'), 'row target should not look for a nested row inside the row');
    },
  },
  {
    name: 'runnable row click inherits table scope from adjacent non-runnable row context',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            action: 'click',
            target: {
              role: 'generic',
              text: 'Alice 管理员编辑',
              displayName: 'Alice 管理员编辑',
              scope: {
                table: {
                  title: '用户列表',
                  testId: 'users-table',
                  rowKey: 'user-42',
                  rowText: 'Alice 管理员 编辑',
                },
              },
            },
            sourceCode: '// s001 has no runnable Playwright action source.',
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            action: 'click',
            target: {
              role: 'row',
              name: 'Alice 管理员 编辑',
              text: 'Alice 管理员 编辑',
              displayName: 'row Alice 管理员 编辑',
            },
            assertions: [],
          },
        ],
      };
      const secondStep = stepCodeBlock(generateBusinessFlowPlaywrightCode(flow), 's002');

      assert(secondStep.includes('page.getByTestId("users-table").locator('), 'runnable row click should inherit table scope from adjacent page-context row');
      assert(secondStep.includes('data-row-key=\\"user-42\\"') || secondStep.includes('data-row-key="user-42"'), 'runnable row click should use inherited stable row key');
      assert(!secondStep.includes('await page.getByRole("row", { name: "Alice 管理员 编辑" }).click();'), 'runnable row click should not fall back to global row name');
    },
  },
  {
    name: 'dialog button code preview uses dialog scoped locator when button text repeats',
    run: () => {
      const flow = mergeActionsIntoFlow(undefined, [rawClickAction('div >> internal:has-text="确定"i >> nth=2')], [], {});
      const scoped: BusinessFlow = {
        ...flow,
        steps: flow.steps.map(step => ({
          ...step,
          target: {
            ...step.target,
            role: 'button',
            text: '确定',
            displayName: '确定',
            scope: {
              dialog: {
                type: 'modal',
                title: '新建用户',
                visible: true,
              },
            },
          },
        })),
      };
      const firstStep = stepCodeBlock(generateBusinessFlowPlaywrightCode(scoped), 's001');

      assert(firstStep.includes('page.locator(".ant-modal, .ant-drawer, [role=\\"dialog\\"]")'), 'should start from dialog scope');
      assert(firstStep.includes('filter({ hasText: "新建用户" })'), 'should filter dialog by title');
      assert(firstStep.includes('getByRole("button", { name: /^(确定|确\\s*定)$/ })'), 'should click confirm button inside dialog with whitespace-tolerant name matching');
    },
  },
  {
    name: 'context-light modal save button uses whitespace-tolerant name matching',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          action: 'click',
          target: {
            role: 'button',
            name: 'button 保 存',
            text: 'button 保 存',
          },
          context: {
            eventId: 'ctx-save',
            capturedAt: 1,
            before: {
              target: {
                tag: 'button',
                role: 'button',
                text: '保 存',
                normalizedText: '保 存',
                controlType: 'button',
              },
            },
          },
          assertions: [],
        }],
      };
      const firstStep = stepCodeBlock(generateBusinessFlowPlaywrightCode(flow), 's001');

      assert(firstStep.includes('page.locator(".ant-modal, .ant-drawer, [role=\\"dialog\\"]").last().getByRole("button", { name: /^(保存|保\\s*存)$/ })'), 'context-light modal save should tolerate AntD button text spacing');
      assert(!firstStep.includes('getByRole("button", { name: "保存" })'), 'context-light modal save should not require one exact spacing form');
    },
  },
  {
    name: 'AntD popconfirm button code preview uses popover scope instead of modal scope',
    run: () => {
      const flow = mergeActionsIntoFlow(undefined, [rawClickAction('div >> internal:role=tooltip[name="确 定"i]')], [], {});
      const scoped: BusinessFlow = {
        ...flow,
        steps: flow.steps.map(step => ({
          ...step,
          target: {
            ...step.target,
            role: 'tooltip',
            text: '确 定',
            displayName: '确 定',
            scope: {
              dialog: {
                type: 'popover',
                title: '删除此行？',
                visible: true,
              },
            },
          },
        })),
      };
      const firstStep = stepCodeBlock(generateBusinessFlowPlaywrightCode(scoped), 's001');

      assert(firstStep.includes('page.locator(".ant-popover:not(.ant-popover-hidden):not(.ant-zoom-big-leave):not(.ant-zoom-big-leave-active)")'), 'popconfirm should start from visible AntD popover scope');
      assert(firstStep.includes('filter({ hasText: "删除此行？" })'), 'popconfirm should filter explicit popover buttons by title');
      assert(firstStep.includes('getByRole("button", { name: /^(确定|确 定)$/ })') || firstStep.includes('getByRole("button", { name: /^(确定|确\\s*定)$/ })') || firstStep.includes('getByRole("button", { name: "确定" })') || firstStep.includes('getByRole("button", { name: "确 定" })'), 'popconfirm should click the confirm button');
      assert(!firstStep.includes('page.locator(".ant-modal, .ant-drawer, [role=\\"dialog\\"]")'), 'popconfirm should not be scoped to modal/drawer');
    },
  },
  {
    name: 'AntD popconfirm tooltip fallback clicks the visible popover confirm button',
    run: () => {
      const flow = mergeActionsIntoFlow(undefined, [rawClickAction('div >> internal:role=tooltip[name="确 定"i]')], [], {});
      const firstStep = stepCodeBlock(generateBusinessFlowPlaywrightCode(flow), 's001');

      assert(firstStep.includes('page.locator(".ant-popover:not(.ant-popover-hidden):not(.ant-zoom-big-leave):not(.ant-zoom-big-leave-active):has(.ant-popconfirm-buttons)").last().getByRole("button", { name: /^(确定|确 定)$/ }).click();'), 'tooltip target should click a visible AntD Popconfirm root with buttons, not an arbitrary popover or tooltip container');
      assert(!firstStep.includes('page.getByRole("tooltip", { name: "确 定" }).click();'), 'tooltip role click is not a runnable confirmation target');
    },
  },
  {
    name: 'generic confirm button falls back to the top visible dialog instead of page global role',
    run: () => {
      const flow = mergeActionsIntoFlow(undefined, [rawClickAction('internal:role=button[name="确 定"i]')], recordedSource([
        `await page.getByRole('button', { name: '确 定' }).click();`,
      ]), {});
      const genericConfirm: BusinessFlow = {
        ...flow,
        steps: flow.steps.map(step => ({
          ...step,
          target: {
            ...step.target,
            role: 'button',
            text: '确 定',
            displayName: 'button 确 定',
          },
        })),
      };
      const firstStep = stepCodeBlock(generateBusinessFlowPlaywrightCode(genericConfirm), 's001');

      assert(firstStep.includes('.ant-modal:not(.ant-zoom-big-leave)'), 'generic confirm should target the top visible dialog first');
      assert(firstStep.includes('getByRole("button", { name: /^(确定|确 定|确认|OK|Ok|ok|Yes|yes)$/ })'), 'generic confirm should use a dialog-scoped confirmation button regex');
      assert(!firstStep.includes(`page.getByRole('button', { name: '确 定' }).click();`), 'generic confirm should not keep the page-global role locator');
    },
  },
  {
    name: 'AntD delete test id synthesizes popconfirm confirmation and drops synthetic echo click',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            action: 'click',
            target: {
              testId: 'wan-transport-row-delete-action',
              displayName: '确 定',
              raw: { uniqueness: { pageCount: 2, pageIndex: 1 } },
            },
            context: {
              eventId: 'ctx-delete',
              capturedAt: 1000,
              before: {
                dialog: { type: 'modal', title: '编辑WAN2', visible: true },
                target: {
                  tag: 'a',
                  testId: 'wan-transport-row-delete-action',
                  framework: 'antd',
                  controlType: 'link',
                  uniqueness: { pageCount: 2, pageIndex: 1 },
                },
              },
              after: { dialog: { type: 'popover', title: '删除此行？', visible: true } },
            },
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            action: 'click',
            target: {
              role: 'tooltip',
              displayName: 'tooltip 确 定',
              name: 'tooltip 确 定',
            },
            sourceCode: 'await page.locator(".ant-popover:not(.ant-popover-hidden):not(.ant-zoom-big-leave):not(.ant-zoom-big-leave-active)").last().getByRole("button", { name: /^(确定|确 定)$/ }).click();',
            context: {
              eventId: 'ctx-popconfirm-ok',
              capturedAt: 1500,
              before: {
                dialog: { type: 'popover', title: '删除此行？', visible: true },
                target: { tag: 'div', role: 'tooltip', framework: 'antd', controlType: 'button', text: '确 定' },
              },
            },
            assertions: [],
          },
          {
            id: 's003',
            order: 3,
            action: 'click',
            target: { testId: 'wan-config-confirm', displayName: '确定' },
            context: {
              eventId: 'ctx-confirm',
              capturedAt: 2000,
              before: {
                dialog: { type: 'modal', title: '编辑WAN2', visible: true },
                target: { tag: 'button', testId: 'wan-config-confirm', framework: 'antd', controlType: 'button' },
              },
            },
            assertions: [],
          },
          {
            id: 's004',
            order: 4,
            action: 'click',
            target: { testId: 'wan-config-confirm', displayName: 'testId wan-config-confirm' },
            context: {
              eventId: 'ctx-confirm-echo',
              capturedAt: 2050,
              before: {
                dialog: { type: 'modal', title: '编辑WAN2', visible: true },
                target: { tag: 'button', testId: 'wan-config-confirm', framework: 'antd', controlType: 'button' },
              },
            },
            assertions: [],
          },
          {
            id: 's005',
            order: 5,
            action: 'click',
            target: { role: 'button', displayName: 'button 确 定', name: '确 定' },
            context: {
              eventId: 'ctx-dialog-confirm-echo',
              capturedAt: 2100,
              before: {
                dialog: { type: 'modal', title: '编辑WAN2', visible: true },
                target: { tag: 'button', role: 'button', framework: 'antd', controlType: 'button', text: '确 定' },
              },
            },
            assertions: [],
          },
        ],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      const playbackCode = generateBusinessFlowPlaybackCode(flow);

      assert(code.includes('page.locator(".ant-modal, .ant-drawer, [role=\\"dialog\\"]").filter({ hasText: "编辑WAN2" }).getByTestId("wan-transport-row-delete-action").click();'), 'delete action should click the row delete control inside the dialog instead of using a page-level nth');
      assert(!code.includes('page.getByTestId("wan-transport-row-delete-action").nth(1).click();'), 'dialog-owned delete action should not keep a page-level duplicate ordinal');
      assert(code.includes('page.locator(".ant-popover:not(.ant-popover-hidden):not(.ant-zoom-big-leave):not(.ant-zoom-big-leave-active)").filter({ hasText: "删除此行？" }).getByRole("button", { name: /^(确定|确 定)$/ }).click();'), 'normal export should use the captured AntD popconfirm title when it is available');
      assert(code.includes('page.locator(".ant-popover:not(.ant-popover-hidden):not(.ant-zoom-big-leave):not(.ant-zoom-big-leave-active)").filter({ hasText: "删除此行？" }).waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});'), 'normal export should wait for the captured popconfirm to close');
      assertEqual((code.match(/ant-popover[^\n]+getByRole\("button", \{ name: \/\^\(确定\|确 定\)\$\/ \}\)\.click\(\);/g) || []).length, 1);
      assert(!code.includes('page.getByRole("button", { name: "确 定" }).click();'), 'dialog confirm echo should not fall back to a page-global ambiguous role locator');
      assertEqual((code.match(/getByTestId\("wan-config-confirm"\)\.click\(\);/g) || []).length, 1);
      assert(playbackCode.includes('page.locator(".ant-modal, .ant-drawer, [role=\\"dialog\\"]").filter({ hasText: "编辑WAN2" }).getByTestId("wan-transport-row-delete-action").click();'), 'runtime playback should keep the dialog-scoped delete click');
      const runtimeWaitIndex = playbackCode.indexOf('page.waitForTimeout(300)');
      const runtimePopoverConfirmIndex = playbackCode.indexOf('page.locator(".ant-popover:not(.ant-popover-hidden):not(.ant-zoom-big-leave):not(.ant-zoom-big-leave-active):has(.ant-popconfirm-buttons)").last().getByRole("button", { name: /^(确定|确 定)$/ }).click();');
      assert(runtimeWaitIndex >= 0, 'runtime playback should give the AntD Popconfirm animation a parser-safe boundary');
      assert(runtimePopoverConfirmIndex > runtimeWaitIndex, 'runtime playback should confirm a visible AntD Popconfirm root with buttons after the parser-safe boundary');
      assert(!playbackCode.includes('.catch('), 'runtime playback should not include unsupported catch continuations');
    },
  },
  {
    name: 'AntD delete test id skips explicit popconfirm confirm after repeated opener echo clicks',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            action: 'click',
            target: {
              testId: 'ha-wan-transport-row-delete-action',
              displayName: 'HS Internet default',
            },
            context: {
              eventId: 'ctx-delete',
              capturedAt: 1000,
              before: {
                dialog: { type: 'modal', title: '编辑 WAN1 共享 WAN', visible: true },
                target: {
                  tag: 'a',
                  testId: 'ha-wan-transport-row-delete-action',
                  framework: 'antd',
                  controlType: 'link',
                },
              },
              after: { openedDialog: { type: 'popover', title: '删除此行？', visible: true } },
            },
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            action: 'click',
            target: {
              testId: 'ha-wan-transport-row-delete-action',
              displayName: 'testId ha-wan-transport-row-delete-action',
            },
            context: {
              eventId: 'ctx-delete-echo-1',
              capturedAt: 1100,
              before: {
                dialog: { type: 'modal', title: '编辑 WAN1 共享 WAN', visible: true },
                target: {
                  tag: 'a',
                  testId: 'ha-wan-transport-row-delete-action',
                  framework: 'antd',
                  controlType: 'link',
                },
              },
            },
            assertions: [],
          },
          {
            id: 's003',
            order: 3,
            action: 'click',
            target: {
              testId: 'ha-wan-transport-row-delete-action',
              displayName: 'testId ha-wan-transport-row-delete-action',
            },
            context: {
              eventId: 'ctx-delete-echo-2',
              capturedAt: 1200,
              before: {
                dialog: { type: 'modal', title: '编辑 WAN1 共享 WAN', visible: true },
                target: {
                  tag: 'a',
                  testId: 'ha-wan-transport-row-delete-action',
                  framework: 'antd',
                  controlType: 'link',
                },
              },
            },
            assertions: [],
          },
          {
            id: 's004',
            order: 4,
            action: 'click',
            target: {
              role: 'tooltip',
              displayName: 'tooltip 确 定',
              name: 'tooltip 确 定',
            },
            sourceCode: 'await page.locator(".ant-popover:not(.ant-popover-hidden):not(.ant-zoom-big-leave):not(.ant-zoom-big-leave-active)").last().getByRole("button", { name: /^(确定|确 定)$/ }).click();',
            context: {
              eventId: 'ctx-popconfirm-ok',
              capturedAt: 1300,
              before: {
                dialog: { type: 'popover', title: '删除此行？', visible: true },
                target: { tag: 'div', role: 'tooltip', framework: 'antd', controlType: 'button', text: '确 定' },
              },
            },
            assertions: [],
          },
        ],
      };

      const code = generateBusinessFlowPlaywrightCode(flow);
      const playbackCode = generateBusinessFlowPlaybackCode(flow);

      assertEqual((code.match(/ant-popover[^\n]+getByRole\("button", \{ name: \/\^\(确定\|确 定\)\$\/ \}\)\.click\(\);/g) || []).length, 1);
      assertEqual((playbackCode.match(/ant-popover[^\n]+getByRole\("button", \{ name: \/\^\(确定\|确 定\)\$\/ \}\)\.click\(\);/g) || []).length, 1);
      assertEqual(countParserSafeBusinessFlowActions(flow), countParserSafeBusinessFlowActions({ ...flow, steps: [flow.steps[0]] }));
    },
  },
  {
    name: 'AntD delete test id falls back to zh-CN popconfirm ok when the popover title is captured',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          action: 'click',
          target: { testId: 'wan-transport-row-delete-action', displayName: 'wan-transport-row-delete-action' },
          context: {
            eventId: 'ctx-delete',
            capturedAt: 1000,
            before: { target: { tag: 'a', testId: 'wan-transport-row-delete-action', framework: 'antd', controlType: 'link' } },
            after: { dialog: { type: 'popover', title: '删除此行？', visible: true } },
          },
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);

      assert(code.includes('page.getByTestId("wan-transport-row-delete-action").nth(1).click();') || code.includes('page.getByTestId("wan-transport-row-delete-action").click();'), 'delete action should still replay the recorded delete click');
      assert(code.includes('page.locator(".ant-popover:not(.ant-popover-hidden):not(.ant-zoom-big-leave):not(.ant-zoom-big-leave-active)").filter({ hasText: "删除此行？" }).getByRole("button", { name: /^(确定|确 定)$/ }).click();'), 'normal export should keep the captured AntD popconfirm title scope even if the recorder missed the button label');
      const playbackCode = generateBusinessFlowPlaybackCode(flow);
      assert(playbackCode.includes('page.locator(".ant-popover:not(.ant-popover-hidden):not(.ant-zoom-big-leave):not(.ant-zoom-big-leave-active):has(.ant-popconfirm-buttons)").last().getByRole("button", { name: /^(确定|确 定)$/ }).click();'), 'runtime playback should confirm a visible AntD Popconfirm root with buttons without title coupling');
      assert(!playbackCode.includes('filter({ hasText: "删除此行？" }).getByRole("button", { name: /^(确定|确 定)$/ }).click();'), 'runtime playback should not depend on the Popconfirm title');
    },
  },
  {
    name: 'plain delete test id does not synthesize popconfirm confirmation without popover evidence',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          action: 'click',
          target: { testId: 'plain-delete-button', displayName: 'plain-delete-button' },
          context: {
            eventId: 'ctx-delete',
            capturedAt: 1000,
            before: { target: { tag: 'button', testId: 'plain-delete-button', controlType: 'button' } },
          },
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);

      assert(!code.includes('getByRole("button", { name: "确 定" })'), 'missing Popconfirm evidence should not hard-code a confirm label');
      assert(!code.includes('getByRole("button", { name: /^(确定|确 定)$/ })'), 'missing Popconfirm evidence should not guess a confirm label');
    },
  },
  {
    name: 'explicit Popconfirm confirmation is not skipped when the previous delete did not synthesize confirmation',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            action: 'click',
            target: { testId: 'plain-delete-button', displayName: '删除' },
            context: {
              eventId: 'ctx-delete',
              capturedAt: 1000,
              before: { target: { tag: 'button', testId: 'plain-delete-button', controlType: 'button' } },
            },
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            action: 'click',
            target: { role: 'tooltip', displayName: '确 定', name: '确 定' },
            rawAction: { name: 'click', selector: '.ant-popover >> internal:role=button[name="确 定"i]' },
            context: {
              eventId: 'ctx-explicit-confirm',
              capturedAt: 1100,
              before: { target: { tag: 'button', role: 'tooltip', text: '确 定', controlType: 'button' } },
            },
            assertions: [],
          },
        ],
      };

      const code = generateBusinessFlowPlaywrightCode(flow);

      assert(code.includes('page.locator(".ant-popover:not(.ant-popover-hidden):not(.ant-zoom-big-leave):not(.ant-zoom-big-leave-active):has(.ant-popconfirm-buttons)").last().getByRole("button", { name: /^(确定|确 定)$/ }).click();'), 'explicit Popconfirm confirmation should remain when the previous delete did not synthesize it and should target a Popconfirm root');
      assertEqual((code.match(/ant-popover[^\n]+getByRole\("button", \{ name: \/\^\(确定\|确 定\)\$\/ \}\)\.click\(\);/g) || []).length, 1);
    },
  },
  {
    name: 'AntD row delete action uses captured opened popover after-state to synthesize confirmation',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          action: 'click',
          target: { testId: 'wan-transport-row-delete-action', displayName: 'Nova专线 default' },
          context: {
            eventId: 'ctx-delete',
            capturedAt: 1000,
            before: {
              target: { tag: 'a', testId: 'wan-transport-row-delete-action', framework: 'antd', controlType: 'link' },
              table: { title: 'WAN传输网络', testId: 'wan-transport-table', rowKey: 'wan-nova-default', rowText: 'Nova专线 default' },
            },
            after: { openedDialog: { type: 'popover', title: '删除此行？', visible: true } },
          },
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);

      assert(code.includes('page.getByTestId("wan-transport-table").locator("tr[data-row-key=\\"wan-nova-default\\"], [data-row-key=\\"wan-nova-default\\"]").first().getByTestId("wan-transport-row-delete-action").click();'), 'row delete with reusable test id should use stable rowKey scope when available');
      assert(!code.includes('await page.getByTestId("wan-transport-row-delete-action").click();'), 'reusable row delete should not replay as an ambiguous global test id');
      assert(code.includes('page.locator(".ant-popover:not(.ant-popover-hidden):not(.ant-zoom-big-leave):not(.ant-zoom-big-leave-active)").filter({ hasText: "删除此行？" }).getByRole("button", { name: /^(确定|确 定)$/ }).click();'), 'AntD row delete should use the captured opened popover to confirm');
    },
  },
  {
    name: 'repeated Popconfirm opener clicks on the same row are emitted once',
    run: () => {
      const repeatedDelete = (id: string, order: number): FlowStep => ({
        id,
        order,
        action: 'click',
        target: {
          testId: 'resource-row-delete-action',
          displayName: 'Resource A 删除',
          scope: { table: { testId: 'resource-table', rowKey: 'resource-a', rowText: 'Resource A active 删除' } },
        },
        context: {
          eventId: `ctx-${id}`,
          capturedAt: 1000 + order,
          before: {
            table: { testId: 'resource-table', rowKey: 'resource-a', rowText: 'Resource A active 删除' },
            target: { tag: 'a', testId: 'resource-row-delete-action', framework: 'antd', controlType: 'link', text: '删除' },
          },
          after: { openedDialog: { type: 'popover', title: '删除此行？', visible: true } },
        },
        assertions: id === 's001' ? [createTerminalStateAssertion('row-not-exists', 'a-row-gone', { tableTestId: 'resource-table', rowKey: 'resource-a' })] : [],
      });
      const repeatedFlow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [repeatedDelete('s001', 1), repeatedDelete('s002', 2), repeatedDelete('s003', 3)],
      };
      const code = generateBusinessFlowPlaywrightCode(repeatedFlow);
      const playbackCode = generateBusinessFlowPlaybackCode(repeatedFlow);

      assertEqual((code.match(/resource-row-delete-action/g) || []).length, 1);
      assertEqual((playbackCode.match(/resource-row-delete-action/g) || []).length, 1);
      assert(code.includes('row-key') || code.includes('resource-a'), 'terminal row assertion should stay attached to the remaining delete step');
      assert(code.includes('not.toBeVisible();'), 'row-not-exists terminal assertion should still be emitted after dedupe');

      const deleteRow = (id: string, order: number, rowKey: string, rowText: string): FlowStep => {
        const base = repeatedDelete(id, order);
        return {
          ...base,
          target: {
            ...base.target,
            displayName: `${rowText} 删除`,
            scope: { table: { testId: 'resource-table', rowKey, rowText } },
          },
          context: {
            eventId: base.context!.eventId,
            capturedAt: base.context!.capturedAt,
            before: {
              ...base.context!.before,
              table: { testId: 'resource-table', rowKey, rowText },
            },
            after: base.context!.after,
          },
          assertions: [],
        };
      };
      const differentRowsFlow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [deleteRow('s010', 10, 'resource-a', 'Resource A active'), deleteRow('s011', 11, 'resource-b', 'Resource B active')],
      };
      const differentRowsCode = generateBusinessFlowPlaywrightCode(differentRowsFlow);
      assertEqual((differentRowsCode.match(/resource-row-delete-action/g) || []).length, 2);
    },
  },
  {
    name: 'second modal confirmation after submit remains scoped and is not skipped',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            action: 'click',
            target: {
              testId: 'config-submit-confirm',
              displayName: '确定',
              scope: { dialog: { type: 'modal', title: '编辑配置', visible: true } },
            },
            context: {
              eventId: 'ctx-submit',
              capturedAt: 1000,
              before: { dialog: { type: 'modal', title: '编辑配置', visible: true }, target: { tag: 'button', testId: 'config-submit-confirm', controlType: 'button' } },
              after: { openedDialog: { type: 'modal', title: '二次确认', visible: true } },
            },
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            action: 'click',
            target: { role: 'button', name: '确 定', displayName: '确 定', scope: { dialog: { type: 'modal', title: '二次确认', visible: true } } },
            context: {
              eventId: 'ctx-second-confirm',
              capturedAt: 1100,
              before: { dialog: { type: 'modal', title: '二次确认', visible: true }, target: { tag: 'button', role: 'button', text: '确 定', controlType: 'button' } },
            },
            assertions: [],
          },
        ],
      };

      const code = generateBusinessFlowPlaywrightCode(flow);

      assert(code.includes('page.locator(".ant-modal, .ant-drawer, [role=\\"dialog\\"]").filter({ hasText: "二次确认" }).getByRole("button", { name: /^(确定|确\\s*定)$/ }).click();'), 'real second modal confirmation should be kept and scoped to the active dialog');
      assert(!code.includes('page.getByRole("button", { name: "确 定" }).click();'), 'second modal confirmation should not use a page-global ambiguous role locator');
    },
  },
  {
    name: 'section button code preview uses section scope when no test id and repeated button text',
    run: () => {
      const flow = mergeActionsIntoFlow(undefined, [rawClickAction('div >> internal:has-text="新建"i >> nth=3')], [], {});
      const scoped: BusinessFlow = {
        ...flow,
        steps: flow.steps.map(step => ({
          ...step,
          target: {
            ...step.target,
            role: 'button',
            text: '新建',
            displayName: '新建',
            scope: {
              section: {
                title: '地址池',
                testId: 'address-pool-card',
              },
            },
          },
        })),
      };
      const firstStep = stepCodeBlock(generateBusinessFlowPlaywrightCode(scoped), 's001');

      assert(firstStep.includes('page.getByTestId("address-pool-card").getByRole("button", { name: "新建" })'), 'should use section scoped role locator');
    },
  },
  {
    name: 'late page context upgrades recorded action without creating synthetic duplicate',
    run: () => {
      const wallTime = Date.now();
      const recorded = mergeActionsIntoFlow(undefined, [
        {
          action: {
            name: 'click',
            selector: 'div >> internal:has-text="新建"i >> nth=1',
          },
          wallTime,
        },
      ], [], {});
      const contextEvent = pageClickEventWithTarget('ctx-testid', wallTime + 200, {
        tag: 'button',
        role: 'button',
        testId: 'site-ip-port-pool-create-button',
        text: '新建',
        normalizedText: '新建',
        framework: 'antd',
        controlType: 'button',
        locatorQuality: 'testid',
      } as ElementContext);
      const withContext = mergePageContextIntoFlow(recorded, [contextEvent]);
      const afterSyntheticFlush = appendSyntheticPageContextSteps(withContext, [contextEvent]);

      assertEqual(afterSyntheticFlush.steps.length, 1);
      assertEqual(afterSyntheticFlush.steps[0].target?.testId, 'site-ip-port-pool-create-button');
    },
  },
  {
    name: 'late recorder click upgrades a synthetic page context click in place',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [
        clickAction('保存配置'),
      ], [], {});
      const wallTime = Date.now() - 2000;
      const synthetic = appendSyntheticPageContextSteps(initial, [
        pageClickEventWithTarget('ctx-button', wallTime, {
          tag: 'button',
          role: 'button',
          testId: 'site-ip-port-pool-create-button',
          text: '新建',
          normalizedText: '新建',
        }),
      ]);
      const recorded = mergeActionsIntoFlow(synthetic, [
        clickAction('保存配置'),
        testIdClickAction('site-ip-port-pool-create-button', wallTime + 400),
      ], [], {
        appendNewActions: true,
        insertBaseActionCount: 1,
      });

      assertEqual(recorded.steps.map(step => step.id), ['s001', 's002']);
      assertEqual(recorded.steps[1].kind, 'recorded');
      assertEqual(recorded.steps[1].target?.testId, 'site-ip-port-pool-create-button');
      assertEqual(recorded.steps[1].sourceActionIds?.length, 1);
    },
  },
  {
    name: 'page context click is not synthesized when recorder action exists nearby',
    run: () => {
      const wallTime = Date.now();
      const initial = mergeActionsIntoFlow(undefined, [
        clickActionWithWallTime('新建', wallTime),
      ], [], {});
      const withSynthetic = appendSyntheticPageContextSteps(initial, [pageClickEvent('ctx-new', wallTime + 200, '新建')]);

      assertEqual(withSynthetic.steps.length, 1);
      assertEqual(withSynthetic.steps[0].target?.name, '新建');
    },
  },
  {
    name: 'recorder action merge skips non-interactive structural container test id clicks',
    run: () => {
      const wallTime = Date.now();
      const flow = mergeActionsIntoFlow(undefined, [
        testIdClickAction('site-global-ip-pools-section', wallTime),
        testIdClickAction('site-ip-port-pool-create-button', wallTime + 200),
      ], [], {});

      assertEqual(flow.steps.map(step => step.target?.testId), ['site-ip-port-pool-create-button']);
      assertEqual(flow.artifacts?.recorder?.actionLog.length, 1);
    },
  },
  {
    name: 'weak page context text click is suppressed by nearby strong recorder click',
    run: () => {
      const wallTime = Date.now();
      const initial = mergeActionsIntoFlow(undefined, [
        testIdClickAction('site-ip-port-pool-create-button', wallTime),
      ], [], {});
      const withSynthetic = appendSyntheticPageContextSteps(initial, [
        pageClickEventWithTarget('ctx-weak-new', wallTime + 260, {
          tag: 'span',
          text: '新建',
          normalizedText: '新建',
        }),
      ]);

      assertEqual(withSynthetic.steps.length, 1);
      assertEqual(withSynthetic.steps[0].target?.testId, 'site-ip-port-pool-create-button');
    },
  },
  {
    name: 'synthetic page context insert respects the requested anchor',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [
        clickAction('保存配置'),
        clickAction('打开端口池'),
      ], [], {});
      const result = appendSyntheticPageContextStepsWithResult(initial, [
        pageClickEventWithTarget('ctx-new-port-pool', Date.now() - 2000, {
          tag: 'button',
          role: 'button',
          testId: 'site-ip-port-pool-create-button',
          text: '新建',
          normalizedText: '新建',
        }),
      ], { insertAfterStepId: 's001' });

      assertEqual(result.insertedStepIds.length, 1);
      assertEqual(result.flow.steps.map(step => step.id), ['s001', 's003', 's002']);
      assertEqual(result.flow.steps[1].target?.testId, 'site-ip-port-pool-create-button');
      assertEqual(result.flow.steps.find(step => step.id === 's002')?.target?.name, '打开端口池');
    },
  },
  {
    name: 'append-mode synthetic page context events stay after existing steps',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [
        clickAction('打开新建弹窗'),
        fillAction('地址池名称', 'test1'),
      ], [], {});
      const result = appendSyntheticPageContextStepsWithResult(initial, [
        pageClickEventWithTarget('ctx-save', Date.now() - 10_000, {
          tag: 'button',
          role: 'button',
          testId: 'site-save-button',
          text: '保存配置',
          normalizedText: '保存配置',
        }),
      ], { insertAfterStepId: initial.steps[initial.steps.length - 1].id });

      assertEqual(result.insertedStepIds.length, 1);
      assertEqual(result.flow.steps.map(step => step.id), ['s001', 's002', 's003']);
      assertEqual(result.flow.steps[2].target?.testId, 'site-save-button');
    },
  },
  {
    name: 'late recorded actions stay before later synthetic page context clicks by wall time',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [
        clickActionWithWallTime('打开新建弹窗', 1000),
      ], [], {});
      const withSynthetic = appendSyntheticPageContextSteps(initial, [
        pageClickEventWithTarget('ctx-cascader-option', 3000, {
          tag: 'li',
          role: 'menuitem',
          controlType: 'cascader-option',
          text: '上海',
          normalizedText: '上海',
        }),
      ]);
      const merged = mergeActionsIntoFlow(withSynthetic, [
        clickActionWithWallTime('打开新建弹窗', 1000),
        fillActionWithWallTime('关联VRF', '生产', 2000),
      ], [], {});

      assertEqual(merged.steps.map(step => step.id), ['s001', 's003', 's002']);
      assertEqual(merged.steps.map(step => step.value), [undefined, '生产', undefined]);
      assertEqual(merged.steps[2].target?.text, '上海');
    },
  },
  {
    name: 'recorded action batch preserves recorder order when wallTime is skewed',
    run: () => {
      const flow = mergeActionsIntoFlow(undefined, [
        testIdClickAction('network-resource-add', 1000),
        testIdClickAction('network-resource-save', 1100),
        fillActionWithWallTime('服务名称', 'https-admin', 3000),
        fillActionWithWallTime('监听端口', '8443', 3100),
        fillActionWithWallTime('填写策略备注', 'ProFormField 全量组合录制', 3200),
        testIdClickAction('network-resource-save', 2000),
      ], [], {});
      const code = generateBusinessFlowPlaywrightCode(flow);

      assertEqual(flow.steps.map(step => step.target?.testId || step.value), [
        'network-resource-add',
        'network-resource-save',
        'https-admin',
        '8443',
        'ProFormField 全量组合录制',
        'network-resource-save',
      ]);
      assertTextInOrder(code, [
        'network-resource-add',
        'network-resource-save',
        'https-admin',
        '8443',
        'ProFormField 全量组合录制',
        'network-resource-save',
      ]);
    },
  },
  {
    name: 'recorded action batch with first untimed draft uses first timed draft for synthetic-relative insertion',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [
        clickActionWithWallTime('打开新建弹窗', 1000),
      ], [], {});
      const withSynthetic = appendSyntheticPageContextSteps(initial, [
        pageClickEventWithTarget('ctx-cascader-option', 3000, {
          tag: 'div',
          role: 'menuitem',
          controlType: 'cascader-option',
          text: '上海',
          normalizedText: '上海',
        }),
      ]);
      const merged = mergeActionsIntoFlow(withSynthetic, [
        clickActionWithWallTime('打开新建弹窗', 1000),
        clickAction('无时间戳动作'),
        fillActionWithWallTime('关联VRF', '生产', 2000),
      ], [], {});

      assertEqual(merged.steps.map(step => step.target?.name || step.value || step.target?.text), [
        '打开新建弹窗',
        '无时间戳动作',
        '生产',
        '上海',
      ]);
    },
  },
  {
    name: 'synthetic submit relocation keeps popup trigger and option adjacency',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [
        testIdClickAction('network-resource-add', 1000),
      ], [], {});
      const syntheticSave: BusinessFlow = {
        ...initial,
        steps: [
          ...initial.steps,
          {
            id: 's002',
            order: 2,
            kind: 'manual',
            sourceActionIds: [],
            action: 'click',
            target: { testId: 'network-resource-save', role: 'button', name: '保存', text: '保存' },
            rawAction: {
              syntheticContextEventId: 'ctx-final-save',
              syntheticContextEventWallTime: 3000,
            },
            context: {
              eventId: 'ctx-final-save',
              capturedAt: 3000,
              before: {
                target: {
                  tag: 'button',
                  role: 'button',
                  testId: 'network-resource-save',
                  text: '保存',
                  normalizedText: '保存',
                },
              },
            },
            sourceCode: 'await page.getByTestId("network-resource-save").click();',
            assertions: [],
          },
        ],
      };
      const merged = mergeActionsIntoFlow(syntheticSave, [
        testIdClickAction('network-resource-add', 1000),
        clickAction('打开关联VRF'),
        fillActionWithWallTime('关联VRF', '生产VRF', 2000),
      ], [], {
        appendNewActions: true,
        insertAfterStepId: 's002',
        insertBaseActionCount: 1,
      });

      assertEqual(merged.steps.map(step => step.target?.testId || step.target?.name || step.target?.text || step.value), [
        'network-resource-add',
        '打开关联VRF',
        '生产VRF',
        'network-resource-save',
      ]);
    },
  },
  {
    name: 'late recorded fields are restored before a later synthetic submit click',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [
        testIdClickAction('network-resource-add', 1000),
        testIdClickAction('network-resource-save', 1100),
        fillActionWithWallTime('地址池名称', 'pool-proform-alpha', 1200),
      ], [], {});
      const withSyntheticSubmit: BusinessFlow = {
        ...initial,
        steps: [
          ...initial.steps,
          {
            ...initial.steps[1],
            id: 's004',
            order: 4,
            kind: 'manual',
            sourceActionIds: [],
            rawAction: {
              syntheticContextEventId: 'ctx-final-save',
              syntheticContextEventWallTime: 3000,
            },
            context: {
              eventId: 'ctx-final-save',
              capturedAt: 3000,
              before: {
                target: {
                  tag: 'button',
                  role: 'button',
                  testId: 'network-resource-save',
                  text: '保 存',
                  normalizedText: '保 存',
                },
              },
            },
            target: {
              testId: 'network-resource-save',
              role: 'button',
              name: '保 存',
              text: '保 存',
            },
            sourceCode: 'await page.getByTestId("network-resource-save").click();',
          },
        ],
      };
      const merged = mergeActionsIntoFlow(withSyntheticSubmit, [
        testIdClickAction('network-resource-add', 1000),
        testIdClickAction('network-resource-save', 1100),
        fillActionWithWallTime('地址池名称', 'pool-proform-alpha', 1200),
        fillActionWithWallTime('探测地址', 'https://probe.example/health', 2000),
        fillActionWithWallTime('服务名称', 'https-admin', 2100),
        fillActionWithWallTime('监听端口', '8443', 2200),
      ], [], {
        appendNewActions: true,
        insertBaseActionCount: 3,
      });
      const code = generateBusinessFlowPlaywrightCode(merged);

      assertTextInOrder(code, [
        'network-resource-add',
        'network-resource-save',
        'pool-proform-alpha',
        'https://probe.example/health',
        'https-admin',
        '8443',
        'network-resource-save',
      ]);
    },
  },
  {
    name: 'synthetic page context click orders before recorded fill using end wall time',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [
        fillActionWithEndWallTime('探测地址', 'https://probe.example/health', 3000),
      ], [], {});
      const withSynthetic = appendSyntheticPageContextSteps(initial, [
        pageClickEventWithTarget('ctx-health-switch', 2000, {
          tag: 'button',
          role: 'switch',
          testId: 'network-resource-health-switch',
          text: '启用健康检查',
          normalizedText: '启用健康检查',
          controlType: 'switch',
        }),
      ]);

      assertEqual(withSynthetic.steps.map(step => step.id), ['s002', 's001']);
      assertEqual(withSynthetic.steps.map(step => step.target?.testId || step.value), ['network-resource-health-switch', 'https://probe.example/health']);
    },
  },
  {
    name: 'same-event choice clicks keep one replay action inside repeat segments',
    run: () => {
      const eventId = 'ctx-health-switch';
      const choiceContext: StepContextSnapshot = {
        eventId,
        capturedAt: 2000,
        before: {
          form: { label: '启用健康检查' },
          target: { tag: 'button', role: 'switch', testId: 'network-resource-health-switch', controlType: 'button' },
        },
      };
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's030',
            order: 1,
            kind: 'manual',
            action: 'click',
            sourceActionIds: [],
            target: { testId: 'network-resource-health-switch', role: 'switch', label: '启用健康检查' },
            context: choiceContext,
            rawAction: { syntheticContextEventId: eventId, syntheticContextEventWallTime: 2000 },
            assertions: [],
          },
          {
            id: 's013',
            order: 2,
            kind: 'recorded',
            action: 'click',
            sourceActionIds: ['act_000013'],
            target: { testId: 'network-resource-health-switch', role: 'switch', label: '启用健康检查' },
            context: choiceContext,
            rawAction: { wallTime: 2000, action: { name: 'click', selector: 'internal:text="启用健康检查"i' } },
            assertions: [],
          },
          {
            id: 's018',
            order: 3,
            kind: 'manual',
            action: 'click',
            sourceActionIds: [],
            target: { testId: 'network-resource-health-switch', role: 'switch', label: '启用健康检查' },
            context: choiceContext,
            rawAction: { syntheticContextEventId: eventId, syntheticContextEventWallTime: 2000 },
            assertions: [],
          },
          {
            id: 's014',
            order: 4,
            kind: 'recorded',
            action: 'fill',
            sourceActionIds: ['act_000014'],
            target: { testId: 'network-resource-health-url', role: 'textbox', label: '探测地址' },
            value: 'https://probe.example/health',
            rawAction: { wallTime: 2200, action: { name: 'fill', selector: 'internal:testid=[data-testid="network-resource-health-url"s]', text: 'https://probe.example/health' } },
            assertions: [],
          },
        ],
      };
      const segment = createRepeatSegment(flow, flow.steps.map(step => step.id));
      const repeated = { ...flow, repeatSegments: [{ ...segment, parameters: [], rows: [{ id: 'row-1', values: {} }] }] };
      const code = generateBusinessFlowPlaywrightCode(repeated);
      const switchClicks = code.match(/network-resource-health-switch"\)\.click/g) || [];

      assertEqual(switchClicks.length, 1);
      assert(code.includes('network-resource-health-url'), 'the dependent health URL fill should remain after choice dedupe');
    },
  },
  {
    name: 'continuation batch drops navigation signals between new user actions',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [clickAction('打开')], [], {});
      const continued = mergeActionsIntoFlow(initial, [
        clickAction('打开'),
        clickAction('保存配置'),
        navigateAction('https://nova-sdwan.example.com/site/edit/basic-info?p=true'),
        clickAction('新增IP端口池'),
      ], [], {
        appendNewActions: true,
        insertBaseActionCount: 1,
      });

      assertEqual(continued.steps.map(step => step.action), ['click', 'click', 'click']);
      assertEqual(continued.steps.map(step => step.target?.name), ['打开', '保存配置', '新增IP端口池']);
    },
  },
  {
    name: 'repeat segment code keeps following steps outside the loop',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [
        fillAction('地址池名称', 'pool-a'),
        fillAction('开始地址', '1.1.1.1'),
        clickAction('保存配置'),
      ], recordedSource([
        `await page.getByLabel('地址池名称').fill('pool-a');`,
        `await page.getByLabel('开始地址').fill('1.1.1.1');`,
        `await page.getByRole('button', { name: '保存配置' }).click();`,
      ]), {});
      const segment = createRepeatSegment(initial, ['s001', 's002']);
      const flow: BusinessFlow = {
        ...initial,
        repeatSegments: [segment],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      const loopCloseIndex = code.indexOf('\n  }\n');
      const postRepeatStepIndex = code.indexOf('// s003');

      assert(loopCloseIndex > 0, 'repeat loop should be emitted');
      assert(postRepeatStepIndex > loopCloseIndex, 'post-repeat step should be emitted after the loop closes');
    },
  },
  {
    name: 'repeat segment emits terminal table assertions for each generated row',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 'u001',
            order: 1,
            action: 'fill',
            target: { placeholder: '请输入用户名', label: '用户名' },
            value: 'alice.qa',
            sourceCode: `await page.getByPlaceholder('请输入用户名').fill('alice.qa');`,
            assertions: [],
          },
          {
            id: 'u002',
            order: 2,
            action: 'click',
            target: { testId: 'modal-confirm', text: '确定' },
            sourceCode: `await page.getByTestId('modal-confirm').click();`,
            assertions: [],
          },
        ],
        repeatSegments: [{
          id: 'repeat-users',
          name: '批量新建用户',
          stepIds: ['u001', 'u002'],
          parameters: [{
            id: 'p-user',
            label: '用户名',
            sourceStepId: 'u001',
            currentValue: 'alice.qa',
            variableName: 'username',
            enabled: true,
          }],
          rows: [
            { id: 'row-1', values: { 'p-user': 'alice.qa' } },
            { id: 'row-2', values: { 'p-user': 'bob.qa' } },
          ],
          assertionTemplate: {
            subject: 'table',
            type: 'tableRowExists',
            description: '用户行存在：{{username}}',
            params: {
              tableTestId: 'users-table',
              rowKeyword: '{{username}}',
              columnValue: '{{username}}',
            },
          },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }],
      };

      const code = generateBusinessFlowPlaywrightCode(flow);
      const loopBody = code.slice(code.indexOf('for (const row of'), code.indexOf('\n  }', code.indexOf('for (const row of')));

      assert(loopBody.includes('await expect(page.getByTestId("users-table").getByRole(\'row\').filter({ hasText: String(row.username) })).toContainText(String(row.username));'), 'repeat-generated code should verify the terminal table row for each row value');
      assert(!loopBody.includes('template assertion:'), 'repeat assertion templates should render runnable terminal assertions, not comment-only placeholders');
    },
  },
  {
    name: 'repeat segment terminal table assertion can scope rows by multiple dynamic keywords',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 'p001',
            order: 1,
            action: 'fill',
            target: { label: '地址池名称' },
            value: 'test1',
            sourceCode: `await page.getByLabel('地址池名称').fill('test1');`,
            assertions: [],
          },
          {
            id: 'p002',
            order: 2,
            action: 'fill',
            target: { label: '开始地址' },
            value: '1.1.1.1',
            sourceCode: `await page.getByLabel('开始地址').fill('1.1.1.1');`,
            assertions: [],
          },
          {
            id: 'p003',
            order: 3,
            action: 'click',
            target: { testId: 'ipv4-address-pool-confirm', text: '确定' },
            sourceCode: `await page.getByTestId('ipv4-address-pool-confirm').click();`,
            assertions: [createTerminalStateAssertion('row-exists', 'p003-terminal-1', {
              tableTestId: 'site-global-ip-pools-section',
              rowKeyword: 'test1',
              columnValue: 'test1',
            })],
          },
        ],
        repeatSegments: [{
          id: 'repeat-ipv4',
          name: '批量创建IPv4地址池',
          stepIds: ['p001', 'p002', 'p003'],
          parameters: [
            { id: 'p-name', label: '地址池名称', sourceStepId: 'p001', currentValue: 'test1', variableName: 'poolName', enabled: true },
            { id: 'p-start', label: '开始地址', sourceStepId: 'p002', currentValue: '1.1.1.1', variableName: 'startIp', enabled: true },
          ],
          rows: [
            { id: 'row-1', values: { 'p-name': 'test1', 'p-start': '1.1.1.1' } },
            { id: 'row-2', values: { 'p-name': 'test2', 'p-start': '3.1.1.1' } },
          ],
          assertionTemplate: {
            subject: 'table',
            type: 'tableRowExists',
            description: 'IPv4地址池行存在：{{poolName}}',
            params: {
              tableTestId: 'site-global-ip-pools-section',
              rowKeyword: '{{poolName}}',
              rowKeyword2: '{{startIp}}',
              columnValue: '{{poolName}}',
            },
          },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }],
      };

      const code = generateBusinessFlowPlaywrightCode(flow);
      const loopBody = code.slice(code.indexOf('for (const row of'), code.indexOf('\n  }', code.indexOf('for (const row of')));

      assert(loopBody.includes("getByRole('row').filter({ hasText: String(row.poolName) }).filter({ hasText: String(row.startIp) })"), 'repeat terminal row locator should chain dynamic row keywords');
      assert(!loopBody.includes("filter({ hasText: /test1/ })"), 'repeat step row-exists assertions should not emit stale static row keywords inside the loop');

      const playback = generateBusinessFlowPlaybackCode(flow);
      assertEqual(countBusinessFlowPlaybackActions(flow), runnableLineCount(playback));
    },
  },
  {
    name: 'repeat segment terminal table assertion keeps dynamic rowKey templates',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 'p001',
            order: 1,
            action: 'fill',
            target: { placeholder: '请输入地址池ID', label: '地址池ID' },
            value: 'pool-42',
            sourceCode: `await page.getByPlaceholder('请输入地址池ID').fill('pool-42');`,
            assertions: [],
          },
          {
            id: 'p002',
            order: 2,
            action: 'click',
            target: { testId: 'modal-confirm', text: '确定' },
            sourceCode: `await page.getByTestId('modal-confirm').click();`,
            assertions: [],
          },
        ],
        repeatSegments: [{
          id: 'repeat-pools',
          name: '批量新建地址池',
          stepIds: ['p001', 'p002'],
          parameters: [{
            id: 'p-pool',
            label: '地址池ID',
            sourceStepId: 'p001',
            currentValue: 'pool-42',
            variableName: 'poolId',
            enabled: true,
          }],
          rows: [
            { id: 'row-1', values: { 'p-pool': 'pool-42' } },
            { id: 'row-2', values: { 'p-pool': 'pool-43' } },
          ],
          assertionTemplate: {
            subject: 'table',
            type: 'tableRowExists',
            description: '地址池行存在：{{poolId}}',
            params: {
              tableTestId: 'pool-table',
              rowKey: '{{poolId}}',
              columnValue: '{{poolId}}',
            },
          },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }],
      };

      const code = generateBusinessFlowPlaywrightCode(flow);
      const loopBody = code.slice(code.indexOf('for (const row of'), code.indexOf('\n  }', code.indexOf('for (const row of')));

      assert(loopBody.includes('data-row-key'), 'dynamic rowKey template should render a data-row-key selector');
      assert(loopBody.includes('String(row.poolId)'), 'dynamic rowKey template should preserve the row.poolId expression');
      assert(loopBody.includes('toContainText(String(row.poolId));'), 'dynamic rowKey assertion should still verify the generated row text');
      assert(!loopBody.includes("getByRole('row').first()"), 'dynamic rowKey template must not fall back to the first row');
    },
  },
  {
    name: 'repeat segment terminal table assertion interpolates mixed dynamic rowKey templates',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 'p001',
          order: 1,
          action: 'fill',
          target: { placeholder: '请输入地址池ID', label: '地址池ID' },
          value: '42',
          sourceCode: `await page.getByPlaceholder('请输入地址池ID').fill('42');`,
          assertions: [],
        }],
        repeatSegments: [{
          id: 'repeat-pools',
          name: '批量新建地址池',
          stepIds: ['p001'],
          parameters: [{
            id: 'p-pool',
            label: '地址池ID',
            sourceStepId: 'p001',
            currentValue: '42',
            variableName: 'poolId',
            enabled: true,
          }],
          rows: [
            { id: 'row-1', values: { 'p-pool': '42' } },
            { id: 'row-2', values: { 'p-pool': '43' } },
          ],
          assertionTemplate: {
            subject: 'table',
            type: 'tableRowExists',
            description: '地址池行存在：pool-{{poolId}}',
            params: {
              tableTestId: 'pool-table',
              rowKey: 'pool-{{poolId}}',
              columnValue: 'pool-{{poolId}}',
            },
          },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }],
      };

      const code = generateBusinessFlowPlaywrightCode(flow);
      const loopStart = code.indexOf('for (const row of');
      const loopBody = code.slice(loopStart, code.indexOf('\n  }', loopStart));

      assert(loopBody.includes('data-row-key'), 'mixed dynamic rowKey should render a data-row-key selector');
      assert(loopBody.includes('pool-${String(row.poolId)'), 'mixed dynamic rowKey should interpolate row.poolId inside the data-row-key selector');
      assert(loopBody.includes('toContainText(`pool-${String(row.poolId)}`);'), 'mixed dynamic column assertion should stay dynamic');
      assert(!loopBody.includes("getByRole('row').first()"), 'mixed dynamic rowKey must not fall back to the first row');
      assert(!loopBody.includes('"pool-row.poolId"'), 'mixed dynamic rowKey must not become a static row.poolId literal');
    },
  },
  {
    name: 'repeat segment terminal row-not-exists assertion keeps dynamic rowKey templates',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 'p001',
          order: 1,
          action: 'click',
          target: { testId: 'delete-pool', text: '删除' },
          sourceCode: `await page.getByTestId('delete-pool').click();`,
          assertions: [],
        }],
        repeatSegments: [{
          id: 'repeat-delete-pools',
          name: '批量删除地址池',
          stepIds: ['p001'],
          parameters: [{
            id: 'p-pool',
            label: '地址池ID',
            sourceStepId: 'p001',
            currentValue: 'pool-42',
            variableName: 'poolId',
            enabled: true,
          }],
          rows: [
            { id: 'row-1', values: { 'p-pool': 'pool-42' } },
            { id: 'row-2', values: { 'p-pool': 'pool-43' } },
          ],
          assertionTemplate: {
            subject: 'table',
            type: 'row-not-exists',
            description: '地址池行已删除：{{poolId}}',
            params: {
              tableTestId: 'pool-table',
              rowKey: '{{poolId}}',
            },
          },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }],
      };

      const code = generateBusinessFlowPlaywrightCode(flow);
      const loopStart = code.indexOf('for (const row of');
      const loopBody = code.slice(loopStart, code.indexOf('\n  }', loopStart));

      assert(loopBody.includes('data-row-key'), 'row-not-exists dynamic rowKey should render a data-row-key selector');
      assert(loopBody.includes('String(row.poolId)'), 'row-not-exists dynamic rowKey should preserve row.poolId');
      assert(loopBody.includes('.not.toBeVisible();'), 'row-not-exists should render a negative terminal assertion');
      assert(!loopBody.includes("getByRole('row').first()"), 'row-not-exists dynamic rowKey must not fall back to first row');
    },
  },
  {
    name: 'repeat segment emits interpolated terminal table assertion templates dynamically',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 'u001',
            order: 1,
            action: 'fill',
            target: { placeholder: '请输入用户名', label: '用户名' },
            value: 'alice.qa',
            sourceCode: `await page.getByPlaceholder('请输入用户名').fill('alice.qa');`,
            assertions: [],
          },
          {
            id: 'u002',
            order: 2,
            action: 'click',
            target: { testId: 'modal-confirm', text: '确定' },
            sourceCode: `await page.getByTestId('modal-confirm').click();`,
            assertions: [],
          },
        ],
        repeatSegments: [{
          id: 'repeat-users',
          name: '批量新建用户',
          stepIds: ['u001', 'u002'],
          parameters: [{
            id: 'p-user',
            label: '用户名',
            sourceStepId: 'u001',
            currentValue: 'alice.qa',
            variableName: 'username',
            enabled: true,
          }],
          rows: [
            { id: 'row-1', values: { 'p-user': 'alice.qa' } },
            { id: 'row-2', values: { 'p-user': 'bob.qa' } },
          ],
          assertionTemplate: {
            subject: 'table',
            type: 'tableRowExists',
            description: '用户行存在：user {{username}}',
            params: {
              tableTestId: 'users-table',
              rowKeyword: 'user {{username}}',
              columnValue: 'user {{username}}',
            },
          },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }],
      };

      const code = generateBusinessFlowPlaywrightCode(flow);
      const loopBody = code.slice(code.indexOf('for (const row of'), code.indexOf('\n  }', code.indexOf('for (const row of')));

      assert(loopBody.includes('filter({ hasText: `user ${String(row.username)}` })'), 'interpolated row keyword should stay dynamic inside the repeat loop');
      assert(loopBody.includes('toContainText(`user ${String(row.username)}`);'), 'interpolated column value should stay dynamic inside the repeat loop');
      assert(!loopBody.includes('"user row.username"'), 'interpolated templates should not become brittle string literals');
    },
  },
  {
    name: 'repeat segment reuses saved item parameter when the item is used later in the same business loop',
    run: () => {
      let initial = mergeActionsIntoFlow(undefined, [
        clickAction('新建条目'),
        fillAction('条目名称', 'item-a'),
        clickAction('保存'),
        fillAction('下方表单使用条目', 'item-a'),
      ], recordedSource([
        `await page.getByRole('button', { name: '新建条目' }).click();`,
        `await page.getByLabel('条目名称').fill('item-a');`,
        `await page.getByRole('button', { name: '保存' }).click();`,
        `await page.getByLabel('下方表单使用条目').fill('item-a');`,
      ]), {});
      initial = insertWaitStepAfter(initial, 's003', 2000);
      const segment = createRepeatSegment(initial, ['s001', 's002', 's003', 's005', 's004']);
      const flow: BusinessFlow = {
        ...initial,
        repeatSegments: [segment],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      const itemParameters = segment.parameters.filter(parameter => parameter.currentValue === 'item-a');

      assertEqual(itemParameters.length, 2);
      assertEqual([...new Set(itemParameters.map(parameter => parameter.variableName))], ['name']);
      assert(code.includes('for (const row of'), 'repeat segment should emit a loop');
      assert(code.includes(`.fill(String(row.name));`), 'both create and downstream use steps should reference the same row.name parameter');
      assert(code.includes("await page.waitForLoadState('networkidle').catch(() => {});"), 'repeat loop should keep async save wait before using the saved item');
    },
  },
  {
    name: 'repeat segment parameterized dropdown option stays scoped to the active popup',
    run: () => {
      const flow: BusinessFlow = createEmptyBusinessFlow({
        flow: { id: 'repeat-popup', name: 'repeat popup option' },
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: { label: '关联VRF', role: 'combobox' },
          sourceCode: `await page.locator(".ant-form-item").filter({ hasText: "关联VRF" }).locator(".ant-select-selector, .ant-cascader-picker, .ant-select").first().click();`,
          assertions: [],
        }, {
          id: 's002',
          order: 2,
          kind: 'recorded',
          sourceActionIds: ['a002'],
          action: 'click',
          target: { text: '生产VRF' },
          sourceCode: `await page.locator(".ant-select-dropdown:visible, .ant-cascader-dropdown:visible").last().locator(".ant-select-item-option, .ant-cascader-menu-item, .ant-select-tree-treenode, .ant-select-tree-node-content-wrapper").filter({ hasText: "生产VRF" }).first().click();`,
          assertions: [],
        }],
        repeatSegments: [{
          id: 'repeat-1',
          name: '批量选择VRF',
          stepIds: ['s001', 's002'],
          parameters: [{
            id: 'p-vrf',
            label: '生产VRF',
            sourceStepId: 's002',
            currentValue: '生产VRF',
            variableName: 'vrf',
            enabled: true,
          }],
          rows: [{ id: 'row-1', values: { 'p-vrf': '生产VRF' } }],
          createdAt: 'now',
          updatedAt: 'now',
        }],
      });
      const code = generateBusinessFlowPlaywrightCode(flow);
      assert(code.includes('for (const row of repeat_1Data)'), 'repeat loop should be emitted');
      assert(code.includes('selectOwnedOption(false)'), 'parameterized popup option should check the trigger-owned target option before opening');
      assert(code.includes('ownedRoots()'), 'parameterized popup option should stay scoped to the current trigger-owned dropdown/listbox');
      assert(code.includes('const expectedText = String(row.vrf);'), 'popup option should use the row variable as exact expected text');
      assert(code.includes('AntD option not found in trigger-owned dropdown'), 'parameterized popup option should fail when the owned dropdown does not contain the expected option');
      assert(!code.includes('|| elements[elements.length - 1]'), 'popup option must not fall back to the last partial match');
      assert(!code.includes('filter({ hasText: String(row.vrf) }).first().click()'), 'parameterized dropdown option must not use partial first-match clicks');
      assert(!code.includes('page.getByText(String(row.vrf)).click()'), 'parameterized dropdown option must not become a global text click');
    },
  },
  {
    name: 'wrong middle step can be deleted and rerecorded between existing neighbors',
    run: () => {
      const initial = mergeActionsIntoFlow(undefined, [
        clickAction('打开表单'),
        fillAction('错误字段', 'bad-value'),
        clickAction('保存'),
      ], [], {});
      const deletedWrongStep = deleteStepFromFlow(initial, 's002');
      const rerecorded = mergeActionsIntoFlow(deletedWrongStep, [
        clickAction('打开表单'),
        fillAction('错误字段', 'bad-value'),
        clickAction('保存'),
        fillAction('正确字段', 'good-value'),
      ], [], {
        insertAfterStepId: 's001',
        insertBaseActionCount: 3,
      });

      assertEqual(rerecorded.steps.map(step => step.id), ['s001', 's004', 's003']);
      assertEqual(rerecorded.steps.map(step => step.value), [undefined, 'good-value', undefined]);
      assert(!rerecorded.steps.some(step => step.value === 'bad-value'), 'deleted wrong action should not revive when rerecording in the middle');
    },
  },
  {
    name: 'select trigger with active dropdown context is not replayed as a dropdown option',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            label: '关联VRF',
            text: '选择一个VRF',
            name: '选择一个VRF',
            displayName: '选择一个VRF',
          },
          context: {
            eventId: 'ctx-vrf-trigger',
            capturedAt: 1000,
            before: {
              dialog: { type: 'dropdown', visible: true },
              form: { label: '关联VRF', name: 'vrf' },
              target: {
                tag: 'div',
                text: '选择一个VRF',
                normalizedText: '选择一个VRF',
                framework: 'procomponents',
                controlType: 'select',
              },
            },
          },
          rawAction: {
            syntheticContextEventId: 'ctx-vrf-trigger',
            syntheticContextEventSignature: '选择一个VRF|div',
          },
          assertions: [],
        }],
      };
      const code = stepCodeBlock(generateBusinessFlowPlaywrightCode(flow), 's001');

      assert(!code.includes('.ant-select-item-option'), 'select trigger placeholder must not be treated as an option');
      assert(!code.includes('AntD Select virtual dropdown replay workaround'), 'select trigger should not use option replay workaround');
      assert(code.includes('.locator(".ant-select-selector, .ant-cascader-picker, .ant-select").first().click();') || code.includes("getByRole('combobox'"), 'select trigger should replay as opening the field');
    },
  },
  {
    name: 'projected select step uses selected value over placeholder context for owned replay',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          action: 'select',
          value: '生产VRF',
          target: {
            role: 'combobox',
            label: '关联VRF',
            name: '选择一个VRF',
            text: '选择一个VRF',
            displayName: '选择一个VRF',
            testId: 'network-resource-vrf-select',
            scope: { form: { testId: 'network-resource-vrf-select', label: '关联VRF', name: '关联VRF' } },
          },
          uiRecipe: {
            kind: 'select-option',
            library: 'pro-components',
            component: 'select',
            formKind: 'pro-form',
            fieldKind: 'select',
            fieldLabel: '关联VRF',
            fieldName: 'vrf',
            optionText: '选择一个VRF',
            targetText: '选择一个VRF',
          },
          context: {
            eventId: 'ctx-vrf-projected-select',
            capturedAt: 1000,
            before: {
              form: { label: '关联VRF', name: 'vrf' },
              target: {
                tag: 'div',
                text: '选择一个VRF',
                normalizedText: '选择一个VRF',
                ariaLabel: '选择一个VRF',
                framework: 'procomponents',
                controlType: 'select',
              },
              dialog: { type: 'dropdown', visible: true },
            },
          },
          rawAction: null,
          assertions: [],
        }],
      };

      const code = stepCodeBlock(generateBusinessFlowPlaywrightCode(flow), 's001');

      assert(code.includes('const expectedText = "生产VRF";'), 'owned select replay should pin the committed selected value');
      assert(code.includes('await expect(page.getByTestId("network-resource-vrf-select")).toContainText("生产VRF"'), 'selected-value assertion should verify the committed selected value');
      assert(!code.includes('const expectedText = "选择一个VRF";'), 'placeholder text must not be used as the replay option');
      assert(!code.includes('toContainText("选择一个VRF"'), 'placeholder text must not be used as the selected-value assertion');
    },
  },
  {
    name: 'parser-safe projected select trigger scopes container test ids by field label',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          action: 'select',
          value: 'default',
          target: {
            role: 'combobox',
            label: '关联VRF',
            name: 'default',
            displayName: 'default',
            testId: 'ip-port-pool-form',
            scope: { form: { testId: 'ip-port-pool-form', label: '关联VRF', name: 'vrf' } },
          },
          uiRecipe: {
            kind: 'select-option',
            library: 'pro-components',
            component: 'select',
            formKind: 'pro-form',
            fieldKind: 'select',
            fieldLabel: '关联VRF',
            fieldName: 'vrf',
            optionText: 'default',
          },
          context: { eventId: 'ctx-port-pool-container-select', capturedAt: 1000, before: { form: { testId: 'ip-port-pool-form', label: '关联VRF', name: 'vrf' }, target: { controlType: 'select', role: 'option' as any, text: 'default', selectedOption: 'default', framework: 'procomponents' } } },
          rawAction: { name: 'select', searchText: 'default', selectedText: 'default' },
          assertions: [],
        }],
      };

      const playback = stepCodeBlock(generateBusinessFlowPlaybackCode(flow), 's001');

      assert(playback.includes('page.getByTestId("ip-port-pool-form").locator(".ant-form-item").filter({ hasText: "关联VRF" }).locator(".ant-select-selector, .ant-cascader-picker").click();'), 'parser-safe playback should scope the container test id to the owning form item before opening the select');
      assert(playback.includes('page.getByTestId("ip-port-pool-form").locator(".ant-form-item").filter({ hasText: "关联VRF" }).locator(".ant-select-selector, .ant-cascader-picker").locator("input:visible").fill("default");'), 'parser-safe playback should search inside the same labeled trigger');
      assert(!playback.includes('page.getByTestId("ip-port-pool-form").locator(".ant-select-selector, .ant-cascader-picker").click();'), 'parser-safe playback must not click every select trigger under a multi-select container');
      assert(!playback.includes('.ant-select-selector, .ant-cascader-picker, .ant-select'), 'parser-safe playback must not include both AntD root and selector because CrxPlayer cannot preserve first()');
    },
  },
  {
    name: 'parser-safe projected select keeps control test ids out of form-item nesting',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          action: 'select',
          value: '系统管理员',
          target: {
            role: 'combobox',
            label: '角色',
            name: '系统管理员',
            displayName: '系统管理员',
            scope: { form: { testId: 'role-select', label: '角色', name: 'role' } },
          },
          uiRecipe: {
            kind: 'select-option',
            library: 'antd',
            component: 'select',
            formKind: 'form',
            fieldKind: 'select',
            fieldLabel: '角色',
            fieldName: 'role',
            optionText: '系统管理员',
          },
          context: { eventId: 'ctx-role-control-select', capturedAt: 1000, before: { form: { testId: 'role-select', label: '角色', name: 'role' }, target: { controlType: 'select', role: 'option' as any, text: '系统管理员', selectedOption: '系统管理员', framework: 'antd' } } },
          rawAction: { name: 'select', selectedText: '系统管理员' },
          assertions: [],
        }],
      };

      const playback = stepCodeBlock(generateBusinessFlowPlaybackCode(flow), 's001');

      assert(playback.includes('page.getByTestId("role-select").locator(".ant-select-selector, .ant-cascader-picker").click();'), 'parser-safe playback should treat *-select test ids as the control root');
      assert(!playback.includes('page.getByTestId("role-select").locator(".ant-form-item")'), 'parser-safe playback must not search for form items inside a select control test id');
      assert(!playback.includes('.ant-select-selector, .ant-cascader-picker, .ant-select'), 'parser-safe playback must still avoid the AntD root alternative');
    },
  },
  {
    name: 'tree option without captured trigger reopens its field from toast context',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            text: '华东生产区',
            name: '华东生产区',
            displayName: '华东生产区',
            raw: {
              framework: 'antd',
              controlType: 'tree-select-option',
              optionPath: ['华东生产区'],
            },
          },
          context: {
            eventId: 'ctx-scope-option',
            capturedAt: 1000,
            before: {
              dialog: { type: 'dropdown', title: '全国站点', visible: true },
              target: {
                tag: 'div',
                text: '华东生产区',
                normalizedText: '华东生产区',
                framework: 'antd',
                controlType: 'tree-select-option',
                optionPath: ['华东生产区'],
              },
            },
            after: {
              dialog: { type: 'modal', title: '新建网络资源', visible: true },
              toast: '选择发布范围',
            },
          },
          rawAction: {
            syntheticContextEventId: 'ctx-scope-option',
            syntheticContextEventSignature: '华东生产区|div',
          },
          assertions: [],
        }],
      };
      const code = stepCodeBlock(generateBusinessFlowPlaywrightCode(flow), 's001');

      assert(code.includes('filter({ hasText: "发布范围" })'), 'tree option should infer the field from toast context');
      assert(code.includes('.locator(".ant-select-selector, .ant-cascader-picker, .ant-cascader").first().click();'), 'tree option should reopen the scoped AntD field before clicking');
      assert(code.includes('.ant-select-tree-node-content-wrapper'), 'tree option should still click the active tree dropdown option');
    },
  },
  {
    name: 'field after modal close is not scoped to stale dialog without relying on 下方 prefix',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: { name: '新建条目' },
          context: {
            eventId: 'ctx-open',
            capturedAt: 1000,
            before: { target: { tag: 'button', text: '新建条目', normalizedText: '新建条目' } },
            after: { dialog: { type: 'modal', title: '新建条目', visible: true } },
          },
          assertions: [],
        }, {
          id: 's002',
          order: 2,
          kind: 'recorded',
          sourceActionIds: ['a002'],
          action: 'click',
          target: { text: '提交配置' },
          context: {
            eventId: 'ctx-submit',
            capturedAt: 1200,
            before: { dialog: { type: 'modal', title: '新建条目', visible: true }, target: { tag: 'span', text: '提交配置', normalizedText: '提交配置' } },
            after: {},
          },
          rawAction: { action: { name: 'click', selector: 'internal:text="提交配置"i' } },
          assertions: [],
        }, {
          id: 's003',
          order: 3,
          kind: 'recorded',
          sourceActionIds: ['a003'],
          action: 'fill',
          target: { label: '使用备注', testId: 'usage-note' },
          value: 'modal closed note',
          context: {
            eventId: 'ctx-note',
            capturedAt: 1600,
            before: {
              target: { tag: 'input', testId: 'usage-note', text: '使用备注', normalizedText: '使用备注' },
              form: { label: '使用备注', testId: 'usage-note' },
            },
          },
          rawAction: { action: { name: 'fill', selector: 'internal:testid=[data-testid="usage-note"s]', text: 'modal closed note' } },
          assertions: [],
        }, {
          id: 's004',
          order: 4,
          kind: 'recorded',
          sourceActionIds: ['a004'],
          action: 'fill',
          target: { label: '使用备注', scope: { form: { label: '使用备注', name: 'remark' } } },
          value: 'contextless note',
          rawAction: { action: { name: 'fill', selector: 'internal:role=textbox[name="使用备注"i]', text: 'contextless note' } },
          sourceCode: `await page.locator(".ant-modal, .ant-drawer, [role=\\"dialog\\"]").filter({ hasText: "新建条目" }).getByLabel("使用备注").fill("contextless note");`,
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      const noteStep = stepCodeBlock(code, 's003');
      const contextlessNoteStep = stepCodeBlock(code, 's004');

      assert(noteStep.includes('modal closed note'), 'page field should still fill its own value');
      assert(!noteStep.includes('filter({ hasText: "新建条目" })'), 'page field should not inherit a stale modal scope');
      assert(contextlessNoteStep.includes('contextless note'), 'contextless page field should still fill its own value');
      assert(!contextlessNoteStep.includes('filter({ hasText: "新建条目" })'), 'contextless page field should not inherit a stale modal scope from weak form evidence');
    },
  },
  {
    name: 'dialog opener test id is not scoped into the dialog it opens',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            role: 'button',
            testId: 'real-create-item',
            scope: { dialog: { type: 'modal', title: '新建条目', visible: true } },
          },
          context: {
            eventId: 'ctx-create-item',
            capturedAt: Date.now(),
            before: {
              target: {
                tag: 'button',
                role: 'button',
                testId: 'real-create-item',
                text: '新建条目',
                normalizedText: '新建条目',
              },
            },
            after: {
              dialog: { type: 'modal', title: '新建条目', visible: true },
            },
          },
          rawAction: { action: { name: 'click', selector: 'internal:testid=[data-testid="real-create-item"s]' } },
          assertions: [],
        }],
      };

      const code = stepCodeBlock(generateBusinessFlowPlaywrightCode(flow), 's001');
      assert(code.includes('await page.getByTestId("real-create-item").click();'), 'dialog opener should click the page-level create button');
      assert(!code.includes('filter({ hasText: "新建条目" }).getByTestId("real-create-item")'), 'dialog opener must not be scoped into the dialog it opens');

      const targetScopeOnly: BusinessFlow = {
        ...flow,
        steps: flow.steps.map(step => ({
          ...step,
          target: {
            ...step.target,
            displayName: '新建条目',
          },
          context: {
            ...step.context!,
            after: undefined,
          },
        })),
      };
      const targetScopeOnlyCode = stepCodeBlock(generateBusinessFlowPlaywrightCode(targetScopeOnly), 's001');
      assert(targetScopeOnlyCode.includes('await page.getByTestId("real-create-item").click();'), 'dialog opener should stay page-level when only target scope carries the opened dialog');
      assert(!targetScopeOnlyCode.includes('filter({ hasText: "新建条目" }).getByTestId("real-create-item")'), 'target-scope-only opener must not be scoped into the dialog it opens');
    },
  },
  {
    name: 'code preview regenerates a stale source line from the step raw action',
    run: () => {
      const flow = mergeActionsIntoFlow(undefined, [
        clickAction('新建'),
        fillAction('地址池名称', 'test1'),
      ], [], {});
      const staleSourceFlow: BusinessFlow = {
        ...flow,
        steps: flow.steps.map(step => step.id === 's001' ? {
          ...step,
          sourceCode: `await page.getByRole('textbox', { name: '地址池名称' }).fill('test1');`,
        } : step),
      };
      const code = generateBusinessFlowPlaywrightCode(staleSourceFlow);
      const firstStep = stepCodeBlock(code, 's001');

      assert(firstStep.includes(`getByRole('button', { name: '新建' })`) || firstStep.includes(`getByRole("button", { name: "新建" })`), 's001 should use its own button locator');
      assert(firstStep.includes('.click();'), 's001 should render a click action');
      assert(!firstStep.includes('.fill('), 's001 should not reuse the stale fill source');
    },
  },
  {
    name: 'recorded source line is validated before it is written to a step',
    run: () => {
      const flow = mergeActionsIntoFlow(undefined, [
        testIdClickAction('site-save-button'),
      ], recordedSource([
        `await page.getByTestId('site-ip-port-pool-create-button').click();`,
      ]), {});

      assertEqual(flow.steps[0].sourceCode, `await page.getByTestId('site-save-button').click();`);
    },
  },
  {
    name: 'duplicated test id clicks preserve the captured page ordinal in generated code',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            testId: 'site-save-button',
            role: 'button',
            text: '保存配置',
            locatorHint: { strategy: 'global-testid', confidence: 0.98, pageCount: 2, pageIndex: 1 },
            raw: { testId: 'site-save-button', uniqueness: { pageCount: 2, pageIndex: 1 } },
          },
          context: {
            eventId: 'ctx-save',
            capturedAt: 1000,
            before: {
              target: {
                tag: 'button',
                role: 'button',
                testId: 'site-save-button',
                text: '保存配置',
                locatorQuality: 'testid',
                uniqueness: { pageCount: 2, pageIndex: 1 },
              },
            },
          },
          rawAction: testIdClickAction('site-save-button'),
          sourceCode: `await page.getByTestId('site-save-button').click();`,
          assertions: [],
        }],
      };

      const exportedCode = generateBusinessFlowPlaywrightCode(flow);
      const playbackCode = generateBusinessFlowPlaybackCode(flow);

      assert(exportedCode.includes('page.getByTestId("site-save-button").nth(1).click();'), 'exported code should keep test id nth(1)');
      assert(!exportedCode.includes('page.getByTestId("site-save-button").click();'), 'exported duplicate test id locator should not be emitted without nth');
      assert(playbackCode.includes('page.getByRole("button", { name: "保存配置" }).nth(1).click({ force: true });'), 'runtime playback should use visible role ordinal with force for duplicate buttons');
      assert(!playbackCode.includes('page.getByTestId("site-save-button").click();'), 'runtime duplicate test id locator should not be emitted without nth');
    },
  },
  {
    name: 'parser-safe duplicate test id button clicks prefer visible role ordinal',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            testId: 'site-save-button',
            text: '保存配置',
            role: 'button',
            locatorHint: { strategy: 'global-testid', confidence: 0.9, pageCount: 2, pageIndex: 1 },
          },
          rawAction: {
            action: {
              name: 'click',
              selector: 'internal:testid=[data-testid="site-save-button"s] >> nth=1',
            },
          },
          sourceCode: `await page.getByTestId('site-save-button').nth(1).click();`,
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaybackCode(flow);
      assert(code.includes('getByRole("button", { name: "保存配置" }).nth(1).click({ force: true })'), 'runtime playback should avoid brittle internal testid nth selectors for duplicate buttons');
    },
  },
  {
    name: 'test id locator ignores stale context ordinal from a different target',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            testId: 'site-ip-address-pool-create-button',
            text: '新建',
          },
          context: {
            eventId: 'ctx-stale-select',
            capturedAt: 1000,
            before: {
              target: {
                tag: 'div',
                role: 'option',
                testId: 'site-ip-address-pool-create-button',
                text: '选择一个WAN口',
                locatorQuality: 'testid',
                uniqueness: { pageCount: 5, pageIndex: 4 },
              },
            },
          },
          rawAction: testIdClickAction('site-ip-address-pool-create-button'),
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);

      assert(code.includes('page.getByTestId("site-ip-address-pool-create-button").click();'), 'unique create button should not inherit a stale contextual nth');
      assert(!code.includes('site-ip-address-pool-create-button").nth(4)'), 'stale context ordinal should not be emitted for the test id locator');
    },
  },
  {
    name: 'recorded duplicate test id selector ordinal is exported as locator hint',
    run: () => {
      const flow = mergeActionsIntoFlow(undefined, [
        rawClickAction('internal:testid=[data-testid="site-save-button"s] >> nth=1'),
      ], [], {});
      const step = flow.steps[0];
      assertEqual(step.target?.testId, 'site-save-button');
      assertEqual(step.target?.locatorHint?.pageCount, 2);
      assertEqual(step.target?.locatorHint?.pageIndex, 1);
      const code = generateBusinessFlowPlaywrightCode(flow);
      assert(code.includes('page.getByTestId("site-save-button").nth(1).click();'), 'raw selector ordinal should survive code generation');
    },
  },
  {
    name: 'synthetic page context test id click stores duplicate ordinal in source code',
    run: () => {
      const result = appendSyntheticPageContextStepsWithResult(createNamedFlow(), [
        pageClickEventWithTarget('ctx-save', 1000, {
          tag: 'button',
          role: 'button',
          testId: 'site-save-button',
          text: '保存配置',
          normalizedText: '保存配置',
          locatorQuality: 'testid',
          uniqueness: { pageCount: 2, pageIndex: 1 },
        }),
      ]);

      assertEqual(result.insertedStepIds.length, 1);
      assertEqual(result.flow.steps[0].sourceCode, `await page.getByTestId("site-save-button").nth(1).click();`);
    },
  },
  {
    name: 'explicit test id click is not replayed as an inherited cascader option',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            testId: 'network-resource-save',
            text: '保 存',
          },
          context: {
            eventId: 'ctx-stale-cascader-context',
            capturedAt: 1000,
            before: {
              dialog: { type: 'dropdown', visible: true },
              target: {
                tag: 'button',
                role: 'button',
                testId: 'network-resource-save',
                text: '保 存',
                normalizedText: '保 存',
                framework: 'antd',
                controlType: 'cascader-option',
              },
            },
          },
          rawAction: {
            action: {
              name: 'click',
              selector: 'internal:testid=[data-testid="network-resource-save"s]',
            },
          },
          assertions: [],
        }],
      };
      const firstStep = stepCodeBlock(generateBusinessFlowPlaywrightCode(flow), 's001');

      assert(firstStep.includes('getByTestId("network-resource-save")'), 'explicit test id should remain the replay locator');
      assert(!firstStep.includes('ant-cascader-menu-item'), 'test id click should not inherit stale cascader option replay');
    },
  },
  {
    name: 'code preview suppresses non-interactive modal container clicks',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            testId: 'create-user-modal',
          },
          rawAction: {
            action: {
              name: 'click',
              selector: 'internal:testid=[data-testid="create-user-modal"s]',
            },
          },
          sourceCode: `await page.getByTestId('create-user-modal').click();`,
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);

      assert(code.includes('has no runnable Playwright action source'), 'modal root container clicks should be documented but not replayed');
      assert(!code.includes('page.getByTestId("create-user-modal").click') && !code.includes("page.getByTestId('create-user-modal').click"), 'modal root test id should not be emitted as a click target even when its id contains action words');
    },
  },
  {
    name: 'code preview suppresses modal root clicks even when context control type is polluted',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            testId: 'create-user-modal',
            displayName: '新建用户',
            scope: { dialog: { type: 'modal', title: '新建用户', visible: false } },
          },
          context: {
            eventId: 'ctx-polluted-hidden-create-user-modal',
            capturedAt: 1010,
            before: {
              dialog: { type: 'modal', title: '新建用户', visible: false },
              target: { tag: 'div', testId: 'create-user-modal', text: '新建用户', normalizedText: '新建用户', controlType: 'select' },
            },
          },
          rawAction: {
            action: {
              name: 'click',
              selector: 'internal:testid=[data-testid="create-user-modal"s]',
            },
          },
          sourceCode: `await page.getByTestId('create-user-modal').click();`,
          assertions: [
            createTerminalStateAssertion('modal-closed', 'a-user-modal-closed', { title: '新建用户' }),
          ],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);

      assert(code.includes('has no runnable Playwright action source'), 'polluted modal root context should still be documented but not replayed');
      assert(!code.includes('getByTestId("create-user-modal").click()') && !code.includes("getByTestId('create-user-modal').click()"), 'polluted modal root should not become a click target');
      assert(!code.includes('state: "hidden"'), 'suppressed modal root clicks should not emit premature modal-hidden assertions');
    },
  },
  {
    name: 'exported replay suppresses hidden modal container click after confirm press',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 'u005',
            order: 5,
            action: 'press',
            target: {
              testId: 'modal-confirm',
              displayName: '确定',
              scope: { dialog: { type: 'modal', title: '新建用户', visible: true } },
            },
            value: 'Enter',
            context: {
              eventId: 'ctx-modal-confirm-press',
              capturedAt: 1000,
              before: {
                dialog: { type: 'modal', title: '新建用户', visible: true },
                target: { tag: 'button', role: 'button', testId: 'modal-confirm', text: '确定', normalizedText: '确定', controlType: 'button' },
              },
              after: { dialog: { type: 'modal', title: '新建用户', visible: false } },
            },
            rawAction: { action: { name: 'press', selector: 'internal:testid=[data-testid="modal-confirm"s]', key: 'Enter' } },
            sourceCode: `await page.getByTestId("modal-confirm").press("Enter");`,
            assertions: [
              createTerminalStateAssertion('modal-closed', 'a-user-modal-closed', { title: '新建用户' }),
            ],
          },
          {
            id: 'u006',
            order: 6,
            action: 'click',
            target: {
              testId: 'create-user-modal',
              displayName: '新建用户',
              scope: { dialog: { type: 'modal', title: '新建用户', visible: false } },
            },
            context: {
              eventId: 'ctx-hidden-create-user-modal-root',
              capturedAt: 1010,
              before: {
                dialog: { type: 'modal', title: '新建用户', visible: false },
                target: { tag: 'div', testId: 'create-user-modal', text: '新建用户', normalizedText: '新建用户', controlType: 'select' },
              },
              after: { dialog: { type: 'modal', title: '新建用户', visible: false } },
            },
            rawAction: { action: { name: 'click', selector: 'internal:testid=[data-testid="create-user-modal"s]' } },
            sourceCode: `await page.getByTestId("create-user-modal").click();`,
            assertions: [],
          },
        ],
      };

      const code = generateBusinessFlowPlaywrightCode(flow);
      const playback = generateBusinessFlowPlaybackCode(flow);

      assert(code.includes('modal-confirm') && code.includes('.press("Enter")'), 'exported replay should keep the real confirm press');
      assert(playback.includes('modal-confirm') && playback.includes('.press("Enter")'), 'parser-safe replay should keep the real confirm press');
      assert(!code.includes('getByTestId("create-user-modal").click()'), 'exported replay should not click the hidden modal container');
      assert(!playback.includes('getByTestId("create-user-modal").click()'), 'parser-safe replay should not click the hidden modal container');
      assert(code.includes('新建用户') && code.includes('state: "hidden"'), 'exported replay should keep the modal hidden terminal assertion');
    },
  },
  {
    name: 'code preview suppresses non-interactive structural container clicks',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            testId: 'site-global-ip-pools-section',
          },
          rawAction: {
            action: {
              name: 'click',
              selector: 'internal:testid=[data-testid="site-global-ip-pools-section"s]',
            },
          },
          sourceCode: `await page.getByTestId('site-global-ip-pools-section').click();`,
          assertions: [],
        }, {
          id: 's002',
          order: 2,
          kind: 'recorded',
          sourceActionIds: ['a002'],
          action: 'click',
          target: {
            testId: 'site-ip-port-pool-create-button',
            text: '新建',
          },
          rawAction: testIdClickAction('site-ip-port-pool-create-button'),
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaybackCode(flow);

      assert(code.includes('s001 has no runnable Playwright action source'), 'structural container clicks should be documented but not replayed');
      assert(!code.includes('getByTestId("site-global-ip-pools-section").click') && !code.includes("getByTestId('site-global-ip-pools-section').click"), 'structural container test id should not be emitted as a click target');
      assert(code.includes('getByTestId("site-ip-port-pool-create-button").click'), 'nearby concrete action controls should still be replayed');
    },
  },
  {
    name: 'code preview suppresses non-interactive heading clicks',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            role: 'heading',
            text: 'IP地址池',
          },
          context: {
            eventId: 'ctx-heading',
            capturedAt: 1000,
            before: {
              target: {
                tag: 'h2',
                role: 'heading',
                text: 'IP地址池',
                normalizedText: 'IP地址池',
              },
            },
          },
          rawAction: {
            action: {
              name: 'click',
              selector: 'internal:label="IP地址池"i',
            },
          },
          sourceCode: `await page.getByRole('heading', { name: 'IP地址池' }).click();`,
          assertions: [],
        }, {
          id: 's002',
          order: 2,
          kind: 'recorded',
          sourceActionIds: ['a002'],
          action: 'click',
          target: {
            testId: 'site-ip-address-pool-create-button',
            text: '新建',
          },
          rawAction: testIdClickAction('site-ip-address-pool-create-button'),
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaybackCode(flow);

      assert(code.includes('s001 has no runnable Playwright action source'), 'static heading clicks should be documented but not replayed');
      assert(!code.includes('IP地址池"i') && !code.includes("getByRole('heading'"), 'heading text should not be emitted as a click target');
      assert(code.includes('getByTestId("site-ip-address-pool-create-button").click'), 'nearby concrete action controls should still be replayed');
    },
  },
  {
    name: 'code preview keeps real clickable panel/root test id clicks',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            testId: 'settings-panel',
            text: '打开高级设置',
          },
          rawAction: {
            action: {
              name: 'click',
              selector: 'internal:testid=[data-testid="settings-panel"s]',
            },
          },
          sourceCode: `await page.getByTestId('settings-panel').click();`,
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);

      assert(code.includes("page.getByTestId('settings-panel').click") || code.includes('page.getByTestId("settings-panel").click'), 'real clickable panel/root test ids should still be replayed');
    },
  },
  {
    name: 'code preview suppresses stale modal container source lines',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          action: 'click',
          target: {
            text: '新建网络资源',
            role: 'button',
          },
          sourceCode: 'await page.getByTestId("network-resource-modal").click();',
          assertions: [],
        }],
      };

      const code = generateBusinessFlowPlaywrightCode(flow);

      assert(!code.includes('getByTestId("network-resource-modal").click'), 'stale modal root source should not be replayed');
    },
  },
  {
    name: 'stale dropdown context does not turn ordinary form label clicks into option replay',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            text: '监听端口',
            name: '监听端口',
            scope: {
              dialog: { title: '新建网络资源', type: 'modal', visible: true },
              form: { label: '监听端口', testId: 'network-resource-modal' },
            },
          },
          context: {
            eventId: 'ctx-stale-dropdown-label',
            capturedAt: 1000,
            before: {
              dialog: { type: 'dropdown', visible: true },
              form: { label: '监听端口', testId: 'network-resource-modal' },
              target: {
                tag: 'label',
                text: '监听端口',
                normalizedText: '监听端口',
                framework: 'antd',
                controlType: 'select-option',
              },
            },
          },
          rawAction: {
            action: {
              name: 'click',
              selector: 'internal:text="监听端口"i',
            },
          },
          sourceCode: `await page.getByText('监听端口').click();`,
          assertions: [],
        }],
      };
      const firstStep = stepCodeBlock(generateBusinessFlowPlaywrightCode(flow), 's001');

      assert(!firstStep.includes('AntD Select virtual dropdown replay workaround'), 'ordinary labels should not use AntD option replay just because stale dropdown context is present');
      assert(!firstStep.includes('.ant-select-dropdown'), 'ordinary labels should not query an active dropdown option');
    },
  },
  {
    name: 'code preview falls back to raw selector when a click source line points to another element',
    run: () => {
      const flow = mergeActionsIntoFlow(undefined, [
        rawClickAction(`div >> internal:has-text="34c3fcc8-973b-4dc6-9478-"i >> nth=1`),
      ], recordedSource([
        `await page.getByRole('button', { name: '确 定' }).click();`,
      ]), {});
      const code = generateBusinessFlowPlaywrightCode(flow);
      const firstStep = stepCodeBlock(code, 's001');

      assert(firstStep.includes('34c3fcc8-973b-4dc6-9478-'), 's001 should render the raw click selector content');
      assert(!firstStep.includes(`name: '确 定'`), 's001 should not reuse another click step source');
    },
  },
  {
    name: 'code preview does not replay stale multi-line typing source for a single press step',
    run: () => {
      const flow = mergeActionsIntoFlow(undefined, [
        pressAction('开始地址，例如：', 'CapsLock'),
      ], [], {});
      const staleSourceFlow: BusinessFlow = {
        ...flow,
        steps: flow.steps.map(step => ({
          ...step,
          sourceCode: [
            `await page.getByRole('textbox', { name: '开始地址，例如：' }).press('CapsLock');`,
            `await page.getByRole('textbox', { name: '开始地址，例如：' }).fill('1.1.1.1');`,
          ].join('\n'),
        })),
      };
      const code = generateBusinessFlowPlaywrightCode(staleSourceFlow);
      const firstStep = stepCodeBlock(code, 's001');

      assert(firstStep.includes('.press("CapsLock");') || firstStep.includes(`.press('CapsLock');`), 's001 should render the press action');
      assert(!firstStep.includes('.fill('), 's001 should not replay stale fill code');
    },
  },
  {
    name: 'playback omits redundant text field focus click before the matching fill',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            kind: 'recorded',
            sourceActionIds: ['a001'],
            action: 'click',
            target: {
              role: 'textbox',
              label: '开始地址，例如：192.168.1.1',
              placeholder: '开始地址，例如：',
              scope: {
                dialog: { title: '新建IPv4地址池', type: 'modal', visible: true },
                form: { label: '开始地址，例如：192.168.1.1', name: 'startIp' },
              },
            },
            context: {
              eventId: 'ctx-start-click',
              capturedAt: 1000,
              before: {
                dialog: { title: '新建IPv4地址池', type: 'modal', visible: true },
                form: { label: '开始地址，例如：192.168.1.1', name: 'startIp' },
                target: { tag: 'input', role: 'textbox', placeholder: '开始地址，例如：', controlType: 'input' },
              },
            },
            rawAction: { action: { name: 'click', selector: 'internal:label="开始地址，例如：192.168.1.1"i' } },
            sourceCode: `await page.getByLabel('开始地址，例如：192.168.1.1').click();`,
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            kind: 'recorded',
            sourceActionIds: ['a002'],
            action: 'fill',
            target: {
              role: 'textbox',
              name: '开始地址，例如：',
              placeholder: '开始地址，例如：',
              scope: {
                dialog: { title: '新建IPv4地址池', type: 'modal', visible: true },
                form: { label: '开始地址，例如：192.168.1.1', name: 'startIp' },
              },
            },
            value: '1.1.1.1',
            context: {
              eventId: 'ctx-start-fill',
              capturedAt: 1100,
              before: {
                dialog: { title: '新建IPv4地址池', type: 'modal', visible: true },
                form: { label: '开始地址，例如：192.168.1.1', name: 'startIp' },
                target: { tag: 'input', role: 'textbox', placeholder: '开始地址，例如：', controlType: 'input' },
              },
            },
            rawAction: { action: { name: 'fill', selector: 'internal:role=textbox[name="开始地址，例如："i]', text: '1.1.1.1' } },
            sourceCode: `await page.getByRole('textbox', { name: '开始地址，例如：' }).fill('1.1.1.1');`,
            assertions: [],
          },
        ],
      };

      const exportedCode = generateBusinessFlowPlaywrightCode(flow);
      const playbackCode = generateBusinessFlowPlaybackCode(flow);

      for (const code of [exportedCode, playbackCode]) {
        assert(!code.includes('// s001 '), 'redundant focus-only click step should be omitted from generated code');
        assert(!code.includes('.click();'), 'redundant focus-only click should not be replayed before fill');
        assert(code.includes('开始地址，例如：'), 'fill target should still use the stable textbox name');
        assert(code.includes('.fill("1.1.1.1");') || code.includes(`.fill('1.1.1.1');`), 'matching fill step should still be emitted');
      }
      assertEqual(countBusinessFlowPlaybackActions(flow), 1);
    },
  },
  {
    name: 'code preview regenerates AntD select option clicks from page context instead of brittle title locators',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            selector: 'internal:attr=[title="real-item-a"i]',
            locator: 'internal:attr=[title="real-item-a"i]',
          },
          context: {
            eventId: 'ctx-select-option',
            capturedAt: 1000,
            before: {
              target: {
                tag: 'div',
                role: 'option',
                title: 'real-item-a',
                text: 'real-item-a',
                normalizedText: 'real-item-a',
                framework: 'antd',
                controlType: 'select-option',
              },
            },
          },
          rawAction: {
            action: {
              name: 'click',
              selector: 'internal:attr=[title="real-item-a"i]',
            },
          },
          sourceCode: `await page.getByTitle('real-item-a').locator('div').click();`,
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      const firstStep = stepCodeBlock(code, 's001');

      assert(firstStep.includes('selectOwnedOption(false)'), 'select option should first test whether the trigger-owned target option is visible');
      assert(firstStep.includes('ownedRoots()'), 'select option should replay through the dropdown/listbox owned by the current trigger');
      assert(firstStep.includes('dispatchEvent(new MouseEvent("mousedown"'), 'select option should replay through the AntD mouse event fallback');
      assert(firstStep.includes('aria-expanded'), 'select option replay should wait briefly for the owning trigger to collapse');
      assert(!firstStep.includes('getByTitle'), 'select option should not replay through brittle title locators');
    },
  },
  {
    name: 'code preview regenerates recorded active AntD dropdown option source through owned trigger contract',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            kind: 'recorded',
            sourceActionIds: ['a001'],
            action: 'click',
            target: {
              label: '下方表单使用条目',
              role: 'combobox',
              scope: { form: { label: '下方表单使用条目' } },
            },
            context: {
              eventId: 'ctx-active-trigger',
              capturedAt: 1000,
              before: {},
            },
            rawAction: { action: { name: 'click', selector: 'internal:role=combobox[name="下方表单使用条目"i]' } },
            sourceCode: `await page.locator(".ant-form-item").filter({ hasText: "下方表单使用条目" }).locator(".ant-select-selector, .ant-cascader-picker, .ant-select").first().click();`,
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            kind: 'recorded',
            sourceActionIds: ['a002'],
            action: 'click',
            target: {},
            rawAction: { action: { name: 'click', selector: '.ant-select-dropdown .ant-select-item-option' } },
            sourceCode: `await page.locator(".ant-select-dropdown:visible, .ant-cascader-dropdown:visible").last().locator(".ant-select-item-option, .ant-cascader-menu-item, .ant-select-tree-treenode, .ant-select-tree-node-content-wrapper").filter({ hasText: "real-item-a" }).first().click();`,
            assertions: [],
          },
        ],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      const firstStep = stepCodeBlock(code, 's002');

      assert(code.includes('filter({ hasText: "下方表单使用条目" })') && code.includes('.ant-select-selector'), 'select option should reopen the scoped form trigger');
      assert(firstStep.includes('dispatch the target option owned by this trigger'), 'select option should use the owned-dropdown replay contract');
      assert(firstStep.includes('const expectedText = "real-item-a";'), 'select option should parse exact option text from recorded hasText source');
      assert(firstStep.includes('aria-controls') && firstStep.includes('aria-owns') && firstStep.includes('aria-activedescendant'), 'select option should inspect trigger ownership attrs');
      assert(firstStep.includes('.ant-select-dropdown:not(.ant-select-dropdown-hidden)'), 'select option should search visible AntD dropdown roots');
      assert(firstStep.includes('dispatchEvent(new MouseEvent("mousedown"'), 'select option should dispatch the AntD mouse event sequence');
      assert(!firstStep.includes('.ant-select-dropdown:visible, .ant-cascader-dropdown:visible'), 'select option should not preserve the old active dropdown locator source');
      assert(!firstStep.includes('filter({ hasText: "real-item-a" }).first().click()'), 'select option should not preserve partial first-match option clicks');
    },
  },
  {
    name: 'human-like AntD option inner content click still replays through active dropdown workaround',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            text: 'xtest16:WAN1',
            locator: 'internal:text="xtest16:WAN1"i',
            scope: {
              form: { label: 'WAN口' },
              dialog: { title: '选择一个WAN口', type: 'dropdown', visible: true },
            },
          },
          context: {
            eventId: 'ctx-human-option',
            capturedAt: 1000,
            before: {
              form: { label: 'WAN口' },
              dialog: { title: '选择一个WAN口', type: 'dropdown', visible: true },
            },
            after: {
              dialog: { title: '新建IPv4地址池', type: 'modal', visible: true },
            },
          },
          rawAction: {
            action: {
              name: 'click',
              selector: 'internal:text="xtest16:WAN1"i',
            },
          },
          sourceCode: `await page.getByText('xtest16:WAN1').click();`,
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      const firstStep = stepCodeBlock(code, 's001');

      assert(firstStep.includes('AntD Select virtual dropdown replay workaround'), 'human-like inner option click should still use AntD dropdown replay');
      assert(firstStep.includes('const searchText = "xtest16";'), 'colon-prefixed AntD option clicks should infer stable search text');
      assert(firstStep.includes('await trigger.locator(inputSelector).first().fill(searchText);'), 'inferred search text should be typed before dispatching the owned option');
      assert(firstStep.includes('ownedRoots()'), 'option lookup should be scoped to the current trigger-owned dropdown/listbox');
      assert(!firstStep.includes('getByText'), 'human-like option replay must not use ambiguous global text locator');
    },
  },
  {
    name: 'colon option replay infers the narrower numeric suffix search when prefix is broad',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          action: 'click',
          target: {
            label: 'WAN口',
            text: 'edge-lab:WAN-extra-18',
            raw: {
              target: { role: 'option', framework: 'procomponents', controlType: 'select-option', text: 'edge-lab:WAN-extra-18' },
              ui: { library: 'pro-components', component: 'select', form: { label: 'WAN口' }, option: { text: 'edge-lab:WAN-extra-18' } },
            },
          },
          context: {
            eventId: 'ctx-edge-extra-option',
            capturedAt: 1000,
            before: {
              form: { label: 'WAN口' },
              target: { role: 'option', framework: 'procomponents', controlType: 'select-option', text: 'edge-lab:WAN-extra-18' },
            },
          },
          rawAction: {
            action: {
              name: 'click',
              selector: 'internal:text="edge-lab:WAN-extra-18"i',
            },
          },
          sourceCode: `await page.getByText('edge-lab:WAN-extra-18').click();`,
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      const firstStep = stepCodeBlock(code, 's001');

      assert(firstStep.includes('const searchText = "WAN-extra-18";'), 'broad prefix should not hide the virtualized target option');
      assert(firstStep.includes('edge-lab:WAN-extra-18'), 'full option text should remain the dispatch target');
    },
  },
  {
    name: 'AntD select search clear after option selection is not emitted',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            text: 'test1 1.1.1.1--2.2.2.2 共享',
            label: 'IP地址池',
            scope: { form: { label: 'IP地址池' }, dialog: { title: 'IP地址池', type: 'dropdown', visible: true } },
          },
          context: { eventId: 'ctx-option', capturedAt: 1000, before: { form: { label: 'IP地址池' }, dialog: { title: 'IP地址池', type: 'dropdown', visible: true } }, after: { dialog: { title: '新建IP端口地址池', type: 'modal', visible: true } } },
          rawAction: { action: { name: 'click', selector: 'internal:text="test11.1.1.1--2.2.2.2共享"i' } },
          assertions: [],
        }, {
          id: 's002',
          order: 2,
          kind: 'recorded',
          sourceActionIds: ['a002'],
          action: 'fill',
          value: '',
          target: {
            role: 'combobox',
            label: 'IP地址池',
            name: '* IP地址池 question-circle',
            scope: { form: { label: 'IP地址池' }, dialog: { title: '新建IP端口地址池', type: 'modal', visible: true } },
          },
          rawAction: { action: { name: 'fill', selector: 'internal:role=combobox[name="* IP地址池 question-circle"i]', text: '' } },
          sourceCode: 'await page.locator(".ant-form-item").filter({ hasText: "IP地址池" }).locator(".ant-select-selector, .ant-cascader-picker, .ant-select").first().locator("input").first().fill("");',
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      assert(code.includes('AntD Select virtual dropdown replay workaround'), 'the option click should still be emitted');
      assert(!code.includes('// s002 填写'), 'the internal AntD search clear after selection should not be emitted as its own step');
    },
  },
  {
    name: 'ReactNode AntD select option replays by matching tokens on the option container',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            text: 'test11.1.1.1--2.2.2.2共享',
            scope: {
              form: { label: 'IP地址池' },
              dialog: { title: '新建IP端口地址池', type: 'modal', visible: true },
            },
          },
          context: {
            eventId: 'ctx-react-node-option',
            capturedAt: 1000,
            before: {
              form: { label: 'IP地址池' },
              dialog: { title: '选择一个IP地址池', type: 'dropdown', visible: true },
              target: {
                tag: 'div',
                role: 'option',
                text: 'test11.1.1.1--2.2.2.2共享',
                selectedOption: 'test11.1.1.1--2.2.2.2共享',
                normalizedText: 'test11.1.1.1--2.2.2.2共享',
                framework: 'procomponents',
                controlType: 'select-option',
              },
            },
          },
          rawAction: {
            action: {
              name: 'click',
              selector: 'internal:text="test1"i',
            },
          },
          sourceCode: `await page.getByText('test1').click();`,
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaybackCode(flow);
      const firstStep = stepCodeBlock(code, 's001');

      const fieldClick = 'locator(".ant-form-item").filter({ hasText: "IP地址池" }).locator(".ant-select-selector, .ant-cascader-picker").click();';
      assert(firstStep.includes('.ant-form-item') && firstStep.includes('IP地址池'), 'runtime replay should reopen the field-scoped select before choosing the option');
      assert(!firstStep.includes('if (!await'), 'runtime replay should not include JS control flow that the parser cannot enforce');
      assert(!firstStep.includes('.fill("test1")'), 'runtime replay should not search ReactNode/IP-range labels because AntD can filter them to an empty dropdown');
      assertParserSafeIpOptionCompactToken(firstStep, 'test11.1.1.1--2.2.2.2共享');
      assertEqual(firstStep.split(fieldClick).length - 1, 1);
    },
  },
  {
    name: 'parser-safe ReactNode select skips empty search fill before option',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            name: '* IP地址池 question-circle',
            scope: { form: { label: 'IP地址池' }, dialog: { title: '新建IP端口地址池', type: 'modal', visible: true } },
          },
          context: {
            eventId: 'ctx-ip-pool-trigger',
            capturedAt: 900,
            before: {
              form: { label: 'IP地址池' },
              dialog: { title: '新建IP端口地址池', type: 'modal', visible: true },
              target: {
                tag: 'div',
                role: 'combobox',
                text: '* IP地址池 question-circle',
                normalizedText: '* IP地址池 question-circle',
                framework: 'procomponents',
                controlType: 'select',
              },
            },
          },
          rawAction: { action: { name: 'click', selector: 'internal:role=combobox[name="* IP地址池 question-circle"i]' } },
          assertions: [],
        }, {
          id: 's002',
          order: 2,
          kind: 'recorded',
          sourceActionIds: ['a002'],
          action: 'fill',
          value: '',
          target: {
            role: 'combobox',
            label: 'IP地址池',
            name: '* IP地址池 question-circle',
            scope: { form: { label: 'IP地址池' }, dialog: { title: '新建IP端口地址池', type: 'modal', visible: true } },
          },
          context: {
            eventId: 'ctx-ip-pool-empty-search',
            capturedAt: 950,
            before: {
              form: { label: 'IP地址池' },
              dialog: { title: '新建IP端口地址池', type: 'modal', visible: true },
              target: {
                tag: 'input',
                role: 'combobox',
                text: '',
                normalizedText: '',
                framework: 'procomponents',
                controlType: 'select',
              },
            },
          },
          rawAction: { action: { name: 'fill', selector: 'internal:role=combobox[name="* IP地址池 question-circle"i]', text: '' } },
          sourceCode: 'await page.locator(".ant-form-item").filter({ hasText: "IP地址池" }).locator(".ant-select-selector, .ant-cascader-picker, .ant-select").first().locator("input:visible").first().fill("");',
          assertions: [],
        }, {
          id: 's003',
          order: 3,
          kind: 'recorded',
          sourceActionIds: ['a003'],
          action: 'click',
          target: {
            text: 'test11.1.1.1--2.2.2.2共享',
            scope: {
              form: { label: 'IP地址池' },
              dialog: { title: '新建IP端口地址池', type: 'modal', visible: true },
            },
          },
          context: {
            eventId: 'ctx-react-node-option-after-empty-search',
            capturedAt: 1000,
            before: {
              form: { label: 'IP地址池' },
              dialog: { title: '选择一个IP地址池', type: 'dropdown', visible: true },
              target: {
                tag: 'div',
                role: 'option',
                text: 'test11.1.1.1--2.2.2.2共享',
                selectedOption: 'test11.1.1.1--2.2.2.2共享',
                normalizedText: 'test11.1.1.1--2.2.2.2共享',
                framework: 'procomponents',
                controlType: 'select-option',
              },
            },
          },
          rawAction: { action: { name: 'click', selector: 'internal:text="test1"i' } },
          sourceCode: `await page.getByText('test1').click();`,
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaybackCode(flow);
      const optionStep = stepCodeBlock(code, 's003');

      assert(!code.includes('.fill("")'), 'parser-safe replay should drop the empty internal select search before the option click');
      assert(code.includes('IP地址池'), 'parser-safe replay should keep the field identity around the option click');
      assertParserSafeIpOptionCompactToken(optionStep, 'test11.1.1.1--2.2.2.2共享');
    },
  },
  {
    name: 'parser-safe projected ReactNode select keeps explicit search text before compact IP option',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001', 'a002', 'a003'],
          action: 'select',
          target: {
            role: 'combobox',
            label: 'IP地址池',
            name: '* IP地址池 question-circle',
            scope: {
              form: { label: 'IP地址池' },
              dialog: { title: '新建IP端口地址池', type: 'modal', visible: true },
            },
          },
          value: 'test11.1.1.1--2.2.2.2共享',
          context: {
            eventId: 'ctx-projected-react-node-select',
            capturedAt: 1000,
            before: {
              form: { label: 'IP地址池' },
              dialog: { title: '选择一个IP地址池', type: 'dropdown', visible: true },
              target: {
                tag: 'div',
                role: 'option',
                text: 'test11.1.1.1--2.2.2.2共享',
                selectedOption: 'test11.1.1.1--2.2.2.2共享',
                normalizedText: 'test11.1.1.1--2.2.2.2共享',
                framework: 'procomponents',
                controlType: 'select-option',
              },
            },
          },
          uiRecipe: {
            kind: 'select-option',
            library: 'antd',
            component: 'Select',
            fieldKind: 'select',
            fieldLabel: 'IP地址池',
            optionText: 'test11.1.1.1--2.2.2.2共享',
          },
          rawAction: {
            name: 'select',
            transactionId: 'select-ip-pool',
            searchText: 'test1',
            selectedText: 'test11.1.1.1--2.2.2.2共享',
          },
          sourceCode: [
            `await page.locator(".ant-form-item").filter({ hasText: "IP地址池" }).locator(".ant-select-selector, .ant-cascader-picker, .ant-select").first().click();`,
            `await page.locator(".ant-form-item").filter({ hasText: "IP地址池" }).locator("input:visible").first().fill("test1");`,
            `await page.locator(".ant-select-dropdown:visible").last().locator(".ant-select-item-option").filter({ hasText: "test1" }).first().click();`,
          ].join('\n'),
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaybackCode(flow);
      const optionStep = stepCodeBlock(code, 's001');

      assert(optionStep.includes('.locator("input:visible").fill("test1");'), 'parser-safe projected select should preserve the explicit search text before choosing the compact IP option');
      assertParserSafeIpOptionCompactToken(optionStep, 'test11.1.1.1--2.2.2.2共享');
      assertEqual(countBusinessFlowPlaybackActions(flow), 3);
    },
  },
  {
    name: 'ReactNode AntD select option dedupe keeps shared and dedicated option semantics',
    run: () => {
      const optionStep = (id: string, order: number, optionText: string): FlowStep => ({
        id,
        order,
        kind: 'recorded',
        sourceActionIds: [`a${order.toString().padStart(3, '0')}`],
        action: 'click',
        target: {
          text: optionText,
          scope: {
            form: { label: 'IP地址池' },
            dialog: { title: '新建IP端口地址池', type: 'modal', visible: true },
          },
        },
        context: {
          eventId: `ctx-${id}`,
          capturedAt: 1000 + order,
          before: {
            form: { label: 'IP地址池' },
            dialog: { title: '选择一个IP地址池', type: 'dropdown', visible: true },
            target: {
              tag: 'div',
              role: 'option',
              text: optionText,
              selectedOption: optionText,
              normalizedText: optionText,
              framework: 'procomponents',
              controlType: 'select-option',
            },
          },
        },
        rawAction: {
          action: {
            name: 'click',
            selector: `internal:text="${optionText}"i`,
          },
        },
        assertions: [],
      });
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          optionStep('s001', 1, 'test11.1.1.1--2.2.2.2共享'),
          optionStep('s002', 2, 'test11.1.1.1--2.2.2.2独享'),
        ],
      };
      const code = generateBusinessFlowPlaybackCode(flow);

      assert(stepCodeBlock(code, 's001').includes('共享'), 'shared option should be emitted');
      assert(stepCodeBlock(code, 's002').includes('独享'), 'dedicated option should not be deduped as a duplicate of shared');
    },
  },
  {
    name: 'parser-safe AntD option after an already emitted trigger does not toggle the dropdown closed',
    run: () => {
      const triggerStep: FlowStep = {
        id: 's001',
        order: 1,
        kind: 'recorded',
        sourceActionIds: ['a001'],
        action: 'click',
        target: {
          role: 'combobox',
          name: '* IP地址池 question-circle',
          label: 'IP地址池',
          scope: {
            form: { label: 'IP地址池' },
            dialog: { title: '新建IP端口地址池', type: 'modal', visible: true },
          },
        },
        context: {
          eventId: 'ctx-select-trigger',
          capturedAt: 900,
          before: {
            form: { label: 'IP地址池' },
            dialog: { title: '新建IP端口地址池', type: 'modal', visible: true },
            target: {
              tag: 'div',
              role: 'combobox',
              text: '选择一个IP地址池',
              normalizedText: '选择一个IP地址池',
              framework: 'procomponents',
              controlType: 'select',
            },
          },
        },
        rawAction: { action: { name: 'click', selector: 'internal:role=combobox[name="* IP地址池 question-circle"i]' } },
        sourceCode: `await page.getByRole('combobox', { name: '* IP地址池 question-circle' }).click();`,
        assertions: [],
      };
      const optionStep: FlowStep = {
        id: 's002',
        order: 2,
        kind: 'recorded',
        sourceActionIds: ['a002'],
        action: 'click',
        target: {
          text: 'test11.1.1.1--2.2.2.2共享',
          scope: {
            form: { label: 'IP地址池' },
            dialog: { title: '新建IP端口地址池', type: 'modal', visible: true },
          },
        },
        context: {
          eventId: 'ctx-react-node-option',
          capturedAt: 1000,
          before: {
            form: { label: 'IP地址池' },
            dialog: { title: '选择一个IP地址池', type: 'dropdown', visible: true },
            target: {
              tag: 'div',
              role: 'option',
              text: 'test11.1.1.1--2.2.2.2共享',
              selectedOption: 'test11.1.1.1--2.2.2.2共享',
              normalizedText: 'test11.1.1.1--2.2.2.2共享',
              framework: 'procomponents',
              controlType: 'select-option',
            },
          },
        },
        rawAction: { action: { name: 'click', selector: 'internal:text="test1"i' } },
        sourceCode: `await page.getByText('test1').click();`,
        assertions: [],
      };
      const flow: BusinessFlow = { ...createNamedFlow(), steps: [triggerStep, optionStep] };
      const code = generateBusinessFlowPlaybackCode(flow);
      const optionBlock = stepCodeBlock(code, 's002');
      const fieldClick = 'locator(".ant-form-item").filter({ hasText: "IP地址池" }).locator(".ant-select-selector, .ant-cascader-picker").click();';

      assert(!optionBlock.includes(fieldClick), 'option step should not emit a second trigger click after the owning select was already opened');
      assert(!optionBlock.includes('if (!await'), 'runtime parser-safe replay must avoid JS control flow that the parser ignores');
      assert(!optionBlock.includes('.fill("test1")'), 'option step should not search ReactNode/IP-range labels because AntD can filter them to an empty dropdown');
      assert(optionBlock.includes('.ant-select-item-option'), 'option step should still click the active dropdown option');
      assertParserSafeIpOptionCompactToken(optionBlock, 'test11.1.1.1--2.2.2.2共享');
      assertEqual(countBusinessFlowPlaybackActions(flow), 2);
    },
  },
  {
    name: 'contextless option text click after AntD select fill inherits select field context for replay',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            kind: 'recorded',
            sourceActionIds: ['a001'],
            action: 'fill',
            target: {
              role: 'combobox',
              name: '* WAN口',
              label: 'WAN口',
              text: '选择一个WAN口',
              scope: {
                dialog: { title: '新建IPv4地址池', type: 'modal', visible: true },
                form: { label: 'WAN口', name: 'wan' },
              },
            },
            value: 'xtest16',
            context: {
              eventId: 'ctx-select-fill',
              capturedAt: 1000,
              before: {
                dialog: { title: '新建IPv4地址池', type: 'modal', visible: true },
                form: { label: 'WAN口', name: 'wan' },
                target: {
                  tag: 'div',
                  text: '选择一个WAN口',
                  normalizedText: '选择一个WAN口',
                  framework: 'procomponents',
                  controlType: 'select',
                },
              },
            },
            sourceCode: `await page.getByRole('combobox', { name: '* WAN口' }).fill('xtest16');`,
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            kind: 'recorded',
            sourceActionIds: ['a002'],
            action: 'click',
            target: {
              text: 'xtest16:WAN1',
              locator: 'internal:text="xtest16:WAN1"s',
            },
            rawAction: {
              action: {
                name: 'click',
                selector: 'internal:text="xtest16:WAN1"s',
              },
            },
            sourceCode: `await page.getByText('xtest16:WAN1', { exact: true }).click();`,
            assertions: [],
          },
        ],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      const optionStep = stepCodeBlock(code, 's002');
      const playbackCode = generateBusinessFlowPlaybackCode(flow);
      const playbackOptionStep = stepCodeBlock(playbackCode, 's002');

      assert(optionStep.includes('AntD Select virtual dropdown replay workaround'), 'contextless option click should inherit the previous AntD select field context');
      assert(optionStep.includes('locator(".ant-form-item").filter({ hasText: "WAN口" }).locator(".ant-select-selector, .ant-cascader-picker, .ant-select").first()'), 'fallback should reopen the owning WAN ProFormSelect trigger');
      assert(!optionStep.includes('getByText'), 'option click should not use ambiguous global text replay');
      assert(!playbackOptionStep.includes('.fill("xtest16:WAN1")'), 'parser-safe runtime should not emit a second full-label search fill after the select search was already filled');
      assertEqual(countBusinessFlowPlaybackActions(flow), 2);
    },
  },
  {
    name: 'contextless AntD option text truncated by highlight inherits select field and completes from query',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            kind: 'recorded',
            sourceActionIds: ['a001'],
            action: 'fill',
            target: {
              role: 'combobox',
              name: '* WAN口',
              label: 'WAN口',
              text: '选择一个WAN口',
              scope: {
                dialog: { title: '新建网络资源', type: 'modal', visible: true },
                form: { label: 'WAN口', name: 'wan' },
              },
            },
            value: 'WAN-extra-18',
            context: {
              eventId: 'ctx-select-fill-truncated',
              capturedAt: 1000,
              before: {
                dialog: { title: '新建网络资源', type: 'modal', visible: true },
                form: { label: 'WAN口', name: 'wan' },
                target: {
                  tag: 'div',
                  text: '选择一个WAN口',
                  normalizedText: '选择一个WAN口',
                  framework: 'procomponents',
                  controlType: 'select',
                },
              },
            },
            sourceCode: `await page.getByRole('combobox', { name: '* WAN口' }).fill('WAN-extra-18');`,
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            kind: 'recorded',
            sourceActionIds: ['a002'],
            action: 'click',
            target: {
              role: 'combobox',
              name: '* WAN口',
              label: 'WAN口',
              scope: {
                dialog: { title: '新建网络资源', type: 'modal', visible: true },
                form: { label: 'WAN口', name: 'wan' },
              },
            },
            rawAction: {
              action: {
                name: 'click',
                selector: 'internal:role=combobox[name="* WAN口"i]',
              },
            },
            assertions: [],
          },
          {
            id: 's003',
            order: 3,
            kind: 'recorded',
            sourceActionIds: ['a003'],
            action: 'click',
            target: {
              text: 'edge-lab:WAN-extra-',
              locator: 'internal:text="edge-lab:WAN-extra-"s',
            },
            rawAction: {
              action: {
                name: 'click',
                selector: 'internal:text="edge-lab:WAN-extra-"s',
              },
            },
            sourceCode: `await page.getByText('edge-lab:WAN-extra-').click();`,
            assertions: [],
          },
        ],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      const optionStep = stepCodeBlock(code, 's003');
      assert(optionStep.includes('AntD Select virtual dropdown replay workaround'), 'truncated option should still use AntD select replay workaround');
      assert(optionStep.includes('edge-lab:WAN-extra-18'), 'truncated option text should be completed from the select search query');
      assert(!optionStep.includes(`getByText('edge-lab:WAN-extra-')`), 'truncated global text source should not be reused');
    },
  },
  {
    name: 'projected select skips truncated selected-value echo clicks',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            kind: 'recorded',
            sourceActionIds: ['a001', 'a002'],
            action: 'select',
            target: {
              role: 'combobox',
              label: 'WAN口',
              name: 'WAN口',
              displayName: 'WAN口',
              testId: 'network-resource-wan-select',
              scope: {
                form: {
                  testId: 'network-resource-wan-select',
                  label: 'WAN口',
                  name: 'WAN口',
                },
              },
            },
            value: 'edge-lab:WAN-extra-18',
            context: {
              eventId: 'ctx-wan-select',
              capturedAt: 1000,
              before: {
                dialog: { type: 'dropdown', visible: true },
                form: { label: 'WAN口', name: 'wan' },
                target: {
                  tag: 'div',
                  role: 'option',
                  title: 'edge-lab:WAN-extra-18',
                  text: 'edge-lab:WAN-extra-18',
                  selectedOption: 'edge-lab:WAN-extra-18',
                  normalizedText: 'edge-lab:WAN-extra-18',
                  framework: 'procomponents',
                  controlType: 'select-option',
                },
                ui: {
                  library: 'pro-components',
                  component: 'select',
                  targetText: 'edge-lab:WAN-extra-18',
                  form: {
                    formKind: 'antd-form',
                    fieldKind: 'select',
                    label: 'WAN口',
                    name: 'wan',
                  },
                  overlay: { type: 'select-dropdown', visible: true },
                  option: { text: 'edge-lab:WAN-extra-18', path: ['edge-lab:WAN-extra-18'] },
                  locatorHints: [],
                  confidence: 0.9,
                  reasons: [],
                },
              },
            },
            uiRecipe: {
              kind: 'select-option',
              library: 'antd',
              component: 'select',
              fieldKind: 'select',
              fieldLabel: 'WAN口',
              fieldName: 'wan',
              optionText: 'edge-lab:WAN-extra-18',
            },
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            kind: 'recorded',
            sourceActionIds: ['a003'],
            action: 'click',
            target: {
              selector: 'internal:text="edge-lab:WAN-extra-"i',
              text: 'edge-lab:WAN-extra-',
              locator: 'internal:text="edge-lab:WAN-extra-"i',
            },
            rawAction: {
              action: {
                name: 'click',
                selector: 'internal:text="edge-lab:WAN-extra-"i',
              },
            },
            sourceCode: `await page.getByText("edge-lab:WAN-extra-").click();`,
            assertions: [{
              id: 's002-terminal-1',
              type: 'selected-value-visible',
              subject: 'element',
              target: {
                role: 'combobox',
                label: 'WAN口',
                name: 'WAN口',
                displayName: 'WAN口',
                testId: 'network-resource-wan-select',
              },
              expected: 'edge-lab:WAN-extra-',
              params: {
                targetTestId: 'network-resource-wan-select',
                expected: 'edge-lab:WAN-extra-',
              },
              enabled: true,
            }],
          },
        ],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);

      assert(code.includes('selectOwnedOption'), 'the owning Select replay should remain emitted');
      assert(code.includes('edge-lab:WAN-extra-18'), 'the full selected option should remain the replay target');
      assert(!code.includes('getByText("edge-lab:WAN-extra-")'), 'truncated selected-value echo click should not be emitted');
      assert(!code.includes('toContainText("edge-lab:WAN-extra-")'), 'truncated selected-value echo assertion should not be emitted');
    },
  },
  {
    name: 'generic ARIA option does not use AntD select replay',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            role: 'option',
            name: 'Plain Listbox Option',
            text: 'Plain Listbox Option',
            locator: 'internal:role=option[name="Plain Listbox Option"i]',
          },
          context: {
            eventId: 'ctx-generic-option',
            capturedAt: 1000,
            before: {
              target: {
                tag: 'div',
                role: 'option',
                text: 'Plain Listbox Option',
                normalizedText: 'Plain Listbox Option',
                framework: 'generic',
                controlType: 'select-option',
              },
            },
          },
          rawAction: {
            wallTime: 1000,
            endWallTime: 1000,
            action: {
              name: 'click',
              selector: 'internal:role=option[name="Plain Listbox Option"i]',
            },
          },
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      const firstStep = stepCodeBlock(code, 's001');

      assert(!firstStep.includes('.ant-select-dropdown'), 'generic role=option should not be rewritten into AntD dropdown replay');
      assert(firstStep.includes('Plain Listbox Option'), 'generic option should keep a generic locator mentioning its option text');
    },
  },
  {
    name: 'raw title option without AntD context does not use AntD select replay',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            selector: 'internal:attr=[title="plain-title"i]',
            locator: 'internal:attr=[title="plain-title"i]',
          },
          rawAction: {
            action: {
              name: 'click',
              selector: 'internal:attr=[title="plain-title"i]',
            },
          },
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      const firstStep = stepCodeBlock(code, 's001');

      assert(!firstStep.includes('.ant-select-dropdown'), 'raw title alone should not imply AntD select option replay');
    },
  },
  {
    name: 'AntD select option replay is scoped to the active dropdown, trigger-aware, and waits for close',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            selector: 'internal:attr=[title="real-item-a"i]',
            locator: 'internal:attr=[title="real-item-a"i]',
            scope: {
              form: {
                label: '下方表单使用条目',
                testId: 'usage-form',
              },
            },
          },
          context: {
            eventId: 'ctx-select-option',
            capturedAt: 1000,
            before: {
              form: {
                label: '下方表单使用条目',
                testId: 'usage-form',
              },
              target: {
                tag: 'div',
                role: 'option',
                title: 'real-item-a',
                text: 'real-item-a',
                normalizedText: 'real-item-a',
                framework: 'antd',
                controlType: 'select-option',
              },
            },
          },
          rawAction: {
            action: {
              name: 'click',
              selector: 'internal:attr=[title="real-item-a"i]',
            },
          },
          sourceCode: `await page.getByTitle('real-item-a').locator('div').click();`,
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      const firstStep = stepCodeBlock(code, 's001');

      assert(firstStep.includes('AntD Select virtual dropdown replay workaround'), 'AntD workaround should be documented in generated code');
      assert(firstStep.includes('page.getByTestId("usage-form")'), 'AntD replay should open the trigger from contextual test id before falling back to .last()');
      assert(firstStep.includes('ownedRoots()'), 'option lookup should be scoped inside the trigger-owned dropdown/listbox');
      assert(firstStep.includes('dispatchEvent(new MouseEvent("mousedown"'), 'AntD replay should keep the explicit mouse event fallback');
      assert(firstStep.includes('aria-expanded'), 'AntD replay should wait briefly for the owning trigger to collapse after dispatch');
    },
  },
  {
    name: 'AntD select option replay opens owning trigger based on target option visibility',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            selector: 'internal:attr=[title="审计员"i]',
            locator: 'internal:attr=[title="审计员"i]',
            scope: {
              form: {
                label: '角色',
                testId: 'create-user-form',
              },
              dialog: { type: 'modal', title: '新建用户', visible: true },
            },
          },
          context: {
            eventId: 'ctx-role-option',
            capturedAt: 1000,
            before: {
              form: {
                label: '角色',
                testId: 'create-user-form',
              },
              dialog: { type: 'dropdown', title: '角色', visible: true },
              target: {
                tag: 'div',
                role: 'option',
                title: '审计员',
                text: '审计员',
                normalizedText: '审计员',
                framework: 'antd',
                controlType: 'select-option',
              },
            },
          },
          rawAction: {
            action: {
              name: 'click',
              selector: 'internal:attr=[title="审计员"i]',
            },
          },
          sourceCode: `await page.getByTitle('审计员').locator('div').click();`,
          assertions: [],
        }],
      };

      const code = generateBusinessFlowPlaywrightCode(flow);
      const firstStep = stepCodeBlock(code, 's001');

      assert(!firstStep.includes('page.locator(".ant-select-dropdown:visible").first().isVisible()'), 'AntD replay should not treat any visible dropdown as proof that the owning select is open');
      assert(firstStep.includes('if (!await selectOwnedOption(false))'), 'AntD replay should test the trigger-owned target option before opening the owning trigger');
      assert(!firstStep.includes('.catch(async error =>'), 'AntD replay should not fall back to a stale global dropdown when owner lookup fails');
      assert(firstStep.includes('page.getByTestId("create-user-form")'), 'AntD replay should still open the owning trigger through the scoped field locator');
    },
  },
  {
    name: 'contextless tree option after combobox trigger inherits active dropdown scope from source code',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            kind: 'recorded',
            sourceActionIds: ['a001'],
            action: 'click',
            target: {
              scope: { form: { label: '发布范围' } },
            },
            sourceCode: `await page.getByRole("combobox", { name: "* 发布范围" }).click();`,
            rawAction: { action: { name: 'click', selector: 'internal:role=combobox[name="* 发布范围"i]' } },
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            kind: 'recorded',
            sourceActionIds: ['a002'],
            action: 'click',
            target: { text: '华东生产区', name: '华东生产区' },
            sourceCode: `await page.getByText('华东生产区').click();`,
            rawAction: { action: { name: 'click', selector: 'internal:text="华东生产区"i' } },
            assertions: [],
          },
        ],
      };

      const code = generateBusinessFlowPlaywrightCode(flow);
      const optionStep = stepCodeBlock(code, 's002');

      assert(optionStep.includes('.ant-select-dropdown:visible'), 'contextless tree option should inherit active dropdown scope');
      assert(!optionStep.includes('page.getByText("华东生产区")'), 'contextless tree option should not replay through global text');
    },
  },
  {
    name: 'contextless checkbox after select is not inherited as dropdown option',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            kind: 'recorded',
            sourceActionIds: ['a001'],
            action: 'click',
            target: { scope: { form: { label: '关联VRF' } } },
            sourceCode: `await page.getByRole("combobox", { name: "关联VRF" }).click();`,
            rawAction: { action: { name: 'click', selector: 'internal:role=combobox[name="关联VRF"i]' } },
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            kind: 'recorded',
            sourceActionIds: ['a002'],
            action: 'click',
            target: { role: 'checkbox', text: '开启代理ARP', name: '开启代理ARP' },
            sourceCode: `await page.locator('label').filter({ hasText: '开启代理ARP' }).click();`,
            rawAction: { action: { name: 'click', selector: 'internal:label="开启代理ARP"i' } },
            assertions: [],
          },
        ],
      };

      const code = generateBusinessFlowPlaywrightCode(flow);
      const checkboxStep = stepCodeBlock(code, 's002');

      assert(!checkboxStep.includes('AntD Select virtual dropdown replay workaround'), 'checkbox should not inherit previous select option replay');
      assert(checkboxStep.includes('开启代理ARP'), 'checkbox replay should keep its own label');
    },
  },
  {
    name: 'radio click keeps current page context even when stale select metadata is attached',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            selector: 'internal:text="独享地址池"i',
            raw: {
              ui: {
                library: 'pro-components',
                component: 'select',
                targetText: '选择一个VRF',
                form: { label: '关联VRF', fieldKind: 'select' },
                recipe: { kind: 'select-option', optionText: '选择一个VRF' },
              },
            },
            testId: 'network-resource-form',
            role: 'radio',
            name: '选择一个VRF',
            label: '类型',
            text: '选择一个VRF',
            locator: 'internal:text="独享地址池"i',
            displayName: '选择一个VRF',
            scope: {
              form: { title: '端口映射 #1', label: '类型' },
              dialog: { type: 'dropdown' as const, visible: true },
            },
            locatorHint: { strategy: 'global-testid', confidence: 0.99, reason: 'business test id' },
          },
          uiRecipe: {
            kind: 'fill-form-field',
            library: 'pro-components',
            component: 'pro-form-field',
            formKind: 'pro-form',
            fieldKind: 'radio',
            fieldLabel: '类型',
            overlayTitle: '新建网络资源',
            targetText: '独享地址池',
          } as any,
          context: {
            eventId: 'ctx-radio-with-stale-select',
            capturedAt: 1000,
            before: {
              form: { title: '端口映射 #1', label: '类型' },
              target: {
                tag: 'label',
                role: 'radio' as any,
                text: '独享地址池',
                normalizedText: '独享地址池',
                framework: 'procomponents',
                controlType: 'radio',
              },
            },
            after: {
              dialog: { type: 'modal', title: '新建网络资源', visible: true },
            },
          },
          sourceCode: `await page.getByText("独享地址池").click();`,
          rawAction: { action: { name: 'click', selector: 'internal:text="独享地址池"i' } },
          assertions: [],
        }],
      };

      const code = generateBusinessFlowPlaywrightCode(flow);
      const radioStep = stepCodeBlock(code, 's001');

      assert(!radioStep.includes('AntD Select virtual dropdown replay workaround'), 'radio should not be treated as an AntD select option');
      assert(!radioStep.includes('.ant-select-selector'), 'radio replay should not look for select triggers');
      assert(radioStep.includes(`getByRole('dialog', { name: "新建网络资源" }).locator('label').filter({ hasText: "独享地址池" }).click();`), 'radio replay should use the current radio label scoped to the persistent dialog');
    },
  },
  {
    name: 'dropdown tree and cascader option clicks are scoped to the active popup instead of page text',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            text: '华东生产区',
            name: '华东生产区',
          },
          context: {
            eventId: 'ctx-tree-option',
            capturedAt: 1000,
            before: {
              dialog: {
                type: 'dropdown',
                title: '发布范围选项',
                visible: true,
              },
              target: {
                tag: 'span',
                text: '华东生产区',
                normalizedText: '华东生产区',
                framework: 'antd',
              },
            },
          },
          rawAction: {
            action: {
              name: 'click',
              selector: 'internal:text="华东生产区"i',
            },
          },
          sourceCode: `await page.getByText('华东生产区').click();`,
          assertions: [],
        }],
      };

      const code = generateBusinessFlowPlaywrightCode(flow);
      const firstStep = stepCodeBlock(code, 's001');

      assert(firstStep.includes('.ant-select-dropdown:visible'), 'popup option should be scoped to the active AntD dropdown');
      assert(firstStep.includes('.ant-select-tree-node-content-wrapper'), 'tree-select option lookup should be available');
      assert(firstStep.includes('.ant-cascader-menu-item'), 'cascader option lookup should be available');
      assert(firstStep.includes('evaluateAll((elements, expectedText)'), 'active popup option should validate exact visible option text');
      assert(firstStep.includes('AntD option text mismatch'), 'active popup option should fail on partial or wrong text matches');
      assert(!firstStep.includes('filter({ hasText: "华东生产区" }).last().click()'), 'active dropdown fallback must not use partial last-match clicks');
      assert(!firstStep.includes('page.getByText("华东生产区")'), 'active dropdown option should not replay through global page text');
    },
  },
  {
    name: 'exported cascader option replay dispatches the first filtered active item directly',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            text: '上海',
            name: '上海',
            scope: { form: { label: '出口路径' }, dialog: { type: 'modal', title: '新建网络资源', visible: true } },
          },
          context: {
            eventId: 'ctx-cascader-option',
            capturedAt: 1000,
            before: {
              dialog: { type: 'dropdown', title: '出口路径选项', visible: true },
              form: { label: '出口路径' },
              target: {
                tag: 'li',
                text: '上海',
                normalizedText: '上海',
                framework: 'antd',
                controlType: 'cascader-option',
              },
            },
          },
          rawAction: {
            action: {
              name: 'click',
              selector: '.ant-cascader-dropdown .ant-cascader-menu-item >> text=上海',
            },
          },
          assertions: [],
        }],
      };

      const code = generateBusinessFlowPlaywrightCode(flow);
      const firstStep = stepCodeBlock(code, 's001');

      assert(firstStep.includes('.ant-cascader-dropdown:visible'), 'exported cascader replay should stay scoped to the visible cascader popup');
      assert(firstStep.includes('.first().evaluate((element, expectedText)'), 'exported cascader replay should dispatch the first filtered option without re-querying an evaluateAll collection');
      assert(!firstStep.includes('evaluateAll((elements, expectedText)'), 'exported cascader replay should not use the flaky active popup collection scan');
    },
  },
  {
    name: 'exported cascader path replay clicks each path segment in order',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            text: 'combobox * 出口路径',
            name: 'combobox * 出口路径',
            scope: { form: { label: '出口路径' }, dialog: { type: 'modal', title: '新建网络资源', visible: true } },
          },
          context: {
            eventId: 'ctx-repeat-cascader-trigger',
            capturedAt: 800,
            before: {
              dialog: { type: 'modal', title: '新建网络资源', visible: true },
              form: { label: '出口路径' },
              target: {
                tag: 'div',
                text: 'combobox * 出口路径',
                normalizedText: 'combobox * 出口路径',
                framework: 'antd',
                controlType: 'cascader',
                role: 'combobox',
              },
            },
          },
          rawAction: {
            action: {
              name: 'click',
              selector: 'internal:role=combobox[name="* 出口路径"i]',
            },
          },
          assertions: [],
        }, {
          id: 's002',
          order: 2,
          kind: 'recorded',
          sourceActionIds: ['a002'],
          action: 'fill',
          value: 'NAT集群A',
          target: {
            testId: 'network-resource-egress-cascader',
            text: '选择出口路径',
            name: '选择出口路径',
            scope: { form: { label: '出口路径' }, dialog: { type: 'modal', title: '新建网络资源', visible: true } },
          },
          context: {
            eventId: 'ctx-repeat-cascader-search',
            capturedAt: 900,
            before: {
              dialog: { type: 'modal', title: '新建网络资源', visible: true },
              form: { label: '出口路径' },
              target: {
                tag: 'input',
                text: '选择出口路径',
                normalizedText: '选择出口路径',
                testId: 'network-resource-egress-cascader',
                framework: 'antd',
                controlType: 'cascader',
                role: 'combobox',
              },
            },
          },
          rawAction: {
            action: {
              name: 'fill',
              selector: 'internal:testid=[data-testid="network-resource-egress-cascader"] >> input',
              text: 'NAT集群A',
            },
          },
          sourceCode: 'await page.getByTestId("network-resource-egress-cascader").locator("input:visible").first().fill("NAT集群A");',
          assertions: [],
        }, {
          id: 's003',
          order: 3,
          kind: 'recorded',
          sourceActionIds: ['a003'],
          action: 'click',
          target: {
            text: '上海 / 一号机房 / NAT集群A',
            name: '上海 / 一号机房 / NAT集群A',
            scope: { form: { label: '出口路径' }, dialog: { type: 'modal', title: '新建网络资源', visible: true } },
          },
          context: {
            eventId: 'ctx-cascader-path-option',
            capturedAt: 1000,
            before: {
              dialog: { type: 'dropdown', title: '出口路径选项', visible: true },
              form: { label: '出口路径' },
              target: {
                tag: 'li',
                text: '上海 / 一号机房 / NAT集群A',
                normalizedText: '上海 / 一号机房 / NAT集群A',
                optionPath: ['上海', '一号机房', 'NAT集群A'],
                framework: 'antd',
                controlType: 'cascader-option',
              },
            },
          },
          rawAction: {
            action: {
              name: 'click',
              selector: '.ant-cascader-dropdown .ant-cascader-menu-item >> text=NAT集群A',
            },
          },
          assertions: [],
        }],
      };

      const code = generateBusinessFlowPlaywrightCode(flow);
      const firstStep = stepCodeBlock(code, 's003');

      assertTextInOrder(firstStep, [/hasText: "上海"/, /hasText: "一号机房"/, /hasText: "NAT集群A"/]);
      assert(!firstStep.includes('hasText: "上海 / 一号机房 / NAT集群A"'), 'cascader path replay must not look for the whole path as one menu item');
      assert(!code.includes('locator("input:visible").first().fill("NAT集群A")'), 'cascader path replay should skip the intermediate search fill before hierarchical path clicks');
      assertEqual((firstStep.match(/await page\.waitForTimeout\(120\);/g) ?? []).length, 3);
    },
  },
  {
    name: 'repeat segment cascader path replay parameterizes the leaf path segment',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            text: 'combobox * 出口路径',
            name: 'combobox * 出口路径',
            scope: { form: { label: '出口路径' }, dialog: { type: 'modal', title: '新建网络资源', visible: true } },
          },
          context: {
            eventId: 'ctx-repeat-cascader-trigger',
            capturedAt: 800,
            before: {
              dialog: { type: 'modal', title: '新建网络资源', visible: true },
              form: { label: '出口路径' },
              target: {
                tag: 'div',
                text: 'combobox * 出口路径',
                normalizedText: 'combobox * 出口路径',
                framework: 'antd',
                controlType: 'cascader',
                role: 'combobox',
              },
            },
          },
          rawAction: {
            action: {
              name: 'click',
              selector: 'internal:role=combobox[name="* 出口路径"i]',
            },
          },
          assertions: [],
        }, {
          id: 's002',
          order: 2,
          kind: 'recorded',
          sourceActionIds: ['a002'],
          action: 'fill',
          value: 'NAT集群A',
          target: {
            testId: 'network-resource-egress-cascader',
            text: '选择出口路径',
            name: '选择出口路径',
            scope: { form: { label: '出口路径' }, dialog: { type: 'modal', title: '新建网络资源', visible: true } },
          },
          context: {
            eventId: 'ctx-repeat-cascader-search',
            capturedAt: 900,
            before: {
              dialog: { type: 'modal', title: '新建网络资源', visible: true },
              form: { label: '出口路径' },
              target: {
                tag: 'input',
                text: '选择出口路径',
                normalizedText: '选择出口路径',
                testId: 'network-resource-egress-cascader',
                framework: 'antd',
                controlType: 'cascader',
                role: 'combobox',
              },
            },
          },
          rawAction: {
            action: {
              name: 'fill',
              selector: 'internal:testid=[data-testid="network-resource-egress-cascader"] >> input',
              text: 'NAT集群A',
            },
          },
          sourceCode: 'await page.getByTestId("network-resource-egress-cascader").locator("input:visible").first().fill("NAT集群A");',
          assertions: [],
        }, {
          id: 's003',
          order: 3,
          kind: 'recorded',
          sourceActionIds: ['a003'],
          action: 'click',
          target: {
            text: '上海 / 一号机房 / NAT集群A',
            name: '上海 / 一号机房 / NAT集群A',
            scope: { form: { label: '出口路径' }, dialog: { type: 'modal', title: '新建网络资源', visible: true } },
          },
          context: {
            eventId: 'ctx-repeat-cascader-path-option',
            capturedAt: 1000,
            before: {
              dialog: { type: 'dropdown', title: '出口路径选项', visible: true },
              form: { label: '出口路径' },
              target: {
                tag: 'li',
                text: '上海 / 一号机房 / NAT集群A',
                normalizedText: '上海 / 一号机房 / NAT集群A',
                optionPath: ['上海', '一号机房', 'NAT集群A'],
                framework: 'antd',
                controlType: 'cascader-option',
              },
            },
          },
          rawAction: {
            action: {
              name: 'click',
              selector: '.ant-cascader-dropdown .ant-cascader-menu-item >> text=NAT集群A',
            },
          },
          assertions: [],
        }],
        repeatSegments: [{
          id: 'repeat-network',
          name: '批量新建网络资源',
          stepIds: ['s001', 's002', 's003'],
          parameters: [{
            id: 'p-path',
            label: '出口路径',
            sourceStepId: 's003',
            currentValue: 'NAT集群A',
            variableName: 'path',
            enabled: true,
          }],
          rows: [
            { id: 'row-1', values: { 'p-path': 'NAT集群A' } },
            { id: 'row-2', values: { 'p-path': 'NAT集群B' } },
          ],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }],
      };

      const code = generateBusinessFlowPlaywrightCode(flow);
      const loopStart = code.indexOf('for (const row of');
      const loopBody = code.slice(loopStart, code.indexOf('\n  }', loopStart));

      assertTextInOrder(loopBody, [/hasText: "上海"/, /hasText: "一号机房"/, /hasText: String\(row\.path\)/]);
      assert(!loopBody.includes('hasText: "上海 / 一号机房 / NAT集群A"'), 'repeat cascader path replay must not look for the whole path as one menu item');
      assert(loopBody.includes('}, String(row.path));'), 'repeat cascader path replay should validate the dynamic leaf option');
      assert(!loopBody.includes('locator("input:visible").first().fill("NAT集群A")'), 'repeat cascader path replay should skip the intermediate cascader search fill before hierarchical path clicks');
    },
  },
  {
    name: 'exported tree-select option opens owning trigger and dispatches the first filtered item',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            text: '华东生产区',
            name: '华东生产区',
            scope: { form: { label: '发布范围' }, dialog: { type: 'modal', title: '新建网络资源', visible: true } },
          },
          context: {
            eventId: 'ctx-tree-option',
            capturedAt: 1000,
            before: {
              dialog: { type: 'dropdown', title: '全国站点', visible: true },
              form: { label: '发布范围' },
              target: {
                tag: 'span',
                role: 'treeitem',
                text: '华东生产区',
                normalizedText: '华东生产区',
                framework: 'antd',
                controlType: 'tree-select-option',
                optionPath: ['华东生产区'],
              },
            },
          },
          rawAction: {
            action: {
              name: 'click',
              selector: '.ant-select-tree-node-content-wrapper >> text=华东生产区',
            },
          },
          assertions: [],
        }],
      };

      const code = generateBusinessFlowPlaywrightCode(flow);
      const firstStep = stepCodeBlock(code, 's001');

      assert(firstStep.includes('华东生产区'), 'tree-select option text should be preserved in generated replay');
      assert(firstStep.includes('if (!await page.locator(".ant-select-dropdown:visible").last().locator(".ant-select-tree-node-content-wrapper").filter({ hasText: "华东生产区" }).first().isVisible().catch(() => false))'), 'tree-select replay should open the owning trigger based on target option visibility, not any visible dropdown');
      assert(firstStep.includes('.filter({ hasText: "发布范围" })'), 'tree-select replay should reopen the owning form field trigger');
      assert(firstStep.includes('.locator(".ant-select-selector, .ant-cascader-picker, .ant-select").first().click();'), 'tree-select replay should click the owning AntD trigger when the target option is absent');
      assert(firstStep.includes('.first().evaluate((element, expectedText)'), 'tree-select replay should dispatch the first filtered option directly');
      assert(!firstStep.includes('evaluateAll((elements, expectedText)'), 'tree-select replay should not use the flaky active popup collection scan');
      assert(!firstStep.includes('page.getByText("华东生产区")'), 'tree-select replay should not fall back to global page text');
    },
  },
  {
    name: 'AntD select option generation ignores object labels and uses string fallback',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            selector: 'internal:attr=[title="default"i] >> div',
            raw: { selector: 'internal:attr=[title="default"i] >> div' },
            role: 'option',
            name: undefined as any,
          },
          context: {
            eventId: 'ctx-option-object',
            capturedAt: 1000,
            before: {
              dialog: { type: 'dropdown', visible: true },
              target: {
                tag: 'div',
                role: 'option',
                text: { label: 'default' } as any,
                normalizedText: { label: 'default' } as any,
                controlType: 'select-option',
                framework: 'antd',
              },
            },
          },
          rawAction: rawClickAction('internal:attr=[title="default"i] >> div'),
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      assert(!code.includes('[object Object]'), 'object option labels must not leak into generated locators');
      assert(code.includes('"default"'), 'string fallback option title should be used');
    },
  },
  {
    name: 'business flow playback code keeps active popup option replay parser safe after manual waits',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            kind: 'recorded',
            sourceActionIds: ['a001'],
            action: 'click',
            target: { testId: 'site-save-button', text: '保存配置' },
            rawAction: testIdClickAction('site-save-button'),
            sourceCode: `await page.getByTestId('site-save-button').click();`,
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            kind: 'manual',
            action: 'wait',
            value: '5000',
            sourceCode: `await page.waitForLoadState('networkidle').catch(() => {});\nawait page.waitForTimeout(5000);`,
            assertions: [],
          },
          {
            id: 's003',
            order: 3,
            kind: 'recorded',
            sourceActionIds: ['a002'],
            action: 'click',
            target: { text: '华东生产区', name: '华东生产区' },
            context: {
              eventId: 'ctx-active-popup',
              capturedAt: 2000,
              before: {
                dialog: { type: 'dropdown', visible: true },
                target: { tag: 'div', role: 'option', text: '华东生产区', normalizedText: '华东生产区', framework: 'antd', controlType: 'select-option' },
              },
            },
            rawAction: { action: { name: 'click', selector: 'internal:text="华东生产区"i' } },
            sourceCode: `await page.getByText('华东生产区').click();`,
            assertions: [],
          },
        ],
      };
      const playbackCode = generateBusinessFlowPlaybackCode(flow);

      assert(playbackCode.includes('waitForTimeout(5000)'), 'manual wait should stay in playback code');
      assert(!playbackCode.includes('waitForLoadState'), 'runtime playback code should not include unsupported load-state wait wrappers');
      assert(!playbackCode.includes('.catch('), 'runtime playback code should not include unsupported catch continuations');
      assert(!playbackCode.includes('evaluateAll'), 'runtime playback code should not include unsupported evaluate callbacks for active popup options');
      assert(!playbackCode.includes('if (!await'), 'runtime playback code should not include unsupported control flow for active popup options');
      assert(!playbackCode.includes('.first()'), 'runtime playback code should avoid unsupported locator first() calls');
      assert(!playbackCode.includes('.last()'), 'runtime playback code should avoid unsupported locator last() calls');
      assert(playbackCode.includes('.ant-select-dropdown:not(.ant-select-dropdown-hidden)'), 'runtime playback should keep the CrxPlayer active dropdown contract');
      assert(playbackCode.includes('.click();'), 'runtime playback should remain parseable click actions');
    },
  },
  {
    name: 'dropdown option page context is ignored for non-option click steps',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            role: 'button',
            name: '确定',
            text: '确定',
          },
          rawAction: {
            wallTime: 1000,
            endWallTime: 1000,
            action: {
              name: 'click',
              selector: 'internal:role=button[name="确定"i]',
            },
          },
          assertions: [],
        }],
      };
      const merged = mergePageContextIntoFlow(flow, [pageClickEventWithTarget('stale-option', 1000, {
        tag: 'div',
        role: 'option',
        title: '审计员',
        text: '审计员',
        normalizedText: '审计员',
        framework: 'antd',
        controlType: 'select-option',
      })]);

      assertEqual(merged.steps[0].target?.role, 'button');
      assertEqual(merged.steps[0].target?.name, '确定');
      assert(!merged.steps[0].context, 'stale option context should not be attached to a normal button step');
    },
  },
  {
    name: 'business flow playback code keeps AntD option replay parser safe',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            selector: 'internal:attr=[title="real-item-a"i]',
            locator: 'internal:attr=[title="real-item-a"i]',
          },
          context: {
            eventId: 'ctx-select-option',
            capturedAt: 1000,
            before: {
              target: {
                tag: 'div',
                role: 'option',
                title: 'real-item-a',
                text: 'real-item-a',
                normalizedText: 'real-item-a',
                framework: 'antd',
                controlType: 'select-option',
              },
            },
          },
          rawAction: {
            action: {
              name: 'click',
              selector: 'internal:attr=[title="real-item-a"i]',
            },
          },
          sourceCode: `await page.getByTitle('real-item-a').locator('div').click();`,
          assertions: [],
        }],
      };
      const playbackCode = generateBusinessFlowPlaybackCode(flow);

      assert(!playbackCode.includes('if (!await'), 'runtime playback code should not include unsupported control flow');
      assert(!playbackCode.includes('.evaluate('), 'runtime playback code should not include unsupported evaluate callbacks');
      assert(playbackCode.includes('.ant-select-item-option'), 'runtime playback should still target the visible AntD option');
      assert(playbackCode.includes('.click();'), 'runtime playback should remain a parseable click action');
    },
  },
  {
    name: 'playback action count uses parser-safe AntD option code',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            selector: 'internal:attr=[title="real-item-a"i]',
            locator: 'internal:attr=[title="real-item-a"i]',
          },
          context: {
            eventId: 'ctx-select-option',
            capturedAt: 1000,
            before: {
              target: {
                tag: 'div',
                role: 'option',
                title: 'real-item-a',
                text: 'real-item-a',
                normalizedText: 'real-item-a',
                framework: 'antd',
                controlType: 'select-option',
              },
            },
          },
          rawAction: {
            action: {
              name: 'click',
              selector: 'internal:attr=[title="real-item-a"i]',
            },
          },
          sourceCode: `await page.getByTitle('real-item-a').locator('div').click();`,
          assertions: [],
        }],
      };

      const exportedCode = generateBusinessFlowPlaywrightCode(flow);
      assert(exportedCode.includes('selectOwnedOption(true)'), 'exported Playwright code should keep the AntD dispatch workaround');
      assertEqual(countBusinessFlowPlaybackActions(flow), 1);
    },
  },
  {
    name: 'dropdown option context prefers complete title over truncated highlighted text',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: { selector: 'internal:role=option[name="edge-lab:WAN-extra-18"i]' },
          rawAction: { wallTime: 1000, action: { name: 'click', selector: 'internal:role=option[name="edge-lab:WAN-extra-18"i]' } },
          assertions: [],
        }],
      };
      const merged = mergePageContextIntoFlow(flow, [pageClickEventWithTarget('ctx-wan-extra', 1000, {
        tag: 'div',
        role: 'option',
        title: 'edge-lab:WAN-extra-18',
        text: 'edge-lab:WAN-extra-',
        normalizedText: 'edge-lab:WAN-extra-',
        framework: 'antd',
        controlType: 'select-option',
      } as ElementContext)]);

      assertEqual(merged.steps[0].target?.text, 'edge-lab:WAN-extra-18');
      assertEqual(merged.steps[0].target?.displayName, 'edge-lab:WAN-extra-18');
    },
  },
  {
    name: 'ProFormSelect trigger click uses form-item scoped AntD selector instead of combobox role',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            selector: '#rc_select_14',
            locator: '#rc_select_14',
            name: '选择一个WAN口',
            text: '选择一个WAN口',
            displayName: '选择一个WAN口',
            scope: {
              dialog: {
                type: 'modal',
                title: '新建IPv4地址池',
                visible: true,
              },
              form: {
                label: 'WAN口',
                name: 'rc.select.14',
              },
            },
          },
          context: {
            eventId: 'ctx-wan-trigger',
            capturedAt: 1000,
            before: {
              dialog: {
                type: 'modal',
                title: '新建IPv4地址池',
                visible: true,
              },
              form: {
                label: 'WAN口',
                name: 'rc.select.14',
              },
              target: {
                tag: 'div',
                text: '选择一个WAN口',
                normalizedText: '选择一个WAN口',
                framework: 'procomponents',
                controlType: 'select',
                locatorQuality: 'semantic',
              },
            },
          },
          rawAction: {
            action: {
              name: 'click',
              selector: '#rc_select_14',
            },
          },
          sourceCode: `await page.locator('#rc_select_14').click();`,
          assertions: [],
        }],
      };

      const exportedCode = generateBusinessFlowPlaywrightCode(flow);
      const playbackCode = generateBusinessFlowPlaybackCode(flow);
      for (const code of [exportedCode, playbackCode]) {
        const firstStep = stepCodeBlock(code, 's001');
        assert(firstStep.includes('filter({ hasText: "新建IPv4地址池" })'), 'trigger should keep dialog scope');
        assert(firstStep.includes('locator(".ant-form-item").filter({ hasText: "WAN口" }).locator(".ant-select-selector, .ant-cascader-picker, .ant-select").first().click();'), 'trigger should click the visible AntD select selector inside the labeled form item');
        assert(!firstStep.includes('getByRole(\'combobox\'') && !firstStep.includes('getByRole("combobox"'), 'trigger should not rely on combobox accessible name for AntD ProFormSelect');
        assert(!firstStep.includes('#rc_select_14'), 'trigger should not replay the dynamic rc_select id');
      }
    },
  },
  {
    name: 'ProFormSelect trigger with tooltip suffix uses normalized form-item label',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            role: 'combobox',
            name: '* IP地址池 question-circle',
            displayName: '* IP地址池 question-circle',
          },
          rawAction: {
            action: {
              name: 'click',
              selector: 'internal:role=combobox[name="* IP地址池 question-circle"i]',
            },
          },
          sourceCode: `await page.getByRole("combobox", { name: "* IP地址池 question-circle" }).click();`,
          assertions: [],
        }],
      };

      const playbackCode = generateBusinessFlowPlaybackCode(flow);
      const firstStep = stepCodeBlock(playbackCode, 's001');
      const executableStepCode = firstStep.split('\n').slice(1).join('\n');
      assert(executableStepCode.includes('locator(".ant-form-item").filter({ hasText: "IP地址池" }).locator(".ant-select-selector, .ant-cascader-picker, .ant-select").first().click();'), 'tooltip suffix should be stripped before locating the ProFormSelect trigger');
      assert(!executableStepCode.includes('question-circle'), 'runtime trigger should not depend on tooltip text');
      assert(!executableStepCode.includes('getByRole("combobox"') && !executableStepCode.includes('getByRole(\'combobox\''), 'runtime trigger should not use the brittle combobox role');
    },
  },
  {
    name: 'select trigger recorded as button uses structured form context instead of duplicate role button',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            role: 'button',
            name: '业务域',
            text: '业务域',
            displayName: '业务域',
          },
          context: {
            eventId: 'ctx-generic-select-trigger-button',
            capturedAt: 1000,
            before: {
              dialog: { type: 'modal', title: '新建业务配置', visible: true },
              form: { label: '业务域', name: 'domain' },
              target: {
                tag: 'div',
                text: '',
                framework: 'procomponents',
                controlType: 'select',
                locatorQuality: 'semantic',
              },
            },
          },
          rawAction: {
            action: {
              name: 'click',
              selector: 'internal:role=button[name="业务域"i] >> nth=4',
            },
          },
          sourceCode: `await page.getByRole('button', { name: '业务域' }).nth(4).click();`,
          assertions: [],
        }],
      };

      const playbackCode = generateBusinessFlowPlaybackCode(flow);
      const firstStep = stepCodeBlock(playbackCode, 's001');
      assert(firstStep.includes('locator(".ant-form-item").filter({ hasText: "业务域" }).locator(".ant-select-selector, .ant-cascader-picker, .ant-select").first().click();'), 'button-looking select trigger should click the owning form-item selector');
      assert(!firstStep.includes('getByRole("button"') && !firstStep.includes("getByRole('button'"), 'trigger should not replay through duplicate button role');
      assert(!firstStep.includes('nth(4)'), 'trigger should not replay through brittle duplicate ordinal');
    },
  },
  {
    name: 'select trigger with test id still avoids parser-safe duplicate role fallback',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            role: 'button',
            name: '选择一个WAN口',
            text: '选择一个WAN口',
            displayName: '选择一个WAN口',
            testId: 'site-ip-address-pool-wan-select',
            locatorHint: {
              strategy: 'global-testid',
              confidence: 0.98,
              pageCount: 8,
              pageIndex: 4,
            },
          },
          context: {
            eventId: 'ctx-wan-select-trigger-button',
            capturedAt: 1000,
            before: {
              dialog: { type: 'modal', title: '新建IPv4地址池', visible: true },
              form: { label: 'WAN口', name: 'wan' },
              target: {
                tag: 'div',
                role: 'button',
                text: '选择一个WAN口',
                testId: 'site-ip-address-pool-wan-select',
                framework: 'procomponents',
                controlType: 'select',
                uniqueness: {
                  pageCount: 8,
                  pageIndex: 4,
                },
              },
            },
          },
          rawAction: {
            action: {
              name: 'click',
              selector: 'internal:role=button[name="选择一个WAN口"i] >> nth=4',
            },
          },
          sourceCode: `await page.getByRole('button', { name: '选择一个WAN口' }).nth(4).click({ force: true });`,
          assertions: [],
        }],
      };

      const playbackCode = generateBusinessFlowPlaybackCode(flow);
      const firstStep = stepCodeBlock(playbackCode, 's001');
      assert(firstStep.includes('page.getByTestId("site-ip-address-pool-wan-select").click();'), 'select trigger should keep its stable test id instead of duplicate button fallback');
      assert(!firstStep.includes('getByRole("button"') && !firstStep.includes("getByRole('button'"), 'trigger should not replay through duplicate button role');
      assert(!firstStep.includes('nth(4)'), 'trigger should not replay through brittle duplicate ordinal');
    },
  },
  {
    name: 'tree-select and cascader triggers recorded as buttons avoid duplicate role fallback',
    run: () => {
      const samples = [
        { controlType: 'tree-select', label: '发布范围', triggerText: '请选择发布范围', nth: 3 },
        { controlType: 'cascader', label: '出口路径', triggerText: '选择出口路径', nth: 5 },
      ] as const;

      for (const sample of samples) {
        const flow: BusinessFlow = {
          ...createNamedFlow(),
          steps: [{
            id: 's001',
            order: 1,
            kind: 'recorded',
            sourceActionIds: ['a001'],
            action: 'click',
            target: {
              role: 'button',
              name: sample.triggerText,
              text: sample.triggerText,
              displayName: sample.triggerText,
              locatorHint: {
                strategy: 'global-role',
                confidence: 0.62,
                pageCount: 8,
                pageIndex: sample.nth,
              },
            },
            context: {
              eventId: `ctx-${sample.controlType}-trigger-button`,
              capturedAt: 1000,
              before: {
                dialog: { type: 'modal', title: '新建业务配置', visible: true },
                form: { label: sample.label, name: sample.controlType },
                target: {
                  tag: 'div',
                  role: 'button',
                  text: sample.triggerText,
                  framework: 'procomponents',
                  controlType: sample.controlType,
                  uniqueness: {
                    pageCount: 8,
                    pageIndex: sample.nth,
                  },
                },
              },
            },
            rawAction: {
              action: {
                name: 'click',
                selector: `internal:role=button[name="${sample.triggerText}"i] >> nth=${sample.nth}`,
              },
            },
            sourceCode: `await page.getByRole('button', { name: '${sample.triggerText}' }).nth(${sample.nth}).click({ force: true });`,
            assertions: [],
          }],
        };

        const playbackCode = generateBusinessFlowPlaybackCode(flow);
        const firstStep = stepCodeBlock(playbackCode, 's001');
        assert(firstStep.includes(`locator(".ant-form-item").filter({ hasText: "${sample.label}" }).locator(".ant-select-selector, .ant-cascader-picker, .ant-select").first().click();`), `${sample.controlType} trigger should click the owning form-item selector`);
        assert(!firstStep.includes('getByRole("button"') && !firstStep.includes("getByRole('button'"), `${sample.controlType} trigger should not replay through duplicate button role`);
        assert(!firstStep.includes(`nth(${sample.nth})`), `${sample.controlType} trigger should not replay through brittle duplicate ordinal`);
      }
    },
  },
  {
    name: 'ProFormSelect search fill uses form-item scoped AntD input instead of combobox role',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'fill',
          target: {
            role: 'combobox',
            name: '* WAN口',
            label: 'WAN口',
            text: '选择一个WAN口',
            scope: {
              dialog: { type: 'modal', title: '新建网络资源', visible: true },
              form: { label: 'WAN口', name: 'wan' },
            },
          },
          value: 'WAN-extra-18',
          context: {
            eventId: 'ctx-select-fill',
            capturedAt: 1000,
            before: {
              dialog: { type: 'modal', title: '新建网络资源', visible: true },
              form: { label: 'WAN口', name: 'wan' },
              target: {
                tag: 'div',
                text: '选择一个WAN口',
                normalizedText: '选择一个WAN口',
                framework: 'procomponents',
                controlType: 'select',
              },
            },
          },
          rawAction: {
            action: {
              name: 'fill',
              selector: 'internal:role=combobox[name="* WAN口"i]',
              text: 'WAN-extra-18',
            },
          },
          sourceCode: `await page.getByRole('combobox', { name: '* WAN口' }).fill('WAN-extra-18');`,
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      const firstStep = stepCodeBlock(code, 's001');

      assert(firstStep.includes('locator(".ant-form-item").filter({ hasText: "WAN口" }).locator(".ant-select-selector, .ant-cascader-picker, .ant-select").first().locator("input:visible").first().fill("WAN-extra-18");'), 'search fill should target the visible input inside the scoped ProFormSelect trigger');
      assert(!firstStep.includes('getByRole(\'combobox\'') && !firstStep.includes('getByRole("combobox"'), 'search fill should not rely on brittle combobox accessible name');
      assert(!firstStep.includes('internal:role=combobox'), 'search fill should not replay the raw combobox selector');
    },
  },
  {
    name: 'ProFormSelect option fallback strips required marker when reopening form item',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'fill',
          target: {
            role: 'combobox',
            name: '* WAN口',
            label: '* WAN口',
            scope: { form: { label: '* WAN口', name: 'wan' } },
          },
          value: 'xtest16',
          context: {
            eventId: 'ctx-wan-search',
            capturedAt: 1000,
            before: {
              form: { label: '* WAN口', name: 'wan' },
              target: {
                framework: 'procomponents',
                controlType: 'select',
                role: 'combobox',
              },
            },
          },
          rawAction: { action: { name: 'fill', selector: 'internal:role=combobox[name="* WAN口"i]', text: 'xtest16' } },
          sourceCode: `await page.getByRole('combobox', { name: '* WAN口' }).fill('xtest16');`,
          assertions: [],
        }, {
          id: 's002',
          order: 2,
          kind: 'recorded',
          sourceActionIds: ['a002'],
          action: 'click',
          target: { text: 'xtest16:WAN1', displayName: 'xtest16:WAN1' },
          rawAction: { action: { name: 'click', selector: 'internal:text="xtest16:WAN1"i' } },
          sourceCode: `await page.getByText('xtest16:WAN1').click();`,
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      const optionStep = stepCodeBlock(code, 's002');

      assert(optionStep.includes('filter({ hasText: "WAN口" })'), 'required marker should be stripped for form-item text matching');
      assert(!optionStep.includes('filter({ hasText: "* WAN口" })'), 'form-item text matching should not require the visual required marker');
    },
  },
  {
    name: 'fill with stable test id ignores polluted ProFormSelect label context',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'fill',
          target: {
            testId: 'network-resource-name',
            name: '选择一个WAN口',
            placeholder: '地址池名称',
            displayName: '选择一个WAN口',
            scope: {
              dialog: { type: 'modal', title: '新建网络资源', visible: true },
              form: { label: 'WAN口', name: 'wan' },
            },
          },
          value: 'pool-proform-alpha',
          context: {
            eventId: 'ctx-polluted-name-fill',
            capturedAt: 1000,
            before: {
              dialog: { type: 'modal', title: '新建网络资源', visible: true },
              form: { label: 'WAN口', name: 'wan' },
              target: {
                tag: 'input',
                testId: 'network-resource-name',
                placeholder: '地址池名称',
                framework: 'procomponents',
                controlType: 'input',
              },
              ui: {
                library: 'pro-components',
                component: 'pro-form-field',
                targetTestId: 'network-resource-name',
                form: { label: '资源名称', name: 'name', placeholder: '地址池名称' },
                locatorHints: [],
                confidence: 0.9,
                reasons: [],
              },
            },
          },
          rawAction: {
            action: {
              name: 'fill',
              selector: 'internal:testid=[data-testid="network-resource-name"s]',
              text: 'pool-proform-alpha',
            },
          },
          sourceCode: `await page.locator(".ant-form-item").filter({ hasText: "WAN口" }).locator(".ant-select-selector, .ant-cascader-picker, .ant-select").first().locator("input").first().fill("pool-proform-alpha");`,
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      const firstStep = stepCodeBlock(code, 's001');

      assert(firstStep.includes('page.getByTestId("network-resource-name").fill("pool-proform-alpha");'), 'stable test id fill should win over polluted select label context');
      assert(!firstStep.includes('filter({ hasText: "WAN口" })'), 'resource-name fill should not target the WAN ProFormSelect input');
    },
  },
  {
    name: 'actual textarea test id is not treated as a field wrapper without context',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'fill',
          target: {
            testId: 'network-resource-remark',
            role: 'textbox',
            displayName: 'network-resource-remark',
            scope: {
              dialog: { type: 'modal', title: '新建网络资源', visible: true },
              form: { testId: 'network-resource-remark' },
            },
          },
          value: 'production policy',
          rawAction: {
            action: {
              name: 'fill',
              selector: 'internal:testid=[data-testid="network-resource-remark"s]',
              text: 'production policy',
            },
          },
          sourceCode: `await page.getByTestId("network-resource-remark").locator("input:visible, textarea:visible, [contenteditable=\\"true\\"]").first().fill("production policy");`,
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      const firstStep = stepCodeBlock(code, 's001');

      assert(firstStep.includes('page.getByTestId("network-resource-remark").fill("production policy");'), 'actual textarea test id should be filled directly');
      assert(!firstStep.includes('locator("input:visible, textarea:visible'), 'actual textarea test id must not be downgraded to a child-input wrapper locator');
    },
  },
  {
    name: 'actual input-like test id is not downgraded to wrapper child locator',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'fill',
          target: {
            testId: 'wan-transport-egress-disable-threshold-input',
            displayName: 'wan-transport-egress-disable-threshold-input',
            scope: {
              dialog: { type: 'modal', title: '增加传输网络', visible: true },
              form: { testId: 'wan-transport-egress-disable-threshold-input' },
            },
          },
          value: '3',
          rawAction: {
            action: {
              name: 'fill',
              selector: 'internal:testid=[data-testid="wan-transport-egress-disable-threshold-input"s]',
              text: '3',
            },
          },
          sourceCode: `await page.getByTestId("wan-transport-egress-disable-threshold-input").locator("input:visible, textarea:visible, [contenteditable=\\"true\\"]").first().fill("3");`,
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      const firstStep = stepCodeBlock(code, 's001');

      assert(firstStep.includes('page.getByTestId("wan-transport-egress-disable-threshold-input").fill("3");'), 'input-like test id should be filled directly');
      assert(!firstStep.includes('locator("input:visible, textarea:visible'), 'input-like test id must not be treated as a field wrapper');
    },
  },
  {
    name: 'direct input test id containing field is not treated as wrapper without page context evidence',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'fill',
          target: {
            testId: 'email-field',
            role: 'textbox',
            displayName: 'email-field',
          },
          value: 'owner@example.com',
          rawAction: {
            action: {
              name: 'fill',
              selector: 'internal:testid=[data-testid="email-field"s]',
              text: 'owner@example.com',
            },
          },
          sourceCode: `await page.getByTestId("email-field").locator("input:visible, textarea:visible, [contenteditable=\\"true\\"]").first().fill("owner@example.com");`,
          assertions: [],
        }],
      };
      const firstStep = stepCodeBlock(generateBusinessFlowPlaywrightCode(flow), 's001');

      assert(firstStep.includes('page.getByTestId("email-field").fill("owner@example.com");'), 'actual input test id ending in field should be filled directly');
      assert(!firstStep.includes('locator("input:visible, textarea:visible'), 'field-like actual input test id must not be treated as a wrapper');
    },
  },
  {
    name: 'text fill without following option ignores stale AntD Select metadata',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'fill',
          target: {
            label: '地址池名称',
            displayName: '地址池名称',
            scope: { form: { label: '地址池名称', name: 'poolName' } },
          },
          value: 'pool-alpha',
          context: {
            eventId: 'ctx-address-pool-name-fill',
            capturedAt: 1000,
            before: {
              form: { label: '地址池名称', name: 'poolName' },
              target: {
                framework: 'antd',
                controlType: 'select',
              },
            },
          },
          rawAction: {
            action: {
              name: 'fill',
              selector: '.ant-form-item:has-text("地址池名称") .ant-select-selector input',
              text: 'pool-alpha',
            },
          },
          sourceCode: `await page.locator(".ant-form-item").filter({ hasText: "地址池名称" }).locator(".ant-select-selector, .ant-cascader-picker, .ant-select").first().locator("input").first().fill("pool-alpha");`,
          assertions: [],
        }, {
          id: 's002',
          order: 2,
          kind: 'recorded',
          sourceActionIds: ['a002'],
          action: 'click',
          target: { testId: 'site-save-button', name: '保存配置' },
          rawAction: { action: { name: 'click', selector: 'internal:testid=[data-testid="site-save-button"s]' } },
          sourceCode: `await page.getByTestId('site-save-button').click();`,
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      const firstStep = stepCodeBlock(code, 's001');

      assert(firstStep.includes('getByLabel("地址池名称").fill("pool-alpha")'), 'text field fill should use label fallback when no dropdown option follows');
      assert(!firstStep.includes('.ant-select-selector'), 'stale select source should not force a text fill through an AntD Select trigger');
    },
  },
  {
    name: 'input focus click ignores stale AntD Select selector metadata',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            label: '地址池名称',
            displayName: '地址池名称',
            scope: { form: { label: '地址池名称', name: 'poolName' } },
          },
          context: {
            eventId: 'ctx-address-pool-name-click',
            capturedAt: 1000,
            before: {
              form: { label: '地址池名称', name: 'poolName' },
              target: {
                tag: 'input',
                framework: 'antd',
                controlType: 'input',
                role: 'textbox',
                placeholder: '地址池名称',
              },
            },
          },
          rawAction: {
            action: {
              name: 'click',
              selector: 'internal:role=combobox[name="地址池名称"i]',
            },
          },
          sourceCode: `await page.locator(".ant-form-item").filter({ hasText: "地址池名称" }).locator(".ant-select-selector, .ant-cascader-picker, .ant-select").first().click();`,
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      const clickStep = stepCodeBlock(code, 's001');

      assert(clickStep.includes('getByLabel("地址池名称").click()') || clickStep.includes('getByPlaceholder("地址池名称").click()'), 'explicit input context should replay as a text-field focus click');
      assert(!clickStep.includes('.ant-select-selector'), 'stale select source should not turn an input focus click into a select trigger');
    },
  },
  {
    name: 'bare text option after select trigger replays through active dropdown locator',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            role: 'combobox',
            label: '关联VRF',
            displayName: '关联VRF',
            scope: { form: { label: '关联VRF', name: 'vrf' } },
          },
          context: {
            eventId: 'ctx-vrf-trigger',
            capturedAt: 1000,
            before: {
              form: { label: '关联VRF', name: 'vrf' },
              target: {
                framework: 'antd',
                controlType: 'select',
                role: 'combobox',
              },
            },
          },
          rawAction: { action: { name: 'click', selector: 'internal:role=combobox[name="关联VRF"i]' } },
          sourceCode: `await page.getByRole('combobox', { name: '关联VRF' }).click();`,
          assertions: [],
        }, {
          id: 's002',
          order: 2,
          kind: 'recorded',
          sourceActionIds: ['a002'],
          action: 'click',
          target: {
            text: '生产VRF',
            displayName: '生产VRF',
          },
          rawAction: { action: { name: 'click', selector: 'internal:text="生产VRF"i' } },
          sourceCode: `await page.getByText('生产VRF').click();`,
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      const optionStep = stepCodeBlock(code, 's002');

      assert(optionStep.includes('selectOwnedOption(false)'), 'context-light option should use trigger-owned option replay');
      assert(!optionStep.includes('getByText(\'生产VRF\')') && !optionStep.includes('getByText("生产VRF")'), 'context-light option should not replay as a page-global text click');
    },
  },
  {
    name: 'contextless option with noisy page text prefers raw title for select inheritance',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'fill',
          target: {
            role: 'combobox',
            label: '共享WAN',
            text: '选择共享 WAN',
            displayName: '选择共享 WAN',
            scope: { form: { label: '共享WAN', name: 'wanPort' } },
          },
          value: 'WAN1',
          context: {
            eventId: 'ctx-shared-wan-fill',
            capturedAt: 1000,
            before: {
              form: { label: '共享WAN', name: 'wanPort' },
              target: { framework: 'antd', controlType: 'select', text: '选择共享 WAN' },
            },
          },
          rawAction: { action: { name: 'fill', selector: 'internal:role=combobox[name="共享WAN"i]', text: 'WAN1' } },
          sourceCode: `await page.getByRole('combobox', { name: '共享WAN' }).fill('WAN1');`,
          assertions: [],
        }, {
          id: 's002',
          order: 2,
          kind: 'recorded',
          sourceActionIds: ['a002'],
          action: 'click',
          target: {
            label: '地址池名称',
            placeholder: '地址池名称',
            text: '业务流程稳定性测试页 新增IP端口池 地址池名称 共享WAN 备注 pool-alpha --...',
            displayName: '业务流程稳定性测试页 新增IP端口池 地址池名称 共享WAN 备注 pool-alpha --...',
            scope: { dialog: { type: 'dropdown', visible: true }, form: { label: '地址池名称', name: 'root' } },
          },
          context: {
            eventId: 'ctx-noisy-option-click',
            capturedAt: 1100,
            before: {
              dialog: { type: 'dropdown', visible: true },
              form: { label: '地址池名称', name: 'root' },
              target: {
                tag: 'html',
                framework: 'generic',
                controlType: 'select',
                placeholder: '地址池名称',
                text: '业务流程稳定性测试页 新增IP端口池 地址池名称 共享WAN 备注 pool-alpha --...',
              },
            },
          },
          rawAction: { action: { name: 'click', selector: 'internal:attr=[title="WAN1"s] >> div' } },
          sourceCode: `await page.locator('[title="WAN1"]').locator('div').click();`,
          assertions: [{
            id: 'assert-noisy-selected-value',
            type: 'selected-value-visible',
            subject: 'element',
            target: { testId: 'stability-wan-select' },
            expected: '业务流程稳定性测试页 新增IP端口池 校验配置 保存配置 保存后动作 地址池名称 共享WAN 使用备注 地址池名称 共享WAN 备注 pool-alpha --...',
            enabled: true,
          }],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      const optionStep = stepCodeBlock(code, 's002');

      assert(optionStep.includes('selectOwnedOption(false)'), 'noisy option click should replay through the trigger-owned dropdown');
      assert(optionStep.includes('WAN1'), 'raw option title should survive noisy page-text capture');
      assert(!optionStep.includes('filter({ hasText: "地址池名称" }).locator(".ant-select-selector")'), 'noisy option click should not be misread as another form select trigger');
      assert(!optionStep.includes('业务流程稳定性测试页 新增IP端口池 校验配置 保存配置 保存后动作'), 'noisy selected-value assertions should not leak page-text capture into generated replay');
    },
  },
  {
    name: 'mismatched dropdown context is not consumed before the matching option step',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            role: 'combobox',
            label: '角色',
            displayName: '角色',
          },
          rawAction: {
            wallTime: 1000,
            action: {
              name: 'click',
              selector: '#role-select',
            },
          },
          sourceCode: `await page.locator('#role-select').click();`,
          assertions: [],
        }, {
          id: 's002',
          order: 2,
          kind: 'recorded',
          sourceActionIds: ['a002'],
          action: 'click',
          target: {
            selector: 'internal:role=option[name="审计员"i]',
            locator: 'internal:role=option[name="审计员"i]',
          },
          rawAction: {
            wallTime: 1010,
            action: {
              name: 'click',
              selector: 'internal:role=option[name="审计员"i]',
            },
          },
          sourceCode: `await page.getByRole('option', { name: '审计员' }).click();`,
          assertions: [],
        }],
      };
      const merged = mergePageContextIntoFlow(flow, [{
        id: 'ctx-role-option',
        kind: 'click',
        time: 1010,
        wallTime: 1010,
        before: {
          dialog: {
            type: 'dropdown',
            visible: true,
          },
          form: {
            label: '角色',
            name: 'role',
          },
          target: {
            tag: 'div',
            role: 'option',
            title: '审计员',
            text: '审计员',
            normalizedText: '审计员',
            framework: 'antd',
            controlType: 'select-option',
          },
        },
      }]);
      const segment = createRepeatSegment(merged, ['s001', 's002']);

      assertEqual(merged.steps[0].context, undefined);
      assertEqual(merged.steps[1].context?.eventId, 'ctx-role-option');
      assertEqual(segment.parameters.map(parameter => parameter.variableName), ['role']);
    },
  },
  {
    name: 'AntD select option workaround opens ProFormSelect by scoped selector not combobox role',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            selector: 'internal:role=option[name="xtest16:WAN1"i]',
            locator: 'internal:role=option[name="xtest16:WAN1"i]',
            role: 'option',
            name: 'xtest16:WAN1',
            text: 'xtest16:WAN1',
            displayName: 'xtest16:WAN1',
          },
          context: {
            eventId: 'ctx-wan-option',
            capturedAt: 1000,
            before: {
              dialog: {
                type: 'dropdown',
                visible: true,
              },
              form: {
                label: 'WAN口',
                name: 'rc.select.14',
              },
              target: {
                tag: 'div',
                role: 'option',
                title: 'xtest16:WAN1',
                text: 'xtest16:WAN1',
                normalizedText: 'xtest16:WAN1',
                framework: 'antd',
                controlType: 'select-option',
              },
            },
            after: {
              dialog: {
                type: 'modal',
                title: '新建IPv4地址池',
                visible: true,
              },
            },
          },
          rawAction: {
            action: {
              name: 'click',
              selector: 'internal:role=option[name="xtest16:WAN1"i]',
            },
          },
          sourceCode: `await page.getByRole('option', { name: 'xtest16:WAN1' }).click();`,
          assertions: [],
        }],
      };

      const firstStep = stepCodeBlock(generateBusinessFlowPlaywrightCode(flow), 's001');
      assert(firstStep.includes('locator(".ant-form-item").filter({ hasText: "WAN口" }).locator(".ant-select-selector, .ant-cascader-picker, .ant-select").first()'), 'option fallback should open the owning ProFormSelect trigger by form label');
      assert(!firstStep.includes('getByRole("combobox", { name: "WAN口" })'), 'option fallback should not reopen dropdown through brittle combobox role');
    },
  },
  {
    name: 'raw cascader options are not inherited as the previous tree select field',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            role: 'combobox',
            name: '* 发布范围',
            label: '发布范围',
          },
          context: {
            eventId: 'ctx-scope-trigger',
            capturedAt: 1000,
            before: {
              dialog: { type: 'modal', title: '新建网络资源', visible: true },
              form: { label: '发布范围', name: 'scope' },
              target: { tag: 'div', framework: 'procomponents', controlType: 'tree-select' },
            },
          },
          rawAction: { action: { name: 'click', selector: 'internal:role=combobox[name="* 发布范围"i]' } },
          assertions: [],
        }, {
          id: 's002',
          order: 2,
          kind: 'recorded',
          sourceActionIds: ['a002'],
          action: 'click',
          target: {
            role: 'menuitemcheckbox',
            name: '上海',
            text: '上海',
            displayName: '上海',
            raw: {
              tag: 'li',
              role: 'menuitemcheckbox',
              text: '上海',
              framework: 'antd',
              controlType: 'cascader-option',
            },
          },
          rawAction: { action: { name: 'click', selector: 'internal:text="上海"i' } },
          assertions: [],
        }],
      };

      const code = stepCodeBlock(generateBusinessFlowPlaywrightCode(flow), 's002');
      assert(code.includes('.ant-cascader-dropdown:visible'), 'cascader option should use the cascader popup');
      assert(code.includes('.ant-cascader-menu-item'), 'cascader option should use cascader menu items');
      assert(!code.includes('.ant-select-tree-node-content-wrapper'), 'cascader option must not inherit the previous tree-select context');
    },
  },
  {
    name: 'contextless select option getByTitle inner click inherits select field context for replay',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: { role: 'combobox', name: '共享WAN' },
          sourceCode: `await page.getByRole("combobox", { name: "共享WAN" }).click();`,
          rawAction: { action: { name: 'click', selector: 'internal:role=combobox[name="共享WAN"i]' } },
          assertions: [],
        }, {
          id: 's002',
          order: 2,
          kind: 'recorded',
          sourceActionIds: ['a002'],
          action: 'click',
          target: { displayName: 'internal:attr=[title="WAN1"s] >> div' },
          sourceCode: `await page.getByTitle('WAN1', { exact: true }).locator('div').click();`,
          rawAction: { action: { name: 'click', selector: 'internal:attr=[title="WAN1"s] >> div' } },
          assertions: [],
        }],
      };

      const code = stepCodeBlock(generateBusinessFlowPlaywrightCode(flow), 's002');
      assert(code.includes('AntD Select virtual dropdown replay workaround'), 'getByTitle inner option clicks should replay through the AntD option workaround');
      assert(!code.includes("getByTitle('WAN1'"), 'raw title inner click should not be replayed directly');
    },
  },
  {
    name: 'table row clicks prefer row-scoped locators over ambiguous table test ids',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            role: 'row',
            testId: 'users-table',
            text: 'Alice 管理员 编辑',
            scope: {
              table: {
                testId: 'users-table',
                rowKey: 'user-42',
                rowText: 'Alice 管理员 编辑',
              },
            },
          },
          rawAction: { action: { name: 'click', selector: 'internal:testid=[data-testid="users-table"s]' } },
          assertions: [],
        }],
      };

      const code = stepCodeBlock(generateBusinessFlowPlaywrightCode(flow), 's001');
      assert(code.includes('tr[data-row-key="\\"user-42\\""]') || code.includes('tr[data-row-key=\\"user-42\\"]'), 'row click should use the stable row key selector');
      assert(!code.includes('await page.getByTestId("users-table").click();'), 'row click must not replay as an ambiguous table container click');
    },
  },
  {
    name: 'duplicate shared WAN row edit test id keeps row context instead of global strict locator',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            role: 'link',
            testId: 'ha-wan-row-edit-action',
            scope: {
              table: {
                testId: 'ha-wan-table',
                rowKey: 'WAN1',
                rowText: 'WAN1 HS Internet 启用QoS',
              },
            },
            locatorHint: { strategy: 'global-testid', confidence: 0.98, pageCount: 2, pageIndex: 0 },
          },
          rawAction: { action: { name: 'click', selector: 'internal:testid=[data-testid="ha-wan-row-edit-action"s]' } },
          assertions: [],
        }],
      };

      const code = stepCodeBlock(generateBusinessFlowPlaywrightCode(flow), 's001');
      assert(code.includes('page.getByTestId("ha-wan-table").locator("tr[data-row-key=\\"WAN1\\"], [data-row-key=\\"WAN1\\"]").first().getByTestId("ha-wan-row-edit-action").click();'), 'duplicate row action should replay inside the WAN1 table row');
      assert(!code.includes('await page.getByTestId("ha-wan-row-edit-action").click();'), 'duplicate row action must not use a page-global test id click');
    },
  },
  {
    name: 'contract test id renderer keeps reusable row action scoped by row text fallback',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            testId: 'wan-transport-row-delete-action',
            name: 'Nova 私网 business 编辑删除',
            text: 'Nova 私网 business 编辑删除',
            displayName: 'Nova 私网 business 编辑删除',
          },
          sourceCode: 'await page.getByTestId("wan-transport-row-delete-action").click();',
          rawAction: { action: { name: 'click', selector: 'internal:testid=[data-testid="wan-transport-row-delete-action"s]' } },
          assertions: [],
        }],
      };

      const code = stepCodeBlock(generateBusinessFlowPlaywrightCode(flow), 's001');
      assert(code.includes('filter({ hasText: /Nova[\\s\\S]*私网[\\s\\S]*business[\\s\\S]*编辑删除/ })'), 'reusable row action should keep row text scope when rowKey context is late or unavailable');
      assert(code.includes('.getByTestId("wan-transport-row-delete-action").first().click();'), 'row text scoped action should still click the row action test id');
      assert(!code.includes('await page.getByTestId("wan-transport-row-delete-action").click();'), 'contract test id primary must not bypass row-scoped replay for reusable row actions');
    },
  },
  {
    name: 'indexed WAN edit test id keeps ordinal instead of forcing table row key',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            role: 'link',
            testId: 'wan-edit-1',
            scope: {
              table: {
                testId: 'wan-config-table',
                rowKey: '0200727bcf22f788279c5a9e3eb89651',
                rowText: 'WAN1 Nova Internet 通用禁用',
              },
            },
            locatorHint: { strategy: 'global-testid', confidence: 0.98, pageCount: 2, pageIndex: 0 },
          },
          rawAction: { action: { name: 'click', selector: 'internal:testid=[data-testid="wan-edit-1"s]' } },
          assertions: [],
        }],
      };

      const code = stepCodeBlock(generateBusinessFlowPlaywrightCode(flow), 's001');
      assert(code.includes('page.getByTestId("wan-edit-1").nth(0).click();'), 'indexed WAN edit should preserve its captured ordinal locator');
      assert(!code.includes('wan-config-table'), 'indexed WAN edit should not force a volatile table row key scope');
    },
  },
  {
    name: 'parser-safe indexed WAN edit keeps test id instead of duplicate row fallback',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            role: 'row',
            name: 'WAN1 Nova Internet 通用禁用',
            text: 'WAN1 Nova Internet 通用禁用',
            displayName: 'WAN1 Nova Internet 通用禁用',
            testId: 'wan-edit-1',
            locatorHint: { strategy: 'global-testid', confidence: 0.98, pageCount: 2, pageIndex: 0 },
            raw: {
              recorder: { selector: 'internal:testid=[data-testid="wan-edit-1"s]' },
              pageContext: {
                role: 'row',
                text: 'WAN1 Nova Internet 通用禁用',
                uniqueness: { pageCount: 2, pageIndex: 0 },
              },
            },
          },
          context: {
            eventId: 'ctx-wan-row-edit',
            capturedAt: 1000,
            before: {
              target: {
                tag: 'tr',
                role: 'row',
                text: 'WAN1 Nova Internet 通用禁用',
                normalizedText: 'WAN1 Nova Internet 通用禁用',
                uniqueness: { pageCount: 2, pageIndex: 0 },
              },
            },
          },
          rawAction: { action: { name: 'click', selector: 'internal:testid=[data-testid="wan-edit-1"s]' } },
          sourceCode: `await page.getByRole('row', { name: 'WAN1 Nova Internet 通用禁用' }).nth(0).click({ force: true });`,
          assertions: [],
        }],
      };

      const playbackCode = stepCodeBlock(generateBusinessFlowPlaybackCode(flow), 's001');
      assert(playbackCode.includes('page.getByTestId("wan-edit-1").nth(0).click();'), 'runtime indexed WAN edit should keep the captured test id ordinal');
      assert(!playbackCode.includes('getByRole("row"') && !playbackCode.includes("getByRole('row'"), 'runtime indexed WAN edit should not replay through a row role fallback');
    },
  },
  {
    name: 'parser-safe non-button duplicate test id controls keep their test id locator',
    run: () => {
      const samples = [
        { role: 'link', controlType: 'link', testId: 'wan-transport-row-delete-action', text: '删除', nth: 0 },
        { role: 'switch', controlType: 'switch', testId: 'network-resource-health-switch', text: '开启', nth: 1 },
        { role: 'checkbox', controlType: 'checkbox', testId: 'proxy-arp-checkbox', text: '开启代理ARP', nth: 1 },
        { role: 'tab', controlType: 'tab', testId: 'ipv6-tab', text: 'IPv6', nth: 1 },
      ] as const;

      for (const sample of samples) {
        const flow: BusinessFlow = {
          ...createNamedFlow(),
          steps: [{
            id: 's001',
            order: 1,
            kind: 'recorded',
            sourceActionIds: ['a001'],
            action: 'click',
            target: {
              role: sample.role,
              name: sample.text,
              text: sample.text,
              displayName: sample.text,
              testId: sample.testId,
              locatorHint: { strategy: 'global-testid', confidence: 0.98, pageCount: sample.nth + 2, pageIndex: sample.nth },
            },
            context: {
              eventId: `ctx-${sample.testId}`,
              capturedAt: 1000,
              before: {
                target: {
                  tag: 'a',
                  role: sample.role,
                  testId: sample.testId,
                  text: sample.text,
                  normalizedText: sample.text,
                  framework: 'antd',
                  controlType: sample.controlType,
                  uniqueness: { pageCount: sample.nth + 2, pageIndex: sample.nth },
                },
              },
            },
            rawAction: { action: { name: 'click', selector: `internal:testid=[data-testid="${sample.testId}"s] >> nth=${sample.nth}` } },
            sourceCode: `await page.getByRole('${sample.role}', { name: '${sample.text}' }).nth(${sample.nth}).click({ force: true });`,
            assertions: [],
          }],
        };

        const playbackCode = stepCodeBlock(generateBusinessFlowPlaybackCode(flow), 's001');
        if (sample.testId === 'wan-transport-row-delete-action') {
          assert(playbackCode.includes('BAGLC safety guard blocked s001: critical-action-emitted-ordinal-locator'), 'critical duplicate test id delete should fail closed instead of replaying through ordinal');
          assert(!playbackCode.includes(`page.getByTestId("${sample.testId}").nth(${sample.nth}).click();`), 'critical duplicate test id delete must not keep ordinal replay');
          continue;
        }
        assert(playbackCode.includes(`page.getByTestId("${sample.testId}").nth(${sample.nth}).click();`), `${sample.role} duplicate test id should keep its captured test id ordinal`);
        assert(!playbackCode.includes(`getByRole("${sample.role}"`) && !playbackCode.includes(`getByRole('${sample.role}'`), `${sample.role} duplicate test id should not replay through role ordinal fallback`);
      }
    },
  },
  {
    name: 'parser-safe action-like test id without button semantics does not infer button role fallback',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            testId: 'wan-transport-row-delete-action',
            name: '删除',
            text: '删除',
            displayName: '删除',
            locatorHint: { strategy: 'global-testid', confidence: 0.98, pageCount: 2, pageIndex: 0 },
            raw: { controlType: 'link' },
          },
          context: {
            eventId: 'ctx-link-without-role',
            capturedAt: 1000,
            before: {
              target: {
                tag: 'a',
                testId: 'wan-transport-row-delete-action',
                text: '删除',
                normalizedText: '删除',
                framework: 'antd',
                controlType: 'link',
                uniqueness: { pageCount: 2, pageIndex: 0 },
              },
            },
          },
          rawAction: { action: { name: 'click', selector: 'internal:testid=[data-testid="wan-transport-row-delete-action"s] >> nth=0' } },
          sourceCode: `await page.getByRole('button', { name: '删除' }).nth(0).click({ force: true });`,
          assertions: [],
        }],
      };

      const playbackCode = stepCodeBlock(generateBusinessFlowPlaybackCode(flow), 's001');
      assert(playbackCode.includes('BAGLC safety guard blocked s001: critical-action-emitted-ordinal-locator'), 'critical link-like delete test id should fail closed instead of replaying through ordinal');
      assert(!playbackCode.includes('page.getByTestId("wan-transport-row-delete-action").nth(0).click();'), 'critical link-like delete test id must not keep ordinal replay');
      assert(!playbackCode.includes('getByRole("button"') && !playbackCode.includes("getByRole('button'"), 'link-like action test id should not infer button role fallback from its name');
    },
  },
  {
    name: 'shared WAN row click is not rewritten into a guessed edit action',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          target: {
            role: 'row',
            name: 'WAN1 HS Internet 启用QoS',
          },
          context: {
            eventId: 'ctx-shared-wan-edit',
            capturedAt: Date.now(),
            before: {
              target: {
                tag: 'tr',
                role: 'row',
                text: 'WAN1 HS Internet 启用QoS',
                normalizedText: 'WAN1 HS Internet 启用QoS',
              },
            },
            after: {
              dialog: { type: 'modal', title: '编辑 WAN1 共享 WAN', visible: true },
            },
          },
          rawAction: { action: { name: 'click', selector: 'internal:role=row[name="WAN1 HS Internet 启用QoS"i]' } },
          assertions: [],
        }],
      };

      const code = stepCodeBlock(generateBusinessFlowPlaywrightCode(flow), 's001');
      assert(!code.includes('data-testid*=\\"edit\\"'), 'row click should not be converted into an edit control click');
      assert(code.includes('getByRole("row"') || code.includes('internal:role=row'), 'row click should remain a row click when no row action control was recorded');
    },
  },
  {
    name: 'compact flow yaml exports compact UI semantic annotation',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          sourceActionIds: ['a001'],
          action: 'click',
          intent: '编辑 Alice 用户',
          target: { role: 'button', name: '编辑' },
          context: {
            eventId: 'ctx-ui-table-edit',
            capturedAt: Date.now(),
            before: {
              title: '用户中心',
              target: { tag: 'button', role: 'button', text: '编辑' },
              table: { title: '用户管理', rowKey: 'user-42', columnName: '操作' },
              ui: semanticUi({
                library: 'pro-components',
                component: 'pro-table',
                recipe: 'table-row-action',
                tableTitle: '用户管理',
                rowKey: 'user-42',
                columnTitle: '操作',
                targetText: '编辑',
              }),
            } as any,
          },
          uiRecipe: semanticUi({
            library: 'pro-components',
            component: 'pro-table',
            recipe: 'table-row-action',
            tableTitle: '用户管理',
            rowKey: 'user-42',
            columnTitle: '操作',
            targetText: '编辑',
          }).recipe,
          rawAction: { action: { name: 'click', selector: '.ant-table-row .ant-btn' } },
          assertions: [],
        }],
      };

      const yaml = toCompactFlow(flow);
      assert(yaml.includes('ui:'), 'compact yaml should include ui block');
      assert(yaml.includes('library: pro-components'), 'compact ui should include library');
      assert(yaml.includes('component: pro-table'), 'compact ui should include component');
      assert(yaml.includes('recipe: table-row-action'), 'compact ui should include recipe');
      assert(yaml.includes('table: "用户管理"'), 'compact ui should include table title');
      assert(yaml.includes('row: user-42'), 'compact ui should include row key');
      assert(!yaml.includes('locatorHints'), 'compact ui should not dump full locator hints');
      assert(!yaml.includes('rawAction'), 'compact yaml should not leak raw action internals');
    },
  },
  {
    name: 'AI intent input contains compact UI semantic annotation without raw internals',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        flow: { ...createNamedFlow().flow, id: 'flow-ui-ai', name: 'AI UI 语义测试' },
        steps: [{
          id: 's001',
          order: 1,
          kind: 'recorded',
          action: 'click',
          target: { role: 'option', text: '管理员' },
          context: {
            eventId: 'ctx-ui-select-option',
            capturedAt: Date.now(),
            before: {
              target: { tag: 'div', role: 'option', text: '管理员', title: '管理员' },
              form: { label: '角色', name: 'role' },
              dialog: { type: 'dropdown', title: '角色', visible: true },
              ui: semanticUi({
                library: 'antd',
                component: 'select',
                recipe: 'select-option',
                fieldLabel: '角色',
                optionText: '管理员',
                overlayTitle: '角色',
              }),
            } as any,
          },
          uiRecipe: semanticUi({
            library: 'antd',
            component: 'select',
            recipe: 'select-option',
            fieldLabel: '角色',
            optionText: '管理员',
            overlayTitle: '角色',
          }).recipe,
          rawAction: { action: { name: 'click', selector: '.ant-select-item-option >> internal:text="管理员"' } },
          assertions: [],
        }],
      };

      const input = buildAiIntentInput(flow, flow.steps) as any;
      assertEqual(input.steps[0].ui?.component, 'select');
      assertEqual(input.steps[0].ui?.recipe, 'select-option');
      assertEqual(input.steps[0].ui?.field, '角色');
      assertEqual(input.steps[0].ui?.option, '管理员');
      assert(!JSON.stringify(input).includes('rawAction'), 'AI input should not contain rawAction');
      assert(!JSON.stringify(input).includes('locatorHints'), 'AI input should not contain full locator hints');
      assert(!JSON.stringify(input).includes('.ant-select-item-option'), 'AI input should not leak AntD class selectors');
    },
  },
  {
    name: 'UI semantic intent rules cover every recipe emitted by adapter',
    run: () => {
      const recipeKinds: UiActionRecipe['kind'][] = [
        'click-button',
        'fill-form-field',
        'select-option',
        'pick-date',
        'pick-range',
        'pick-time',
        'toggle-control',
        'upload-file',
        'submit-form',
        'reset-form',
        'protable-search',
        'protable-reset-search',
        'protable-toolbar-action',
        'table-row-action',
        'table-batch-action',
        'editable-table-cell',
        'editable-table-save-row',
        'editable-table-cancel-row',
        'paginate',
        'sort-table',
        'filter-table',
        'modal-action',
        'drawer-action',
        'confirm-popconfirm',
        'dropdown-menu-action',
        'show-tooltip',
        'switch-tab',
        'switch-step',
        'assert-description-field',
        'raw-dom-action',
      ];

      for (const recipe of recipeKinds) {
        const ui = semanticUi({
          library: recipe.startsWith('protable') || recipe.startsWith('editable') ? 'pro-components' : 'antd',
          component: recipe.startsWith('protable') ? 'pro-table' : recipe.startsWith('editable') ? 'editable-pro-table' : 'button',
          recipe,
          fieldLabel: '关键字',
          optionText: '管理员',
          tableTitle: '用户管理',
          rowKey: 'user-42',
          columnTitle: '操作',
          overlayTitle: '配置弹窗',
          targetText: '保存',
        });
        const step: FlowStep = {
          id: `s-${recipe}`,
          order: 1,
          kind: 'recorded',
          action: 'click',
          target: { text: '保存' },
          context: {
            eventId: `ctx-${recipe}`,
            capturedAt: Date.now(),
            before: {
              target: { tag: 'button', text: '保存' },
              ui,
            } as any,
          },
          uiRecipe: ui.recipe,
          assertions: [],
        };
        const suggestion = suggestIntent(step, step.context!);
        assert(suggestion?.ruleHint?.startsWith('ui.'), `${recipe} should produce a UI semantic intent suggestion`);
      }
    },
  },
  {
    name: 'redaction preserves full generated playwright code while still masking secrets',
    run: () => {
      const longCode = `await page.goto("/start");\n${'await page.getByRole("button", { name: "保存" }).click();\n'.repeat(80)}await page.getByRole("button", { name: "完成" }).click();`;
      const flow = prepareBusinessFlowForExport({
        ...createNamedFlow(),
        artifacts: {
          playwrightCode: longCode,
          authorization: 'Bearer super-secret-token',
        } as any,
      }, longCode);
      const redacted = redactBusinessFlow(flow);
      assertEqual(redacted.artifacts?.playwrightCode, longCode);
      assertEqual((redacted.artifacts as any)?.authorization, '***');
      assert(!redacted.artifacts?.playwrightCode?.includes('***truncated***'), 'playwrightCode must not be truncated by redaction');
    },
  },
  {
    name: 'legacy flows without semantic ui remain exportable compactable and usable for AI input',
    run: () => {
      const flow = mergeActionsIntoFlow(createNamedFlow(), [
        navigateAction('https://example.test/users?token=secret#frag'),
        clickAction('保存'),
      ], [], {});
      const legacyFlow: BusinessFlow = {
        ...flow,
        steps: flow.steps.map(step => ({
          ...step,
          uiRecipe: undefined,
          context: step.context ? {
            ...step.context,
            before: {
              ...step.context.before,
              url: 'https://example.test/users?token=secret#frag',
              ui: undefined,
            },
          } : undefined,
          target: step.target ? {
            ...step.target,
            raw: { selector: '#legacy-secret-selector', recorder: { selector: '#nested-secret-selector' } },
          } : undefined,
        })),
      };

      const exported = prepareBusinessFlowForExport(legacyFlow, 'await page.getByText("保存").click();');
      const yaml = toCompactFlow(exported);
      const aiInput = buildAiIntentInput(exported, exported.steps);
      assert(!yaml.includes('\n    ui:'), 'legacy compact yaml should not emit empty ui blocks');
      assert(!JSON.stringify(aiInput).includes('locatorHints'), 'legacy AI input should not contain semantic internals');
      assert(!JSON.stringify(exported).includes('#legacy-secret-selector'), 'legacy raw selector should be stripped from export');
      assert(!JSON.stringify(exported).includes('#nested-secret-selector'), 'nested legacy raw selector should be stripped from export');
      assertEqual(exported.steps.length, legacyFlow.steps.length);
    },
  },
  {
    name: 'legacy action index artifacts migrate to recorder action log and are stripped',
    run: () => {
      const legacyFlow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          action: 'click',
          target: { text: '保存' },
          rawAction: { action: { name: 'click', selector: '#legacy-save' } },
          sourceCode: 'await page.locator("#legacy-save-source-only").click();',
          assertions: [],
        }, {
          id: 's002',
          order: 2,
          action: 'fill',
          target: { label: '名称' },
          value: 'legacy-name',
          rawAction: { action: { name: 'fill', selector: '#legacy-name', text: 'legacy-name' } },
          sourceCode: 'await page.locator("#legacy-name").fill("legacy-name");',
          assertions: [],
        }],
        artifacts: {
          deletedActionIndexes: [1],
          deletedActionSignatures: { '1': 'legacy-delete' },
          stepActionIndexes: { s001: 2 },
          stepMergedActionIndexes: { s002: [4, 5] },
        },
      };

      const migrated = migrateFlowToStableStepModel(legacyFlow);
      const recorder = migrated.artifacts?.recorder;
      assert(recorder, 'legacy indexes should be migrated into recorder state');
      assertEqual(migrated.steps[0].sourceActionIds?.length, 1);
      assertEqual(migrated.steps[1].sourceActionIds?.length, 2);
      assertEqual(recorder?.actionLog.map(action => action.recorderIndex).join(','), '2,4,5');
      assert(!recorder?.actionLog.some(action => action.signature.includes('legacy-save-source-only')), 'sourceCode must not be used as legacy identity');
      assert(!migrated.artifacts?.deletedActionIndexes, 'normalization should strip deletedActionIndexes');
      assert(!migrated.artifacts?.deletedActionSignatures, 'normalization should strip deletedActionSignatures');
      assert(!migrated.artifacts?.stepActionIndexes, 'normalization should strip stepActionIndexes');
      assert(!migrated.artifacts?.stepMergedActionIndexes, 'normalization should strip stepMergedActionIndexes');

      const cleared = clearFlowRecordingHistory(migrated);
      assert(!cleared.artifacts?.deletedActionIndexes, 'clear history should not write deletedActionIndexes');
      assert(!cleared.artifacts?.deletedActionSignatures, 'clear history should not write deletedActionSignatures');
      assert(!cleared.artifacts?.stepActionIndexes, 'clear history should not write stepActionIndexes');
      assert(!cleared.artifacts?.stepMergedActionIndexes, 'clear history should not write stepMergedActionIndexes');
      assertEqual(cleared.artifacts?.recorder?.actionLog.length, 0);
    },
  },
  {
    name: 'semantic export compact yaml and AI input use compact whitelist only',
    run: () => {
      const flow = mergeActionsIntoFlow(createNamedFlow(), [clickAction('保存')], [], {});
      const ui = {
        ...semanticUi({
          library: 'antd',
          component: 'select',
          recipe: 'select-option',
          fieldLabel: '角色',
          optionText: '管理员',
          targetText: '管理员',
        }),
        targetTestId: 'role-select',
        form: { formKind: 'antd-form', fieldKind: 'select', label: '角色', name: 'role', valuePreview: 'secret-visible-value' },
        table: { title: '用户表', rowKey: 'user-42', rowText: 'user-42 admin@example.com token=secret 编辑', columnTitle: '操作' },
        overlay: { type: 'select-dropdown', title: '角色下拉', text: 'overlay secret text token=secret', visible: true },
        option: { text: '管理员', value: 'role-admin-secret-value' },
        locatorHints: [{ kind: 'css', value: '.ant-select-item-option[title="管理员-secret"]', score: 0.2, reason: 'fallback css secret reason' }],
        reasons: ['contains secret diagnostic reason'],
      } as any;
      const flowWithUi: BusinessFlow = {
        ...flow,
        steps: flow.steps.map(step => ({
          ...step,
          sourceCode: 'await page.locator("#raw-secret").click();',
          rawAction: { selector: '#raw-secret' },
          url: 'about:blank?debug=true#frag',
          uiRecipe: {
            ...ui.recipe,
            optionValue: 'recipe-secret-value',
            locatorHints: ui.locatorHints,
            reasons: ui.reasons,
          } as any,
          target: {
            ...step.target,
            raw: { ui, sourceCode: 'raw source secret' },
          },
          context: {
            eventId: 'ctx-semantic-hardening',
            capturedAt: Date.now(),
            before: {
              title: '用户页',
              url: 'https://example.test/users?token=secret&debug=true#frag',
              target: { tag: 'button', text: '保存', selector: '#raw-secret' } as any,
              ui,
            },
            after: { url: 'chrome://extensions/?id=secret#after' } as any,
          },
        })),
      };

      const exported = prepareBusinessFlowForExport(flowWithUi, 'await page.getByTestId("role-select").click();');
      const exportedJson = JSON.stringify(exported);
      const yaml = toCompactFlow(exported);
      const aiJson = JSON.stringify(buildAiIntentInput(exported, exported.steps));

      for (const text of [exportedJson, yaml, aiJson]) {
        assert(!text.includes('locatorHints'), 'compact surfaces should omit locatorHints');
        assert(!text.includes('reasons'), 'compact surfaces should omit reasons');
        assert(!text.includes('admin@example.com'), 'compact surfaces should omit table rowText internals');
        assert(!text.includes('overlay secret text'), 'compact surfaces should omit overlay.text internals');
        assert(!text.includes('role-admin-secret-value'), 'compact surfaces should omit option.value internals');
        assert(!text.includes('recipe-secret-value'), 'compact surfaces should omit uiRecipe non-whitelisted fields');
        assert(!text.includes('rawAction'), 'compact surfaces should omit rawAction');
        assert(!text.includes('#raw-secret'), 'compact surfaces should omit raw selectors');
      }
      assert(aiJson.includes('https://example.test/users'), 'AI input should keep URL origin/path');
      assert(!aiJson.includes('token=secret'), 'AI input URL should strip query');
      assert(!aiJson.includes('#frag'), 'AI input URL should strip hash');
      assert(exportedJson.includes('about:blank'), 'export should preserve opaque URL scheme for step URLs');
      assert(yaml.includes('about:blank'), 'compact yaml should preserve opaque URL scheme for step URLs');
      assert(aiJson.includes('chrome://extensions/'), 'AI input should preserve opaque URL scheme for context URLs');
      assert(![exportedJson, yaml, aiJson].some(text => text.includes('nullblank') || text.includes('null/')), 'compact URLs must not use null origin for opaque schemes');
      assert(![exportedJson, yaml, aiJson].some(text => text.includes('about:blank?') || text.includes('chrome://extensions/?') || text.includes('#after')), 'compact URLs should still strip query and hash for opaque schemes');
      assert(yaml.includes('field: "角色"') || yaml.includes('field: 角色'), 'compact yaml should retain useful compact semantic field');
      assert(yaml.includes('option: "管理员"') || yaml.includes('option: 管理员'), 'compact yaml should retain useful compact semantic option');
    },
  },
  {
    name: 'terminal-state assertions serialize compact replay checks and fail when row state is absent',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          action: 'click',
          target: { testId: 'wan-transport-modal-ok-button', displayName: '确 定' },
          assertions: [
            createTerminalStateAssertion('row-exists', 'a-row-added', {
              tableTestId: 'wan-transport-table',
              rowKey: 'nova_private',
              columnText: 'Nova 私网',
              rawDiagnostics: 'private row diagnostics should be stripped',
            }),
            createTerminalStateAssertion('row-not-exists', 'a-row-deleted', {
              tableTestId: 'wan-transport-table',
              rowKey: 'nova_public',
            }),
            createTerminalStateAssertion('modal-closed', 'a-modal-closed', { title: '增加传输网络' }),
            createTerminalStateAssertion('popover-closed', 'a-popover-closed', { title: '删除此行？' }),
            createTerminalStateAssertion('selected-value-visible', 'a-selected-visible', {
              targetTestId: 'wan-transport-select',
              expected: 'Nova 私网',
            }),
          ],
        }],
      };

      const preview = generateAssertionCodePreview(flow);
      assert(preview.includes('page.getByTestId("wan-transport-table").locator("tr[data-row-key=\\"nova_private\\"], [role=\\"row\\"][data-row-key=\\"nova_private\\"]")'), 'row-exists should use a key-based terminal row locator');
      assert(preview.includes('toBeVisible();'), 'row-exists should prove failure by expecting the terminal row to be visible without catch fallback');
      assert(preview.includes('not.toBeVisible();'), 'row-not-exists should assert the terminal row is gone');
      assert(preview.includes('.ant-modal') && preview.includes('增加传输网络') && preview.includes('state: "hidden"'), 'modal-closed should wait for the matching AntD modal to close');
      assert(preview.includes('.ant-popover') && preview.includes('删除此行？') && preview.includes('state: "hidden"'), 'popover-closed should wait for the visible popconfirm/popover to close');
      assert(preview.includes('page.getByTestId("wan-transport-select")') && preview.includes('Nova 私网'), 'selected-value-visible should assert selected value text on the control');
      assert(!preview.includes('.catch('), 'terminal-state assertions must not swallow replay failures');

      const exportFlow = prepareBusinessFlowForExport(flow, generateBusinessFlowPlaywrightCode(flow));
      const exportedJson = JSON.stringify(exportFlow);
      assert(exportedJson.includes('row-exists'), 'exported flow should keep compact terminal assertion type');
      assert(exportedJson.includes('nova_private'), 'exported flow should keep stable row key');
      assert(!exportedJson.includes('private row diagnostics'), 'exported flow should strip raw/private assertion diagnostics');
      assert(!toCompactFlow(exportFlow).includes('rawDiagnostics'), 'compact yaml should not include raw assertion diagnostics');
    },
  },
  {
    name: 'terminal-state suggestions derive from compact context without raw diagnostics',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            action: 'click',
            target: { testId: 'wan-transport-modal-ok-button', displayName: '确 定' },
            context: {
              eventId: 'ctx-submit',
              capturedAt: 1000,
              before: { dialog: { type: 'modal', title: '增加传输网络', visible: true } },
              after: { dialog: { type: 'modal', title: '增加传输网络', visible: false }, toast: '保存失败' },
            },
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            action: 'click',
            target: { testId: 'wan-transport-select', displayName: 'Nova 私网' },
            context: {
              eventId: 'ctx-select',
              capturedAt: 1100,
              before: { target: { testId: 'wan-transport-select', selectedOption: 'Nova 私网', controlType: 'select' } },
            },
            assertions: [],
          },
          {
            id: 's003',
            order: 3,
            action: 'click',
            target: {
              testId: 'wan-transport-delete-confirm-ok',
              displayName: '确 定',
              scope: { table: { testId: 'wan-transport-table', rowKey: 'nova_public' } },
            },
            context: {
              eventId: 'ctx-popconfirm-ok',
              capturedAt: 1200,
              before: { dialog: { type: 'popover', title: '删除此行？', visible: true }, target: { text: '确 定', controlType: 'button' } },
              after: { dialog: { type: 'popover', title: '删除此行？', visible: false } },
            },
            assertions: [],
          },
        ],
      };

      const enriched = appendTerminalStateAssertions(flow);
      const types = enriched.steps.flatMap(step => step.assertions.map(assertion => assertion.type));
      assert(types.includes('modal-closed'), 'modal close should be suggested from before/after dialog context');
      assert(types.includes('toast-visible'), 'toast-visible should be suggested from after.toast');
      assert(types.includes('selected-value-visible'), 'selected-value-visible should be suggested from selectedOption context');
      assert(types.includes('popover-closed'), 'popover close should be suggested from before/after popover context');
      assert(types.includes('row-not-exists'), 'confirming a row delete should suggest a terminal row-not-exists assertion');

      const diagnostics = replayDiagnosticSummary(enriched, { enabled: true });
      const diagnosticsJson = JSON.stringify(diagnostics);
      assert(diagnosticsJson.includes('terminalAssertions'), 'diagnostics should summarize terminal assertions when explicitly enabled');
      assert(!diagnosticsJson.includes('rawAction') && !diagnosticsJson.includes('sourceCode') && !diagnosticsJson.includes('private'), 'diagnostics should stay privacy safe');
      assertEqual(replayDiagnosticSummary(enriched, { enabled: false }), undefined);
    },
  },
  {
    name: 'effect hints feed terminal-state assertions for select and create flows',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            action: 'click',
            target: { testId: 'network-resource-add', text: '新建网络资源', scope: { table: { testId: 'network-resource-table' } } },
            context: {
              eventId: 'ctx-open-create',
              capturedAt: 1000,
              before: { target: { tag: 'button', testId: 'network-resource-add', text: '新建网络资源' } },
            },
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            action: 'fill',
            target: { testId: 'network-resource-name', label: '资源名称', placeholder: '地址池名称' },
            value: 'pool-proform-alpha',
            context: {
              eventId: 'ctx-resource-name',
              capturedAt: 1100,
              before: { form: { label: '资源名称', name: 'name' }, dialog: { type: 'modal', title: '新建网络资源', visible: true } },
            },
            assertions: [],
          },
          {
            id: 's003',
            order: 3,
            action: 'click',
            target: { testId: 'network-resource-wan-select', label: 'WAN口', role: 'combobox' },
            context: {
              eventId: 'ctx-wan-trigger',
              capturedAt: 1200,
              before: { form: { label: 'WAN口', name: 'wan' }, target: { testId: 'network-resource-wan-select', controlType: 'select' } },
            },
            assertions: [],
          },
          {
            id: 's004',
            order: 4,
            action: 'click',
            target: { text: 'edge-lab:WAN-extra-18' },
            context: {
              eventId: 'ctx-wan-option',
              capturedAt: 1300,
              before: {
                form: { label: 'WAN口', name: 'wan' },
                target: { role: 'option', text: 'edge-lab:WAN-extra-18', controlType: 'select-option' },
                ui: { library: 'pro-components', component: 'select', form: { label: 'WAN口', name: 'wan' }, option: { text: 'edge-lab:WAN-extra-18' } },
              } as any,
            },
            assertions: [],
          },
          {
            id: 's005',
            order: 5,
            action: 'click',
            target: { testId: 'network-resource-save', text: '保存' },
            context: {
              eventId: 'ctx-save-resource',
              capturedAt: 1400,
              before: { dialog: { type: 'modal', title: '新建网络资源', visible: true }, target: { tag: 'button', testId: 'network-resource-save', text: '保存' } },
            },
            assertions: [],
          },
        ],
      };

      const enriched = appendTerminalStateAssertions(flow);
      const selectedAssertion = enriched.steps[3].assertions.find(assertion => assertion.type === 'selected-value-visible');
      const rowExistsAssertion = enriched.steps[4].assertions.find(assertion => assertion.type === 'row-exists');
      const modalClosedAssertion = enriched.steps[4].assertions.find(assertion => assertion.type === 'modal-closed');

      assertEqual(selectedAssertion?.params?.targetTestId, 'network-resource-wan-select');
      assertEqual(selectedAssertion?.params?.expected, 'edge-lab:WAN-extra-18');
      assertEqual(rowExistsAssertion?.params?.tableTestId, 'network-resource-table');
      assertEqual(rowExistsAssertion?.params?.rowKeyword, 'pool-proform-alpha');
      assertEqual(modalClosedAssertion?.params?.title, '新建网络资源');

      const code = generateBusinessFlowPlaywrightCode(enriched);
      assert(code.includes('page.getByTestId("network-resource-table").getByRole(\'row\').filter({ hasText: /pool-proform-alpha/ })'), 'row create effect hint should render a terminal row-exists assertion');
      assert(code.includes('page.getByTestId("network-resource-wan-select")') && code.includes('edge-lab:WAN-extra-18'), 'select effect hint should render selected-value-visible');
      assert(code.includes('.ant-modal') && code.includes('新建网络资源') && code.includes('state: "hidden"'), 'modal effect hint should render modal-closed');
    },
  },
  {
    name: 'effect hints do not infer hard row-exists table from create button naming alone',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            action: 'click',
            target: { testId: 'network-resource-create-button', text: '新建网络资源' },
            context: {
              eventId: 'ctx-open-create',
              capturedAt: 1000,
              before: { target: { tag: 'button', testId: 'network-resource-create-button', text: '新建网络资源' } },
              after: { dialog: { type: 'modal', title: '新建网络资源', visible: true } },
            },
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            action: 'fill',
            target: { testId: 'network-resource-name', label: '资源名称' },
            value: 'pool-proform-alpha',
            context: {
              eventId: 'ctx-resource-name',
              capturedAt: 1100,
              before: { form: { label: '资源名称', name: 'name' }, dialog: { type: 'modal', title: '新建网络资源', visible: true } },
            },
            assertions: [],
          },
          {
            id: 's003',
            order: 3,
            action: 'click',
            target: { testId: 'network-resource-save', text: '保存' },
            context: {
              eventId: 'ctx-save-resource',
              capturedAt: 1200,
              before: { dialog: { type: 'modal', title: '新建网络资源', visible: true }, target: { tag: 'button', testId: 'network-resource-save', text: '保存' } },
              after: { dialog: { type: 'modal', title: '新建网络资源', visible: false } },
            },
            assertions: [],
          },
        ],
      };

      const enriched = appendTerminalStateAssertions(flow);
      const types = enriched.steps[2].assertions.map(assertion => assertion.type);
      const code = generateBusinessFlowPlaywrightCode(enriched);

      assert(!types.includes('row-exists'), 'create opener naming convention alone must not become an enabled terminal row-exists assertion');
      assert(types.includes('modal-closed'), 'modal close terminal assertion should still be inferred for the commit action');
      assert(!code.includes('page.getByTestId("network-resource-table")'), 'generated replay must not hard-code an inferred table id without observed table scope');
    },
  },
  {
    name: 'effect hints do not mark validation save as modal closed while the same modal remains visible',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            action: 'click',
            target: { testId: 'network-resource-add', text: '新建网络资源' },
            context: {
              eventId: 'ctx-open-create',
              capturedAt: 1000,
              before: { target: { tag: 'button', testId: 'network-resource-add', text: '新建网络资源' } },
              after: { dialog: { type: 'modal', title: '新建网络资源', visible: true } },
            },
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            action: 'fill',
            target: { testId: 'network-resource-name', label: '资源名称' },
            value: 'pool-proform-alpha',
            context: {
              eventId: 'ctx-resource-name',
              capturedAt: 1050,
              before: { form: { label: '资源名称', name: 'name' }, dialog: { type: 'modal', title: '新建网络资源', visible: true } },
            },
            assertions: [],
          },
          {
            id: 's003',
            order: 3,
            action: 'click',
            target: { testId: 'network-resource-save', text: '保存' },
            context: {
              eventId: 'ctx-validation-save',
              capturedAt: 1100,
              before: { dialog: { type: 'modal', title: '新建网络资源', visible: true }, target: { tag: 'button', testId: 'network-resource-save', text: '保存' } },
              after: { dialog: { type: 'modal', title: '新建网络资源', visible: true }, toast: '请选择WAN口' },
            },
            assertions: [
              createTerminalStateAssertion('row-exists', 's003-terminal-1', { tableTestId: 'network-resource-table', rowKeyword: 'pool-proform-alpha' }),
              createTerminalStateAssertion('modal-closed', 's003-terminal-2', { title: '新建网络资源' }),
            ],
          },
        ],
      };

      const enriched = appendTerminalStateAssertions(flow);
      const types = enriched.steps[2].assertions.map(assertion => assertion.type);

      assert(types.includes('toast-visible'), 'validation save should keep the validation feedback terminal assertion');
      assert(!types.includes('modal-closed'), 'validation save should not assert modal-closed while the same modal remains visible and validation feedback appears');
      assert(!types.includes('row-exists'), 'validation save should not assert row-exists when validation feedback proves the create did not commit');
    },
  },
  {
    name: 'effect hints scope create row assertions from the opener instead of stale modal table context',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            action: 'click',
            target: { testId: 'site-ip-address-pool-create-button', text: '新建' },
            context: {
              eventId: 'ctx-open-ipv4',
              capturedAt: 1000,
              before: { target: { tag: 'button', testId: 'site-ip-address-pool-create-button', text: '新建' } },
              after: { dialog: { type: 'modal', title: '新建IPv4地址池', visible: true } },
            },
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            action: 'fill',
            target: { testId: 'ipv4-address-pool-form', label: '地址池名称' },
            value: 'test1',
            context: {
              eventId: 'ctx-ipv4-name',
              capturedAt: 1100,
              before: { dialog: { type: 'modal', title: '新建IPv4地址池', visible: true }, form: { label: '地址池名称', name: 'name' } },
            },
            assertions: [],
          },
          {
            id: 's003',
            order: 3,
            action: 'click',
            target: { testId: 'ipv4-address-pool-confirm', text: '确定' },
            context: {
              eventId: 'ctx-ipv4-confirm',
              capturedAt: 1200,
              before: { dialog: { type: 'modal', title: '新建IPv4地址池', visible: true }, target: { tag: 'button', testId: 'ipv4-address-pool-confirm', text: '确定' } },
              after: { dialog: { type: 'modal', title: '新建IPv4地址池', visible: false } },
            },
            assertions: [],
          },
          {
            id: 's004',
            order: 4,
            action: 'click',
            target: { testId: 'site-ip-port-pool-create-button', text: '新建', scope: { table: { testId: 'site-ip-port-pool-table' } } },
            context: {
              eventId: 'ctx-open-port-pool',
              capturedAt: 1300,
              before: { target: { tag: 'button', testId: 'site-ip-port-pool-create-button', text: '新建' } },
              after: { dialog: { type: 'modal', title: '新建IP端口地址池', visible: true } },
            },
            assertions: [],
          },
          {
            id: 's005',
            order: 5,
            action: 'fill',
            target: { testId: 'ip-port-pool-form', label: '地址池名称' },
            value: 'test12',
            context: {
              eventId: 'ctx-port-name',
              capturedAt: 1400,
              before: { dialog: { type: 'modal', title: '新建IP端口地址池', visible: true }, form: { label: '地址池名称', name: 'name' } },
            },
            assertions: [],
          },
          {
            id: 's006',
            order: 6,
            action: 'click',
            target: {
              testId: 'ip-port-pool-confirm',
              text: '确定',
              scope: { table: { testId: 'site-global-ip-pools-section', rowText: 'test1 共享 1.1.1.1--2.2.2.2' } },
            },
            context: {
              eventId: 'ctx-port-confirm',
              capturedAt: 1500,
              before: {
                dialog: { type: 'modal', title: '新建IP端口地址池', visible: true },
                target: { tag: 'button', testId: 'ip-port-pool-confirm', text: '确定' },
                table: { testId: 'site-global-ip-pools-section', rowText: 'test1 共享 1.1.1.1--2.2.2.2' },
              },
              after: { dialog: { type: 'modal', title: '新建IP端口地址池', visible: false } },
            },
            assertions: [],
          },
        ],
      };

      const enriched = appendTerminalStateAssertions(flow);
      const rowExists = enriched.steps[5].assertions.find(assertion => assertion.type === 'row-exists');
      const code = generateBusinessFlowPlaywrightCode(enriched);

      assertEqual(rowExists?.params?.tableTestId, 'site-ip-port-pool-table');
      assertEqual(rowExists?.params?.rowKeyword, 'test12');
      assert(!code.includes('site-global-ip-pools-section'), 'create row effect hint must not reuse stale structural table context from the modal confirm');
      assert(code.includes('page.getByTestId("site-ip-port-pool-table")'), 'create row effect hint should derive the row table from the create opener');
    },
  },
  {
    name: 'effect hints do not use short numeric fields as created row identity',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            action: 'click',
            target: { testId: 'wan-transport-add-button', text: '增加传输网络' },
            context: {
              eventId: 'ctx-open-wan',
              capturedAt: 1000,
              before: { target: { tag: 'button', testId: 'wan-transport-add-button', text: '增加传输网络' } },
              after: { dialog: { type: 'modal', title: '增加传输网络', visible: true } },
            },
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            action: 'fill',
            target: { testId: 'wan-transport-egress-disable-threshold-input', label: '出接口禁用阈值' },
            value: '3',
            context: {
              eventId: 'ctx-threshold',
              capturedAt: 1100,
              before: { dialog: { type: 'modal', title: '增加传输网络', visible: true }, form: { label: '出接口禁用阈值', name: 'threshold' } },
            },
            assertions: [],
          },
          {
            id: 's003',
            order: 3,
            action: 'click',
            target: { testId: 'wan-transport-modal-ok-button', text: '确定' },
            context: {
              eventId: 'ctx-confirm-wan',
              capturedAt: 1200,
              before: { dialog: { type: 'modal', title: '增加传输网络', visible: true }, target: { tag: 'button', testId: 'wan-transport-modal-ok-button', text: '确定' } },
              after: { dialog: { type: 'modal', title: '增加传输网络', visible: false } },
            },
            assertions: [],
          },
        ],
      };

      const enriched = appendTerminalStateAssertions(flow);
      const types = enriched.steps[2].assertions.map(assertion => assertion.type);
      const code = generateBusinessFlowPlaywrightCode(enriched);

      assert(!types.includes('row-exists'), 'short numeric threshold values should not become row-exists terminal assertions');
      assert(types.includes('modal-closed'), 'modal close terminal assertion should still be inferred for the commit action');
      assert(!code.includes("filter({ hasText: /3/ })"), 'generated replay should not assert a created row by a short numeric field');
    },
  },
  {
    name: 'effect hints do not infer modal closed from modal form fill text',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            action: 'click',
            target: { testId: 'create-user-btn', text: '新建用户' },
            context: {
              eventId: 'ctx-open-create-user',
              capturedAt: 1000,
              before: { target: { tag: 'button', testId: 'create-user-btn', text: '新建用户' } },
              after: { dialog: { type: 'modal', title: '新建用户', visible: true } },
            },
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            action: 'fill',
            target: {
              testId: 'create-user-modal',
              label: '用户名',
              text: '新建用户 用户名 角色 审计员 取 消确 定',
            },
            value: 'alice',
            context: {
              eventId: 'ctx-fill-user-name',
              capturedAt: 1100,
              before: {
                dialog: { type: 'modal', title: '新建用户', visible: true },
                form: { label: '用户名', name: 'username' },
                target: {
                  tag: 'input',
                  testId: 'create-user-modal',
                  text: '新建用户 用户名 角色 审计员 取 消确 定',
                  controlType: 'input',
                },
              },
            },
            assertions: [],
          },
          {
            id: 's003',
            order: 3,
            action: 'press',
            target: { testId: 'modal-confirm', text: '确 定' },
            value: 'Enter',
            context: {
              eventId: 'ctx-confirm-user',
              capturedAt: 1200,
              before: {
                dialog: { type: 'modal', title: '新建用户', visible: true },
                target: { tag: 'button', testId: 'modal-confirm', text: '确 定', controlType: 'button' },
              },
              after: { dialog: { type: 'modal', title: '新建用户', visible: false } },
            },
            assertions: [],
          },
        ],
      };

      const enriched = appendTerminalStateAssertions(flow);
      const fillAssertionTypes = enriched.steps[1].assertions.map(assertion => assertion.type);
      const confirmAssertionTypes = enriched.steps[2].assertions.map(assertion => assertion.type);
      const code = generateBusinessFlowPlaywrightCode(enriched);

      assert(!fillAssertionTypes.includes('modal-closed'), 'modal root text around a fill must not imply modal close');
      assert(confirmAssertionTypes.includes('modal-closed'), 'explicit confirm press should still infer modal closed');
      assert(!stepCodeBlock(code, 's002').includes('waitFor({ state: "hidden"'), 'fill step should not emit modal hidden terminal assertion');
    },
  },
  {
    name: 'effect hints do not attach previous create opener to a later edit modal save',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            action: 'click',
            target: { testId: 'user-create-button', text: '新建用户' },
            context: {
              eventId: 'ctx-open-create',
              capturedAt: 1000,
              before: { target: { tag: 'button', testId: 'user-create-button', text: '新建用户' } },
              after: { dialog: { type: 'modal', title: '新建用户', visible: true } },
            },
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            action: 'fill',
            target: { label: '用户名' },
            value: 'alice.qa',
            context: {
              eventId: 'ctx-create-name',
              capturedAt: 1100,
              before: { dialog: { type: 'modal', title: '新建用户', visible: true }, form: { label: '用户名', name: 'username' } },
            },
            assertions: [],
          },
          {
            id: 's003',
            order: 3,
            action: 'click',
            target: { testId: 'modal-confirm', text: '确定' },
            context: {
              eventId: 'ctx-create-confirm',
              capturedAt: 1200,
              before: { dialog: { type: 'modal', title: '新建用户', visible: true }, target: { tag: 'button', testId: 'modal-confirm', text: '确定' } },
              after: { dialog: { type: 'modal', title: '新建用户', visible: false } },
            },
            assertions: [],
          },
          {
            id: 's004',
            order: 4,
            action: 'click',
            target: { testId: 'user-row-edit-action', text: '编辑' },
            context: {
              eventId: 'ctx-open-edit',
              capturedAt: 1300,
              before: { table: { testId: 'user-table', rowKey: 'alice.qa', rowText: 'alice.qa' }, target: { tag: 'button', testId: 'user-row-edit-action', text: '编辑' } },
              after: { dialog: { type: 'modal', title: '编辑用户', visible: true } },
            },
            assertions: [],
          },
          {
            id: 's005',
            order: 5,
            action: 'fill',
            target: { label: '备注' },
            value: 'edited',
            context: {
              eventId: 'ctx-edit-remark',
              capturedAt: 1400,
              before: { dialog: { type: 'modal', title: '编辑用户', visible: true }, form: { label: '备注', name: 'remark' } },
            },
            assertions: [],
          },
          {
            id: 's006',
            order: 6,
            action: 'click',
            target: { testId: 'modal-confirm', text: '确定' },
            context: {
              eventId: 'ctx-edit-confirm',
              capturedAt: 1500,
              before: { dialog: { type: 'modal', title: '编辑用户', visible: true }, target: { tag: 'button', testId: 'modal-confirm', text: '确定' } },
              after: { dialog: { type: 'modal', title: '编辑用户', visible: false } },
            },
            assertions: [],
          },
        ],
      };

      const enriched = appendTerminalStateAssertions(flow);
      const editAssertionTypes = enriched.steps[5].assertions.map(assertion => assertion.type);
      const code = generateBusinessFlowPlaywrightCode(enriched);

      assert(!editAssertionTypes.includes('row-exists'), 'later edit modal save must not reuse an earlier create opener for row-exists');
      assert(editAssertionTypes.includes('modal-closed'), 'edit modal save should still keep modal-closed terminal evidence');
      assert(!code.includes('page.getByTestId("user-table").getByRole(\'row\').filter({ hasText: /edited/ })'), 'edit-only values should not become create row assertions');
    },
  },
  {
    name: 'terminal-state selected value suggestion removes stale control assertions from select transactions',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's011',
          order: 11,
          action: 'select',
          target: { testId: 'network-resource-wan-select', displayName: '关联VRF' },
          value: '生产VRF',
          context: {
            eventId: 'ctx-vrf-option',
            capturedAt: 1200,
            before: {
              target: { testId: 'network-resource-wan-select', controlType: 'select', selectedOption: '生产VRF' },
            },
          },
          assertions: [{
            id: 's011-terminal-1',
            type: 'selected-value-visible',
            subject: 'element',
            target: { testId: 'network-resource-wan-select' },
            expected: '关联VRF',
            params: { targetTestId: 'network-resource-wan-select', expected: '关联VRF' },
            enabled: true,
          }],
        }],
      };

      const enriched = appendTerminalStateAssertions(flow);
      const selectedAssertions = enriched.steps[0].assertions.filter(assertion => assertion.type === 'selected-value-visible' && assertion.enabled !== false);

      assertEqual(selectedAssertions.map(assertion => assertion.expected), []);
    },
  },
  {
    name: 'terminal-state selected value cleanup preserves user-authored enabled assertions',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's012',
          order: 12,
          action: 'select',
          target: { testId: 'network-resource-wan-select', displayName: '关联VRF' },
          value: '生产VRF',
          context: {
            eventId: 'ctx-vrf-option',
            capturedAt: 1200,
            before: {
              target: { testId: 'network-resource-wan-select', controlType: 'select', selectedOption: '生产VRF' },
            },
          },
          assertions: [{
            id: 'user-authored-selected-vrf-visible',
            type: 'selected-value-visible',
            subject: 'element',
            target: { testId: 'network-resource-wan-select' },
            expected: '关联VRF',
            params: { targetTestId: 'network-resource-wan-select', expected: '关联VRF' },
            enabled: true,
          }],
        }],
      };

      const enriched = appendTerminalStateAssertions(flow);
      const selectedAssertions = enriched.steps[0].assertions.filter(assertion => assertion.type === 'selected-value-visible' && assertion.enabled !== false);

      assertEqual(selectedAssertions.map(assertion => assertion.id), ['user-authored-selected-vrf-visible']);
      assertEqual(selectedAssertions.map(assertion => assertion.expected), ['关联VRF']);
    },
  },
  {
    name: 'terminal-state selected value cleanup removes generated assertions when step no longer suggests selected value',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's013',
          order: 13,
          action: 'click',
          target: {
            testId: 'network-resource-health-switch',
            role: 'switch',
            label: '启用健康检查',
          },
          context: {
            eventId: 'ctx-health-switch',
            capturedAt: 1200,
            before: {
              target: {
                testId: 'network-resource-health-switch',
                role: 'switch',
                controlType: 'button',
              },
            },
            after: {
              toast: '选择发布范围',
            },
          },
          assertions: [{
            id: 's013-terminal-1',
            type: 'selected-value-visible',
            subject: 'element',
            target: { testId: 'network-resource-health-switch' },
            expected: '选择发布范围',
            params: { targetTestId: 'network-resource-health-switch', expected: '选择发布范围' },
            enabled: true,
          }],
        }],
      };

      const enriched = appendTerminalStateAssertions(flow);
      const selectedAssertions = enriched.steps[0].assertions.filter(assertion => assertion.type === 'selected-value-visible' && assertion.enabled !== false);

      assertEqual(selectedAssertions.map(assertion => assertion.expected), []);
    },
  },
  {
    name: 'terminal-state selected value inference uses generic select evidence instead of domain words',
    run: () => {
      const selectableFlow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            action: 'click',
            target: { testId: 'primary-field', displayName: '接入方式', scope: { form: { label: '接入方式' } } },
            context: {
              eventId: 'ctx-select-trigger',
              capturedAt: 1000,
              before: {
                target: { testId: 'primary-field', controlType: 'select' },
                ui: {
                  library: 'pro-components',
                  component: 'select',
                  form: { label: '接入方式', fieldKind: 'select' },
                  locatorHints: [],
                  confidence: 0.9,
                  reasons: [],
                },
              },
            },
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            action: 'click',
            target: { role: 'option', displayName: '专线' },
            assertions: [],
          },
        ],
      };
      const nonSelectableFlow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            action: 'click',
            target: { testId: 'wan-primary-field', displayName: '普通入口' },
            context: {
              eventId: 'ctx-domain-word-only',
              capturedAt: 1000,
              before: { target: { testId: 'wan-primary-field', controlType: 'button', text: '普通入口' } },
            },
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            action: 'click',
            target: { role: 'option', displayName: '专线' },
            assertions: [],
          },
        ],
      };

      const selectableTypes = appendTerminalStateAssertions(selectableFlow).steps.flatMap(step => step.assertions.map(assertion => assertion.type));
      const nonSelectableTypes = appendTerminalStateAssertions(nonSelectableFlow).steps.flatMap(step => step.assertions.map(assertion => assertion.type));

      assert(selectableTypes.includes('selected-value-visible'), 'generic controlType=select context should infer selected-value-visible even without WAN/transport words');
      assert(!nonSelectableTypes.includes('selected-value-visible'), 'domain words such as WAN must not infer selected-value-visible without generic select evidence');
    },
  },
  {
    name: 'terminal-state selected value inference does not leak from select controls into later fills',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            action: 'select',
            target: { testId: 'stability-wan-select', displayName: '共享WAN' },
            value: 'WAN1',
            context: {
              eventId: 'ctx-stability-wan',
              capturedAt: 1000,
              before: {
                target: { testId: 'stability-wan-select', controlType: 'select', selectedOption: 'WAN1' },
              },
            },
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            action: 'fill',
            target: { role: 'textbox', label: '使用备注' },
            value: '循环后继续补步骤',
            assertions: [],
          },
        ],
      };

      const enriched = appendTerminalStateAssertions(flow);
      const generated = generateBusinessFlowPlaywrightCode(enriched);

      assert(!enriched.steps[1].assertions.some(assertion => assertion.type === 'selected-value-visible'), 'later fill steps must not inherit selected-value assertions from a previous select control');
      assert(!generated.includes('await expect(page.getByTestId("stability-wan-select")).toContainText("使用备注"'), 'replay must not assert a select control contains the following fill label/value');
    },
  },
  {
    name: 'terminal-state suggestions infer popover closed for generic delete-confirm button without dialog context',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            action: 'click',
            target: {
              testId: 'resource-row-delete-action',
              displayName: '删除',
              scope: { table: { testId: 'resource-table', rowKey: 'resource-1' } },
            },
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            action: 'click',
            target: {
              testId: 'resource-delete-confirm-ok',
              displayName: '确 定',
              scope: { table: { testId: 'resource-table', rowKey: 'resource-1' } },
            },
            context: {
              eventId: 'ctx-delete-confirm-ok-no-dialog',
              capturedAt: 1000,
              before: { target: { tag: 'button', testId: 'resource-delete-confirm-ok', controlType: 'button', text: '确 定' } },
            },
            assertions: [],
          },
        ],
      };

      const enriched = appendTerminalStateAssertions(flow);
      const types = enriched.steps.flatMap(step => step.assertions.map(assertion => assertion.type));

      assert(types.includes('row-not-exists'), 'delete-confirm ok should still infer row-not-exists from table scope');
      assert(types.includes('popover-closed'), 'delete-confirm ok should infer popover-closed even when dialog context arrives late or missing');
    },
  },
  {
    name: 'terminal-state suggestions infer modal closed for explicit modal ok when after-state is stale same modal',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          action: 'click',
          target: {
            testId: 'wan-transport-modal-ok-button',
            displayName: '确 定',
            scope: { dialog: { type: 'modal', title: '增加传输网络', visible: true } },
          },
          context: {
            eventId: 'ctx-modal-ok-stale-after',
            capturedAt: 1000,
            before: {
              dialog: { type: 'modal', title: '增加传输网络', visible: true },
              target: { tag: 'button', testId: 'wan-transport-modal-ok-button', controlType: 'button', text: '确 定' },
            },
            after: {
              dialog: { type: 'modal', title: '增加传输网络', visible: true },
            },
          },
          assertions: [],
        }],
      };

      const enriched = appendTerminalStateAssertions(flow);
      const modalClosed = enriched.steps.flatMap(step => step.assertions).find(assertion => assertion.type === 'modal-closed');

      assert(modalClosed, 'explicit modal OK should infer modal-closed when after-state captured the same modal stale-visible');
      assertEqual(modalClosed?.params?.title, '增加传输网络');
    },
  },
  {
    name: 'terminal-state suggestions do not infer modal closed while a second dialog remains visible',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [{
          id: 's001',
          order: 1,
          action: 'click',
          target: {
            testId: 'config-modal-confirm-button',
            displayName: '确定',
            scope: { dialog: { type: 'modal', title: '编辑配置', visible: true } },
          },
          context: {
            eventId: 'ctx-submit-opens-confirm',
            capturedAt: 1000,
            before: {
              dialog: { type: 'modal', title: '编辑配置', visible: true },
              target: { tag: 'button', testId: 'config-modal-confirm-button', controlType: 'button', text: '确定' },
            },
            after: {
              openedDialog: { type: 'modal', title: '二次确认', visible: true },
            },
          },
          assertions: [],
        }],
      };

      const enriched = appendTerminalStateAssertions(flow);
      const types = enriched.steps.flatMap(step => step.assertions.map(assertion => assertion.type));

      assert(!types.includes('modal-closed'), 'submit-like modal button should not infer modal-closed while another dialog remains visible');
    },
  },
  {
    name: 'emitter skips modal-closed wait before captured second dialog action',
    run: () => {
      const flow: BusinessFlow = {
        ...createNamedFlow(),
        steps: [
          {
            id: 's001',
            order: 1,
            action: 'click',
            target: {
              testId: 'config-modal-confirm-button',
              displayName: '确定',
              scope: { dialog: { type: 'modal', title: '编辑配置', visible: true } },
            },
            context: {
              eventId: 'ctx-submit',
              capturedAt: 1000,
              before: {
                dialog: { type: 'modal', title: '编辑配置', visible: true },
                target: { tag: 'button', testId: 'config-modal-confirm-button', controlType: 'button', text: '确定' },
              },
            },
            assertions: [
              createTerminalStateAssertion('modal-closed', 's001-terminal-1', { title: '编辑配置' }),
            ],
          },
          {
            id: 's002',
            order: 2,
            action: 'click',
            target: {
              role: 'button',
              text: '确定',
              scope: { dialog: { type: 'modal', title: '二次确认', visible: true } },
            },
            context: {
              eventId: 'ctx-second-confirm',
              capturedAt: 1100,
              before: {
                dialog: { type: 'modal', title: '二次确认', visible: true },
                target: { tag: 'button', role: 'button', controlType: 'button', text: '确定' },
              },
            },
            assertions: [],
          },
        ],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      const secondStep = stepCodeBlock(code, 's002');

      assert(!code.includes('filter({ hasText: "编辑配置" }).waitFor({ state: "hidden"'), 'modal-closed assertion should not block before a captured second dialog action');
      assert(secondStep.includes('filter({ hasText: "二次确认" }).getByRole("button"'), 'second dialog action should remain scoped to the active dialog');
      assert(secondStep.includes('.click();'), 'second dialog action should still be emitted');
    },
  },
  {
    name: 'business semantic hints export compact yaml and AI input keep generic contract only',
    run: () => {
      const flow = mergeActionsIntoFlow(createNamedFlow(), [clickAction('编辑')], [], {});
      const businessUi = {
        library: 'pro-components',
        component: 'pro-table',
        componentPath: ['pro-table'],
        targetText: '编辑',
        targetTestId: 'site-ip-port-pool-row-edit-action',
        form: {
          formKind: 'modal-form',
          fieldKind: 'select',
          name: 'destVrfId',
          label: '目的 VRF',
          testId: 'site-ip-port-pool-vrf-field',
          valuePreview: 'internal-sensitive-preview',
        },
        table: {
          tableKind: 'pro-table',
          tableId: 'ip-port-pool',
          testId: 'site-ip-port-pool-table',
          rowKey: 'pool-42',
          rowText: 'pool-42 admin@example.com secret row text',
          columnKey: 'option',
        },
        overlay: { type: 'modal', title: 'IP 端口地址池', text: 'secret overlay text' },
        locatorHints: [{ kind: 'testid', value: 'site-ip-port-pool-row-edit-action', score: 0.99, reason: 'business test id' }],
        reasons: ['matched business hints with secret diagnostic reason'],
        confidence: 0.96,
      } as any;
      const flowWithBusinessHints: BusinessFlow = {
        ...flow,
        steps: flow.steps.map(step => ({
          ...step,
          uiRecipe: {
            kind: 'table-row-action',
            library: 'pro-components',
            component: 'pro-table',
            fieldKind: 'select',
            fieldName: 'destVrfId',
            tableTitle: 'ip-port-pool',
            rowKey: 'pool-42',
            columnTitle: 'option',
            targetText: '编辑',
            reasons: businessUi.reasons,
          } as any,
          target: { ...step.target, raw: { ui: businessUi, selector: '#business-secret-selector' } },
          context: {
            eventId: 'ctx-business-hints',
            capturedAt: Date.now(),
            before: {
              title: 'IP 池页面',
              url: 'https://example.test/networking/site/ip-pools?token=***#frag',
              target: { tag: 'button', text: '编辑', testId: 'site-ip-port-pool-row-edit-action' },
              ui: businessUi,
            },
          },
        })),
      };

      const exported = prepareBusinessFlowForExport(flowWithBusinessHints, 'await page.getByTestId("site-ip-port-pool-row-edit-action").click();');
      const exportedJson = JSON.stringify(exported);
      const yaml = toCompactFlow(exported);
      const aiJson = JSON.stringify(buildAiIntentInput(exported, exported.steps));

      for (const text of [exportedJson, yaml, aiJson]) {
        assert(text.includes('site-ip-port-pool-row-edit-action'), 'business target test id should remain useful');
        assert(text.includes('destVrfId'), 'business field name should remain useful');
        assert(text.includes('pool-42'), 'business row key should remain useful');
        assert(!text.includes('admin@example.com'), 'business rowText internals should not leak');
        assert(!text.includes('secret overlay text'), 'business overlay text should not leak');
        assert(!text.includes('internal-sensitive-preview'), 'business form value previews should not leak');
        assert(!text.includes('business test id'), 'business locator hint reasons should not leak');
        assert(!text.includes('#business-secret-selector'), 'business raw selector should not leak');
      }
      assert(yaml.includes('table: ip-port-pool') || yaml.includes('table: "ip-port-pool"'), 'compact yaml should preserve business table id');
      assert(yaml.includes('column: option') || yaml.includes('column: "option"'), 'compact yaml should preserve business column key fallback');
      assert(!aiJson.includes('token='), 'business AI input URL should strip query');
    },
  },
  {
    name: 'adaptive target snapshot stores testId role label and table row safely',
    run: () => {
      const step: FlowStep = {
        id: 's001',
        order: 1,
        action: 'click',
        target: {
          testId: 'user-row-save',
          role: 'button',
          name: '保存',
          label: '操作',
          text: '保存',
          selector: '.ant-table-row .ant-btn-primary',
          scope: {
            table: {
              title: '用户管理',
              testId: 'user-table',
              rowKey: 'user-42',
              rowText: 'user-42 李四 owner@example.com 编辑 删除',
              rowIdentity: { source: 'data-row-key', value: 'user-42', confidence: 0.98, stable: true },
              columnName: '操作',
            },
          },
        },
        context: {
          eventId: 'ctx-adaptive-save',
          capturedAt: 1000,
          before: {
            url: 'https://example.test/users?token=abc#debug',
            title: '用户管理',
            form: { label: '操作', name: 'actions' },
            target: { tag: 'button', role: 'button', testId: 'user-row-save', text: '保存', controlType: 'button' },
            table: {
              title: '用户管理',
              testId: 'user-table',
              rowKey: 'user-42',
              rowText: 'user-42 李四 owner@example.com 编辑 删除',
              rowIdentity: { source: 'data-row-key', value: 'user-42', confidence: 0.98, stable: true },
              columnName: '操作',
            },
          },
        },
        assertions: [],
      };

      const snapshot = createAdaptiveTargetSnapshot(step, { now: () => new Date('2026-01-01T00:00:00.000Z') });
      assert(snapshot, 'snapshot should be created for a structured target');
      assertEqual(snapshot?.target.testId, 'user-row-save');
      assertEqual(snapshot?.target.role, 'button');
      assertEqual(snapshot?.target.label, '操作');
      assertEqual(snapshot?.tableRow?.tableTestId, 'user-table');
      assertEqual(snapshot?.tableRow?.rowKey, 'user-42');
      assertEqual(snapshot?.context?.url, 'https://example.test/users');
      assert(!JSON.stringify(snapshot).includes('owner@example.com'), 'snapshot should be redacted before storage');

      const flow = withAdaptiveTargetSnapshot({ ...createNamedFlow(), steps: [step] }, 's001', { now: () => new Date('2026-01-01T00:00:00.000Z') });
      const stored = flow.artifacts?.recorder?.adaptiveTargets?.s001;
      assert(stored, 'snapshot should be stored under recorder internals');
      assertEqual(stored?.capturedAt, '2026-01-01T00:00:00.000Z');
      assert(!(flow.artifacts as any)?.adaptiveTargets, 'snapshot should not be stored as a top-level artifact');
      const normalized = migrateFlowToStableStepModel(flow);
      assert(normalized.artifacts?.recorder?.adaptiveTargets?.s001, 'normalization should preserve internal adaptive target snapshots');
    },
  },
  {
    name: 'adaptive target redaction removes token password email and phone values',
    run: () => {
      const redacted = redactAdaptiveTargetSnapshot({
        version: 1,
        stepId: 's001',
        action: 'click',
        capturedAt: '2026-01-01T00:00:00.000Z',
        target: {
          text: 'owner@example.com 13800138000 token=abc123 password=hunter2',
          selector: '[data-token="secret-value"] .danger',
        },
        candidates: [{
          kind: 'css',
          value: '[data-secret="super-secret"] owner@example.com',
          score: 0.3,
          reason: 'fallback contains token=abc123',
        }],
      });
      const json = JSON.stringify(redacted);

      assert(!json.includes('owner@example.com'), 'adaptive target should redact email-like values');
      assert(!json.includes('13800138000'), 'adaptive target should redact phone-like values');
      assert(!json.includes('abc123'), 'adaptive target should redact token assignment values');
      assert(!json.includes('hunter2'), 'adaptive target should redact password assignment values');
      assert(!json.includes('secret-value') && !json.includes('super-secret'), 'adaptive target should redact sensitive data attributes');
    },
  },
  {
    name: 'adaptive target export sanitizer strips snapshots and compact yaml omits candidates',
    run: () => {
      const step: FlowStep = {
        id: 's001',
        order: 1,
        action: 'click',
        target: { testId: 'save-user', role: 'button', name: '保存', text: '保存', selector: '[data-token="abc123"]' },
        assertions: [],
      };
      const flow = withAdaptiveTargetSnapshot({ ...createNamedFlow(), steps: [step] }, 's001');
      const exportFlow = prepareBusinessFlowForExport({
        ...flow,
        artifacts: {
          ...flow.artifacts,
          adaptiveTargets: { legacy: true },
          locatorCandidates: { legacy: true },
        } as any,
      }, 'await page.getByTestId("save-user").click();');
      const exportedJson = JSON.stringify(exportFlow);
      const yaml = toCompactFlow(flow);

      assert(!exportedJson.includes('adaptiveTargets'), 'exported JSON should strip adaptive target snapshots');
      assert(!exportedJson.includes('locatorCandidates'), 'exported JSON should strip locator candidate internals');
      assert(!exportedJson.includes('"candidates"'), 'exported JSON should not include adaptive locator candidates');
      assert(!yaml.includes('adaptiveTargets'), 'compact YAML should not include adaptive target snapshots');
      assert(!yaml.includes('candidates'), 'compact YAML should not include adaptive locator candidates');
      assert(!yaml.includes('data-token'), 'compact YAML should not include fallback selector internals from snapshots');
    },
  },
  {
    name: 'adaptive locator candidates rank testId table row role label text before css',
    run: () => {
      const candidates = rankAdaptiveLocatorCandidates({
        id: 's001',
        order: 1,
        action: 'click',
        target: {
          testId: 'row-save',
          role: 'button',
          name: '保存',
          label: '操作',
          text: '保存',
          selector: '.ant-btn-primary',
          scope: {
            table: {
              testId: 'user-table',
              rowKey: 'user-42',
              rowIdentity: { source: 'data-row-key', value: 'user-42', confidence: 0.98, stable: true },
            },
          },
        },
        assertions: [],
      });

      assertEqual(candidates.map(candidate => candidate.kind).join(','), 'testid,table-row,role,label,text,css');
      assertEqual(candidates[0].value, 'row-save');
      assert(candidates[1].value.includes('user-42'), 'table row candidate should preserve the row identity');
    },
  },
  {
    name: 'adaptive replay failure diagnostic includes redacted target and candidates',
    run: () => {
      const step: FlowStep = {
        id: 's001',
        order: 1,
        action: 'click',
        intent: '保存用户行',
        target: {
          testId: 'row-save',
          role: 'button',
          name: '保存',
          text: '保存 owner@example.com 13800138000 token=abc123',
          selector: '[data-token="super-secret"] .ant-btn-primary',
          scope: {
            table: {
              testId: 'user-table',
              rowKey: 'user-42',
              rowText: 'user-42 李四 owner@example.com 编辑 删除',
              rowIdentity: { source: 'data-row-key', value: 'user-42', confidence: 0.98, stable: true },
            },
          },
        },
        context: {
          eventId: 'ctx-diagnostic-save',
          capturedAt: 1000,
          before: {
            url: 'https://example.test/users?token=abc123#debug',
            title: '用户管理',
            target: {
              tag: 'button',
              role: 'button',
              testId: 'row-save',
              text: '保存 owner@example.com 13800138000 token=abc123',
            },
            table: {
              title: '用户管理',
              testId: 'user-table',
              rowKey: 'user-42',
              rowText: 'user-42 李四 owner@example.com 编辑 删除',
              rowIdentity: { source: 'data-row-key', value: 'user-42', confidence: 0.98, stable: true },
            },
          },
        },
        assertions: [],
      };
      const diagnostic = createReplayFailureDiagnostic({ ...createNamedFlow(), steps: [step] }, 's001', {
        kind: 'timeout',
        message: 'Timed out at https://example.test/users?token=abc123#debug for owner@example.com 13800138000 <div data-token="super-secret">raw</div>',
      }, { now: () => new Date('2026-01-01T00:00:00.000Z') });
      const json = JSON.stringify(diagnostic);

      assert(diagnostic, 'diagnostic should be created for the failed step');
      assertEqual(diagnostic?.stepId, 's001');
      assertEqual(diagnostic?.intent, '保存用户行');
      assertEqual(diagnostic?.target?.testId, 'row-save');
      assertEqual(diagnostic?.tableRow?.rowKey, 'user-42');
      assertEqual(diagnostic?.context?.url, 'https://example.test/users');
      assert(diagnostic?.candidates.some(candidate => candidate.kind === 'testid' && candidate.value === 'row-save'), 'diagnostic should keep stable test id candidate');
      assert(diagnostic?.candidates.some(candidate => candidate.kind === 'css' && candidate.value === '[css selector omitted]'), 'diagnostic should mention css fallback without leaking the selector');
      assertEqual(diagnostic?.fallback.autoFallback, false);
      assert(!json.includes('owner@example.com'), 'diagnostic should redact email-like values');
      assert(!json.includes('13800138000'), 'diagnostic should redact phone-like values');
      assert(!json.includes('abc123') && !json.includes('super-secret'), 'diagnostic should redact token-like values');
      assert(!json.includes('?token=') && !json.includes('#debug'), 'diagnostic should strip URL query and hash values');
      assert(!json.includes('[data-token'), 'diagnostic should not leak full selector values');
      assert(!json.includes('李四 owner'), 'diagnostic should not leak full row text');
      assert(!json.includes('<div'), 'diagnostic should not leak raw DOM snippets');
    },
  },
  {
    name: 'adaptive replay failure diagnostic includes recipe replay strategy',
    run: () => {
      const step: FlowStep = {
        id: 's001',
        order: 1,
        action: 'select',
        intent: '选择地址池',
        target: { role: 'combobox', label: '地址池', name: '地址池' },
        value: 'pool-a',
        context: {
          eventId: 'ctx-select-pool',
          capturedAt: 1000,
          before: {
            url: 'https://example.test/pools?token=abc123',
            form: { label: '地址池', name: 'poolId' },
            target: {
              role: 'option',
              framework: 'antd',
              controlType: 'select-option',
              selectedOption: 'pool-a',
            },
            ui: {
              library: 'antd',
              component: 'select',
              targetRole: 'option',
              form: { label: '地址池', name: 'poolId', fieldKind: 'select' },
              option: { text: 'pool-a' },
              locatorHints: [],
              confidence: 0.95,
              reasons: [],
            },
          },
        },
        assertions: [],
      };
      const diagnostic = createReplayFailureDiagnostic({ ...createNamedFlow(), steps: [step] }, 's001', {
        kind: 'runtime-bridge-miss',
        message: 'active popup option was not found',
      });

      assertEqual(diagnostic?.replay?.recipeComponent, 'Select');
      assertEqual(diagnostic?.replay?.recipeOperation, 'selectOption');
      assertEqual(diagnostic?.replay?.exportedStrategy, 'antd-owned-option-dispatch');
      assertEqual(diagnostic?.replay?.parserSafeStrategy, 'field-trigger-search-option');
      assertEqual(diagnostic?.replay?.runtimeFallback, 'active-antd-popup-option');
      assert(diagnostic?.fallback.reason.includes('diagnostics never auto-retry'), 'diagnostic should explain why runtime fallback is not auto-applied');
    },
  },
  {
    name: 'adaptive replay failure diagnostic is not included in exported JSON or compact YAML',
    run: () => {
      const step: FlowStep = {
        id: 's001',
        order: 1,
        action: 'click',
        target: { testId: 'save-user', role: 'button', name: '保存', selector: '[data-secret="hidden"]' },
        assertions: [],
      };
      const flow = { ...createNamedFlow(), steps: [step] };
      const diagnostic = createReplayFailureDiagnostic(flow, 's001', { kind: 'unknown', message: 'failed' });
      const exportFlow = prepareBusinessFlowForExport({
        ...flow,
        artifacts: {
          replayFailureDiagnostics: [diagnostic],
        } as any,
      }, 'await page.getByTestId("save-user").click();');
      const exportedJson = JSON.stringify(exportFlow);
      const yaml = toCompactFlow({ ...flow, artifacts: { replayFailureDiagnostics: [diagnostic] } as any });

      assert(!exportedJson.includes('replayFailureDiagnostics'), 'exported JSON should strip replay failure diagnostics');
      assert(!exportedJson.includes('adaptive replay'), 'exported JSON should not include diagnostic fallback copy');
      assert(!yaml.includes('replayFailureDiagnostics'), 'compact YAML should not include replay failure diagnostics');
      assert(!yaml.includes('[data-secret'), 'compact YAML should not include diagnostic selector internals');
    },
  },
  {
    name: 'adaptive replay failure diagnostics infer step from generated source lines',
    run: () => {
      const step: FlowStep = {
        id: 's001',
        order: 1,
        action: 'click',
        target: { testId: 'save-user', role: 'button', name: '保存' },
        assertions: [],
      };
      const source = [
        `import { test, expect } from '@playwright/test';`,
        `test('generated', async ({ page }) => {`,
        `  // s001 点击: 保存`,
        `  await page.getByTestId('save-user').click();`,
        `});`,
      ].join('\n');
      const artifact = createReplayFailureDiagnosticsArtifact({ ...createNamedFlow(), steps: [step] }, {
        message: '/tmp/generated-replay.spec.ts:4:3 Timeout 13800138000 owner@example.com',
      }, {
        generatedSource: source,
        output: '/tmp/generated-replay.spec.ts:4:3 Timeout 13800138000 owner@example.com',
        now: () => new Date('2026-01-01T00:00:00.000Z'),
      });
      const json = JSON.stringify(artifact);

      assertEqual(artifact?.inferredStepIds.join(','), 's001');
      assertEqual(artifact?.diagnostics[0]?.stepId, 's001');
      assert(!json.includes('owner@example.com'), 'diagnostics artifact should redact email values');
      assert(!json.includes('13800138000'), 'diagnostics artifact should redact phone values');
    },
  },
  {
    name: 'semantic diagnostics ring buffer stores only compact redacted fields',
    run: () => {
      const buffer = createSemanticDiagnosticsBuffer(3);
      const ui = {
        ...semanticUi({
          library: 'unknown',
          component: 'unknown',
          recipe: 'raw-dom-action',
          targetText: '普通文本',
        }),
        weak: true,
        table: { rowText: 'admin@example.com secret row text' },
        overlay: { text: 'secret overlay text token=abc', title: '提示' },
        option: { text: '管理员', value: 'secret-option-value' },
        locatorHints: [
          { kind: 'css', value: '.secret-selector-with-token-abcdef', score: 0.1, reason: 'fallback css raw selector' },
        ],
      } as any;
      for (let i = 0; i < 5; i++)
        buffer.push(compactSemanticDiagnostic(ui));
      const entries = buffer.entries();
      const json = JSON.stringify(entries);
      assertEqual(entries.length, 3);
      assert(entries.every(entry => entry.event === 'semantic.weak' || entry.event === 'semantic.fallback-css'), 'diagnostics should classify weak/fallback events');
      assert(json.includes('valuePreview'), 'diagnostics should keep truncated locator valuePreview');
      assert(!json.includes('"value"'), 'diagnostics should not keep full locator hint value');
      assert(!json.includes('admin@example.com'), 'diagnostics should not keep rowText internals');
      assert(!json.includes('secret overlay text'), 'diagnostics should not keep overlay text internals');
      assert(!json.includes('secret-option-value'), 'diagnostics should not keep option values');
      assert(!json.includes('abc'), 'diagnostics should redact token values, not only token keys');
    },
  },
  {
    name: 'export sanitization strips recorder internals and compact yaml does not leak artifacts',
    run: () => {
      const flow = mergeActionsIntoFlow(createNamedFlow(), [clickAction('保存')], [], {});
      const flowWithUiInternals: BusinessFlow = {
        ...flow,
        steps: flow.steps.map(step => ({
          ...step,
          target: {
            ...step.target,
            raw: {
              target: { tag: 'button', text: '保存' },
              ui: {
                ...semanticUi({
                  library: 'pro-components',
                  component: 'pro-table',
                  recipe: 'table-row-action',
                  tableTitle: '用户管理',
                  rowKey: 'user-42',
                  columnTitle: '操作',
                  targetText: '保存',
                }),
                table: {
                  title: '用户管理',
                  rowKey: 'user-42',
                  rowText: 'user-42 李四 owner@example.com 编辑 删除',
                  columnTitle: '操作',
                },
                overlay: { type: 'popover', title: '确认保存', text: 'target raw 内部诊断长文案', visible: true },
                option: { text: '管理员', value: 'target-raw-internal-role-admin' },
              },
            },
          },
          context: {
            eventId: 'ctx-export-ui',
            capturedAt: Date.now(),
            before: {
              target: { tag: 'button', text: '保存' },
              ui: {
                ...semanticUi({
                  library: 'pro-components',
                  component: 'pro-table',
                  recipe: 'table-row-action',
                  tableTitle: '用户管理',
                  rowKey: 'user-42',
                  columnTitle: '操作',
                  targetText: '保存',
                }),
                table: {
                  title: '用户管理',
                  rowKey: 'user-42',
                  rowText: 'user-42 张三 admin@example.com 编辑 删除',
                  columnTitle: '操作',
                },
                overlay: { type: 'popover', title: '确认保存', text: '内部诊断长文案', visible: true },
                option: { text: '管理员', value: 'internal-role-admin' },
              },
            } as any,
          },
        })),
      };
      const exportFlow = prepareBusinessFlowForExport({
        ...flowWithUiInternals,
        artifacts: {
          ...flow.artifacts,
          deletedActionIndexes: [0],
          deletedActionSignatures: { '0': 'legacy' },
          stepActionIndexes: { s001: 0 },
          stepMergedActionIndexes: { s001: [0] },
        },
      }, 'await page.getByRole("button", { name: "保存" }).click();');

      assert(!exportFlow.artifacts?.recorder, 'export should remove recorder action log');
      assert(!exportFlow.artifacts?.deletedActionIndexes, 'export should remove deletedActionIndexes');
      assert(!exportFlow.artifacts?.deletedActionSignatures, 'export should remove deletedActionSignatures');
      assert(!exportFlow.artifacts?.stepActionIndexes, 'export should remove stepActionIndexes');
      assert(!exportFlow.artifacts?.stepMergedActionIndexes, 'export should remove stepMergedActionIndexes');
      assertEqual(exportFlow.artifacts?.playwrightCode, 'await page.getByRole("button", { name: "保存" }).click();');
      const exportedUiJson = JSON.stringify(exportFlow.steps[0].context?.before.ui);
      assert(exportedUiJson.includes('用户管理'), 'export should keep compact useful UI context');
      assert(!exportedUiJson.includes('locatorHints'), 'exported flow should strip UI locator hints');
      assert(!exportedUiJson.includes('test fixture'), 'exported flow should strip UI diagnostic reasons');
      assert(!exportedUiJson.includes('内部诊断长文案'), 'exported flow should strip overlay text internals');
      assert(!exportedUiJson.includes('admin@example.com'), 'exported flow should strip table row text internals');
      assert(!exportedUiJson.includes('internal-role-admin'), 'exported flow should strip option internal values');
      const exportedTargetRawJson = JSON.stringify(exportFlow.steps[0].target?.raw);
      assert(exportedTargetRawJson.includes('用户管理'), 'export target raw should keep compact useful UI context');
      assert(!exportedTargetRawJson.includes('locatorHints'), 'exported target raw should strip UI locator hints');
      assert(!exportedTargetRawJson.includes('test fixture'), 'exported target raw should strip UI diagnostic reasons');
      assert(!exportedTargetRawJson.includes('target raw 内部诊断长文案'), 'exported target raw should strip overlay text internals');
      assert(!exportedTargetRawJson.includes('owner@example.com'), 'exported target raw should strip table row text internals');
      assert(!exportedTargetRawJson.includes('target-raw-internal-role-admin'), 'exported target raw should strip option internal values');

      const yaml = toCompactFlow(exportFlow);
      assert(!yaml.includes('actionLog'), 'compact yaml should not include actionLog');
      assert(!yaml.includes('stepActionIndexes'), 'compact yaml should not include legacy indexes');
      assert(!yaml.includes('recorder:'), 'compact yaml should not include recorder artifacts');
    },
  },
];

runStepStabilityTests().catch(error => {
  setTimeout(() => { throw error; }, 0);
});

async function runStepStabilityTests() {
  for (const test of tests) {
    await test.run();
    writeLine(`ok - ${test.name}`);
  }
  writeLine(`\n${tests.length} flow stability tests passed`);
}

function createNamedFlow() {
  return createEmptyBusinessFlow({
    flow: {
      id: 'flow-test',
      name: '稳定步骤测试',
    },
  });
}

function clickAction(name: string) {
  return {
    action: {
      name: 'click',
      selector: `internal:role=button[name="${escapeSelectorName(name)}"i]`,
    },
  };
}

function clickActionWithWallTime(name: string, wallTime: number) {
  return {
    ...clickAction(name),
    wallTime,
  };
}

function rawClickAction(selector: string) {
  return {
    action: {
      name: 'click',
      selector,
    },
  };
}

function testIdClickAction(testId: string, wallTime?: number) {
  return {
    action: {
      name: 'click',
      selector: `internal:testid=[data-testid="${escapeSelectorName(testId)}"s]`,
    },
    wallTime,
  };
}

function fillAction(label: string, value: string) {
  return {
    action: {
      name: 'fill',
      selector: `internal:label="${escapeSelectorName(label)}"i`,
      text: value,
    },
  };
}

function fillActionWithWallTime(label: string, value: string, wallTime: number) {
  return {
    ...fillAction(label, value),
    wallTime,
  };
}

function weakTextboxFillAction(accessibleName: string, value: string, wallTime: number) {
  return {
    action: {
      name: 'fill',
      selector: `internal:role=textbox[name="${escapeSelectorName(accessibleName)}"i]`,
      text: value,
    },
    wallTime,
  };
}

function selectTriggerAction(label: string, wallTime: number) {
  return {
    action: {
      name: 'click',
      selector: `internal:role=combobox[name="${escapeSelectorName(label)}"i]`,
    },
    wallTime,
  };
}

function selectSearchFillAction(label: string, value: string, wallTime: number) {
  return {
    action: {
      name: 'fill',
      selector: `internal:role=combobox[name="${escapeSelectorName(label)}"i]`,
      text: value,
    },
    wallTime,
  };
}

function selectOptionAction(optionText: string, wallTime: number) {
  return {
    action: {
      name: 'click',
      selector: `internal:role=option[name="${escapeSelectorName(optionText)}"i]`,
    },
    wallTime,
  };
}

function fillActionWithEndWallTime(label: string, value: string, endWallTime: number) {
  return {
    ...fillAction(label, value),
    endWallTime,
  };
}

function pressAction(label: string, key: string) {
  return {
    action: {
      name: 'press',
      selector: `internal:label="${escapeSelectorName(label)}"i`,
      key,
    },
  };
}

function navigateAction(url: string) {
  return {
    action: {
      name: 'navigate',
      url,
    },
  };
}

function pageClickEvent(id: string, wallTime: number, text: string) {
  return pageClickEventWithTarget(id, wallTime, {
    tag: 'span',
    role: 'button',
    text,
    normalizedText: text,
  });
}

function pageClickEventWithTarget(id: string, wallTime: number, target: ElementContext): PageContextEvent {
  return {
    id,
    kind: 'click' as const,
    time: wallTime,
    wallTime,
    before: {
      target,
    },
  };
}

function issue60RangeInputFlow() {
  const withRecorder = mergeActionsIntoFlow(createNamedFlow(), [
    weakTextboxFillAction('开始地址，例如：', '1.1.1.1', 1200),
  ], recordedSource([
    `await page.locator(".ant-modal, .ant-drawer, [role=\\"dialog\\"]").filter({ hasText: "新建IP端口地址池" }).getByRole('textbox', { name: '开始地址，例如：' }).fill('1.1.1.1');`,
  ]), {});
  return mergePageContextIntoFlow(withRecorder, [
    proComponentsRangeInputFocusEvent('ctx-range-start-focus', 1000, {
      testId: 'site-ip-address-pool-range-field',
      label: '开始地址，例如：192.168.1.1',
      placeholder: '开始地址，例如：192.168.1.1',
      fieldName: 'pool.start',
    }),
  ]);
}

function proComponentsRangeInputFocusEvent(id: string, wallTime: number, options: { testId: string; label: string; placeholder: string; fieldName: string }): PageContextEvent {
  const event = pageClickEventWithTarget(id, wallTime, {
    tag: 'input',
    role: 'textbox',
    placeholder: options.placeholder,
    normalizedText: options.placeholder,
    framework: 'procomponents',
    controlType: 'input',
    locatorQuality: 'semantic',
  } as ElementContext);
  event.before.form = {
    label: options.label,
    name: options.fieldName,
    testId: options.testId,
  };
  event.before.dialog = { type: 'modal', title: '新建IP端口地址池', visible: true };
  event.before.ui = {
    library: 'pro-components',
    component: 'input',
    targetTestId: options.testId,
    targetText: options.label,
    form: {
      formKind: 'pro-form',
      fieldKind: 'input',
      label: options.label,
      name: options.fieldName,
      dataIndex: options.fieldName,
      placeholder: options.placeholder,
      testId: options.testId,
    },
    locatorHints: [{ kind: 'testid', value: options.testId, score: 0.95, reason: 'issue #60 fixture' }],
    recipe: {
      kind: 'fill-form-field',
      library: 'pro-components',
      component: 'input',
      fieldKind: 'input',
      fieldLabel: options.label,
      fieldName: options.fieldName,
    },
    confidence: 0.95,
    reasons: ['issue #60 fixture'],
  } as any;
  return event;
}

function proComponentsRangeInputEvent(id: string, wallTime: number, options: { testId: string; label: string; placeholder: string; fieldName: string }, value: string): PageContextEvent {
  const event = proComponentsRangeInputFocusEvent(id, wallTime, options);
  event.kind = 'input';
  event.before.ui!.form!.valuePreview = value;
  return event;
}

function anchorGroundingFixture() {
  const buttonAnchor = {
    id: 'ancestor:2:button:save-button',
    tag: 'button',
    role: 'button',
    text: '保存',
    testId: 'save-button',
    depthFromTarget: 2,
    source: 'ancestor' as const,
    ruleScore: 1498,
    reasons: ['business action test id', 'button semantic'],
    risks: [],
    bbox: { left: 100, top: 100, right: 140, bottom: 124, width: 40, height: 24 },
  };
  const iconAnchor = {
    id: 'target:0:svg:icon',
    tag: 'svg',
    depthFromTarget: 0,
    source: 'target' as const,
    ruleScore: -300,
    reasons: [],
    risks: ['icon node'],
    bbox: { left: 104, top: 104, right: 116, bottom: 116, width: 12, height: 12 },
  };
  return {
    rawTarget: iconAnchor,
    chosenAnchor: buttonAnchor,
    equivalentAnchors: [buttonAnchor, iconAnchor],
    candidates: [buttonAnchor, iconAnchor],
    confidence: 0.92,
    reasons: ['business action test id', 'button semantic', 'visual equivalent anchor group'],
  };
}

class FakeAnchorElement {
  readonly tagName: string;
  readonly ownerDocument = { elementFromPoint: () => undefined };
  readonly parentElement = null;

  constructor(
    tagName: string,
    private readonly attributes: Record<string, string>,
    readonly mockText: string | undefined,
    private readonly rect: { left: number; top: number; right: number; bottom: number; width: number; height: number },
  ) {
    this.tagName = tagName.toUpperCase();
  }

  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }

  hasAttribute(name: string) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }

  matches() {
    return false;
  }

  getBoundingClientRect() {
    return this.rect;
  }
}

function fakeAnchorElement(tagName: string, attributes: Record<string, string>, text: string | undefined, rect: { left: number; top: number; right: number; bottom: number; width: number; height: number }) {
  return new FakeAnchorElement(tagName, attributes, text, rect);
}

function pageSelectTriggerEvent(id: string, wallTime: number, label: string, controlType: 'select' | 'tree-select' | 'cascader' = 'select'): PageContextEvent {
  const event = pageClickEventWithTarget(id, wallTime, {
    tag: 'div',
    role: 'combobox',
    text: label,
    normalizedText: label,
    framework: 'antd',
    controlType,
    locatorQuality: 'semantic',
  } as ElementContext);
  event.before.form = { label, name: label, testId: `${label}-field` };
  event.before.dialog = { type: 'modal', title: '新建IPv4地址池', visible: true };
  event.after = { dialog: { type: 'dropdown', title: `${label}选项`, visible: true } };
  return event;
}

function pageSelectSearchEvent(id: string, wallTime: number, label: string, value: string): PageContextEvent {
  return {
    id,
    kind: 'input' as const,
    time: wallTime,
    wallTime,
    before: {
      form: { label, name: label, testId: `${label}-field` },
      dialog: { type: 'dropdown', title: `${label}选项`, visible: true },
      target: {
        tag: 'input',
        role: 'combobox',
        text: label,
        normalizedText: label,
        framework: 'antd',
        controlType: 'select',
        locatorQuality: 'semantic',
      },
      ui: {
        library: 'antd',
        component: 'select',
        targetText: label,
        form: {
          formKind: 'antd-form',
          fieldKind: 'select',
          label,
          name: label,
          valuePreview: value,
        },
        locatorHints: [{ kind: 'label', value: label, score: 0.9, reason: 'test fixture' }],
        confidence: 0.9,
        reasons: ['test fixture'],
      },
    },
  };
}

function pageSelectOptionEvent(id: string, wallTime: number, label: string, selectedText: string, controlType: 'select-option' | 'tree-select-option' | 'cascader-option' = 'select-option', optionPath?: string[]): PageContextEvent {
  const event = pageClickEventWithTarget(id, wallTime, {
    tag: controlType === 'cascader-option' ? 'li' : 'div',
    role: controlType === 'tree-select-option' ? 'treeitem' : 'option',
    text: selectedText,
    normalizedText: selectedText,
    title: selectedText,
    selectedOption: selectedText,
    framework: 'antd',
    controlType,
    optionPath,
    locatorQuality: 'semantic',
  } as ElementContext);
  event.before.form = { label, name: label, testId: `${label}-field` };
  event.before.dialog = { type: 'dropdown', title: `${label}选项`, visible: true };
  event.after = { dialog: { type: 'modal', title: '新建IPv4地址池', visible: true } };
  return event;
}

function pageInputEvent(id: string, wallTime: number, label: string, value: string): PageContextEvent {
  return pageFieldEvent(id, 'input', wallTime, label, value);
}

function pageDialogInputEvent(id: string, wallTime: number, label: string, value: string, dialogTitle: string): PageContextEvent {
  const event = pageFieldEvent(id, 'input', wallTime, label, value);
  return {
    ...event,
    before: {
      ...event.before,
      dialog: { type: 'modal', title: dialogTitle, visible: true },
    },
  };
}

function journalFromPageEvents(events: PageContextEvent[]) {
  const eventsById = Object.fromEntries(events.map(event => {
    const wallTime = typeof event.wallTime === 'number' ? event.wallTime : Date.now();
    return [`page-context:${event.id}`, {
      id: `page-context:${event.id}`,
      sessionId: 'page-context',
      source: 'page-context',
      kind: event.kind,
      createdAt: new Date(wallTime).toISOString(),
      timestamp: { wallTime, performanceTime: event.time },
      payload: event,
    }];
  }));
  return {
    version: 1,
    eventsById,
    eventOrder: events.map(event => `page-context:${event.id}`),
    sessions: [],
    highWaterMarks: {
      recorderActionCount: 0,
      pageContextEventCount: events.length,
    },
  } as any;
}

function pageKeydownEvent(id: string, wallTime: number, label: string, key: string): PageContextEvent {
  return pageFieldEvent(id, 'keydown', wallTime, label, undefined, key);
}

function pageFieldEvent(id: string, kind: PageContextEvent['kind'], wallTime: number, label: string, value?: string, key?: string): PageContextEvent {
  return {
    id,
    kind,
    time: wallTime,
    wallTime,
    before: {
      form: { label, name: label, testId: `${label}-field` },
      target: {
        tag: 'input',
        role: 'textbox',
        placeholder: label,
        controlType: 'input',
        locatorQuality: 'semantic',
      },
      ui: {
        library: 'antd',
        component: 'input',
        targetText: label,
        form: {
          formKind: 'antd-form',
          fieldKind: 'input',
          label,
          name: label,
          placeholder: label,
          valuePreview: value,
        },
        locatorHints: [{ kind: 'label', value: label, score: 0.9, reason: 'test fixture' }],
        recipe: {
          kind: 'fill-form-field',
          library: 'antd',
          component: 'input',
          fieldKind: 'input',
          fieldLabel: label,
          fieldName: label,
        },
        confidence: 0.9,
        reasons: ['test fixture'],
      },
    },
    ...(key ? { key } : {}),
  } as PageContextEvent;
}

function recordedSource(actions: string[]) {
  return [{
    isRecorded: true,
    id: 'playwright-test',
    label: 'Test',
    text: actions.join('\n'),
    language: 'javascript',
    actions,
    highlight: [],
  }];
}

function recordedSourceText(text: string) {
  return [{
    isRecorded: true,
    id: 'playwright-test',
    label: 'Test',
    text,
    language: 'javascript',
    highlight: [],
  }];
}

function escapeSelectorName(value: string) {
  return value.replace(/"/g, '\\"');
}

function stepCodeBlock(code: string, stepId: string) {
  const start = code.indexOf(`// ${stepId} `);
  assert(start >= 0, `${stepId} block should exist`);
  const next = code.indexOf('\n  // s', start + 1);
  return code.slice(start, next === -1 ? undefined : next);
}

function runnableLineCount(code: string) {
  return code.split(/\r?\n/).filter(line => /^(await|const|let|var)\s/.test(line.trim())).length;
}

function createIpPoolSelectFlow(optionText: string): BusinessFlow {
  const compactOptionText = optionText.replace(/\s+/g, '');
  return {
    ...createNamedFlow(),
    steps: [
      {
        id: 's001',
        order: 1,
        kind: 'recorded',
        action: 'click',
        target: {
          role: 'combobox',
          name: 'IP地址池',
        },
        context: { eventId: 'ctx-address-pool-trigger', capturedAt: 1000, before: { form: { label: 'IP地址池' }, target: { role: 'combobox', framework: 'procomponents', controlType: 'select' } } },
        sourceCode: `await page.locator(".ant-form-item").filter({ hasText: "IP地址池" }).locator(".ant-select-selector").first().click();`,
        assertions: [],
      },
      {
        id: 's002',
        order: 2,
        kind: 'recorded',
        action: 'click',
        target: { text: optionText, displayName: optionText },
        context: {
          eventId: 'ctx-address-pool-option',
          capturedAt: 1100,
          before: {
            form: { label: 'IP地址池' },
            dialog: { type: 'dropdown', title: 'IP地址池', visible: true },
            target: {
              tag: 'div',
              role: 'option',
              title: '[object Object]',
              text: optionText,
              normalizedText: optionText,
              selectedOption: optionText,
              framework: 'procomponents',
              controlType: 'select-option',
            },
          },
        },
        rawAction: { action: { name: 'click', selector: `internal:text="${compactOptionText}"i` } },
        sourceCode: `await page.getByText('${compactOptionText}').click();`,
        assertions: [],
      },
    ],
  };
}

function assertParserSafeIpOptionCompactToken(optionStep: string, expectedToken: string) {
  assert(optionStep.includes(`hasText: ${JSON.stringify(expectedToken)}`), `parser-safe replay should keep compact option token ${expectedToken}`);
  if (expectedToken !== 'test11.1.1.1--2.2.2.2共享')
    assert(!optionStep.includes('hasText: "test11.1.1.1--2.2.2.2共享"'), 'parser-safe replay must not reorder marker-before-range labels into a marker-after-range token');
  if (expectedToken !== 'test1共享1.1.1.1--2.2.2.2')
    assert(!optionStep.includes('hasText: "test1共享1.1.1.1--2.2.2.2"'), 'parser-safe replay must not reorder marker-after-range labels into a marker-before-range token');
  assert(!optionStep.includes('internal:has-text="test1"i >> internal:has-text="1.1.1.1--2.2.2.2"i >> internal:has-text="共享"i'), 'parser-safe replay must not split runtime bridge IP option matching into chained text tokens');
}

function flowMergeSummary(flow: BusinessFlow) {
  return {
    steps: flow.steps.map(step => ({
      id: step.id,
      order: step.order,
      action: step.action,
      target: stableTargetSummary(step.target),
      value: step.value,
      url: step.url,
      sourceActionIds: step.sourceActionIds,
      sourceCode: step.sourceCode,
      assertions: step.assertions.map(assertion => ({
        id: assertion.id,
        type: assertion.type,
        subject: assertion.subject,
        target: stableTargetSummary(assertion.target),
        expected: assertion.expected,
        enabled: assertion.enabled,
      })),
    })),
    actionLog: flow.artifacts?.recorder?.actionLog.map(entry => ({
      id: entry.id,
      sessionId: entry.sessionId,
      sessionIndex: entry.sessionIndex,
      recorderIndex: entry.recorderIndex,
      signature: entry.signature,
      sourceCode: entry.sourceCode,
      wallTime: entry.wallTime,
      endWallTime: entry.endWallTime,
    })),
    sessions: flow.artifacts?.recorder?.sessions.map(session => ({
      id: session.id,
      mode: session.mode,
      baseActionCount: session.baseActionCount,
      insertAfterStepId: session.insertAfterStepId,
    })),
  };
}

function stableTargetSummary(target: FlowStep['target']) {
  if (!target)
    return undefined;
  const { raw, ...stableTarget } = target;
  return stableTarget;
}

function semanticUi(options: {
  library: 'antd' | 'pro-components' | 'unknown';
  component: UiComponentKind;
  recipe: UiActionRecipe['kind'];
  fieldLabel?: string;
  optionText?: string;
  tableTitle?: string;
  rowKey?: string;
  columnTitle?: string;
  overlayTitle?: string;
  targetText?: string;
}) {
  return {
    library: options.library,
    component: options.component,
    componentPath: [options.component],
    targetText: options.targetText,
    form: options.fieldLabel ? { label: options.fieldLabel } : undefined,
    table: options.tableTitle ? { title: options.tableTitle, rowKey: options.rowKey, columnTitle: options.columnTitle } : undefined,
    overlay: options.overlayTitle ? { title: options.overlayTitle } : undefined,
    option: options.optionText ? { text: options.optionText } : undefined,
    recipe: {
      kind: options.recipe,
      library: options.library,
      component: options.component,
      fieldLabel: options.fieldLabel,
      optionText: options.optionText,
      tableTitle: options.tableTitle,
      rowKey: options.rowKey,
      columnTitle: options.columnTitle,
      overlayTitle: options.overlayTitle,
      targetText: options.targetText,
    },
    locatorHints: [{ kind: 'testid', value: 'semantic-test', score: 0.9, reason: 'test fixture' }],
    confidence: 0.9,
    reasons: ['test fixture'],
  };
}

function overlayPredictionCandidate(kind: OverlayPredictionCandidate['overlayKind'], title: string, testId?: string): OverlayPredictionCandidate {
  return {
    type: kind === 'modal' ? 'modal' : kind === 'drawer' ? 'drawer' : kind === 'select-dropdown' || kind === 'dropdown' ? 'dropdown' : 'popover',
    overlayKind: kind,
    title,
    testId,
    visible: true,
    signature: [kind, testId, title].filter(Boolean).join(':'),
  };
}

type TestOverlayElement = Element & {
  __attrs: Record<string, string>;
  __children: TestOverlayElement[];
  __parent?: TestOverlayElement;
};

function testOverlayRoot(children: TestOverlayElement[]): ParentNode {
  return {
    querySelectorAll: (selector: string) => collectTestOverlayDescendants(children).filter(element => testOverlayMatches(element, selector)),
  } as unknown as ParentNode;
}

function testOverlayElement(attrs: Record<string, string>, children: TestOverlayElement[] = []): TestOverlayElement {
  const element = {
    tagName: 'DIV',
    __attrs: attrs,
    __children: children,
    getAttribute: (name: string) => element.__attrs[name] ?? null,
    querySelector: (selector: string) => collectTestOverlayDescendants(element.__children).find(child => testOverlayMatches(child, selector)) ?? null,
    querySelectorAll: (selector: string) => collectTestOverlayDescendants(element.__children).filter(child => testOverlayMatches(child, selector)),
    closest: (selector: string) => {
      let current: TestOverlayElement | undefined = element;
      while (current) {
        if (testOverlayMatches(current, selector))
          return current;
        current = current.__parent;
      }
      return null;
    },
    getBoundingClientRect: () => ({ width: 100, height: 20 }) as DOMRect,
  } as unknown as TestOverlayElement;
  for (const child of children)
    child.__parent = element;
  return element;
}

function collectTestOverlayDescendants(elements: TestOverlayElement[]): TestOverlayElement[] {
  const result: TestOverlayElement[] = [];
  for (const element of elements) {
    result.push(element);
    result.push(...collectTestOverlayDescendants(element.__children));
  }
  return result;
}

function testOverlayMatches(element: TestOverlayElement, selector: string) {
  return selector.split(',').some(part => testOverlayMatchesSimpleSelector(element, part.trim()));
}

function testOverlayMatchesSimpleSelector(element: TestOverlayElement, selector: string) {
  if (!selector)
    return false;
  if (selector.startsWith('.'))
    return (element.getAttribute('class') || '').split(/\s+/).includes(selector.slice(1));
  const role = selector.match(/^\[role="([^"]+)"\]$/);
  if (role)
    return element.getAttribute('role') === role[1];
  return false;
}

function assert(value: unknown, message: string): asserts value {
  if (!value)
    throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson)
    throw new Error(`Expected ${expectedJson}, received ${actualJson}`);
}

function assertTextInOrder(text: string, markers: Array<string | RegExp>) {
  let offset = 0;
  for (const marker of markers) {
    const slice = text.slice(offset);
    const index = typeof marker === 'string' ? slice.indexOf(marker) : slice.search(marker);
    if (index < 0)
      throw new Error(`Missing marker after offset ${offset}: ${String(marker)}\n${text}`);
    offset += index + 1;
  }
}

function writeLine(value: string) {
  const runtime = globalThis as typeof globalThis & {
    process?: {
      stdout?: {
        write: (chunk: string) => void;
      };
    };
  };
  runtime.process?.stdout?.write(`${value}\n`);
}
