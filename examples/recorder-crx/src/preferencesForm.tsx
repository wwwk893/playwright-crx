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
import React from 'react';
import type { CrxSettings } from './settings';
import { defaultSettings, loadSettings, storeSettings } from './settings';

export const PreferencesForm: React.FC = ({}) => {
  const [initialSettings, setInitialSettings] = React.useState<CrxSettings>(defaultSettings);
  const [settings, setSettings] = React.useState<CrxSettings>(defaultSettings);
  const [isAllowedIncognitoAccess, setIsAllowedIncognitoAccess] = React.useState<boolean>(false);

  React.useEffect(() => {
    loadSettings()
        .then(settings => {
          setInitialSettings(settings);
          setSettings(settings);
        });
    chrome.extension.isAllowedIncognitoAccess().then(setIsAllowedIncognitoAccess);
  }, []);

  const canSave = React.useMemo(() => {
    return initialSettings.sidepanel !== settings.sidepanel ||
      initialSettings.targetLanguage !== settings.targetLanguage ||
      initialSettings.testIdAttributeName !== settings.testIdAttributeName ||
      initialSettings.playInIncognito !== settings.playInIncognito ||
      initialSettings.experimental !== settings.experimental ||
      initialSettings.businessFlowEnabled !== settings.businessFlowEnabled ||
      initialSettings.semanticAdapterEnabled !== settings.semanticAdapterEnabled ||
      initialSettings.semanticAdapterDiagnosticsEnabled !== settings.semanticAdapterDiagnosticsEnabled ||
      initialSettings.defaultApp !== settings.defaultApp ||
      initialSettings.defaultRepo !== settings.defaultRepo ||
      initialSettings.defaultRole !== settings.defaultRole ||
      initialSettings.redactSensitiveData !== settings.redactSensitiveData;
  }, [settings, initialSettings]);

  const saveSettings = React.useCallback((e: React.FormEvent<HTMLFormElement>) => {
    if (!e.currentTarget.reportValidity())
      return;

    e.preventDefault();
    storeSettings(settings)
        .then(() => setInitialSettings(settings))
        .catch(() => {});
  }, [settings]);

  return <form id='preferences-form' onSubmit={saveSettings}>
    <label htmlFor='target-language'>Default language:</label>
    <select id='target-language' name='target-language' value={settings.targetLanguage} onChange={e => setSettings({ ...settings, targetLanguage: e.target.selectedOptions[0].value })}>
      <optgroup label='Node.js'>
        <option value='javascript'>Library</option>
        <option value='playwright-test'>Test Runner</option>
      </optgroup>
      <optgroup label='Java'>
        <option value='java-junit'>JUnit</option>
        <option value='java'>Library</option>
      </optgroup>
      <optgroup label='Python'>
        <option value='python-pytest'>Pytest</option>
        <option value='python'>Library</option>
        <option value='python-async'>Library Async</option>
      </optgroup>
      <optgroup label='.NET C#'>
        <option value='csharp-mstest'>MSTest</option>
        <option value='csharp-nunit'>NUnit</option>
        <option value='csharp'>Library</option>
      </optgroup>
    </select>
    <label htmlFor='test-id'>TestID Attribute Name:</label>
    <input
      type='text'
      id='test-id'
      name='test-id'
      placeholder='Enter Attribute Name'
      pattern='[a-zA-Z][\w\-]*'
      title='Must be a valid attribute name'
      value={settings.testIdAttributeName}
      onChange={e => setSettings({ ...settings, testIdAttributeName: e.target.value })}
    />
    <div>
      <label htmlFor='sidepanel' className='row'>Open in Side Panel:</label>
      <input
        type='checkbox'
        id='sidepanel'
        name='sidepanel'
        checked={settings.sidepanel}
        onChange={e => setSettings({ ...settings, sidepanel: e.target.checked })}
      />
    </div>
    <div>
      <label htmlFor='playInIncognito' className='row'>Play in incognito:</label>
      <input
        disabled={!isAllowedIncognitoAccess}
        type='checkbox'
        id='playInIncognito'
        name='playInIncognito'
        checked={settings.playInIncognito}
        onChange={e => setSettings({ ...settings, playInIncognito: e.target.checked })}
      />
      {!isAllowedIncognitoAccess && <div className='note error'>This feature requires the extension to be allowed to run in incognito mode.</div>}
    </div>
    <div>
      <label htmlFor='experimental' className='row'>Allow experimental features:</label>
      <input
        type='checkbox'
        id='experimental'
        name='experimental'
        checked={settings.experimental}
        onChange={e => setSettings({ ...settings, experimental: e.target.checked })}
      />
    </div>
    <div>
      <label htmlFor='businessFlowEnabled' className='row'>启用业务流程录制：</label>
      <input
        type='checkbox'
        id='businessFlowEnabled'
        name='businessFlowEnabled'
        checked={settings.businessFlowEnabled}
        onChange={e => setSettings({ ...settings, businessFlowEnabled: e.target.checked })}
      />
    </div>
    <div>
      <label htmlFor='semanticAdapterEnabled' className='row'>启用 AntD / ProComponents 语义识别：</label>
      <input
        type='checkbox'
        id='semanticAdapterEnabled'
        name='semanticAdapterEnabled'
        checked={settings.semanticAdapterEnabled !== false}
        onChange={e => setSettings({ ...settings, semanticAdapterEnabled: e.target.checked })}
      />
      <div className='note'>关闭后仍会采集基础 target / form / table / dialog，但不会写入 PageContextSnapshot.ui 或新增 FlowStep.uiRecipe。</div>
    </div>
    <div>
      <label htmlFor='semanticAdapterDiagnosticsEnabled' className='row'>启用语义识别诊断日志：</label>
      <input
        type='checkbox'
        id='semanticAdapterDiagnosticsEnabled'
        name='semanticAdapterDiagnosticsEnabled'
        checked={settings.semanticAdapterDiagnosticsEnabled === true}
        onChange={e => setSettings({ ...settings, semanticAdapterDiagnosticsEnabled: e.target.checked })}
      />
      <div className='note'>诊断日志仅用于本地调试，不进入 flow export / compact YAML / AI input。</div>
    </div>
    <div>
      <label htmlFor='redactSensitiveData' className='row'>导出前脱敏：</label>
      <input
        type='checkbox'
        id='redactSensitiveData'
        name='redactSensitiveData'
        checked={settings.redactSensitiveData}
        onChange={e => setSettings({ ...settings, redactSensitiveData: e.target.checked })}
      />
    </div>
    <label htmlFor='defaultApp'>默认应用：</label>
    <input
      type='text'
      id='defaultApp'
      name='defaultApp'
      value={settings.defaultApp ?? ''}
      onChange={e => setSettings({ ...settings, defaultApp: e.target.value })}
    />
    <label htmlFor='defaultRepo'>默认仓库：</label>
    <input
      type='text'
      id='defaultRepo'
      name='defaultRepo'
      value={settings.defaultRepo ?? ''}
      onChange={e => setSettings({ ...settings, defaultRepo: e.target.value })}
    />
    <label htmlFor='defaultRole'>默认角色：</label>
    <input
      type='text'
      id='defaultRole'
      name='defaultRole'
      value={settings.defaultRole ?? ''}
      onChange={e => setSettings({ ...settings, defaultRole: e.target.value })}
    />
    <button id='submit' type='submit' disabled={!canSave}>{canSave ? '保存' : '已保存'}</button>
  </form>;
};
