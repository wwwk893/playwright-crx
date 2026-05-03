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

test('legacy recorder fixture does not seed about:blank as the first recorded action', async ({ page, attachRecorder, recordAction, baseURL }) => {
  const recorderPage = await attachRecorder(page, { mode: 'legacy' });

  await recordAction(() => page.goto(`${baseURL}/empty.html`));

  await expect.poll(() => sourceLines(recorderPage)).not.toContain('  await page.goto("about:blank");');
  await expect.poll(() => sourceLines(recorderPage)).toContain(`  await page.goto('${baseURL}/empty.html');`);
});
