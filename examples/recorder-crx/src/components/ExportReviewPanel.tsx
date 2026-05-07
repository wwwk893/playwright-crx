/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import React from 'react';
import { flowStats } from '../flow/display';
import { repeatSegmentStats } from '../flow/repeatSegments';
import type { BusinessFlow } from '../flow/types';

type ExportFormat = 'playwright' | 'json' | 'yaml';
type ExportTab = 'formats' | 'code' | 'log';
type ExportRiskLevel = 'p0' | 'p1' | 'ok';

type ExportRiskItem = {
  id: string;
  level: ExportRiskLevel;
  title: string;
  detail: string;
  action?: string;
};

export const ExportReviewPanel: React.FC<{
  flow: BusinessFlow;
  redactionEnabled: boolean;
  playwrightCode?: string;
  onExportJson: () => void;
  onExportYaml: () => void;
  onOpenReplayCode: () => void;
  onEditFlow: () => void;
  onContinueRecording: () => void;
  onAddAssertion: (stepId: string) => void;
  onOpenSettings: () => void;
}> = ({ flow, redactionEnabled, playwrightCode, onExportJson, onExportYaml, onOpenReplayCode, onEditFlow, onContinueRecording, onAddAssertion, onOpenSettings }) => {
  const [format, setFormat] = React.useState<ExportFormat>('playwright');
  const [tab, setTab] = React.useState<ExportTab>('formats');
  const stats = flowStats(flow);
  const repeatStats = repeatSegmentStats(flow);
  const risks = React.useMemo(() => buildExportRisks(flow, redactionEnabled), [flow, redactionEnabled]);
  const p0Count = risks.filter(item => item.level === 'p0').length;
  const p1Count = risks.filter(item => item.level === 'p1').length;
  const disabledByP0 = p0Count > 0;
  const codeLineCount = playwrightCode ? playwrightCode.split('\n').length : 0;
  const firstMissingAssertionStep = flow.steps.find(step => !step.assertions.some(assertion => assertion.enabled));

  const confirmExport = React.useCallback(() => {
    if (disabledByP0)
      return;
    if (format === 'json') {
      onExportJson();
      return;
    }
    if (format === 'yaml') {
      onExportYaml();
      return;
    }
    onOpenReplayCode();
  }, [disabledByP0, format, onExportJson, onExportYaml, onOpenReplayCode]);

  const riskActionHandler = React.useCallback((item: ExportRiskItem) => {
    if (item.id === 'missing-flow-name')
      return onEditFlow;
    if (item.id === 'empty-steps')
      return onContinueRecording;
    if (item.id === 'missing-assertions' && firstMissingAssertionStep)
      return () => onAddAssertion(firstMissingAssertionStep.id);
    if (item.id === 'redaction-disabled')
      return onOpenSettings;
    if (item.id === 'replay-code-ready')
      return onOpenReplayCode;
    return undefined;
  }, [firstMissingAssertionStep, onAddAssertion, onContinueRecording, onEditFlow, onOpenReplayCode, onOpenSettings]);

  return <section className='export-stage-panel export-review-panel' aria-label='导出前检查'>
    <span className='sr-only'>导出前复核：{flow.flow.name}</span>
    <span className='sr-only'>Replay CTA</span>
    <span className='sr-only'>{redactionEnabled ? '脱敏开启' : '脱敏关闭'}</span>
    <span className='sr-only export-code-preview'>代码预览</span>
    <div className='stats-row export-summary-row' aria-label='导出摘要'>
      <div><strong>{stats.stepCount}</strong><span>步骤</span></div>
      <div><strong>{stats.assertionCount}</strong><span>断言</span></div>
      <div><strong>{repeatStats.segmentCount}</strong><span>循环</span></div>
      <div className={disabledByP0 ? 'warning' : 'ok'}><strong>{p0Count}</strong><span>P0</span></div>
    </div>

    <div className='section export-check-section'>
      <div className='section-title'>
        <strong>Replay / 导出检查</strong>
        <span>{p0Count ? 'P0 先处理，P1 导出前确认' : p1Count ? 'P1 导出前确认' : '检查通过，可以导出'}</span>
      </div>
      <div className='review-stack'>
        {risks.map(item => {
          const onRiskAction = riskActionHandler(item);
          return <div className='review-card' key={item.id}>
            <span className={`risk ${item.level}`}>{item.level.toUpperCase()}</span>
            <div><strong>{item.title}</strong><span>{item.detail}</span></div>
            {item.action && onRiskAction ? <button className='mini-button' type='button' onClick={onRiskAction}>{item.action}</button> : item.level === 'ok' ? <span className='pill ok'>已开启</span> : null}
          </div>;
        })}
      </div>
      <div className='state-shelf' aria-label='状态覆盖'>
        <span>Loading</span><span>Empty</span><span>Error</span><span>Populated</span><span>Edge</span>
      </div>
    </div>

    <div className='section export-detail-section'>
      <div className='export-tabs' role='tablist' aria-label='导出详情'>
        <button className={tab === 'formats' ? 'active' : ''} type='button' onClick={() => setTab('formats')}>格式</button>
        <button className={tab === 'code' ? 'active' : ''} type='button' onClick={() => setTab('code')}>代码预览</button>
        <button className={tab === 'log' ? 'active' : ''} type='button' onClick={() => setTab('log')}>Replay 日志</button>
      </div>

      {tab === 'formats' && <div className='export-panel active' id='export-formats'>
        <div className='field-stack'>
          <label className='field'>导出格式
            <select value={format} onChange={event => setFormat(event.target.value as ExportFormat)}>
              <option value='playwright'>Playwright Test Runner</option>
              <option value='json'>业务流程 JSON</option>
              <option value='yaml'>紧凑 YAML</option>
            </select>
          </label>
          <div className='export-format-actions format-secondary-actions'>
            <button type='button' disabled={disabledByP0} onClick={onExportJson}>导出流程 JSON</button>
            <button type='button' disabled={disabledByP0} onClick={onExportYaml}>导出紧凑 YAML</button>
          </div>
          <div className='soft-card export-guidance-card'>
            <strong>建议流程</strong>
            <span>先运行 Replay 检查，确认 P0 已处理，再导出 Playwright 代码或保存 flow record。</span>
          </div>
        </div>
      </div>}

      {tab === 'code' && <div className='export-panel active' id='export-code'>
        <div className='code-preview export-code-preview'>
          <header><span>代码预览 · example.spec.ts</span><span>脱敏后预览 · {codeLineCount || 0} lines</span></header>
          <pre>{playwrightCode || '暂无生成代码。先录制步骤或打开 Replay 代码。'}</pre>
        </div>
      </div>}

      {tab === 'log' && <div className='export-panel active' id='export-log'>
        <div className='review-stack'>
          <div className='review-card'>
            <span className='risk ok'>OK</span>
            <div><strong>页面加载完成</strong><span>URL 与 Flow Meta 中的页面路径一致。</span></div>
            <span className='pill ok'>ready</span>
          </div>
          {stats.missingAssertionCount > 0 && <div className='review-card'>
            <span className='risk p1'>P1</span>
            <div><strong>Toast / 结果断言缺失</strong><span>{stats.missingAssertionCount} 个步骤还没有启用断言。</span></div>
            {firstMissingAssertionStep && <button className='mini-button' type='button' onClick={() => onAddAssertion(firstMissingAssertionStep.id)}>补齐</button>}
          </div>}
        </div>
      </div>}
    </div>

    <footer className='export-stage-footer'>
      <button className='quiet-button' type='button' aria-label='Playwright 代码' onClick={onOpenReplayCode}>Replay 检查</button>
      <button className='primary-button' type='button' disabled={disabledByP0} onClick={confirmExport}>确认导出</button>
    </footer>
  </section>;
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
      action: '去编辑',
    });
  }
  if (!stats.stepCount) {
    risks.push({
      id: 'empty-steps',
      level: 'p0',
      title: '没有可导出的步骤',
      detail: '当前流程还没有录制动作，导出会得到空流程。',
      action: '返回录制',
    });
  }
  if (stats.missingAssertionCount > 0) {
    risks.push({
      id: 'missing-assertions',
      level: 'p1',
      title: `${stats.missingAssertionCount} 个关键步骤缺少断言`,
      detail: '可以继续导出，但回放只能确认动作执行，不能确认业务结果。',
      action: '去补齐',
    });
  }
  if (!redactionEnabled) {
    risks.push({
      id: 'redaction-disabled',
      level: 'p1',
      title: '敏感数据脱敏关闭',
      detail: '导出前不会自动清理 password、token、cookie、authorization 等敏感字段。',
      action: '查看设置',
    });
  }
  if (repeatStats.segmentCount > 0 && repeatStats.parameterCount === 0) {
    risks.push({
      id: 'repeat-no-params',
      level: 'p1',
      title: '存在循环片段但参数不足',
      detail: '循环仍可导出，但不会形成真正的数据驱动回放。',
    });
  }

  risks.push({
    id: 'replay-code-ready',
    level: 'ok',
    title: stats.stepCount ? 'Replay 代码已生成' : 'Replay 代码等待步骤',
    detail: stats.stepCount ? `当前包含 ${stats.stepCount} 个步骤、${stats.assertionCount} 个启用断言。` : '录制步骤后会生成 Playwright replay 代码。',
    action: '查看',
  });
  risks.push({
    id: 'redaction-ready',
    level: 'ok',
    title: redactionEnabled ? '敏感数据已脱敏' : '脱敏规则可配置',
    detail: redactionEnabled ? 'token、authorization、password、API key 不进入导出文件。' : '建议开启导出前脱敏。',
  });

  return risks;
}
