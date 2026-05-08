/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import React from 'react';
import type { AiIntentSettings, AiProviderProfile } from '../aiIntent/types';
import type { BusinessFlow } from '../flow/types';

export type FlowAiIntentOverride = 'inherit' | 'enabled' | 'disabled';

export const FlowAiIntentControl: React.FC<{
  flow: BusinessFlow;
  settings: AiIntentSettings;
  activeProfile?: AiProviderProfile;
  effectiveEnabled: boolean;
  generating?: boolean;
  onOverrideChange: (override: FlowAiIntentOverride) => void;
  onGenerate: () => void;
  onOpenUsage: () => void;
}> = ({ flow, settings, activeProfile, effectiveEnabled, generating, onOverrideChange, onGenerate, onOpenUsage }) => {
  const override = flow.artifacts?.aiIntent?.override ?? 'inherit';
  const configuredEnabled = override === 'enabled' || (override === 'inherit' && settings.enabled);
  return <details className='flow-ai-control' open>
    <summary className='flow-ai-summary'>
      <div>
        <span className='eyebrow'>AI Intent</span>
        <strong>业务意图辅助</strong>
      </div>
      <span className={configuredEnabled ? 'flow-ai-enabled' : 'flow-ai-disabled'}>{configuredEnabled ? '已启用' : '未启用'}</span>
      <span className='flow-ai-chevron'>⌄</span>
    </summary>
    <div className='flow-ai-body'>
      <div className='flow-ai-status-line'>
        <label>
          <span>策略</span>
          <select value={override} onChange={e => onOverrideChange(e.target.value as FlowAiIntentOverride)}>
            <option value='inherit'>继承全局设置</option>
            <option value='enabled'>本流程启用</option>
            <option value='disabled'>本流程关闭</option>
          </select>
        </label>
        <span>Provider：{activeProfile?.name || '--'}</span>
        <span>模式：{modeLabel(settings.mode)}</span>
      </div>
      <div className='flow-ai-actions'>
        {configuredEnabled && <button type='button' className='primary' onClick={onGenerate} disabled={!effectiveEnabled || generating}>
          {generating ? 'AI 生成中...' : '生成业务意图'}
        </button>}
        <button type='button' onClick={onOpenUsage}>查看用量</button>
      </div>
      <div className='flow-ai-hint'>
        {configuredEnabled ? (effectiveEnabled ? '录制后自动生成，人工修改不会覆盖。' : '当前流程已启用；请确认 Provider 和 API Key 可用后生成。') : override === 'disabled' ? '本流程已关闭 AI Intent。' : '全局 AI Intent 已关闭，可为本流程单独启用。'}
      </div>
    </div>
  </details>;
};

function modeLabel(mode: AiIntentSettings['mode']) {
  if (mode === 'rule-fallback')
    return '规则优先，AI 兜底';
  if (mode === 'manual')
    return '仅手动';
  return 'AI 优先';
}
