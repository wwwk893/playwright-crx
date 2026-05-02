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

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { BrowserContext, Page } from 'playwright-core';
import type { TestInfo } from '@playwright/test';
import { dumpLogHeaders, test, expect } from './crxRecorderTest';
import {
  attachRecorderEvidence,
  beginNewFlowFromLibraryLikeUser,
  createRepeatSegmentLikeUser,
  exportBusinessFlowJsonLikeUser,
  fillFlowMetaLikeUser,
  humanClick,
  humanClickUntil,
  humanType,
  selectAntdCascaderPathLikeUser,
  selectAntdOptionLikeUser,
  selectAntdTreeNodeLikeUser,
  visibleStepTexts,
} from './humanLike';

test.describe.configure({ mode: 'serial' });

test('human-like records IPv4 pool repeat flow and replays generated code @human-smoke', async ({ context, page, attachRecorder, baseURL }, testInfo) => {
  test.setTimeout(300_000);
  const benchmarkCase = loadBenchmarkCase('recorder_intent_repeat.json');
  expect(benchmarkCase.name).toBe('recorder_ipv4_pool_step_intent_repeat_data');

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page);
  recorderPage.on('dialog', dialog => dialog.accept());

  await beginNewFlowFromLibraryLikeUser(recorderPage);
  await fillFlowMetaLikeUser(recorderPage, '流程名称', '地址池 human smoke');
  await fillFlowMetaLikeUser(recorderPage, '应用', 'AntD Pro');
  await fillFlowMetaLikeUser(recorderPage, '模块', '站点配置');
  await fillFlowMetaLikeUser(recorderPage, '页面', '全局配置');
  await fillFlowMetaLikeUser(recorderPage, '角色', 'admin');
  await humanClick(recorderPage.getByRole('button', { name: '创建并开始录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await page.goto(`${baseURL}/antd-pro-form-fields.html`);
  await expect(page.getByText('地址池与端口池')).toBeVisible({ timeout: 10000 });

  await humanClick(page.getByTestId('site-ip-address-pool-create-button'));
  const ipv4Dialog = page.locator('.ant-modal, .ant-drawer, [role="dialog"]').filter({ hasText: '新建IPv4地址池' });
  await expect(ipv4Dialog).toBeVisible({ timeout: 10_000 });

  await humanType(page.getByPlaceholder('地址池名称'), 'test1', { delayMs: 80 });
  const wanTrigger = ipv4Dialog.locator('.ant-form-item').filter({ hasText: 'WAN口' }).locator('.ant-select-selector').first();
  await selectAntdOptionLikeUser(page, wanTrigger, 'xtest16:WAN1', { searchText: 'xtest16' });
  await expect(ipv4Dialog.locator('.ant-form-item').filter({ hasText: 'WAN口' })).toContainText('xtest16:WAN1');

  await humanType(page.getByRole('textbox', { name: '开始地址，例如：' }), '1.1.1.1');
  await humanType(page.getByRole('textbox', { name: '结束地址，例如：' }), '2.2.2.2');
  await humanClickUntil(
      ipv4Dialog.getByRole('button', { name: '确 定' }),
      async () => !await ipv4Dialog.isVisible().catch(() => false),
      { attempts: 8, afterClickDelayMs: 1000 },
  );
  await expect(page.getByRole('row', { name: /test1.*xtest16:WAN1.*1\.1\.1\.1.*2\.2\.2\.2/ })).toBeVisible({ timeout: 10_000 });
  await humanClick(page.getByTestId('site-save-button'));
  await expect(page.getByText('配置已保存')).toBeVisible({ timeout: 10000 });

  await expect.poll(() => visibleStepTexts(recorderPage), { timeout: 25_000 }).toContain('site-ip-address-pool-create-button');
  await expect.poll(() => visibleStepTexts(recorderPage)).toContain('test1');
  await expect.poll(() => visibleStepTexts(recorderPage)).toMatch(/WAN口|选择一个WAN口|xtest16:WAN1/);

  await humanClick(recorderPage.getByRole('button', { name: '停止录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('复查');

  await addElementAssertionLikeUser(recorderPage, {
    stepText: 'site-save-button',
    assertionType: 'textContains',
    targetText: 'css=body',
    expectedText: 'test1',
  });
  await returnToReviewAfterAssertionLikeUser(recorderPage);

  await createRepeatSegmentLikeUser(recorderPage, {
    fromStepText: 'site-ip-address-pool-create-button',
    toStepText: 'ipv4-address-pool-confirm',
    segmentName: '批量创建IPv4地址池',
  });

  const flow = await exportBusinessFlowJsonLikeUser(recorderPage);
  await attachRecorderEvidence(testInfo, page, recorderPage, flow);

  expect(flow.flow.name).toBe('地址池 human smoke');
  expect(flow.repeatSegments?.[0]?.parameters.map((parameter: any) => parameter.variableName)).toEqual(expect.arrayContaining(['poolName', 'wanPort', 'startIp', 'endIp']));
  expect(flow.repeatSegments?.[0]?.stepIds).not.toContain(flow.steps.find((step: any) => step.target?.testId === 'site-save-button')?.id);
  expect(flow.artifacts.playwrightCode).toContain('for (const row of');
  expect(flow.artifacts.playwrightCode).toContain('xtest16:WAN1');
  expectEnabledAssertion(flow, {
    subject: 'element',
    type: 'textContains',
    expected: 'test1',
    selector: 'css=body',
  });
  expect(flow.artifacts.playwrightCode).toContain("page.locator('body')");
  expect(flow.artifacts.playwrightCode).toContain('toContainText("test1", { timeout: 10000 });');
  expect(flow.artifacts.playwrightCode).not.toMatch(/getByRole\(["']combobox["'],\s*\{\s*name:\s*["']WAN口["']/);
  expect(flow.artifacts.playwrightCode).not.toContain('#rc_select_');

  await playBusinessFlowInPluginLikeUser(recorderPage, page, {
    orderedMarkers: [
      /Navigate|Goto|Open/i,
      /site-ip-address-pool-create-button|新建IPv4地址池/i,
      /test1/,
      /xtest16:WAN1/,
      /1\.1\.1\.1/,
      /2\.2\.2\.2/,
      /Expect[\s\S]*✅/,
    ],
  });
  await replayGeneratedPlaywrightCode(context, flow.artifacts.playwrightCode, testInfo);
});

test('case-driven human-like records user admin modal repeat flow and replays generated code @human-smoke', async ({ context, page, attachRecorder, baseURL }, testInfo) => {
  test.setTimeout(300_000);
  const benchmarkCase = loadBenchmarkCase('user_admin_repeat.json');
  expect(benchmarkCase.name).toBe('recorder_user_admin_modal_repeat');

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page);
  recorderPage.on('dialog', dialog => dialog.accept());

  await beginNewFlowFromLibraryLikeUser(recorderPage);
  await fillFlowMetaLikeUser(recorderPage, '流程名称', '用户管理 human smoke');
  await fillFlowMetaLikeUser(recorderPage, '应用', 'AntD');
  await fillFlowMetaLikeUser(recorderPage, '模块', '系统管理');
  await fillFlowMetaLikeUser(recorderPage, '页面', '用户列表');
  await fillFlowMetaLikeUser(recorderPage, '角色', 'admin');
  await humanClick(recorderPage.getByRole('button', { name: '创建并开始录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await page.goto(`${baseURL}/antd-users-real.html`);
  await expect(page.getByTestId('user-admin-card')).toContainText('用户管理');

  await humanClick(page.getByTestId('create-user-btn'));
  const userDialog = page.locator('.ant-modal, [role="dialog"]').filter({ hasText: '新建用户' });
  await expect(userDialog).toBeVisible({ timeout: 10_000 });

  await humanType(page.getByPlaceholder('请输入用户名'), 'alice.qa');
  const roleTrigger = userDialog.locator('.ant-form-item').filter({ hasText: '角色' }).locator('.ant-select-selector').first();
  await selectAntdOptionLikeUser(page, roleTrigger, '审计员');
  await expect(userDialog.locator('.ant-form-item').filter({ hasText: '角色' })).toContainText('审计员');

  await humanClickUntil(
      userDialog.getByTestId('modal-confirm'),
      async () => !await userDialog.isVisible().catch(() => false),
  );
  await expect(userDialog).not.toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('row', { name: /alice\.qa.*审计员/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('保存成功：alice.qa')).toBeVisible({ timeout: 10000 });

  await expect.poll(() => visibleStepTexts(recorderPage), { timeout: 25_000 }).toContain('create-user-btn');
  await expect.poll(() => visibleStepTexts(recorderPage)).toContain('alice.qa');
  await expect.poll(() => visibleStepTexts(recorderPage)).toMatch(/角色|审计员/);

  await humanClick(recorderPage.getByRole('button', { name: '停止录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('复查');

  await addElementAssertionLikeUser(recorderPage, {
    stepText: 'alice.qa',
    assertionType: 'valueEquals',
    targetText: 'css=input[placeholder="请输入用户名"]',
    expectedText: 'alice.qa',
  });
  await returnToReviewAfterAssertionLikeUser(recorderPage);

  await addTableRowExistsAssertionLikeUser(recorderPage, {
    stepText: 'modal-confirm',
    tableArea: 'testid:users-table',
    rowKeyword: 'alice.qa',
  });
  await returnToReviewAfterAssertionLikeUser(recorderPage);

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
  expectEnabledAssertion(flow, {
    subject: 'element',
    type: 'valueEquals',
    expected: 'alice.qa',
    selector: 'css=input[placeholder="请输入用户名"]',
  });
  expectEnabledAssertion(flow, {
    subject: 'table',
    type: 'tableRowExists',
    expected: 'alice.qa',
    selector: 'testid:users-table',
    params: { rowKeyword: 'alice.qa' },
  });
  expect(flow.artifacts.playwrightCode).toContain('toHaveValue(String(row.username), { timeout: 10000 });');
  expect(flow.artifacts.playwrightCode).toContain('page.getByTestId("users-table")');
  expect(flow.artifacts.playwrightCode).toContain("getByRole('row').filter({ hasText: \"alice.qa\" })");
  expect(flow.artifacts.playwrightCode).toContain('toBeVisible({ timeout: 10000 });');
  expect(flow.artifacts.playwrightCode).not.toContain('#rc_select_');

  await playBusinessFlowInPluginLikeUser(recorderPage, page, {
    orderedMarkers: [
      /Navigate|Goto|Open/i,
      /create-user-btn|新建用户/i,
      /alice\.qa/,
      /审计员/,
      /Expect[\s\S]*✅/,
    ],
  });
  await replayGeneratedPlaywrightCode(context, flow.artifacts.playwrightCode, testInfo);
});

test('case-driven human-like records network resource complex form repeat flow and replays generated code @human-smoke', async ({ context, page, attachRecorder, baseURL }, testInfo) => {
  test.setTimeout(300_000);
  const benchmarkCase = loadBenchmarkCase('network_resource_repeat.json');
  expect(benchmarkCase.name).toBe('recorder_network_resource_complex_repeat');

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page);
  recorderPage.on('dialog', dialog => dialog.accept());

  await beginNewFlowFromLibraryLikeUser(recorderPage);
  await fillFlowMetaLikeUser(recorderPage, '流程名称', '网络资源 human smoke');
  await fillFlowMetaLikeUser(recorderPage, '应用', 'AntD Pro');
  await fillFlowMetaLikeUser(recorderPage, '模块', '站点配置');
  await fillFlowMetaLikeUser(recorderPage, '页面', '全局配置');
  await fillFlowMetaLikeUser(recorderPage, '角色', 'admin');
  await humanClick(recorderPage.getByRole('button', { name: '创建并开始录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await page.goto(`${baseURL}/antd-pro-form-fields.html`);
  await expect(page.getByTestId('network-config-card')).toContainText('网络配置资源');

  await humanClick(page.getByTestId('network-resource-add'));
  const networkDialog = page.locator('.ant-modal, [role="dialog"]').filter({ hasText: '新建网络资源' });
  await expect(networkDialog).toBeVisible({ timeout: 10_000 });

  await humanType(page.getByPlaceholder('地址池名称'), 'res-web-01');
  const wanTrigger = networkDialog.locator('.ant-form-item').filter({ hasText: 'WAN口' }).locator('.ant-select-selector').first();
  await selectAntdOptionLikeUser(page, wanTrigger, 'edge-lab:WAN1', { searchText: 'edge-lab' });
  await expect(networkDialog.locator('.ant-form-item').filter({ hasText: 'WAN口' })).toContainText('edge-lab:WAN1');

  const vrfTrigger = networkDialog.locator('.ant-form-item').filter({ hasText: '关联VRF' }).locator('.ant-select-selector').first();
  await selectAntdOptionLikeUser(page, vrfTrigger, '生产VRF');
  await expect(networkDialog.locator('.ant-form-item').filter({ hasText: '关联VRF' })).toContainText('生产VRF');

  await humanClick(networkDialog.getByText('开启代理ARP'));
  const healthUrl = networkDialog.getByPlaceholder('https://probe.example/health');
  await humanClickUntil(
      networkDialog.getByText('启用健康检查'),
      async () => await healthUrl.isVisible().catch(() => false),
      { attempts: 6, afterClickDelayMs: 500 },
  );
  await humanType(healthUrl, 'https://probe.example/health');

  const scopeTrigger = page.getByTestId('network-resource-scope-tree').locator('.ant-select-selector').first();
  await selectAntdTreeNodeLikeUser(page, scopeTrigger, '华东生产区');
  await expect(networkDialog.locator('.ant-form-item').filter({ hasText: '发布范围' })).toContainText('华东生产区');

  const egressTrigger = page.getByTestId('network-resource-egress-cascader').locator('.ant-select-selector, .ant-cascader-picker').first();
  await selectAntdCascaderPathLikeUser(page, egressTrigger, ['上海', '一号机房', 'NAT集群A']);
  await expect(networkDialog.locator('.ant-form-item').filter({ hasText: '出口路径' })).toContainText('NAT集群A');

  await humanType(networkDialog.getByPlaceholder('服务名称'), 'web');
  await expect(networkDialog.getByPlaceholder('服务名称')).toHaveValue('web');
  await humanType(networkDialog.getByPlaceholder('监听端口'), '443');
  await expect(networkDialog.getByPlaceholder('监听端口')).toHaveValue('443');

  const networkTable = page.getByTestId('network-resource-table');
  const networkSaveButton = networkDialog.getByTestId('network-resource-save');
  let networkSaveFallbackUsed = false;
  await page.keyboard.press('Escape').catch(() => {});
  await page.locator('.ant-select-dropdown:visible, .ant-cascader-dropdown:visible').waitFor({ state: 'hidden', timeout: 800 }).catch(() => {});
  const networkSaved = async () => !await networkDialog.isVisible().catch(() => false) || await networkTable.innerText().then(text => text.includes('res-web-01')).catch(() => false);
  await humanClickUntil(
      networkSaveButton,
      networkSaved,
      { attempts: 4, afterClickDelayMs: 800 },
  ).catch(async error => {
    networkSaveFallbackUsed = true;
    await networkSaveButton.click({ timeout: 2_000 }).catch(() => {});
    await page.waitForTimeout(1000);
    if (await networkSaved())
      return;
    const footerSaveButton = networkDialog.locator('.ant-modal-footer button').filter({ hasText: '保存' }).last();
    await humanClick(footerSaveButton, { position: 'left' }).catch(() => {});
    await page.waitForTimeout(1000);
    if (await networkSaved())
      return;
    await networkSaveButton.focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(1000);
    if (await networkSaved())
      return;
    await networkSaveButton.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);
    if (await networkSaved())
      return;
    const debug = await page.evaluate(() => ({
      errors: Array.from(document.querySelectorAll('.ant-form-item-explain-error')).map(element => element.textContent),
      modalText: document.querySelector('[data-testid="network-resource-modal"]')?.textContent,
      tableText: document.querySelector('[data-testid="network-resource-table"]')?.textContent,
      saveVisible: !!document.querySelector('[data-testid="network-resource-save"]'),
    }));
    throw new Error(`Network resource save did not complete after retries. Last form state: ${JSON.stringify(debug)}`);
  });
  await testInfo.attach('network-save-fallback-used', {
    body: String(networkSaveFallbackUsed),
    contentType: 'text/plain',
  });
  expect(networkSaveFallbackUsed, 'network resource save should complete through humanClickUntil without silent locator/keyboard fallback').toBe(false);
  await expect(networkTable).toContainText('res-web-01', { timeout: 10_000 });
  await expect(networkTable).toContainText('edge-lab:WAN1');
  await expect(networkTable).toContainText('华东生产区');
  await expect(networkTable).toContainText('NAT集群A');
  await expect(networkTable).toContainText('web:443');

  await expect.poll(() => visibleStepTexts(recorderPage), { timeout: 25_000 }).toContain('network-resource-add');
  await expect.poll(() => visibleStepTexts(recorderPage)).toContain('res-web-01');
  await expect.poll(() => visibleStepTexts(recorderPage)).toMatch(/edge-lab:WAN1|生产VRF|华东生产区|NAT集群A/);

  await humanClick(recorderPage.getByRole('button', { name: '停止录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('复查');

  await addElementAssertionLikeUser(recorderPage, {
    stepText: 'network-resource-save',
    targetText: '[data-testid="network-resource-table"] tr:has-text("res-web-01")',
    expectedText: 'res-web-01',
  });
  await returnToReviewAfterAssertionLikeUser(recorderPage);

  await createRepeatSegmentLikeUser(recorderPage, {
    fromStepText: 'network-resource-add',
    toStepText: 'network-resource-save',
    segmentName: '批量新建网络资源',
    minSteps: benchmarkCase.repeat_segment.selected_step_ids.length,
    expectedDataText: /res-web-01|edge-lab:WAN1|生产VRF|web/,
  });

  const flow = await exportBusinessFlowJsonLikeUser(recorderPage);
  await attachRecorderEvidence(testInfo, page, recorderPage, flow);

  expect(flow.flow.name).toBe('网络资源 human smoke');
  expect(flow.repeatSegments?.[0]?.parameters.map((parameter: any) => parameter.variableName)).toEqual(expect.arrayContaining(['resourceName', 'wanPort', 'vrf', 'egressPath', 'serviceName', 'listenPort']));
  expect(flow.artifacts.playwrightCode).toContain('for (const row of');
  expect(flow.artifacts.playwrightCode).toContain('edge-lab:WAN1');
  expect(flow.artifacts.playwrightCode).toContain('华东生产区');
  expect(flow.artifacts.playwrightCode).toContain('NAT集群A');
  expectEnabledAssertion(flow, {
    subject: 'element',
    type: 'visible',
    expected: 'res-web-01',
    selector: '[data-testid="network-resource-table"] tr:has-text("res-web-01")',
  });
  expect(flow.artifacts.playwrightCode).toContain('page.locator(\'[data-testid="network-resource-table"] tr:has-text("res-web-01")\')');
  expect(flow.artifacts.playwrightCode).toContain('toBeVisible({ timeout: 10000 });');
  expect(flow.artifacts.playwrightCode).not.toContain('#rc_select_');

  await playBusinessFlowInPluginLikeUser(recorderPage, page, {
    orderedMarkers: [
      /Navigate|Goto|Open/i,
      /network-resource-add|新建网络资源/i,
      /res-web-01/,
      /edge-lab:WAN1/,
      /生产VRF/,
      /华东生产区/,
      /NAT集群A/,
      /web/,
      /443/,
      /Expect[\s\S]*✅/,
    ],
  });
  await replayGeneratedPlaywrightCode(context, flow.artifacts.playwrightCode, testInfo);
});

test('human-like business assertion failure is surfaced in plugin playback log @human-smoke', async ({ page, attachRecorder, baseURL }, testInfo) => {
  test.setTimeout(120_000);

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page);
  recorderPage.on('dialog', dialog => dialog.accept());

  await beginNewFlowFromLibraryLikeUser(recorderPage);
  await fillFlowMetaLikeUser(recorderPage, '流程名称', '断言失败 human smoke');
  await fillFlowMetaLikeUser(recorderPage, '应用', 'AntD');
  await fillFlowMetaLikeUser(recorderPage, '模块', '断言');
  await fillFlowMetaLikeUser(recorderPage, '页面', '负向路径');
  await fillFlowMetaLikeUser(recorderPage, '角色', 'qa');
  await humanClick(recorderPage.getByRole('button', { name: '创建并开始录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await page.goto(`${baseURL}/antd-users-real.html`);
  await expect(page.getByTestId('user-admin-card')).toContainText('用户管理');
  await expect.poll(() => visibleStepTexts(recorderPage), { timeout: 20_000 }).toContain('antd-users-real.html');
  await humanClick(recorderPage.getByRole('button', { name: '停止录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('复查');

  await addElementAssertionLikeUser(recorderPage, {
    stepText: 'antd-users-real.html',
    assertionType: 'textContains',
    targetText: 'css=body',
    expectedText: 'definitely-missing-assertion-text',
  });
  await returnToReviewAfterAssertionLikeUser(recorderPage);

  const flow = await exportBusinessFlowJsonLikeUser(recorderPage);
  await attachRecorderEvidence(testInfo, page, recorderPage, flow);
  expectEnabledAssertion(flow, {
    subject: 'element',
    type: 'textContains',
    expected: 'definitely-missing-assertion-text',
    selector: 'css=body',
  });
  expect(flow.artifacts.playwrightCode).toContain('toContainText("definitely-missing-assertion-text", { timeout: 10000 });');

  await expectBusinessFlowPlaybackFailureLikeUser(recorderPage, page, /definitely-missing-assertion-text|Expect[\s\S]*❌/);
});

test('human-like restores latest draft with assertions from library after reload @human-smoke', async ({ context, page, attachRecorder, extensionId, baseURL }, testInfo) => {
  test.setTimeout(150_000);

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page);
  recorderPage.on('dialog', dialog => dialog.accept());

  await beginNewFlowFromLibraryLikeUser(recorderPage);
  await fillFlowMetaLikeUser(recorderPage, '流程名称', '草稿恢复 human smoke');
  await fillFlowMetaLikeUser(recorderPage, '应用', 'AntD');
  await fillFlowMetaLikeUser(recorderPage, '模块', '草稿');
  await fillFlowMetaLikeUser(recorderPage, '页面', '恢复');
  await fillFlowMetaLikeUser(recorderPage, '角色', 'qa');
  await humanClick(recorderPage.getByRole('button', { name: '创建并开始录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await page.goto(`${baseURL}/antd-users-real.html`);
  await expect(page.getByTestId('user-admin-card')).toContainText('用户管理');
  await expect.poll(() => visibleStepTexts(recorderPage), { timeout: 20_000 }).toContain('antd-users-real.html');
  await humanClick(recorderPage.getByRole('button', { name: '停止录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('复查');

  await addElementAssertionLikeUser(recorderPage, {
    stepText: 'antd-users-real.html',
    assertionType: 'textContains',
    targetText: 'css=body',
    expectedText: '用户管理',
  });
  await returnToReviewAfterAssertionLikeUser(recorderPage);
  await humanClick(recorderPage.getByRole('button', { name: '保存为草稿' }));
  await expect.poll(async () => await recorderPage.locator('.flow-title-row').innerText(), { timeout: 15_000 }).toContain('草稿恢复 human smoke');
  await recorderPage.waitForTimeout(800);

  await humanClick(recorderPage.locator('.flow-detail-back').filter({ hasText: '返回流程库' }));
  await expect(recorderPage.locator('.flow-library')).toBeVisible({ timeout: 10_000 });
  await recorderPage.close();
  const restoredRecorderPage = await context.newPage();
  await restoredRecorderPage.goto(`chrome-extension://${extensionId}/index.html`);
  restoredRecorderPage.on('dialog', dialog => dialog.accept());
  await expect(restoredRecorderPage.locator('.flow-library')).toBeVisible({ timeout: 20_000 });
  await humanClick(restoredRecorderPage.getByRole('button', { name: '恢复最近草稿' }));
  await expect(restoredRecorderPage.locator('.recording-status')).toContainText('复查', { timeout: 20_000 });
  await expect(restoredRecorderPage.locator('.flow-title-row')).toContainText('草稿恢复 human smoke');
  await expect(restoredRecorderPage.locator('.review-step-row').filter({ hasText: 'antd-users-real.html' })).toContainText('1 个断言');

  const flow = await exportBusinessFlowJsonLikeUser(restoredRecorderPage);
  await attachRecorderEvidence(testInfo, page, restoredRecorderPage, flow);
  expect(flow.flow.name).toBe('草稿恢复 human smoke');
  expectEnabledAssertion(flow, {
    subject: 'element',
    type: 'textContains',
    expected: '用户管理',
    selector: 'css=body',
  });
});

async function addElementAssertionLikeUser(recorderPage: Page, options: { stepText: string, targetText: string, expectedText: string, assertionType?: 'visible' | 'textContains' | 'textEquals' | 'valueEquals' }) {
  await humanClick(await addAssertionButtonForStep(recorderPage, options.stepText));

  const drawer = recorderPage.locator('.assertion-drawer');
  await expect(drawer).toBeVisible({ timeout: 10_000 });
  await humanClick(drawer.locator('.assertion-object-grid button').filter({ hasText: '页面元素' }));
  await drawer.locator('label').filter({ hasText: '断言类型' }).locator('select').selectOption(options.assertionType ?? 'visible');
  await humanType(drawer.locator('label').filter({ hasText: '目标元素' }).locator('input'), options.targetText, { clear: true });
  await humanType(drawer.locator('label').filter({ hasText: '预期值' }).locator('input'), options.expectedText, { clear: true });
  await humanClick(drawer.getByRole('button', { name: '保存断言' }));
  await expect(recorderPage.locator('.assertion-chip.enabled').filter({ hasText: options.expectedText })).toBeVisible({ timeout: 10_000 });
}

async function returnToReviewAfterAssertionLikeUser(recorderPage: Page) {
  await humanClick(recorderPage.getByRole('button', { name: '停止录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('复查');
}

type PlaybackMarker = string | RegExp;

type ExpectedEnabledAssertion = {
  subject: string;
  type: string;
  expected?: string;
  selector?: string;
  params?: Record<string, string>;
};

async function addTableRowExistsAssertionLikeUser(recorderPage: Page, options: { stepText: string, tableArea: string, rowKeyword: string, columnValue?: string }) {
  await humanClick(await addAssertionButtonForStep(recorderPage, options.stepText));

  const drawer = recorderPage.locator('.assertion-drawer');
  await expect(drawer).toBeVisible({ timeout: 10_000 });
  await humanClick(drawer.locator('.assertion-object-grid button').filter({ hasText: '表格/列表' }));
  await drawer.locator('label').filter({ hasText: '断言类型' }).locator('select').selectOption('tableRowExists');
  await humanType(drawer.locator('label').filter({ hasText: '表格/列表' }).locator('input').first(), options.tableArea, { clear: true });
  await humanType(drawer.locator('label').filter({ hasText: '行关键字' }).locator('input'), options.rowKeyword, { clear: true });
  if (options.columnValue) {
    const columnCheckbox = drawer.locator('label').filter({ hasText: '指定列条件' }).locator('input');
    if (!await columnCheckbox.isChecked())
      await humanClick(drawer.locator('label').filter({ hasText: '指定列条件' }));
    await humanType(drawer.locator('label').filter({ hasText: '匹配值' }).locator('input'), options.columnValue, { clear: true });
  }
  await humanClick(drawer.getByRole('button', { name: '保存断言' }));
  await expect(recorderPage.locator('.assertion-chip.enabled').filter({ hasText: options.rowKeyword }).first()).toBeVisible({ timeout: 10_000 });
}

async function addAssertionButtonForStep(recorderPage: Page, stepText: string) {
  await expect(recorderPage.locator('.review-step-row, .flow-step').filter({ hasText: stepText }).first()).toBeVisible({ timeout: 10_000 });
  const rows = recorderPage.locator('.review-step-row, .flow-step').filter({ hasText: stepText });
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const button = row.getByRole('button', { name: '添加断言' }).first();
    if (await button.isVisible().catch(() => false))
      return button;
  }
  return rows.first().getByRole('button', { name: '添加断言' }).first();
}

async function expectBusinessFlowPlaybackFailureLikeUser(recorderPage: Page, page: Page, expectedFailure: RegExp) {
  await humanClick(recorderPage.getByRole('button', { name: 'Playwright 代码' }));
  const resumeButton = recorderPage.getByTitle('Resume (F8)');
  await expect(resumeButton).toBeVisible({ timeout: 10_000 });
  await expect(resumeButton).toBeEnabled({ timeout: 30_000 });
  await expect(recorderPage.locator('.CodeMirror-line').filter({ hasText: 'expect' }).first()).toBeVisible({ timeout: 30_000 });
  await humanClick(resumeButton);
  await expect.poll(async () => {
    const output = (await dumpLogHeaders(recorderPage)()).join('\n');
    if (/Expect[\s\S]*❌/.test(output) || expectedFailure.test(output))
      return output;
    return output || 'waiting for failing playback assertion';
  }, { timeout: 90_000 }).toMatch(expectedFailure);
  const output = (await dumpLogHeaders(recorderPage)()).join('\n');
  const businessText = await page.locator('body').innerText().catch(() => '');
  expect(`${output}\n${businessText}`).toMatch(expectedFailure);
  expect(output).toContain('Expect');
  expect(output).toContain('❌');
}

async function playBusinessFlowInPluginLikeUser(recorderPage: Page, page: Page, options: { orderedMarkers?: PlaybackMarker[] } = {}) {
  await humanClick(recorderPage.getByRole('button', { name: 'Playwright 代码' }));
  const resumeButton = recorderPage.getByTitle('Resume (F8)');
  await expect(resumeButton).toBeVisible({ timeout: 10_000 });
  await expect(resumeButton).toBeEnabled({ timeout: 30_000 });
  await expect(recorderPage.locator('.CodeMirror-line').filter({ hasText: 'expect' }).first()).toBeVisible({ timeout: 30_000 });
  await humanClick(resumeButton);
  await expect.poll(async () => {
    const output = (await dumpLogHeaders(recorderPage)()).join('\n');
    if (!/Expect[\s\S]*✅/.test(output)) {
      if (/Expect[\s\S]*❌/.test(output)) {
        const businessText = await page.locator('body').innerText().catch(error => `business page unavailable: ${String(error)}`);
        return `${output}\n--- business page ---\n${businessText.slice(0, 1000)}`;
      }
      return output || 'waiting for playback assertion';
    }
    if (/❌|↻|⏸️/.test(output))
      return output;
    const missingMarkers = missingPlaybackMarkers(output, options.orderedMarkers ?? []);
    if (missingMarkers)
      return missingMarkers;
    return 'ready';
  }, { timeout: 90_000 }).toBe('ready');
  const output = (await dumpLogHeaders(recorderPage)()).join('\n');
  expect(output).toContain('Expect');
  expect(output).toContain('✅');
  expect(output).not.toContain('❌');
  expect(missingPlaybackMarkers(output, options.orderedMarkers ?? [])).toBe('');
}

function missingPlaybackMarkers(output: string, markers: PlaybackMarker[]) {
  let fromIndex = 0;
  for (const marker of markers) {
    const matchIndex = markerIndex(output, marker, fromIndex);
    if (matchIndex === -1)
      return `missing playback marker after ${fromIndex}: ${String(marker)}\n${output}`;
    fromIndex = matchIndex + 1;
  }
  return '';
}

function markerIndex(output: string, marker: PlaybackMarker, fromIndex: number) {
  if (typeof marker === 'string')
    return output.indexOf(marker, fromIndex);
  const match = output.slice(fromIndex).match(marker);
  return match?.index === undefined ? -1 : fromIndex + match.index;
}

function expectEnabledAssertion(flow: any, expectedAssertion: ExpectedEnabledAssertion) {
  const assertions = flow.steps.flatMap((step: any) => step.assertions ?? []);
  const expectedObject: Record<string, any> = {
    enabled: true,
    subject: expectedAssertion.subject,
    type: expectedAssertion.type,
    expected: expectedAssertion.expected,
  };
  if (expectedAssertion.selector)
    expectedObject.target = expect.objectContaining({ selector: expectedAssertion.selector });
  if (expectedAssertion.params)
    expectedObject.params = expect.objectContaining(expectedAssertion.params);
  expect(assertions).toContainEqual(expect.objectContaining(expectedObject));
}

function loadBenchmarkCase(fileName: string) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'benchmarks', 'agent_models', 'cases', fileName), 'utf8'));
}

async function replayGeneratedPlaywrightCode(context: BrowserContext, code: string, testInfo: TestInfo) {
  const rawReplayDir = testInfo.outputPath('raw-generated-replay');
  fs.mkdirSync(rawReplayDir, { recursive: true });
  fs.writeFileSync(path.join(rawReplayDir, 'generated-before-inline.spec.ts'), code);

  const body = testBody(code);
  const replayPage = await context.newPage();
  try {
    const replay = new Function('page', 'expect', `return (async () => {\n${body}\n})();`);
    await replay(replayPage, expect);
  } finally {
    await replayPage.close();
  }
  runGeneratedPlaywrightSourceAsStandaloneSpec(code, testInfo);
}

function runGeneratedPlaywrightSourceAsStandaloneSpec(code: string, testInfo: TestInfo) {
  const rawReplayRoot = path.join(__dirname, '..', '.raw-generated-replay');
  fs.mkdirSync(rawReplayRoot, { recursive: true });
  const rawReplayDir = fs.mkdtempSync(path.join(rawReplayRoot, `${testInfo.workerIndex}-`));
  const specPath = path.join(rawReplayDir, 'generated-replay.spec.ts');
  const configPath = path.join(rawReplayDir, 'playwright.raw-replay.config.ts');
  fs.writeFileSync(specPath, code);
  fs.writeFileSync(configPath, [
    `import { defineConfig, devices } from '@playwright/test';`,
    `export default defineConfig({`,
    `  timeout: 120000,`,
    `  workers: 1,`,
    `  reporter: 'line',`,
    `  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:3000' },`,
    `});`,
    ``,
  ].join('\n'));
  const result = spawnSync('npx', ['playwright', 'test', specPath, '--config', configPath, '--workers=1', '--reporter=line'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, CI: '0' },
    encoding: 'utf8',
    timeout: 180_000,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  fs.writeFileSync(path.join(rawReplayDir, 'raw-replay-output.txt'), output);
  if (result.status !== 0)
    throw new Error(`Generated Playwright source failed as a standalone spec (exit ${result.status}). See ${rawReplayDir}/raw-replay-output.txt\n${output}`);
}

function testBody(code: string) {
  const header = code.match(/test\([^,]+,\s*async\s*\(\{\s*page\s*\}\)\s*=>\s*\{/);
  if (!header)
    throw new Error(`Unable to find generated Playwright test header:\n${code}`);
  const bodyStart = (header.index ?? 0) + header[0].length;
  let bodyEnd = code.lastIndexOf('\n});');
  if (bodyEnd < bodyStart)
    bodyEnd = code.lastIndexOf('});');
  if (bodyEnd < bodyStart)
    throw new Error(`Unable to extract generated Playwright test body:\n${code}`);
  return code.slice(bodyStart, bodyEnd)
      .split('\n')
      .filter(line => !line.trimStart().startsWith('//'))
      .join('\n');
}
