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
import type { TestInfo } from '@playwright/test';
import type { Page } from 'playwright-core';
import { test, expect } from './crxRecorderTest';
import { replayGeneratedPlaywrightCode } from './helpers/replayAssertions';
import { humanClick, selectAntdOptionLikeUser } from './humanLike';

test.describe.configure({ mode: 'serial' });

test('shows grouped settings accordion from the flow library', async ({ page, attachRecorder, baseURL }) => {
  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page, { mode: 'business-flow' });

  await expect(recorderPage.locator('.flow-library')).toContainText('业务流程记录');
  await recorderPage.locator('.global-ai-card').getByRole('button', { name: '设置' }).click();
  await expect(recorderPage.locator('.recording-status')).toContainText('设置');
  await expect(recorderPage.locator('.settings-accordion-panel')).toContainText('录制偏好与导出安全');

  const highFrequency = recorderPage.locator('.settings-section').filter({ hasText: '高频录制偏好' });
  const aiDetails = recorderPage.locator('.settings-section').filter({ hasText: 'AI Intent 细节' });
  const privacyExport = recorderPage.locator('.settings-section').filter({ hasText: '隐私与导出' });
  await expect(highFrequency).toHaveJSProperty('open', true);
  await expect(aiDetails).toHaveJSProperty('open', false);
  await expect(privacyExport).toHaveJSProperty('open', false);

  await privacyExport.locator('summary').click();
  await expect(privacyExport).toHaveJSProperty('open', true);
  await expect(privacyExport).toContainText('导出前脱敏');
  await expect(privacyExport).toContainText('导出检查页会单独展示 P0/P1 风险');

  await aiDetails.locator('summary').click();
  await expect(aiDetails).toHaveJSProperty('open', true);
  await expect(aiDetails).toContainText('API Key');
  await expect(aiDetails.locator('input[type="password"]')).toBeVisible();
});

test('generated replay terminal verification fails when a created row is missing', async ({ context }) => {
  const code = generatedReplayCode('false green missing created row', [
    `await page.goto('/antd-users-real.html');`,
  ]);
  const startedAt = Date.now();
  const testInfo = test.info();
  const diagnosticFlow = generatedReplayDiagnosticFlow(code);

  await expect(replayGeneratedPlaywrightCode(context, code, testInfo, {
    verify: async replayPage => {
      const usersTable = replayPage.getByTestId('users-table');
      await expect(usersTable.getByRole('row').filter({ hasText: /charlie\.qa[\s\S]*审计员/ })).toBeVisible({ timeout: 1000 });
    },
    standalone: [
      `const usersTable = page.getByTestId("users-table");`,
      `await expect(usersTable.getByRole('row').filter({ hasText: /charlie\\.qa[\\s\\S]*审计员/ })).toBeVisible({ timeout: 1000 });`,
    ],
    diagnostics: {
      flow: diagnosticFlow,
      stepIds: ['s001'],
      source: 'terminal-assertion',
    },
  })).rejects.toThrow(/charlie|toBeVisible|Timed out|Timeout/i);

  const outputPath = latestRawReplayArtifact(testInfo, 'raw-replay-output.txt', startedAt);
  const reportPath = latestRawReplayArtifact(testInfo, 'replay-failure-diagnostics.json', startedAt);
  expect(outputPath, 'standalone replay failure should retain raw output').toBeTruthy();
  expect(reportPath, 'standalone replay failure should retain adaptive diagnostics').toBeTruthy();
  const reportText = fs.readFileSync(String(reportPath), 'utf8');
  const report = JSON.parse(reportText);
  expect(report.source).toBe('terminal-assertion');
  expect(report.diagnostics?.[0]?.stepId).toBe('s001');
  expect(report.diagnostics?.[0]?.candidates?.length).toBeGreaterThan(0);
  expect(report.diagnostics?.[0]?.target?.testId).toBe('users-table');
  expect(reportText).not.toContain('owner@example.com');
  expect(reportText).not.toContain('13800138000');
  expect(reportText).not.toContain('abc123');
  expect(reportText).not.toContain('<div');
  expect(reportText).not.toContain('[data-token');
});

test('generated replay terminal verification catches save before required fields', async ({ context }) => {
  const code = generatedReplayCode('false green save before required fields', [
    `await page.goto('/antd-pro-form-fields.html');`,
    `await page.getByTestId('network-resource-add').click();`,
    `await page.getByTestId('network-resource-save').click();`,
  ]);

  await expect(replayGeneratedPlaywrightCode(context, code, test.info(), {
    verify: async replayPage => {
      const table = replayPage.getByTestId('network-resource-table');
      await expect(table.getByRole('row').filter({ hasText: /missing-resource/ })).toBeVisible({ timeout: 1000 });
      await expect(replayPage.getByTestId('network-resource-modal')).toBeHidden({ timeout: 1000 });
    },
    standalone: [
      `const table = page.getByTestId("network-resource-table");`,
      `await expect(table.getByRole('row').filter({ hasText: /missing-resource/ })).toBeVisible({ timeout: 1000 });`,
      `await expect(page.getByTestId("network-resource-modal")).toBeHidden({ timeout: 1000 });`,
    ],
  })).rejects.toThrow(/missing-resource|toBeVisible|Timed out|Timeout/i);
});

test('generated replay terminal verification fails when a row is not deleted', async ({ context }) => {
  const code = generatedReplayCode('false green row not deleted', [
    `await page.goto('/antd-wan-transport-real.html');`,
  ]);

  await expect(replayGeneratedPlaywrightCode(context, code, test.info(), {
    verify: async replayPage => {
      const table = replayPage.getByTestId('wan-transport-table');
      await expect(table.locator('[data-row-key="nova_public"]')).toHaveCount(0, { timeout: 1000 });
    },
    standalone: [
      `const table = page.getByTestId("wan-transport-table");`,
      `await expect(table.locator('[data-row-key="nova_public"]')).toHaveCount(0, { timeout: 1000 });`,
    ],
  })).rejects.toThrow(/nova_public|toHaveCount|Timed out|Timeout/i);
});

test('generated replay terminal verification fails when the modal is still open', async ({ context }) => {
  const code = generatedReplayCode('false green modal still open', [
    `await page.goto('/antd-users-real.html');`,
    `await page.getByTestId('create-user-btn').click();`,
  ]);

  await expect(replayGeneratedPlaywrightCode(context, code, test.info(), {
    verify: async replayPage => {
      await expect(replayPage.getByRole('dialog', { name: '新建用户' })).toBeHidden({ timeout: 1000 });
    },
    standalone: [
      `await expect(page.getByRole('dialog', { name: '新建用户' })).toBeHidden({ timeout: 1000 });`,
    ],
  })).rejects.toThrow(/新建用户|toBeHidden|Timed out|Timeout/i);
});

