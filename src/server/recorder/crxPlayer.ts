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

import EventEmitter from 'events';
import type { BrowserContext } from 'playwright-core/lib/server/browserContext';
import { Page } from 'playwright-core/lib/server/page';
import { createGuid, isUnderTest, ManualPromise, monotonicTime, serializeExpectedTextValues } from 'playwright-core/lib/utils';
import type { Frame } from 'playwright-core/lib/server/frames';
import type { CallMetadata } from '@protocol/callMetadata';
import { serializeError } from 'playwright-core/lib/server/errors';
import { buildFullSelector } from 'playwright-core/lib/server/recorder/recorderUtils';
import { toKeyboardModifiers } from 'playwright-core/lib/server/codegen/language';
import type { ActionInContextWithLocation, Location } from './parser';
import type { ActionInContext, FrameDescription } from '@recorder/actions';
import { toClickOptions } from 'playwright-core/lib/server/recorder/recorderRunner';
import { parseAriaSnapshotUnsafe } from 'playwright-core/lib/utils/isomorphic/ariaSnapshot';
import { serverSideCallMetadata } from 'playwright-core/lib/server';
import type { Crx } from '../crx';
import type { InstrumentationListener } from 'playwright-core/lib/server/instrumentation';
import { traceParamsForAction } from './recorderUtils';
import { yaml } from 'playwright-core/lib/utilsBundle';

class Stopped extends Error {}

export type PerformAction = ActionInContextWithLocation | {
  action: {
    name: 'pause';
  };
  frame: FrameDescription;
  location?: Location;
};

export default class CrxPlayer extends EventEmitter {

  private _crx: Crx;
  private _currAction?: PerformAction;
  private _stopping?: ManualPromise;
  private _pageAliases = new Map<Page, string>();
  private _pause?: Promise<void>;
  private _running = false;

  constructor(crx: Crx) {
    super();
    this._crx = crx;
  }

  async pause() {
    if (!this._pause) {
      const context = (await this._crx.get({ incognito: false }))!._context;
      const pauseAction = {
        action: { name: 'pause' },
        frame: { pageAlias: 'page', framePath: [] },
      } satisfies PerformAction;
      this._pause = this
          ._performAction(context, pauseAction)
          .finally(() => this._pause = undefined)
          .catch(() => {});
    }
    await this._pause;
  }

  async run(pageOrContext: Page | BrowserContext, actions: PerformAction[]) {
    if (this.isPlaying())
      return;

    let page: Page;
    let context: BrowserContext;

    if (pageOrContext instanceof Page) {
      page = pageOrContext;
      context = page.browserContext;
    } else {
      context = pageOrContext;
      page = context.pages()[0] ?? await context.newPage(serverSideCallMetadata());
    }

    const crxApp = await this._crx.get({ incognito: false });
    const recorder = crxApp?._recorder();
    let instrumentationListener: InstrumentationListener | undefined;

    if (recorder && crxApp && crxApp._context !== context) {
      // we intercept incognito call logs and forward them into the recorder
      const instrumentationListener: InstrumentationListener = {
        onBeforeCall: recorder.onBeforeCall.bind(recorder),
        onBeforeInputAction: recorder.onBeforeInputAction.bind(recorder),
        onCallLog: recorder.onCallLog.bind(recorder),
        onAfterCall: recorder.onAfterCall.bind(recorder),
      };
      if (instrumentationListener)
        context.instrumentation.addListener(instrumentationListener, context);
    }

    this._pageAliases.clear();
    this._pageAliases.set(page, 'page');
    this._running = true;
    this.emit('start');

    try {
      for (const [index, action] of actions.entries()) {
        if (action.action.name === 'openPage' && action.frame.pageAlias === 'page')
          continue;
        this._currAction = action;
        this.emit('action-start', action, index, actions.length);
        try {
          await this._performAction(context, action);
          this.emit('action-end', action, index, actions.length);
        } catch (error) {
          this.emit('action-error', action, index, actions.length, error);
          throw error;
        }
      }
    } catch (e) {
      if (e instanceof Stopped)
        return;
      throw e;
    } finally {
      this._currAction = undefined;
      this.pause().catch(() => {});
      if (instrumentationListener)
        context.instrumentation.removeListener(instrumentationListener);
      this._running = false;
      this.emit('stop');
    }
  }

