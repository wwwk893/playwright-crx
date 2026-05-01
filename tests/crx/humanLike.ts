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

import type { Locator, Page } from 'playwright-core';
import type { TestInfo } from '@playwright/test';
import { expect } from './crxRecorderTest';

// L3 human-like helpers: business-page and recorder-panel actions below use real
// mouse/keyboard movement instead of dispatchEvent/evaluate-driven DOM mutation.
// Small evaluate calls are only observational (focus/evidence/download text), not
// a shortcut for selecting options or deciding recorder internals.

export async function humanClick(locator: Locator, options?: { delayMs?: number, position?: 'center' | 'left' | 'right' }) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible({ timeout: 10_000 });
  await expect(locator).toBeEnabled({ timeout: 10_000 }).catch(() => {});

  const box = await stableBoundingBox(locator);
  if (!box)
    throw new Error('humanClick target has no bounding box');

  const x = options?.position === 'left' ? box.x + Math.min(12, box.width / 3) :
    options?.position === 'right' ? box.x + box.width - Math.min(12, box.width / 3) :
      box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const page = locator.page();

  await page.mouse.move(x, y, { steps: 8 });
  await page.waitForTimeout(options?.delayMs ?? 80);
  await page.mouse.down();
  await page.waitForTimeout(40);
  await page.mouse.up();
}

export async function humanClickUntil(locator: Locator, condition: () => Promise<boolean>, options?: { attempts?: number, afterClickDelayMs?: number }) {
  const attempts = options?.attempts ?? 3;
  for (let i = 0; i < attempts; i++) {
    if (await condition())
      return;
    try {
      await humanClick(locator);
    } catch (error) {
      if (await condition())
        return;
      throw error;
    }
    await locator.page().waitForTimeout(options?.afterClickDelayMs ?? 300);
    if (await condition())
      return;
  }
  throw new Error(`humanClickUntil condition was not met after ${attempts} attempts`);
}

async function openPopupLikeUser(trigger: Locator, popup: Locator) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (await popup.isVisible().catch(() => false))
      return;
    await humanClick(trigger);
    if (!await popup.isVisible().catch(() => false) && await trigger.locator('input').count().catch(() => 0))
      await humanClick(trigger.locator('input').first(), { position: 'left' });
    try {
      await popup.waitFor({ state: 'visible', timeout: 800 });
      return;
    } catch {
      // Retry with a fresh click. Some AntD controls ignore the first click while focus/animation settles.
    }
  }
  await trigger.click({ force: true, timeout: 2_000 }).catch(() => {});
  await popup.waitFor({ state: 'visible', timeout: 800 }).catch(() => {});
  if (await popup.isVisible().catch(() => false))
    return;
  await trigger.locator('input').first().press('ArrowDown', { timeout: 1_000 }).catch(async () => {
    await trigger.page().keyboard.press('ArrowDown').catch(() => {});
  });
  await expect(popup).toBeVisible({ timeout: 2_000 });
}

async function humanClickVisible(locator: Locator, options?: { delayMs?: number, position?: 'center' | 'left' | 'right' }) {
  await expect(locator).toBeVisible({ timeout: 10_000 });
  const box = await stableBoundingBox(locator);
  if (!box) {
    await locator.evaluate(element => {
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    });
    return;
  }
  const page = locator.page();
  const x = options?.position === 'left' ? box.x + Math.min(12, box.width / 3) :
    options?.position === 'right' ? box.x + box.width - Math.min(12, box.width / 3) :
      box.x + box.width / 2;
  await page.mouse.move(x, box.y + box.height / 2, { steps: 6 });
  await page.waitForTimeout(options?.delayMs ?? 60);
  await page.mouse.down();
  await page.waitForTimeout(35);
  await page.mouse.up();
}

async function stableBoundingBox(locator: Locator) {
  let previous = await locator.boundingBox();
  for (let i = 0; i < 3; i++) {
    await locator.page().waitForTimeout(50);
    const current = await locator.boundingBox();
    if (!previous || !current)
      return current;
    if (Math.abs(previous.x - current.x) < 0.5 && Math.abs(previous.y - current.y) < 0.5 && Math.abs(previous.width - current.width) < 0.5 && Math.abs(previous.height - current.height) < 0.5)
      return current;
    previous = current;
  }
  return previous;
}

export async function humanType(locator: Locator, text: string, options?: { clear?: boolean, blur?: boolean, delayMs?: number }) {
  await humanClick(locator);
  await ensureLocatorFocused(locator);
  const page = locator.page();

  if (options?.clear === true) {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.press('Backspace');
  }

  await page.keyboard.type(text, { delay: options?.delayMs ?? 35 });

  if (options?.blur !== false)
    await page.keyboard.press('Tab');
}

