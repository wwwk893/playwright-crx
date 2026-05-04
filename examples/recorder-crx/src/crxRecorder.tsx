/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as React from 'react';
import { Toolbar } from '@web/components/toolbar';
import { ToolbarButton, ToolbarSeparator } from '@web/components/toolbarButton';
import { Dialog } from './dialog';
import { PreferencesForm } from './preferencesForm';
import type { CallLog, ElementInfo, Mode, Source } from '@recorder/recorderTypes';
import { Recorder } from '@recorder/recorder';
import type { CrxSettings } from './settings';
import { addSettingsChangedListener, defaultSettings, loadSettings, removeSettingsChangedListener } from './settings';
import ModalContainer, { create as createModal } from 'react-modal-promise';
import { SaveCodeForm } from './saveCodeForm';
import { FlowLibraryPanel } from './components/FlowLibraryPanel';
import { FlowReviewPanel } from './components/FlowReviewPanel';
import { FlowMetaPanel } from './components/FlowMetaPanel';
import { AiIntentSettingsPanel } from './components/AiIntentSettingsPanel';
import { AiUsagePanel } from './components/AiUsagePanel';
import { FlowAiIntentControl, type FlowAiIntentOverride } from './components/FlowAiIntentControl';
import type { AssertionPickedTarget } from './components/AssertionEditor';
import { StepList } from './components/StepList';
import { applyAiIntentResults } from './aiIntent/applyAiIntent';
import { generateAiIntentsForFlow, selectAiIntentSteps, testAiProviderConnection } from './aiIntent/queue';
import { createDeepSeekV4FlashProfile, normalizeAiIntentSettings, normalizeProfiles } from './aiIntent/settings';
import { clearAiUsageRecords, loadAiApiKey, loadAiIntentSettings, loadAiProviderProfiles, loadAiUsageRecords, saveAiApiKey, saveAiIntentSettings, saveAiProviderProfiles, withApiKeyPreview } from './aiIntent/storage';
import { usageRecordsToJsonl } from './aiIntent/usage';
import type { AiIntentSettings, AiProviderProfile, AiUsageRecord } from './aiIntent/types';
import { countBusinessFlowPlaybackActions, generateBusinessFlowPlaybackCode, generateBusinessFlowPlaywrightCode } from './flow/codePreview';
import { appendSyntheticPageContextStepsWithResult, createAssertion, deleteStepFromFlow, insertEmptyStepAfter, insertWaitStepAfter, mergeActionsIntoFlow, nextAssertionId, normalizeFlowStepIds, type MergeDiagnosticEvent } from './flow/flowBuilder';
import { mergePageContextIntoFlow, normalizeIntentSources } from './flow/flowContextMerger';
import { deleteRepeatSegment, upsertRepeatSegment } from './flow/repeatSegments';
import { toCompactFlow } from './flow/compactExporter';
import { prepareBusinessFlowForExport } from './flow/exportSanitizer';
import { flowStats } from './flow/display';
import { downloadText, safeFilename } from './flow/download';
import { redactBusinessFlow } from './flow/redactor';
import { deleteFlowDraft, deleteFlowRecord, listFlowRecords, loadLatestFlowDraft, saveFlowDraft, saveFlowRecord } from './flow/storage';
import type { PageContextEvent } from './flow/pageContextTypes';
import type { BusinessFlow, FlowAssertion, FlowAssertionSubject, FlowAssertionType, FlowRepeatSegment, FlowStep } from './flow/types';
import { createEmptyBusinessFlow } from './flow/types';
import './crxRecorder.css';
import './form.css';

function setElementPicked(elementInfo: ElementInfo, userGesture?: boolean) {
  window.playwrightElementPicked?.(elementInfo, userGesture);
}

function setRunningFileId(fileId: string) {
  window.playwrightSetRunningFile?.(fileId);
}

function generateDatetimeSuffix() {
  return new Date().toISOString()
      .replace(/[-:]/g, '')
      .replace(/\..+/, '')
      .replace('T', '-');
}

function formatLastSaved(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    return value || '--';
  return date.toLocaleString();
}

const codegenFilenames: Record<string, string> = {
  'javascript': 'example.js',
  'playwright-test': 'example.spec.ts',
  'java-junit': 'TestExample.java',
  'java': 'Example.java',
  'python-pytest': 'test_example.py',
  'python': 'example.py',
  'python-async': 'example.py',
  'csharp-mstest': 'Tests.cs',
  'csharp-nunit': 'Tests.cs',
  'csharp': 'Example.cs',
};

function createDraft(settings: CrxSettings, useDefaults = true) {
  return createEmptyBusinessFlow({
    flow: {
      id: `draft-${Date.now()}`,
      name: '',
      app: useDefaults ? settings.defaultApp || undefined : undefined,
      repo: useDefaults ? settings.defaultRepo || undefined : undefined,
      role: useDefaults ? settings.defaultRole || undefined : undefined,
    },
  });
}

function withPlaywrightCodeForStorage(flow: BusinessFlow, code?: string): BusinessFlow {
  return {
    ...flow,
    artifacts: {
      ...flow.artifacts,
      playwrightCode: code,
    },
    updatedAt: new Date().toISOString(),
  };
}

function withPlaywrightCodeForExport(flow: BusinessFlow, code?: string): BusinessFlow {
  return prepareBusinessFlowForExport(flow, code);
}

function requestPageContextEvents(): Promise<PageContextEvent[]> {
  return chrome.runtime.sendMessage({ event: 'pageContextEventsRequested' })
      .then(events => Array.isArray(events) ? events : [])
      .catch(() => []);
}

async function requestSettledPageContextEvents(options: { settleMs?: number; timeoutMs?: number } = {}): Promise<PageContextEvent[]> {
  const settleMs = options.settleMs ?? 220;
  const timeoutMs = options.timeoutMs ?? 1500;
  const deadline = Date.now() + timeoutMs;
  let previous = await requestPageContextEvents();
  while (Date.now() < deadline) {
    await new Promise(resolve => window.setTimeout(resolve, settleMs));
    const next = await requestPageContextEvents();
    if (pageContextEventSignature(next) === pageContextEventSignature(previous))
      return next;
    previous = next;
  }
  return previous;
}

function pageContextEventSignature(events: PageContextEvent[]) {
  return JSON.stringify(events.map(event => ({
    id: event.id,
    kind: event.kind,
    wallTime: event.wallTime,
    before: event.before,
    after: event.after,
    tabId: event.tabId,
  })));
}

function pageContextEventIds(events: PageContextEvent[]) {
  return events.map(event => event.id).join('|');
}