  isPlaying() {
    return this._running || !!this._currAction;
  }

  async stop() {
    if (this._currAction || this._pause) {
      this._currAction = undefined;
      this._stopping = new ManualPromise();
      await Promise.all([
        this._stopping,
        this._pause,
      ]);
      this._stopping = undefined;
      this._pause = undefined;
      this.emit('stop');
    }
  }

  // "borrowed" from ContextRecorder
  private async _performAction(browserContext: BrowserContext, actionInContext: PerformAction) {
    this._checkStopped();

    const innerPerformAction = async (mainFrame: Frame | null, actionInContext: PerformAction, cb: (callMetadata: CallMetadata) => Promise<any>): Promise<void> => {
      // we must use the default browser context here!
      const context = mainFrame ?? browserContext;

      const traceParams = actionInContext.action.name === 'pause' ?
        { method: 'pause', params: {}, apiName: 'page.pause' } :
        traceParamsForAction(actionInContext as ActionInContext);

      const callMetadata: CallMetadata = {
        id: `call@${createGuid()}`,
        internal: actionInContext.action.name === 'pause',
        objectId: context.guid,
        pageId: mainFrame?._page.guid,
        frameId: mainFrame?.guid,
        startTime: monotonicTime(),
        endTime: 0,
        type: 'Frame',
        log: [],
        location: actionInContext.location,
        playing: true,
        ...traceParams,
      };

      try {
        this._checkStopped();
        await context.instrumentation.onBeforeCall(context, callMetadata);
        this._checkStopped();
        await cb(callMetadata);
      } catch (e) {
        callMetadata.error = serializeError(e);
      } finally {
        callMetadata.endTime = monotonicTime();
        await context.instrumentation.onAfterCall(context, callMetadata);
        if (callMetadata.error)
          throw callMetadata.error.error;
      }
    };

    // similar to playwright/packages/playwright-core/src/server/recorder/recorderRunner.ts
    const kActionTimeout = isUnderTest() ? 2000 : 5000;

    const { action } = actionInContext;
    const pageAliases = this._pageAliases;
    const context = browserContext;

    if (action.name === 'pause')
      return await innerPerformAction(null, actionInContext, () => Promise.resolve());

    if (action.name === 'openPage') {
      return await innerPerformAction(null, actionInContext, async callMetadata => {
        const pageAlias = actionInContext.frame.pageAlias;
        if ([...pageAliases.values()].includes(pageAlias))
          throw new Error(`Page with alias ${pageAlias} already exists`);
        const newPage = await context.newPage(callMetadata);
        if (action.url && action.url !== 'about:blank' && action.url !== 'chrome://newtab/') {
          const navigateCallMetadata = {
            ...callMetadata,
            ...traceParamsForAction({ ...actionInContext, action: { name: 'navigate', url: action.url } } as ActionInContext),
          };
          await newPage.mainFrame().goto(navigateCallMetadata, action.url, { timeout: kActionTimeout });
        }
        pageAliases.set(newPage, pageAlias);
      });
    }

    const pageAlias = actionInContext.frame.pageAlias;
    const page = [...pageAliases.entries()].find(([, alias]) => pageAlias === alias)?.[0];
    if (!page)
      throw new Error('Internal error: page not found');
    const mainFrame = page.mainFrame();

    if (action.name === 'navigate')
      return await innerPerformAction(mainFrame, actionInContext, callMetadata => mainFrame.goto(callMetadata, action.url, { timeout: kActionTimeout }));

    if (action.name === 'closePage') {
      return await innerPerformAction(mainFrame, actionInContext, async callMetadata => {
        pageAliases.delete(page);
        await page.close(callMetadata, { runBeforeUnload: true });
      });
    }

    if (action.name === 'waitForTimeout')
      return await innerPerformAction(mainFrame, actionInContext, callMetadata => mainFrame.waitForTimeout(callMetadata, action.timeout));

    const selector = buildFullSelector(actionInContext.frame.framePath, action.selector);

    if (action.name === 'click') {
      const options = toClickOptions(action);
      const activeAntdOptionClick = activeAntdOptionClickTarget(selector);
      if (activeAntdOptionClick) {
        return await innerPerformAction(mainFrame, actionInContext, async callMetadata => {
          if (await dispatchActiveAntdOptionClick(mainFrame, activeAntdOptionClick, kActionTimeout))
            return;
          await mainFrame.click(callMetadata, selector, { ...options, timeout: kActionTimeout, strict: true });
        });
      }
      return await innerPerformAction(mainFrame, actionInContext, callMetadata => mainFrame.click(callMetadata, selector, { ...options, timeout: kActionTimeout, strict: true }));
    }
    if (action.name === 'press') {
      const modifiers = toKeyboardModifiers(action.modifiers);
      const shortcut = [...modifiers, action.key].join('+');
      return await innerPerformAction(mainFrame, actionInContext, callMetadata => mainFrame.press(callMetadata, selector, shortcut, { timeout: kActionTimeout, strict: true }));
    }
    if (action.name === 'fill')
      return await innerPerformAction(mainFrame, actionInContext, callMetadata => mainFrame.fill(callMetadata, selector, action.text, { timeout: kActionTimeout, strict: true }));
    if (action.name === 'setInputFiles')
      return await innerPerformAction(mainFrame, actionInContext, () => Promise.reject(new Error(`player does not support setInputFiles yet`)));
    if (action.name === 'check')
      return await innerPerformAction(mainFrame, actionInContext, callMetadata => mainFrame.check(callMetadata, selector, { timeout: kActionTimeout, strict: true }));
    if (action.name === 'uncheck')
      return await innerPerformAction(mainFrame, actionInContext, callMetadata => mainFrame.uncheck(callMetadata, selector, { timeout: kActionTimeout, strict: true }));
    if (action.name === 'select') {
      const values = action.options.map((value: any) => ({ value }));
      return await innerPerformAction(mainFrame, actionInContext, callMetadata => mainFrame.selectOption(callMetadata, selector, [], values, { timeout: kActionTimeout, strict: true }));
    }
    if (action.name === 'assertChecked') {
      return await innerPerformAction(mainFrame, actionInContext, callMetadata => mainFrame.expect(callMetadata, selector, {
        selector,
        expression: 'to.be.checked',
        expectedValue: { checked: true },
        isNot: !action.checked,
        timeout: kActionTimeout,
      }));
    }
    if (action.name === 'assertText') {
      return await innerPerformAction(mainFrame, actionInContext, callMetadata => mainFrame.expect(callMetadata, selector, {
        selector,
        expression: 'to.have.text',
        expectedText: serializeExpectedTextValues([action.text], { matchSubstring: true, normalizeWhiteSpace: true }),
        isNot: false,
        timeout: kActionTimeout,
      }));
    }
    if (action.name === 'assertValue') {
      return await innerPerformAction(mainFrame, actionInContext, callMetadata => mainFrame.expect(callMetadata, selector, {
        selector,
        expression: 'to.have.value',
        expectedText: serializeExpectedTextValues([action.value], { matchSubstring: false, normalizeWhiteSpace: true }),
        isNot: false,
        timeout: kActionTimeout,
      }));
    }
    if (action.name === 'assertVisible') {
      return await innerPerformAction(mainFrame, actionInContext, callMetadata => mainFrame.expect(callMetadata, selector, {
        selector,
        expression: 'to.be.visible',
        isNot: false,
        timeout: kActionTimeout,
      }));
    }
    if (action.name === 'assertSnapshot') {
      return await innerPerformAction(mainFrame, actionInContext, callMetadata => mainFrame.expect(callMetadata, selector, {
        selector,
        expression: 'to.match.aria',
        expectedValue: parseAriaSnapshotUnsafe(yaml, action.snapshot),
        isNot: false,
        timeout: kActionTimeout,
      }));
    }
    throw new Error('Internal error: unexpected action ' + (action as any).name);
  }

