/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import React from 'react';
import { summarizeUsage } from '../aiIntent/usage';
import type { AiIntentSettings, AiProviderProfile, AiUsageRecord } from '../aiIntent/types';

export const GlobalAiIntentCard: React.FC<{
  settings: AiIntentSettings;
  profiles: AiProviderProfile[];
  activeProfile?: AiProviderProfile;
  records: AiUsageRecord[];
  onSettingsChange: (settings: AiIntentSettings) => void;
  onOpenSettings: () => void;
  onOpenUsage: () => void;
}> = ({ settings, profiles, activeProfile, records, onSettingsChange, onOpenSettings, onOpenUsage }) => {
  const summary = React.useMemo(() => summarizeUsage(records), [records]);
  const currency = records[records.length - 1]?.cost.currency || activeProfile?.pricing.currency || 'USD';
  return <section className='global-ai-card'>
    <div className='global-ai-title'>
      <strong>AI Intent 全局配置</strong>
      <span>AI</span>
    </div>
    <div className='global-ai-grid'>
      <div>
        <span>状态</span>
        <label className='ai-switch-row'>
          <input type='checkbox' checked={settings.enabled} onChange={e => onSettingsChange({ ...settings, enabled: e.target.checked })} />
          {settings.enabled ? '已启用' : '未启用'}
        </label>
      </div>
      <label>
        Provider
        <select value={settings.activeProfileId || ''} onChange={e => onSettingsChange({ ...settings, activeProfileId: e.target.value })}>
          {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
        </select>
      </label>
      <label>
        模式
        <select value={settings.mode} onChange={e => onSettingsChange({ ...settings, mode: e.target.value as AiIntentSettings['mode'] })}>
          <option value='ai-first'>AI 优先</option>
          <option value='rule-fallback'>规则优先，AI 兜底</option>
          <option value='manual'>仅手动</option>
        </select>
      </label>
      <div>
        <span>今日费用</span>
        <strong>{currency} {summary.todayCost.toFixed(6)}</strong>
      </div>
    </div>
    <div className='global-ai-actions'>
      <button type='button' onClick={onOpenSettings}>设置</button>
      <button type='button' onClick={onOpenUsage}>用量</button>
    </div>
  </section>;
};
