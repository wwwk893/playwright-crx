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
}> = ({ settings, profiles, activeProfile, records, onOpenSettings, onOpenUsage }) => {
  const summary = React.useMemo(() => summarizeUsage(records), [records]);
  const currency = records[records.length - 1]?.cost.currency || activeProfile?.pricing.currency || 'USD';
  return <section className='global-ai-card ai-compact-card'>
    <div className='global-ai-title ai-compact-head'>
      <div>
        <strong>AI Intent 全局配置</strong>
        <span>默认不抢占流程库，只展示当前可决策状态。</span>
      </div>
      <span className='pill'>AI</span>
    </div>
    <div className='global-ai-grid compact-metrics' aria-label='AI Intent 配置摘要'>
      <div>
        <span>状态</span>
        <strong>{settings.enabled ? '已启用' : '未启用'}</strong>
      </div>
      <div>
        <span>Provider</span>
        <strong>{activeProfile?.name || profiles[0]?.name || '未配置'}</strong>
      </div>
      <div>
        <span>模式</span>
        <strong>{modeLabel(settings.mode)}</strong>
      </div>
      <div>
        <span>今日费用</span>
        <strong>{currency} {summary.todayCost.toFixed(6)}</strong>
      </div>
    </div>
    <div className='global-ai-actions button-group'>
      <button type='button' className='mini-button' onClick={onOpenSettings}>设置</button>
      <button type='button' className='mini-button' onClick={onOpenUsage}>用量</button>
    </div>
  </section>;
};

function modeLabel(mode: AiIntentSettings['mode']) {
  if (mode === 'rule-fallback')
    return '规则优先';
  if (mode === 'manual')
    return '仅手动';
  return 'AI 优先';
}