async function ensureLocatorFocused(locator: Locator) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const focused = await locator.evaluate(element => element === document.activeElement || element.contains(document.activeElement)).catch(() => false);
    if (focused)
      return;
    await locator.page().waitForTimeout(80);
    if (attempt === 0)
      await humanClick(locator, { delayMs: 40 });
  }
}

async function exactTextOption(candidates: Locator, expectedText: string) {
  const count = await candidates.count();
  const normalizedExpected = normalized(expectedText);
  for (let i = 0; i < count; i++) {
    const candidate = candidates.nth(i);
    if (!await candidate.isVisible().catch(() => false))
      continue;
    const text = normalized(await candidate.innerText().catch(() => ''));
    if (text === normalizedExpected)
      return candidate;
  }
  return undefined;
}

export async function selectAntdOptionLikeUser(page: Page, trigger: Locator, optionText: string, options?: { searchText?: string }) {
  await humanClick(trigger);

  const dropdown = page.locator('.ant-select-dropdown:visible').last();
  await expect(dropdown).toBeVisible({ timeout: 10_000 });

  if (options?.searchText)
    await page.keyboard.type(options.searchText, { delay: 25 });

  const option = await exactTextOption(dropdown.locator('.ant-select-item-option'), optionText) || dropdown
      .locator('.ant-select-item-option')
      .filter({ hasText: optionText })
      .last();
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.scrollIntoViewIfNeeded();
  await humanClick(option, { delayMs: 80 });

  await dropdown.waitFor({ state: 'hidden', timeout: 1500 }).catch(() => {});
}

export async function selectAntdTreeNodeLikeUser(page: Page, trigger: Locator, nodeText: string, options?: { searchText?: string }) {
  const dropdown = page.locator('.ant-select-dropdown:visible').last();
  await openPopupLikeUser(trigger, dropdown);
  await expect(dropdown).toBeVisible({ timeout: 10_000 });

  if (options?.searchText)
    await page.keyboard.type(options.searchText, { delay: 25 });

  const node = await exactTextOption(dropdown.locator('.ant-select-tree-node-content-wrapper'), nodeText) || dropdown
      .locator('.ant-select-tree-node-content-wrapper')
      .filter({ hasText: nodeText })
      .last();
  await expect(node).toBeVisible({ timeout: 10_000 });
  await humanClickVisible(node, { delayMs: 80 });
  await dropdown.waitFor({ state: 'hidden', timeout: 800 }).catch(async () => {
    await node.click({ force: true, timeout: 2_000 }).catch(() => {});
  });
  await dropdown.waitFor({ state: 'hidden', timeout: 1500 }).catch(() => {});
}

export async function selectAntdCascaderPathLikeUser(page: Page, trigger: Locator, path: string[]) {
  const dropdown = page.locator('.ant-cascader-dropdown:visible').last();
  await openPopupLikeUser(trigger, dropdown);
  await expect(dropdown).toBeVisible({ timeout: 10_000 });

  const input = trigger.locator('input').first();
  if (await input.isVisible().catch(() => false)) {
    const leaf = path[path.length - 1];
    await input.fill(leaf).catch(async () => page.keyboard.type(leaf, { delay: 25 }));
    const searchedItem = dropdown.locator('.ant-cascader-menu-item').filter({ hasText: leaf }).first();
    await expect(searchedItem).toBeVisible({ timeout: 10_000 });
    await humanClickVisible(searchedItem, { delayMs: 80 });
    await dropdown.waitFor({ state: 'hidden', timeout: 1500 }).catch(() => {});
    return;
  }

  for (let index = 0; index < path.length; index++) {
    const segment = path[index];
    const menu = dropdown.locator('.ant-cascader-menu').nth(index);
    await expect(menu).toBeVisible({ timeout: 10_000 });
    const item = await exactTextOption(menu.locator('.ant-cascader-menu-item'), segment) || menu
        .locator('.ant-cascader-menu-item')
        .filter({ hasText: segment })
        .first();
    await expect(item).toBeVisible({ timeout: 10_000 });
    if (index < path.length - 1) {
      await humanClickVisible(item, { delayMs: 80 });
      await page.waitForTimeout(160);
      const nextMenu = dropdown.locator('.ant-cascader-menu').nth(index + 1);
      if (!await nextMenu.isVisible().catch(() => false)) {
        const box = await item.boundingBox();
        if (box)
          await page.mouse.move(box.x + box.width - 8, box.y + box.height / 2, { steps: 4 });
        await expect(nextMenu).toBeVisible({ timeout: 5_000 });
      }
    } else {
      await humanClickVisible(item, { delayMs: 80 });
    }
  }

  await dropdown.waitFor({ state: 'hidden', timeout: 1500 }).catch(() => {});
}

