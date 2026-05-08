/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

type CapturedContextEvent = {
  before?: {
    target?: { text?: string; testId?: string; role?: string };
    ui?: {
      component?: string;
      componentPath?: string[];
      library?: string;
      targetText?: string;
      targetTestId?: string;
      targetRole?: string;
      form?: { label?: string; name?: string; formKind?: string; fieldKind?: string; testId?: string };
      table?: { title?: string; testId?: string; tableId?: string; rowKey?: string; columnKey?: string; columnTitle?: string; region?: string; tableKind?: string };
      overlay?: { type?: string; title?: string; text?: string };
      option?: { text?: string; path?: string[] };
      recipe?: { kind?: string; component?: string; formKind?: string; fieldLabel?: string; fieldName?: string; optionText?: string; tableTitle?: string; rowKey?: string; columnTitle?: string; overlayTitle?: string; targetText?: string };
      locatorHints?: Array<{ kind?: string; score?: number; reason?: string }>;
      confidence?: number;
      weak?: boolean;
    };
  };
};

type SidecarFixtureOptions = {
  semanticAdapterEnabled?: boolean;
  semanticAdapterDiagnosticsEnabled?: boolean;
};

test.describe('MVP 0.1.4 AntD / ProComponents semantic adapter', () => {
  test('annotates every required AntD and ProComponents component family with UiSemanticContext', async ({ page }) => {
    const cases: Array<{
      name: string;
      sequence: string[];
      component: string;
      library?: string;
      recipe?: string;
      formLabel?: string;
      formKind?: string;
      tableTitle?: string;
      rowKey?: string;
      overlayType?: string;
      overlayTitle?: string;
      optionText?: string;
      columnTitle?: string;
      weak?: boolean;
    }> = [
      { name: 'AntD Form.Item input', sequence: ['#username-input'], component: 'input', library: 'antd', recipe: 'fill-form-field', formLabel: '用户名', formKind: 'antd-form' },
      { name: 'AntD Form submit', sequence: ['#form-submit'], component: 'form', library: 'antd', recipe: 'submit-form', formKind: 'antd-form' },
      { name: 'AntD Table row action', sequence: ['#user-edit'], component: 'table', library: 'antd', recipe: 'table-row-action', tableTitle: '用户列表', rowKey: 'user-42', columnTitle: '操作' },
      { name: 'AntD Select option', sequence: ['#role-select .ant-select-selector', '#role-admin'], component: 'select', library: 'antd', recipe: 'select-option', formLabel: '角色', optionText: '管理员' },
      { name: 'AntD TreeSelect option', sequence: ['#scope-tree-select .ant-select-selector', '#scope-east'], component: 'tree-select', library: 'antd', recipe: 'select-option', formLabel: '发布范围', optionText: '华东生产区' },
      { name: 'AntD Cascader option', sequence: ['#egress-cascader .ant-cascader-picker', '#egress-nat'], component: 'cascader', library: 'antd', recipe: 'select-option', formLabel: '出口路径', optionText: 'NAT集群A' },
      { name: 'AntD DatePicker', sequence: ['#start-date'], component: 'date-picker', library: 'antd', recipe: 'pick-date', formLabel: '开始日期' },
      { name: 'AntD RangePicker', sequence: ['#range-picker'], component: 'range-picker', library: 'antd', recipe: 'pick-range', formLabel: '有效期' },
      { name: 'AntD Modal action', sequence: ['#modal-ok'], component: 'modal', library: 'antd', recipe: 'modal-action', overlayType: 'modal', overlayTitle: '新建用户' },
      { name: 'AntD Drawer action', sequence: ['#drawer-save'], component: 'drawer', library: 'antd', recipe: 'drawer-action', overlayType: 'drawer', overlayTitle: '编辑策略' },
      { name: 'AntD Dropdown menu item', sequence: ['#more-menu-delete'], component: 'dropdown', library: 'antd', recipe: 'dropdown-menu-action', overlayType: 'dropdown', optionText: '删除' },
      { name: 'AntD Popover trigger', sequence: ['#popover-trigger'], component: 'popover', library: 'antd', recipe: 'raw-dom-action', overlayType: 'popover', overlayTitle: '高级提示', weak: true },
      { name: 'AntD Popconfirm OK', sequence: ['#popconfirm-ok'], component: 'popconfirm', library: 'antd', recipe: 'confirm-popconfirm', overlayType: 'popconfirm', overlayTitle: '确认删除?' },
      { name: 'AntD Tooltip trigger', sequence: ['#tooltip-trigger'], component: 'tooltip', library: 'antd', recipe: 'show-tooltip', overlayType: 'tooltip', overlayTitle: '禁用状态说明' },
      { name: 'AntD Tabs', sequence: ['#tab-security'], component: 'tabs', library: 'antd', recipe: 'switch-tab' },
      { name: 'AntD Upload', sequence: ['#upload-button'], component: 'upload', library: 'antd', recipe: 'upload-file', formLabel: '附件' },
      { name: 'AntD Switch', sequence: ['#enable-switch'], component: 'switch', library: 'antd', recipe: 'toggle-control', formLabel: '启用健康检查' },
      { name: 'AntD Checkbox', sequence: ['#agreement-checkbox'], component: 'checkbox', library: 'antd', recipe: 'toggle-control', formLabel: '同意协议' },
      { name: 'AntD Radio', sequence: ['#mode-advanced-radio'], component: 'radio-group', library: 'antd', recipe: 'toggle-control', formLabel: '运行模式' },
      { name: 'ProTable toolbar', sequence: ['#protable-create'], component: 'pro-table', library: 'pro-components', recipe: 'protable-toolbar-action', tableTitle: '用户管理' },
      { name: 'ProTable search', sequence: ['#protable-search-button'], component: 'pro-table', library: 'pro-components', recipe: 'protable-search', tableTitle: '用户管理', formLabel: '关键字' },
      { name: 'EditableProTable cell', sequence: ['#editable-cell'], component: 'editable-pro-table', library: 'pro-components', recipe: 'editable-table-cell', tableTitle: '编辑规则', rowKey: 'rule-1', columnTitle: '规则名称' },
      { name: 'ProForm field', sequence: ['#proform-owner'], component: 'pro-form-field', library: 'pro-components', recipe: 'fill-form-field', formKind: 'pro-form', formLabel: '负责人' },
      { name: 'ModalForm submit', sequence: ['#modal-form-submit'], component: 'modal-form', library: 'pro-components', recipe: 'submit-form', formKind: 'modal-form', overlayTitle: '新建租户' },
      { name: 'DrawerForm submit', sequence: ['#drawer-form-submit'], component: 'drawer-form', library: 'pro-components', recipe: 'submit-form', formKind: 'drawer-form', overlayTitle: '编辑租户' },
      { name: 'StepsForm next', sequence: ['#steps-next'], component: 'steps-form', library: 'pro-components', recipe: 'switch-step' },
      { name: 'BetaSchemaForm weak field', sequence: ['#schema-field'], component: 'beta-schema-form', library: 'pro-components', recipe: 'fill-form-field', formKind: 'beta-schema-form', formLabel: 'Schema 字段', weak: true },
      { name: 'ProDescriptions item', sequence: ['#desc-status'], component: 'pro-descriptions', library: 'pro-components', recipe: 'assert-description-field' },
      { name: 'PageContainer action', sequence: ['#page-action'], component: 'page-container', library: 'pro-components', recipe: 'click-button', weak: true },
      { name: 'ProCard action', sequence: ['#card-action'], component: 'pro-card', library: 'pro-components', recipe: 'click-button', weak: true },
      { name: 'ProList row action', sequence: ['#list-action'], component: 'pro-list', library: 'pro-components', recipe: 'table-row-action', rowKey: 'list-1' },
    ];

    for (const testCase of cases) {
      await installSidecarFixture(page);
      const event = await captureAfterSequence(page, testCase.sequence);
      const ui = event.before?.ui;
      expect(ui, `${testCase.name} should emit before.ui`).toBeTruthy();
      const components = new Set([ui?.component, ...(ui?.componentPath ?? [])].filter(Boolean));
      expect(components.has(testCase.component), `${testCase.name} should include component ${testCase.component}, got ${JSON.stringify(Array.from(components))}`).toBeTruthy();
      if (testCase.library)
        expect(ui?.library, testCase.name).toBe(testCase.library);
      if (testCase.recipe)
        expect(ui?.recipe?.kind, testCase.name).toBe(testCase.recipe);
      if (testCase.formLabel)
        expect(ui?.form?.label || ui?.recipe?.fieldLabel, testCase.name).toBe(testCase.formLabel);
      if (testCase.formKind)
        expect(ui?.form?.formKind || ui?.recipe?.formKind, testCase.name).toBe(testCase.formKind);
      if (testCase.tableTitle)
        expect(ui?.table?.title || ui?.recipe?.tableTitle, testCase.name).toBe(testCase.tableTitle);
      if (testCase.rowKey)
        expect(ui?.table?.rowKey || ui?.recipe?.rowKey, testCase.name).toBe(testCase.rowKey);
      if (testCase.columnTitle)
        expect(ui?.table?.columnTitle || ui?.recipe?.columnTitle, testCase.name).toBe(testCase.columnTitle);
      if (testCase.overlayType)
        expect(ui?.overlay?.type, testCase.name).toBe(testCase.overlayType);
      if (testCase.overlayTitle)
        expect(ui?.overlay?.title || ui?.recipe?.overlayTitle, testCase.name).toBe(testCase.overlayTitle);
      if (testCase.optionText)
        expect(ui?.option?.text || ui?.recipe?.optionText || ui?.targetText, testCase.name).toBe(testCase.optionText);
      if (testCase.weak !== undefined)
        expect(Boolean(ui?.weak), testCase.name).toBe(testCase.weak);
      expect(ui?.locatorHints?.length, `${testCase.name} should include locator hints`).toBeGreaterThan(0);
      expect(ui?.confidence, `${testCase.name} should include confidence`).toBeGreaterThan(0);
    }
  });

  test('marks unmatched DOM targets as unknown library', async ({ page }) => {
    await installSidecarFixture(page);
    const event = await captureAfterSequence(page, ['#plain-status']);
    const ui = event.before?.ui;
    expect(ui?.component).toBe('unknown');
    expect(ui?.library).toBe('unknown');
    expect(ui?.weak).toBe(true);
  });

  test('can disable semantic adapter without losing basic page context', async ({ page }) => {
    await installSidecarFixture(page, { semanticAdapterEnabled: false, semanticAdapterDiagnosticsEnabled: true });
    const event = await captureAfterSequence(page, ['#role-select .ant-select-selector']);
    expect(event.before?.target?.text || event.before?.target?.testId || event.before?.target?.role).toBeTruthy();
    expect(event.before?.ui).toBeUndefined();
    const diagnostics = await readSemanticDiagnostics(page);
    expect(diagnostics.some(entry => entry.event === 'semantic.disabled')).toBe(true);
  });

  test('keeps semantic diagnostics compact and private', async ({ page }) => {
    await installSidecarFixture(page, { semanticAdapterDiagnosticsEnabled: true });
    await captureAfterSequence(page, ['#plain-status']);
    await captureAfterSequence(page, ['#role-select .ant-select-selector', '#role-admin']);
    const diagnostics = await readSemanticDiagnostics(page);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some(entry => entry.event === 'semantic.detect' || entry.event === 'semantic.weak' || entry.event === 'semantic.fallback-css')).toBe(true);
    const json = JSON.stringify(diagnostics);
    expect(json).toContain('valuePreview');
    expect(json).not.toContain('"value"');
    expect(json).not.toContain('rowText');
    expect(json).not.toContain('overlay text');
    expect(json).not.toContain('option.value');
  });

  test('maps generic business e2e hints into UiSemanticContext without networking hardcoding', async ({ page }) => {
    await installSidecarFixture(page);

    const toolbarEvent = await captureAfterSequence(page, ['#business-create']);
    expect(toolbarEvent.before?.ui?.library).toBe('pro-components');
    expect(toolbarEvent.before?.ui?.component).toBe('pro-table-toolbar');
    expect(toolbarEvent.before?.ui?.targetTestId).toBe('site-ip-port-pool-create-button');
    expect(toolbarEvent.before?.ui?.table?.tableId || toolbarEvent.before?.ui?.table?.title).toBe('ip-port-pool');
    expect(toolbarEvent.before?.ui?.recipe?.kind).toBe('protable-toolbar-action');

    const fieldEvent = await captureAfterSequence(page, ['#business-vrf-select .ant-select-selector']);
    expect(fieldEvent.before?.ui?.library).toBe('antd');
    expect(fieldEvent.before?.ui?.component).toBe('select');
    expect(fieldEvent.before?.ui?.targetTestId).toBe('site-ip-port-pool-vrf-select');
    expect(fieldEvent.before?.ui?.form?.name).toBe('destVrfId');
    expect(fieldEvent.before?.ui?.form?.fieldKind).toBe('select');
    expect(fieldEvent.before?.ui?.form?.testId).toBe('site-ip-port-pool-vrf-field');
    expect(fieldEvent.before?.ui?.recipe?.fieldName).toBe('destVrfId');

    const unmappedComponentEvent = await captureAfterSequence(page, ['#business-unmapped-select .ant-select-selector']);
    expect(unmappedComponentEvent.before?.ui?.library).toBe('antd');
    expect(unmappedComponentEvent.before?.ui?.component).toBe('select');
    expect(unmappedComponentEvent.before?.ui?.targetTestId).toBe('site-unmapped-select');
    expect(unmappedComponentEvent.before?.ui?.form?.name).toBe('unmappedSelect');

    const fallbackTableEvent = await captureAfterSequence(page, ['#business-alt-table-edit']);
    expect(fallbackTableEvent.before?.ui?.component).toBe('pro-table');
    expect(fallbackTableEvent.before?.ui?.table?.testId).toBe('business-alt-table');
    expect(fallbackTableEvent.before?.ui?.table?.rowKey).toBe('alt-1');
    expect(fallbackTableEvent.before?.ui?.recipe?.kind).toBe('table-row-action');

    const nonTableCreateEvent = await captureAfterSequence(page, ['#business-non-table-create']);
    expect(nonTableCreateEvent.before?.ui?.targetTestId).toBe('business-non-table-create');
    expect(nonTableCreateEvent.before?.ui?.table).toBeUndefined();
    expect(nonTableCreateEvent.before?.ui?.recipe?.kind).not.toBe('protable-toolbar-action');

    const rowEvent = await captureAfterSequence(page, ['#business-row-edit']);
    expect(rowEvent.before?.ui?.library).toBe('pro-components');
    expect(rowEvent.before?.ui?.component).toBe('pro-table');
    expect(rowEvent.before?.ui?.table?.rowKey).toBe('pool-42');
    expect(rowEvent.before?.ui?.table?.columnKey).toBe('option');
    expect(rowEvent.before?.ui?.recipe?.kind).toBe('table-row-action');

    const unknownEvent = await captureAfterSequence(page, ['#business-unknown-hint']);
    expect(unknownEvent.before?.ui?.component).toBe('unknown');
    expect(unknownEvent.before?.ui?.library).toBe('unknown');
    expect(unknownEvent.before?.ui?.targetTestId).toBe('custom-widget-root');
  });

  test('records a realistic IP Pools pilot flow with human-like interactions', async ({ page }) => {
    await page.setContent(businessPilotFixtureHtml());
    await installSidecarOnCurrentPage(page);

    const createEvent = await userClickAndRead(page, '#site-ip-port-pool-create-button');
    expect(createEvent.before?.ui?.component).toBe('pro-table-toolbar');
    expect(createEvent.before?.ui?.table?.tableId).toBe('ip-port-pool');
    expect(createEvent.before?.ui?.recipe?.kind).toBe('protable-toolbar-action');

    const nameEvent = await userFillAndRead(page, '#site-ip-port-pool-name-input', 'pool-e2e');
    expect(nameEvent.before?.ui?.form?.name).toBe('name');
    expect(nameEvent.before?.ui?.form?.fieldKind).toBe('text');
    expect(nameEvent.before?.ui?.form?.testId).toBe('site-ip-port-pool-name-field');
    expect(nameEvent.before?.ui?.recipe?.kind).toBe('fill-form-field');

    const vrfTriggerEvent = await userClickAndRead(page, '#site-ip-port-pool-vrf-select .ant-select-selector');
    expect(vrfTriggerEvent.before?.ui?.component).toBe('select');
    expect(vrfTriggerEvent.before?.ui?.form?.name).toBe('destVrfId');
    expect(vrfTriggerEvent.before?.ui?.form?.fieldKind).toBe('select');

    const vrfOptionEvent = await userClickAndRead(page, '#site-ip-port-pool-vrf-option-default');
    expect(vrfOptionEvent.before?.ui?.component).toBe('select');
    expect(vrfOptionEvent.before?.ui?.option?.text).toBe('默认 VRF');
    expect(vrfOptionEvent.before?.ui?.recipe?.kind).toBe('select-option');

    const okEvent = await userClickAndRead(page, '#site-ip-port-pool-modal-ok-button');
    expect(okEvent.before?.ui?.targetTestId).toBe('site-ip-port-pool-modal-ok-button');
    expect(okEvent.before?.ui?.overlay?.type).toBe('modal');
    expect(okEvent.before?.ui?.form?.formKind).toBe('modal-form');

    const rowEditEvent = await userClickAndRead(page, '#site-ip-port-pool-row-edit-action');
    expect(rowEditEvent.before?.ui?.targetTestId).toBe('site-ip-port-pool-row-edit-action');
    expect(rowEditEvent.before?.ui?.table?.rowKey).toBe('pool-42');
    expect(rowEditEvent.before?.ui?.table?.columnKey).toBe('option');
    expect(rowEditEvent.before?.ui?.recipe?.kind).toBe('table-row-action');
  });

  test('records a realistic WAN transport network configuration flow with real AntD ProComponents', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/antd-wan-transport-real.html`);
    await expect(page.getByTestId('wan-transport-table')).toBeVisible();
    await installSidecarOnCurrentPage(page);

    const addEvent = await userClickAndRead(page, '[data-testid="wan-transport-add-button"]');
    expect(addEvent.before?.ui?.component).toBe('pro-table-toolbar');
    expect(addEvent.before?.ui?.targetTestId).toBe('wan-transport-add-button');
    expect(addEvent.before?.ui?.table?.tableId).toBe('wan-transport');
    expect(addEvent.before?.ui?.recipe?.kind).toBe('protable-toolbar-action');
    await expect(page.getByRole('dialog', { name: '增加传输网络' })).toBeVisible();

    const transportEvent = await userClickAndRead(page, '[data-testid="wan-transport-select"] .ant-select-selector');
    expect(transportEvent.before?.ui?.component).toBe('select');
    expect(transportEvent.before?.ui?.form?.name).toBe('transport');
    expect(transportEvent.before?.ui?.form?.fieldKind).toBe('select');

    const transportOptionEvent = await userClickAndRead(page, '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="Nova 私网"]');
    expect(transportOptionEvent.before?.ui?.recipe?.kind).toBe('select-option');
    expect(transportOptionEvent.before?.ui?.option?.text).toBe('Nova 私网');

    const tagEvent = await userClickAndRead(page, '[data-testid="wan-transport-tags-select"] .ant-select-selector');
    expect(tagEvent.before?.ui?.form?.name).toBe('tags');
    expect(tagEvent.before?.ui?.form?.fieldKind).toBe('multi-select');
    await userClickAndRead(page, '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="controller"]');
    await page.keyboard.press('Escape');
    await expect(page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')).toHaveCount(0);

    const fecEvent = await userClickAndRead(page, '.ant-radio-wrapper:has-text("自动")');
    expect(fecEvent.before?.ui?.component).toBe('radio-group');
    expect(fecEvent.before?.ui?.form?.name).toBe('wanTransportFec.enableEgressFec');
    expect(fecEvent.before?.ui?.recipe?.kind).toBe('toggle-control');

    const thresholdEvent = await userFillAndRead(page, '[data-testid="wan-transport-egress-disable-threshold-input"]', '3');
    expect(thresholdEvent.before?.ui?.form?.name).toBe('wanTransportFec.engressThres.disableThres');
    expect(thresholdEvent.before?.ui?.recipe?.kind).toBe('fill-form-field');

    const okEvent = await userClickAndRead(page, '[data-testid="wan-transport-modal-ok-button"]');
    expect(okEvent.before?.ui?.targetTestId).toBe('wan-transport-modal-ok-button');
    expect(okEvent.before?.ui?.form?.formKind).toBe('modal-form');
    expect(okEvent.before?.ui?.recipe?.kind).toBe('submit-form');
    await expect(page.getByRole('row', { name: /Nova 私网/ })).toBeVisible();

    const deleteEvent = await userClickAndRead(page, 'tr[data-row-key="nova_private"] [data-testid="wan-transport-row-delete-action"]');
    expect(deleteEvent.before?.ui?.targetTestId).toBe('wan-transport-row-delete-action');
    expect(deleteEvent.before?.ui?.table?.rowKey).toBe('nova_private');
    expect(deleteEvent.before?.ui?.recipe?.kind).toBe('table-row-action');

    const confirmEvent = await userClickAndRead(page, '[data-testid="wan-transport-delete-confirm-ok"]');
    expect(confirmEvent.before?.ui?.componentPath).toContain('popconfirm');
    expect(confirmEvent.before?.ui?.recipe?.kind).toBe('confirm-popconfirm');
    await expect(page.getByRole('row', { name: /Nova 私网/ })).toHaveCount(0);
  });

  test('focused semantic stress stays stable across repeated portal overlay table interactions', async ({ page }) => {
    for (let i = 0; i < 3; i++) {
      await installSidecarFixture(page, { semanticAdapterDiagnosticsEnabled: true });
      const selectEvent = await captureAfterSequence(page, ['#role-select .ant-select-selector', '#role-admin']);
      expect(selectEvent.before?.ui?.recipe?.kind).toBe('select-option');
      expect(selectEvent.before?.ui?.option?.text || selectEvent.before?.ui?.recipe?.optionText).toBe('管理员');

      const popconfirmEvent = await captureAfterSequence(page, ['#popconfirm-ok']);
      expect(popconfirmEvent.before?.ui?.componentPath).toContain('popconfirm');
      expect(popconfirmEvent.before?.ui?.recipe?.kind).toBe('confirm-popconfirm');

      const tooltipEvent = await captureAfterSequence(page, ['#tooltip-trigger']);
      expect(tooltipEvent.before?.ui?.component).toBe('tooltip');

      const rowEvent = await captureAfterSequence(page, ['#user-edit']);
      expect(rowEvent.before?.ui?.recipe?.kind).toBe('table-row-action');
      expect(rowEvent.before?.ui?.table?.rowKey || rowEvent.before?.ui?.recipe?.rowKey).toBe('user-42');
    }
  });
});

async function installSidecarFixture(page: Page, options: SidecarFixtureOptions = {}) {
  await page.goto(`data:text/html,<html><body>reset-${Date.now()}-${Math.random()}</body></html>`);
  await page.setContent(semanticFixtureHtml());
  await installSidecarOnCurrentPage(page, options);
}

async function installSidecarOnCurrentPage(page: Page, options: SidecarFixtureOptions = {}) {
  await page.evaluate(sidecarOptions => {
    document.addEventListener('submit', event => event.preventDefault(), true);
    document.addEventListener('click', event => {
      const target = event.target as Element | null;
      if (target?.closest('form button, a[href="#"]'))
        event.preventDefault();
    }, true);
    (window as any).__semanticEvents = [];
    (window as any).__sidecarErrors = [];
    (window as any).__playwrightCrxSemanticAdapterOptions = sidecarOptions;
    window.addEventListener('error', event => {
      (window as any).__sidecarErrors.push({ message: event.message, filename: event.filename, lineno: event.lineno, colno: event.colno, stack: event.error?.stack });
    });
    (window as any).chrome = {
      runtime: {
        sendMessage: async (message: any) => {
          if (message?.event === 'pageContextEvent')
            (window as any).__semanticEvents.push(message.contextEvent);
        },
      },
    };
  }, {
    semanticAdapterEnabled: options.semanticAdapterEnabled !== false,
    semanticAdapterDiagnosticsEnabled: options.semanticAdapterDiagnosticsEnabled === true,
  });
  await page.addScriptTag({ path: sidecarBundlePath() });
}

async function readSemanticDiagnostics(page: Page): Promise<Array<{ event?: string }>> {
  return await page.evaluate(() => (window as any).__playwrightCrxSemanticDiagnostics?.entries?.() ?? []);
}

function sidecarBundlePath() {
  const candidates = [
    path.resolve(process.cwd(), 'examples/recorder-crx/dist/pageContextSidecar.js'),
    path.resolve(process.cwd(), '../examples/recorder-crx/dist/pageContextSidecar.js'),
  ];
  const bundlePath = candidates.find(candidate => fs.existsSync(candidate));
  if (!bundlePath)
    throw new Error(`Cannot find pageContextSidecar bundle. Tried: ${candidates.join(', ')}`);
  return bundlePath;
}

async function captureAfterSequence(page: Page, selectors: string[]) {
  let event: CapturedContextEvent | undefined;
  for (const selector of selectors)
    event = await dispatchClickAndRead(page, selector);
  return event!;
}

async function dispatchClickAndRead(page: Page, selector: string): Promise<CapturedContextEvent> {
  await page.waitForTimeout(180);
  const start = await page.evaluate(() => (window as any).__semanticEvents.length as number);
  await page.locator(selector).scrollIntoViewIfNeeded();
  await page.locator(selector).evaluate((element, currentSelector) => {
    (window as any).__localClickDebug = { selector: currentSelector, count: 0 };
    element.addEventListener('click', () => { (window as any).__localClickDebug.count += 1; }, { once: true });
  }, selector);
  await page.locator(selector).click({ force: true });
  try {
    await expect.poll(async () => page.evaluate(length => (window as any).__semanticEvents.length > length, start), { message: `semantic event for ${selector}`, timeout: 2000 }).toBe(true);
  } catch (error) {
    const debug = await page.locator(selector).evaluate(element => {
      const rect = element.getBoundingClientRect();
      const point = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        targetTag: element.tagName,
        targetClass: element.getAttribute('class'),
        targetText: element.textContent,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        pointTag: point?.tagName,
        pointClass: point?.getAttribute('class'),
        pointText: point?.textContent,
        eventsLength: (window as any).__semanticEvents.length,
        localClickDebug: (window as any).__localClickDebug,
        sidecarInstalled: (window as any).__playwrightCrxBusinessFlowPageContextSidecar,
        sidecarErrors: (window as any).__sidecarErrors,
        lastEvents: ((window as any).__semanticEvents as unknown[]).slice(-3),
      };
    });
    throw new Error(`${(error as Error).message}\nDebug for ${selector}: ${JSON.stringify(debug, null, 2)}`);
  }
  const events = await page.evaluate(() => (window as any).__semanticEvents as CapturedContextEvent[]);
  return events[start];
}

async function userClickAndRead(page: Page, selector: string): Promise<CapturedContextEvent> {
  return await performUserActionAndRead(page, selector, async locator => {
    await locator.hover();
    await locator.click();
  });
}

async function userFillAndRead(page: Page, selector: string, value: string): Promise<CapturedContextEvent> {
  return await performUserActionAndRead(page, selector, async locator => {
    await locator.click();
    await locator.fill(value);
  });
}

async function performUserActionAndRead(page: Page, selector: string, action: (locator: Locator) => Promise<void>): Promise<CapturedContextEvent> {
  const locator = page.locator(selector);
  await locator.scrollIntoViewIfNeeded();
  const expected = await locator.evaluate(element => {
    const nearestTestId = (current: Element | null): string | undefined => {
      for (let node = current; node; node = node.parentElement) {
        const value = node.getAttribute('data-testid') || node.getAttribute('data-test-id') || node.getAttribute('data-e2e');
        if (value)
          return value;
      }
      return undefined;
    };
    const nearestAttr = (current: Element | null, attr: string): string | undefined => {
      for (let node = current; node; node = node.parentElement) {
        const value = node.getAttribute(attr);
        if (value)
          return value;
      }
      return undefined;
    };
    return {
      testId: nearestTestId(element),
      fieldName: nearestAttr(element, 'data-e2e-field-name'),
      action: nearestAttr(element, 'data-e2e-action'),
      text: element.textContent?.trim(),
    };
  });
  const start = await page.evaluate(() => (window as any).__semanticEvents.length as number);
  await action(locator);
  await expect.poll(async () => page.evaluate(length => (window as any).__semanticEvents.length > length, start), { message: `semantic event for ${selector}`, timeout: 2000 }).toBe(true);
  const events = await page.evaluate(startIndex => ((window as any).__semanticEvents as CapturedContextEvent[]).slice(startIndex), start);
  return events.slice().reverse().find(event =>
    (!!expected.testId && (event.before?.target?.testId === expected.testId || event.before?.ui?.targetTestId === expected.testId || event.before?.ui?.form?.testId === expected.testId || event.before?.ui?.table?.testId === expected.testId)) ||
    (!!expected.fieldName && event.before?.ui?.form?.name === expected.fieldName) ||
    (!!expected.action && event.before?.ui?.table?.region === 'row-action') ||
    (!!expected.text && (event.before?.ui?.targetText === expected.text || event.before?.ui?.option?.text === expected.text || event.before?.ui?.recipe?.optionText === expected.text || event.before?.target?.text === expected.text))
  ) ?? events[events.length - 1];
}

function businessPilotFixtureHtml() {
  return `<!doctype html>
<html><head><style>
body { font-family: sans-serif; padding: 20px; }
.ant-pro-table,.ant-modal,.ant-select-dropdown { border:1px solid #ddd; margin:8px; padding:8px; }
.ant-modal,.ant-select-dropdown { display:block; visibility:visible; }
.ant-table-row, tr { height:32px; }
.ant-form-item { margin:8px 0; }
.ant-select-selector { border:1px solid #999; padding:4px; display:inline-block; min-width:160px; }
</style></head><body>
<section class="ant-pro-table" data-testid="site-ip-port-pool-table" data-e2e-component="pro-table" data-e2e-table="ip-port-pool">
  <div class="ant-pro-table-list-toolbar">
    <button id="site-ip-port-pool-create-button" class="ant-btn ant-btn-primary" data-testid="site-ip-port-pool-create-button" data-e2e-component="pro-table-toolbar" data-e2e-action="create">新建 IP 端口池</button>
  </div>
  <table class="ant-table"><thead><tr><th>名称</th><th>操作</th></tr></thead><tbody>
    <tr class="ant-table-row" data-testid="site-ip-port-pool-row" data-row-key="pool-42"><td>pool-a</td><td data-column-key="option"><button id="site-ip-port-pool-row-edit-action" class="ant-btn" data-testid="site-ip-port-pool-row-edit-action" data-e2e-component="pro-table" data-e2e-action="edit">编辑</button></td></tr>
  </tbody></table>
</section>
<div class="ant-modal ant-pro-form modal-form" role="dialog" data-testid="site-ip-port-pool-modal" data-e2e-overlay="modal" data-e2e-component="modal-form">
  <div class="ant-modal-title">IP 端口地址池</div>
  <form class="ant-form ant-pro-form">
    <div class="ant-form-item" data-testid="site-ip-port-pool-name-field" data-e2e-component="pro-form-field" data-e2e-field-name="name" data-e2e-field-kind="text" data-e2e-form-kind="modal-form"><div class="ant-form-item-label"><label for="site-ip-port-pool-name-input">名称</label></div><input id="site-ip-port-pool-name-input" name="name" data-e2e-component="input" data-e2e-field-name="name" data-e2e-field-kind="text" /></div>
    <div class="ant-form-item" data-testid="site-ip-port-pool-address-pool-field" data-e2e-component="pro-form-field" data-e2e-field-name="snatId" data-e2e-field-kind="select" data-e2e-form-kind="modal-form"><div class="ant-form-item-label"><label>地址池</label></div><div id="site-ip-port-pool-address-pool-select" class="ant-select" data-testid="site-ip-port-pool-address-pool-select" data-e2e-component="select"><div class="ant-select-selector" role="combobox"><span>请选择地址池</span></div></div></div>
    <div class="ant-form-item" data-testid="site-ip-port-pool-vrf-field" data-e2e-component="pro-form-field" data-e2e-field-name="destVrfId" data-e2e-field-kind="select" data-e2e-form-kind="modal-form"><div class="ant-form-item-label"><label>目的 VRF</label></div><div id="site-ip-port-pool-vrf-select" class="ant-select" data-testid="site-ip-port-pool-vrf-select" data-e2e-component="select"><div class="ant-select-selector" role="combobox"><span>请选择 VRF</span></div></div></div>
    <button id="site-ip-port-pool-modal-ok-button" type="button" class="ant-btn ant-btn-primary" data-testid="site-ip-port-pool-modal-ok-button" data-e2e-component="modal-form" data-e2e-action="submit">确 定</button>
    <button id="site-ip-port-pool-modal-cancel-button" type="button" class="ant-btn" data-testid="site-ip-port-pool-modal-cancel-button" data-e2e-component="modal-form" data-e2e-action="cancel">取 消</button>
  </form>
</div>
<div class="ant-select-dropdown" data-e2e-overlay="select-dropdown">
  <div id="site-ip-port-pool-vrf-option-default" class="ant-select-item-option" role="option" title="默认 VRF"><div>默认 VRF</div></div>
</div>
</body></html>`;
}

function semanticFixtureHtml() {
  return `<!doctype html>
<html><head><style>
body { font-family: sans-serif; }
.ant-modal,.ant-drawer,.ant-dropdown,.ant-popover,.ant-tooltip,.ant-select-dropdown,.ant-cascader-dropdown { display:block; visibility:visible; width:320px; min-height:24px; border:1px solid #ddd; margin:4px; }
.ant-popover-hidden,.ant-select-dropdown-hidden { display:none; }
.ant-table-row, tr { height:32px; }
</style></head><body>
<section class="ant-pro-page-container" data-testid="tenant-page"><h1>租户中心</h1><button id="page-action">刷新页面</button></section>
<span id="plain-status">普通状态文本</span>
<form class="ant-form" name="basicForm"><div class="ant-form-item ant-form-item-required"><div class="ant-form-item-label"><label for="username-input">用户名</label></div><div class="ant-form-item-control"><input id="username-input" name="username" placeholder="请输入用户名" /></div></div><button id="form-submit" class="ant-btn ant-btn-primary">提交</button><button id="form-reset" class="ant-btn">重置</button></form>
<div class="ant-form-item"><div class="ant-form-item-label"><label>角色</label></div><div id="role-select" class="ant-select"><div class="ant-select-selector" role="combobox" aria-label="角色"><span>请选择角色</span></div></div></div>
<div class="ant-select-dropdown"><div id="role-admin" class="ant-select-item-option" role="option" title="管理员"><div>管理员</div></div></div>
<div class="ant-form-item"><div class="ant-form-item-label"><label>发布范围</label></div><div id="scope-tree-select" class="ant-tree-select ant-select"><div class="ant-select-selector" role="combobox" aria-label="发布范围"><span>请选择范围</span></div></div></div>
<div class="ant-select-dropdown"><div id="scope-east" class="ant-select-tree-treenode" role="treeitem" title="华东生产区"><span class="ant-select-tree-node-content-wrapper">华东生产区</span></div></div>
<div class="ant-form-item"><div class="ant-form-item-label"><label>出口路径</label></div><div id="egress-cascader" class="ant-cascader"><div class="ant-cascader-picker" role="combobox"><span>请选择路径</span></div></div></div>
<div class="ant-cascader-dropdown"><ul class="ant-cascader-menu"><li class="ant-cascader-menu-item ant-cascader-menu-item-active">华东</li></ul><ul class="ant-cascader-menu"><li id="egress-nat" class="ant-cascader-menu-item" title="NAT集群A">NAT集群A</li></ul></div>
<div class="ant-form-item"><div class="ant-form-item-label"><label>开始日期</label></div><div id="start-date" class="ant-picker"><input placeholder="请选择开始日期" /></div></div>
<div class="ant-form-item"><div class="ant-form-item-label"><label>有效期</label></div><div id="range-picker" class="ant-picker ant-picker-range"><input placeholder="开始日期" /><input placeholder="结束日期" /></div></div>
<div class="ant-form-item"><div class="ant-form-item-label"><label>附件</label></div><span id="upload-button" class="ant-upload ant-upload-select"><button class="ant-btn">上传附件</button></span></div>
<div class="ant-form-item"><div class="ant-form-item-label"><label>启用健康检查</label></div><button id="enable-switch" class="ant-switch" role="switch"><span>开</span></button></div>
<div class="ant-form-item"><div class="ant-form-item-label"><label>同意协议</label></div><label id="agreement-checkbox" class="ant-checkbox-wrapper"><span class="ant-checkbox"><input class="ant-checkbox-input" type="checkbox" /></span><span>同意协议</span></label></div>
<div class="ant-form-item"><div class="ant-form-item-label"><label>运行模式</label></div><label id="mode-advanced-radio" class="ant-radio-wrapper"><span class="ant-radio"><input type="radio" /></span><span>高级模式</span></label></div>
<div class="ant-table-wrapper" data-testid="users-table"><h2>用户列表</h2><table class="ant-table"><thead><tr><th>名称</th><th>操作</th></tr></thead><tbody><tr class="ant-table-row" data-row-key="user-42"><td>Alice</td><td><button id="user-edit" class="ant-btn">编辑</button></td></tr></tbody></table><ul class="ant-pagination"><li id="page-2" class="ant-pagination-item"><a>2</a></li></ul></div>
<div class="ant-modal" role="dialog"><div class="ant-modal-title">新建用户</div><button id="modal-ok" class="ant-btn ant-btn-primary">确 定</button></div>
<div class="ant-drawer" role="dialog"><div class="ant-drawer-title">编辑策略</div><button id="drawer-save" class="ant-btn ant-btn-primary">保存</button></div>
<div class="ant-dropdown"><ul class="ant-dropdown-menu"><li id="more-menu-delete" class="ant-dropdown-menu-item" role="menuitem">删除</li></ul></div>
<button id="popover-trigger" class="ant-btn">打开高级提示</button><div class="ant-popover"><div class="ant-popover-title">高级提示</div><div class="ant-popover-inner-content">这里是高级提示</div></div>
<div class="ant-popover"><div class="ant-popover-title">确认删除?</div><div class="ant-popover-inner-content"><button id="popconfirm-ok" class="ant-btn ant-btn-primary">确 定</button></div></div>
<button id="tooltip-trigger" aria-describedby="tooltip-a">禁用按钮</button><div id="tooltip-a" class="ant-tooltip"><div class="ant-tooltip-inner">禁用状态说明</div></div>
<div class="ant-tabs"><div id="tab-security" class="ant-tabs-tab" role="tab" aria-selected="true">安全设置</div></div>
<section class="ant-pro-card" data-testid="summary-card"><div class="ant-pro-card-title">概览卡片</div><button id="card-action" class="ant-btn">查看详情</button></section>
<section class="ant-pro-table" data-testid="pro-users-table"><div class="ant-pro-table-list-toolbar-title">用户管理</div><form class="ant-form ant-pro-form ant-pro-table-search"><div class="ant-form-item"><div class="ant-form-item-label"><label>关键字</label></div><input name="keyword" /></div><button id="protable-search-button" class="ant-btn ant-btn-primary">查询</button></form><div class="ant-pro-table-list-toolbar"><button id="protable-create" class="ant-btn ant-btn-primary">新建</button></div><table class="ant-table"><tbody><tr class="ant-table-row" data-row-key="pro-user-1"><td>Bob</td><td><button>编辑</button></td></tr></tbody></table></section>
<form class="ant-pro-form" name="proForm"><div class="ant-form-item"><div class="ant-form-item-label"><label for="proform-owner">负责人</label></div><input id="proform-owner" name="owner" /></div></form>
<section class="ant-pro-table editable-pro-table" data-testid="editable-rules"><div class="ant-pro-table-list-toolbar-title">编辑规则</div><table class="ant-table"><thead><tr><th>规则名称</th><th>值</th></tr></thead><tbody><tr data-row-key="rule-1"><td><input id="editable-cell" value="规则A" /></td><td>1</td></tr></tbody></table></section>
<div class="ant-modal ant-pro-form modal-form" role="dialog"><div class="ant-modal-title">新建租户</div><form class="ant-form"><button id="modal-form-submit" class="ant-btn ant-btn-primary">提交</button></form></div>
<div class="ant-drawer ant-pro-form drawer-form" role="dialog"><div class="ant-drawer-title">编辑租户</div><form class="ant-form"><button id="drawer-form-submit" class="ant-btn ant-btn-primary">提交</button></form></div>
<form class="ant-pro-form steps-form"><div class="ant-steps"><div class="ant-steps-item-active">基础信息</div></div><button id="steps-next" class="ant-btn ant-btn-primary">下一步</button></form>
<form class="ant-pro-form beta-schema-form"><div class="ant-form-item"><div class="ant-form-item-label"><label for="schema-field">Schema 字段</label></div><input id="schema-field" name="schemaField" /></div></form>
<section class="ant-pro-descriptions"><h2>租户详情</h2><div id="desc-status" class="ant-descriptions-item"><span class="ant-descriptions-item-label">状态</span><span class="ant-descriptions-item-content">启用</span></div></section>
<section class="ant-pro-list"><h2>工单列表</h2><div class="ant-list-item" data-row-key="list-1"><span>工单 A</span><button id="list-action" class="ant-btn">处理</button></div></section>
<section class="ant-pro-table" data-testid="business-ip-port-pool-table" data-e2e-component="pro-table" data-e2e-table="ip-port-pool"><div class="ant-pro-table-list-toolbar"><button id="business-create" class="ant-btn ant-btn-primary" data-testid="site-ip-port-pool-create-button" data-e2e-component="pro-table-toolbar" data-e2e-action="create">新建地址池</button></div><table class="ant-table"><thead><tr><th>名称</th><th>操作</th></tr></thead><tbody><tr class="ant-table-row" data-testid="site-ip-port-pool-row" data-row-key="pool-42"><td>pool-a</td><td data-column-key="option"><button id="business-row-edit" class="ant-btn" data-e2e-component="pro-table" data-e2e-action="edit">编辑</button></td></tr></tbody></table></section>
<div class="ant-form-item" data-testid="site-ip-port-pool-vrf-field" data-e2e-component="pro-form-field" data-e2e-field-name="destVrfId" data-e2e-field-kind="select" data-e2e-form-kind="modal-form"><div class="ant-form-item-label"><label>目的 VRF</label></div><div id="business-vrf-select" class="ant-select" data-testid="site-ip-port-pool-vrf-select" data-e2e-component="select"><div class="ant-select-selector" role="combobox" aria-label="目的 VRF"><span>请选择 VRF</span></div></div></div>
<div id="business-unknown-hint" data-testid="custom-widget-root" data-e2e-component="company-owned-widget"><span>自定义业务控件</span></div>
<div class="ant-form-item" data-testid="site-unmapped-select-field" data-e2e-field-name="unmappedSelect" data-e2e-field-kind="select"><div class="ant-form-item-label"><label>未映射选择器</label></div><div id="business-unmapped-select" class="ant-select" data-testid="site-unmapped-select" data-e2e-component="company-select"><div class="ant-select-selector" role="combobox"><span>请选择</span></div></div></div>
<button id="business-non-table-create" data-testid="business-non-table-create" data-e2e-role="page-action" data-e2e-action="create">全局创建</button>
<section class="ant-pro-table" data-test-id="business-alt-table" data-e2e-component="pro-table"><table class="ant-table"><tbody><tr class="ant-table-row" data-row-key="alt-1"><td>Alt</td><td data-column-key="option"><button id="business-alt-table-edit" class="ant-btn" data-e2e-component="pro-table" data-e2e-action="edit">编辑</button></td></tr></tbody></table></section>
</body></html>`;
}
