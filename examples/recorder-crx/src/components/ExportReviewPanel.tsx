/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import React from 'react';
import { flowStats } from '../flow/display';
import { repeatSegmentStats } from '../flow/repeatSegments';
import type { BusinessFlow } from '../flow/types';

type ExportFormat = 'json' | 'yaml';
type ExportRiskLevel = 'p0' | 'p1' | 'ok';

type ExportRiskItem = {
  id: string;
  level: ExportRiskLevel;
  title: string;
  detail: string;
};

export const ExportReviewPanel: React.FC<{
  flow: BusinessFlow;
  redactionEnabled: boolean;
  playwrightCode?: string;
  onExportJson: () => void;
  onExportYaml: () => void;
  onOpenReplayCode: () => void;
}> = ({ flow, redactionEnabled, playwrightCode, onExportJson, onExportYaml, onOpenReplayCode }) => {
  const [format, setFormat] = React.useState<ExportFormat>('json');
  const risks = React.useMemo(() => buildExportRisks(flow, redactionEnabled), [flow, redactionEnabled]);
  const p0Count = risks.filter(item => item.level === 'p0').length;
  const p1Count = risks.filter(item => item.level === 'p1').length;
  const okCount = risks.filter(item => item.level === 'ok').length;
  const disabledByP0 = p0Count > 0;

  return <details className='export-review-panel' aria-label='导出检查' open>
    <summary className='export-review-header'>
      <div>
        <span className='eyebrow'>导出检查</span>
        <h2>导出前复核：{flow.flow.name || '未命名业务流程'}</h2>
        <p>P0 会阻塞导出；P1 可以继续，但建议先处理。代码预览默认折叠，避免挤占主屏。</p>
      </div>
      <div className='export-risk-score' data-risk={p0Count ? 'p0' : p1Count ? 'p1' : 'ok'} aria-hidden='true'>
        <strong>{p0Count ? `P0 × ${p0Count}` : p1Count ? `P1 × ${p1Count}` : 'OK'}</strong>
        <span>{p0Count ? '需要先修' : p1Count ? '可导出，有风险' : '可导出'}</span>
      </div>
      <span className='export-review-chevron'>⌄</span>
    </summary>

    <div className='export-review-body'>
      <div className='export-risk-strip'>
        <span className={p0Count ? 'risk-pill p0 active' : 'risk-pill p0'}>P0 {p0Count}</span>
        <span className={p1Count ? 'risk-pill p1 active' : 'risk-pill p1'}>P1 {p1Count}</span>
        <span className='risk-pill ok'>OK {okCount}</span>
        <span className={redactionEnabled ? 'risk-pill ok active' : 'risk-pill p1 active'}>{redactionEnabled ? '脱敏开启' : '脱敏关闭'}</span>
      </div>

      <details className='export-risk-details' open>
        <summary>
          <span>检查结果</span>
          <em>{risks.length} 项</em>
        </summary>
        <div className='export-risk-list'>
          {risks.map(item => <article className={`export-risk-card ${item.level}`} key={item.id}>
            <span>{item.level.toUpperCase()}</span>
            <div>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
            </div>
          </article>)}
        </div>
      </details>

      <div className='export-cta-card replay-cta-card'>
        <div>
          <strong>Replay CTA</strong>
          <span>先打开生成的 Playwright replay 代码检查，再选择导出格式。</span>
        </div>
        <button type='button' className='primary replay-code-button' onClick={onOpenReplayCode}>查看 Replay 代码</button>
      </div>

      <div className='export-format-row'>
        <label>
          默认格式
          <select value={format} onChange={event => setFormat(event.target.value as ExportFormat)}>
            <option value='json'>流程 JSON（完整记录）</option>
            <option value='yaml'>紧凑 YAML（轻量交接）</option>
          </select>
        </label>
        <div className='export-format-actions'>
          <button type='button' className='primary' disabled={disabledByP0} onClick={format === 'json' ? onExportJson : onExportYaml}>导出所选格式</button>
          <button type='button' disabled={disabledByP0} onClick={onExportJson}>导出流程 JSON</button>
          <button type='button' disabled={disabledByP0} onClick={onExportYaml}>导出紧凑 YAML</button>
        </div>
      </div>

      <details className='export-code-preview'>
        <summary>
          <span>代码预览</span>
          <em>{playwrightCode ? `${playwrightCode.split('\n').length} 行` : '暂无代码'}</em>
        </summary>
        <pre>{playwrightCode || '暂无生成代码。先录制步骤或打开 Replay 代码。'}</pre>
      </details>
    </div>
  </details>;
};

function buildExportRisks(flow: BusinessFlow, redactionEnabled: boolean): ExportRiskItem[] {
  const stats = flowStats(flow);
  const repeatStats = repeatSegmentStats(flow);
  const risks: ExportRiskItem[] = [];

  if (!flow.flow.name.trim()) {
    risks.push({
      id: 'missing-flow-name',
      level: 'p0',
      title: '缺少流程名称',
      detail: '导出文件名和流程库记录都依赖流程名称；请先在编辑流程里填写。',
    });
  }
  if (!stats.stepCount) {
    risks.push({
      id: 'empty-steps',
      level: 'p0',
      title: '没有可导出的步骤',
      detail: '当前流程还没有录制动作，导出会得到空流程。',
    });
  }
  if (stats.missingAssertionCount > 0) {
    risks.push({
      id: 'missing-assertions',
      level: 'p1',
      title: `${stats.missingAssertionCount} 个步骤缺少启用断言`,
      detail: '可以继续导出，但回放只能确认动作执行，不能确认业务结果。',
    });
  }
  if (!redactionEnabled) {
    risks.push({
      id: 'redaction-disabled',
      level: 'p1',
      title: '敏感数据脱敏关闭',
      detail: '导出前不会自动清理 password、token、cookie、authorization 等敏感字段。',
    });
  }
  if (repeatStats.segmentCount > 0 && repeatStats.parameterCount === 0) {
    risks.push({
      id: 'repeat-no-params',
      level: 'p1',
      title: '循环片段没有启用参数',
      detail: '循环仍可导出，但不会形成真正的数据驱动回放。',
    });
  }

  risks.push({
    id: 'replay-code-ready',
    level: 'ok',
    title: stats.stepCount ? 'Replay 代码已生成' : 'Replay 代码等待步骤',
    detail: stats.stepCount ? `当前包含 ${stats.stepCount} 个步骤、${stats.assertionCount} 个启用断言。` : '录制步骤后会生成 Playwright replay 代码。',
  });
  risks.push({
    id: 'export-format-ready',
    level: 'ok',
    title: '格式可选',
    detail: 'JSON 适合完整恢复；YAML 适合轻量交接和人工审阅。',
  });

  return risks;
}