export async function beginNewFlowFromLibraryLikeUser(recorderPage: Page) {
  const newFlowButton = recorderPage.getByRole('button', { name: /新建流程/ }).first();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await newFlowButton.isVisible({ timeout: 2000 }).catch(() => false))
      break;
    const backToLibrary = recorderPage.locator('.back-to-library, .flow-detail-back').filter({ hasText: '返回流程库' }).first();
    if (await backToLibrary.isVisible({ timeout: 2000 }).catch(() => false)) {
      await humanClick(backToLibrary);
      await recorderPage.waitForTimeout(300);
    }
  }
  await expect(newFlowButton).toBeVisible({ timeout: 10_000 });
  await humanClick(newFlowButton);
  await expect(recorderPage.locator('.flow-meta-panel')).toBeVisible({ timeout: 10_000 });
}

export async function fillFlowMetaLikeUser(recorderPage: Page, label: string, value: string) {
  const input = recorderPage.locator('.flow-meta-panel label').filter({ hasText: label }).locator('input, textarea').first();
  await humanType(input, value, { blur: true });
}

export async function visibleStepTexts(recorderPage: Page) {
  return (await recorderPage.locator('.flow-step, .review-step-row').allInnerTexts()).join('\n');
}

export async function createRepeatSegmentLikeUser(recorderPage: Page, options: { fromStepText: string, toStepText: string, segmentName: string, minSteps?: number, expectedDataText?: string | RegExp }) {
  await expect(recorderPage.locator('.review-step-list, .flow-step-list').first()).toBeVisible({ timeout: 10_000 });
  const selected = await selectVisibleRepeatRange(recorderPage, options.fromStepText, options.toStepText);
  expect(selected).toBeGreaterThanOrEqual(options.minSteps ?? 5);

  const createButton = recorderPage.locator('.repeat-create-actions .primary');
  await expect(createButton).toBeEnabled({ timeout: 10_000 });
  await humanClick(createButton);
  await expect(recorderPage.locator('.repeat-editor')).toBeVisible({ timeout: 10_000 });

  if (await recorderPage.locator('.repeat-data').isVisible().catch(() => false))
    await humanClick(recorderPage.getByRole('button', { name: '返回上一步' }));
  await expect(recorderPage.locator('.repeat-mapping')).toBeVisible({ timeout: 10_000 });

  await humanType(recorderPage.locator('.repeat-mapping label').filter({ hasText: '片段名称' }).locator('input'), options.segmentName, { clear: true });
  await humanClick(recorderPage.getByRole('button', { name: '生成数据表' }));
  await expect(recorderPage.locator('.repeat-data')).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => await recorderPage.locator('.repeat-data input').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value).join('\n'))).toMatch(options.expectedDataText ?? /test1|.+/);

  await humanClick(recorderPage.getByRole('button', { name: '保存片段' }));
  await expect(recorderPage.locator('.repeat-segment-card')).toContainText(options.segmentName);
}

async function selectVisibleRepeatRange(recorderPage: Page, fromStepText: string, toStepText: string) {
  const rows = recorderPage.locator('.review-step-row, .flow-step');
  const count = await rows.count();
  let selecting = false;
  let selected = 0;
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const text = await row.innerText().catch(() => '');
    if (!selecting && normalized(text).includes(normalized(fromStepText)))
      selecting = true;
    if (selecting) {
      const selectButton = row.locator('button[aria-label^="选择 "][aria-label$="作为循环步骤"]').first();
      if (await selectButton.isVisible().catch(() => false)) {
        await humanClick(selectButton);
        selected++;
      }
    }
    if (selecting && normalized(text).includes(normalized(toStepText)))
      break;
  }
  return selected;
}

function normalized(value: string) {
  return value.replace(/\s+/g, '');
}

export async function exportBusinessFlowJsonLikeUser(recorderPage: Page) {
  const exportedJson = await downloadTextAfterHumanClick(
      recorderPage,
      recorderPage.getByRole('button', { name: '导出流程 JSON' }).last(),
  );
  return JSON.parse(exportedJson);
}

async function downloadTextAfterHumanClick(recorderPage: Page, trigger: Locator) {
  const [download] = await Promise.all([
    recorderPage.waitForEvent('download'),
    humanClick(trigger),
  ]);
  const stream = await download.createReadStream();
  return await new Promise<string>((resolve, reject) => {
    let text = '';
    stream.on('data', chunk => text += chunk.toString());
    stream.on('end', () => resolve(text));
    stream.on('error', reject);
  });
}

export async function attachRecorderEvidence(testInfo: TestInfo, page: Page, recorderPage: Page, flow: any) {
  await testInfo.attach('business-page-screenshot', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
  await testInfo.attach('recorder-review-screenshot', {
    body: await recorderPage.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
  await testInfo.attach('business-flow.json', {
    body: JSON.stringify(flow, null, 2),
    contentType: 'application/json',
  });
  await testInfo.attach('generated.spec.ts', {
    body: flow.artifacts?.playwrightCode || '',
    contentType: 'text/plain',
  });
}
