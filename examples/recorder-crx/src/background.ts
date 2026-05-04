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

import type { Mode } from '@recorder/recorderTypes';
import type { CrxApplication } from 'playwright-crx';
import playwright, { crx, _debug, _setUnderTest, _isUnderTest as isUnderTest } from 'playwright-crx';
import type { CrxSettings } from './settings';
import { addSettingsChangedListener, defaultSettings, loadSettings } from './settings';
import type { PageContextEvent } from './flow/pageContextTypes';

type CrxMode = Mode | 'detached';

const stoppedModes: CrxMode[] = ['none', 'standby', 'detached'];
const recordingModes: CrxMode[] = ['recording', 'assertingText', 'assertingVisibility', 'assertingValue', 'assertingSnapshot'];

// we must lazy initialize it
let crxAppPromise: Promise<CrxApplication> | undefined;

const attachedTabIds = new Set<number>();
let currentPageContextTabId: number | undefined;
let currentMode: CrxMode | 'detached' | undefined;
let settings: CrxSettings = defaultSettings;
const maxContextEventsPerTab = 200;
const maxContextEventAgeMs = 5 * 60 * 1000;
const contextEventsByTabId = new Map<number, PageContextEvent[]>();

// if it's in sidepanel mode, we need to open it synchronously on action click,
// so we need to fetch its value asap
const settingsInitializing = loadSettings().then(s => settings = s).catch(() => {});

addSettingsChangedListener(newSettings => {
  settings = newSettings;
  setTestIdAttributeName(newSettings.testIdAttributeName);
});

let allowsIncognitoAccess = false;
chrome.extension.isAllowedIncognitoAccess().then(allowed => {
  allowsIncognitoAccess = allowed;
});

async function changeAction(tabId: number, mode?: CrxMode | 'detached') {
  if (!mode)
    mode = attachedTabIds.has(tabId) ? currentMode : 'detached';
  else if (mode !== 'detached')
    currentMode = mode;


  // detached basically implies recorder windows was closed
  if (!mode || stoppedModes.includes(mode)) {
    await Promise.all([
      chrome.action.setTitle({ title: mode === 'none' ? 'Stopped' : 'Record', tabId }),
      chrome.action.setBadgeText({ text: '', tabId }),
    ]).catch(() => {});
    return;
  }

  const { text, title, color, bgColor } = recordingModes.includes(mode) ?
    { text: 'REC', title: 'Recording', color: 'white', bgColor: 'darkred' } :
    { text: 'INS', title: 'Inspecting', color: 'white', bgColor: 'dodgerblue' };

  await Promise.all([
    chrome.action.setTitle({ title, tabId }),
    chrome.action.setBadgeText({ text, tabId }),
    chrome.action.setBadgeTextColor({ color, tabId }),
    chrome.action.setBadgeBackgroundColor({ color: bgColor, tabId }),
  ]).catch(() => {});
}

// action state per tab is reset every time a navigation occurs
// https://bugs.chromium.org/p/chromium/issues/detail?id=1450904
chrome.tabs.onUpdated.addListener(tabId => changeAction(tabId));
chrome.tabs.onRemoved.addListener(tabId => {
  contextEventsByTabId.delete(tabId);
  if (currentPageContextTabId === tabId)
    currentPageContextTabId = Array.from(attachedTabIds).filter(attachedTabId => attachedTabId !== tabId).pop();
});

async function getCrxApp(incognito: boolean) {
  if (!crxAppPromise) {
    await settingsInitializing;

    crxAppPromise = crx.start({ incognito }).then(crxApp => {
      crxApp.recorder.addListener('hide', async () => {
        await crxApp.close();
        crxAppPromise = undefined;
      });
      crxApp.recorder.addListener('modechanged', async ({ mode }) => {
        await Promise.all([...attachedTabIds].map(tabId => changeAction(tabId, mode)));
      });
      crxApp.addListener('attached', async ({ tabId }) => {
        attachedTabIds.add(tabId);
        currentPageContextTabId = tabId;
        await changeAction(tabId, crxApp.recorder.mode());
      });
      crxApp.addListener('detached', async tabId => {
        attachedTabIds.delete(tabId);
        contextEventsByTabId.delete(tabId);
        if (currentPageContextTabId === tabId)
          currentPageContextTabId = Array.from(attachedTabIds).pop();
        await changeAction(tabId, 'detached');
      });
      setTestIdAttributeName(settings.testIdAttributeName);
      return crxApp;
    });
  }
  return await crxAppPromise;
}

