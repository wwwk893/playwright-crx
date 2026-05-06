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
import { flowStats } from '../flow/display';
import type { BusinessFlow } from '../flow/types';

export const RecordingFlowContextBar: React.FC<{
  flow: BusinessFlow;
  selectedRecordId?: string;
  draftStatus: string;
  nextStepLabel: string;
  insertAfterStepLabel?: string;
  onSwitchFlow: () => void;
  onEditFlow: () => void;
  onSaveDraft?: () => void;
}> = ({ flow, selectedRecordId, draftStatus, nextStepLabel, insertAfterStepLabel, onSwitchFlow, onEditFlow, onSaveDraft }) => {
  const stats = flowStats(flow);
  const flowName = flow.flow.name.trim() || '未命名业务流程';
  const modulePage = [flow.flow.module, flow.flow.page].filter(Boolean).join(' / ');
  const recordingTarget = modulePage || flow.flow.page || flow.flow.module || flowName;
  const selectedStatus = selectedRecordId ? '已选流程记录' : '当前草稿流程';

  return <section className='recording-context-card' aria-label='当前录制流程上下文'>
    <div className='recording-context-head'>
      <div>
        <span className='recording-context-eyebrow'>录制 · {flowName}</span>
        <h2>正在录制：{recordingTarget}</h2>
        {recordingTarget !== flowName && <p>正在录制：{flowName}</p>}
        <p className='recording-context-warning'>记录将追加到 {nextStepLabel}，不是全局录制。</p>
      </div>
      <div className='recording-context-actions'>
        <button type='button' onClick={onSwitchFlow}>切换流程</button>
        <button type='button' onClick={onEditFlow}>编辑流程</button>
        {onSaveDraft && <button type='button' onClick={onSaveDraft}>保存草稿</button>}
      </div>
    </div>
    {insertAfterStepLabel && <div className='recording-context-insert-note'>当前为插入录制：新操作会优先接在 {insertAfterStepLabel} 后，仍然绑定当前流程。</div>}
    <div className='recording-context-grid'>
      <ContextItem label='流程' value={flowName} emphasis />
      <ContextItem label='模块 / 页面' value={modulePage || flow.flow.page || flow.flow.module || '未填写'} />
      <ContextItem label='角色' value={flow.flow.role || '未填写'} />
      <ContextItem label='优先级' value={flow.flow.priority || '未设置'} tone={flow.flow.priority === 'P0' || flow.flow.priority === 'P1' ? 'warning' : undefined} />
      <ContextItem label='步骤 / 断言' value={`${stats.stepCount} 步骤 · ${stats.assertionCount} 断言`} />
      <ContextItem label='记录状态' value={`${selectedStatus} · ${draftStatus || '本地草稿'}`} tone={selectedRecordId ? 'success' : undefined} />
    </div>
  </section>;
};

const ContextItem: React.FC<{
  label: string;
  value: string;
  emphasis?: boolean;
  tone?: 'success' | 'warning';
}> = ({ label, value, emphasis, tone }) => {
  return <div className={`recording-context-item ${emphasis ? 'emphasis' : ''} ${tone ?? ''}`.trim()}>
    <span>{label}</span>
    <strong>{value}</strong>
  </div>;
};