test('records a real AntD user business flow through the plugin UI, exports it, and replays generated Playwright code @smoke', async ({ context, page, attachRecorder, baseURL }) => {
  test.setTimeout(120_000);

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page, { mode: 'business-flow' });
  recorderPage.on('dialog', dialog => dialog.accept());

  await beginNewFlowFromLibrary(recorderPage);
  await fillFlowMeta(recorderPage, '流程名称', 'AntD 用户流程 E2E');
  await fillFlowMeta(recorderPage, '应用', 'AntD Admin');
  await fillFlowMeta(recorderPage, '模块', '用户管理');
  await fillFlowMeta(recorderPage, '页面', '用户列表');
  await fillFlowMeta(recorderPage, '角色', '运营');
  await recorderPage.getByRole('button', { name: '保存并开始录制' }).click();

  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');
  await expect(recorderPage.locator('.recording-context-card')).toContainText('不是全局录制');

  await page.goto(`${baseURL}/antd-users-real.html`);
  await expect(page.getByTestId('create-user-btn')).toBeVisible();
  await attachRecorder(page, { mode: 'business-flow' });
  const recordedSubjects = async () => (await recorderPage.locator('.flow-step-subject').allInnerTexts()).join('\n');

  await page.getByTestId('create-user-btn').locator('svg').click();
  await page.getByPlaceholder('请输入用户名').fill('alice');
  const createUserDialog = page.getByRole('dialog', { name: '新建用户' });
  await page.getByTestId('role-select').click();
  await clickVisibleAntDOption(page, '审计员');
  await expect(page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId('role-select')).toContainText('审计员');
  await page.bringToFront();
  await createUserDialog.getByTestId('modal-confirm').press('Enter');
  await expect(page.getByTestId('create-user-modal')).not.toBeVisible();

  await expect.poll(() => recorderPage.locator('.flow-step').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(5);
  await expect.poll(recordedSubjects).toContain('create-user-btn');
  await expect.poll(recordedSubjects).toContain('alice');
  await expect.poll(recordedSubjects).toContain('审计员');
  await expect.poll(recordedSubjects, { timeout: 20_000 }).toMatch(/modal-confirm|确\s*定/);

  await recorderPage.getByRole('button', { name: '停止录制' }).click();
  await expect(recorderPage.locator('.recording-status')).toContainText(/步骤检查|导出检查/);
  await recorderPage.getByRole('button', { name: /添加断言/ }).first().click();
  await expect(recorderPage.locator('.recording-status')).toContainText('断言 ·');
  await expect(recorderPage.locator('.assertion-step-context-card')).toContainText('Step Context：');
  await expect(recorderPage.locator('.assertion-workbench')).toContainText(/保存到 step-\d{3}/);
  await recorderPage.locator('.side-panel-nav').getByRole('button', { name: '导出', exact: true }).click();
  await expect(recorderPage.locator('.recording-status')).toContainText('导出检查');
  await expect(recorderPage.locator('.export-review-panel')).toContainText('导出前复核：AntD 用户流程 E2E');
  await expect(recorderPage.locator('.export-review-panel')).toContainText(/Replay CTA|回放 CTA/);
  await expect(recorderPage.locator('.export-review-panel')).toContainText('P1');
  await expect(recorderPage.locator('.export-review-panel')).toContainText('脱敏开启');

  const exportedJson = await downloadTextAfterClick(
      recorderPage,
      recorderPage.getByRole('button', { name: '导出流程 JSON' }).last(),
  );
  const exportedYaml = await downloadTextAfterClick(
      recorderPage,
      recorderPage.getByRole('button', { name: '导出紧凑 YAML' }).last(),
  );

  const flow = JSON.parse(exportedJson);
  expect(flow.flow.name).toBe('AntD 用户流程 E2E');
  expect(flow.steps.length).toBeGreaterThanOrEqual(4);
  expect(flow.steps.some((step: any) => step.target?.testId === 'create-user-btn')).toBeTruthy();
  expect(flow.steps.some((step: any) => step.value === 'alice' || [step.target?.label, step.target?.placeholder, step.target?.name, step.target?.displayName, step.target?.text, step.target?.scope?.form?.label].some(value => /用户名|请输入用户名/.test(String(value || ''))))).toBeTruthy();
  expect(flow.artifacts.playwrightCode).toMatch(/getByTestId\(["']create-user-btn["']\)/);
  expect(flow.artifacts.playwrightCode).toMatch(/getByRole\(["']textbox["'],\s*\{\s*name:\s*["']\*?\s*用户名["']|getByLabel\(["']用户名["']\)/);
  expect(flow.artifacts.playwrightCode).toContain('审计员');
  expect(flow.artifacts.playwrightCode).toMatch(/modal-confirm|getByRole\(["']button["'],\s*\{\s*name:\s*["']确\s*定["']/);
  expect(exportedYaml).toContain('AntD 用户流程 E2E');
  expect(exportedYaml).toMatch(/modal-confirm|确 定|确定|审计员/);

  await replayGeneratedPlaywrightCode(context, flow.artifacts.playwrightCode, test.info(), {
    verify: async replayPage => {
      const usersTable = replayPage.getByTestId('users-table');
      await expect(usersTable.getByRole('row').filter({ hasText: /alice[\s\S]*审计员/ })).toBeVisible({ timeout: 10_000 });
      await expect(replayPage.getByRole('dialog', { name: '新建用户' })).toBeHidden({ timeout: 10_000 });
    },
    standalone: [
      `const usersTable = page.getByTestId("users-table");`,
      `await expect(usersTable.getByRole('row').filter({ hasText: /alice[\\s\\S]*审计员/ })).toBeVisible({ timeout: 10000 });`,
      `await expect(page.getByRole('dialog', { name: '新建用户' })).toBeHidden({ timeout: 10000 });`,
    ],
  });
});

test('records a real AntD ProComponents async create-and-use flow @smoke', async ({ context, page, attachRecorder, baseURL }) => {
  test.setTimeout(120_000);

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page, { mode: 'business-flow' });
  recorderPage.on('dialog', dialog => dialog.accept());

  await beginNewFlowFromLibrary(recorderPage);
  await fillFlowMeta(recorderPage, '流程名称', '真实 AntD ProComponents 条目流程');
  await fillFlowMeta(recorderPage, '应用', 'AntD Pro');
  await fillFlowMeta(recorderPage, '模块', '条目管理');
  await fillFlowMeta(recorderPage, '页面', '真实组件页');
  await fillFlowMeta(recorderPage, '角色', '运营');
  await recorderPage.getByRole('button', { name: '保存并开始录制' }).click();

  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await page.goto(`${baseURL}/antd-pro-real.html`);
  await expect(page.getByText('真实 AntD ProComponents 页面')).toBeVisible();
  await expect(page.getByTestId('real-create-item')).toBeVisible();
  await attachRecorder(page, { mode: 'business-flow' });

  await page.getByTestId('real-create-item').locator('svg').click();
  await page.getByPlaceholder('请输入条目名称').fill('real-item-a');
  await page.getByPlaceholder('请输入负责人').fill('真实运营');
  await page.getByRole('button', { name: /保\s*存/ }).click();
  await expect(page.getByRole('row', { name: /real-item-a/ })).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('real-used-item-select').click();
  await clickVisibleAntDOption(page, 'real-item-a');
  await page.getByPlaceholder('填写使用备注').fill('下方表单使用刚保存的条目');

  await expect.poll(() => recorderPage.locator('.flow-step').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(7);
  await expect.poll(async () => (await recorderPage.locator('.flow-step-subject').allInnerTexts()).join('\n')).toContain('real-create-item');
  await expect.poll(async () => (await recorderPage.locator('.flow-step-subject').allInnerTexts()).join('\n')).toContain('real-item-a');
  await expect.poll(async () => (await recorderPage.locator('.flow-step-subject').allInnerTexts()).join('\n')).toMatch(/下方表单使用条目|使用备注|real-used-item-select/);

  await recorderPage.getByRole('button', { name: '停止录制' }).click();
  await expect(recorderPage.locator('.recording-status')).toContainText(/步骤检查|导出检查/);

  const flow = await exportBusinessFlowJson(recorderPage);
  writeGeneratedReplayDiagnostic(test.info(), 'async-create-use', flow);

  expect(flow.flow.name).toBe('真实 AntD ProComponents 条目流程');
  expect(flow.steps.length).toBeGreaterThanOrEqual(7);
  expect(flow.steps.some((step: any) => step.target?.testId === 'real-create-item')).toBeTruthy();
  expect(flow.steps.some((step: any) => step.value === 'real-item-a' || [step.target?.label, step.target?.placeholder, step.target?.name, step.target?.displayName, step.target?.text].some(value => /条目名称|请输入条目名称/.test(String(value || ''))))).toBeTruthy();
  expect(flow.steps.some((step: any) => [step.target?.label, step.target?.displayName, step.target?.name, step.target?.placeholder, step.target?.testId].some(value => /下方表单使用条目|选择刚保存的条目|real-used-item-select/.test(String(value || ''))))).toBeTruthy();
  expect(flow.artifacts.playwrightCode).toContain('antd-pro-real.html');
  expect(flow.artifacts.playwrightCode).toMatch(/real-create-item|新建条目/);
  expect(flow.artifacts.playwrightCode).toContain('real-item-a');
  expectScopedActiveAntdOptionReplay(flow.artifacts.playwrightCode, '下方表单使用条目', 'real-item-a', 'real-used-item-select');
  expect(flow.artifacts.playwrightCode).not.toMatch(/getByRole\(["']combobox["'],\s*\{\s*name:\s*["']下方表单使用条目["']/);
  expect(flow.artifacts.playwrightCode).not.toContain('#rc_select_');
  expect(flow.artifacts.playwrightCode).not.toMatch(/page\.getByText\(["']real-item-a["']\)\.click\(\)/);
  expect(flow.artifacts.playwrightCode).not.toMatch(/getByTitle\(["']real-item-a["']\)/);
  expect(flow.artifacts.playwrightCode).toContain('下方表单使用刚保存的条目');

  await replayGeneratedPlaywrightCode(context, flow.artifacts.playwrightCode, test.info(), {
    verify: async replayPage => {
      const itemsTable = replayPage.getByTestId('real-items-table');
      await expect(itemsTable.getByRole('row').filter({ hasText: /real-item-a[\s\S]*真实运营/ })).toBeVisible({ timeout: 10_000 });
      await expect(replayPage.getByTestId('real-used-item-select')).toContainText('real-item-a', { timeout: 10_000 });
      await expect(replayPage.getByTestId('real-create-item-modal')).toBeHidden({ timeout: 10_000 });
    },
    standalone: [
      `const itemsTable = page.getByTestId("real-items-table");`,
      `await expect(itemsTable.getByRole('row').filter({ hasText: /real-item-a[\\s\\S]*真实运营/ })).toBeVisible({ timeout: 10000 });`,
      `await expect(page.getByTestId("real-used-item-select")).toContainText("real-item-a", { timeout: 10000 });`,
      `await expect(page.getByTestId("real-create-item-modal")).toBeHidden({ timeout: 10000 });`,
    ],
  });
});


test('records real ProFormField network configuration fields and replays generated code @proform-fields', async ({ context, page, attachRecorder, baseURL }) => {
  test.setTimeout(210_000);

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page, { mode: 'business-flow' });
  recorderPage.on('dialog', dialog => dialog.accept());

  await beginNewFlowFromLibrary(recorderPage);
  await fillFlowMeta(recorderPage, '流程名称', 'ProFormField 网络配置流程');
  await fillFlowMeta(recorderPage, '应用', 'AntD Pro');
  await fillFlowMeta(recorderPage, '模块', '网络配置');
  await fillFlowMeta(recorderPage, '页面', '资源配置');
  await fillFlowMeta(recorderPage, '角色', '网络管理员');
  await recorderPage.getByRole('button', { name: '保存并开始录制' }).click();

  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await page.goto(`${baseURL}/antd-pro-form-fields.html`);
  await expect(page.getByText('网络配置资源')).toBeVisible();
  await attachRecorder(page, { mode: 'business-flow' });
  await page.getByTestId('network-resource-add').click();
  const networkResourceDialog = page.getByRole('dialog', { name: '新建网络资源' });
  await expect(networkResourceDialog).toBeVisible();

  await page.getByTestId('network-resource-save').click();
  await expect(page.locator('.ant-form-item-explain-error').filter({ hasText: '请输入资源名称' })).toBeVisible();
  await expect(page.locator('.ant-form-item-explain-error').filter({ hasText: '选择一个WAN口' })).toBeVisible();

  await page.getByPlaceholder('地址池名称').fill('pool-proform-alpha');
  await page.getByTestId('network-resource-wan-select').click();
  await page.getByTestId('network-resource-wan-select').locator('input').fill('WAN-extra-18');
  await clickVisibleAntDOption(page, 'edge-lab:WAN-extra-18');
  await expect(page.getByTestId('network-resource-wan-select')).toContainText('edge-lab:WAN-extra-18');
  await waitForRecordedMarker(recorderPage, 'WAN-extra-18');
  const dedicatedPoolLabel = networkResourceDialog.locator('label').filter({ hasText: '独享地址池' }).first();
  await humanClick(dedicatedPoolLabel);
  await expect(networkResourceDialog.locator('input[type="radio"][value="dedicated"]')).toBeChecked();
  await waitForRecordedMarker(recorderPage, '独享地址池');
  await page.getByTestId('network-resource-vrf-select').click();
  await page.getByTestId('network-resource-vrf-select').locator('input').fill('生产');
  await clickVisibleAntDOption(page, '生产VRF');
  await expect(page.getByTestId('network-resource-vrf-select')).toContainText('生产VRF');
  await waitForRecordedMarker(recorderPage, '生产VRF');
  const arpProxyItem = networkResourceDialog.locator('.ant-form-item').filter({ hasText: '能力开关' });
  const arpProxyCheckbox = arpProxyItem.getByRole('checkbox', { name: '开启代理ARP' });
  await humanClick(arpProxyItem.locator('.ant-checkbox-wrapper').filter({ hasText: '开启代理ARP' }));
  await expect(arpProxyCheckbox).toBeChecked();
  await waitForRecordedMarker(recorderPage, '开启代理ARP');
  await humanClick(page.getByText('启用健康检查'));
  await expect(page.getByTestId('network-resource-health-url')).toBeVisible();
  await page.getByTestId('network-resource-health-url').fill('https://probe.example/health');
  await page.getByTestId('network-resource-scope-tree').click();
  await clickVisibleAntDTreeNode(page, '华东生产区');
  await expect(page.getByTestId('network-resource-scope-tree')).toContainText('华东生产区');
  await waitForRecordedMarker(recorderPage, '华东生产区');
  await humanClick(page.getByTestId('network-resource-egress-cascader'));
  await clickVisibleAntDCascaderOption(page, '上海');
  await clickVisibleAntDCascaderOption(page, '一号机房');
  await clickVisibleAntDCascaderOption(page, 'NAT集群A');
  await expect(page.getByTestId('network-resource-egress-cascader')).toContainText('NAT集群A');
  await waitForRecordedMarker(recorderPage, 'NAT集群A');
  await page.getByPlaceholder('服务名称').fill('https-admin');
  await page.getByPlaceholder('监听端口').fill('8443');
  await expect(page.getByPlaceholder('监听端口')).toHaveValue('8443');
  await page.getByTestId('network-resource-source-port').fill('8443');
  await expect(page.getByTestId('network-resource-source-port')).toHaveValue('8443');
  await page.getByPlaceholder('填写策略备注').fill('ProFormField 全量组合录制：showSearch/TreeSelect/Cascader/List/Dependency/Switch');
  await page.getByTestId('network-resource-save').click();
  await expect(page.getByRole('row', { name: /pool-proform-alpha/ })).toBeVisible({ timeout: 10_000 });

  await expect.poll(() => recorderPage.locator('.flow-step').count(), { timeout: 25_000 }).toBeGreaterThanOrEqual(12);
  for (const marker of [
    '生产VRF',
    '开启代理ARP',
    '华东生产区',
    'NAT集群A',
    'https-admin',
    '8443',
    'ProFormField 全量组合录制',
  ])
    await waitForRecordedMarker(recorderPage, marker);

  await recorderPage.getByRole('button', { name: '停止录制' }).click();
  await expect(recorderPage.locator('.recording-status')).toContainText(/步骤检查|导出检查/);

  const flow = await exportBusinessFlowJson(recorderPage);
  writeGeneratedReplayDiagnostic(test.info(), 'proform-fields', flow);
  expect(flow.flow.name).toBe('ProFormField 网络配置流程');
  expect(flow.steps.length).toBeGreaterThanOrEqual(12);
  expect(flow.steps.some((step: any) => step.target?.testId === 'network-resource-add')).toBeTruthy();
  expect(flow.steps.some((step: any) => step.target?.testId === 'network-resource-name' || step.target?.placeholder === '地址池名称' || step.target?.label === '资源名称')).toBeTruthy();
  expect(flow.steps.some((step: any) => [step.target?.label, step.target?.displayName, step.target?.name, step.target?.placeholder, step.target?.testId].some(value => /WAN口|选择一个WAN口|network-resource-wan-select/.test(String(value || ''))))).toBeTruthy();
  expect(flow.steps.some((step: any) => [step.target?.label, step.target?.displayName, step.target?.name, step.target?.text].some(value => /类型|独享地址池|poolType/.test(String(value || ''))))).toBeTruthy();
  const serializedProFormSteps = JSON.stringify(flow.steps, null, 2);
  const serializedProFormTargets = JSON.stringify(flow.steps.map((step: any) => step.target), null, 2);
  for (const marker of [
    'pool-proform-alpha',
    'edge-lab:WAN-extra-18',
    '生产VRF',
    'https://probe.example/health',
    '华东生产区',
    'NAT集群A',
    'https-admin',
    '8443',
    'ProFormField 全量组合录制',
  ])
    expect(serializedProFormSteps, `exported flow should keep ProForm value: ${marker}`).toContain(marker);
  expect(serializedProFormTargets).toMatch(/开启代理ARP|arpProxy/);
  expect(flow.artifacts.playwrightCode).toContain('antd-pro-form-fields.html');
  expect(flow.artifacts.playwrightCode).toContain('pool-proform-alpha');
  expect(flow.artifacts.playwrightCode).toContain('edge-lab:WAN-extra-18');
  expect(flow.artifacts.playwrightCode).not.toContain('edge-lab:WAN1-copy');
  expect(flow.artifacts.playwrightCode).toContain('生产VRF');
  expect(flow.artifacts.playwrightCode).toMatch(/开启代理ARP|arpProxy/);
  expect(flow.artifacts.playwrightCode).toContain('华东生产区');
  expect(flow.artifacts.playwrightCode).toContain('NAT集群A');
  expect(flow.artifacts.playwrightCode).toContain('https-admin');
  expect(flow.artifacts.playwrightCode).toContain('https://probe.example/health');
  expect(flow.artifacts.playwrightCode).toContain('8443');
  expect(flow.artifacts.playwrightCode).toContain('ProFormField 全量组合录制');
  expect(flow.artifacts.playwrightCode).toContain('dispatchEvent(new MouseEvent("mousedown"');
  expectInOrder(flow.artifacts.playwrightCode, [
    'network-resource-add',
    'network-resource-save',
    'pool-proform-alpha',
  ]);
  assertNoNetworkResourceSubmitBeforeRequiredFields(flow.artifacts.playwrightCode);

  const proFormTerminalRowPattern = /pool-proform-alpha[\s\S]*edge-lab:WAN-extra-18[\s\S]*生产VRF[\s\S]*华东生产区[\s\S]*NAT集群A[\s\S]*已开启[\s\S]*启用[\s\S]*https-admin:8443[\s\S]*ProFormField 全量组合录制/;
  const replayVerification = [
    `const networkTable = page.getByTestId("network-resource-table");`,
    `await expect(networkTable.getByRole('row').filter({ hasText: /pool-proform-alpha[\\s\\S]*edge-lab:WAN-extra-18[\\s\\S]*生产VRF[\\s\\S]*华东生产区[\\s\\S]*NAT集群A[\\s\\S]*已开启[\\s\\S]*启用[\\s\\S]*https-admin:8443[\\s\\S]*ProFormField 全量组合录制/ })).toBeVisible({ timeout: 10000 });`,
  ];
  await replayGeneratedPlaywrightCode(context, flow.artifacts.playwrightCode, test.info(), {
    verify: async replayPage => {
      const table = replayPage.getByTestId('network-resource-table');
      await expect(table.getByRole('row').filter({ hasText: proFormTerminalRowPattern })).toBeVisible({ timeout: 10_000 });
    },
    standalone: replayVerification,
  });
});


test('records an IPv4 address pool ProFormSelect WAN flow and replays generated code @ipv4-pool', async ({ context, page, attachRecorder, baseURL }) => {
  test.setTimeout(150_000);

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page, { mode: 'business-flow' });
  recorderPage.on('dialog', dialog => dialog.accept());

  await beginNewFlowFromLibrary(recorderPage);
  await fillFlowMeta(recorderPage, '流程名称', '地址池');
  await fillFlowMeta(recorderPage, '应用', 'AntD Pro');
  await fillFlowMeta(recorderPage, '模块', '站点配置');
  await fillFlowMeta(recorderPage, '页面', '全局配置');
  await fillFlowMeta(recorderPage, '角色', 'admin');
  await recorderPage.getByRole('button', { name: '保存并开始录制' }).click();

  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await page.goto(`${baseURL}/antd-pro-form-fields.html`);
  await expect(page.getByText('地址池与端口池')).toBeVisible();
  await attachRecorder(page, { mode: 'business-flow' });
  await page.getByTestId('site-ip-address-pool-create-button').click();
  await expect(page.getByRole('dialog', { name: '新建IPv4地址池' })).toBeVisible();

  await page.getByPlaceholder('地址池名称').fill('test1');
  const ipv4Dialog = page.locator('.ant-modal, .ant-drawer, [role="dialog"]').filter({ hasText: '新建IPv4地址池' });
  await ipv4Dialog.locator('.ant-form-item').filter({ hasText: 'WAN口' }).locator('.ant-select-selector').first().click();
  await ipv4Dialog.locator('.ant-form-item').filter({ hasText: 'WAN口' }).locator('input').first().fill('xtest16');
  await clickVisibleAntDOption(page, 'xtest16:WAN1');
  await expect(ipv4Dialog.locator('.ant-form-item').filter({ hasText: 'WAN口' })).toContainText('xtest16:WAN1');
  await page.getByLabel('开始地址，例如：192.168.1.1').click();
  await page.getByRole('textbox', { name: '开始地址，例如：' }).fill('1.1.1.1');
  await page.getByLabel('结束地址，例如：192.168.1.254').click();
  await page.getByRole('textbox', { name: '结束地址，例如：' }).fill('2.2.2.2');
  await expect(page.getByRole('textbox', { name: '开始地址，例如：' })).toHaveValue('1.1.1.1');
  await expect(page.getByRole('textbox', { name: '结束地址，例如：' })).toHaveValue('2.2.2.2');
  const ipv4ConfirmButton = ipv4Dialog.getByRole('button', { name: '确 定' });
  await expect(ipv4ConfirmButton).toBeEnabled({ timeout: 10_000 });
  const targetIpv4Row = page.getByRole('row', { name: /test1.*xtest16:WAN1.*1\.1\.1\.1.*2\.2\.2\.2/ });
  for (let attempt = 0; attempt < 4 && await ipv4Dialog.isVisible().catch(() => false); attempt++) {
    try {
      await ipv4ConfirmButton.click({ timeout: 5_000 });
    } catch (error) {
      if (!await ipv4Dialog.isVisible().catch(() => false) || await targetIpv4Row.isVisible().catch(() => false))
        break;
      throw error;
    }
    await page.waitForTimeout(500);
  }
  await expect(ipv4Dialog).toBeHidden({ timeout: 10_000 });
  await expect(targetIpv4Row).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('site-save-button').click();
  await expect(page.getByText('配置已保存')).toBeVisible();

  await expect.poll(() => recorderPage.locator('.flow-step').count(), { timeout: 25_000 }).toBeGreaterThanOrEqual(8);
  const stepSubjects = async () => (await recorderPage.locator('.flow-step-subject').allInnerTexts()).join('\n');
  await expect.poll(stepSubjects).toContain('site-ip-address-pool-create-button');
  await expect.poll(stepSubjects).toContain('test1');
  await expect.poll(stepSubjects).toMatch(/WAN口|选择一个WAN口|xtest16:WAN1/);
  await expect.poll(stepSubjects, { timeout: 25_000 }).toMatch(/ipv4-address-pool-confirm|确\s*定/);
  await expect.poll(stepSubjects, { timeout: 25_000 }).toContain('site-save-button');

  await recorderPage.getByRole('button', { name: '停止录制' }).click();
  await expect(recorderPage.locator('.recording-status')).toContainText(/步骤检查|导出检查/);

  let flow = await exportBusinessFlowJson(recorderPage);
  expect(flow.flow.name).toBe('地址池');
  expect(flow.steps.length).toBeGreaterThanOrEqual(8);
  expect(flow.steps.some((step: any) => step.target?.testId === 'site-ip-address-pool-create-button')).toBeTruthy();
  expect(flow.steps.some((step: any) => [step.target?.label, step.target?.displayName, step.target?.name, step.target?.text].some(value => /WAN口|选择一个WAN口|xtest16:WAN1/.test(String(value || ''))))).toBeTruthy();

  const createStepId = requiredStepId(flow, (step: any) => step.target?.testId === 'site-ip-address-pool-create-button', 'IPv4 pool create button step');
  const confirmStepId = requiredStepId(flow, (step: any) => step.target?.testId === 'ipv4-address-pool-confirm' || /确\s*定/.test(String(step.target?.name || step.target?.text || step.target?.displayName || '')), 'IPv4 pool modal confirm step');
  const saveConfigStepId = requiredStepId(flow, (step: any) => step.target?.testId === 'site-save-button', 'site save config step');
  const repeatStepIds = flow.steps
      .filter((step: any) => stepIndex(flow, step.id) >= stepIndex(flow, createStepId) && stepIndex(flow, step.id) <= stepIndex(flow, confirmStepId))
      .map((step: any) => step.id);
  expect(repeatStepIds.length).toBeGreaterThanOrEqual(6);
  expect(repeatStepIds).toContain(createStepId);
  expect(repeatStepIds).toContain(confirmStepId);
  expect(repeatStepIds).not.toContain(saveConfigStepId);

  await openStepCheckPanel(recorderPage);

  for (const stepId of repeatStepIds)
    await recorderPage.locator(`button[aria-label="选择 ${stepId} 作为循环步骤"]`).click();
  await expect(recorderPage.locator('.repeat-create-actions .primary')).toBeEnabled();
  await recorderPage.locator('.repeat-create-actions .primary').click();
  await expect(recorderPage.locator('.repeat-editor')).toBeVisible({ timeout: 10_000 });
  if (await recorderPage.locator('.repeat-data').isVisible().catch(() => false))
    await recorderPage.getByRole('button', { name: '返回上一步' }).click();
  await expect(recorderPage.locator('.repeat-mapping')).toBeVisible({ timeout: 10_000 });
  await recorderPage.locator('.repeat-mapping label').filter({ hasText: '片段名称' }).locator('input').fill('批量创建IPv4地址池');
  await recorderPage.getByRole('button', { name: '生成数据表' }).click();
  await expect.poll(async () => await recorderPage.locator('.repeat-data input').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value).join('\n'))).toContain('test1');
  await recorderPage.getByRole('button', { name: '保存片段' }).click();
  await expect(recorderPage.locator('.repeat-segment-card')).toContainText('批量创建IPv4地址池');

  flow = await exportBusinessFlowJson(recorderPage);
  writeGeneratedReplayDiagnostic(test.info(), 'ipv4-pool', flow);
  expect(flow.repeatSegments?.[0]?.stepIds).toEqual(repeatStepIds);
  expect(flow.repeatSegments?.[0]?.stepIds).not.toContain(saveConfigStepId);
  expect(flow.repeatSegments?.[0]?.parameters.map((parameter: any) => parameter.variableName)).toEqual(expect.arrayContaining(['poolName', 'port', 'startIp', 'endIp']));
  expect(flow.repeatSegments?.[0]?.rows.length).toBeGreaterThanOrEqual(3);
  expect(flow.artifacts.playwrightCode).toContain('for (const row of');
  expect(flow.artifacts.playwrightCode).toContain('批量创建IPv4地址池');
  expect(flow.artifacts.playwrightCode).toContain('antd-pro-form-fields.html');
  expect(flow.artifacts.playwrightCode).toContain('site-ip-address-pool-create-button');
  expect(flow.artifacts.playwrightCode).toContain('test1');
  expect(flow.artifacts.playwrightCode).toContain('xtest16:WAN1');
  expect(flow.artifacts.playwrightCode).toContain('1.1.1.1');
  expect(flow.artifacts.playwrightCode).toContain('2.2.2.2');
  expectTriggerOwnedAntdOptionReplay(
      flow.artifacts.playwrightCode,
      /const trigger = [\s\S]{0,520}(?:ipv4-address-pool-form|WAN口)[\s\S]{0,320}\.locator\(["'][^"']*\.ant-select-selector/,
      'xtest16:WAN1',
  );
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
  const ipv4RowRegex = (row: typeof ipv4TerminalRows[number]) => new RegExp([row.poolName, row.port, row.startIp, row.endIp].map(escapeRegExp).join('[\\s\\S]*'));
  const ipv4ReplayVerification = [
    `const ipv4Table = page.getByTestId("site-ip-address-pool-table");`,
    ...ipv4TerminalRows.map(row => `await expect(ipv4Table.getByRole('row').filter({ hasText: /${[row.poolName, row.port, row.startIp, row.endIp].map(escapeRegExp).join('[\\s\\S]*')}/ })).toBeVisible({ timeout: 10000 });`),
    `await expect(page.getByRole('dialog', { name: '新建IPv4地址池' })).toBeHidden({ timeout: 10000 });`,
  ];
  await replayGeneratedPlaywrightCode(context, flow.artifacts.playwrightCode, test.info(), {
    verify: async replayPage => {
      const ipv4Table = replayPage.getByTestId('site-ip-address-pool-table');
      for (const row of ipv4TerminalRows)
        await expect(ipv4Table.getByRole('row').filter({ hasText: ipv4RowRegex(row) })).toBeVisible({ timeout: 10_000 });
      await expect(replayPage.getByRole('dialog', { name: '新建IPv4地址池' })).toBeHidden({ timeout: 10_000 });
    },
    standalone: ipv4ReplayVerification,
  });
});


test('keeps plugin edits stable across middle insert, wait, repeat segment, saved continue, and generated replay @plugin-stability', async ({ context, page, attachRecorder, baseURL }) => {
  test.setTimeout(180_000);

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page, { mode: 'business-flow' });
  recorderPage.on('dialog', dialog => dialog.accept('1'));

  const flowName = `插件稳定性流程 ${Date.now()}`;
  await beginNewFlowFromLibrary(recorderPage);
  await fillFlowMeta(recorderPage, '流程名称', flowName);
  await fillFlowMeta(recorderPage, '应用', 'AntD Admin');
  await fillFlowMeta(recorderPage, '模块', '稳定性编辑');
  await fillFlowMeta(recorderPage, '页面', '循环与插入');
  await fillFlowMeta(recorderPage, '角色', '测试');
  await recorderPage.getByRole('button', { name: '保存并开始录制' }).click();

  await page.goto(`${baseURL}/antd-business-flow-stability.html`);
  await expect(page.getByText('业务流程稳定性测试页')).toBeVisible();
  await attachRecorder(page, { mode: 'business-flow' });
  await expect.poll(() => recorderStepSubjects(recorderPage), { timeout: 15_000 }).toContain('antd-business-flow-stability.html');
  await page.getByTestId('site-ip-add').click();
  await expect(page.getByTestId('event-log')).toContainText('add');
  await expect.poll(() => recorderStepSubjects(recorderPage), { timeout: 15_000 }).toMatch(/site-ip-add|新增IP端口池/);
  await page.getByPlaceholder('地址池名称').fill('pool-alpha');
  await page.getByPlaceholder('填写使用备注').fill('初始保存后备注');
  await page.getByTestId('site-save-button').click();
  await expect(page.getByRole('row', { name: /pool-alpha.*初始保存后备注/ })).toBeVisible({ timeout: 10_000 });

  await expect.poll(() => recorderPage.locator('.flow-step').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(3);
  await recorderPage.getByRole('button', { name: '停止录制' }).click();
  await expect(recorderPage.locator('.recording-status')).toContainText(/步骤检查|导出检查/);

  let flow = await exportBusinessFlowJson(recorderPage);
  const navigateStepId = requiredStepId(flow, (step: any) => step.action === 'navigate', 'stability page navigation step');
  const addStepId = requiredStepId(flow, (step: any) => step.target?.testId === 'site-ip-add' || /新增IP端口池/.test(String(step.target?.name || step.target?.text || step.target?.displayName || '')), 'site ip add step');
  const fillStepId = requiredStepId(flow, (step: any) => step.value === 'pool-alpha', 'pool name fill step');
  const remarkStepId = requiredStepId(flow, (step: any) => step.value === '初始保存后备注', 'remark fill step');
  const saveStepId = requiredStepId(flow, (step: any) => step.target?.testId === 'site-save-button' || /保存配置/.test(String(step.target?.name || step.target?.text || step.target?.displayName || '')), 'save step');

  await openInsertMenuAfterStep(recorderPage, addStepId);
  await recorderPage.getByRole('button', { name: '从这里继续录制' }).click();
  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');
  await expect(recorderPage.locator('.insert-recording-banner')).toContainText(addStepId);
  await page.getByTestId('site-ip-validate').click();
  await expect(page.getByTestId('event-log')).toContainText('validate');
  await recorderPage.getByRole('button', { name: '停止录制' }).click();
  await expect(recorderPage.locator('.recording-status')).toContainText(/步骤检查|导出检查/);

  flow = await exportBusinessFlowJson(recorderPage);
  const validateStepId = requiredStepId(flow, (step: any) => step.target?.testId === 'site-ip-validate', 'inserted validate step');
  expect(stepIndex(flow, validateStepId)).toBe(stepIndex(flow, addStepId) + 1);

  await openInsertMenuAfterStep(recorderPage, remarkStepId);
  await recorderPage.getByRole('button', { name: '插入等待' }).click();
  await expect(recorderPage.locator('.review-step-list')).toContainText('等待');

  flow = await exportBusinessFlowJson(recorderPage);
  const waitStepId = requiredStepId(flow, (step: any) => step.action === 'wait', 'inserted wait step');
  expect(stepIndex(flow, waitStepId)).toBe(stepIndex(flow, remarkStepId) + 1);

  await openStepCheckPanel(recorderPage);
  const repeatStepIds = flow.steps
      .filter((step: any) => stepIndex(flow, step.id) >= stepIndex(flow, addStepId) && stepIndex(flow, step.id) <= stepIndex(flow, saveStepId))
      .map((step: any) => step.id);
  expect(repeatStepIds).toEqual(expect.arrayContaining([addStepId, validateStepId, fillStepId, remarkStepId, saveStepId, waitStepId]));
  expect(repeatStepIds).not.toContain(navigateStepId);
  for (const stepId of repeatStepIds)
    await recorderPage.locator(`button[aria-label="选择 ${stepId} 作为循环步骤"]`).click();
  await expect(recorderPage.locator('.repeat-create-actions .primary')).toBeEnabled();
  await recorderPage.locator('.repeat-create-actions .primary').click();
  await expect(recorderPage.locator('.repeat-editor')).toBeVisible({ timeout: 10_000 });
  if (await recorderPage.locator('.repeat-mapping').isVisible().catch(() => false)) {
    await recorderPage.locator('.repeat-mapping label').filter({ hasText: '片段名称' }).locator('input').fill('批量保存地址池');
    await recorderPage.getByRole('button', { name: '生成数据表' }).click();
  }
  await expect.poll(async () => await recorderPage.locator('.repeat-data input').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value).join('\n'))).toContain('pool-alpha');
  await recorderPage.getByRole('button', { name: '保存片段' }).click();
  await expect(recorderPage.locator('.repeat-segment-card')).toContainText(/批量保存地址池|批量执行/);

  await recorderPage.getByRole('button', { name: '保存记录' }).click();
  await openSavedRecord(recorderPage, flowName);
  await continueOpenedRecord(recorderPage);
  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await selectAntdOptionLikeUser(page, page.getByTestId('stability-wan-select'), 'WAN1', { searchText: 'WAN1' });
  await expect(page.getByTestId('stability-wan-select')).toContainText('WAN1', { timeout: 10_000 });
  await expect.poll(() => recorderStepSubjects(recorderPage), { timeout: 15_000 }).toContain('WAN1');
  await page.waitForTimeout(250);
  await page.getByPlaceholder('填写使用备注').fill('循环后继续补步骤');
  await page.getByTestId('site-post-save-action').click();
  await expect(page.getByTestId('event-log')).toContainText('post-save');
  await expect.poll(() => recorderStepSubjects(recorderPage), { timeout: 15_000 }).toMatch(/site-post-save-action|保存后动作/);
  await recorderPage.getByRole('button', { name: '停止录制' }).click();
  await expect(recorderPage.locator('.recording-status')).toContainText(/步骤检查|导出检查/);
  await recorderPage.getByRole('button', { name: '保存记录' }).click();

  await openSavedRecord(recorderPage, flowName);
  flow = await exportBusinessFlowJson(recorderPage);
  expect(flow.repeatSegments?.[0]?.stepIds).toEqual(repeatStepIds);
  expect(flow.repeatSegments?.[0]?.stepIds).not.toContain(navigateStepId);
  expect(flow.steps.some((step: any) => step.target?.testId === 'site-ip-validate')).toBeTruthy();
  expect(flow.steps.some((step: any) => step.action === 'wait')).toBeTruthy();
  expect(flow.artifacts.playwrightCode).toContain('for (const row of');
  expect(flow.artifacts.playwrightCode).toMatch(/批量保存地址池|批量执行/);
  const stabilityLoopStart = flow.artifacts.playwrightCode.indexOf('for (const row of');
  const stabilityLoopBody = flow.artifacts.playwrightCode.slice(stabilityLoopStart, flow.artifacts.playwrightCode.indexOf('\n  }', stabilityLoopStart));
  expect(stabilityLoopBody).not.toContain('page.goto(');
  expectInOrder(stabilityLoopBody, [
    'site-ip-add',
    'site-ip-validate',
    /String\(row\.poolName\)/,
    /String\(row\.remark\)/,
    /waitForTimeout\(1000\)/,
    'site-save-button',
  ]);
  expect(flow.artifacts.playwrightCode).toContain('WAN1');
  expect(flow.artifacts.playwrightCode).not.toContain('WAN1-copy');

  const stabilitySegment = flow.repeatSegments[0];
  const stabilityPoolParameter = stabilitySegment.parameters.find((parameter: any) => parameter.variableName === 'poolName');
  const stabilityPoolNames = stabilityPoolParameter ? stabilitySegment.rows.map((row: any) => row.values[stabilityPoolParameter.id]) : ['pool-alpha'];
  const stabilityRemarkParameter = stabilitySegment.parameters.find((parameter: any) => parameter.variableName === 'remark');
  const stabilityRows = stabilitySegment.rows.map((row: any, index: number) => ({
    poolName: stabilityPoolNames[index],
    remark: stabilityRemarkParameter ? row.values[stabilityRemarkParameter.id] : undefined,
  }));
  const stabilityReplayVerification = [
    `const stabilityPoolTable = page.getByTestId("site-ip-address-pool-table");`,
    ...stabilityRows.map((row: { poolName: string, remark?: string }) => `await expect(stabilityPoolTable.getByRole('row').filter({ hasText: /${[row.poolName, row.remark].filter(Boolean).map(escapeRegExp).join('[\\s\\S]*')}/ })).toBeVisible({ timeout: 10000 });`),
    `await expect(page.getByTestId("event-log")).toContainText("post-save", { timeout: 10000 });`,
  ];
  await replayGeneratedPlaywrightCode(context, flow.artifacts.playwrightCode, test.info(), {
    verify: async replayPage => {
      const stabilityPoolTable = replayPage.getByTestId('site-ip-address-pool-table');
      for (const row of stabilityRows)
        await expect(stabilityPoolTable.getByRole('row').filter({ hasText: new RegExp([row.poolName, row.remark].filter(Boolean).map(escapeRegExp).join('[\\s\\S]*')) })).toBeVisible({ timeout: 10_000 });
      await expect(replayPage.getByTestId('event-log')).toContainText('post-save', { timeout: 10_000 });
    },
    standalone: stabilityReplayVerification,
  });
});

// L2 deterministic recorder helpers: these specs intentionally use Playwright's
// high-level click/fill plus dispatchEvent for difficult AntD portals so they stay
// stable as regression tests. They are not treated as human-like coverage; see
// humanLikeRecorder.spec.ts for the L3 smoke path that drives mouse/keyboard actions.
async function beginNewFlowFromLibrary(recorderPage: Page) {
  const newFlowButton = recorderPage.getByRole('button', { name: '+ 新建流程' });
  if (!await newFlowButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    const backToLibrary = recorderPage.getByRole('button', { name: /返回流程库/ }).first();
    if (await backToLibrary.isVisible({ timeout: 3000 }).catch(() => false))
      await backToLibrary.click();
  }
  await expect(newFlowButton).toBeVisible({ timeout: 10_000 });
  await newFlowButton.click();
  await expect(recorderPage.locator('.flow-form-sheet')).toBeVisible({ timeout: 10_000 });
  await expect(recorderPage.locator('.flow-form-sheet')).toContainText('新建流程');
}

async function fillFlowMeta(recorderPage: Page, label: string, value: string) {
  const sheetLabel = label === '应用' ? '应用 / 模块 · 应用' :
    label === '模块' ? '应用 / 模块 · 模块' :
    label === '页面' ? '起始 URL / 页面 · 页面' :
    label;
  await recorderPage.locator('.flow-form-sheet label').filter({ hasText: sheetLabel }).locator('input, textarea, select').first().fill(value);
}

async function recorderStepSubjects(recorderPage: Page) {
  return (await recorderPage.locator('.flow-step-subject').allInnerTexts()).join('\n');
}

async function waitForRecordedMarker(recorderPage: Page, marker: string | RegExp, timeout = 25_000) {
  const subjectText = () => recorderStepSubjects(recorderPage);
  if (typeof marker === 'string')
    await expect.poll(subjectText, { timeout }).toContain(marker);
  else
    await expect.poll(subjectText, { timeout }).toMatch(marker);
}

async function clickVisibleAntDOption(page: Page, text: string) {
  const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
  const exactText = new RegExp(`^\\s*${escapeRegExp(text)}\\s*$`);
  const options = dropdown.locator('.ant-select-item-option').filter({ hasText: exactText });
  const option = options.first();
  await expect(option).toBeVisible({ timeout: 10_000 });
  await humanClick(option).catch(async () => {
    await option.click({ timeout: 10_000 });
  });
  const closedAfterHumanClick = await dropdown.waitFor({ state: 'hidden', timeout: 1500 }).then(() => true).catch(() => false);
  if (!closedAfterHumanClick && await option.isVisible().catch(() => false))
    await option.click({ timeout: 10_000, force: true });
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').first().waitFor({ state: 'hidden', timeout: 5000 });
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


async function clickVisibleAntDTreeNode(page: Page, text: string) {
  const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
  await expect(dropdown).toBeVisible({ timeout: 10_000 });
  const exactText = new RegExp(`^\\s*${escapeRegExp(text)}\\s*$`);
  const nodes = dropdown
      .locator('.ant-select-tree-node-content-wrapper, .ant-select-tree-title')
      .filter({ hasText: exactText });
  const node = nodes.first();
  await expect(node).toBeVisible({ timeout: 10_000 });
  await node.click({ timeout: 5_000 }).catch(async () => {
    await nodes.evaluateAll((elements, expectedText) => {
      const normalize = (value?: string | null) => (value || '').replace(/\s+/g, ' ').trim();
      const expected = normalize(expectedText);
      const element = elements.find(element => normalize(element.textContent) === expected);
      if (!element)
        throw new Error(`AntD tree node not found exactly: ${expected}`);
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }, text);
  });
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').first().waitFor({ state: 'hidden', timeout: 1000 }).catch(() => {});
}

async function clickVisibleAntDCascaderOption(page: Page, text: string) {
  const options = page
      .locator('.ant-cascader-dropdown:not(.ant-cascader-dropdown-hidden) .ant-cascader-menu-item')
      .filter({ hasText: text });
  const option = options.first();
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click({ timeout: 5_000 }).catch(async () => {
    await options.evaluateAll((elements, expectedText) => {
      const normalize = (value?: string | null) => (value || '').replace(/\s+/g, ' ').trim();
      const expected = normalize(expectedText);
      const element = elements.find(element => normalize(element.textContent) === expected);
      if (!element)
        throw new Error(`AntD cascader option not found exactly: ${expected}`);
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }, text);
  });
}

async function exportBusinessFlowJson(recorderPage: Page) {
  await openExportPanel(recorderPage);
  const exportedJson = await downloadTextAfterClick(
      recorderPage,
      recorderPage.getByRole('button', { name: '导出流程 JSON' }).last(),
  );
  return JSON.parse(exportedJson);
}

async function openExportPanel(recorderPage: Page) {
  if (await recorderPage.locator('.export-review-panel').isVisible().catch(() => false))
    return;
  await recorderPage.locator('.side-panel-nav').getByRole('button', { name: '导出', exact: true }).click();
  await expect(recorderPage.locator('.recording-status')).toContainText('导出检查');
  await expect(recorderPage.locator('.export-review-panel')).toBeVisible();
}

async function openStepCheckPanel(recorderPage: Page) {
  const status = recorderPage.locator('.recording-status');
  for (let attempt = 0; attempt < 3; attempt++) {
    await recorderPage.locator('.side-panel-nav').getByRole('button', { name: '录制', exact: true }).click();
    if (await status.getByText('步骤检查').isVisible().catch(() => false))
      break;
    if (await status.getByText('录制中').isVisible().catch(() => false))
      await recorderPage.getByRole('button', { name: '停止录制' }).click();
    await recorderPage.waitForTimeout(200);
  }
  await expect(status).toContainText('步骤检查', { timeout: 15_000 });
  await expect(recorderPage.locator('.review-step-list')).toBeVisible();
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

async function openInsertMenuAfterStep(recorderPage: Page, stepId: string) {
  await openStepCheckPanel(recorderPage);
  await recorderPage.evaluate(id => {
    const rows = Array.from(document.querySelectorAll('.review-step-row'));
    const row = rows.find(row => row.textContent?.includes(id));
    const slot = row?.nextElementSibling as HTMLElement | undefined;
    const button = slot?.querySelector('button') as HTMLButtonElement | null;
    if (!button)
      throw new Error(`Unable to find insert slot after ${id}`);
    button.click();
  }, stepId);
  await expect(recorderPage.locator('.review-insert-popover')).toBeVisible({ timeout: 10_000 });
}

async function openSavedRecord(recorderPage: Page, flowName: string) {
  if (!await recorderPage.locator('.flow-library').isVisible().catch(() => false)) {
    await recorderPage.locator('.side-panel-nav').getByRole('button', { name: '流程库', exact: true }).click();
    if (await recorderPage.getByRole('dialog', { name: '还有未保存的流程' }).isVisible().catch(() => false))
      await recorderPage.getByRole('button', { name: '立即保存并返回' }).click();
  }
  const card = recorderPage.locator('.library-card').filter({ hasText: flowName }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByRole('button', { name: '打开' }).click();
  await expect(recorderPage.locator('.recording-status')).toContainText(/步骤检查|导出检查/);
}

async function continueOpenedRecord(recorderPage: Page) {
  const recordingNav = recorderPage.locator('.side-panel-nav').getByRole('button', { name: '录制', exact: true });
  if (await recordingNav.isVisible().catch(() => false))
    await recordingNav.click();
  const continueRecording = recorderPage.getByRole('button', { name: '继续录制', exact: true }).first();
  if (await continueRecording.isVisible().catch(() => false)) {
    await continueRecording.click();
    return;
  }
  await recorderPage.getByRole('button', { name: '继续', exact: true }).click();
}

async function downloadTextAfterClick(recorderPage: Page, trigger: ReturnType<Page['locator']>) {
  const [download] = await Promise.all([
    recorderPage.waitForEvent('download'),
    trigger.click(),
  ]);
  const stream = await download.createReadStream();
  return await new Promise<string>((resolve, reject) => {
    let text = '';
    stream.on('data', chunk => text += chunk.toString());
    stream.on('end', () => resolve(text));
    stream.on('error', reject);
  });
}

function writeGeneratedReplayDiagnostic(testInfo: TestInfo, name: string, flow: any) {
  const rawReplayRoot = path.join(__dirname, '..', '.raw-generated-replay');
  const diagnosticDir = path.join(rawReplayRoot, `${testInfo.workerIndex}-${name}-diagnostic-${Date.now()}`);
  fs.mkdirSync(diagnosticDir, { recursive: true });
  fs.writeFileSync(path.join(diagnosticDir, 'generated-before-assert.spec.ts'), flow.artifacts?.playwrightCode || '');
  fs.writeFileSync(path.join(diagnosticDir, 'business-flow.json'), JSON.stringify(flow, null, 2));
}

function expectInOrder(text: string, markers: Array<string | RegExp>) {
  let offset = 0;
  for (const marker of markers) {
    const slice = text.slice(offset);
    const index = typeof marker === 'string' ? slice.indexOf(marker) : slice.search(marker);
    expect(index, `missing marker after offset ${offset}: ${String(marker)}`).toBeGreaterThanOrEqual(0);
    offset += index + 1;
  }
}

function expectScopedActiveAntdOptionReplay(code: string, fieldLabel: string, optionText: string, triggerTestId?: string) {
  const scopedTrigger = new RegExp(`page\\.locator\\(["']\\.ant-form-item["']\\)\\.filter\\(\\{\\s*hasText:\\s*["']${escapeRegExp(fieldLabel)}["']\\s*\\}\\)[\\s\\S]{0,240}\\.locator\\(["'][^"']*\\.ant-select-selector`);
  const trigger = triggerTestId
    ? new RegExp(`(?:${scopedTrigger.source}|const trigger = page\\.getByTestId\\(${escapeRegExp(JSON.stringify(triggerTestId))}\\);)`)
    : scopedTrigger;
  expectTriggerOwnedAntdOptionReplay(code, trigger, optionText, `missing scoped or explicit testId AntD select trigger for ${fieldLabel}`);
}

function expectTriggerOwnedAntdOptionReplay(code: string, trigger: RegExp | string, optionText: string, message = 'missing stable AntD select trigger') {
  const triggerIndex = typeof trigger === 'string' ? code.indexOf(trigger) : code.search(trigger);
  expect(triggerIndex, message).toBeGreaterThanOrEqual(0);
  const tail = code.slice(triggerIndex);
  const blockEnd = tail.indexOf('})();');
  const block = blockEnd >= 0 ? tail.slice(0, blockEnd) : tail.slice(0, 5000);
  expect(block, 'AntD option replay should use the trigger-owned dropdown helper').toContain('selectOwnedOption');
  expect(block, 'AntD option replay should check the trigger-owned target before reopening the select').toContain('if (!await selectOwnedOption(false))');
  expect(block, 'AntD option replay should dispatch through the trigger-owned dropdown helper').toContain('await selectOwnedOption(true);');
  expect(code, `AntD option replay should preserve option text ${optionText}`).toContain(optionText);
  expect(block, `AntD option replay should pin exact option text ${optionText}`).toMatch(new RegExp(`const expectedText = (?:${escapeRegExp(JSON.stringify(optionText))}|String\\(row\\.[A-Za-z_$][\\w$]*\\));`));
  expect(block, 'AntD option replay should inspect trigger ownership attrs').toContain('aria-controls');
  expect(block, 'AntD option replay should inspect trigger ownership attrs').toContain('aria-owns');
  expect(block, 'AntD option replay should inspect active descendant ownership').toContain('aria-activedescendant');
  expect(block, 'AntD option replay should search visible AntD dropdown roots').toContain('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');
  expect(block, 'AntD option replay should dispatch the AntD mouse event sequence').toContain('dispatchEvent(new MouseEvent("mousedown"');
  expect(block, 'AntD option replay should not use a broad active dropdown fallback').not.toContain('.ant-select-dropdown:visible, .ant-cascader-dropdown:visible');
  expect(code, 'AntD option replay must not use a broad text click fallback').not.toMatch(new RegExp(`page\\.getByText\\(["']${escapeRegExp(optionText)}["']\\)\\.click\\(\\)`));
  expect(code, 'AntD option replay must not use title fallback').not.toMatch(new RegExp(`getByTitle\\(["']${escapeRegExp(optionText)}["']\\)`));
  expect(code, 'AntD option replay must not bind to generated rc-select ids').not.toContain('#rc_select_');
}

function assertNoNetworkResourceSubmitBeforeRequiredFields(code: string) {
  const finalSaveIndex = code.lastIndexOf('network-resource-save');
  expect(finalSaveIndex, 'network-resource-save final submit should exist').toBeGreaterThanOrEqual(0);
  const tailAfterFinalSave = code.slice(finalSaveIndex + 'network-resource-save'.length)
      .split('\n')
      .filter(line => !line.trim().startsWith('await expect('))
      .join('\n');
  for (const marker of [
    'pool-proform-alpha',
    'edge-lab:WAN-extra-18',
    '生产VRF',
    '开启代理ARP',
    '启用健康检查',
    'network-resource-health-switch',
    'https://probe.example/health',
    '华东生产区',
    'NAT集群A',
    'https-admin',
    '8443',
    'ProFormField 全量组合录制',
    '服务名称',
    '监听端口',
    'network-resource-source-port',
    'network-resource-remark',
  ])
    expect(tailAfterFinalSave, `required field marker should not appear after final network-resource-save: ${marker}`).not.toContain(marker);
}

function generatedReplayCode(name: string, lines: string[]) {
  return [
    `import { test, expect } from '@playwright/test';`,
    ``,
    `test(${JSON.stringify(name)}, async ({ page }) => {`,
    ...lines.map(line => `  ${line}`),
    `});`,
    ``,
  ].join('\n');
}

function generatedReplayDiagnosticFlow(code: string) {
  return {
    schema: 'business-flow/v1',
    flow: {
      id: 'diagnostic-missing-row',
      name: 'Generated replay missing row diagnostic',
    },
    env: {
      url: 'https://example.test/users?token=abc123#debug',
    },
    preconditions: [],
    testData: [],
    steps: [{
      id: 's001',
      order: 1,
      action: 'click',
      intent: '验证创建后的用户行存在',
      target: {
        testId: 'users-table',
        role: 'table',
        name: '用户表格',
        text: 'charlie.qa owner@example.com 13800138000 token=abc123',
        selector: '[data-token="abc123"] .ant-table-row',
        scope: {
          table: {
            testId: 'users-table',
            title: '用户管理',
            rowKey: 'charlie.qa',
            rowText: 'charlie.qa owner@example.com 13800138000 审计员',
            rowIdentity: { source: 'data-row-key', value: 'charlie.qa', confidence: 0.98, stable: true },
          },
        },
      },
      context: {
        eventId: 'ctx-diagnostic-missing-row',
        capturedAt: 1000,
        before: {
          url: 'https://example.test/users?token=abc123#debug',
          title: '用户管理',
          target: {
            tag: 'table',
            role: 'table',
            testId: 'users-table',
            text: 'charlie.qa owner@example.com 13800138000 token=abc123',
          },
          table: {
            testId: 'users-table',
            title: '用户管理',
            rowKey: 'charlie.qa',
            rowText: 'charlie.qa owner@example.com 13800138000 审计员',
            rowIdentity: { source: 'data-row-key', value: 'charlie.qa', confidence: 0.98, stable: true },
          },
        },
      },
      assertions: [{
        id: 'a001',
        type: 'row-exists',
        subject: 'table',
        params: {
          tableTestId: 'users-table',
          rowKeyword: 'charlie.qa',
          columnValue: '审计员',
        },
        enabled: true,
      }],
    }],
    network: [],
    artifacts: {
      playwrightCode: code,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as any;
}

function latestRawReplayArtifact(testInfo: TestInfo, fileName: string, startedAt: number) {
  const rawReplayRoot = path.join(__dirname, '..', '.raw-generated-replay');
  if (!fs.existsSync(rawReplayRoot))
    return undefined;
  return fs.readdirSync(rawReplayRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.startsWith(`${testInfo.workerIndex}-`))
      .map(entry => {
        const filePath = path.join(rawReplayRoot, entry.name, fileName);
        if (!fs.existsSync(filePath))
          return undefined;
        const stat = fs.statSync(filePath);
        return stat.mtimeMs >= startedAt - 1000 ? { filePath, mtimeMs: stat.mtimeMs } : undefined;
      })
      .filter((entry): entry is { filePath: string; mtimeMs: number } => Boolean(entry))
      .sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.filePath;
}

function antDUsersFixture() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>AntD Users Fixture</title>
    <style>
      body { font-family: sans-serif; margin: 24px; }
      .ant-modal { display: none; border: 1px solid #ddd; padding: 16px; margin: 16px 0; }
      .ant-modal.open { display: block; }
      .ant-select-dropdown { display: none; border: 1px solid #ddd; padding: 8px; width: 180px; }
      .ant-select-dropdown.open { display: block; }
      .ant-btn { margin: 4px; }
      table { border-collapse: collapse; margin-top: 12px; }
      td, th { border: 1px solid #ddd; padding: 6px 10px; }
    </style>
  </head>
  <body>
    <section class="ant-pro-card" data-testid="user-admin-card">
      <div class="ant-pro-card-title">用户管理</div>
      <button class="ant-btn ant-btn-primary" data-testid="create-user-btn" type="button">
        <span>新建用户</span>
        <span class="anticon"><svg data-icon="plus" width="12" height="12"><path d="M6 1v10M1 6h10"></path></svg></span>
      </button>
      <div class="ant-modal" data-testid="create-user-modal" role="dialog" aria-label="新建用户">
        <div class="ant-modal-title">新建用户</div>
        <div class="ant-form ant-pro-form">
          <div class="ant-form-item" data-name="username">
            <label for="username">用户名</label>
            <div class="ant-form-item-control-input"><input id="username" name="username" placeholder="请输入用户名" /></div>
          </div>
          <div class="ant-form-item" data-name="role">
            <label>角色</label>
            <div class="ant-select ant-select-single" data-testid="role-select" role="combobox" aria-label="角色" tabindex="0">
              <div class="ant-select-selector"><span class="ant-select-selection-item">管理员</span></div>
            </div>
          </div>
        </div>
        <button class="ant-btn ant-btn-primary" data-testid="modal-confirm" type="button"><span>确定</span></button>
      </div>
      <div class="ant-select-dropdown" role="listbox">
        <div class="ant-select-item ant-select-item-option" role="option" title="管理员">管理员</div>
        <div class="ant-select-item ant-select-item-option" role="option" title="审计员">审计员</div>
      </div>
      <div class="ant-pro-table" data-testid="users-table">
        <div class="ant-pro-table-list-toolbar-title">用户列表</div>
        <div class="ant-table">
          <table>
            <thead><tr><th>用户名</th><th>角色</th><th>操作</th></tr></thead>
            <tbody>
              <tr class="ant-table-row" data-row-key="user-41"><td>Bob</td><td>访客</td><td class="ant-table-cell-fix-right"><button class="ant-btn" type="button"><span>编辑</span></button></td></tr>
              <tr class="ant-table-row" data-row-key="user-42"><td>Alice</td><td>管理员</td><td class="ant-table-cell-fix-right"><button class="ant-btn" type="button"><span>编辑</span></button></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
    <script>
      const modal = document.querySelector('[data-testid="create-user-modal"]');
      const dropdown = document.querySelector('.ant-select-dropdown');
      const roleText = document.querySelector('.ant-select-selection-item');
      document.querySelector('[data-testid="create-user-btn"]').addEventListener('click', () => modal.classList.add('open'));
      document.querySelector('[data-testid="role-select"]').addEventListener('click', () => dropdown.classList.add('open'));
      for (const option of document.querySelectorAll('[role="option"]')) {
        option.addEventListener('click', () => {
          roleText.textContent = option.textContent;
          dropdown.classList.remove('open');
        });
      }
      document.querySelector('[data-testid="modal-confirm"]').addEventListener('click', () => modal.classList.remove('open'));
    </script>
  </body>
</html>`;
}
