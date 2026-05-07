/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import React from 'react';
import { summarizeUsage } from '../aiIntent/usage';
import type { AiProviderProfile, AiUsageRecord } from '../aiIntent/types';

export const AiUsagePanel: React.FC<{
  records: AiUsageRecord[];
  activeProfile?: AiProviderProfile;
  onBack?: () => void;
  onClose?: () => void;
  onOpenSettings?: () => void;
  onExport: () => void;
  onClear: () => void;
}> = ({ records, activeProfile, onBack, onClose, onOpenSettings, onExport, onClear }) => {
  const summary = React.useMemo(() => summarizeUsage(records), [records]);
  const todayRecords = React.useMemo(() => records.filter(record => record.createdAt.slice(0, 10) === new Date().toISOString().slice(0, 10)), [records]);
  const latestRecord = records[records.length - 1];
  const currency = latestRecord?.cost.currency || activeProfile?.pricing.currency || 'USD';
  const close = onClose ?? onBack;

  return <section className='ai-usage-panel'>
    {!onClose && onBack && <button type='button' className='back-to-library' onClick={onBack}>← 返回流程库</button>}
    <div className='sheet-section-heading'>
      <div>
        <h3>AI Intent 用量</h3>
        <p>{activeProfile ? `${activeProfile.name} / ${activeProfile.model}` : latestRecord ? `${latestRecord.providerName} / ${latestRecord.model}` : '尚未选择 Provider / Model'}</p>
      </div>
      {close && <button type='button' className='sheet-close compact' onClick={close} aria-label='关闭'>×</button>}
    </div>

    <div className='ai-usage-summary-row'>
      <div>
        <span>今日请求</span>
        <strong>{todayRecords.length}</strong>
      </div>
      <div>
        <span>今日费用</span>
        <strong>{formatCost(summary.todayCost, currency)}</strong>
      </div>
    </div>

    <div className='ai-usage-grid'>
      <div><strong>{formatCost(summary.totalCost, currency)}</strong><span>总费用</span></div>
      <div><strong>{summary.calls}</strong><span>总请求</span></div>
      <div><strong>{Math.round(summary.successRate * 100)}%</strong><span>成功率</span></div>
      <div><strong>{Math.round(summary.avgLatencyMs)}ms</strong><span>平均延迟</span></div>
      <div><strong>{summary.totalInputTokens}</strong><span>输入 tokens</span></div>
      <div><strong>{summary.totalOutputTokens}</strong><span>输出 tokens</span></div>
    </div>

    <div className='ai-privacy-note sheet-note'>
      AI Intent 用量记录仅保存在本地浏览器存储中。业务步骤和请求体在进入 AI 前会按当前脱敏规则处理；请勿在生产环境录制真实密钥、cookie 或客户敏感数据。
    </div>

    <div className='ai-usage-actions'>
      {close && <button type='button' onClick={close}>关闭</button>}
      {onOpenSettings && <button type='button' className='primary' onClick={onOpenSettings}>打开 AI 设置</button>}
      <button type='button' onClick={onExport}>导出</button>
      <button type='button' className='danger-outline' onClick={onClear}>清空</button>
    </div>

    <div className='ai-usage-list'>
      <div className='section-heading row'>
        <span>最近记录</span>
        <span>{records.length ? `最近 ${Math.min(records.length, 8)} / ${records.length} 条` : '暂无记录'}</span>
      </div>
      {records.slice(-8).reverse().map(record => <div className={record.success ? 'ai-usage-row' : 'ai-usage-row failed'} key={record.id}>
        <strong>{record.providerName} / {record.model}</strong>
        <span>{formatDateTime(record.createdAt)} · {record.mode} · {record.success ? '成功' : `失败：${record.error || '未知错误'}`}</span>
        <span>{record.stepIds.join(', ') || '连接测试'} · {record.usage.totalTokens} tokens · {formatCost(record.cost.total, record.cost.currency)} · {record.latencyMs}ms</span>
      </div>)}
      {!records.length && <div className='business-flow-empty'>暂无 AI 调用记录。生成步骤意图或测试连接后会在这里显示用量。</div>}
    </div>
  </section>;
};

function formatCost(value: number, currency: string) {
  return `${currency} ${value.toFixed(6)}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    return value;
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}
