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
import { promises as fs } from 'fs';
import type { TestInfo } from '@playwright/test';
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

type RecorderDiagnosticsSnapshot = {
  recorderJsonl: string;
  runtimeJsonl: string;
  recorderCount: number;
  runtimeCount: number;
  source: 'window' | 'localStorage' | 'none';
};

const diagnosticStorageKey = 'playwright-crx:recorder-diagnostics';

async function readRecorderDiagnosticsSnapshot(recorderPage: Page): Promise<RecorderDiagnosticsSnapshot> {
  if (recorderPage.isClosed()) {
    return {
      recorderJsonl: '',
      runtimeJsonl: '',
      recorderCount: 0,
      runtimeCount: 0,
      source: 'none',
    };
  }
  return await recorderPage.evaluate(key => {
    type BrowserRecorderDiagnosticLog = {
      id?: number;
      time?: string;
      type?: string;
      message?: string;
      level?: string;
      data?: Record<string, unknown>;
    };
    const targetWindow = window as typeof window & {
      __playwrightCrxRecorderDiagnostics?: BrowserRecorderDiagnosticLog[];
    };
    const parseJsonl = (text: string | null): BrowserRecorderDiagnosticLog[] => {
      if (!text)
        return [];
      return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as BrowserRecorderDiagnosticLog);
    };
    let logs = Array.isArray(targetWindow.__playwrightCrxRecorderDiagnostics) ? targetWindow.__playwrightCrxRecorderDiagnostics : [];
    let source: 'window' | 'localStorage' | 'none' = logs.length ? 'window' : 'none';
    if (!logs.length) {
      logs = parseJsonl(window.localStorage.getItem(key));
      source = logs.length ? 'localStorage' : 'none';
    }
    const jsonl = (entries: BrowserRecorderDiagnosticLog[]) => entries.map(entry => JSON.stringify(entry)).join('\n') + (entries.length ? '\n' : '');
    const runtimeLogs = logs.filter(log => typeof log.type === 'string' && log.type.startsWith('runtime.'));
    return {
      recorderJsonl: jsonl(logs),
      runtimeJsonl: jsonl(runtimeLogs),
      recorderCount: logs.length,
      runtimeCount: runtimeLogs.length,
      source,
    };
  }, diagnosticStorageKey);
}

async function persistRecorderDiagnosticsArtifacts(testInfo: TestInfo, recorderPages: Page[]) {
  const uniquePages = recorderPages.filter((page, index) => !page.isClosed() && recorderPages.indexOf(page) === index);
  if (!uniquePages.length)
    return;
  for (let index = 0; index < uniquePages.length; index++) {
    const suffix = uniquePages.length > 1 ? `-${index + 1}` : '';
    const snapshot = await readRecorderDiagnosticsSnapshot(uniquePages[index]).catch(error => ({
      recorderJsonl: '',
      runtimeJsonl: '',
      recorderCount: 0,
      runtimeCount: 0,
      source: 'none' as const,
      exportError: error instanceof Error ? error.message : String(error),
    }));
    const artifacts = [
      { name: `playwright-runtime${suffix}.jsonl`, body: snapshot.runtimeJsonl },
      { name: `recorder-diagnostics${suffix}.jsonl`, body: snapshot.recorderJsonl },
      {
        name: `recorder-diagnostics-summary${suffix}.json`,
        body: JSON.stringify({
          recorderCount: snapshot.recorderCount,
          runtimeCount: snapshot.runtimeCount,
          source: snapshot.source,
          exportError: 'exportError' in snapshot ? snapshot.exportError : undefined,
        }, null, 2),
      },
    ];
    for (const artifact of artifacts) {
      const filePath = testInfo.outputPath(artifact.name);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, artifact.body, 'utf8');
    }
  }
}

