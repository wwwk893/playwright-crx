/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import React from 'react';
import { summarizeUsage } from '../aiIntent/usage';
import type { AiUsageRecord } from '../aiIntent/types';

export const AiUsagePanel: React.FC<{
  records: AiUsageRecord[];
  onBack?: () => void;
  onExport: () => void;
  onClear: () => void;
}> = ({ records, onBack, onExport, onClear }) => {
  const summary = React.useMemo(() => summarizeUsage(records), [records]);
  const currency = records[records.length - 1]?.cost.currency || 'USD';

  return <section className='ai-usage-panel'>
    {onBack && <button type='button' className='back-to-library' onClick={onBack}>← 返回流程库</button>}
    <div className='section-heading row'>
      <span>AI 用量</span>
      <span>全局用量统计 · {records.length} 次调用</span>
    </div>
    <div className='ai-usage-grid'>
      <div><strong>{formatCost(summary.todayCost, currency)}</strong><span>今日费用</span></div>
      <div><strong>{formatCost(summary.totalCost, currency)}</strong><span>总费用</span></div>
      <div><strong>{Math.round(summary.successRate * 100)}%</strong><span>成功率</span></div>
      <div><strong>{Math.round(summary.avgLatencyMs)}ms</strong><span>平均延迟</span></div>
      <div><strong>{summary.totalInputTokens}</strong><span>输入 tokens</span></div>
      <div><strong>{summary.totalOutputTokens}</strong><span>输出 tokens</span></div>
    </div>
    <div className='ai-usage-actions'>
      <button type='button' onClick={onExport}>导出 JSONL</button>
      <button type='button' className='danger-outline' onClick={onClear}>清空记录</button>
    </div>
    <div className='ai-usage-list'>
      {records.slice(-8).reverse().map(record => <div className='ai-usage-row' key={record.id}>
        <strong>{record.providerName} / {record.model}</strong>
        <span>{record.success ? '成功' : `失败：${record.error || '未知错误'}`}</span>
        <span>{record.stepIds.join(', ')} · {record.usage.totalTokens} tokens · {formatCost(record.cost.total, record.cost.currency)} · {record.latencyMs}ms</span>
      </div>)}
      {!records.length && <div className='business-flow-empty'>暂无 AI 调用记录。</div>}
    </div>
  </section>;
};

function formatCost(value: number, currency: string) {
  return `${currency} ${value.toFixed(6)}`;
}
