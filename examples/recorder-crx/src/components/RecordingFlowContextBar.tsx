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

  return <>
    <section className='recording-banner recording-context-card' aria-label='录制绑定状态'>
      <div>
        <strong>正在录制：{flowName}</strong>
        <span>默认使用流程库中当前选中的流程；记录将追加到 {insertAfterStepLabel || nextStepLabel}，不是全局录制。</span>
      </div>
      <span className='pill warn'>录制绑定</span>
    </section>

    <section className='flow-summary' aria-label='当前流程摘要'>
      <div>
        <h2>{recordingTarget}</h2>
        <div className='flow-meta'>
          {[flow.flow.app, flow.flow.role, flow.flow.priority, 'business-flow/v1'].filter(Boolean).map((item, index) => <React.Fragment key={`${item}-${index}`}>
            {index > 0 && <span>·</span>}
            <span>{item}</span>
          </React.Fragment>)}
        </div>
      </div>
      <span className='pill warn'>AI Intent：规则优先</span>
    </section>

    {insertAfterStepLabel && <div className='recording-context-insert-note'>当前为插入录制：新操作会优先接在 {insertAfterStepLabel} 后，仍然绑定当前流程。</div>}

    <section className='flow-context-card' aria-label='当前录制流程上下文'>
      <div className='ai-compact-head'>
        <div>
          <strong>当前流程卡</strong>
          <span>所有新步骤都会写入 {flowName}，切换流程前录制会暂停确认。</span>
        </div>
        <div className='button-group'>
          <button className='mini-button' type='button' onClick={onSwitchFlow}>返回流程库</button>
          <button className='mini-button' type='button' onClick={onEditFlow}>编辑流程</button>
          {onSaveDraft && <button className='mini-button' type='button' onClick={onSaveDraft}>保存草稿</button>}
        </div>
      </div>
      <div className='context-grid'>
        <ContextItem label='流程' value={flowName} emphasis />
        <ContextItem label='模块' value={flow.flow.module || '未填写'} />
        <ContextItem label='角色' value={flow.flow.role || '未填写'} />
        <ContextItem label='步骤 / 断言' value={`${stats.stepCount} / ${stats.assertionCount}`} tone={selectedRecordId ? 'success' : undefined} />
      </div>
      <span>未选择流程时，这里会显示 FlowSelectionGuard：先选择流程或新建流程后才能开始录制。</span>
      <span className='recording-context-state'>{selectedStatus} · {draftStatus || '本地草稿'}</span>
    </section>
  </>;
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