async function attachRecorderDiagnosticsOnFailure(testInfo: TestInfo, recorderPages: Page[], failed = false) {
  if (!failed && testInfo.status === testInfo.expectedStatus && !testInfo.errors.length)
    return;
  const uniquePages = recorderPages.filter((page, index) => !page.isClosed() && recorderPages.indexOf(page) === index);
  if (!uniquePages.length)
    return;
  for (let index = 0; index < uniquePages.length; index++) {
    const suffix = uniquePages.length > 1 ? `-${index + 1}` : '';
    try {
      const snapshot = await readRecorderDiagnosticsSnapshot(uniquePages[index]);
      await testInfo.attach(`playwright-runtime${suffix}.jsonl`, {
        body: snapshot.runtimeJsonl,
        contentType: 'application/jsonl',
      });
      await testInfo.attach(`recorder-diagnostics${suffix}.jsonl`, {
        body: snapshot.recorderJsonl,
        contentType: 'application/jsonl',
      });
      await testInfo.attach(`recorder-diagnostics-summary${suffix}.json`, {
        body: JSON.stringify({
          recorderCount: snapshot.recorderCount,
          runtimeCount: snapshot.runtimeCount,
          source: snapshot.source,
        }, null, 2),
        contentType: 'application/json',
      });
    } catch (error) {
      await testInfo.attach(`recorder-diagnostics-summary${suffix}.json`, {
        body: JSON.stringify({
          exportError: error instanceof Error ? error.message : String(error),
        }, null, 2),
        contentType: 'application/json',
      });
    }
  }
}

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
  _autoRecorderDiagnosticsOnFailure: void;
      }>({
        extensionPath: path.join(__dirname, '../../examples/recorder-crx/dist'),

        attachRecorder: async ({ extensionServiceWorker, extensionId, context }, run) => {
          const extensionOrigin = `chrome-extension://${extensionId}`;
          await run(async (page: Page, options: AttachRecorderOptions = {}) => {
            const mode = options.mode ?? 'legacy';
            const expectedSurface = mode === 'legacy' ? '.recorder-editor' : '.business-flow-panel';
            await extensionServiceWorker.evaluate(async mode => {
              await chrome.storage.sync.set({ businessFlowEnabled: mode === 'business-flow' });
            }, mode);

            let didAttachCurrentTab = false;
            const attachCurrentTab = async () => {
              if (page.isClosed())
                throw new Error('Cannot attach recorder because the target page was closed');
              await page.bringToFront();
              await extensionServiceWorker.evaluate(async () => {
                // ensure we're in test mode
                _setUnderTest();

                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                await attach(tab);
              });
              didAttachCurrentTab = true;
            };

            const extensionPages = () => context.pages().filter(p => !p.isClosed() && p.url().startsWith(extensionOrigin));
            const hasExpectedSurface = async (candidate: Page, timeout = 2500) => {
              await candidate.waitForLoadState('domcontentloaded', { timeout }).catch(() => {});
              return await candidate.locator(expectedSurface).waitFor({ state: 'attached', timeout }).then(() => true).catch(() => false);
            };
            const usableExistingPage = async () => {
              for (const candidate of extensionPages()) {
                if (await hasExpectedSurface(candidate, 1000))
                  return candidate;
              }
            };

            let recorderPage = await usableExistingPage();
            if (!recorderPage) {
              for (const stalePage of extensionPages())
                await stalePage.close().catch(() => {});

              for (let attempt = 0; attempt < 3 && !recorderPage; attempt++) {
                const openedPagePromise = context.waitForEvent('page', { timeout: 5000 }).catch(() => undefined);
                await attachCurrentTab();
                const openedPage = await openedPagePromise;
                const candidates = [...new Set([openedPage, ...extensionPages()].filter(Boolean) as Page[])];
                for (const candidate of candidates) {
                  if (await hasExpectedSurface(candidate, 5000)) {
                    recorderPage = candidate;
                    break;
                  }
                }
                if (!recorderPage) {
                  for (const candidate of candidates)
                    await candidate.close().catch(() => {});
                }
              }
            }
            if (!recorderPage)
              throw new Error(`Recorder surface ${mode} did not attach after retrying stale extension pages`);
            if (!didAttachCurrentTab)
              await attachCurrentTab();

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
          try {
            await run(recorderPage);
          } finally {
            await recorderPage.close();
          }
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

        _autoRecorderDiagnosticsOnFailure: [async ({ context, extensionId }, use, testInfo) => {
          const extensionOrigin = `chrome-extension://${extensionId}`;
          let failed = false;
          try {
            await use();
          } catch (error) {
            failed = true;
            throw error;
          } finally {
            const recorderPages = context.pages().filter(page => !page.isClosed() && page.url().startsWith(extensionOrigin));
            await persistRecorderDiagnosticsArtifacts(testInfo, recorderPages);
            await attachRecorderDiagnosticsOnFailure(testInfo, recorderPages, failed);
          }
        }, { auto: true }],

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
