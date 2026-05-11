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

import { test } from './crxTest';

test('runtime active popup dispatch succeeds for explicit Select option bridge', async ({ runCrxTest, mockPaths }) => {
  await mockPaths({
    'runtime-active-popup.html': `<html>
      <body>
        <div id="selected">none</div>
        <div class="ant-select-dropdown" style="display:block; position:absolute; left:20px; top:20px; width:180px; height:80px;">
          <div class="ant-select-item-option" title="WAN1" style="pointer-events:none; width:160px; height:30px;">WAN1</div>
        </div>
        <script>
          document.querySelector('.ant-select-item-option').addEventListener('click', () => {
            document.querySelector('#selected').textContent = 'WAN1';
          });
        </script>
      </body>
    </html>`,
  });

  await runCrxTest(async ({ crxApp, page, server, expect }) => {
    const code = `import { test } from '@playwright/test';

test('runtime bridge contract', async ({ page }) => {
  await page.goto('${server.PREFIX}/runtime-active-popup.html');
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").filter({ hasText: "WAN1" }).click();
});`;

    await crxApp.recorder.run(code, page);

    await expect(page.locator('#selected')).toHaveText('WAN1');
  });
});

test('runtime active popup dispatch handles generated union selector for Select option bridge', async ({ runCrxTest, mockPaths }) => {
  await mockPaths({
    'runtime-union-active-popup.html': `<html>
      <body>
        <div id="selected">none</div>
        <div class="ant-cascader-dropdown" style="display:block; position:absolute; left:20px; top:20px; width:180px; height:80px;">
          <div id="cascader-option" class="ant-cascader-menu-item" title="LAN1" style="width:160px; height:30px;">LAN1</div>
        </div>
        <div class="ant-select-dropdown" style="display:block; position:absolute; left:220px; top:20px; width:180px; height:80px;">
          <div id="tree-option" class="ant-select-tree-node-content-wrapper" title="LAN2" style="width:160px; height:30px;">LAN2</div>
        </div>
        <div class="ant-select-dropdown" style="display:block; position:absolute; left:420px; top:20px; width:180px; height:80px;">
          <div id="select-option" class="ant-select-item-option" title="WAN1" style="pointer-events:none; width:160px; height:30px;">WAN1</div>
        </div>
        <script>
          document.querySelector('#cascader-option').addEventListener('click', () => {
            document.querySelector('#selected').textContent = 'cascader';
          });
          document.querySelector('#tree-option').addEventListener('click', () => {
            document.querySelector('#selected').textContent = 'tree';
          });
          document.querySelector('#select-option').addEventListener('click', () => {
            document.querySelector('#selected').textContent = 'WAN1';
          });
        </script>
      </body>
    </html>`,
  });

  await runCrxTest(async ({ crxApp, page, server, expect }) => {
    const activePopupRows = [
      '.ant-cascader-dropdown:not(.ant-cascader-dropdown-hidden) .ant-cascader-menu-item',
      '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-tree-node-content-wrapper',
      '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option',
    ].join(', ');
    const code = `import { test } from '@playwright/test';

test('runtime bridge contract', async ({ page }) => {
  await page.goto('${server.PREFIX}/runtime-union-active-popup.html');
  await page.locator(${JSON.stringify(activePopupRows)}).filter({ hasText: "WAN1" }).click();
});`;

    await crxApp.recorder.run(code, page);

    await expect(page.locator('#selected')).toHaveText('WAN1');
  });
});

test('runtime active popup dispatch waits for delayed explicit Select option render', async ({ runCrxTest, mockPaths }) => {
  await mockPaths({
    'runtime-delayed-popup.html': `<html>
      <body>
        <div id="selected">none</div>
        <div class="ant-select-dropdown" style="display:block; position:absolute; left:20px; top:20px; width:180px; min-height:80px;"></div>
        <script>
          setTimeout(() => {
            const option = document.createElement('div');
            option.className = 'ant-select-item-option';
            option.title = 'WAN1';
            option.style.cssText = 'pointer-events:none; width:160px; height:30px;';
            option.textContent = 'WAN1';
            option.addEventListener('click', () => {
              document.querySelector('#selected').textContent = 'WAN1';
            });
            document.querySelector('.ant-select-dropdown').appendChild(option);
          }, 300);
        </script>
      </body>
    </html>`,
  });

  await runCrxTest(async ({ crxApp, page, server, expect }) => {
    const code = `import { test } from '@playwright/test';

test('runtime bridge contract', async ({ page }) => {
  await page.goto('${server.PREFIX}/runtime-delayed-popup.html');
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").filter({ hasText: "WAN1" }).click();
});`;

    await crxApp.recorder.run(code, page);

    await expect(page.locator('#selected')).toHaveText('WAN1');
  });
});

test('runtime active popup dispatch fails closed without explicit option token', async ({ runCrxTest, mockPaths }) => {
  await mockPaths({
    'runtime-tokenless-popup.html': `<html>
      <body>
        <div id="selected">none</div>
        <div class="ant-select-dropdown" style="display:block; position:absolute; left:20px; top:20px; width:180px; height:80px;">
          <div class="ant-select-item-option" title="WAN1" style="width:160px; height:30px;">WAN1</div>
        </div>
        <script>
          document.querySelector('.ant-select-item-option').addEventListener('click', () => {
            document.querySelector('#selected').textContent = 'WAN1';
          });
        </script>
      </body>
    </html>`,
  });

  await runCrxTest(async ({ crxApp, page, server, expect }) => {
    const code = `import { test } from '@playwright/test';

test('runtime bridge contract', async ({ page }) => {
  await page.goto('${server.PREFIX}/runtime-tokenless-popup.html');
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").click();
});`;
    const error = await crxApp.recorder.run(code, page).then(() => undefined, error => error);

    expect(error?.message).toContain('runtime bridge: active select popup option selector requires explicit option text token');
    await expect(page.locator('#selected')).toHaveText('none');
  });
});