  private _checkStopped() {
    if (this._stopping) {
      this._stopping.resolve();
      throw new Stopped();
    }
  }
}

function activeAntdOptionClickTarget(selector: string) {
  const optionKind = activeAntdOptionKind(selector);
  if (!optionKind)
    return undefined;
  const tokens = activeAntdOptionTextTokens(selector);
  if (!tokens.length && !/internal:has-text=(?:\\"|")?\[object/i.test(selector))
    return undefined;
  return { optionKind, tokens };
}

function activeAntdOptionKind(selector: string) {
  if (/ant-cascader-menu-item/.test(selector))
    return 'cascader';
  if (/ant-select-tree/.test(selector))
    return 'tree';
  if (/ant-select-item-option/.test(selector))
    return 'select';
  return undefined;
}

function activeAntdOptionTextTokens(selector: string) {
  return [...selector.matchAll(/internal:has-text=(?:\\"|")([^"\\]+)(?:\\"|")/g)]
      .map(match => match[1])
      .filter(token => token && token !== '[object Object]');
}

async function dispatchActiveAntdOptionClick(mainFrame: Frame, target: { optionKind: string, tokens: string[] }, timeout: number) {
  const clicked = await mainFrame.evaluateExpression(String(async ({ optionKind, tokens, timeout }) => {
    const normalize = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim();
    const tokenGroups = tokens.map(token => {
      const normalized = normalize(token);
      const pieces = normalized.split(/[:：\s]+/).map(normalize).filter(Boolean);
      return [normalized, ...pieces].filter(Boolean);
    }).filter(group => group.length);
    const selector = optionKind === 'cascader' ?
      '.ant-cascader-menu-item:not(.ant-cascader-menu-item-disabled)' :
      optionKind === 'tree' ?
        '.ant-select-tree-node-content-wrapper:not(.ant-select-tree-node-disabled), .ant-select-tree-title' :
        '.ant-select-item-option:not(.ant-select-item-option-disabled)';
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const textFor = (element: Element) => normalize([
      element.getAttribute('title'),
      element.querySelector('.ant-select-item-option-content')?.textContent,
      element.textContent,
    ].filter(Boolean).join(' '));
    const matches = (element: Element) => {
      const text = textFor(element);
      return !tokenGroups.length || tokenGroups.every(group => text.includes(group[0]) || group.slice(1).every(token => text.includes(token)));
    };
    const findOption = () => [...document.querySelectorAll(selector)].find(element => isVisible(element) && matches(element));
    const dispatchClick = (element: Element) => {
      element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    };
    const openTriggersAndFindOption = async () => {
      const preferred = [...document.querySelectorAll('.ant-select-focused .ant-select-selector, .ant-select-open .ant-select-selector')].filter(isVisible);
      const all = [...document.querySelectorAll('.ant-select-selector')].filter(isVisible);
      const triggers = [...preferred, ...all].filter((trigger, index, list) => list.indexOf(trigger) === index);
      for (const trigger of triggers) {
        dispatchClick(trigger);
        await new Promise(resolve => setTimeout(resolve, 100));
        const option = findOption();
        if (option)
          return option;
      }
      return undefined;
    };
    const deadline = Date.now() + timeout;
    let retriedByOpeningTrigger = false;
    while (Date.now() <= deadline) {
      const option = findOption();
      if (option) {
        dispatchClick(option);
        return true;
      }
      if (!retriedByOpeningTrigger && (optionKind === 'select' || optionKind === 'tree')) {
        retriedByOpeningTrigger = true;
        const openedOption = await openTriggersAndFindOption();
        if (openedOption) {
          dispatchClick(openedOption);
          return true;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return false;
  }), { isFunction: true }, { ...target, timeout });
  return clicked;
}
