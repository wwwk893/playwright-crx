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
import type { BusinessFlow } from '../flow/types';

export const RecordingFlowContextBar: React.FC<{
  flow: BusinessFlow;
  isRecording: boolean;
  aiIntentEnabled: boolean;
  aiIntentModeLabel: string;
  nextStepLabel: string;
  insertAfterStepLabel?: string;
}> = ({ flow, isRecording, aiIntentEnabled, aiIntentModeLabel, nextStepLabel, insertAfterStepLabel }) => {
  const flowName = flow.flow.name.trim() || '未命名业务流程';
  const modulePage = [flow.flow.module, flow.flow.page].filter(Boolean).join(' / ');
  const recordingTarget = modulePage || flow.flow.page || flow.flow.module || flowName;

  return <>
    <section className='recording-banner recording-context-card' aria-label='录制绑定状态'>
      <div>
        <strong>{isRecording ? '正在录制' : '步骤检查'}：{flowName}</strong>
        <span>{isRecording ? `记录将追加到 ${insertAfterStepLabel || nextStepLabel}，不是全局录制。` : '当前没有启动录制，可以检查步骤、保存记录，或从任意位置继续录制。'}</span>
      </div>
      <span className={isRecording ? 'pill warn' : 'pill ok'}>{isRecording ? '录制绑定' : '未录制'}</span>
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
      <span className={aiIntentEnabled ? 'pill ok' : 'pill warn'}>AI Intent：{aiIntentEnabled ? aiIntentModeLabel : '未启用'}</span>
    </section>

    {insertAfterStepLabel && <div className='recording-context-insert-note'>当前为插入录制：新操作会优先接在 {insertAfterStepLabel} 后，仍然绑定当前流程。</div>}
  </>;
};
