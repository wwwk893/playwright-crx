/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Locator, Page } from 'playwright-core';
import { test, expect } from './crxRecorderTest';
import { replayGeneratedPlaywrightCode } from './helpers/replayAssertions';
import {
  attachRecorderEvidence,
  beginNewFlowFromLibraryLikeUser,
  createRepeatSegmentLikeUser,
  exportBusinessFlowJsonLikeUser,
  fillFlowMetaLikeUser,
  humanClick,
  humanClickUntil,
  humanClickVisible,
  humanType,
  openReplayPanelLikeUser,
  openStepCheckPanelLikeUser,
  selectAntdCascaderPathLikeUser,
  selectAntdOptionLikeUser,
  selectAntdTreeNodeLikeUser,
  visibleStepTexts,
} from './humanLike';

test.describe.configure({ mode: 'serial' });

function deletePopconfirm(page: Page) {
  return page.locator('.ant-popover:not(.ant-popover-hidden):not(.ant-zoom-big-leave):not(.ant-zoom-big-leave-active)').filter({ hasText: '删除此行？' }).last();
}

function popconfirmConfirmButton(popconfirm: Locator) {
  return popconfirm.getByRole('button', { name: /^(确定|确 定)$/ }).last();
}

async function isActionablePopconfirm(popconfirm: Locator) {
  if (!await popconfirm.count().catch(() => 0))
    return false;
  return await popconfirm.evaluate(element => {
    const root = element as HTMLElement;
    const button = root.querySelector('.ant-popconfirm-buttons .ant-btn-primary') as HTMLElement | null;
    if (!button)
      return false;
    const rootStyle = getComputedStyle(root);
    const buttonStyle = getComputedStyle(button);
    const rect = button.getBoundingClientRect();
    return !root.classList.contains('ant-zoom-big-leave') &&
      !root.classList.contains('ant-zoom-big-leave-active') &&
      rootStyle.display !== 'none' &&
      rootStyle.visibility !== 'hidden' &&
      rootStyle.pointerEvents !== 'none' &&
      buttonStyle.display !== 'none' &&
      buttonStyle.visibility !== 'hidden' &&
      buttonStyle.pointerEvents !== 'none' &&
      rect.width > 0 &&
      rect.height > 0;
  }).catch(() => false);
}

