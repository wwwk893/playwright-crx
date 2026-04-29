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
import type { BusinessFlow, FlowRepeatRow, FlowRepeatSegment } from '../flow/types';

type EditorPhase = 'mapping' | 'data';

export const RepeatSegmentEditor: React.FC<{
  flow?: BusinessFlow;
  segment: FlowRepeatSegment;
  onCancel: () => void;
  onSave: (segment: FlowRepeatSegment) => void;
}> = ({ flow, segment, onCancel, onSave }) => {
  const [draft, setDraft] = React.useState(segment);
  const [phase, setPhase] = React.useState<EditorPhase>(segment.rows.length > 1 ? 'data' : 'mapping');
  const [selectedRows, setSelectedRows] = React.useState<Set<string>>(() => new Set());

  const enabledParameters = draft.parameters.filter(parameter => parameter.enabled);

  const updateDraft = React.useCallback((patch: Partial<FlowRepeatSegment>) => {
    setDraft(current => ({ ...current, ...patch, updatedAt: new Date().toISOString() }));
  }, []);

  const updateParameter = React.useCallback((parameterId: string, patch: Partial<FlowRepeatSegment['parameters'][number]>) => {
    setDraft(current => ({
      ...current,
      parameters: current.parameters.map(parameter => parameter.id === parameterId ? { ...parameter, ...patch } : parameter),
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const updateCell = React.useCallback((rowId: string, parameterId: string, value: string) => {
    setDraft(current => ({
      ...current,
      rows: current.rows.map(row => row.id === rowId ? { ...row, values: { ...row.values, [parameterId]: value } } : row),
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const addRow = React.useCallback(() => {
    setDraft(current => ({
      ...current,
      rows: [...current.rows, { id: `row-${Date.now()}`, values: Object.fromEntries(current.parameters.map(parameter => [parameter.id, ''])) }],
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const deleteSelectedRows = React.useCallback(() => {
    if (!selectedRows.size)
      return;
    setDraft(current => ({
      ...current,
      rows: current.rows.filter(row => !selectedRows.has(row.id)),
      updatedAt: new Date().toISOString(),
    }));
    setSelectedRows(new Set());
  }, [selectedRows]);

  const pasteCsv = React.useCallback(() => {
    const text = window.prompt('粘贴 CSV 数据，每行按当前参数列顺序填写。');
    if (!text)
      return;
    const rows = text.split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map((line, index): FlowRepeatRow => {
          const values = line.split(',').map(cell => cell.trim());
          return {
            id: `row-${Date.now()}-${index}`,
            values: Object.fromEntries(enabledParameters.map((parameter, parameterIndex) => [parameter.id, values[parameterIndex] ?? ''])),
          };
        });
    if (rows.length)
      setDraft(current => ({ ...current, rows, updatedAt: new Date().toISOString() }));
  }, [enabledParameters]);

  const save = React.useCallback(() => {
    const normalizedRows = draft.rows.length ? draft.rows : [{ id: `row-${Date.now()}`, values: {} }];
    onSave({
      ...draft,
      rows: normalizedRows,
      parameters: draft.parameters.map(parameter => ({ ...parameter, variableName: parameter.variableName.trim() || parameter.id })),
      updatedAt: new Date().toISOString(),
    });
  }, [draft, onSave]);

  return <div className='repeat-editor'>
    <div className='repeat-editor-head'>
      <button type='button' className='back-to-library' onClick={onCancel}>← 返回业务流程</button>
      <h2>{phase === 'mapping' ? '创建循环片段' : `循环片段：${draft.name || '未命名片段'}`}</h2>
      <p>{phase === 'mapping' ? '将选中的步骤生成可循环执行的片段' : `${draft.stepIds.length} 个步骤 · ${enabledParameters.length} 个参数 · ${draft.rows.length} 行数据`}</p>
    </div>

    <div className='repeat-tabs'>
      <button type='button' className={phase === 'mapping' ? 'selected' : ''} onClick={() => setPhase('mapping')}>参数映射</button>
      <button type='button' className={phase === 'data' ? 'selected' : ''} onClick={() => setPhase('data')}>数据表</button>
    </div>

    {phase === 'mapping' ? <div className='repeat-mapping'>
      <label>
        <span>片段名称</span>
        <input value={draft.name} onChange={e => updateDraft({ name: e.target.value })} />
      </label>
      <label>
        <span>重复步骤范围</span>
        <input value={stepRangeLabel(flow, draft)} readOnly />
      </label>
      <div className='repeat-info'>这些参数会替换录制时输入的固定值，运行时按数据表逐行执行。</div>
      <div className='repeat-param-table'>
        <div className='repeat-param-head'>
          <span>参数名称</span>
          <span>来源步骤</span>
          <span>当前值</span>
          <span>变量名</span>
          <span>启用</span>
        </div>
        {draft.parameters.map(parameter => <div className='repeat-param-row' key={parameter.id}>
          <span>{parameter.label}</span>
          <span>{parameter.sourceStepId}</span>
          <span>{parameter.currentValue || '--'}</span>
          <input value={parameter.variableName} onChange={e => updateParameter(parameter.id, { variableName: e.target.value })} />
          <input type='checkbox' checked={parameter.enabled} onChange={e => updateParameter(parameter.id, { enabled: e.target.checked })} aria-label='启用参数' />
        </div>)}
        {!draft.parameters.length && <div className='repeat-empty'>没有识别到可参数化的填写或选择步骤，可以先回到流程继续录制输入动作。</div>}
      </div>
      <div className='repeat-editor-actions'>
        <button type='button' onClick={onCancel}>取消</button>
        <button type='button' className='primary' onClick={() => setPhase('data')}>生成数据表</button>
      </div>
    </div> : <div className='repeat-data'>
      <div className='repeat-success'>录制时只创建一次，运行时按数据表循环执行。</div>
      <div className='repeat-data-toolbar'>
        <button type='button' onClick={addRow}>+ 添加一行</button>
        <button type='button' onClick={pasteCsv}>从 CSV 粘贴</button>
        <button type='button' className='danger-outline' disabled={!selectedRows.size} onClick={deleteSelectedRows}>删除选中行</button>
      </div>
      <div className='repeat-data-table'>
        <table>
          <thead>
            <tr>
              <th></th>
              <th>序号</th>
              {enabledParameters.map(parameter => <th key={parameter.id}>
                {parameter.label}
                <span>参数 {parameter.variableName}</span>
              </th>)}
            </tr>
          </thead>
          <tbody>
            {draft.rows.map((row, index) => <tr key={row.id}>
              <td><input type='checkbox' checked={selectedRows.has(row.id)} onChange={e => {
                setSelectedRows(current => {
                  const next = new Set(current);
                  e.target.checked ? next.add(row.id) : next.delete(row.id);
                  return next;
                });
              }} /></td>
              <td>{index + 1}</td>
              {enabledParameters.map(parameter => <td key={parameter.id}>
                <input value={row.values[parameter.id] ?? ''} onChange={e => updateCell(row.id, parameter.id, e.target.value)} />
              </td>)}
            </tr>)}
          </tbody>
        </table>
      </div>
      <div className='repeat-editor-actions sticky'>
        <button type='button' onClick={() => setPhase('mapping')}>返回上一步</button>
        <button type='button' className='primary' onClick={save}>保存片段</button>
      </div>
    </div>}
  </div>;
};

function stepRangeLabel(flow: BusinessFlow | undefined, segment: FlowRepeatSegment) {
  if (!flow)
    return `${segment.stepIds[0] ?? '--'} - ${segment.stepIds[segment.stepIds.length - 1] ?? '--'}`;
  const steps = segment.stepIds
      .map(stepId => flow.steps.find(step => step.id === stepId))
      .filter((step): step is BusinessFlow['steps'][number] => !!step)
      .sort((left, right) => left.order - right.order);
  if (!steps.length)
    return '--';
  const first = steps[0];
  const last = steps[steps.length - 1];
  return `#${first.order} ${first.id}${first.id === last.id ? '' : ` - #${last.order} ${last.id}`}`;
}
