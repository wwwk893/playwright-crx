/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import { buildAiIntentInput } from '../aiIntent/prompt';
import { compactSemanticDiagnostic, createSemanticDiagnosticsBuffer } from '../uiSemantics/diagnostics';
import type { UiActionRecipe, UiComponentKind } from '../uiSemantics/types';
import { countBusinessFlowPlaybackActions, generateAssertionCodePreview, generateBusinessFlowPlaybackCode, generateBusinessFlowPlaywrightCode } from './codePreview';
import { toCompactFlow } from './compactExporter';
import { prepareBusinessFlowForExport } from './exportSanitizer';
import { appendSyntheticPageContextSteps, appendSyntheticPageContextStepsWithResult, clearFlowRecordingHistory, deleteStepFromFlow, insertEmptyStepAfter, insertWaitStepAfter, mergeActionsIntoFlow } from './flowBuilder';
import { filterPageContextEventsForCapture } from './pageContextCapture';
import { appendTerminalStateAssertions, createTerminalStateAssertion, replayDiagnosticSummary } from './terminalAssertions';
import { eventJournalStats } from './eventJournal';
import { mergePageContextIntoFlow } from './flowContextMerger';
import { suggestIntent } from './intentRules';
import { createRepeatSegment } from './repeatSegments';
import { redactBusinessFlow } from './redactor';
import type { PageContextEvent, ElementContext } from './pageContextTypes';
import type { BusinessFlow, FlowStep } from './types';
import { createEmptyBusinessFlow } from './types';

type TestCase = {
  name: string;
  run: () => void;
};