async function attach(tab: chrome.tabs.Tab, mode?: Mode) {
  if (!tab?.id || (attachedTabIds.has(tab.id) && !mode))
    return;

  // if the tab is incognito, chek if can be started in incognito mode.
  if (tab.incognito && !allowsIncognitoAccess)
    throw new Error('Not authorized to launch in Incognito mode.');

  const sidepanel = !isUnderTest() && settings.sidepanel;

  // we need to open sidepanel before any async call
  if (sidepanel)
    await chrome.sidePanel.open({ windowId: tab.windowId });

  // ensure one attachment at a time
  chrome.action.disable();
  if (tab.url?.startsWith('chrome://')) {
    const windowId = tab.windowId;
    tab = await new Promise(resolve => {
      // we will not be able to attach to this tab, so we need to open a new one
      chrome.tabs.create({ windowId, url: 'about:blank' }).
          then(tab => {
            resolve(tab);
          }).
          catch(() => {});
    });
  }

  await ensurePageContextSidecar(tab.id!).catch(() => {});

  const crxApp = await getCrxApp(tab.incognito);
  const initialMode = mode ?? (!isUnderTest() && settings.businessFlowEnabled !== false ? 'standby' : 'recording');

  try {

    if (crxApp.recorder.isHidden()) {
      await crxApp.recorder.show({
        mode: initialMode,
        language: settings.targetLanguage,
        window: { type: sidepanel ? 'sidepanel' : 'popup', url: 'index.html' },
        playInIncognito: settings.playInIncognito,
      });
    }

    await crxApp.attach(tab.id!);

    if (mode)
      await crxApp.recorder.setMode(mode);
  } finally {
    chrome.action.enable();
  }
}

async function ensurePageContextSidecar(tabId: number) {
  if (!chrome.scripting?.executeScript)
    return;
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['pageContextSidecar.js'],
  });
}

async function setTestIdAttributeName(testIdAttributeName: string) {
  playwright.selectors.setTestIdAttribute(testIdAttributeName);
}

chrome.action.onClicked.addListener(attach);

chrome.contextMenus.create({
  id: 'pw-recorder',
  title: 'Attach to Playwright Recorder',
  contexts: ['all'],
});

chrome.contextMenus.onClicked.addListener(async (_, tab) => {
  if (tab)
    await attach(tab);
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!tab.id)
    return;
  if (command === 'inspect')
    await attach(tab, 'inspecting');
  else if (command === 'record')
    await attach(tab, 'recording');
});

async function getStorageState() {
  const crxApp = await crxAppPromise;
  if (!crxApp)
    return;

  return await crxApp.context().storageState();
}

function addPageContextEvent(tabId: number, event: PageContextEvent) {
  const events = contextEventsByTabId.get(tabId) ?? [];
  const eventWithTab = {
    ...event,
    tabId,
  };
  const existingIndex = events.findIndex(existing => existing.id === event.id);
  if (existingIndex >= 0)
    events[existingIndex] = eventWithTab;
  else
    events.push(eventWithTab);
  contextEventsByTabId.set(tabId, prunePageContextEvents(events));
}

function getRecentPageContextEvents(tabId: number) {
  const events = prunePageContextEvents(contextEventsByTabId.get(tabId) ?? []);
  contextEventsByTabId.set(tabId, events);
  return events;
}

function prunePageContextEvents(events: PageContextEvent[]) {
  const minWallTime = Date.now() - maxContextEventAgeMs;
  return events
      .filter(event => (event.wallTime ?? Date.now()) >= minWallTime)
      .slice(-maxContextEventsPerTab);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.event === 'pageContextEvent') {
    const tabId = sender.tab?.id;
    if (typeof tabId === 'number' && message.contextEvent)
      addPageContextEvent(tabId, message.contextEvent);
    return false;
  }

  if (message.event === 'pageContextEventsRequested') {
    const requestedTabId = typeof message.tabId === 'number' ? message.tabId : currentPageContextTabId;
    Promise.resolve(typeof requestedTabId === 'number' ? getRecentPageContextEvents(requestedTabId) : [])
        .then(events => sendResponse(events))
        .catch(() => sendResponse([]));
    return true;
  }

  if (message.event === 'storageStateRequested') {
    getStorageState().then(sendResponse).catch(() => {});
    return true;
  }
});

chrome.runtime.onInstalled.addListener(details => {
  if ((globalThis as any).__crxTest)
    return;
  if ([chrome.runtime.OnInstalledReason.INSTALL, chrome.runtime.OnInstalledReason.UPDATE].includes(details.reason))
    chrome.tabs.create({ url: `https://github.com/ruifigueira/playwright-crx/releases/tag/v${chrome.runtime.getManifest().version}` }).catch(() => {});
});

// for testing
Object.assign(self, { attach, setTestIdAttributeName, getCrxApp, _debug, _setUnderTest });
