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

import { test, expect } from './crxTest';
import { sourceLines, sourceLineNumber, sourceMarkedLine, sourceMarkedLineNumber } from './utils';

test('sourceLines reads legacy CodeMirror 5 source lines', async ({ page }) => {
  await page.setContent(`
    <div class="CodeMirror-code">
      <div><span class="CodeMirror-linenumber">1</span><pre class="CodeMirror-line">import { test } from '@playwright/test';</pre></div>
      <div><span class="CodeMirror-linenumber">2</span><pre class="CodeMirror-line">&#8203;</pre></div>
      <div><span class="CodeMirror-linenumber">3</span><pre class="CodeMirror-line">await page.goto('/');</pre></div>
    </div>
  `);

  await expect.poll(() => sourceLines(page)).toEqual([
    "import { test } from '@playwright/test';",
    '',
    "await page.goto('/');",
  ]);
  await expect(sourceLineNumber(page, 3)).toHaveText("await page.goto('/');");
});

test('sourceLines reads current CodeMirror 6 source lines', async ({ page }) => {
  await page.setContent(`
    <div class="cm-editor">
      <div class="cm-lineNumbers"><div class="cm-gutterElement">1</div><div class="cm-gutterElement">2</div></div>
      <div class="cm-content">
        <div class="cm-line">const title = 'new editor';</div>
        <div class="cm-line">await expect(page).toHaveTitle(title);</div>
      </div>
    </div>
  `);

  await expect.poll(() => sourceLines(page)).toEqual([
    "const title = 'new editor';",
    "await expect(page).toHaveTitle(title);",
  ]);
  await expect(sourceLineNumber(page, 1)).toHaveText("const title = 'new editor';");
});

test('sourceMarkedLine returns paused and error source lines across editor DOM versions', async ({ page }) => {
  await page.setContent(`
    <div class="source-line-paused"><span class="CodeMirror-linenumber">17</span><pre class="CodeMirror-line">await page.pause();</pre></div>
    <div class="source-line-error"><div class="cm-line">await page.locator('missing').click();</div></div>
  `);

  await expect(sourceMarkedLine(page, 'paused')).toHaveText('await page.pause();');
  await expect(sourceMarkedLine(page, 'error')).toHaveText("await page.locator('missing').click();");
  await expect(sourceMarkedLineNumber(page, 'paused')).toHaveText('17');
});