const tests: TestCase[] = [
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
    name: 'page context synthetic append records page context facts in event journal',
    run: () => {
      const flow = mergeActionsIntoFlow(createNamedFlow(), [clickActionWithWallTime('打开', 1000)], [], {});
      const event = pageClickEvent('ctx-save', 2000, '保存');
      const result = appendSyntheticPageContextStepsWithResult(flow, [event]);
      const recorder = result.flow.artifacts?.recorder;

      assert(recorder?.eventJournal, 'page context journal should exist');
      assertEqual(eventJournalStats(recorder).pageContextEventCount, 1);
      assertEqual(recorder.eventJournal.eventOrder.map(id => recorder.eventJournal?.eventsById[id]?.source).includes('page-context'), true);
      assertEqual(result.insertedStepIds.length, 1);
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
            sourceCode: 'await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) >> .ant-select-item-option >> internal:has-text=\\"选择一个VRF\\"i").click();',
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
            rawAction: { name: 'click', selector: '.ant-select-dropdown:not(.ant-select-dropdown-hidden) >> .ant-select-item-option >> internal:has-text="default"i' } as any,
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
            sourceCode: 'await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) >> .ant-select-item-option >> internal:has-text=\\"default\\"i").click();',
            context: { eventId: 'ctx-vrf-default-repeat', capturedAt: 1200, before: { form: { label: '关联VRF' }, target: { role: 'option' as any, text: 'default', normalizedText: 'default', optionPath: ['default'] } } },
            assertions: [],
          },
          {
            id: 's002',
            order: 2,
            action: 'click',
            target: { role: 'option', text: 'default', displayName: 'default' },
            rawAction: { name: 'click', selector: '.ant-select-dropdown:not(.ant-select-dropdown-hidden) >> .ant-select-item-option >> internal:has-text="default"i' } as any,
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
      assert(firstStep.includes('getByRole("button", { name: "确定" })'), 'should click confirm button inside dialog');
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
      assert(firstStep.includes('getByRole("button", { name: /^(确定|确 定)$/ })') || firstStep.includes('getByRole("button", { name: "确定" })') || firstStep.includes('getByRole("button", { name: "确 定" })'), 'popconfirm should click the confirm button');
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
      assert(playbackCode.includes('page.locator(".ant-popover:not(.ant-popover-hidden):not(.ant-zoom-big-leave):not(.ant-zoom-big-leave-active):has(.ant-popconfirm-buttons)").last().getByRole("button", { name: /^(确定|确 定)$/ }).click();'), 'runtime playback should confirm a visible AntD Popconfirm root with buttons without title coupling');
      assert(!playbackCode.includes('.catch('), 'runtime playback should not include unsupported catch continuations');
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
            before: { target: { tag: 'a', testId: 'wan-transport-row-delete-action', framework: 'antd', controlType: 'link' } },
            after: { openedDialog: { type: 'popover', title: '删除此行？', visible: true } },
          },
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);

      assert(code.includes('page.locator("tr, [role=\\"row\\"], .ant-table-row, .ant-list-item, .ant-descriptions-row, .ant-space, .ant-card, .ant-table-cell").filter({ hasText: /Nova专线[\\s\\S]*default/ }).getByTestId("wan-transport-row-delete-action").first().click();'), 'row delete with reusable test id should fall back to row text scope instead of global test id when rowKey is missing');
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

      assert(code.includes('page.locator(".ant-modal, .ant-drawer, [role=\\"dialog\\"]").filter({ hasText: "二次确认" }).getByRole("button", { name: "确 定" }).click();'), 'real second modal confirmation should be kept and scoped to the active dialog');
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
          sourceCode: `await page.locator(".ant-form-item").filter({ hasText: "关联VRF" }).locator(".ant-select-selector").first().click();`,
          assertions: [],
        }, {
          id: 's002',
          order: 2,
          kind: 'recorded',
          sourceActionIds: ['a002'],
          action: 'click',
          target: { text: '生产VRF' },
          sourceCode: `await page.getByText("生产VRF").click();`,
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
      assert(code.includes('.ant-select-dropdown:not(.ant-select-dropdown-hidden)'), 'parameterized popup option should stay scoped to active AntD dropdown');
      assert(code.includes('evaluateAll((elements, expectedText)'), 'parameterized popup option should validate against the active popup options');
      assert(code.includes('AntD option text mismatch'), 'parameterized popup option should fail on partial or wrong text matches');
      assert(code.includes('}, String(row.vrf));'), 'popup option should use the row variable as exact expected text');
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
      assert(code.includes('.locator(".ant-select-selector").first().click();') || code.includes("getByRole('combobox'"), 'select trigger should replay as opening the field');
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
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);
      const noteStep = stepCodeBlock(code, 's003');

      assert(noteStep.includes('modal closed note'), 'page field should still fill its own value');
      assert(!noteStep.includes('filter({ hasText: "新建条目" })'), 'page field should not inherit a stale modal scope');
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
            testId: 'network-resource-modal',
          },
          rawAction: {
            action: {
              name: 'click',
              selector: 'internal:testid=[data-testid="network-resource-modal"s]',
            },
          },
          sourceCode: `await page.getByTestId('network-resource-modal').click();`,
          assertions: [],
        }],
      };
      const code = generateBusinessFlowPlaywrightCode(flow);

      assert(code.includes('has no runnable Playwright action source'), 'modal root container clicks should be documented but not replayed');
      assert(!code.includes('page.getByTestId("network-resource-modal").click') && !code.includes("page.getByTestId('network-resource-modal').click"), 'modal root test id should not be emitted as a click target');
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

      assert(firstStep.includes(`locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").last().locator(".ant-select-item-option").filter({ hasText: "real-item-a" })`), 'select option should replay through the visible AntD option locator scoped to the active dropdown');
      assert(firstStep.includes('dispatchEvent(new MouseEvent("mousedown"'), 'select option should replay through the AntD mouse event fallback');
      assert(firstStep.includes('waitFor({ state: "hidden", timeout: 1000 })'), 'select option replay should wait briefly for the dropdown to close');
      assert(!firstStep.includes('getByTitle'), 'select option should not replay through brittle title locators');
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
      assert(firstStep.includes('locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").last().locator(".ant-select-item-option")'), 'option lookup should be scoped to active dropdown');
      assert(!firstStep.includes('getByText'), 'human-like option replay must not use ambiguous global text locator');
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
          sourceCode: 'await page.locator(".ant-form-item").filter({ hasText: "IP地址池" }).locator(".ant-select-selector").first().locator("input").first().fill("");',
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

      const fieldClick = 'locator(".ant-form-item").filter({ hasText: "IP地址池" }).locator(".ant-select-selector").click();';
      assert(firstStep.includes('.ant-form-item') && firstStep.includes('IP地址池'), 'runtime replay should reopen the field-scoped select before choosing the option');
      assert(!firstStep.includes('if (!await'), 'runtime replay should not include JS control flow that the parser cannot enforce');
      assert(!firstStep.includes('.fill("test1")'), 'runtime replay should not search ReactNode/IP-range labels because AntD can filter them to an empty dropdown');
      assert(firstStep.includes('.ant-select-item-option') && firstStep.includes('hasText: "test1"'), 'runtime replay should click the active dropdown option by the primary token');
      assert(firstStep.includes('filter({ hasText: "1.1.1.1--2.2.2.2" })'), 'runtime option click should keep enough identifying tokens to avoid partial test1/test12 ambiguity');
      assertEqual(firstStep.split(fieldClick).length - 1, 1);
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
      const fieldClick = 'locator(".ant-form-item").filter({ hasText: "IP地址池" }).locator(".ant-select-selector").click();';

      assert(!optionBlock.includes(fieldClick), 'option step should not emit a second trigger click after the owning select was already opened');
      assert(!optionBlock.includes('if (!await'), 'runtime parser-safe replay must avoid JS control flow that the parser ignores');
      assert(!optionBlock.includes('.fill("test1")'), 'option step should not search ReactNode/IP-range labels because AntD can filter them to an empty dropdown');
      assert(optionBlock.includes('.ant-select-item-option') && optionBlock.includes('hasText: "test1"'), 'option step should still click the active dropdown option');
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
      assert(optionStep.includes('locator(".ant-form-item").filter({ hasText: "WAN口" }).locator(".ant-select-selector").first()'), 'fallback should reopen the owning WAN ProFormSelect trigger');
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
      assert(firstStep.includes('locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").last().locator(".ant-select-item-option")'), 'option lookup should be scoped inside the last visible dropdown');
      assert(firstStep.includes('dispatchEvent(new MouseEvent("mousedown"'), 'AntD replay should keep the explicit mouse event fallback');
      assert(firstStep.includes('waitFor({ state: "hidden", timeout: 1000 })'), 'AntD replay should wait briefly for the dropdown to close after dispatch');
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

      assert(optionStep.includes('.ant-select-dropdown:not(.ant-select-dropdown-hidden)'), 'contextless tree option should inherit active dropdown scope');
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

      assert(firstStep.includes('.ant-select-dropdown:not(.ant-select-dropdown-hidden)'), 'popup option should be scoped to the active AntD dropdown');
      assert(firstStep.includes('.ant-select-tree-node-content-wrapper'), 'tree-select option lookup should be available');
      assert(firstStep.includes('.ant-cascader-menu-item'), 'cascader option lookup should be available');
      assert(firstStep.includes('evaluateAll((elements, expectedText)'), 'active popup option should validate exact visible option text');
      assert(firstStep.includes('AntD option text mismatch'), 'active popup option should fail on partial or wrong text matches');
      assert(!firstStep.includes('filter({ hasText: "华东生产区" }).last().click()'), 'active dropdown fallback must not use partial last-match clicks');
      assert(!firstStep.includes('page.getByText("华东生产区")'), 'active dropdown option should not replay through global page text');
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
      assert(playbackCode.includes('.ant-select-dropdown:not(.ant-select-dropdown-hidden)'), 'runtime playback should still target the active dropdown');
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
      assert(exportedCode.includes('evaluateAll'), 'exported Playwright code should keep the AntD dispatch workaround');
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
        assert(firstStep.includes('locator(".ant-form-item").filter({ hasText: "WAN口" }).locator(".ant-select-selector").first().click();'), 'trigger should click the visible AntD select selector inside the labeled form item');
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
      assert(executableStepCode.includes('locator(".ant-form-item").filter({ hasText: "IP地址池" }).locator(".ant-select-selector").first().click();'), 'tooltip suffix should be stripped before locating the ProFormSelect trigger');
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
      assert(firstStep.includes('locator(".ant-form-item").filter({ hasText: "业务域" }).locator(".ant-select-selector").first().click();'), 'button-looking select trigger should click the owning form-item selector');
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
        assert(firstStep.includes(`locator(".ant-form-item").filter({ hasText: "${sample.label}" }).locator(".ant-select-selector").first().click();`), `${sample.controlType} trigger should click the owning form-item selector`);
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

      assert(firstStep.includes('locator(".ant-form-item").filter({ hasText: "WAN口" }).locator(".ant-select-selector").first().locator("input:visible").first().fill("WAN-extra-18");'), 'search fill should target the visible input inside the scoped ProFormSelect trigger');
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
                framework: 'procomponents',
                controlType: 'input',
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
          sourceCode: `await page.locator(".ant-form-item").filter({ hasText: "WAN口" }).locator(".ant-select-selector").first().locator("input").first().fill("pool-proform-alpha");`,
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
          sourceCode: `await page.locator(".ant-form-item").filter({ hasText: "地址池名称" }).locator(".ant-select-selector").first().locator("input").first().fill("pool-alpha");`,
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
          sourceCode: `await page.locator(".ant-form-item").filter({ hasText: "地址池名称" }).locator(".ant-select-selector").first().click();`,
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

      assert(optionStep.includes('.ant-select-dropdown:not(.ant-select-dropdown-hidden)'), 'context-light option should use the active dropdown locator');
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

      assert(optionStep.includes('.ant-select-dropdown:not(.ant-select-dropdown-hidden)'), 'noisy option click should replay through the active dropdown');
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
      assert(firstStep.includes('locator(".ant-form-item").filter({ hasText: "WAN口" }).locator(".ant-select-selector").first()'), 'option fallback should open the owning ProFormSelect trigger by form label');
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
      assert(code.includes('.ant-cascader-dropdown:not(.ant-cascader-dropdown-hidden)'), 'cascader option should use the cascader popup');
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
      assert(playbackCode.includes('page.getByTestId("wan-transport-row-delete-action").nth(0).click();'), 'link-like action test id should keep its captured test id ordinal');
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

runStepStabilityTests();

function runStepStabilityTests() {
  for (const test of tests) {
    test.run();
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
