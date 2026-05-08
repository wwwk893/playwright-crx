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
  action?: string;
};

export const ExportReviewPanel: React.FC<{
  flow: BusinessFlow;
  redactionEnabled: boolean;
  onExportJson: () => void;
  onExportYaml: () => void;
  onOpenReplayCode: () => void;
  onEditFlow: () => void;
  onContinueRecording: () => void;
  onAddAssertion: (stepId: string) => void;
  onOpenSettings: () => void;
}> = ({ flow, redactionEnabled, onExportJson, onExportYaml, onOpenReplayCode, onEditFlow, onContinueRecording, onAddAssertion, onOpenSettings }) => {
  const [format, setFormat] = React.useState<ExportFormat>('json');
  const stats = flowStats(flow);
  const repeatStats = repeatSegmentStats(flow);
  const risks = React.useMemo(() => buildExportRisks(flow, redactionEnabled), [flow, redactionEnabled]);
  const p0Count = risks.filter(item => item.level === 'p0').length;
  const p1Count = risks.filter(item => item.level === 'p1').length;
  const disabledByP0 = p0Count > 0;
  const firstMissingAssertionStep = flow.steps.find(step => !step.assertions.some(assertion => assertion.enabled));

  const exportSelectedFormat = React.useCallback(() => {
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
  }, [disabledByP0, format, onExportJson, onExportYaml]);

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
    <span className='sr-only'>回放 CTA</span>
    <span className='sr-only'>{redactionEnabled ? '脱敏开启' : '脱敏关闭'}</span>
    <div className='stats-row export-summary-row' aria-label='导出摘要'>
      <div><strong>{stats.stepCount}</strong><span>步骤</span></div>
      <div><strong>{stats.assertionCount}</strong><span>断言</span></div>
      <div><strong>{repeatStats.segmentCount}</strong><span>循环</span></div>
      <div className={disabledByP0 ? 'warning' : 'ok'}><strong>{p0Count}</strong><span>P0</span></div>
    </div>

    <div className='section export-check-section'>
      <div className='section-title'>
        <strong>回放 / 导出检查</strong>
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
    </div>

    <div className='section export-detail-section'>
      <div className='export-panel active' id='export-formats'>
        <div className='field-stack'>
          <label className='field'>导出格式
            <select value={format} onChange={event => setFormat(event.target.value as ExportFormat)}>
              <option value='json'>业务流程 JSON</option>
              <option value='yaml'>紧凑 YAML</option>
            </select>
          </label>
          <div className='export-format-actions format-secondary-actions'>
            <button type='button' disabled={disabledByP0} onClick={onExportJson}>导出流程 JSON</button>
            <button type='button' disabled={disabledByP0} onClick={onExportYaml}>导出紧凑 YAML</button>
            <button type='button' className='primary' disabled={disabledByP0} onClick={exportSelectedFormat}>导出当前格式</button>
          </div>
          <div className='soft-card export-guidance-card'>
            <strong>建议流程</strong>
            <span>先通过顶部回放确认回放路径，再导出业务流程 JSON 或紧凑 YAML。</span>
          </div>
        </div>
      </div>
    </div>
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
    title: stats.stepCount ? '回放代码已生成' : '回放代码等待步骤',
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
