/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import React from 'react';
import { createBlankProfile } from '../aiIntent/settings';
import type { AiIntentSettings, AiProviderProfile } from '../aiIntent/types';
import type { CrxSettings } from '../settings';

export const AiIntentSettingsPanel: React.FC<{
  settings: AiIntentSettings;
  profiles: AiProviderProfile[];
  activeProfile?: AiProviderProfile;
  apiKey: string;
  crxSettings: CrxSettings;
  status?: string;
  generating?: boolean;
  onBack?: () => void;
  onSettingsChange: (settings: AiIntentSettings) => void;
  onProfilesChange: (profiles: AiProviderProfile[]) => void;
  onApiKeyChange: (apiKey: string) => void;
  onCrxSettingsChange: (settings: CrxSettings) => void;
  onTestConnection: () => void;
  onGenerate: () => void;
  onOpenUsage: () => void;
}> = ({ settings, profiles, activeProfile, apiKey, crxSettings, status, generating, onBack, onSettingsChange, onProfilesChange, onApiKeyChange, onCrxSettingsChange, onTestConnection, onGenerate, onOpenUsage }) => {
  const updateCrxSettings = React.useCallback((patch: Partial<CrxSettings>) => {
    onCrxSettingsChange({ ...crxSettings, ...patch });
  }, [crxSettings, onCrxSettingsChange]);

  const updateProfile = React.useCallback((patch: Partial<AiProviderProfile>) => {
    if (!activeProfile)
      return;
    onProfilesChange(profiles.map(profile => profile.id === activeProfile.id ? { ...profile, ...patch, updatedAt: new Date().toISOString() } : profile));
  }, [activeProfile, onProfilesChange, profiles]);

  const updatePricing = React.useCallback((key: keyof AiProviderProfile['pricing'], value: string) => {
    if (!activeProfile)
      return;
    const numberValue = value === '' ? undefined : Number(value);
    updateProfile({
      pricing: {
        ...activeProfile.pricing,
        [key]: key === 'currency' ? value : numberValue,
      },
    });
  }, [activeProfile, updateProfile]);

  const createProfile = React.useCallback((protocol: AiProviderProfile['protocol']) => {
    const profile = createBlankProfile(protocol);
    onProfilesChange([...profiles, profile]);
    onSettingsChange({ ...settings, activeProfileId: profile.id });
  }, [onProfilesChange, onSettingsChange, profiles, settings]);

  const deleteProfile = React.useCallback(() => {
    if (!activeProfile || profiles.length <= 1)
      return;
    const nextProfiles = profiles.filter(profile => profile.id !== activeProfile.id);
    onProfilesChange(nextProfiles);
    onSettingsChange({ ...settings, activeProfileId: nextProfiles[0]?.id });
  }, [activeProfile, onProfilesChange, onSettingsChange, profiles, settings]);

  return <section className='settings-accordion-panel global-settings'>
    {onBack && <button type='button' className='back-to-library' onClick={onBack}>← 返回流程库</button>}
    <div className='settings-panel-title'>
      <div>
        <span className='eyebrow'>设置</span>
        <h2>录制偏好与导出安全</h2>
      </div>
      <button type='button' onClick={onOpenUsage}>查看用量</button>
    </div>

    <details className='settings-section' open>
      <summary>
        <span>高频录制偏好</span>
        <em>默认展开</em>
      </summary>
      <div className='settings-grid'>
        <label className='checkbox-row'>
          <input type='checkbox' checked={crxSettings.businessFlowEnabled !== false} onChange={e => updateCrxSettings({ businessFlowEnabled: e.target.checked })} />
          启用业务流程录制
        </label>
        <label>
          目标语言
          <select value={crxSettings.targetLanguage} onChange={e => updateCrxSettings({ targetLanguage: e.target.value })}>
            <option value='playwright-test'>Playwright Test</option>
            <option value='javascript'>Node.js Library</option>
            <option value='python-pytest'>Python Pytest</option>
            <option value='java-junit'>Java JUnit</option>
            <option value='csharp-mstest'>C# MSTest</option>
          </select>
        </label>
        <label>
          TestID 属性
          <input value={crxSettings.testIdAttributeName} pattern='[a-zA-Z][\w\-]*' onChange={e => updateCrxSettings({ testIdAttributeName: e.target.value })} />
        </label>
        <label>
          默认应用
          <input value={crxSettings.defaultApp ?? ''} onChange={e => updateCrxSettings({ defaultApp: e.target.value })} />
        </label>
        <label>
          默认仓库
          <input value={crxSettings.defaultRepo ?? ''} onChange={e => updateCrxSettings({ defaultRepo: e.target.value })} />
        </label>
        <label>
          默认角色
          <input value={crxSettings.defaultRole ?? ''} onChange={e => updateCrxSettings({ defaultRole: e.target.value })} />
        </label>
      </div>
    </details>

    <details className='settings-section'>
      <summary>
        <span>AI Intent 细节</span>
        <em>{settings.enabled ? '已启用' : '未启用'}</em>
      </summary>
      <div className='ai-settings-grid'>
        <label className='checkbox-row'>
          <input type='checkbox' checked={settings.enabled} onChange={e => onSettingsChange({ ...settings, enabled: e.target.checked })} />
          启用 AI 业务意图
        </label>
        <label>
          模式
          <select value={settings.mode} onChange={e => onSettingsChange({ ...settings, mode: e.target.value as AiIntentSettings['mode'] })}>
            <option value='ai-first'>AI 优先</option>
            <option value='rule-fallback'>规则优先，AI 兜底</option>
            <option value='manual'>仅手动触发</option>
          </select>
        </label>
        <label>
          Provider Profile
          <select value={settings.activeProfileId || ''} onChange={e => onSettingsChange({ ...settings, activeProfileId: e.target.value })}>
            {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </select>
        </label>
        <label>
          Batch size
          <input type='number' min={1} max={settings.maxBatchSize} value={settings.batchSize} onChange={e => onSettingsChange({ ...settings, batchSize: Number(e.target.value) || 1 })} />
        </label>
        <label>
          Debounce ms
          <input type='number' min={0} value={settings.debounceMs} onChange={e => onSettingsChange({ ...settings, debounceMs: Number(e.target.value) || 0 })} />
        </label>
      </div>
      {activeProfile && <div className='ai-profile-card'>
        <div className='section-heading row'>
          <span>Provider 配置</span>
          <span>{activeProfile.protocol}</span>
        </div>
        <div className='ai-settings-grid'>
          <label>名称<input value={activeProfile.name} onChange={e => updateProfile({ name: e.target.value })} /></label>
          <label>
            协议
            <select value={activeProfile.protocol} onChange={e => updateProfile({ protocol: e.target.value as AiProviderProfile['protocol'] })}>
              <option value='openai-compatible'>OpenAI-compatible</option>
              <option value='anthropic-compatible'>Anthropic-compatible</option>
            </select>
          </label>
          <label>Base URL<input value={activeProfile.baseUrl} onChange={e => updateProfile({ baseUrl: e.target.value })} /></label>
          <label>Model<input value={activeProfile.model} onChange={e => updateProfile({ model: e.target.value })} /></label>
          <label>API Key<input type='password' value={apiKey} placeholder={activeProfile.apiKeyPreview || '输入 API key'} onChange={e => onApiKeyChange(e.target.value)} /></label>
          <label>
            Response mode
            <select value={activeProfile.responseMode} onChange={e => updateProfile({ responseMode: e.target.value as AiProviderProfile['responseMode'] })}>
              <option value='json_object'>json_object</option>
              <option value='json_schema'>json_schema</option>
              <option value='prompt_json_only'>prompt_json_only</option>
            </select>
          </label>
          <label>
            Thinking
            <select value={activeProfile.thinking || 'omit'} onChange={e => updateProfile({ thinking: e.target.value as AiProviderProfile['thinking'] })}>
              <option value='disabled'>disabled</option>
              <option value='enabled'>enabled</option>
              <option value='omit'>omit</option>
            </select>
          </label>
          <label>Temperature<input type='number' step='0.1' value={activeProfile.temperature ?? 0.1} onChange={e => updateProfile({ temperature: Number(e.target.value) })} /></label>
          <label>Max tokens<input type='number' value={activeProfile.maxTokens ?? 400} onChange={e => updateProfile({ maxTokens: Number(e.target.value) })} /></label>
          <label>Timeout ms<input type='number' value={activeProfile.timeoutMs ?? 15000} onChange={e => updateProfile({ timeoutMs: Number(e.target.value) })} /></label>
        </div>
        <div className='section-heading'>价格 / 1M tokens</div>
        <div className='ai-settings-grid price-grid'>
          <label>Currency<input value={activeProfile.pricing.currency} onChange={e => updatePricing('currency', e.target.value)} /></label>
          <PriceInput label='Input' value={activeProfile.pricing.inputPer1M} onChange={value => updatePricing('inputPer1M', value)} />
          <PriceInput label='Output' value={activeProfile.pricing.outputPer1M} onChange={value => updatePricing('outputPer1M', value)} />
          <PriceInput label='Cached input' value={activeProfile.pricing.cachedInputPer1M} onChange={value => updatePricing('cachedInputPer1M', value)} />
          <PriceInput label='Cache miss' value={activeProfile.pricing.cacheMissInputPer1M} onChange={value => updatePricing('cacheMissInputPer1M', value)} />
          <PriceInput label='Cache write' value={activeProfile.pricing.cacheWritePer1M} onChange={value => updatePricing('cacheWritePer1M', value)} />
          <PriceInput label='Cache read' value={activeProfile.pricing.cacheReadPer1M} onChange={value => updatePricing('cacheReadPer1M', value)} />
          <PriceInput label='Reasoning' value={activeProfile.pricing.reasoningOutputPer1M} onChange={value => updatePricing('reasoningOutputPer1M', value)} />
          <PriceInput label='Request fee' value={activeProfile.pricing.requestFee} onChange={value => updatePricing('requestFee', value)} />
        </div>
        <div className='ai-profile-actions'>
          <button type='button' onClick={() => createProfile('openai-compatible')}>新增 OpenAI</button>
          <button type='button' onClick={() => createProfile('anthropic-compatible')}>新增 Anthropic</button>
          <button type='button' className='danger-outline' onClick={deleteProfile} disabled={profiles.length <= 1}>删除 Profile</button>
        </div>
      </div>}
      <div className='ai-action-row'>
        <button type='button' onClick={onTestConnection} disabled={generating}>Test Connection</button>
        <button type='button' className='primary' onClick={onGenerate} disabled={generating}>{generating ? 'AI 生成中...' : 'Generate AI Intents'}</button>
        <button type='button' onClick={onOpenUsage}>Open Usage</button>
      </div>
      {status && <div className='ai-status'>{status}</div>}
    </details>

    <details className='settings-section'>
      <summary>
        <span>隐私与导出</span>
        <em>{crxSettings.redactSensitiveData !== false ? '脱敏开启' : '脱敏关闭'}</em>
      </summary>
      <div className='settings-grid'>
        <label className='checkbox-row'>
          <input type='checkbox' checked={crxSettings.redactSensitiveData !== false} onChange={e => updateCrxSettings({ redactSensitiveData: e.target.checked })} />
          导出前脱敏
        </label>
        <label className='checkbox-row'>
          <input type='checkbox' checked={!!crxSettings.sidepanel} onChange={e => updateCrxSettings({ sidepanel: e.target.checked })} />
          默认打开 Side Panel
        </label>
        <label className='checkbox-row'>
          <input type='checkbox' checked={!!crxSettings.playInIncognito} onChange={e => updateCrxSettings({ playInIncognito: e.target.checked })} />
          Replay 使用无痕窗口
        </label>
        <label className='checkbox-row'>
          <input type='checkbox' checked={!!crxSettings.experimental} onChange={e => updateCrxSettings({ experimental: e.target.checked })} />
          允许实验功能
        </label>
      </div>
      <div className='ai-privacy-note'>AI Intent 只发送步骤局部页面语义摘要，不发送完整 DOM、cookie、token、password、authorization、完整接口响应或 API key。导出检查页会单独展示 P0/P1 风险。</div>
    </details>
  </section>;
};

const PriceInput: React.FC<{
  label: string;
  value?: number;
  onChange: (value: string) => void;
}> = ({ label, value, onChange }) => <label>
  {label}
  <input type='number' step='0.0001' value={value ?? ''} onChange={e => onChange(e.target.value)} />
</label>;
