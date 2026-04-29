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
import type { BusinessFlow, FlowMeta, FlowTestDataItem } from '../flow/types';

type FlowMetaPatch = Partial<FlowMeta>;

export const FlowMetaPanel: React.FC<{
  flow: BusinessFlow;
  onChange: (flow: BusinessFlow) => void;
  compact?: boolean;
}> = ({ flow, onChange, compact }) => {
  const updateMeta = React.useCallback((patch: FlowMetaPatch) => {
    onChange({
      ...flow,
      flow: {
        ...flow.flow,
        ...patch,
      },
      updatedAt: new Date().toISOString(),
    });
  }, [flow, onChange]);

  const updateFlow = React.useCallback((patch: Partial<BusinessFlow>) => {
    onChange({
      ...flow,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  }, [flow, onChange]);

  return <section className={compact ? 'flow-meta-panel compact' : 'flow-meta-panel'}>
    <div className='flow-form-grid'>
      <label>
        <RequiredLabel>流程名称</RequiredLabel>
        <input required type='text' value={flow.flow.name} onChange={e => updateMeta({ name: e.target.value })} />
      </label>
      <label>
        <span className='field-label'>应用</span>
        <input type='text' value={flow.flow.app ?? ''} onChange={e => updateMeta({ app: e.target.value })} />
      </label>
      <label>
        <span className='field-label'>仓库</span>
        <input type='text' value={flow.flow.repo ?? ''} onChange={e => updateMeta({ repo: e.target.value })} />
      </label>
      <label>
        <span className='field-label'>模块</span>
        <input type='text' value={flow.flow.module ?? ''} onChange={e => updateMeta({ module: e.target.value })} />
      </label>
      <label>
        <RequiredLabel>页面</RequiredLabel>
        <input type='text' value={flow.flow.page ?? ''} onChange={e => updateMeta({ page: e.target.value })} />
      </label>
      <label>
        <RequiredLabel>角色</RequiredLabel>
        <input type='text' value={flow.flow.role ?? ''} onChange={e => updateMeta({ role: e.target.value })} />
      </label>
      <label>
        <RequiredLabel>优先级</RequiredLabel>
        <select value={flow.flow.priority ?? ''} onChange={e => updateMeta({ priority: e.target.value as FlowMeta['priority'] || undefined })}>
          <option value=''>未设置</option>
          <option value='P0'>P0</option>
          <option value='P1'>P1</option>
          <option value='P2'>P2</option>
          <option value='P3'>P3</option>
        </select>
      </label>
    </div>
    <label>
      <RequiredLabel>业务目标</RequiredLabel>
      <textarea value={flow.flow.businessGoal ?? ''} rows={2} onChange={e => updateMeta({ businessGoal: e.target.value })} />
    </label>
    <label>
      <span className='field-label'>前置条件</span>
      <textarea value={flow.preconditions.join('\n')} rows={3} onChange={e => updateFlow({ preconditions: splitLines(e.target.value) })} />
    </label>
    <label>
      <span className='field-label'>测试数据</span>
      <textarea value={formatTestData(flow.testData)} rows={3} onChange={e => updateFlow({ testData: parseTestData(e.target.value) })} />
    </label>
    <details className='flow-advanced'>
      <summary>更多信息</summary>
      <div className='flow-form-grid'>
        <label>
          <span className='field-label'>流程 ID</span>
          <input type='text' value={flow.flow.id} onChange={e => updateMeta({ id: e.target.value })} />
        </label>
        <label>
          <span className='field-label'>负责人</span>
          <input type='text' value={flow.flow.owner ?? ''} onChange={e => updateMeta({ owner: e.target.value })} />
        </label>
        <label>
          <span className='field-label'>标签</span>
          <input type='text' value={(flow.flow.tags ?? []).join(', ')} onChange={e => updateMeta({ tags: splitList(e.target.value) })} />
        </label>
      </div>
    </details>
  </section>;
};

const RequiredLabel: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => <span className='field-label'><span className='required'>*</span>{children}</span>;

function splitLines(value: string) {
  return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function splitList(value: string) {
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

function formatTestData(testData: FlowTestDataItem[]) {
  return testData.map(item => `${item.key}=${item.value}`).join('\n');
}

function parseTestData(value: string): FlowTestDataItem[] {
  return value.split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const separatorIndex = line.indexOf('=');
        if (separatorIndex === -1)
          return { key: line, value: '', strategy: 'literal' };
        return {
          key: line.slice(0, separatorIndex).trim(),
          value: line.slice(separatorIndex + 1).trim(),
          strategy: 'literal',
        };
      });
}