test('human-like recorder warns before leaving an unsaved recording @human-smoke', async ({ page, attachRecorder, baseURL }) => {
  test.setTimeout(60_000);

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page, { mode: 'business-flow' });

  await beginNewFlowFromLibraryLikeUser(recorderPage);
  await fillFlowMetaLikeUser(recorderPage, '流程名称', '未保存离开提醒');
  await humanClick(recorderPage.getByRole('button', { name: '保存并开始录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await humanClick(recorderPage.locator('.side-panel-nav').getByRole('button', { name: '流程库', exact: true }));
  await expect(recorderPage.getByRole('dialog', { name: '还有未保存的流程' })).toBeVisible();
  await humanClick(recorderPage.getByRole('button', { name: '继续编辑' }));
  await expect(recorderPage.getByRole('dialog', { name: '还有未保存的流程' })).toBeHidden();
  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await humanClick(recorderPage.locator('.side-panel-nav').getByRole('button', { name: '流程库', exact: true }));
  await expect(recorderPage.getByRole('dialog', { name: '还有未保存的流程' })).toBeVisible();
  await humanClick(recorderPage.getByRole('button', { name: '不保存，返回流程库' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('流程库');
});

test('human-like recorder preserves nth for duplicate test id save button @human-smoke', async ({ page, attachRecorder, baseURL }, testInfo) => {
  test.setTimeout(120_000);

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page, { mode: 'business-flow' });
  recorderPage.on('dialog', dialog => dialog.type() === 'prompt' ? dialog.accept('5') : dialog.accept());

  await beginNewFlowFromLibraryLikeUser(recorderPage);
  await fillFlowMetaLikeUser(recorderPage, '流程名称', '重复 test id 保存按钮');
  await fillFlowMetaLikeUser(recorderPage, '应用', 'AntD Pro');
  await fillFlowMetaLikeUser(recorderPage, '模块', '站点配置');
  await fillFlowMetaLikeUser(recorderPage, '页面', '全局配置');
  await fillFlowMetaLikeUser(recorderPage, '角色', 'admin');
  await humanClick(recorderPage.getByRole('button', { name: '保存并开始录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await page.goto(`${baseURL}/antd-pro-form-fields.html?duplicateSaveButton=1`);
  await attachRecorder(page, { mode: 'business-flow' });
  await expectAddressAndPortPoolsPage(page);
  await expect(page.getByTestId('site-save-button')).toHaveCount(2);

  await humanClickUntil(
      page.getByTestId('site-save-button').nth(1),
      async () => await page.getByText('配置已保存').isVisible().catch(() => false),
      { attempts: 5, afterClickDelayMs: 300, allowFallback: false },
  );
  await expect(page.getByText('配置已保存')).toBeVisible();
  await expect.poll(() => visibleStepTexts(recorderPage), { timeout: 25_000 }).toContain('site-save-button');

  await humanClick(recorderPage.getByRole('button', { name: '停止录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText(/步骤检查|导出检查/);

  const flow = await exportBusinessFlowJsonLikeUser(recorderPage);
  await attachRecorderEvidence(testInfo, page, recorderPage, flow);
  const saveStep = flow.steps.find((step: any) => step.target?.testId === 'site-save-button');
  expect(saveStep?.target?.locatorHint?.pageCount).toBe(2);
  expect(saveStep?.target?.locatorHint?.pageIndex).toBe(1);
  expect(flow.artifacts.playwrightCode).toContain('page.getByTestId("site-save-button").nth(1).click();');
  expect(flow.artifacts.playwrightCode).not.toContain('page.getByTestId("site-save-button").click();');

  await openReplayPanelLikeUser(recorderPage);

  const runtimeLogBaseline = await runtimeDiagnostics(recorderPage);
  await humanClick(recorderPage.getByTitle('Resume (F8)'));
  await expect.poll(async () => {
    const logs = await runtimeDiagnosticsAfter(recorderPage, runtimeLogBaseline);
    return logs.some(log => log.type === 'runtime.playback-stop');
  }, { timeout: 30_000 }).toBeTruthy();
  const replayRuntimeLogs = await runtimeDiagnosticsAfter(recorderPage, runtimeLogBaseline);
  expect(replayRuntimeLogs.filter(log => log.type.includes('error') || log.level === 'warn')).toEqual([]);
});

test('human-like records SD-WAN WAN2 transport delete flow and replays through AntD popconfirm @human-smoke', async ({ context, page, attachRecorder, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const strictHumanOptions = { allowFallback: false as const };

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page, { mode: 'business-flow' });
  recorderPage.on('dialog', dialog => dialog.type() === 'prompt' ? dialog.accept('5') : dialog.accept());

  await beginNewFlowFromLibraryLikeUser(recorderPage);
  await fillFlowMetaLikeUser(recorderPage, '流程名称', 'SD-WAN WAN2 传输网络删除回放');
  await fillFlowMetaLikeUser(recorderPage, '应用', 'Nova SD-WAN');
  await fillFlowMetaLikeUser(recorderPage, '模块', '站点配置');
  await fillFlowMetaLikeUser(recorderPage, '页面', '全局配置-WAN');
  await fillFlowMetaLikeUser(recorderPage, '角色', '租户管理员');
  await humanClick(recorderPage.getByRole('button', { name: '保存并开始录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await page.goto(`${baseURL}/antd-pro-form-fields.html?duplicateSaveButton=1`);
  await attachRecorder(page, { mode: 'business-flow' });
  await expectWanConfigPage(page);
  await expect(page.getByTestId('site-save-button')).toHaveCount(2);

  const wan2Row = page.getByTestId('wan-config-table').locator('[data-row-key="2"]').first();
  await expect(wan2Row).toContainText('WAN2');

  const wanDialog = page.locator('.ant-modal, .ant-drawer, [role="dialog"]').filter({ hasText: '编辑WAN2' });
  await humanClickUntil(
      wan2Row.getByTestId('wan-edit-2'),
      async () => await wanDialog.isVisible().catch(() => false),
      { attempts: 5, afterClickDelayMs: 500, ...strictHumanOptions },
  );
  await expect(wanDialog).toBeVisible({ timeout: 10_000 });
  const transportRow = wanDialog.getByTestId('wan-transport-row').filter({ hasText: 'Nova专线' }).first();
  await expect(transportRow).toContainText('Nova专线');

  const popconfirm = deletePopconfirm(page);
  const deleteAction = wanDialog.getByTestId('wan-transport-row-delete-action').first();
  for (let attempt = 0; attempt < 8 && !await isActionablePopconfirm(popconfirm); attempt++) {
    await transportRow.hover({ timeout: 2_000 }).catch(() => {});
    await expect(deleteAction).toBeVisible({ timeout: 10_000 });
    await humanClickVisible(deleteAction, { delayMs: 80, ...strictHumanOptions });
    await page.waitForTimeout(300);
  }
  await expect.poll(() => isActionablePopconfirm(popconfirm), { timeout: 10_000 }).toBeTruthy();
  await humanClickUntil(
      popconfirmConfirmButton(popconfirm),
      async () => await wanDialog.getByText('暂无数据').isVisible().catch(() => false),
      { attempts: 5, afterClickDelayMs: 500, ...strictHumanOptions },
  );
  await expect(wanDialog.getByText('暂无数据')).toBeVisible({ timeout: 10_000 });

  const transportConfirm = page.locator('.ant-modal-confirm, [role="dialog"]').filter({ hasText: '确定要配置WAN的传输网络？' }).last();
  await humanClickUntil(
      wanDialog.getByRole('button', { name: '确 定' }),
      async () => await transportConfirm.isVisible().catch(() => false),
      { attempts: 5, afterClickDelayMs: 500, ...strictHumanOptions },
  );
  await expect(transportConfirm).toBeVisible({ timeout: 10_000 });
  await humanClickUntil(
      transportConfirm.getByRole('button', { name: '确 定' }),
      async () => !await wanDialog.isVisible().catch(() => false),
      { attempts: 5, afterClickDelayMs: 800, ...strictHumanOptions },
  );
  await expect(wanDialog).toBeHidden({ timeout: 10_000 });

  await humanClickUntil(
      page.getByTestId('site-save-button').nth(1),
      async () => await page.getByText('配置已保存').isVisible().catch(() => false),
      { attempts: 5, afterClickDelayMs: 300, ...strictHumanOptions },
  );
  await expect(page.getByText('配置已保存')).toBeVisible();

  await expect.poll(() => visibleStepTexts(recorderPage), { timeout: 25_000 }).toMatch(/WAN2|wan-edit-2/);
  await expect.poll(() => visibleStepTexts(recorderPage)).toMatch(/Nova专线|wan-transport-row-delete-action/);
  await expect.poll(() => visibleStepTexts(recorderPage)).toContain('site-save-button');

  await humanClick(recorderPage.getByRole('button', { name: '停止录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText(/步骤检查|导出检查/);

  const flow = await exportBusinessFlowJsonLikeUser(recorderPage);
  await attachRecorderEvidence(testInfo, page, recorderPage, flow);
  expect(flow.flow.name).toBe('SD-WAN WAN2 传输网络删除回放');
  expect(flow.artifacts.playwrightCode).toContain('wan-edit-2');
  expect(flow.artifacts.playwrightCode).toContain('wan-transport-row-delete-action');
  expect(flow.artifacts.playwrightCode).toMatch(/\.ant-popover:not\(\.ant-popover-hidden\)[\s\S]*getByRole\("button", \{ name: \/\^\(确定\|确 定\)\$\/ \}\)\.click\(\);/);
  expect(flow.artifacts.playwrightCode).toContain('page.getByTestId("site-save-button").nth(1).click();');

  await replayGeneratedPlaywrightCode(context, flow.artifacts.playwrightCode, testInfo, {
    verify: async replayPage => {
      await expectWanConfigPage(replayPage, { expectWan2Transport: false });
      const wan2Row = replayPage.getByTestId('wan-config-table').locator('[data-row-key="2"]').first();
      await expect(wan2Row).not.toContainText('default', { timeout: 10_000 });
      await expect(replayPage.getByText('配置已保存')).toBeVisible({ timeout: 10_000 });
    },
    standalone: [
      `await expect(page.getByTestId("site-global-wan-section")).toContainText("WAN配置", { timeout: 10000 });`,
      `const wan2Row = page.getByTestId("wan-config-table").locator('[data-row-key="2"]').first();`,
      `await expect(wan2Row).not.toContainText("default", { timeout: 10000 });`,
      `await expect(page.getByText("配置已保存")).toBeVisible({ timeout: 10000 });`,
    ],
  });

  await page.goto(`${baseURL}/antd-pro-form-fields.html?duplicateSaveButton=1`);
  await attachRecorder(page, { mode: 'business-flow' });
  await expectWanConfigPage(page);
  await openReplayPanelLikeUser(recorderPage);
  const runtimeLogBaseline = await runtimeDiagnostics(recorderPage);
  await humanClick(recorderPage.getByTitle('Resume (F8)'));
  await expect.poll(async () => {
    const logs = await runtimeDiagnosticsAfter(recorderPage, runtimeLogBaseline);
    return logs.some(log => log.type === 'runtime.playback-stop');
  }, { timeout: 45_000 }).toBeTruthy();
  const replayRuntimeLogs = await runtimeDiagnosticsAfter(recorderPage, runtimeLogBaseline);
  expect(replayRuntimeLogs.filter(log => log.type.includes('error') || log.level === 'warn')).toEqual([]);
  expect(replayRuntimeLogs.filter(log => log.type === 'runtime.playback-request')).toHaveLength(1);
  expect(replayRuntimeLogs.filter(log => log.type === 'runtime.playback-actions')).toHaveLength(1);
  await expect(page.getByText('配置已保存')).toBeVisible({ timeout: 10_000 });
});

test('human-like records shared WAN duplicate row edit action and replays stably @human-smoke', async ({ context, page, attachRecorder, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const strictHumanOptions = { allowFallback: false as const };

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page, { mode: 'business-flow' });
  recorderPage.on('dialog', dialog => dialog.type() === 'prompt' ? dialog.accept('5') : dialog.accept());

  await beginNewFlowFromLibraryLikeUser(recorderPage);
  await fillFlowMetaLikeUser(recorderPage, '流程名称', 'SD-WAN 共享WAN 行编辑回放');
  await fillFlowMetaLikeUser(recorderPage, '应用', 'Nova SD-WAN');
  await fillFlowMetaLikeUser(recorderPage, '模块', '站点配置');
  await fillFlowMetaLikeUser(recorderPage, '页面', '全局配置-共享WAN');
  await fillFlowMetaLikeUser(recorderPage, '角色', '租户管理员');
  await humanClick(recorderPage.getByRole('button', { name: '保存并开始录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await page.goto(`${baseURL}/antd-pro-form-fields.html?duplicateSaveButton=1&sharedWanDuplicateEdit=1`);
  await attachRecorder(page, { mode: 'business-flow' });
  await expectWanConfigPage(page, { sharedWanDuplicateEdit: true });
  await expect(page.getByTestId('ha-wan-row-edit-action')).toHaveCount(2);

  const wan1Row = page.getByTestId('wan-config-table').locator('[data-row-key="1"]').first();
  const wanDialog = page.locator('.ant-modal, .ant-drawer, [role="dialog"]').filter({ hasText: '编辑 WAN1 共享 WAN' });
  await humanClickUntil(
      wan1Row.getByTestId('ha-wan-row-edit-action'),
      async () => await wanDialog.isVisible().catch(() => false),
      { attempts: 5, afterClickDelayMs: 500, ...strictHumanOptions },
  );
  await expect(wanDialog).toBeVisible({ timeout: 10_000 });
  const transportRow = wanDialog.getByTestId('wan-transport-row').filter({ hasText: 'HS Internet' }).first();
  await expect(transportRow).toContainText('HS Internet');

  const popconfirm = deletePopconfirm(page);
  const deleteAction = wanDialog.getByTestId('ha-wan-transport-row-delete-action').first();
  for (let attempt = 0; attempt < 8 && !await isActionablePopconfirm(popconfirm); attempt++) {
    await transportRow.hover({ timeout: 2_000 }).catch(() => {});
    await expect(deleteAction).toBeVisible({ timeout: 10_000 });
    await humanClickVisible(deleteAction, { delayMs: 80, ...strictHumanOptions });
    await page.waitForTimeout(300);
  }
  await expect.poll(() => isActionablePopconfirm(popconfirm), { timeout: 10_000 }).toBeTruthy();
  await humanClickUntil(
      popconfirmConfirmButton(popconfirm),
      async () => await wanDialog.getByText('暂无数据').isVisible().catch(() => false),
      { attempts: 5, afterClickDelayMs: 500, ...strictHumanOptions },
  );
  await expect(wanDialog.getByText('暂无数据')).toBeVisible({ timeout: 10_000 });

  await humanClickUntil(
      wanDialog.getByRole('button', { name: '确 定' }),
      async () => !await wanDialog.isVisible().catch(() => false),
      { attempts: 5, afterClickDelayMs: 800, ...strictHumanOptions },
  );
  await expect(wanDialog).toBeHidden({ timeout: 10_000 });
  await humanClickUntil(
      page.getByTestId('site-save-button').nth(1),
      async () => await page.getByText('配置已保存').isVisible().catch(() => false),
      { attempts: 5, afterClickDelayMs: 300, ...strictHumanOptions },
  );
  await expect(page.getByText('配置已保存')).toBeVisible();

  await expect.poll(() => visibleStepTexts(recorderPage), { timeout: 25_000 }).toMatch(/WAN1|ha-wan-row-edit-action/);
  await humanClick(recorderPage.getByRole('button', { name: '停止录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText(/步骤检查|导出检查/);

  const flow = await exportBusinessFlowJsonLikeUser(recorderPage);
  await attachRecorderEvidence(testInfo, page, recorderPage, flow);
  expect(flow.artifacts.playwrightCode).toMatch(/wan-config-table|WAN1[\s\S]*HS专线[\s\S]*HS[\s\S]*Internet[\s\S]*IPv4/);
  if (flow.artifacts.playwrightCode.includes('wan-config-table'))
    expect(flow.artifacts.playwrightCode).toContain('data-row-key=\\"1\\"');
  else
    expect(flow.artifacts.playwrightCode).toMatch(/filter\(\{\s*hasText:\s*\/WAN1\[\\s\\S\]\*HS专线/);
  expect(flow.artifacts.playwrightCode).toContain('ha-wan-row-edit-action');
  expect(flow.artifacts.playwrightCode).toContain('ha-wan-transport-row-delete-action');
  expect(flow.artifacts.playwrightCode).not.toContain('await page.getByTestId("ha-wan-row-edit-action").click();');

  await replayGeneratedPlaywrightCode(context, flow.artifacts.playwrightCode, testInfo, {
    verify: async replayPage => {
      await expectWanConfigPage(replayPage, { sharedWanDuplicateEdit: true, expectWan1Transport: false });
      const wan1Row = replayPage.getByTestId('wan-config-table').locator('[data-row-key="1"]').first();
      await expect(wan1Row).not.toContainText('HS Internet', { timeout: 10_000 });
      await expect(replayPage.getByText('配置已保存')).toBeVisible({ timeout: 10_000 });
    },
    standalone: [
      `await expect(page.getByTestId("site-global-wan-section")).toContainText("WAN配置", { timeout: 10000 });`,
      `const wan1Row = page.getByTestId("wan-config-table").locator('[data-row-key="1"]').first();`,
      `await expect(wan1Row).not.toContainText("HS Internet", { timeout: 10000 });`,
      `await expect(page.getByText("配置已保存")).toBeVisible({ timeout: 10000 });`,
    ],
  });
});

test('human-like runtime replay skips redundant IPv4 field focus click @human-smoke', async ({ page, attachRecorder, baseURL }) => {
  test.setTimeout(120_000);
  const strictHumanOptions = { allowFallback: false as const };

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page, { mode: 'business-flow' });
  recorderPage.on('dialog', dialog => dialog.type() === 'prompt' ? dialog.accept('5') : dialog.accept());

  await beginNewFlowFromLibraryLikeUser(recorderPage);
  await fillFlowMetaLikeUser(recorderPage, '流程名称', '地址池 runtime replay');
  await fillFlowMetaLikeUser(recorderPage, '应用', 'AntD Pro');
  await fillFlowMetaLikeUser(recorderPage, '模块', '站点配置');
  await fillFlowMetaLikeUser(recorderPage, '页面', '全局配置');
  await fillFlowMetaLikeUser(recorderPage, '角色', 'admin');
  await humanClick(recorderPage.getByRole('button', { name: '保存并开始录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await page.goto(`${baseURL}/antd-pro-form-fields.html`);
  await attachRecorder(page, { mode: 'business-flow' });
  await expectAddressAndPortPoolsPage(page);

  const ipv4Dialog = page.locator('.ant-modal, .ant-drawer, [role="dialog"]').filter({ hasText: '新建IPv4地址池' });
  await humanClickUntil(
      page.getByTestId('site-ip-address-pool-create-button'),
      async () => await ipv4Dialog.isVisible().catch(() => false),
      { attempts: 5, afterClickDelayMs: 500, ...strictHumanOptions },
  );
  await expect(ipv4Dialog).toBeVisible({ timeout: 10_000 });

  await humanType(page.getByPlaceholder('地址池名称'), 'runtime-pool');
  const wanTrigger = ipv4Dialog.locator('.ant-form-item').filter({ hasText: 'WAN口' }).locator('.ant-select-selector').first();
  await selectAntdOptionLikeUser(page, wanTrigger, 'xtest16:WAN1', { searchText: 'xtest16', ...strictHumanOptions });
  await expect(ipv4Dialog.locator('.ant-form-item').filter({ hasText: 'WAN口' })).toContainText('xtest16:WAN1');

  await humanType(page.getByRole('textbox', { name: '开始地址，例如：' }), '1.1.1.1', { confirmWithFill: true });
  await humanType(page.getByRole('textbox', { name: '结束地址，例如：' }), '2.2.2.2', { confirmWithFill: true });
  await humanClickUntil(
      ipv4Dialog.getByRole('button', { name: '确 定' }),
      async () => !await ipv4Dialog.isVisible().catch(() => false),
      { attempts: 5, afterClickDelayMs: 800, ...strictHumanOptions },
  );
  await expect.poll(
      async () => await Promise.race([
        page.evaluate(() => document.querySelector('[data-testid="site-ip-address-pool-table"]')?.textContent || '').catch(() => ''),
        new Promise<string>(resolve => setTimeout(() => resolve(''), 1000)),
      ]),
      { timeout: 10_000 },
  ).toMatch(/runtime-pool[\s\S]*xtest16:WAN1[\s\S]*1\.1\.1\.1[\s\S]*2\.2\.2\.2/);
  await humanClick(page.getByTestId('site-save-button'));
  await expect(page.getByText('配置已保存')).toBeVisible();

  await expect.poll(() => visibleStepTexts(recorderPage), { timeout: 25_000 }).toContain('runtime-pool');
  await expect.poll(() => visibleStepTexts(recorderPage)).toContain('1.1.1.1');
  await humanClick(recorderPage.getByRole('button', { name: '停止录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText(/步骤检查|导出检查/);
  const flow = await exportBusinessFlowJsonLikeUser(recorderPage);
  expectTriggerOwnedAntdOptionReplay(
      flow.artifacts.playwrightCode,
      /const trigger = [\s\S]{0,520}(?:ipv4-address-pool-form|WAN口)[\s\S]{0,320}\.locator\(["'][^"']*\.ant-select-selector/,
      'xtest16:WAN1',
      'xtest16',
  );
  expect(flow.artifacts.playwrightCode).not.toMatch(/getByRole\(["']combobox["'],\s*\{\s*name:\s*["']\*? ?WAN口["']/);
  expect(flow.artifacts.playwrightCode).not.toContain('role=button[name="选择一个WAN口"');
  expect(flow.artifacts.playwrightCode).not.toContain('nth(4)');

  await page.goto(`${baseURL}/antd-pro-form-fields.html`);
  await attachRecorder(page, { mode: 'business-flow' });
  await expectAddressAndPortPoolsPage(page);
  await openReplayPanelLikeUser(recorderPage);
  const runtimeLogBaseline = await runtimeDiagnostics(recorderPage);
  await humanClick(recorderPage.getByTitle('Resume (F8)'));
  await expect.poll(async () => {
    const logs = await runtimeDiagnosticsAfter(recorderPage, runtimeLogBaseline);
    return logs.some(log => log.type === 'runtime.playback-stop');
  }, { timeout: 30_000 }).toBeTruthy();
  const replayRuntimeLogs = await runtimeDiagnosticsAfter(recorderPage, runtimeLogBaseline);
  expect(replayRuntimeLogs.filter(log => log.type.includes('error') || log.level === 'warn')).toEqual([]);
  await expect(page.getByRole('row', { name: /runtime-pool.*xtest16:WAN1.*1\.1\.1\.1.*2\.2\.2\.2/ })).toBeVisible({ timeout: 10_000 });
});

test('human-like runtime replay supports wait inserted between address and port pools @human-smoke', async ({ page, attachRecorder, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const strictHumanOptions = { allowFallback: false as const };

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page, { mode: 'business-flow' });
  recorderPage.on('dialog', dialog => dialog.type() === 'prompt' ? dialog.accept('5') : dialog.accept());

  await beginNewFlowFromLibraryLikeUser(recorderPage);
  await fillFlowMetaLikeUser(recorderPage, '流程名称', '地址池端口池 wait replay');
  await fillFlowMetaLikeUser(recorderPage, '应用', 'AntD Pro');
  await fillFlowMetaLikeUser(recorderPage, '模块', '站点配置');
  await fillFlowMetaLikeUser(recorderPage, '页面', '全局配置');
  await fillFlowMetaLikeUser(recorderPage, '角色', 'admin');
  await humanClick(recorderPage.getByRole('button', { name: '保存并开始录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await page.goto(`${baseURL}/antd-pro-form-fields.html?duplicateSaveButton=1`);
  await attachRecorder(page, { mode: 'business-flow' });
  await expectAddressAndPortPoolsPage(page);
  await expect(page.getByTestId('site-save-button')).toHaveCount(2);

  const ipv4Dialog = page.locator('.ant-modal, .ant-drawer, [role="dialog"]').filter({ hasText: '新建IPv4地址池' });
  await humanClickUntil(
      page.getByTestId('site-ip-address-pool-create-button'),
      async () => await ipv4Dialog.isVisible().catch(() => false),
      { attempts: 5, afterClickDelayMs: 500, ...strictHumanOptions },
  );
  await expect(ipv4Dialog).toBeVisible({ timeout: 10_000 });
  await humanType(ipv4Dialog.getByPlaceholder('地址池名称'), 'test1', { delayMs: 80, confirmWithFill: true });
  const wanTrigger = ipv4Dialog.locator('.ant-form-item').filter({ hasText: 'WAN口' }).locator('.ant-select-selector').first();
  await selectAntdOptionLikeUser(page, wanTrigger, 'xtest16:WAN1', { searchText: 'xtest16', ...strictHumanOptions });
  await expect(ipv4Dialog.locator('.ant-form-item').filter({ hasText: 'WAN口' })).toContainText('xtest16:WAN1');
  await humanType(page.getByRole('textbox', { name: '开始地址，例如：' }), '1.1.1.1', { confirmWithFill: true });
  await humanType(page.getByRole('textbox', { name: '结束地址，例如：' }), '2.2.2.2', { confirmWithFill: true });
  await humanClickUntil(
      ipv4Dialog.getByRole('button', { name: '确 定' }),
      async () => !await ipv4Dialog.isVisible().catch(() => false),
      { attempts: 5, afterClickDelayMs: 800, ...strictHumanOptions },
  );
  await expect(page.getByRole('row', { name: /test1.*xtest16:WAN1.*1\.1\.1\.1.*2\.2\.2\.2/ })).toBeVisible({ timeout: 10_000 });
  await humanClickUntil(
      page.getByTestId('site-save-button').nth(1),
      async () => await page.getByText('配置已保存').isVisible().catch(() => false),
      { attempts: 5, afterClickDelayMs: 300, ...strictHumanOptions },
  );
  await expect(page.getByText('配置已保存')).toBeVisible();

  const portDialog = page.locator('.ant-modal, .ant-drawer, [role="dialog"]').filter({ hasText: '新建IP端口地址池' });
  await humanClickUntil(
      page.getByTestId('site-ip-port-pool-create-button'),
      async () => await portDialog.isVisible().catch(() => false),
      { attempts: 8, afterClickDelayMs: 800, ...strictHumanOptions },
  );
  await expect(portDialog).toBeVisible({ timeout: 10_000 });
  await humanType(portDialog.getByPlaceholder('地址池名称'), 'test12', { delayMs: 80, confirmWithFill: true });
  const addressPoolTrigger = portDialog.locator('.ant-form-item').filter({ hasText: 'IP地址池' }).locator('.ant-select-selector').first();
  await selectAntdOptionLikeUser(page, addressPoolTrigger, 'test1 共享 1.1.1.1--2.2.2.2', { searchText: 'test1', ...strictHumanOptions });
  await expect(portDialog.locator('.ant-form-item').filter({ hasText: 'IP地址池' })).toContainText('test1');
  await expect(portDialog.locator('.ant-form-item').filter({ hasText: 'IP地址池' })).toContainText('共享');
  await expect(portDialog.locator('.ant-form-item').filter({ hasText: 'IP地址池' })).toContainText('1.1.1.1--2.2.2.2');
  await humanType(page.getByRole('textbox', { name: 'IP/前缀，例如：192.168.1.1或192.168.' }), '1.1.1.1');
  await humanType(page.getByRole('textbox', { name: '端口，例如：80,100-' }), '80');
  const vrfTrigger = portDialog.locator('.ant-form-item').filter({ hasText: '关联VRF' }).locator('.ant-select-selector').first();
  await selectAntdOptionLikeUser(page, vrfTrigger, 'default', strictHumanOptions);
  await expect(portDialog.locator('.ant-form-item').filter({ hasText: '关联VRF' })).toContainText('default');
  await humanClickUntil(
      portDialog.getByRole('button', { name: '确 定' }),
      async () => !await portDialog.isVisible().catch(() => false),
      { attempts: 5, afterClickDelayMs: 800, ...strictHumanOptions },
  );
  await expect(page.getByRole('row', { name: /test12.*test1 共享 1\.1\.1\.1--2\.2\.2\.2.*1\.1\.1\.1:80.*default/ })).toBeVisible({ timeout: 20_000 });
  await humanClick(page.getByTestId('site-save-button').nth(1));

  await expect.poll(() => visibleStepTexts(recorderPage), { timeout: 25_000 }).toContain('site-ip-port-pool-create-button');
  await expect.poll(() => visibleStepTexts(recorderPage)).toContain('test1');
  await expect.poll(() => visibleStepTexts(recorderPage)).toContain('default');
  await humanClick(recorderPage.getByRole('button', { name: '停止录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText(/步骤检查|导出检查/);

  let flow = await exportBusinessFlowJsonLikeUser(recorderPage);
  expect(flow.steps.some((step: any) => step.target?.testId === 'site-global-ip-pools-section')).toBeFalsy();
  expect(flow.artifacts.playwrightCode).not.toContain('site-global-ip-pools-section');
  const firstSaveStepId = requiredStepId(flow, (step: any) => step.target?.testId === 'site-save-button', 'first save config step');
  await openInsertMenuAfterStepLikeUser(recorderPage, firstSaveStepId, 'site-save-button');
  await humanClick(recorderPage.getByRole('button', { name: '插入等待' }));
  await expect(recorderPage.locator('.review-step-list')).toContainText('等待');

  flow = await exportBusinessFlowJsonLikeUser(recorderPage);
  await attachRecorderEvidence(testInfo, page, recorderPage, flow);
  const waitStepId = requiredStepId(flow, (step: any) => step.action === 'wait', 'inserted wait step');
  expect(stepIndex(flow, waitStepId)).toBe(stepIndex(flow, firstSaveStepId) + 1);
  expect(flow.artifacts.playwrightCode).toContain('waitForTimeout(5000)');
  expect(flow.artifacts.playwrightCode).toContain('site-ip-port-pool-create-button');
  expect(flow.artifacts.playwrightCode).not.toContain('.fill("2.2.")');
  expect(flow.artifacts.playwrightCode).toContain('.fill("2.2.2.2")');

  await page.goto(`${baseURL}/antd-pro-form-fields.html?duplicateSaveButton=1`);
  await attachRecorder(page, { mode: 'business-flow' });
  await expectAddressAndPortPoolsPage(page);
  await openReplayPanelLikeUser(recorderPage);
  const runtimeLogBaseline = await runtimeDiagnostics(recorderPage);
  await humanClick(recorderPage.getByTitle('Resume (F8)'));
  await expect.poll(async () => {
    const logs = await runtimeDiagnosticsAfter(recorderPage, runtimeLogBaseline);
    return logs.some(log => log.type === 'runtime.playback-stop');
  }, { timeout: 60_000 }).toBeTruthy();
  const replayRuntimeLogs = await runtimeDiagnosticsAfter(recorderPage, runtimeLogBaseline);
  expect(replayRuntimeLogs.filter(log => log.type.includes('error') || log.level === 'warn')).toEqual([]);
  await expect.poll(async () => await page.getByTestId('site-ip-port-pool-table').innerText().catch(() => ''), { timeout: 30_000 }).toMatch(/test12[\s\S]*test1[\s\S]*1\.1\.1\.1--2\.2\.2\.2[\s\S]*1\.1\.1\.1:80[\s\S]*default/);
});

test('human-like records IPv4 pool repeat flow and replays generated code @human-smoke', async ({ context, page, attachRecorder, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const benchmarkCase = loadBenchmarkCase('recorder_intent_repeat.json');
  expect(benchmarkCase.name).toBe('recorder_ipv4_pool_step_intent_repeat_data');
  const strictHumanOptions = { allowFallback: false as const };

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page, { mode: 'business-flow' });
  recorderPage.on('dialog', dialog => dialog.accept());

  await beginNewFlowFromLibraryLikeUser(recorderPage);
  await fillFlowMetaLikeUser(recorderPage, '流程名称', '地址池 human smoke');
  await fillFlowMetaLikeUser(recorderPage, '应用', 'AntD Pro');
  await fillFlowMetaLikeUser(recorderPage, '模块', '站点配置');
  await fillFlowMetaLikeUser(recorderPage, '页面', '全局配置');
  await fillFlowMetaLikeUser(recorderPage, '角色', 'admin');
  await humanClick(recorderPage.getByRole('button', { name: '保存并开始录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await page.goto(`${baseURL}/antd-pro-form-fields.html`);
  await attachRecorder(page, { mode: 'business-flow' });
  await expectAddressAndPortPoolsPage(page);

  await humanClick(page.getByTestId('site-ip-address-pool-create-button'));
  const ipv4Dialog = page.locator('.ant-modal, .ant-drawer, [role="dialog"]').filter({ hasText: '新建IPv4地址池' });
  await expect(ipv4Dialog).toBeVisible({ timeout: 10_000 });

  await humanType(page.getByPlaceholder('地址池名称'), 'test1');
  const wanTrigger = ipv4Dialog.locator('.ant-form-item').filter({ hasText: 'WAN口' }).locator('.ant-select-selector').first();
  await selectAntdOptionLikeUser(page, wanTrigger, 'xtest16:WAN1', { searchText: 'xtest16', ...strictHumanOptions });
  await expect(ipv4Dialog.locator('.ant-form-item').filter({ hasText: 'WAN口' })).toContainText('xtest16:WAN1');

  await humanType(page.getByRole('textbox', { name: '开始地址，例如：' }), '1.1.1.1');
  await humanType(page.getByRole('textbox', { name: '结束地址，例如：' }), '2.2.2.2');
  await humanClickUntil(
      ipv4Dialog.getByRole('button', { name: '确 定' }),
      async () => !await ipv4Dialog.isVisible().catch(() => false),
      { attempts: 5, afterClickDelayMs: 800, ...strictHumanOptions },
  );
  await expect(page.getByRole('row', { name: /test1.*xtest16:WAN1.*1\.1\.1\.1.*2\.2\.2\.2/ })).toBeVisible({ timeout: 10_000 });
  await humanClick(page.getByTestId('site-save-button'));
  await expect(page.getByText('配置已保存')).toBeVisible();

  await expect.poll(() => visibleStepTexts(recorderPage), { timeout: 25_000 }).toContain('site-ip-address-pool-create-button');
  await expect.poll(() => visibleStepTexts(recorderPage)).toContain('test1');
  await expect.poll(() => visibleStepTexts(recorderPage)).toMatch(/WAN口|选择一个WAN口|xtest16:WAN1/);

  await humanClick(recorderPage.getByRole('button', { name: '停止录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText(/步骤检查|导出检查/);

  await createRepeatSegmentLikeUser(recorderPage, {
    fromStepText: 'site-ip-address-pool-create-button',
    toStepText: 'ipv4-address-pool-confirm',
    segmentName: '批量创建IPv4地址池',
  });

  const flow = await exportBusinessFlowJsonLikeUser(recorderPage);
  await attachRecorderEvidence(testInfo, page, recorderPage, flow);

  expect(flow.flow.name).toBe('地址池 human smoke');
  expect(flow.repeatSegments?.[0]?.parameters.map((parameter: any) => parameter.variableName)).toEqual(expect.arrayContaining(['poolName', 'port', 'startIp', 'endIp']));
  expect(flow.repeatSegments?.[0]?.stepIds).not.toContain(flow.steps.find((step: any) => step.target?.testId === 'site-save-button')?.id);
  expect(flow.artifacts.playwrightCode).toContain('for (const row of');
  expect(flow.artifacts.playwrightCode).toContain('xtest16:WAN1');
  expect(flow.artifacts.playwrightCode).not.toMatch(/getByRole\(["']combobox["'],\s*\{\s*name:\s*["']WAN口["']/);
  expect(flow.artifacts.playwrightCode).not.toContain('#rc_select_');

  const ipv4Segment = flow.repeatSegments[0];
  const valueFor = (row: any, variableName: string) => {
    const parameter = [...ipv4Segment.parameters].reverse().find((parameter: any) => parameter.variableName === variableName || parameter.variableName.startsWith(variableName));
    return row.values[parameter?.id];
  };
  const ipv4TerminalRows = ipv4Segment.rows.map((row: any) => ({
    poolName: valueFor(row, 'poolName'),
    port: valueFor(row, 'port'),
    startIp: valueFor(row, 'startIp'),
    endIp: valueFor(row, 'endIp'),
  }));
  const ipv4ReplayVerification = [
    `const ipv4Table = page.getByTestId("site-ip-address-pool-table");`,
    ...ipv4TerminalRows.map(row => `await expect(ipv4Table.getByRole('row').filter({ hasText: /${[row.poolName, row.port, row.startIp, row.endIp].map(escapeRegExp).join('[\\s\\S]*')}/ })).toBeVisible({ timeout: 10000 });`),
    `await expect(page.getByRole('dialog', { name: '新建IPv4地址池' })).toBeHidden({ timeout: 10000 });`,
  ];
  await replayGeneratedPlaywrightCode(context, flow.artifacts.playwrightCode, testInfo, {
    verify: async replayPage => {
      const ipv4Table = replayPage.getByTestId('site-ip-address-pool-table');
      for (const row of ipv4TerminalRows) {
        const rowPattern = new RegExp([row.poolName, row.port, row.startIp, row.endIp].map(escapeRegExp).join('[\\s\\S]*'));
        await expect(ipv4Table.getByRole('row').filter({ hasText: rowPattern })).toBeVisible({ timeout: 10_000 });
      }
      await expect(replayPage.getByRole('dialog', { name: '新建IPv4地址池' })).toBeHidden({ timeout: 10_000 });
    },
    standalone: ipv4ReplayVerification,
  });
});

test('case-driven human-like records user admin modal repeat flow and replays generated code @human-smoke', async ({ context, page, attachRecorder, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const benchmarkCase = loadBenchmarkCase('user_admin_repeat.json');
  expect(benchmarkCase.name).toBe('recorder_user_admin_modal_repeat');
  const strictHumanOptions = { allowFallback: false as const };

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page, { mode: 'business-flow' });
  recorderPage.on('dialog', dialog => dialog.accept());

  await beginNewFlowFromLibraryLikeUser(recorderPage);
  await fillFlowMetaLikeUser(recorderPage, '流程名称', '用户管理 human smoke');
  await fillFlowMetaLikeUser(recorderPage, '应用', 'AntD');
  await fillFlowMetaLikeUser(recorderPage, '模块', '系统管理');
  await fillFlowMetaLikeUser(recorderPage, '页面', '用户列表');
  await fillFlowMetaLikeUser(recorderPage, '角色', 'admin');
  await humanClick(recorderPage.getByRole('button', { name: '保存并开始录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await page.goto(`${baseURL}/antd-users-real.html`);
  await expect(page.getByTestId('user-admin-card')).toContainText('用户管理');

  await humanClick(page.getByTestId('create-user-btn'));
  const userDialog = page.locator('.ant-modal, [role="dialog"]').filter({ hasText: '新建用户' });
  await expect(userDialog).toBeVisible({ timeout: 10_000 });

  const usernameInput = page.getByPlaceholder('请输入用户名');
  await humanType(usernameInput, 'alice.qa', { clear: true });
  await expect(usernameInput).toHaveValue('alice.qa');
  const roleTrigger = userDialog.locator('.ant-form-item').filter({ hasText: '角色' }).locator('.ant-select-selector').first();
  await selectAntdOptionLikeUser(page, roleTrigger, '审计员', strictHumanOptions);
  await expect(userDialog.locator('.ant-form-item').filter({ hasText: '角色' })).toContainText('审计员');

  await humanClick(userDialog.getByTestId('modal-confirm'));
  await waitUntil('user create dialog closes', async () => !await hasVisibleDialogText(page, '新建用户'), 10_000);
  await waitUntil('created alice.qa row is visible in users table', async () => /alice\.qa[\s\S]*审计员/.test(await boundedPageText(page, '[data-testid="user-admin-card"]')), 10_000);
  await waitUntil('alice.qa success toast is visible', async () => (await boundedBodyText(page)).includes('保存成功：alice.qa'), 10_000);

  await waitUntil('recorder captured create-user button', async () => (await visibleStepTexts(recorderPage)).includes('create-user-btn'), 25_000);
  await waitUntil('recorder captured alice.qa value', async () => (await visibleStepTexts(recorderPage)).includes('alice.qa'), 10_000);
  await waitUntil('recorder captured role selection', async () => /角色|审计员/.test(await visibleStepTexts(recorderPage)), 10_000);

  await humanClick(recorderPage.getByRole('button', { name: '停止录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText(/步骤检查|导出检查/);

  await createRepeatSegmentLikeUser(recorderPage, {
    fromStepText: 'create-user-btn',
    toStepText: 'modal-confirm',
    segmentName: '批量新建用户',
    minSteps: benchmarkCase.repeat_segment.selected_step_ids.length,
    expectedDataText: /alice|test|审计员/,
  });

  const flow = await exportBusinessFlowJsonLikeUser(recorderPage);
  await attachRecorderEvidence(testInfo, page, recorderPage, flow);

  expect(flow.flow.name).toBe('用户管理 human smoke');
  expect(flow.repeatSegments?.[0]?.parameters.map((parameter: any) => parameter.variableName)).toEqual(expect.arrayContaining(['username', 'role']));
  expect(flow.artifacts.playwrightCode).toContain('for (const row of');
  expect(flow.artifacts.playwrightCode).toContain('审计员');
  expect(flow.artifacts.playwrightCode).not.toContain('#rc_select_');

  const userSegment = flow.repeatSegments[0];
  const userValueFor = (row: any, variableName: string) => row.values[userSegment.parameters.find((parameter: any) => parameter.variableName === variableName)?.id];
  const userTerminalRows = userSegment.rows.map((row: any) => ({
    username: userValueFor(row, 'username'),
    role: userValueFor(row, 'role'),
  }));
  const userReplayVerification = [
    `const usersTable = page.getByTestId("users-table");`,
    ...userTerminalRows.map(row => `await expect(usersTable.getByRole('row').filter({ hasText: /${[row.username, row.role].map(escapeRegExp).join('[\\s\\S]*')}/ })).toBeVisible({ timeout: 10000 });`),
    `await expect(page.getByRole('dialog', { name: '新建用户' })).toBeHidden({ timeout: 10000 });`,
  ];
  await replayGeneratedPlaywrightCode(context, flow.artifacts.playwrightCode, testInfo, {
    verify: async replayPage => {
      const usersTable = replayPage.getByTestId('users-table');
      for (const row of userTerminalRows) {
        const rowPattern = new RegExp([row.username, row.role].map(escapeRegExp).join('[\\s\\S]*'));
        await expect(usersTable.getByRole('row').filter({ hasText: rowPattern })).toBeVisible({ timeout: 10_000 });
      }
      await expect(replayPage.getByRole('dialog', { name: '新建用户' })).toBeHidden({ timeout: 10_000 });
    },
    standalone: userReplayVerification,
  });
});

test('case-driven human-like records network resource complex form repeat flow and replays generated code @human-smoke', async ({ context, page, attachRecorder, baseURL }, testInfo) => {
  test.setTimeout(240_000);
  const benchmarkCase = loadBenchmarkCase('network_resource_repeat.json');
  expect(benchmarkCase.name).toBe('recorder_network_resource_complex_repeat');
  const strictHumanOptions = { allowFallback: false as const };

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page, { mode: 'business-flow' });
  recorderPage.on('dialog', dialog => dialog.accept());

  await beginNewFlowFromLibraryLikeUser(recorderPage);
  await fillFlowMetaLikeUser(recorderPage, '流程名称', '网络资源 human smoke');
  await fillFlowMetaLikeUser(recorderPage, '应用', 'AntD Pro');
  await fillFlowMetaLikeUser(recorderPage, '模块', '站点配置');
  await fillFlowMetaLikeUser(recorderPage, '页面', '全局配置');
  await fillFlowMetaLikeUser(recorderPage, '角色', 'admin');
  await humanClick(recorderPage.getByRole('button', { name: '保存并开始录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await page.goto(`${baseURL}/antd-pro-form-fields.html`);
  await attachRecorder(page, { mode: 'business-flow' });
  await expect(page.getByTestId('network-config-card')).toContainText('网络配置资源');

  await humanClick(page.getByTestId('network-resource-add'));
  const networkDialog = page.locator('.ant-modal, [role="dialog"]').filter({ hasText: '新建网络资源' });
  await expect(networkDialog).toBeVisible({ timeout: 10_000 });

  const resourceNameInput = page.getByPlaceholder('地址池名称');
  await humanType(resourceNameInput, 'res-web-01', { clear: true });
  await expect(resourceNameInput).toHaveValue('res-web-01');
  const wanTrigger = networkDialog.locator('.ant-form-item').filter({ hasText: 'WAN口' }).locator('.ant-select-selector').first();
  await selectAntdOptionLikeUser(page, wanTrigger, 'edge-lab:WAN1', { searchText: 'edge-lab', ...strictHumanOptions });
  await expect(networkDialog.locator('.ant-form-item').filter({ hasText: 'WAN口' })).toContainText('edge-lab:WAN1');

  const dedicatedPoolLabel = networkDialog.locator('label').filter({ hasText: '独享地址池' }).first();
  await humanClickVisible(dedicatedPoolLabel, { delayMs: 80, ...strictHumanOptions });
  await expect(networkDialog.locator('input[type="radio"][value="dedicated"]')).toBeChecked();

  const vrfTrigger = networkDialog.locator('.ant-form-item').filter({ hasText: '关联VRF' }).locator('.ant-select-selector').first();
  await selectAntdOptionLikeUser(page, vrfTrigger, '生产VRF', strictHumanOptions);
  await expect(networkDialog.locator('.ant-form-item').filter({ hasText: '关联VRF' })).toContainText('生产VRF');

  const healthUrl = page.getByPlaceholder('https://probe.example/health');
  const healthSwitch = networkDialog.getByTestId('network-resource-health-switch');
  for (let attempt = 0; attempt < 8 && !await healthUrl.isVisible().catch(() => false); attempt++) {
    await humanClickVisible(healthSwitch, { delayMs: 80, ...strictHumanOptions });
    await page.waitForTimeout(300);
  }
  await expect(healthUrl).toBeVisible({ timeout: 10_000 });
  await humanType(healthUrl, 'https://probe.example/health', { clear: true, delayMs: 80 });
  await healthUrl.fill('https://probe.example/health');
  await expect(healthUrl).toHaveValue('https://probe.example/health');

  const scopeTrigger = page.getByTestId('network-resource-scope-tree').locator('.ant-select-selector').first();
  await selectAntdTreeNodeLikeUser(page, scopeTrigger, '华东生产区', strictHumanOptions);
  await expect(networkDialog.locator('.ant-form-item').filter({ hasText: '发布范围' })).toContainText('华东生产区');

  const egressTrigger = page.getByTestId('network-resource-egress-cascader').locator('.ant-select-selector, .ant-cascader-picker').first();
  await selectAntdCascaderPathLikeUser(page, egressTrigger, ['上海', '一号机房', 'NAT集群A'], strictHumanOptions);
  await expect(networkDialog.locator('.ant-form-item').filter({ hasText: '出口路径' })).toContainText('NAT集群A');

  const serviceInput = page.getByPlaceholder('服务名称');
  await humanType(serviceInput, 'web');
  await serviceInput.fill('web');
  await expect(serviceInput).toHaveValue('web');
  const listenPortInput = page.getByPlaceholder('监听端口');
  await humanType(listenPortInput, '443', { clear: true, delayMs: 120 });
  await expect(listenPortInput).toHaveValue('443');
  const remarkInput = page.getByPlaceholder('填写策略备注');
  await humanType(remarkInput, '生产访问策略', { clear: true, delayMs: 160 });
  await remarkInput.fill('生产访问策略');
  await expect(remarkInput).toHaveValue('生产访问策略');
  await expect.poll(() => visibleStepTexts(recorderPage), { timeout: 15_000 }).toContain('生产访问策略');

  const networkTable = page.getByTestId('network-resource-table');
  const networkSaveButton = networkDialog.locator('[data-testid="network-resource-save"]');
  await expect(networkSaveButton).toBeVisible();
  await expect(networkSaveButton).toBeEnabled();
  for (let attempt = 0; attempt < 4 && await networkDialog.isVisible().catch(() => false); attempt++) {
    try {
      await networkSaveButton.click({ timeout: 5_000 });
    } catch (error) {
      if (!await networkDialog.isVisible().catch(() => false))
        break;
      throw error;
    }
    await page.waitForTimeout(500);
  }
  await expect(networkDialog).toBeHidden({ timeout: 10_000 });
  await expect(networkTable).toContainText('res-web-01', { timeout: 10_000 });
  await expect(networkTable).toContainText('edge-lab:WAN1');
  await expect(networkTable).toContainText('华东生产区');
  await expect(networkTable).toContainText('NAT集群A');
  await expect(networkTable).toContainText('启用');
  await expect(networkTable).toContainText('web:443');
  await expect(networkTable).toContainText('生产访问策略');

  await expect.poll(() => visibleStepTexts(recorderPage), { timeout: 25_000 }).toContain('network-resource-add');
  await expect.poll(() => visibleStepTexts(recorderPage)).toContain('res-web-01');
  await expect.poll(() => visibleStepTexts(recorderPage)).toContain('edge-lab:WAN1');
  await expect.poll(() => visibleStepTexts(recorderPage)).toContain('独享地址池');
  await expect.poll(() => visibleStepTexts(recorderPage)).toContain('生产VRF');
  await expect.poll(() => visibleStepTexts(recorderPage)).toContain('https://probe.example/health');
  await expect.poll(() => visibleStepTexts(recorderPage)).toContain('华东生产区');
  await expect.poll(() => visibleStepTexts(recorderPage)).toContain('NAT集群A');
  await expect.poll(() => visibleStepTexts(recorderPage)).toContain('生产访问策略');

  await humanClick(recorderPage.getByRole('button', { name: '停止录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText(/步骤检查|导出检查/);

  await createRepeatSegmentLikeUser(recorderPage, {
    fromStepText: 'network-resource-add',
    toStepText: 'network-resource-save',
    segmentName: '批量新建网络资源',
    minSteps: benchmarkCase.repeat_segment.selected_step_ids.length,
    expectedDataText: /res-web-01|edge-lab:WAN1|独享地址池|生产VRF|https:\/\/probe\.example\/health|web|生产访问策略/,
    requiredSelectedTexts: ['独享地址池', '华东生产区', 'NAT集群A', 'https://probe.example/health', '生产访问策略'],
  });

  const flow = await exportBusinessFlowJsonLikeUser(recorderPage);
  await attachRecorderEvidence(testInfo, page, recorderPage, flow);

  expect(flow.flow.name).toBe('网络资源 human smoke');
  const parameterNames = flow.repeatSegments?.[0]?.parameters.map((parameter: any) => parameter.variableName) || [];
  expect(parameterNames).toEqual(expect.arrayContaining(['resourceName', 'port', 'context', 'scope', 'path', 'listenPort', 'remark']));
  expect(flow.artifacts.playwrightCode).toContain('for (const row of');
  expect(flow.artifacts.playwrightCode).toContain('edge-lab:WAN1');
  expect(flow.artifacts.playwrightCode).toContain('独享地址池');
  expect(flow.artifacts.playwrightCode).toMatch(/locator\(['"]label['"]\)\.filter\(\{ hasText: "独享地址池" \}\)\.click\(\)/);
  expect(flow.artifacts.playwrightCode).toContain('NAT集群A');
  expect(flow.artifacts.playwrightCode).toContain('https://probe.example/health');
  expect(flow.artifacts.playwrightCode).toContain('443');
  expect(flow.artifacts.playwrightCode).toContain('生产访问策略');
  expect(flow.artifacts.playwrightCode).not.toContain('#rc_select_');

  const networkTerminalRowPattern = /res-web-01[\s\S]*edge-lab:WAN1[\s\S]*生产VRF[\s\S]*华东生产区[\s\S]*NAT集群A[\s\S]*web:443[\s\S]*生产访问策略/;
  const networkReplayVerificationLines = [
    `const table = page.getByTestId("network-resource-table");`,
    `await expect(table.getByRole('row').filter({ hasText: /res-web-01[\\s\\S]*edge-lab:WAN1[\\s\\S]*生产VRF[\\s\\S]*华东生产区[\\s\\S]*NAT集群A[\\s\\S]*web:443[\\s\\S]*生产访问策略/ })).toBeVisible({ timeout: 10000 });`,
  ];
  await replayGeneratedPlaywrightCode(context, flow.artifacts.playwrightCode, testInfo, {
    verify: async replayPage => {
      const table = replayPage.getByTestId('network-resource-table');
      await expect(table.getByRole('row').filter({ hasText: networkTerminalRowPattern })).toBeVisible({ timeout: 10_000 });
    },
    standalone: networkReplayVerificationLines,
  });
});

test('human-like records real WAN transport terminal states and replays terminal outcome @human-smoke', async ({ context, page, attachRecorder, baseURL }, testInfo) => {
  test.setTimeout(300_000);
  const strictHumanOptions = { allowFallback: false as const };

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page, { mode: 'business-flow' });
  recorderPage.on('dialog', dialog => dialog.type() === 'prompt' ? dialog.accept('5') : dialog.accept());

  await beginNewFlowFromLibraryLikeUser(recorderPage);
  await fillFlowMetaLikeUser(recorderPage, '流程名称', 'WAN 传输网络终态回放');
  await fillFlowMetaLikeUser(recorderPage, '应用', 'AntD Pro');
  await fillFlowMetaLikeUser(recorderPage, '模块', '站点配置');
  await fillFlowMetaLikeUser(recorderPage, '页面', 'WAN 传输网络');
  await fillFlowMetaLikeUser(recorderPage, '角色', '网络管理员');
  await humanClick(recorderPage.getByRole('button', { name: '保存并开始录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await page.goto(`${baseURL}/antd-wan-transport-real.html`);
  const transportTable = page.getByTestId('wan-transport-table');
  await expect(transportTable).toContainText('Nova 公网', { timeout: 10_000 });

  await humanClickUntil(
      page.getByTestId('wan-transport-add-button'),
      async () => await page.getByRole('dialog', { name: '增加传输网络' }).isVisible().catch(() => false),
      { attempts: 5, afterClickDelayMs: 300, ...strictHumanOptions },
  );
  const modal = page.getByRole('dialog', { name: '增加传输网络' });
  await expect(modal).toBeVisible({ timeout: 10_000 });

  await selectVisibleAntdOption(page, modal.getByTestId('wan-transport-select').locator('.ant-select-selector').first(), 'Nova 私网', strictHumanOptions);
  await expect(modal.getByTestId('wan-transport-select')).toContainText('Nova 私网');
  await selectVisibleAntdOption(page, modal.getByTestId('wan-transport-tags-select').locator('.ant-select-selector').first(), 'business', strictHumanOptions);
  await expect(modal.getByTestId('wan-transport-tags-select')).toContainText('business');
  await humanType(modal.getByTestId('wan-transport-egress-disable-threshold-input'), '3', { clear: true });
  await expect(modal.getByTestId('wan-transport-egress-disable-threshold-input')).toHaveValue('3');
  await expect(modal.getByTestId('wan-transport-select')).toContainText('Nova 私网');
  await expect(modal.getByTestId('wan-transport-tags-select')).toContainText('business');

  const modalOkButton = modal.locator('.ant-modal-footer').getByRole('button', { name: '确 定' });
  await expect(modalOkButton).toBeEnabled({ timeout: 10_000 });
  await humanClickUntil(
      modalOkButton,
      async () => await transportTable.locator('[data-row-key="nova_private"]').count() > 0,
      { attempts: 5, afterClickDelayMs: 500, ...strictHumanOptions },
  );
  const modalRoot = page.locator('[data-testid="wan-transport-modal"]');
  await expect(modalRoot).toBeHidden({ timeout: 10_000 });
  const novaPrivateRow = transportTable.locator('[data-row-key="nova_private"]').first();
  await expect(novaPrivateRow).toContainText('Nova 私网', { timeout: 10_000 });
  await expect(novaPrivateRow).toContainText('business');

  const popconfirm = deletePopconfirm(page);
  const deleteAction = novaPrivateRow.getByTestId('wan-transport-row-delete-action');
  for (let attempt = 0; attempt < 8 && !await isActionablePopconfirm(popconfirm); attempt++) {
    await novaPrivateRow.hover();
    await expect(deleteAction).toBeVisible({ timeout: 10_000 });
    await humanClickVisible(deleteAction, { delayMs: 80, ...strictHumanOptions });
    await page.waitForTimeout(300);
  }
  await expect.poll(() => isActionablePopconfirm(popconfirm), { timeout: 10_000 }).toBeTruthy();
  await humanClickUntil(
      popconfirmConfirmButton(popconfirm),
      async () => await novaPrivateRow.count() === 0,
      { attempts: 5, afterClickDelayMs: 500, ...strictHumanOptions },
  );
  await expect(novaPrivateRow).toHaveCount(0, { timeout: 10_000 });
  await expect(popconfirm).toBeHidden({ timeout: 10_000 });

  await expect.poll(() => visibleStepTexts(recorderPage), { timeout: 25_000 }).toContain('wan-transport-add-button');
  await expect.poll(() => visibleStepTexts(recorderPage)).toContain('Nova 私网');
  await expect.poll(() => visibleStepTexts(recorderPage)).toMatch(/删除|确定/);

  await humanClick(recorderPage.getByRole('button', { name: '停止录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText(/步骤检查|导出检查/);

  const flow = await exportBusinessFlowJsonLikeUser(recorderPage);
  await attachRecorderEvidence(testInfo, page, recorderPage, flow);
  const terminalTypes = flow.steps.flatMap((step: any) => (step.assertions || []).map((assertion: any) => assertion.type));
  expect(terminalTypes).toEqual(expect.arrayContaining(['modal-closed', 'selected-value-visible', 'popover-closed', 'row-not-exists']));
  expect(JSON.stringify(flow)).not.toContain('rawDiagnostics');
  expect(JSON.stringify(flow)).not.toContain('rawAction');
  expect(JSON.stringify(flow)).not.toContain('sourceCode');
  expect(flow.artifacts.playwrightCode).toContain('wan-transport-add-button');
  expect(flow.artifacts.playwrightCode).toContain('Nova 私网');
  expect(flow.artifacts.playwrightCode).toContain('wan-transport-row-delete-action');

  const terminalVerificationLines = [
    `const transportTable = page.getByTestId("wan-transport-table");`,
    `await expect(transportTable).toContainText("Nova 公网", { timeout: 10000 });`,
    `await expect(transportTable.locator('[data-row-key="nova_private"]')).toHaveCount(0, { timeout: 10000 });`,
    `await expect(page.locator(".ant-popover:not(.ant-popover-hidden):not(.ant-zoom-big-leave):not(.ant-zoom-big-leave-active)")).toHaveCount(0);`,
  ];
  await replayGeneratedPlaywrightCode(context, flow.artifacts.playwrightCode, testInfo, {
    verify: async replayPage => {
      const replayTable = replayPage.getByTestId('wan-transport-table');
      await expect(replayTable).toContainText('Nova 公网', { timeout: 10_000 });
      await expect(replayTable.locator('[data-row-key="nova_private"]')).toHaveCount(0, { timeout: 10_000 });
      await expect(replayPage.locator('.ant-popover:not(.ant-popover-hidden):not(.ant-zoom-big-leave):not(.ant-zoom-big-leave-active)')).toHaveCount(0);
    },
    standalone: terminalVerificationLines,
  });
});

async function selectVisibleAntdOption(page: Page, trigger: Locator, optionText: string, options: { allowFallback?: boolean } = {}) {
  await humanClick(trigger);
  const dropdown = page.locator('.ant-select-dropdown:visible').last();
  await expect(dropdown).toBeVisible({ timeout: 10_000 });
  const option = dropdown.locator('.ant-select-item-option').filter({ hasText: optionText }).first();
  await expect(option).toBeVisible({ timeout: 10_000 });
  await humanClickVisible(option, { delayMs: 80, allowFallback: options.allowFallback });
  await expect(trigger).toContainText(optionText, { timeout: 5_000 });
  await dropdown.waitFor({ state: 'hidden', timeout: 1500 }).catch(async () => {
    await page.keyboard.press('Escape').catch(() => {});
  });
}

function loadBenchmarkCase(fileName: string) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'benchmarks', 'agent_models', 'cases', fileName), 'utf8'));
}

type RuntimeDiagnostic = {
  id: number;
  type: string;
  level?: string;
  message?: string;
  data?: unknown;
};

async function runtimeDiagnostics(page: Page): Promise<RuntimeDiagnostic[]> {
  return await page.evaluate(() => {
    const logs = (window as typeof window & { __playwrightCrxRecorderDiagnostics?: RuntimeDiagnostic[] }).__playwrightCrxRecorderDiagnostics ?? [];
    return logs.filter(log => log.type.startsWith('runtime.'));
  });
}

async function runtimeDiagnosticsAfter(page: Page, baseline: RuntimeDiagnostic[]) {
  const maxBaselineId = baseline.reduce((max, log) => Math.max(max, log.id), 0);
  return (await runtimeDiagnostics(page)).filter(log => log.id > maxBaselineId);
}

async function expectAddressAndPortPoolsPage(page: Page) {
  await expect(page.locator('.ant-pro-card-title').filter({ hasText: '地址池与端口池' })).toBeVisible();
}

async function expectWanConfigPage(page: Page, options: { expectWan2Transport?: boolean; expectWan1Transport?: boolean; sharedWanDuplicateEdit?: boolean } = { expectWan2Transport: true }) {
  await expect(page.getByTestId('site-global-wan-section')).toContainText('WAN配置');
  if (options.sharedWanDuplicateEdit) {
    const wan1Row = page.getByTestId('wan-config-table').locator('[data-row-key="1"]').first();
    await expect(wan1Row).toContainText('WAN1', { timeout: 10_000 });
    await expect(wan1Row).toContainText('HS专线');
    if (options.expectWan1Transport !== false)
      await expect(wan1Row).toContainText('HS Internet');
    await expect(page.getByTestId('ha-wan-row-edit-action')).toHaveCount(2);
    return;
  }
  const wan2Row = page.getByTestId('wan-config-table').locator('[data-row-key="2"]').first();
  await expect(wan2Row).toContainText('WAN2', { timeout: 10_000 });
  if (options.expectWan2Transport !== false)
    await expect(wan2Row).toContainText('Nova专线');
  await expect(page.getByTestId('wan-edit-2')).toBeVisible({ timeout: 10_000 });
}

function requiredStepId(flow: any, predicate: (step: any) => boolean, description: string) {
  const step = flow.steps.find(predicate);
  if (!step)
    throw new Error(`Unable to find ${description} in exported flow: ${JSON.stringify(flow.steps.map((step: any) => ({ id: step.id, action: step.action, target: step.target, value: step.value })), null, 2)}`);
  return step.id;
}

function stepIndex(flow: any, stepId: string) {
  return flow.steps.findIndex((step: any) => step.id === stepId);
}

async function openInsertMenuAfterStepLikeUser(recorderPage: Page, stepId: string, fallbackText?: string) {
  await openStepCheckPanelLikeUser(recorderPage);
  let row = recorderPage.locator('.review-step-row').filter({ hasText: stepId }).first();
  if (!await row.isVisible().catch(() => false) && fallbackText)
    row = recorderPage.locator('.review-step-row').filter({ hasText: fallbackText }).first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  const insertButton = row.locator('xpath=following-sibling::*[contains(@class, "review-insert-slot")][1]//button').first();
  await expect(insertButton).toBeVisible({ timeout: 10_000 });
  await humanClick(insertButton);
  await expect(recorderPage.locator('.review-insert-popover')).toBeVisible({ timeout: 10_000 });
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function hasVisibleDialogText(page: Page, text: string) {
  return await Promise.race([
    page.evaluate(expected => Array.from(document.querySelectorAll('.ant-modal, [role="dialog"]')).some(element => {
      const htmlElement = element as HTMLElement;
      const style = getComputedStyle(htmlElement);
      const rect = htmlElement.getBoundingClientRect();
      return (htmlElement.textContent || '').includes(expected) &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0;
    }), text).catch(() => false),
    new Promise<boolean>(resolve => setTimeout(() => resolve(false), 1000)),
  ]);
}

async function boundedPageText(page: Page, selector: string) {
  return await Promise.race([
    page.evaluate(targetSelector => document.querySelector(targetSelector)?.textContent || '', selector).catch(() => ''),
    new Promise<string>(resolve => setTimeout(() => resolve(''), 1000)),
  ]);
}

async function boundedBodyText(page: Page) {
  return await Promise.race([
    page.evaluate(() => document.body?.textContent || '').catch(() => ''),
    new Promise<string>(resolve => setTimeout(() => resolve(''), 1000)),
  ]);
}

async function waitUntil(description: string, predicate: () => Promise<boolean>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate())
      return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function expectTriggerOwnedAntdOptionReplay(code: string, trigger: RegExp | string, optionText: string, searchText?: string) {
  const triggerIndex = typeof trigger === 'string' ? code.indexOf(trigger) : code.search(trigger);
  expect(triggerIndex, 'generated replay should use a stable AntD select trigger').toBeGreaterThanOrEqual(0);
  const tail = code.slice(triggerIndex);
  const blockEnd = tail.indexOf('})();');
  const block = blockEnd >= 0 ? tail.slice(0, blockEnd) : tail.slice(0, 5000);
  expect(block).toContain('selectOwnedOption');
  expect(block).toContain('if (!await selectOwnedOption(false))');
  expect(block).toContain('await selectOwnedOption(true);');
  expect(code).toContain(optionText);
  expect(block).toMatch(new RegExp(`const expectedText = (?:${escapeRegExp(JSON.stringify(optionText))}|String\\(row\\.[A-Za-z_$][\\w$]*\\));`));
  expect(block).toContain('aria-controls');
  expect(block).toContain('aria-owns');
  expect(block).toContain('aria-activedescendant');
  expect(block).toContain('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');
  expect(block).toContain('dispatchEvent(new MouseEvent("mousedown"');
  if (searchText) {
    expect(block).toContain(`const searchText = ${JSON.stringify(searchText)};`);
    expect(block).toContain('.fill(searchText);');
  }
  expect(block).not.toContain('.ant-select-dropdown:visible, .ant-cascader-dropdown:visible');
  expect(code).not.toMatch(new RegExp(`page\\.getByText\\(["']${escapeRegExp(optionText)}["']\\)\\.click\\(\\)`));
  expect(code).not.toMatch(new RegExp(`getByTitle\\(["']${escapeRegExp(optionText)}["']\\)`));
  expect(code).not.toContain('#rc_select_');
}
