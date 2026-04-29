/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import { countBusinessFlowPlaybackActions, generateBusinessFlowPlaywrightCode } from './codePreview';
import { toCompactFlow } from './compactExporter';
import { prepareBusinessFlowForExport } from './exportSanitizer';
import { appendSyntheticPageContextSteps, appendSyntheticPageContextStepsWithResult, deleteStepFromFlow, insertEmptyStepAfter, insertWaitStepAfter, mergeActionsIntoFlow } from './flowBuilder';
import { mergePageContextIntoFlow } from './flowContextMerger';
import { createRepeatSegment } from './repeatSegments';
import type { PageContextEvent, ElementContext } from './pageContextTypes';
import type { BusinessFlow } from './types';
import { createEmptyBusinessFlow } from './types';

type TestCase = {
  name: string;
  run: () => void;
};

const tests: TestCase[] = [
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
    name: 'export sanitization strips recorder internals and compact yaml does not leak artifacts',
    run: () => {
      const flow = mergeActionsIntoFlow(createNamedFlow(), [clickAction('保存')], [], {});
      const exportFlow = prepareBusinessFlowForExport({
        ...flow,
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
