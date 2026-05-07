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

import { test, expect } from './crxRecorderTest';
import { sourceLines } from './utils';

test('explicit legacy recorder mode opens the legacy recorder/player surface', async ({ page, attachRecorder, baseURL }) => {
  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page, { mode: 'legacy' });

  await expect(recorderPage.getByTitle('Record')).toBeVisible();
  await expect(recorderPage.locator('.business-flow-panel')).toHaveCount(0);
  await expect.poll(() => sourceLines(recorderPage)).not.toContain('  await page.goto("about:blank");');
});

test('explicit business-flow recorder mode opens the business flow surface', async ({ page, attachRecorder, baseURL }) => {
  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page, { mode: 'business-flow' });

  await expect(recorderPage.locator('.business-flow-panel')).toBeVisible();
  await expect(recorderPage.getByRole('button', { name: /新建流程/ })).toBeVisible();
  await expect(recorderPage.locator('.side-panel-nav')).toBeVisible();
  await expect(recorderPage.locator('.side-panel-nav').getByRole('button', { name: /录制/ })).toHaveCount(0);
  await expect(recorderPage.locator('.side-panel-nav').getByRole('button', { name: /^断言$/ })).toHaveCount(0);
});
