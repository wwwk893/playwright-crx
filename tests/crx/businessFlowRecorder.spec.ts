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

import type { Page, BrowserContext } from 'playwright-core';
import { test, expect } from './crxRecorderTest';

test.describe.configure({ mode: 'serial' });

test('records an AntD business flow through the plugin UI, exports it, and replays generated Playwright code @smoke', async ({ context, page, attachRecorder, baseURL, mockPaths }) => {
  test.setTimeout(120_000);

  await mockPaths({
    'antd/users.html': antDUsersFixture(),
  });

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page);
  recorderPage.on('dialog', dialog => dialog.accept());

  await beginNewFlowFromLibrary(recorderPage);
  await fillFlowMeta(recorderPage, '流程名称', 'AntD 用户流程 E2E');
  await fillFlowMeta(recorderPage, '应用', 'AntD Admin');
  await fillFlowMeta(recorderPage, '模块', '用户管理');
  await fillFlowMeta(recorderPage, '页面', '用户列表');
  await fillFlowMeta(recorderPage, '角色', '运营');
  await recorderPage.getByRole('button', { name: '创建并开始录制' }).click();

  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await page.goto(`${baseURL}/antd/users.html`);
  await expect(page.getByTestId('create-user-btn')).toBeVisible();

  await page.getByTestId('create-user-btn').locator('svg').click();
  await page.getByPlaceholder('请输入用户名').fill('alice');
  await page.getByTestId('role-select').click();
  await page.getByRole('option', { name: '审计员' }).click();
  await page.getByTestId('modal-confirm').locator('span').click();
  await expect(page.getByTestId('create-user-modal')).not.toHaveClass(/open/);
  await page.waitForTimeout(2200);
  await page.getByTestId('users-table').locator('tr[data-row-key="user-42"] button span').click();

  await expect.poll(() => recorderPage.locator('.flow-step').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(5);
  await expect.poll(async () => (await recorderPage.locator('.flow-step-subject').allInnerTexts()).join('\n')).toContain('create-user-btn');
  await expect.poll(async () => (await recorderPage.locator('.flow-step-subject').allInnerTexts()).join('\n')).toContain('alice');
  await expect.poll(async () => (await recorderPage.locator('.flow-step-subject').allInnerTexts()).join('\n')).toContain('Alice 管理员 编辑');

  await recorderPage.getByRole('button', { name: '停止录制' }).click();
  await expect(recorderPage.locator('.recording-status')).toContainText('复查');

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
  expect(flow.steps.length).toBeGreaterThanOrEqual(5);
  expect(flow.steps.some((step: any) => step.target?.testId === 'create-user-btn')).toBeTruthy();
  expect(flow.steps.some((step: any) => step.target?.placeholder === '请输入用户名' || step.target?.scope?.form?.label === '用户名')).toBeTruthy();
  expect(flow.steps.some((step: any) => step.target?.scope?.table?.rowKey === 'user-42')).toBeTruthy();
  expect(flow.artifacts.playwrightCode).toMatch(/getByTestId\(["']create-user-btn["']\)/);
  expect(flow.artifacts.playwrightCode).toMatch(/getBy(?:Label|Role)\(["']用户名|name:\s*["']用户名/);
  expect(flow.artifacts.playwrightCode).toMatch(/getByTestId\(["']users-table["']\)/);
  expect(flow.artifacts.playwrightCode).toContain('data-row-key=\\"user-42\\"');
  expect(exportedYaml).toContain('AntD 用户流程 E2E');
  expect(exportedYaml).toContain('user-42');

  await replayGeneratedPlaywrightCode(context, flow.artifacts.playwrightCode);
});

test('records a real AntD ProComponents async create-and-use flow @smoke', async ({ context, page, attachRecorder, baseURL }) => {
  test.setTimeout(120_000);

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page);
  recorderPage.on('dialog', dialog => dialog.accept());

  await beginNewFlowFromLibrary(recorderPage);
  await fillFlowMeta(recorderPage, '流程名称', '真实 AntD ProComponents 条目流程');
  await fillFlowMeta(recorderPage, '应用', 'AntD Pro');
  await fillFlowMeta(recorderPage, '模块', '条目管理');
  await fillFlowMeta(recorderPage, '页面', '真实组件页');
  await fillFlowMeta(recorderPage, '角色', '运营');
  await recorderPage.getByRole('button', { name: '创建并开始录制' }).click();

  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await page.goto(`${baseURL}/antd-pro-real.html`);
  await expect(page.getByText('真实 AntD ProComponents 页面')).toBeVisible();
  await expect(page.getByTestId('real-create-item')).toBeVisible();

  await page.getByTestId('real-create-item').locator('svg').click();
  await page.getByPlaceholder('请输入条目名称').fill('real-item-a');
  await page.getByPlaceholder('请输入负责人').fill('真实运营');
  await page.getByRole('button', { name: /保\s*存/ }).click();
  await expect(page.getByRole('row', { name: /real-item-a/ })).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('real-used-item-select').click();
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content').filter({ hasText: 'real-item-a' }).click();
  await page.getByPlaceholder('填写使用备注').fill('下方表单使用刚保存的条目');

  await expect.poll(() => recorderPage.locator('.flow-step').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(7);
  await expect.poll(async () => (await recorderPage.locator('.flow-step-subject').allInnerTexts()).join('\n')).toContain('real-create-item');
  await expect.poll(async () => (await recorderPage.locator('.flow-step-subject').allInnerTexts()).join('\n')).toContain('real-item-a');
  await expect.poll(async () => (await recorderPage.locator('.flow-step-subject').allInnerTexts()).join('\n')).toContain('下方表单使用条目');

  await recorderPage.getByRole('button', { name: '停止录制' }).click();
  await expect(recorderPage.locator('.recording-status')).toContainText('复查');

  const exportedJson = await downloadTextAfterClick(
      recorderPage,
      recorderPage.getByRole('button', { name: '导出流程 JSON' }).last(),
  );
  const flow = JSON.parse(exportedJson);

  expect(flow.flow.name).toBe('真实 AntD ProComponents 条目流程');
  expect(flow.steps.length).toBeGreaterThanOrEqual(7);
  expect(flow.steps.some((step: any) => step.target?.testId === 'real-create-item')).toBeTruthy();
  expect(flow.steps.some((step: any) => step.target?.label === '条目名称' || step.target?.placeholder === '请输入条目名称')).toBeTruthy();
  expect(flow.steps.some((step: any) => [step.target?.label, step.target?.displayName, step.target?.name, step.target?.placeholder, step.target?.testId].some(value => /下方表单使用条目|选择刚保存的条目|real-used-item-select/.test(String(value || ''))))).toBeTruthy();
  expect(flow.artifacts.playwrightCode).toContain('antd-pro-real.html');
  expect(flow.artifacts.playwrightCode).toMatch(/real-create-item|新建条目/);
  expect(flow.artifacts.playwrightCode).toContain('real-item-a');
  expect(flow.artifacts.playwrightCode).toContain('下方表单使用刚保存的条目');

  await replayGeneratedPlaywrightCode(context, flow.artifacts.playwrightCode);
});

async function beginNewFlowFromLibrary(recorderPage: Page) {
  const newFlowButton = recorderPage.getByRole('button', { name: '+ 新建流程' });
  if (!await newFlowButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    const backToLibrary = recorderPage.getByRole('button', { name: /返回流程库/ }).first();
    if (await backToLibrary.isVisible({ timeout: 3000 }).catch(() => false))
      await backToLibrary.click();
  }
  await expect(newFlowButton).toBeVisible({ timeout: 10_000 });
  await newFlowButton.click();
  await expect(recorderPage.locator('.flow-meta-panel')).toBeVisible({ timeout: 10_000 });
}

async function fillFlowMeta(recorderPage: Page, label: string, value: string) {
  await recorderPage.locator('.flow-meta-panel label').filter({ hasText: label }).locator('input, textarea').first().fill(value);
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

async function replayGeneratedPlaywrightCode(context: BrowserContext, code: string) {
  const body = testBody(code);
  const replayPage = await context.newPage();
  try {
    const replay = new Function('page', 'expect', `return (async () => {\n${body}\n})();`);
    await replay(replayPage, expect);
  } finally {
    await replayPage.close();
  }
}

function testBody(code: string) {
  const match = code.match(/test\([^,]+,\s*async\s*\(\{\s*page\s*\}\)\s*=>\s*\{\n([\s\S]*)\n\}\);\s*$/);
  if (!match)
    throw new Error(`Unable to extract generated Playwright test body:\n${code}`);
  return match[1]
      .split('\n')
      .filter(line => !line.trimStart().startsWith('//'))
      .join('\n');
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