test('runtime active popup dispatch fails closed for ambiguous Select option candidates', async ({ runCrxTest, mockPaths }) => {
  await mockPaths({
    'runtime-ambiguous-popup.html': `<html>
      <body>
        <div id="selected">none</div>
        <div class="ant-select-dropdown" style="display:block; position:absolute; left:20px; top:20px; width:220px; height:120px;">
          <div class="ant-select-item-option" title="WAN1" data-option-index="first" style="pointer-events:none; width:180px; height:30px;">WAN1</div>
          <div class="ant-select-item-option" title="WAN1" data-option-index="second" style="pointer-events:none; width:180px; height:30px;">WAN1</div>
        </div>
        <script>
          for (const option of document.querySelectorAll('.ant-select-item-option')) {
            option.addEventListener('click', () => {
              document.querySelector('#selected').textContent = option.getAttribute('data-option-index');
            });
          }
        </script>
      </body>
    </html>`,
  });

  await runCrxTest(async ({ crxApp, page, server, expect }) => {
    const code = `import { test } from '@playwright/test';

test('runtime bridge contract', async ({ page }) => {
  await page.goto('${server.PREFIX}/runtime-ambiguous-popup.html');
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").filter({ hasText: "WAN1" }).click();
});`;
    const error = await crxApp.recorder.run(code, page).then(() => undefined, error => error);

    expect(error?.message).toContain('runtime bridge: no unique active select popup option matched explicit selector');
    await expect(page.locator('#selected')).toHaveText('none');
  });
});

test('runtime bridge contract does not open closed selects for parser-safe popup option actions', async ({ runCrxTest, mockPaths }) => {
  await mockPaths({
    'runtime-closed-select.html': `<html>
      <body>
        <div id="selected">none</div>
        <div class="ant-select">
          <div class="ant-select-selector" style="width:180px; height:30px; border:1px solid black;">WAN口</div>
        </div>
        <script>
          document.querySelector('.ant-select-selector').addEventListener('click', () => {
            const dropdown = document.createElement('div');
            dropdown.className = 'ant-select-dropdown';
            dropdown.innerHTML = '<div class="ant-select-item-option" title="WAN1">WAN1</div>';
            dropdown.querySelector('.ant-select-item-option').addEventListener('click', () => {
              document.querySelector('#selected').textContent = 'WAN1';
            });
            document.body.appendChild(dropdown);
          });
        </script>
      </body>
    </html>`,
  });

  await runCrxTest(async ({ crxApp, page, server, expect }) => {
    const code = `import { test } from '@playwright/test';

test('runtime bridge contract', async ({ page }) => {
  await page.goto('${server.PREFIX}/runtime-closed-select.html');
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").filter({ hasText: "WAN1" }).click();
});`;
    const error = await crxApp.recorder.run(code, page).then(() => undefined, error => error);

    expect(error?.message).toContain('runtime bridge: no unique active select popup option matched explicit selector');
    await expect(page.locator('#selected')).toHaveText('none');
    await expect(page.locator('.ant-select-dropdown')).toHaveCount(0);
  });
});

test('runtime active popconfirm confirm fallback dispatches only one click', async ({ runCrxTest, mockPaths }) => {
  await mockPaths({
    'runtime-popconfirm.html': `<html>
      <body>
        <div id="count">0</div>
        <div class="ant-popover" style="display:block; position:absolute; left:20px; top:20px; width:220px; min-height:100px;">
          <div class="ant-popconfirm">
            <div class="ant-popconfirm-message-title">删除此行？</div>
            <div class="ant-popconfirm-buttons">
              <button type="button">取消</button>
              <button type="button">OK</button>
            </div>
          </div>
        </div>
        <div class="ant-popover" style="display:block; position:absolute; left:20px; top:140px; width:220px; min-height:100px;">
          <div class="ant-popconfirm">
            <div class="ant-popconfirm-message-title">删除此行？</div>
            <div class="ant-popconfirm-buttons">
              <button type="button">取消</button>
              <button id="confirm" type="button">OK</button>
            </div>
          </div>
        </div>
        <script>
          let count = 0;
          document.querySelector('#confirm').addEventListener('click', () => {
            count += 1;
            document.querySelector('#count').textContent = String(count);
          });
        </script>
      </body>
    </html>`,
  });

  await runCrxTest(async ({ crxApp, page, server, expect }) => {
    const code = `import { test } from '@playwright/test';

test('runtime bridge contract', async ({ page }) => {
  await page.goto('${server.PREFIX}/runtime-popconfirm.html');
  await page.locator(".ant-popover:not(.ant-popover-hidden):not(.ant-zoom-big-leave):not(.ant-zoom-big-leave-active)").locator(".ant-popconfirm-buttons").getByRole("button", { name: "OK" }).click();
});`;

    await crxApp.recorder.run(code, page);

    await expect(page.locator('#count')).toHaveText('1');
  });
});
