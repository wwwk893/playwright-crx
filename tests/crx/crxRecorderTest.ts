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

import path from 'path';
import type { Page, Locator } from 'playwright-core';
import { test as crxTest, expect } from './crxTest';
import { sourceLines } from './utils';
import type { AssertAction } from '../../playwright/packages/recorder/src/actions';

export { expect } from './crxTest';

declare function attach(tab: chrome.tabs.Tab): Promise<void>;
declare function _setUnderTest(): void;

type RecorderMode = 'legacy' | 'business-flow';

type AttachRecorderOptions = {
  mode?: RecorderMode;
};

type SettingOptions = {
  testIdAttributeName?: string,
  targetLanguage?: string,
  playInIncognito?: boolean,
  experimental?: boolean,
  businessFlowEnabled?: boolean
};

export function dumpLogHeaders(recorderPage: Page) {
  return async () => {
    return await recorderPage.evaluate(() => {

      function iconName(iconElement: Element): string {
        const icon = iconElement.className.replace('codicon codicon-', '');
        if (icon === 'chevron-right')
          return '►';
        if (icon === 'chevron-down')
          return '▼';
        if (icon === 'blank')
          return ' ';
        if (icon === 'circle-outline')
          return '◯';
        if (icon === 'circle-slash')
          return '⊘';
        if (icon === 'check')
          return '✅';
        if (icon === 'error')
          return '❌';
        if (icon === 'eye')
          return '👁';
        if (icon === 'loading')
          return '↻';
        if (icon === 'clock')
          return '🕦';
        if (icon === 'debug-pause')
          return '⏸️';
        return icon;
      }

      function logHeaderToText(element: Element) {
        return [...element.childNodes].map(n => {
          if (n.nodeType === Node.TEXT_NODE)
            return n.textContent;
          else if (n instanceof Element)
            return n.classList.contains('codicon') ? iconName(n) : n.textContent?.replace(/— \d+(\.\d+)?m?s/g, '— XXms');

        }).join(' ');
      }

      return [...document.querySelectorAll('.call-log-call-header')].map(logHeaderToText);
    });
  };
}

export const test = crxTest.extend<{
  attachRecorder: (page: Page, options?: AttachRecorderOptions) => Promise<Page>;
  recorderPage: Page;
  recordAction<T = void>(action: () => Promise<T>): Promise<T>;
  recordAssertion(locator: Locator, type: AssertAction['name']): Promise<void>;
  configureRecorder: (config: SettingOptions) => Promise<void>;
      }>({
        extensionPath: path.join(__dirname, '../../examples/recorder-crx/dist'),

        attachRecorder: async ({ extensionServiceWorker, extensionId, context }, run) => {
          await run(async (page: Page, options: AttachRecorderOptions = {}) => {
            const mode = options.mode ?? 'legacy';
            await extensionServiceWorker.evaluate(async mode => {
              await chrome.storage.sync.set({ businessFlowEnabled: mode === 'business-flow' });
            }, mode);

            let recorderPage = context.pages().find(p => p.url().startsWith(`chrome-extension://${extensionId}`));
            const recorderPagePromise = recorderPage ? undefined : context.waitForEvent('page');
            if (recorderPage)
              await recorderPage.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});

            await page.bringToFront();
            await extensionServiceWorker.evaluate(async () => {
              // ensure we're in test mode
              _setUnderTest();

              const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
              await attach(tab);
            });

            recorderPage = recorderPage ?? (await recorderPagePromise)!;

            await recorderPage.waitForLoadState('domcontentloaded').catch(() => {});
            const recorderSurface = mode === 'legacy'
              ? recorderPage.locator('.recorder-editor')
              : recorderPage.locator('.business-flow-panel');
            await expect(recorderSurface).toBeAttached({ timeout: 15000 });

            const locator = page.locator('x-pw-glass').first();
            try {
              await locator.waitFor({ state: 'attached', timeout: 100 });
            } catch (e) {
              const recordButton = recorderPage.getByTitle('Record');
              const hasLegacyRecordButton = await recordButton.count().then(count => count > 0).catch(() => false);
              if (hasLegacyRecordButton) {
                if (await recordButton.evaluate(e => e.classList.contains('toggled'))) {
                  await recordButton.click();
                  await page.reload();
                  await recordButton.click();
                } else {
                  await page.reload();
                }
                await locator.waitFor({ state: 'attached', timeout: 100 });
              } else {
                await recorderPage.locator('.business-flow-panel, .recorder').first().waitFor({ state: 'attached', timeout: 1000 });
              }
            }

            return recorderPage;
          });
        },

        recorderPage: async ({ page, attachRecorder }, run) => {
          const recorderPage = await attachRecorder(page);
          await run(recorderPage);
          await recorderPage.close();
        },

        recordAction: async ({ recorderPage }, run) => {
          await run(async action => {
            // just to make sure code is up-to-date
            await recorderPage.waitForTimeout(100);
            const count = (await sourceLines(recorderPage)).length;
            const result = await action();
            await expect.poll(async () => {
              const first = await sourceLines(recorderPage);
              if (first.length <= count)
                return -1;
              await recorderPage.waitForTimeout(250);
              const second = await sourceLines(recorderPage);
              return first.join('\n') === second.join('\n') ? second.length : -1;
            }).toBeGreaterThan(count);
            return result;
          });
        },

        recordAssertion: async ({ page, recorderPage, recordAction }, run) => {
          await run(async (locator: Locator, name: AssertAction['name']) => {
            await recordAction(async () => {
              switch (name) {
                case 'assertText':
                  await recorderPage.getByTitle('Assert text').click();
                  await expect(recorderPage.getByTitle('Assert text')).toHaveClass(/toggled/);
                  await locator.click();
                  await page.locator('x-pw-glass').getByTitle('Accept').click();
                  break;
                case 'assertValue':
                  await recorderPage.getByTitle('Assert value').click();
                  await expect(recorderPage.getByTitle('Assert value')).toHaveClass(/toggled/);
                  await locator.click();
                  break;
                case 'assertVisible':
                  await recorderPage.getByTitle('Assert visibility').click();
                  await expect(recorderPage.getByTitle('Assert visibility')).toHaveClass(/toggled/);
                  await locator.click();
                  break;
                case 'assertSnapshot':
                  // ensure snapshot is toggled (for some reason, it may take more than one click)
                  const assertBtn = recorderPage.getByTitle('Assert snapshot');
                  while (await assertBtn.evaluate(e => !e.classList.contains('toggled')))
                    await assertBtn.click();
                  await locator.click();
                  break;
              }
            });
          });
        },

        configureRecorder: async ({ context, extensionId }, run) => {
          await run(async ({ testIdAttributeName, targetLanguage, playInIncognito, experimental, businessFlowEnabled }: SettingOptions) => {
            const configPage = await context.newPage();
            try {
              await configPage.goto(`chrome-extension://${extensionId}/preferences.html`);
              if (targetLanguage)
                await configPage.locator('#target-language').selectOption(targetLanguage);
              if (testIdAttributeName)
                await configPage.locator('#test-id').fill(testIdAttributeName);
              if (playInIncognito !== undefined)
                await configPage.locator('#playInIncognito').setChecked(playInIncognito);
              if (experimental !== undefined)
                await configPage.locator('#experimental').setChecked(experimental);
              if (businessFlowEnabled !== undefined)
                await configPage.locator('#businessFlowEnabled').setChecked(businessFlowEnabled);
              await configPage.locator('#submit').click();
            } finally {
              await configPage.close();
            }
          });
        },
      });