function cloneFlowRecord(flow: BusinessFlow): BusinessFlow {
  const now = new Date().toISOString();
  return {
    ...flow,
    flow: {
      ...flow.flow,
      id: `flow-${Date.now()}`,
      name: `${flow.flow.name || '未命名业务流程'} 副本`,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function businessFlowSources(sources: Source[], code: string): Source[] {
  const source = sources.find(source => source.id === 'playwright-test') ?? sources.find(source => source.isRecorded);
  return [{
    isRecorded: true,
    id: 'playwright-test',
    label: source?.label || 'Test Runner',
    text: code,
    language: source?.language || 'javascript',
    highlight: [],
    group: source?.group,
    header: source?.header,
    footer: source?.footer,
  }];
}

function hasEnabledAssertion(flow: BusinessFlow) {
  return flow.steps.some(step => step.assertions.some(assertion => assertion.enabled));
}

function actionCountForMergeBoundary(flow: BusinessFlow) {
  const recorderActionCount = flow.artifacts?.recorder?.actionLog.length ?? 0;
  const playbackActionCount = countBusinessFlowPlaybackActions(flow);
  const actionIndexes = [
    ...Object.values(flow.artifacts?.stepActionIndexes ?? {}),
    ...Object.values(flow.artifacts?.stepMergedActionIndexes ?? {}).flat(),
  ].filter(actionIndex => actionIndex >= 0);
  const highestActionCount = actionIndexes.length ? Math.max(...actionIndexes) + 1 : 0;
  return Math.max(flow.steps.length, recorderActionCount, playbackActionCount, highestActionCount);
}

function hasSameAssertion(assertions: FlowAssertion[], assertion: FlowAssertion) {
  const signature = assertionSignature(assertion);
  return assertions.some(existing => assertionSignature(existing) === signature);
}

function assertionSignature(assertion: FlowAssertion) {
  return JSON.stringify({
    type: assertion.type,
    subject: assertion.subject,
    expected: assertion.expected,
    params: assertion.params,
    target: assertion.target,
    note: assertion.note,
    enabled: assertion.enabled,
  });
}

function buildPickedAssertionTarget(pendingPick: PendingAssertionPick, elementInfo: ElementInfo): AssertionPickedTarget {
  return {
    stepId: pendingPick.stepId,
    subject: pendingPick.subject,
    selector: elementInfo.selector,
    label: inferPickedLabel(pendingPick.subject, elementInfo),
    ariaSnapshot: elementInfo.ariaSnapshot,
    rowKeyword: inferPickedRowKeyword(elementInfo),
  };
}

function inferPickedLabel(subject: FlowAssertionSubject, elementInfo: ElementInfo) {
  const content = `${elementInfo.selector}\n${elementInfo.ariaSnapshot}`;
  if (subject === 'table') {
    if (/ha-wan-config-table|共享\s*WAN|WAN1|WAN2/i.test(content))
      return '共享 WAN 表格';
    if (/table|grid/i.test(content))
      return '选中的表格/列表';
  }

  const testId = firstRegexGroup(elementInfo.selector, /(?:data-testid|data-test-id|data-e2e)[^=]*=["']?([^"'\]\s]+)/i);
  if (testId)
    return testId;
  return cleanupPickedText(firstRegexGroup(elementInfo.selector, /title=(?:"([^"]+)"|'([^']+)'|([^\]i]+))/i)) ||
    cleanupPickedText(firstRegexGroup(elementInfo.selector, /text=(?:"([^"]+)"|'([^']+)'|([^\]]+))/i)) ||
    elementInfo.selector;
}

function inferPickedRowKeyword(elementInfo: ElementInfo) {
  const content = `${elementInfo.selector}\n${elementInfo.ariaSnapshot}`;
  return cleanupPickedText(firstRegexGroup(content, /\b(WAN\s*\d+)\b/i))?.replace(/\s+/g, '') ||
    cleanupPickedText(firstRegexGroup(content, /title=(?:"([^"]+)"|'([^']+)'|([^\]i]+))/i));
}

function firstRegexGroup(value: string, pattern: RegExp) {
  const match = value.match(pattern);
  return match?.slice(1).find(Boolean);
}

function cleanupPickedText(value?: string) {
  return value?.replace(/\\(["'])/g, '$1').trim();
}

type PanelStage = 'library' | 'setup' | 'recording' | 'review' | 'editRecord' | 'aiSettings' | 'aiUsage';
type PanelTab = 'business' | 'code' | 'log';
type PendingAssertionPick = {
  stepId: string;
  subject: FlowAssertionSubject;
  returnMode: Mode;
};
type PendingInsertRecording = {
  anchorStepId?: string;
  afterStepId?: string;
  baseActionCount: number;
  localBaseActionCount: number;
  sessionId: string;
  appendToEnd?: boolean;
};

function recordingSessionId() {
  return `ui-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function effectivePendingBaseActionCount(pending: PendingInsertRecording, actionCount: number) {
  if (actionCount < pending.baseActionCount)
    return pending.localBaseActionCount;
  return pending.baseActionCount;
}

function shouldAdvancePendingBase(pending: PendingInsertRecording, actionCount: number) {
  if (actionCount < pending.baseActionCount)
    return actionCount > pending.localBaseActionCount;
  return actionCount > pending.baseActionCount;
}

function advancePendingBase(pending: PendingInsertRecording, actionCount: number) {
  if (actionCount < pending.baseActionCount) {
    pending.localBaseActionCount = actionCount;
    return;
  }
  pending.baseActionCount = actionCount;
  pending.localBaseActionCount = actionCount;
}

type RecorderDiagnosticLog = MergeDiagnosticEvent & {
  id: number;
  time: string;
};

const diagnosticStorageKey = 'playwright-crx:recorder-diagnostics';
const maxDiagnosticLogEntries = 2000;

function diagnosticLogsToJsonl(logs: RecorderDiagnosticLog[]) {
  return logs.map(log => JSON.stringify(log)).join('\n') + (logs.length ? '\n' : '');
}

function runtimeLogsToJsonl(logs: RecorderDiagnosticLog[]) {
  return diagnosticLogsToJsonl(logs.filter(log => log.type.startsWith('runtime.')));
}

function isRuntimeLogExpanded(entry: RecorderDiagnosticLog, expandedIds: Set<number>) {
  return expandedIds.has(entry.id);
}

function sameNumberSet(left: Set<number>, right: Set<number>) {
  if (left.size !== right.size)
    return false;
  for (const value of left) {
    if (!right.has(value))
      return false;
  }
  return true;
}

function loadPersistedDiagnosticLogs() {
  try {
    const text = window.localStorage.getItem(diagnosticStorageKey);
    if (!text)
      return [];
    return text
        .split(/\r?\n/)
        .filter(Boolean)
        .map(line => JSON.parse(line) as RecorderDiagnosticLog)
        .filter(log => typeof log.id === 'number' && typeof log.time === 'string')
        .slice(-maxDiagnosticLogEntries);
  } catch {
    return [];
  }
}

function nextDiagnosticLogId(logs: RecorderDiagnosticLog[]) {
  return logs.reduce((max, log) => Math.max(max, log.id), 0) + 1;
}

function formatDiagnosticData(data?: Record<string, unknown>) {
  if (!data)
    return '';
  return JSON.stringify(data, null, 2);
}

function cloneDiagnosticData(data?: Record<string, unknown>) {
  if (!data)
    return undefined;
  try {
    if (typeof structuredClone === 'function')
      return structuredClone(data) as Record<string, unknown>;
  } catch {
  }
  try {
    return JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  } catch {
    return { snapshot: String(data) };
  }
}

function runtimeDispatchDiagnostic(data: any): MergeDiagnosticEvent | undefined {
  const event = data?.event;
  if (!['resume', 'step', 'pause', 'businessFlowCodeChanged'].includes(event))
    return undefined;
  const code = typeof data?.params?.code === 'string' ? data.params.code : undefined;
  return {
    type: `runtime.ui-dispatch.${event}`,
    message: event === 'businessFlowCodeChanged' ? 'Side panel 已发送业务流程 Playwright 代码' : `Side panel 已发送 ${event} 运行事件`,
    data: {
      event,
      codeLength: code?.length ?? 0,
      lineCount: code ? code.split(/\r?\n/).length : 0,
      containsWaitForTimeout: code?.includes('waitForTimeout') ?? false,
    },
  };
}

function pageContextEventLabel(event: PageContextEvent) {
  const target = event.before.target;
  return [event.kind, target?.testId || target?.text || target?.ariaLabel || target?.placeholder || event.before.dialog?.title].filter(Boolean).join(' · ');
}

function exposeDiagnosticLogs(logs: RecorderDiagnosticLog[]) {
  const targetWindow = window as typeof window & {
    __playwrightCrxRecorderDiagnostics?: RecorderDiagnosticLog[];
  };
  targetWindow.__playwrightCrxRecorderDiagnostics = logs;
  try {
    window.localStorage.setItem(diagnosticStorageKey, diagnosticLogsToJsonl(logs.slice(-maxDiagnosticLogEntries)));
  } catch {
  }
}

export const CrxRecorder: React.FC = ({
}) => {
  const [settings, setSettings] = React.useState<CrxSettings>(defaultSettings);
  const [sources, setSources] = React.useState<Source[]>([]);
  const [paused, setPaused] = React.useState(false);
  const [log, setLog] = React.useState(new Map<string, CallLog>());
  const [mode, setMode] = React.useState<Mode>('none');
  const [selectedFileId, setSelectedFileId] = React.useState<string>(defaultSettings.targetLanguage);
  const [flowDraft, setFlowDraft] = React.useState<BusinessFlow>(() => createDraft(defaultSettings));
  const [flowRecords, setFlowRecords] = React.useState<BusinessFlow[]>([]);
  const [selectedRecordId, setSelectedRecordId] = React.useState<string>();
  const [draftReady, setDraftReady] = React.useState(false);
  const [draftStatus, setDraftStatus] = React.useState('正在加载草稿');
  const [recordStatus, setRecordStatus] = React.useState('');
  const [recordedActionCount, setRecordedActionCount] = React.useState(0);
  const [panelStage, setPanelStage] = React.useState<PanelStage>('library');
  const [activeTab, setActiveTab] = React.useState<PanelTab>('business');
  const [expandedRuntimeLogIds, setExpandedRuntimeLogIds] = React.useState<Set<number>>(() => new Set());
  const [editingAssertionStepId, setEditingAssertionStepId] = React.useState<string>();
  const [pickedAssertionTarget, setPickedAssertionTarget] = React.useState<AssertionPickedTarget>();
  const [pickingAssertionStepId, setPickingAssertionStepId] = React.useState<string>();
  const [suppressDefaultMeta, setSuppressDefaultMeta] = React.useState(false);
  const [insertRecordingAfterStepId, setInsertRecordingAfterStepId] = React.useState<string>();
  const [aiSettings, setAiSettings] = React.useState<AiIntentSettings>(() => normalizeAiIntentSettings());
  const [aiProfiles, setAiProfiles] = React.useState<AiProviderProfile[]>(() => [createDeepSeekV4FlashProfile()]);
  const [activeAiApiKey, setActiveAiApiKey] = React.useState('');
  const [aiUsageRecords, setAiUsageRecords] = React.useState<AiUsageRecord[]>([]);
  const [aiStatus, setAiStatus] = React.useState('');
  const [aiGenerating, setAiGenerating] = React.useState(false);
  const [aiPendingStepIds, setAiPendingStepIds] = React.useState<Set<string>>(() => new Set());
  const [diagnosticLogs, setDiagnosticLogs] = React.useState<RecorderDiagnosticLog[]>(() => loadPersistedDiagnosticLogs());
  const flowDraftRef = React.useRef<BusinessFlow>(flowDraft);
  const pendingAssertionPickRef = React.useRef<PendingAssertionPick>();
  const pendingInsertRecordingRef = React.useRef<PendingInsertRecording>();
  const aiAutoTimerRef = React.useRef<number>();
  const diagnosticLogIdRef = React.useRef(nextDiagnosticLogId(diagnosticLogs));
  const lastDiagnosticContextEventIdRef = React.useRef<string>();
  const scheduledSyntheticContextEventIdsRef = React.useRef<Set<string>>(new Set());
  const pendingSyntheticClickEventsRef = React.useRef<PageContextEvent[]>([]);
  const syntheticFlushTimerRef = React.useRef<number>();
  const businessFlowPlaybackCodeRef = React.useRef('');
  const businessFlowEnabledRef = React.useRef(defaultSettings.businessFlowEnabled !== false);

  React.useEffect(() => {
    businessFlowEnabledRef.current = settings.businessFlowEnabled !== false;
  }, [settings.businessFlowEnabled]);

  React.useEffect(() => {
    flowDraftRef.current = flowDraft;
  }, [flowDraft]);

  const appendDiagnosticLog = React.useCallback((event: MergeDiagnosticEvent) => {
    const entry: RecorderDiagnosticLog = {
      id: diagnosticLogIdRef.current++,
      time: new Date().toISOString(),
      ...event,
      data: cloneDiagnosticData(event.data),
    };
    setDiagnosticLogs(logs => {
      const next = [...logs, entry].slice(-maxDiagnosticLogEntries);
      exposeDiagnosticLogs(next);
      return next;
    });
  }, []);

  React.useEffect(() => {
    exposeDiagnosticLogs(diagnosticLogs);
  }, [diagnosticLogs]);

  const applyPageContextEventsToDraft = React.useCallback((events: PageContextEvent[]) => {
    if (!events.length)
      return flowDraftRef.current;
    const pendingRecording = pendingInsertRecordingRef.current;
    const withContext = mergePageContextIntoFlow(flowDraftRef.current, events);
    const lastStepId = withContext.steps[withContext.steps.length - 1]?.id;
    const insertAfterStepId = pendingRecording?.appendToEnd ? lastStepId : pendingRecording?.afterStepId;
    const result = appendSyntheticPageContextStepsWithResult(withContext, events, {
      insertAfterStepId,
      diagnostics: appendDiagnosticLog,
    });
    if (pendingRecording && !pendingRecording.appendToEnd && result.insertedStepIds.length) {
      pendingRecording.afterStepId = result.insertedStepIds[result.insertedStepIds.length - 1];
      setInsertRecordingAfterStepId(pendingRecording.afterStepId);
      appendDiagnosticLog({
        type: 'ui.recording-insert-cursor-advance',
        message: '页面侧补录步骤后推进插入 cursor',
        data: {
          anchorStepId: pendingRecording.anchorStepId,
          cursorStepId: pendingRecording.afterStepId,
          insertedStepIds: result.insertedStepIds,
        },
      });
    }
    flowDraftRef.current = result.flow;
    setFlowDraft(result.flow);
    return result.flow;
  }, [appendDiagnosticLog]);

  const queueSyntheticClickEvent = React.useCallback((event: PageContextEvent) => {
    const existingIndex = pendingSyntheticClickEventsRef.current.findIndex(existing => existing.id === event.id);
    if (existingIndex >= 0)
      pendingSyntheticClickEventsRef.current[existingIndex] = event;
    else
      pendingSyntheticClickEventsRef.current.push(event);
    if (syntheticFlushTimerRef.current)
      return;

    syntheticFlushTimerRef.current = window.setTimeout(() => {
      syntheticFlushTimerRef.current = undefined;
      const events = pendingSyntheticClickEventsRef.current;
      pendingSyntheticClickEventsRef.current = [];
      if (!events.length)
        return;

      applyPageContextEventsToDraft(events);
    }, 1800);
  }, [applyPageContextEventsToDraft]);

  const flushPageContextEventsNow = React.useCallback(async () => {
    if (syntheticFlushTimerRef.current) {
      window.clearTimeout(syntheticFlushTimerRef.current);
      syntheticFlushTimerRef.current = undefined;
    }

    const queuedEventsBeforeSettle = pendingSyntheticClickEventsRef.current;
    pendingSyntheticClickEventsRef.current = [];
    // pageContextSidecar intentionally delays click context by 160ms so it can include
    // post-click overlay/toast state. Stop/export must drain that product pipeline,
    // otherwise table rowKey / AntD option context can miss the final flow export.
    const requestedEvents = await requestSettledPageContextEvents();
    const requestedEventsById = new Map(requestedEvents.map(event => [event.id, event]));
    const queuedEventsAfterSettle = pendingSyntheticClickEventsRef.current;
    pendingSyntheticClickEventsRef.current = [];
    const lastKnownContextEventId = lastDiagnosticContextEventIdRef.current;
    const lastKnownIndex = lastKnownContextEventId ? requestedEvents.findIndex(event => event.id === lastKnownContextEventId) : -1;
    const newRequestedEvents = lastKnownContextEventId ? (lastKnownIndex >= 0 ? requestedEvents.slice(lastKnownIndex + 1) : requestedEvents) : requestedEvents;
    const eventsById = new Map<string, PageContextEvent>();
    for (const event of [...queuedEventsBeforeSettle, ...queuedEventsAfterSettle]) {
      const latestEvent = requestedEventsById.get(event.id) || event;
      eventsById.set(latestEvent.id, latestEvent);
      if (latestEvent.kind === 'click' && latestEvent.wallTime)
        scheduledSyntheticContextEventIdsRef.current.add(latestEvent.id);
    }
    for (const event of newRequestedEvents) {
      eventsById.set(event.id, event);
      if (event.kind === 'click' && event.wallTime)
        scheduledSyntheticContextEventIdsRef.current.add(event.id);
    }
    const events = [...eventsById.values()];
    if (events.length)
      lastDiagnosticContextEventIdRef.current = events[events.length - 1]?.id;
    return applyPageContextEventsToDraft(events);
  }, [applyPageContextEventsToDraft]);

  React.useEffect(() => {
    return () => {
      if (syntheticFlushTimerRef.current)
        window.clearTimeout(syntheticFlushTimerRef.current);
    };
  }, []);

  React.useEffect(() => {
    let disposed = false;
    let port: chrome.runtime.Port | undefined;
    let portConnected = false;
    let reconnectTimer: number | undefined;

    const onMessage = (msg: any) => {
      if (!('type' in msg) || msg.type !== 'recorder')
        return;

      switch (msg.method) {
        case 'setPaused': setPaused(msg.paused); break;
        case 'setMode': setMode(msg.mode); break;
        case 'setSources': setSources(msg.sources); break;
        case 'setActions': {
          const actions = Array.isArray(msg.actions) ? msg.actions : [];
          const sources = Array.isArray(msg.sources) ? msg.sources : [];
          appendDiagnosticLog({
            type: 'recorder.setActions',
            message: 'Side panel 收到 recorder setActions',
            data: {
              actionCount: actions.length,
              sourceCount: sources.length,
              pendingInsert: pendingInsertRecordingRef.current,
              sourceIds: sources.map((source: Source) => source.id).filter(Boolean),
            },
          });
          setRecordedActionCount(actions.length);
          setSources(sources);
          const pendingRecording = pendingInsertRecordingRef.current;
          const effectiveInsertBaseActionCount = pendingRecording ? effectivePendingBaseActionCount(pendingRecording, actions.length) : undefined;
          const mergeOptions = {
            insertAfterStepId: pendingInsertRecordingRef.current?.afterStepId,
            insertBaseActionCount: effectiveInsertBaseActionCount,
            appendNewActions: pendingInsertRecordingRef.current?.appendToEnd,
            recordingSessionId: pendingInsertRecordingRef.current?.sessionId,
            diagnostics: appendDiagnosticLog,
          };
          setFlowDraft(flow => {
            const previousStepIds = new Set(flow.steps.map(step => step.id));
            const nextFlow = mergeActionsIntoFlow(flow, actions, sources, mergeOptions);
            const insertedStepIds = nextFlow.steps.filter(step => !previousStepIds.has(step.id)).map(step => step.id);
            appendDiagnosticLog({
              type: insertedStepIds.length ? 'ui.steps-added' : 'ui.no-steps-added',
              level: insertedStepIds.length ? 'info' : 'warn',
              message: insertedStepIds.length ? `新增 ${insertedStepIds.length} 个业务步骤` : '本次 recorder payload 没有让右侧新增步骤',
              data: {
                beforeStepCount: flow.steps.length,
                afterStepCount: nextFlow.steps.length,
                insertedStepIds,
                actionCount: actions.length,
                pendingBaseActionCount: pendingRecording?.baseActionCount,
                pendingLocalBaseActionCount: pendingRecording?.localBaseActionCount,
                effectiveInsertBaseActionCount,
              },
            });
            flowDraftRef.current = nextFlow;
            if (pendingRecording && shouldAdvancePendingBase(pendingRecording, actions.length)) {
              advancePendingBase(pendingRecording, actions.length);
              if (pendingRecording.afterStepId && insertedStepIds.length) {
                pendingRecording.afterStepId = insertedStepIds[insertedStepIds.length - 1];
                setInsertRecordingAfterStepId(pendingRecording.afterStepId);
              }
            }
            return nextFlow;
          });
          if (actions.length) {
            window.setTimeout(() => {
              requestPageContextEvents().then(contextEvents => {
                if (contextEvents.length) {
                  setFlowDraft(flow => {
                    const nextFlow = mergePageContextIntoFlow(flow, contextEvents);
                    flowDraftRef.current = nextFlow;
                    return nextFlow;
                  });
                }
              }).catch(() => {});
            }, 250);
          }
          if (actions.length)
            setPanelStage(stage => stage === 'setup' ? 'recording' : stage);
          break;
        }
        case 'resetCallLogs': setLog(new Map()); break;
        case 'updateCallLogs': setLog(log => {
          const newLog = new Map<string, CallLog>(log);
          for (const callLog of msg.callLogs) {
            callLog.reveal = !log.has(callLog.id);
            newLog.set(callLog.id, callLog);
          }
          return newLog;
        }); break;
        case 'runtimeEvent':
          appendDiagnosticLog({
            type: msg.event?.type ?? 'runtime.event',
            level: msg.event?.level,
            message: msg.event?.message ?? 'Playwright runtime event',
            data: msg.event?.data,
          });
          break;
        case 'setRunningFile': setRunningFileId(msg.file); break;
        case 'elementPicked': {
          const pendingPick = pendingAssertionPickRef.current;
          if (pendingPick && msg.elementInfo?.selector) {
            pendingAssertionPickRef.current = undefined;
            setPickingAssertionStepId(undefined);
            setPickedAssertionTarget(buildPickedAssertionTarget(pendingPick, msg.elementInfo));
            window.dispatch({ event: 'setMode', params: { mode: pendingPick.returnMode } }).catch(() => {});
          }
          setElementPicked(msg.elementInfo, msg.userGesture);
          break;
        }
      }
    };

    const connectRecorderPort = () => {
      if (disposed)
        return;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      try {
        port = chrome.runtime.connect({ name: 'recorder' });
        portConnected = true;
        port.onMessage.addListener(onMessage);
        port.onDisconnect.addListener(() => {
          portConnected = false;
          if (disposed)
            return;
          appendDiagnosticLog({
            type: 'runtime.port-disconnected',
            level: 'warn',
            message: 'Side panel 与 recorder app 的运行通道已断开，准备重连',
            data: { reason: chrome.runtime.lastError?.message },
          });
          if (!disposed)
            reconnectTimer = window.setTimeout(connectRecorderPort, 200);
        });
        appendDiagnosticLog({
          type: 'runtime.port-connected',
          message: 'Side panel 已连接 recorder app 运行通道',
          data: { portName: port.name },
        });
      } catch (error: any) {
        portConnected = false;
        appendDiagnosticLog({
          type: 'runtime.port-connect-error',
          level: 'warn',
          message: 'Side panel 连接 recorder app 运行通道失败',
          data: { message: error?.message ?? String(error) },
        });
      }
    };

    const postRecorderEvent = (data: any) => {
      if (!portConnected || !port)
        connectRecorderPort();
      if (!port) {
        appendDiagnosticLog({
          type: 'runtime.port-post-error',
          level: 'warn',
          message: 'Side panel 发送运行事件失败',
          data: {
            event: data?.event,
            message: 'recorder app 运行通道未连接',
          },
        });
        return false;
      }
      try {
        port.postMessage({ type: 'recorderEvent', ...data });
        const runtimeEvent = runtimeDispatchDiagnostic(data);
        if (runtimeEvent) {
          appendDiagnosticLog({
            ...runtimeEvent,
            type: `${runtimeEvent.type}.posted`,
            message: `${runtimeEvent.message}（已投递到 recorder app）`,
            data: {
              ...runtimeEvent.data,
              portConnected,
            },
          });
        }
        return true;
      } catch (error: any) {
        portConnected = false;
        appendDiagnosticLog({
          type: 'runtime.port-post-error',
          level: 'warn',
          message: 'Side panel 发送运行事件失败',
          data: {
            event: data?.event,
            message: error?.message ?? String(error),
          },
        });
        connectRecorderPort();
        return false;
      }
    };

    connectRecorderPort();

    window.dispatch = async (data: any) => {
      const runtimeEvent = runtimeDispatchDiagnostic(data);
      if (runtimeEvent)
        appendDiagnosticLog(runtimeEvent);
      if ((data.event === 'resume' || data.event === 'step') && businessFlowEnabledRef.current && businessFlowPlaybackCodeRef.current) {
        postRecorderEvent({
          event: 'businessFlowCodeChanged',
          params: { code: businessFlowPlaybackCodeRef.current },
        });
      }
      postRecorderEvent(data);
      if (data.event === 'fileChanged')
        setSelectedFileId(data.params.file);
    };
    loadSettings().then(settings => {
      setSettings(settings);
      setSelectedFileId(settings.targetLanguage);
    }).catch(() => {});

    addSettingsChangedListener(setSettings);

    return () => {
      disposed = true;
      if (reconnectTimer)
        window.clearTimeout(reconnectTimer);
      removeSettingsChangedListener(setSettings);
      try {
        port?.disconnect();
      } catch {
      }
    };
  }, [appendDiagnosticLog]);

  React.useEffect(() => {
    if (panelStage !== 'recording')
      return;

    let disposed = false;
    requestPageContextEvents().then(events => {
      if (!disposed)
        lastDiagnosticContextEventIdRef.current = events[events.length - 1]?.id;
    }).catch(() => {});

    const interval = window.setInterval(() => {
      requestPageContextEvents().then(events => {
        if (disposed || !events.length)
          return;
        const lastId = lastDiagnosticContextEventIdRef.current;
        const lastIndex = lastId ? events.findIndex(event => event.id === lastId) : events.length - 1;
        const newEvents = lastIndex >= 0 ? events.slice(lastIndex + 1) : events.slice(-3);
        lastDiagnosticContextEventIdRef.current = events[events.length - 1]?.id;
        for (const event of newEvents) {
          appendDiagnosticLog({
            type: 'page.context-event',
            message: `页面侧捕获 ${pageContextEventLabel(event) || event.kind}`,
            data: {
              id: event.id,
              kind: event.kind,
              wallTime: event.wallTime,
              url: event.before.url,
              dialog: event.before.dialog?.title,
              target: event.before.target,
            },
          });
          if (event.kind === 'click' && event.wallTime && !scheduledSyntheticContextEventIdsRef.current.has(event.id)) {
            scheduledSyntheticContextEventIdsRef.current.add(event.id);
            queueSyntheticClickEvent(event);
          }
        }
      }).catch(() => {});
    }, 1000);

    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [appendDiagnosticLog, panelStage, queueSyntheticClickEvent]);

  const refreshFlowRecords = React.useCallback(() => {
    return listFlowRecords()
        .then(records => {
          setFlowRecords(records);
          return records;
        })
        .catch(() => {
          setRecordStatus('流程记录读取失败');
          return [];
        });
  }, []);

  React.useEffect(() => {
    let disposed = false;
    refreshFlowRecords().then(() => {
      if (!disposed)
        setRecordStatus('流程库已加载');
    });
    return () => {
      disposed = true;
    };
  }, [refreshFlowRecords]);

  React.useEffect(() => {
    let disposed = false;
    Promise.all([
      loadAiIntentSettings(),
      loadAiProviderProfiles(),
      loadAiUsageRecords(),
    ]).then(async ([storedSettings, storedProfiles, records]) => {
      if (disposed)
        return;
      const profilesWithPreview = await Promise.all(storedProfiles.map(async profile => withApiKeyPreview(profile, await loadAiApiKey(profile))));
      if (disposed)
        return;
      setAiSettings(storedSettings);
      setAiProfiles(profilesWithPreview);
      setAiUsageRecords(records);
    }).catch(() => setAiStatus('AI Intent 设置读取失败'));
    return () => {
      disposed = true;
    };
  }, []);

  React.useEffect(() => {
    let disposed = false;
    loadLatestFlowDraft()
        .then(draft => {
          if (disposed)
            return;
          if (draft) {
            const normalizedDraft = normalizeIntentSources(normalizeFlowStepIds(draft));
            setFlowDraft(normalizedDraft);
            setDraftStatus(`已恢复草稿 ${new Date(normalizedDraft.updatedAt).toLocaleTimeString()}`);
          } else {
            setDraftStatus('暂无草稿');
          }
        })
        .catch(() => {
          if (!disposed)
            setDraftStatus('草稿恢复失败');
        })
        .finally(() => {
          if (!disposed)
            setDraftReady(true);
        });
    return () => {
      disposed = true;
    };
  }, []);

  React.useEffect(() => {
    if (!draftReady || suppressDefaultMeta)
      return;

    setFlowDraft(flow => ({
      ...flow,
      flow: {
        ...flow.flow,
        app: flow.flow.app || settings.defaultApp || undefined,
        repo: flow.flow.repo || settings.defaultRepo || undefined,
        role: flow.flow.role || settings.defaultRole || undefined,
      },
    }));
  }, [draftReady, settings.defaultApp, settings.defaultRepo, settings.defaultRole, suppressDefaultMeta]);

  React.useEffect(() => {
    if (!draftReady || !settings.businessFlowEnabled)
      return;

    setDraftStatus('正在保存草稿');
    const timeout = window.setTimeout(() => {
      saveFlowDraft(flowDraft)
          .then(() => setDraftStatus(`草稿已保存 ${new Date().toLocaleTimeString()}`))
          .catch(() => setDraftStatus('草稿保存失败'));
    }, 1000);

    return () => window.clearTimeout(timeout);
  }, [draftReady, flowDraft, settings.businessFlowEnabled]);

  const source = React.useMemo(() => sources.find(s => s.id === selectedFileId), [sources, selectedFileId]);
  const activeAiProfile = React.useMemo(() => aiProfiles.find(profile => profile.id === aiSettings.activeProfileId) ?? aiProfiles[0], [aiProfiles, aiSettings.activeProfileId]);
  const effectiveAiIntentEnabled = React.useMemo(() => {
    const override = flowDraft.artifacts?.aiIntent?.override ?? 'inherit';
    return aiSettings.enabled && override !== 'disabled' && !!activeAiProfile && !!activeAiApiKey.trim();
  }, [activeAiApiKey, activeAiProfile, aiSettings.enabled, flowDraft.artifacts?.aiIntent?.override]);
  const businessFlowCode = React.useMemo(() => generateBusinessFlowPlaywrightCode(flowDraft), [flowDraft]);
  const businessFlowPlaybackCode = React.useMemo(() => generateBusinessFlowPlaybackCode(flowDraft), [flowDraft]);
  const generatedBusinessSources = React.useMemo(() => businessFlowSources(sources, businessFlowCode), [businessFlowCode, sources]);
  const currentCodeText = settings.businessFlowEnabled === false ? source?.text : businessFlowCode;

  React.useEffect(() => {
    businessFlowPlaybackCodeRef.current = businessFlowPlaybackCode;
  }, [businessFlowPlaybackCode]);

  React.useEffect(() => {
    if (!activeAiProfile) {
      setActiveAiApiKey('');
      return;
    }
    let disposed = false;
    loadAiApiKey(activeAiProfile).then(apiKey => {
      if (!disposed)
        setActiveAiApiKey(apiKey);
    }).catch(() => {
      if (!disposed)
        setActiveAiApiKey('');
    });
    return () => {
      disposed = true;
    };
  }, [activeAiProfile]);

  React.useEffect(() => {
    if (settings.businessFlowEnabled === false || panelStage === 'setup' || panelStage === 'library' || panelStage === 'editRecord')
      return;
    setSelectedFileId('playwright-test');
    window.dispatch({ event: 'fileChanged', params: { file: 'playwright-test' } }).catch(() => {});
    window.dispatch({ event: 'businessFlowCodeChanged', params: { code: businessFlowPlaybackCode } }).catch(() => {});
  }, [businessFlowPlaybackCode, panelStage, settings.businessFlowEnabled]);

  const requestStorageState = React.useCallback(() => {
    if (!settings.experimental)
      return;

    chrome.runtime.sendMessage({ event: 'storageStateRequested' }).then(storageState => {
      const fileSuffix = generateDatetimeSuffix();
      downloadText(`storageState-${fileSuffix}.json`, JSON.stringify(storageState, null, 2), 'application/json');
    });
  }, [settings]);

  const showPreferences = React.useCallback(() => {
    const modal = createModal(({ isOpen, onResolve }) =>
      <Dialog title='Preferences' isOpen={isOpen} onClose={onResolve}>
        <PreferencesForm />
      </Dialog>
    );
    modal().catch(() => {});
  }, []);

  const saveCode = React.useCallback(() => {
    if (!settings.experimental)
      return;

    const modal = createModal(({ isOpen, onResolve, onReject }) => {
      return <Dialog title='Save code' isOpen={isOpen} onClose={onReject}>
        <SaveCodeForm onSubmit={onResolve} suggestedFilename={codegenFilenames[selectedFileId]} />
      </Dialog>;
    });
    modal()
        .then(({ filename }) => {
          const code = currentCodeText;
          if (!code)
            return;

          downloadText(filename, code);
        })
        .catch(() => {});
  }, [currentCodeText, settings, selectedFileId]);

  React.useEffect(() => {
    if (!settings.experimental)
      return;

    const keydownHandler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        saveCode();
      }
    };
    window.addEventListener('keydown', keydownHandler);

    return () => {
      window.removeEventListener('keydown', keydownHandler);
    };
  }, [selectedFileId, settings, saveCode]);

  const dispatchEditedCode = React.useCallback((code: string) => {
    window.dispatch({ event: settings.businessFlowEnabled === false ? 'codeChanged' : 'businessFlowCodeChanged', params: { code } });
  }, [settings.businessFlowEnabled]);

  const dispatchCursorActivity = React.useCallback((position: { line: number }) => {
    window.dispatch({ event: 'cursorActivity', params: { position } });
  }, []);

  const updateFlowDraft = React.useCallback((flow: BusinessFlow) => {
    setFlowDraft(flow);
  }, []);

  const saveCurrentRecord = React.useCallback(() => {
    if (!flowDraft.flow.name.trim()) {
      window.alert('请先填写流程名称。');
      return Promise.resolve(false);
    }
    const savedFlow = withPlaywrightCodeForStorage(flowDraft, currentCodeText);
    setFlowDraft(savedFlow);
    setSelectedRecordId(savedFlow.flow.id);
    setRecordStatus('正在保存流程记录');
    return saveFlowRecord(savedFlow)
        .then(() => refreshFlowRecords())
        .then(() => {
          setRecordStatus(`流程记录已保存 ${new Date().toLocaleTimeString()}`);
          return true;
        })
        .catch(() => {
          setRecordStatus('流程记录保存失败');
          window.alert('流程记录保存失败。');
          return false;
        });
  }, [currentCodeText, flowDraft, refreshFlowRecords]);

  const goToLibrary = React.useCallback(() => {
    pendingInsertRecordingRef.current = undefined;
    setInsertRecordingAfterStepId(undefined);
    setPanelStage('library');
    setActiveTab('business');
    window.dispatch({ event: 'setMode', params: { mode: 'standby' } }).catch(() => {});
    refreshFlowRecords();
  }, [refreshFlowRecords]);

  const beginNewFlow = React.useCallback(() => {
    const emptyDraft = createDraft(settings, false);
    pendingAssertionPickRef.current = undefined;
    pendingInsertRecordingRef.current = undefined;
    setInsertRecordingAfterStepId(undefined);
    setFlowDraft(emptyDraft);
    setSelectedRecordId(undefined);
    setRecordedActionCount(0);
    setSources([]);
    setLog(new Map());
    setPickedAssertionTarget(undefined);
    setPickingAssertionStepId(undefined);
    setEditingAssertionStepId(undefined);
    setActiveTab('business');
    setPanelStage('setup');
    setDraftStatus('正在创建新流程');
    window.dispatch({ event: 'setMode', params: { mode: 'standby' } }).catch(() => {});
    window.dispatch({ event: 'clear', params: {} }).catch(() => {});
    window.dispatch({ event: 'businessFlowCodeChanged', params: { code: null } }).catch(() => {});
  }, [settings]);

  const openRecord = React.useCallback((flow: BusinessFlow) => {
    const normalized = normalizeIntentSources(normalizeFlowStepIds(flow));
    setFlowDraft(normalized);
    setSelectedRecordId(normalized.flow.id);
    setSuppressDefaultMeta(true);
    setActiveTab('business');
    setPanelStage(normalized.steps.length ? 'review' : 'editRecord');
    setDraftStatus(`已打开记录 ${new Date(normalized.updatedAt).toLocaleTimeString()}`);
    window.dispatch({ event: 'setMode', params: { mode: 'standby' } }).catch(() => {});
  }, []);

  const editRecord = React.useCallback((flow: BusinessFlow) => {
    const normalized = normalizeIntentSources(normalizeFlowStepIds(flow));
    setFlowDraft(normalized);
    setSelectedRecordId(normalized.flow.id);
    setSuppressDefaultMeta(true);
    setActiveTab('business');
    setPanelStage('editRecord');
    setDraftStatus(`正在编辑记录 ${new Date(normalized.updatedAt).toLocaleTimeString()}`);
    window.dispatch({ event: 'setMode', params: { mode: 'standby' } }).catch(() => {});
  }, []);

  const duplicateRecord = React.useCallback((flow: BusinessFlow) => {
    const duplicated = cloneFlowRecord(flow);
    saveFlowRecord(duplicated)
        .then(() => refreshFlowRecords())
        .then(() => {
          setRecordStatus(`已复制：${duplicated.flow.name}`);
          openRecord(duplicated);
        })
        .catch(() => {
          setRecordStatus('复制流程记录失败');
          window.alert('复制流程记录失败。');
        });
  }, [openRecord, refreshFlowRecords]);

  const deleteRecord = React.useCallback((flow: BusinessFlow) => {
    Promise.all([
      deleteFlowRecord(flow.flow.id),
      deleteFlowDraft(flow.flow.id).catch(() => {}),
    ])
        .then(() => refreshFlowRecords())
        .then(() => {
          if (selectedRecordId === flow.flow.id) {
            const emptyDraft = createDraft(settings, false);
            setFlowDraft(emptyDraft);
            setSelectedRecordId(undefined);
            setPanelStage('library');
            setActiveTab('business');
          }
          setRecordStatus(`已删除：${flow.flow.name || '未命名业务流程'}`);
        })
        .catch(() => {
          setRecordStatus('删除流程记录失败');
          window.alert('删除流程记录失败。');
        });
  }, [refreshFlowRecords, selectedRecordId, settings]);

  const restoreRecord = React.useCallback((flow: BusinessFlow) => {
    saveFlowRecord(flow)
        .then(() => refreshFlowRecords())
        .then(() => setRecordStatus(`已恢复：${flow.flow.name || '未命名业务流程'}`))
        .catch(() => {
          setRecordStatus('恢复流程记录失败');
          window.alert('恢复流程记录失败。');
        });
  }, [refreshFlowRecords]);

  const importRecord = React.useCallback((file: File) => {
    file.text()
        .then(text => {
          const parsed = JSON.parse(text) as BusinessFlow;
          if (parsed.schema !== 'business-flow/v1' || !parsed.flow)
            throw new Error('Invalid business flow');
          const imported = normalizeIntentSources(normalizeFlowStepIds(createEmptyBusinessFlow({
            ...parsed,
            flow: {
              ...parsed.flow,
              id: parsed.flow.id || `flow-${Date.now()}`,
            },
          })));
          return saveFlowRecord(imported).then(() => imported);
        })
        .then(imported => refreshFlowRecords().then(() => openRecord(imported)))
        .then(() => setRecordStatus(`已导入：${file.name}`))
        .catch(() => {
          setRecordStatus('导入 JSON 失败');
          window.alert('导入 JSON 失败，请确认文件是 business-flow/v1。');
        });
  }, [openRecord, refreshFlowRecords]);

  const exportAllRecords = React.useCallback(() => {
    const exportFlows = flowRecords.map(flow => withPlaywrightCodeForExport(flow, flow.artifacts?.playwrightCode));
    const flows = settings.redactSensitiveData === false ? exportFlows : exportFlows.map(flow => redactBusinessFlow(flow));
    downloadText(`business-flow-records-${generateDatetimeSuffix()}.json`, JSON.stringify(flows, null, 2), 'application/json');
  }, [flowRecords, settings.redactSensitiveData]);

  const saveDraftNow = React.useCallback(() => {
    saveFlowDraft(flowDraft)
        .then(() => setDraftStatus(`草稿已保存 ${new Date().toLocaleTimeString()}`))
        .catch(() => {
          setDraftStatus('草稿保存失败');
          window.alert('草稿保存失败。');
        });
  }, [flowDraft]);

  const updateStep = React.useCallback((stepId: string, patch: Partial<FlowStep>) => {
    setFlowDraft(flow => ({
      ...flow,
      steps: flow.steps.map(step => step.id === stepId ? { ...step, ...patch } : step),
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const updateAiSettings = React.useCallback((nextSettings: AiIntentSettings) => {
    const normalized = normalizeAiIntentSettings(nextSettings);
    setAiSettings(normalized);
    saveAiIntentSettings(normalized).catch(() => setAiStatus('AI Intent 设置保存失败'));
  }, []);

  const updateAiProfiles = React.useCallback((nextProfiles: AiProviderProfile[]) => {
    const normalized = normalizeProfiles(nextProfiles);
    setAiProfiles(normalized);
    saveAiProviderProfiles(normalized).catch(() => setAiStatus('AI Profile 保存失败'));
  }, []);

  const updateActiveAiApiKey = React.useCallback((apiKey: string) => {
    setActiveAiApiKey(apiKey);
    if (!activeAiProfile)
      return;
    saveAiApiKey(activeAiProfile, apiKey)
        .then(() => {
          const profileWithPreview = withApiKeyPreview(activeAiProfile, apiKey);
          setAiProfiles(profiles => profiles.map(profile => profile.id === activeAiProfile.id ? profileWithPreview : profile));
          saveAiProviderProfiles(aiProfiles.map(profile => profile.id === activeAiProfile.id ? profileWithPreview : profile)).catch(() => {});
        })
        .catch(() => setAiStatus('API key 保存失败'));
  }, [activeAiProfile, aiProfiles]);

  const refreshAiUsageRecords = React.useCallback(() => {
    return loadAiUsageRecords().then(setAiUsageRecords).catch(() => setAiStatus('AI 用量读取失败'));
  }, []);

  const runAiGeneration = React.useCallback((stepIds?: string[], usageMode: AiUsageRecord['mode'] = stepIds?.length === 1 ? 'single' : 'batch') => {
    if (!activeAiProfile) {
      setAiStatus('请先创建 AI Provider Profile');
      return;
    }
    if (!aiSettings.enabled) {
      setAiStatus('请先在流程库启用 AI Intent 全局开关');
      return;
    }
    if ((flowDraft.artifacts?.aiIntent?.override ?? 'inherit') === 'disabled') {
      setAiStatus('当前流程已关闭 AI Intent');
      return;
    }
    if (!activeAiApiKey.trim()) {
      setAiStatus('请先输入 API key');
      return;
    }
    const pendingIds = stepIds ?? selectAiIntentSteps(flowDraft, aiSettings.mode).map(step => step.id);
    if (!pendingIds.length) {
      setAiStatus('没有需要生成 AI 业务意图的步骤');
      return;
    }

    setAiGenerating(true);
    setAiPendingStepIds(current => new Set([...current, ...pendingIds]));
    setAiStatus(`AI 正在处理 ${pendingIds.length} 个步骤`);
    generateAiIntentsForFlow({
      flow: flowDraft,
      settings: aiSettings,
      profile: activeAiProfile,
      apiKey: activeAiApiKey,
      stepIds: pendingIds,
      mode: usageMode,
    }).then(({ results }) => {
      setFlowDraft(flow => applyAiIntentResults(flow, results));
      setAiStatus(results.length ? `AI 已生成 ${results.length} 个业务意图` : 'AI 未返回可用业务意图，请查看用量记录中的错误');
      refreshAiUsageRecords();
    }).catch(error => {
      setAiStatus(error instanceof Error ? error.message : String(error));
      refreshAiUsageRecords();
    }).finally(() => {
      setAiGenerating(false);
      setAiPendingStepIds(current => {
        const next = new Set(current);
        for (const stepId of pendingIds)
          next.delete(stepId);
        return next;
      });
    });
  }, [activeAiApiKey, activeAiProfile, aiSettings, flowDraft, refreshAiUsageRecords]);

  const updateFlowAiIntentOverride = React.useCallback((override: FlowAiIntentOverride) => {
    setFlowDraft(flow => ({
      ...flow,
      artifacts: {
        ...flow.artifacts,
        aiIntent: {
          ...flow.artifacts?.aiIntent,
          override,
        },
      },
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const testAiConnection = React.useCallback(() => {
    if (!activeAiProfile || !activeAiApiKey.trim()) {
      setAiStatus('请先选择 Profile 并输入 API key');
      return;
    }
    setAiGenerating(true);
    setAiStatus('正在测试 AI 连接');
    testAiProviderConnection(activeAiProfile, activeAiApiKey)
        .then(({ intent, record }) => {
          setAiStatus(record.success ? `连接成功：${intent || '模型返回为空'}` : `连接失败：${record.error || '未知错误'}`);
          refreshAiUsageRecords();
        })
        .catch(error => setAiStatus(error instanceof Error ? error.message : String(error)))
        .finally(() => setAiGenerating(false));
  }, [activeAiApiKey, activeAiProfile, refreshAiUsageRecords]);

  const clearAiUsage = React.useCallback(() => {
    clearAiUsageRecords()
        .then(() => {
          setAiUsageRecords([]);
          setAiStatus('AI 用量记录已清空');
        })
        .catch(() => setAiStatus('AI 用量记录清空失败'));
  }, []);

  const exportAiUsage = React.useCallback(() => {
    downloadText(`ai-intent-usage-${generateDatetimeSuffix()}.jsonl`, usageRecordsToJsonl(aiUsageRecords), 'application/jsonl');
  }, [aiUsageRecords]);

  React.useEffect(() => {
    if (!effectiveAiIntentEnabled || aiSettings.mode === 'manual' || aiGenerating || panelStage === 'library' || panelStage === 'setup' || panelStage === 'aiSettings' || panelStage === 'aiUsage')
      return;
    const pending = selectAiIntentSteps(flowDraft, aiSettings.mode)
        .map(step => step.id)
        .filter(stepId => !aiPendingStepIds.has(stepId));
    if (!pending.length)
      return;

    if (aiAutoTimerRef.current)
      window.clearTimeout(aiAutoTimerRef.current);
    aiAutoTimerRef.current = window.setTimeout(() => {
      runAiGeneration(pending, pending.length === 1 ? 'single' : 'batch');
    }, aiSettings.debounceMs);

    return () => {
      if (aiAutoTimerRef.current)
        window.clearTimeout(aiAutoTimerRef.current);
    };
  }, [aiGenerating, aiPendingStepIds, aiSettings.debounceMs, aiSettings.mode, effectiveAiIntentEnabled, flowDraft, panelStage, runAiGeneration]);

  const deleteStep = React.useCallback((stepId: string) => {
    if (pendingInsertRecordingRef.current?.afterStepId === stepId) {
      pendingInsertRecordingRef.current = undefined;
      setInsertRecordingAfterStepId(undefined);
    }
    setFlowDraft(flow => {
      const step = flow.steps.find(step => step.id === stepId);
      const next = deleteStepFromFlow(flow, stepId);
      appendDiagnosticLog({
        type: 'ui.step-delete',
        message: `删除步骤 ${stepId}`,
        data: {
          stepId,
          order: step?.order,
          action: step?.action,
          beforeStepCount: flow.steps.length,
          afterStepCount: next.steps.length,
          removedFromRepeatSegments: (flow.repeatSegments ?? []).filter(segment => segment.stepIds.includes(stepId)).map(segment => segment.id),
        },
      });
      return next;
    });
    setEditingAssertionStepId(currentStepId => currentStepId === stepId ? undefined : currentStepId);
  }, [appendDiagnosticLog]);

  const deleteSteps = React.useCallback((stepIds: string[]) => {
    const uniqueStepIds = [...new Set(stepIds)];
    if (!uniqueStepIds.length)
      return;
    if (pendingInsertRecordingRef.current?.afterStepId && uniqueStepIds.includes(pendingInsertRecordingRef.current.afterStepId)) {
      pendingInsertRecordingRef.current = undefined;
      setInsertRecordingAfterStepId(undefined);
    }
    setFlowDraft(flow => {
      const deletedSteps = flow.steps.filter(step => uniqueStepIds.includes(step.id));
      const next = uniqueStepIds.reduce((current, stepId) => deleteStepFromFlow(current, stepId), flow);
      appendDiagnosticLog({
        type: 'ui.steps-delete',
        message: `批量删除 ${deletedSteps.length} 个步骤`,
        data: {
          stepIds: deletedSteps.map(step => step.id),
          orders: deletedSteps.map(step => step.order),
          actions: deletedSteps.map(step => step.action),
          beforeStepCount: flow.steps.length,
          afterStepCount: next.steps.length,
          affectedRepeatSegments: (flow.repeatSegments ?? [])
              .filter(segment => segment.stepIds.some(stepId => uniqueStepIds.includes(stepId)))
              .map(segment => segment.id),
        },
      });
      return next;
    });
    setEditingAssertionStepId(currentStepId => currentStepId && uniqueStepIds.includes(currentStepId) ? undefined : currentStepId);
  }, [appendDiagnosticLog]);

  const insertEmptyStep = React.useCallback((afterStepId: string) => {
    setFlowDraft(flow => {
      const next = insertEmptyStepAfter(flow, afterStepId);
      const insertedStep = next.steps.find(step => !flow.steps.some(previous => previous.id === step.id));
      appendDiagnosticLog({
        type: 'ui.step-insert-empty',
        message: insertedStep ? `在 ${afterStepId} 后插入空步骤 ${insertedStep.id}` : `尝试在 ${afterStepId} 后插入空步骤`,
        data: {
          afterStepId,
          insertedStepId: insertedStep?.id,
          beforeStepCount: flow.steps.length,
          afterStepCount: next.steps.length,
          order: insertedStep?.order,
        },
      });
      return next;
    });
  }, [appendDiagnosticLog]);

  const insertWaitStep = React.useCallback((afterStepId: string, milliseconds: number) => {
    setFlowDraft(flow => {
      const next = insertWaitStepAfter(flow, afterStepId, milliseconds);
      const insertedStep = next.steps.find(step => !flow.steps.some(previous => previous.id === step.id));
      appendDiagnosticLog({
        type: 'ui.step-insert-wait',
        message: insertedStep ? `在 ${afterStepId} 后插入等待步骤 ${insertedStep.id}` : `尝试在 ${afterStepId} 后插入等待步骤`,
        data: {
          afterStepId,
          insertedStepId: insertedStep?.id,
          waitMilliseconds: milliseconds,
          beforeStepCount: flow.steps.length,
          afterStepCount: next.steps.length,
          order: insertedStep?.order,
        },
      });
      return next;
    });
  }, [appendDiagnosticLog]);

  const addAssertion = React.useCallback((stepId: string, type: FlowAssertionType, patch: Partial<FlowAssertion> = {}) => {
    setFlowDraft(flow => {
      const assertionId = nextAssertionId(flow);
      return {
        ...flow,
        steps: flow.steps.map(step => {
          if (step.id !== stepId)
            return step;
          const assertion = {
            ...createAssertion(type, assertionId, step),
            ...patch,
          };
          if (hasSameAssertion(step.assertions, assertion))
            return step;
          return {
            ...step,
            assertions: [...step.assertions, assertion],
          };
        }),
        updatedAt: new Date().toISOString(),
      };
    });
    setEditingAssertionStepId(undefined);
  }, []);

  const clearSteps = React.useCallback(() => {
    pendingAssertionPickRef.current = undefined;
    pendingInsertRecordingRef.current = undefined;
    setInsertRecordingAfterStepId(undefined);
    appendDiagnosticLog({
      type: 'ui.steps-clear',
      message: '清空当前流程步骤',
      data: {
        beforeStepCount: flowDraft.steps.length,
        repeatSegmentCount: flowDraft.repeatSegments?.length ?? 0,
        recorderActionLogCount: flowDraft.artifacts?.recorder?.actionLog.length ?? 0,
      },
      level: 'warn',
    });
    setFlowDraft(flow => ({
      ...flow,
      steps: [],
      repeatSegments: [],
      network: [],
      artifacts: {
        ...flow.artifacts,
        playwrightCode: undefined,
        deletedStepIds: [],
        deletedActionIndexes: [],
        deletedActionSignatures: {},
        stepActionIndexes: {},
        stepMergedActionIndexes: {},
        recorder: {
          version: 2,
          actionLog: [],
          nextActionSeq: 1,
          nextStepSeq: 1,
          sessions: [],
        },
      },
      updatedAt: new Date().toISOString(),
    }));
    setRecordedActionCount(0);
    setSources([]);
    setLog(new Map());
    setPickedAssertionTarget(undefined);
    setPickingAssertionStepId(undefined);
    setPanelStage('review');
    setActiveTab('business');
    setEditingAssertionStepId(undefined);
    setDraftStatus('步骤已清空');
    setSelectedFileId('playwright-test');
    window.dispatch({ event: 'setMode', params: { mode: 'standby' } }).catch(() => {});
    window.dispatch({ event: 'clear', params: {} }).catch(() => {});
    window.dispatch({ event: 'fileChanged', params: { file: 'playwright-test' } }).catch(() => {});
    window.dispatch({ event: 'businessFlowCodeChanged', params: { code: null } }).catch(() => {});
  }, [appendDiagnosticLog, flowDraft.artifacts?.recorder?.actionLog.length, flowDraft.repeatSegments?.length, flowDraft.steps.length]);

  const saveRepeatSegment = React.useCallback((segment: FlowRepeatSegment) => {
    setFlowDraft(flow => {
      const next = upsertRepeatSegment(flow, segment);
      appendDiagnosticLog({
        type: 'ui.repeat-segment-save',
        message: `保存循环片段 ${segment.id}`,
        data: {
          segmentId: segment.id,
          name: segment.name,
          stepIds: segment.stepIds,
          parameterCount: segment.parameters.length,
          rowCount: segment.rows.length,
        },
      });
      return next;
    });
  }, [appendDiagnosticLog]);

  const removeRepeatSegment = React.useCallback((segmentId: string) => {
    setFlowDraft(flow => {
      const segment = flow.repeatSegments?.find(segment => segment.id === segmentId);
      const next = deleteRepeatSegment(flow, segmentId);
      appendDiagnosticLog({
        type: 'ui.repeat-segment-delete',
        message: `删除循环片段 ${segmentId}`,
        data: {
          segmentId,
          name: segment?.name,
          stepIds: segment?.stepIds,
          beforeSegmentCount: flow.repeatSegments?.length ?? 0,
          afterSegmentCount: next.repeatSegments?.length ?? 0,
        },
        level: 'warn',
      });
      return next;
    });
  }, [appendDiagnosticLog]);

  const restoreDraft = React.useCallback(() => {
    loadLatestFlowDraft()
        .then(draft => {
          if (!draft) {
            window.alert('暂无可恢复的草稿。');
            return;
          }
          const normalizedDraft = normalizeIntentSources(normalizeFlowStepIds(draft));
          setFlowDraft(normalizedDraft);
          setSuppressDefaultMeta(false);
          setPanelStage(normalizedDraft.steps.length ? 'recording' : 'setup');
          setActiveTab('business');
          setDraftStatus(`已恢复草稿 ${new Date(normalizedDraft.updatedAt).toLocaleTimeString()}`);
        })
        .catch(() => window.alert('草稿恢复失败。'));
  }, []);

  const startRecording = React.useCallback(() => {
    if (!flowDraft.flow.name.trim()) {
      window.alert('请先填写流程名称。');
      return;
    }
    pendingInsertRecordingRef.current = undefined;
    setInsertRecordingAfterStepId(undefined);
    appendDiagnosticLog({
      type: 'ui.recording-start',
      message: '开始录制',
      data: {
        flowId: flowDraft.flow.id,
        flowName: flowDraft.flow.name,
        stepCount: flowDraft.steps.length,
        recordedActionCount,
      },
    });
    setPanelStage('recording');
    setActiveTab('business');
    window.dispatch({ event: 'setMode', params: { mode: 'recording' } }).catch(() => {});
  }, [appendDiagnosticLog, flowDraft.flow.id, flowDraft.flow.name, flowDraft.steps.length, recordedActionCount]);

  const pauseRecording = React.useCallback(() => {
    window.dispatch({ event: 'setMode', params: { mode: mode === 'recording' ? 'standby' : 'recording' } }).catch(() => {});
  }, [mode]);

  const stopRecording = React.useCallback(async () => {
    appendDiagnosticLog({
      type: 'ui.recording-stop',
      message: '停止录制',
      data: {
        pendingInsert: pendingInsertRecordingRef.current,
        stepCount: flowDraft.steps.length,
        recordedActionCount,
      },
    });
    await flushPageContextEventsNow();
    pendingInsertRecordingRef.current = undefined;
    setInsertRecordingAfterStepId(undefined);
    setPanelStage('review');
    setActiveTab('business');
    window.dispatch({ event: 'setMode', params: { mode: 'standby' } }).catch(() => {});
  }, [appendDiagnosticLog, flowDraft.steps.length, flushPageContextEventsNow, recordedActionCount]);

  const continueRecording = React.useCallback(() => {
    const playbackBoundary = actionCountForMergeBoundary(flowDraft);
    const baseActionCount = Math.max(recordedActionCount, playbackBoundary);
    pendingInsertRecordingRef.current = {
      baseActionCount,
      localBaseActionCount: recordedActionCount,
      sessionId: recordingSessionId(),
      appendToEnd: true,
    };
    appendDiagnosticLog({
      type: 'ui.recording-continue',
      message: '从末尾继续录制',
      data: {
        baseActionCount,
        localBaseActionCount: recordedActionCount,
        recordedActionCount,
        playbackBoundary,
        stepCount: flowDraft.steps.length,
        sessionId: pendingInsertRecordingRef.current.sessionId,
      },
    });
    setInsertRecordingAfterStepId(undefined);
    setPanelStage('recording');
    setActiveTab('business');
    window.dispatch({ event: 'setMode', params: { mode: 'recording' } }).catch(() => {});
  }, [appendDiagnosticLog, flowDraft, recordedActionCount]);

  const continueRecordingFrom = React.useCallback((afterStepId: string) => {
    const playbackBoundary = actionCountForMergeBoundary(flowDraft);
    const baseActionCount = Math.max(recordedActionCount, playbackBoundary);
    const anchorStep = flowDraft.steps.find(step => step.id === afterStepId);
    pendingInsertRecordingRef.current = {
      anchorStepId: afterStepId,
      afterStepId,
      baseActionCount,
      localBaseActionCount: recordedActionCount,
      sessionId: recordingSessionId(),
    };
    appendDiagnosticLog({
      type: 'ui.recording-insert-start',
      message: `从 ${afterStepId} 后插入录制`,
      data: {
        afterStepId,
        anchorOrder: anchorStep?.order,
        anchorAction: anchorStep?.action,
        baseActionCount,
        localBaseActionCount: recordedActionCount,
        recordedActionCount,
        playbackBoundary,
        stepCount: flowDraft.steps.length,
        sessionId: pendingInsertRecordingRef.current.sessionId,
      },
    });
    setInsertRecordingAfterStepId(afterStepId);
    setPanelStage('recording');
    setActiveTab('business');
    window.dispatch({ event: 'setMode', params: { mode: 'recording' } }).catch(() => {});
  }, [appendDiagnosticLog, flowDraft, recordedActionCount]);

  const exitInsertRecording = React.useCallback(() => {
    appendDiagnosticLog({
      type: 'ui.recording-insert-exit',
      message: '退出插入录制',
      data: {
        pendingInsert: pendingInsertRecordingRef.current,
        stepCount: flowDraft.steps.length,
        recordedActionCount,
      },
    });
    pendingInsertRecordingRef.current = undefined;
    setInsertRecordingAfterStepId(undefined);
  }, [appendDiagnosticLog, flowDraft.steps.length, recordedActionCount]);

  const beginAddAssertion = React.useCallback((stepId: string) => {
    setEditingAssertionStepId(stepId);
    setActiveTab('business');
    if (panelStage === 'review')
      setPanelStage('recording');
  }, [panelStage]);

  const startAssertionPick = React.useCallback((stepId: string, subject: FlowAssertionSubject) => {
    pendingAssertionPickRef.current = {
      stepId,
      subject,
      returnMode: mode === 'recording' ? 'recording' : 'standby',
    };
    setPickingAssertionStepId(stepId);
    setPickedAssertionTarget(undefined);
    window.dispatch({ event: 'setMode', params: { mode: 'inspecting' } }).catch(() => {});
  }, [mode]);

  const exportBusinessFlow = React.useCallback(async (format: 'json' | 'yaml') => {
    if (!flowDraft.flow.name.trim()) {
      window.alert('导出前请先填写流程名称。');
      return;
    }

    const flushedFlow = await flushPageContextEventsNow();
    const exportCodeText = settings.businessFlowEnabled === false ? currentCodeText : generateBusinessFlowPlaywrightCode(flushedFlow);
    const flowWithCode = withPlaywrightCodeForExport(flushedFlow, exportCodeText);
    if (!hasEnabledAssertion(flowWithCode) && !window.confirm('当前流程还没有启用断言，仍然导出吗？'))
      return;

    const exportFlow = settings.redactSensitiveData === false ? flowWithCode : redactBusinessFlow(flowWithCode);
    const baseFilename = safeFilename(exportFlow.flow.id || exportFlow.flow.name, 'business-flow');

    if (format === 'json') {
      downloadText(`${baseFilename}.business-flow.json`, JSON.stringify(exportFlow, null, 2), 'application/json');
      return;
    }

    downloadText(`${baseFilename}.compact-flow.yaml`, toCompactFlow(exportFlow), 'text/yaml');
  }, [currentCodeText, flowDraft.flow.name, flushPageContextEventsNow, settings.businessFlowEnabled, settings.redactSensitiveData]);

  const stats = flowStats(flowDraft);
  const isBusinessFlowEnabled = settings.businessFlowEnabled !== false;
  const statusText = panelStage === 'library' ? '流程库' : panelStage === 'aiSettings' ? 'AI 设置' : panelStage === 'aiUsage' ? 'AI 用量' : panelStage === 'editRecord' ? '编辑记录' : panelStage === 'review' ? '复查' : panelStage === 'recording' ? '录制中' : '新建流程';
  const statusClass = panelStage === 'review' || panelStage === 'library' || panelStage === 'editRecord' || panelStage === 'aiSettings' || panelStage === 'aiUsage' ? 'review' : panelStage === 'recording' ? 'recording' : 'setup';
  const metaLine = [flowDraft.flow.module, flowDraft.flow.role, `${stats.stepCount} 步骤`].filter(Boolean).join(' · ');
  const insertAnchorStep = insertRecordingAfterStepId ? flowDraft.steps.find(step => step.id === insertRecordingAfterStepId) : undefined;
  const insertAnchorIndex = insertAnchorStep ? flowDraft.steps.indexOf(insertAnchorStep) : -1;
  const insertNextStep = insertAnchorIndex >= 0 ? flowDraft.steps[insertAnchorIndex + 1] : undefined;
  const runtimeLogs = React.useMemo(() => diagnosticLogs.filter(log => log.type.startsWith('runtime.')).slice(-80), [diagnosticLogs]);
  const runtimeLogIdSet = React.useMemo(() => new Set(runtimeLogs.map(log => log.id)), [runtimeLogs]);

  React.useEffect(() => {
    setExpandedRuntimeLogIds(ids => {
      const next = new Set<number>();
      for (const id of ids) {
        if (runtimeLogIdSet.has(id))
          next.add(id);
      }
      for (const log of runtimeLogs) {
        if (log.level === 'warn')
          next.add(log.id);
      }
      return sameNumberSet(next, ids) ? ids : next;
    });
  }, [runtimeLogIdSet, runtimeLogs]);

  return <>
    <ModalContainer />

    <div className='recorder'>
      {settings.experimental && !isBusinessFlowEnabled && <>
        <Toolbar>
          <ToolbarButton icon='save' title='Save' disabled={false} onClick={saveCode}>Save</ToolbarButton>
          <div style={{ flex: 'auto' }}></div>
          <div className='dropdown'>
            <ToolbarButton icon='tools' title='Tools' disabled={false} onClick={() => {}}></ToolbarButton>
            <div className='dropdown-content right-align'>
              <a href='#' onClick={requestStorageState}>Download storage state</a>
            </div>
          </div>
          <ToolbarSeparator />
          <ToolbarButton icon='settings-gear' title='Preferences' onClick={showPreferences}></ToolbarButton>
        </Toolbar>
      </>}
      <div className='recorder-workspace'>
        {isBusinessFlowEnabled ? <aside className='business-flow-panel'>
          <header className='business-flow-header'>
            <div>
              <h1>Playwright CRX</h1>
              <div className='header-subtitle'>业务流程录制器</div>
            </div>
            <button type='button' className='icon-button' onClick={showPreferences} title='偏好设置'>设置</button>
          </header>
          <div className={`recording-status ${statusClass}`}><span></span>{statusText}</div>
          {panelStage === 'library' ? <FlowLibraryPanel
            records={flowRecords}
            selectedRecordId={selectedRecordId}
            draftStatus={recordStatus || draftStatus}
            aiSettings={aiSettings}
            aiProfiles={aiProfiles}
            activeAiProfile={activeAiProfile}
            aiUsageRecords={aiUsageRecords}
            onNewFlow={beginNewFlow}
            onOpenRecord={openRecord}
            onEditRecord={editRecord}
            onDuplicateRecord={duplicateRecord}
            onDeleteRecord={deleteRecord}
            onRestoreRecord={restoreRecord}
            onImportJson={importRecord}
            onExportAll={exportAllRecords}
            onAiSettingsChange={updateAiSettings}
            onOpenAiSettings={() => setPanelStage('aiSettings')}
            onOpenAiUsage={() => setPanelStage('aiUsage')}
          /> : panelStage === 'aiSettings' ? <AiIntentSettingsPanel
            settings={aiSettings}
            profiles={aiProfiles}
            activeProfile={activeAiProfile}
            apiKey={activeAiApiKey}
            status={aiStatus}
            generating={aiGenerating}
            onBack={() => setPanelStage('library')}
            onSettingsChange={updateAiSettings}
            onProfilesChange={updateAiProfiles}
            onApiKeyChange={updateActiveAiApiKey}
            onTestConnection={testAiConnection}
            onGenerate={() => runAiGeneration()}
            onOpenUsage={() => setPanelStage('aiUsage')}
          /> : panelStage === 'aiUsage' ? <AiUsagePanel
            records={aiUsageRecords}
            onBack={() => setPanelStage('library')}
            onExport={exportAiUsage}
            onClear={clearAiUsage}
          /> : panelStage === 'setup' ? <>
            <button type='button' className='back-to-library' onClick={goToLibrary}>← 返回流程库</button>
            <div className='setup-title'>新建业务流程</div>
            <FlowMetaPanel flow={flowDraft} onChange={updateFlowDraft} />
            <div className='template-chips'>
              <span>从模板开始</span>
              {['站点配置', 'WAN 配置', 'QoS 策略'].map(template => <button
                type='button'
                key={template}
                onClick={() => updateFlowDraft({
                  ...flowDraft,
                  flow: {
                    ...flowDraft.flow,
                    module: flowDraft.flow.module || template.replace(' 配置', ''),
                    page: flowDraft.flow.page || template,
                  },
                  updatedAt: new Date().toISOString(),
                })}
              >{template}</button>)}
            </div>
            <div className='setup-actions'>
              <button type='button' className='primary' onClick={startRecording}>创建并开始录制</button>
              <button type='button' onClick={saveDraftNow}>保存为草稿</button>
              <button type='button' onClick={goToLibrary}>取消</button>
              <button type='button' className='link-danger' onClick={restoreDraft}>恢复最近草稿</button>
            </div>
          </> : panelStage === 'editRecord' ? <>
            <button type='button' className='back-to-library' onClick={goToLibrary}>← 返回流程库</button>
            <div className='edit-record-title'>
              <div>
                <h2>编辑业务流程</h2>
                <span>{flowDraft.flow.name || '未命名业务流程'}</span>
              </div>
              <span className='status-badge done'>已完成</span>
            </div>
            <FlowMetaPanel flow={flowDraft} onChange={updateFlowDraft} compact />
            <div className='record-asset-card'>
              <div className='section-heading'>步骤资产</div>
              <div className='record-asset-grid'>
                <div><strong>{stats.stepCount}</strong><span>步骤</span></div>
                <div><strong>{stats.assertionCount}</strong><span>断言</span></div>
                <div><strong>{formatLastSaved(flowDraft.updatedAt)}</strong><span>最后保存</span></div>
              </div>
              <div className='record-asset-links'>
                <button type='button' onClick={() => setPanelStage(flowDraft.steps.length ? 'review' : 'recording')}>查看步骤 →</button>
                <button type='button' onClick={() => {
                  setPanelStage(flowDraft.steps.length ? 'review' : 'recording');
                  setActiveTab('code');
                }}>查看代码 →</button>
              </div>
            </div>
            <div className='edit-record-actions'>
              <button type='button' className='primary' onClick={() => saveCurrentRecord()}>保存修改</button>
              <button type='button' onClick={() => duplicateRecord(flowDraft)}>另存为新流程</button>
              <button type='button' className='danger-outline' onClick={() => {
                if (selectedRecordId && window.confirm(`删除 ${flowDraft.flow.name || '未命名业务流程'}？`))
                  deleteRecord(flowDraft);
              }}>删除记录</button>
              <button type='button' onClick={goToLibrary}>取消</button>
            </div>
          </> : <>
            <button type='button' className='flow-detail-back' onClick={goToLibrary}>← 返回流程库</button>
            <div className='flow-title-row'>
              <div>
                <h2>{flowDraft.flow.name || '未命名业务流程'}</h2>
                <div>{metaLine || draftStatus}</div>
              </div>
              <button type='button' onClick={() => setPanelStage(selectedRecordId ? 'editRecord' : 'setup')}>编辑</button>
            </div>
            <div className='business-tabs'>
              <button type='button' className={activeTab === 'business' ? 'selected' : ''} onClick={() => setActiveTab('business')}>业务流程</button>
              <button type='button' className={activeTab === 'code' ? 'selected' : ''} onClick={() => setActiveTab('code')}>Playwright 代码</button>
              <button type='button' className={activeTab === 'log' ? 'selected' : ''} onClick={() => setActiveTab('log')}>运行日志</button>
            </div>
            {activeTab === 'business' && <FlowAiIntentControl
              flow={flowDraft}
              settings={aiSettings}
              activeProfile={activeAiProfile}
              effectiveEnabled={effectiveAiIntentEnabled}
              generating={aiGenerating}
              onOverrideChange={updateFlowAiIntentOverride}
              onGenerate={() => runAiGeneration()}
              onOpenUsage={() => setPanelStage('aiUsage')}
            />}
            {activeTab === 'business' && panelStage === 'recording' && <>
              <div className={insertRecordingAfterStepId ? 'recording-toolbar inserting' : 'recording-toolbar'}>
                <button type='button' onClick={pauseRecording}>{mode === 'recording' ? '暂停' : '继续'}</button>
                <button type='button' className='danger' onClick={stopRecording}>停止录制</button>
                {insertRecordingAfterStepId ? <button type='button' onClick={exitInsertRecording}>退出插入</button> : <button type='button' onClick={() => exportBusinessFlow('json')}>导出</button>}
              </div>
              {insertAnchorStep && <div className='insert-recording-banner'>
                <div>
                  <strong>正在插入操作</strong>
                  <span>新录到的步骤会插入到 {insertAnchorStep.id}{insertNextStep ? ` 与 ${insertNextStep.id}` : ' 之后'} 之间</span>
                </div>
                <button type='button' onClick={exitInsertRecording}>改为追加到末尾</button>
              </div>}
              <div className='flow-compact-stats'>
                <span>{stats.stepCount} 步骤</span>
                <span>{recordedActionCount} 操作</span>
                <span>{stats.assertionCount} 断言</span>
                <span>{stats.missingAssertionCount} 缺少断言</span>
                <span>{draftStatus}</span>
              </div>
              <StepList
                steps={flowDraft.steps}
                editingAssertionStepId={editingAssertionStepId}
                onUpdateStep={updateStep}
                onBeginAddAssertion={beginAddAssertion}
                onCancelAddAssertion={() => setEditingAssertionStepId(undefined)}
                onSaveAssertion={addAssertion}
                onDeleteStep={deleteStep}
                onRegenerateIntent={stepId => runAiGeneration([stepId], 'single')}
                onPickAssertionTarget={startAssertionPick}
                pickedTarget={pickedAssertionTarget}
                pickingStepId={pickingAssertionStepId}
                insertRecordingAfterStepId={insertRecordingAfterStepId}
                aiPendingStepIds={aiPendingStepIds}
              />
              <div className='sticky-export-bar'>
                <button type='button' onClick={() => exportBusinessFlow('json')}>导出流程 JSON</button>
                <button type='button' onClick={() => exportBusinessFlow('yaml')}>导出紧凑 YAML</button>
              </div>
            </>}
            {activeTab === 'business' && panelStage === 'review' && <FlowReviewPanel
              flow={flowDraft}
              redactionEnabled={settings.redactSensitiveData !== false}
              onAddAssertion={beginAddAssertion}
              onDeleteStep={deleteStep}
              onDeleteSteps={deleteSteps}
              onContinueRecording={continueRecording}
              onContinueRecordingFrom={continueRecordingFrom}
              onInsertEmptyStep={insertEmptyStep}
              onInsertWaitStep={insertWaitStep}
              onSaveRecord={() => {
                saveCurrentRecord().then(saved => {
                  if (saved)
                    goToLibrary();
                });
              }}
              onClearSteps={() => {
                if (window.confirm('确定清空当前流程的所有步骤吗？流程名称、应用、目标等信息会保留。'))
                  clearSteps();
              }}
              onExportJson={() => exportBusinessFlow('json')}
              onExportYaml={() => exportBusinessFlow('yaml')}
              onSaveRepeatSegment={saveRepeatSegment}
              onDeleteRepeatSegment={removeRepeatSegment}
            />}
            {activeTab === 'code' && <div className='embedded-recorder'>
              {settings.experimental && <div className='code-actions'>
                <button type='button' onClick={saveCode}>保存代码</button>
                <button type='button' onClick={requestStorageState}>下载 storage state</button>
              </div>}
              <Recorder sources={generatedBusinessSources} paused={paused} log={log} mode={mode} onEditedCode={dispatchEditedCode} onCursorActivity={dispatchCursorActivity} />
            </div>}
            {activeTab === 'log' && <div className='run-log-panel'>
              <details className='diagnostic-dev-panel runtime-log-panel' open>
                <summary>
                  <div>
                    <strong>Playwright 运行事件</strong>
                    <span>{runtimeLogs.length ? `${runtimeLogs.length} 条 runtime 事件，显示最近 80 条` : '暂无 runtime 事件'}</span>
                  </div>
                </summary>
                <div className='diagnostic-dev-actions'>
                  <button type='button' onClick={() => setExpandedRuntimeLogIds(new Set(runtimeLogs.map(entry => entry.id)))} disabled={!runtimeLogs.length}>全部展开</button>
                  <button type='button' onClick={() => setExpandedRuntimeLogIds(new Set())} disabled={!runtimeLogs.length}>全部收起</button>
                  <button type='button' onClick={() => downloadText(`playwright-runtime-${generateDatetimeSuffix()}.jsonl`, runtimeLogsToJsonl(diagnosticLogs), 'application/jsonl')} disabled={!runtimeLogs.length}>导出 JSONL</button>
                  <button type='button' onClick={() => setDiagnosticLogs(logs => {
                    const next = logs.filter(log => !log.type.startsWith('runtime.'));
                    exposeDiagnosticLogs(next);
                    setExpandedRuntimeLogIds(new Set());
                    return next;
                  })} disabled={!runtimeLogs.length}>清空</button>
                  <span>只清理 runtime.*，开发诊断仍保留。</span>
                </div>
                {runtimeLogs.length === 0 && <div className='business-flow-empty compact'>点击 Play 后，这里会显示代码解析、action 数量、开始/结束和报错信息。</div>}
                {runtimeLogs.slice().reverse().map(entry => <details
                  className={`runtime-log-row ${entry.level === 'warn' ? 'warn' : ''}`}
                  key={entry.id}
                  open={isRuntimeLogExpanded(entry, expandedRuntimeLogIds)}
                  onToggle={event => {
                    const open = event.currentTarget.open;
                    setExpandedRuntimeLogIds(ids => {
                      const next = new Set(ids);
                      if (open)
                        next.add(entry.id);
                      else
                        next.delete(entry.id);
                      return next;
                    });
                  }}
                >
                  <summary>
                    <span>{new Date(entry.time).toLocaleTimeString()}</span>
                    <strong>{entry.message}</strong>
                    <em>{entry.type}</em>
                  </summary>
                  {entry.data && <pre>{formatDiagnosticData(entry.data)}</pre>}
                </details>)}
              </details>
              <details className='diagnostic-dev-panel'>
                <summary>
                  <div>
                    <strong>开发诊断</strong>
                    <span>{diagnosticLogs.length ? `${diagnosticLogs.length} / ${maxDiagnosticLogEntries} 条 recorder/merge 事件，已持久化` : '暂无 recorder/merge 事件'}</span>
                  </div>
                </summary>
                <div className='diagnostic-dev-actions'>
                  <button type='button' onClick={() => downloadText(`recorder-diagnostics-${generateDatetimeSuffix()}.jsonl`, diagnosticLogsToJsonl(diagnosticLogs), 'application/jsonl')} disabled={!diagnosticLogs.length}>导出 JSONL</button>
                  <button type='button' onClick={() => setDiagnosticLogs(() => {
                    const next: RecorderDiagnosticLog[] = [];
                    exposeDiagnosticLogs(next);
                    return next;
                  })} disabled={!diagnosticLogs.length}>清空</button>
                  <span>刷新后保留；DevTools: window.__playwrightCrxRecorderDiagnostics</span>
                </div>
                {diagnosticLogs.length === 0 && <div className='business-flow-empty compact'>暂无诊断日志。</div>}
                {diagnosticLogs.map(entry => <details className={`diagnostic-log-row ${entry.level === 'warn' ? 'warn' : ''}`} key={entry.id}>
                  <summary>
                    <span>{new Date(entry.time).toLocaleTimeString()}</span>
                    <strong>{entry.message}</strong>
                    <em>{entry.type}</em>
                  </summary>
                  {entry.data && <pre>{formatDiagnosticData(entry.data)}</pre>}
                </details>)}
              </details>
              {[...log.values()].length === 0 && <div className='business-flow-empty'>暂无运行日志。</div>}
              {[...log.values()].map(callLog => <div className={`log-row ${callLog.status}`} key={callLog.id}>
                <strong>{callLog.title}</strong>
                <span>{callLog.status}</span>
              </div>)}
            </div>}
          </>}
        </aside> : <div className='recorder-editor'>
          <Recorder sources={sources} paused={paused} log={log} mode={mode} onEditedCode={dispatchEditedCode} onCursorActivity={dispatchCursorActivity} />
        </div>}
      </div>
    </div>
  </>;
};
