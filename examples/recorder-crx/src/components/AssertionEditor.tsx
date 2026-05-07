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
import { assertionLabel, assertionSubjectForType, assertionSubjectLabel, summarizeAssertion, summarizeTarget } from '../flow/display';
import type { FlowAssertion, FlowAssertionParams, FlowAssertionSubject, FlowAssertionType, FlowStep, FlowTarget } from '../flow/types';

const assertionSubjects: FlowAssertionSubject[] = ['page', 'element', 'table', 'toast', 'api', 'custom'];

const assertionTypesBySubject: Record<FlowAssertionSubject, FlowAssertionType[]> = {
  page: ['urlMatches'],
  element: ['visible', 'textContains', 'textEquals', 'valueEquals'],
  table: ['tableRowExists'],
  toast: ['toastContains'],
  api: ['apiStatus', 'apiRequestContains'],
  custom: ['custom'],
};

export type AssertionEditorSuggestion = {
  subject: FlowAssertionSubject;
  type: FlowAssertionType;
  label: string;
  tableArea?: string;
  rowKeyword?: string;
  columnName?: string;
  columnValue?: string;
  note?: string;
  candidates?: string[];
  apiMethod?: string;
  apiUrl?: string;
  apiStatus?: string;
  expected?: string;
};

export type AssertionPickedTarget = {
  stepId: string;
  subject: FlowAssertionSubject;
  selector: string;
  label: string;
  ariaSnapshot?: string;
  rowKeyword?: string;
};

export const AssertionEditor: React.FC<{
  step: FlowStep;
  isEditing: boolean;
  suggestion?: AssertionEditorSuggestion;
  pickedTarget?: AssertionPickedTarget;
  isPickingTarget?: boolean;
  onPickTarget: (subject: FlowAssertionSubject) => void;
  onBeginAddAssertion: () => void;
  onCancelAddAssertion: () => void;
  onSaveAssertion: (type: FlowAssertionType, patch: Partial<FlowAssertion>) => void;
  onChange: (assertions: FlowAssertion[]) => void;
  saveButtonLabel?: string;
}> = ({ step, isEditing, suggestion, pickedTarget, isPickingTarget, onPickTarget, onBeginAddAssertion, onCancelAddAssertion, onSaveAssertion, onChange, saveButtonLabel }) => {
  const tableInputRef = React.useRef<HTMLInputElement>(null);
  const [subject, setSubject] = React.useState<FlowAssertionSubject>('element');
  const [type, setType] = React.useState<FlowAssertionType>('visible');
  const [expected, setExpected] = React.useState('');
  const [note, setNote] = React.useState('');
  const [enabled, setEnabled] = React.useState(true);
  const [elementTarget, setElementTarget] = React.useState('');
  const [pageUrl, setPageUrl] = React.useState('');
  const [tableArea, setTableArea] = React.useState('');
  const [tableSelector, setTableSelector] = React.useState('');
  const [rowKeyword, setRowKeyword] = React.useState('');
  const [columnName, setColumnName] = React.useState('');
  const [columnValue, setColumnValue] = React.useState('');
  const [apiMethod, setApiMethod] = React.useState('POST');
  const [apiUrl, setApiUrl] = React.useState('');
  const [apiStatus, setApiStatus] = React.useState('200');
  const [requestContains, setRequestContains] = React.useState('');
  const [useColumnCondition, setUseColumnCondition] = React.useState(false);

  React.useEffect(() => {
    if (!isEditing)
      return;
    const suggested = step.assertions.find(assertion => !assertion.enabled);
    const nextType = suggested?.type ?? suggestion?.type ?? defaultAssertionType(step);
    const nextSubject = suggested?.subject ?? suggestion?.subject ?? assertionSubjectForType(nextType);
    const params = suggested?.params ?? {};
    setSubject(nextSubject);
    setType(assertionTypesBySubject[nextSubject].includes(nextType) ? nextType : assertionTypesBySubject[nextSubject][0]);
    setExpected(suggested?.expected ?? suggestion?.expected ?? defaultExpected(step));
    setNote(suggested?.note ?? suggestion?.note ?? '');
    setEnabled(true);
    setElementTarget(fieldValue(params.targetSummary) || summarizeTarget(suggested?.target ?? step.target));
    setPageUrl(fieldValue(params.url) || step.url || suggested?.expected || '');
    setTableArea(fieldValue(params.tableArea) || suggestion?.tableArea || '');
    setTableSelector(fieldValue(params.tableSelector));
    setRowKeyword(fieldValue(params.rowKeyword) || suggested?.expected || suggestion?.rowKeyword || '');
    setColumnName(fieldValue(params.columnName) || suggestion?.columnName || '');
    setColumnValue(fieldValue(params.columnValue) || suggestion?.columnValue || '');
    setUseColumnCondition(!!(fieldValue(params.columnName) || fieldValue(params.columnValue) || suggestion?.columnName || suggestion?.columnValue));
    setApiMethod(fieldValue(params.method) || suggestion?.apiMethod || 'POST');
    setApiUrl(fieldValue(params.url) || suggestion?.apiUrl || '');
    setApiStatus(fieldValue(params.status) || suggestion?.apiStatus || '200');
    setRequestContains(fieldValue(params.requestContains));
  }, [isEditing, step, suggestion]);

  React.useEffect(() => {
    if (!isEditing || !pickedTarget || pickedTarget.stepId !== step.id)
      return;
    if (pickedTarget.subject === 'table') {
      setSubject('table');
      setType('tableRowExists');
      setTableArea(pickedTarget.label);
      setTableSelector(pickedTarget.selector);
      if (pickedTarget.rowKeyword)
        setRowKeyword(pickedTarget.rowKeyword);
      return;
    }
    if (pickedTarget.subject === 'element') {
      setSubject('element');
      setElementTarget(pickedTarget.label);
      return;
    }
    setSubject(pickedTarget.subject);
  }, [isEditing, pickedTarget, step.id]);

  const removeAssertion = React.useCallback((assertionId: string) => {
    onChange(step.assertions.filter(assertion => assertion.id !== assertionId));
  }, [step.assertions, onChange]);

  const selectSubject = React.useCallback((nextSubject: FlowAssertionSubject) => {
    setSubject(nextSubject);
    setType(assertionTypesBySubject[nextSubject][0]);
  }, []);

  const applySuggestion = React.useCallback(() => {
    if (!suggestion)
      return;
    setSubject(suggestion.subject);
    setType(suggestion.type);
    setExpected(suggestion.expected ?? '');
    setNote(suggestion.note ?? '');
    setTableArea(suggestion.tableArea ?? tableArea);
    setTableSelector('');
    setRowKeyword(suggestion.rowKeyword ?? rowKeyword);
    setColumnName(suggestion.columnName ?? columnName);
    setColumnValue(suggestion.columnValue ?? columnValue);
    setUseColumnCondition(!!(suggestion.columnName || suggestion.columnValue));
    setApiMethod(suggestion.apiMethod ?? apiMethod);
    setApiUrl(suggestion.apiUrl ?? apiUrl);
    setApiStatus(suggestion.apiStatus ?? apiStatus);
  }, [apiMethod, apiStatus, apiUrl, columnName, columnValue, rowKeyword, suggestion, tableArea]);

  const useCurrentTable = React.useCallback(() => {
    setSubject('table');
    setType('tableRowExists');
    setTableArea(tableArea || suggestion?.tableArea || '当前表格/列表');
    setRowKeyword(rowKeyword || suggestion?.rowKeyword || '');
    if (!useColumnCondition && suggestion?.columnName)
      setUseColumnCondition(true);
    setColumnName(columnName || suggestion?.columnName || '名称');
    setColumnValue(columnValue || rowKeyword || suggestion?.columnValue || suggestion?.rowKeyword || '');
  }, [columnName, columnValue, rowKeyword, suggestion, tableArea, useColumnCondition]);

  const save = React.useCallback(() => {
    const { assertionExpected, params, target } = buildAssertionPatch({
      subject,
      type,
      expected,
      elementTarget,
      pageUrl,
      tableArea,
      tableSelector,
      rowKeyword,
      columnName,
      columnValue,
      apiMethod,
      apiUrl,
      apiStatus,
      requestContains,
      useColumnCondition,
      stepTarget: step.target,
    });
    onSaveAssertion(type, {
      subject,
      expected: assertionExpected,
      params,
      note,
      enabled,
      target,
    });
  }, [apiMethod, apiStatus, apiUrl, columnName, columnValue, elementTarget, enabled, expected, note, onSaveAssertion, pageUrl, requestContains, rowKeyword, step.target, subject, tableArea, tableSelector, type, useColumnCondition]);

  const enabledAssertions = step.assertions.filter(assertion => assertion.enabled);
  const suggestedAssertions = step.assertions.filter(assertion => !assertion.enabled);

  return <div className='assertion-editor'>
    <div className='assertion-heading'>断言（{enabledAssertions.length}）</div>
    <div className='assertion-chip-row'>
      {enabledAssertions.map(assertion => <span className='assertion-chip enabled' key={assertion.id}>
        <span className='chip-dot'>✓</span>
        {summarizeAssertion(assertion)}
        <button type='button' aria-label='删除断言' onClick={() => removeAssertion(assertion.id)}>×</button>
      </span>)}
      {suggestedAssertions.map(assertion => <span className='assertion-chip suggested' key={assertion.id}>
        建议 {summarizeAssertion(assertion)}
      </span>)}
      {!enabledAssertions.length && !suggestedAssertions.length && suggestion && <span className='assertion-chip suggested'>
        建议 {assertionSubjectLabel[suggestion.subject]}：{suggestion.label}
      </span>}
      <button className='add-assertion-button' type='button' onClick={onBeginAddAssertion}>+ 添加断言</button>
    </div>
    {!step.assertions.length && <div className='business-flow-empty'>这一步还没有断言。</div>}
    {isEditing && <div className='assertion-drawer'>
      <div className='assertion-drawer-title'>为 {step.id} 添加断言</div>
      <label>
        断言对象
        <div className='assertion-object-grid'>
          {assertionSubjects.map(assertionSubject => <button
            key={assertionSubject}
            className={assertionSubject === subject ? 'selected' : ''}
            type='button'
            onClick={() => selectSubject(assertionSubject)}
          >{assertionSubjectLabel[assertionSubject]}</button>)}
        </div>
      </label>
      <label>
        断言类型
        <select value={type} onChange={e => setType(e.target.value as FlowAssertionType)}>
          {assertionTypesBySubject[subject].map(assertionType => <option key={assertionType} value={assertionType}>{assertionLabel[assertionType]}</option>)}
        </select>
      </label>
      {subject === 'page' && <label>
        URL 期望
        <input type='text' value={pageUrl} onChange={e => setPageUrl(e.target.value)} placeholder='/site/edit/testSharedWan' />
      </label>}
      {subject === 'element' && <>
        <label>
          目标元素
          <input type='text' value={elementTarget} onChange={e => setElementTarget(e.target.value)} />
        </label>
        <label>
          预期值
          <input type='text' value={expected} onChange={e => setExpected(e.target.value)} />
        </label>
      </>}
      {subject === 'table' && <>
        {suggestion?.subject === 'table' && <div className='assertion-suggestion-card'>
          <div>
            <strong>推荐断言</strong>
            <span>在「{suggestion.tableArea || '当前表格/列表'}」中查找包含「{suggestion.rowKeyword || '关键字'}」的行</span>
          </div>
          <button type='button' onClick={applySuggestion}>使用建议</button>
        </div>}
        <label>
          表格/列表
          <div className='assertion-inline-control'>
            <input ref={tableInputRef} type='text' value={tableArea} onChange={e => setTableArea(e.target.value)} placeholder='共享 WAN 表格' />
            <button type='button' onClick={() => onPickTarget('table')}>{isPickingTarget ? '选择中...' : '重新选择'}</button>
          </div>
        </label>
        {isPickingTarget && <div className='picking-help'>
          已进入页面选择模式。点击页面中的表格后会自动回填；如果已高亮但没有回填，可以先用当前推荐值。
          <button type='button' onClick={useCurrentTable}>使用当前推荐值</button>
        </div>}
        <label>
          行关键字
          <input type='text' value={rowKeyword} onChange={e => setRowKeyword(e.target.value)} placeholder='WAN2' />
        </label>
        {!!suggestion?.candidates?.length && <div className='assertion-candidates'>
          <span>候选值</span>
          {suggestion.candidates.map(candidate => <button
            key={candidate}
            type='button'
            onClick={() => {
              setRowKeyword(candidate);
              if (useColumnCondition)
                setColumnValue(candidate);
            }}
          >{candidate}</button>)}
        </div>}
        <details className='assertion-advanced-match' open>
          <summary>高级匹配</summary>
          <label className='assertion-enabled'>
            <input type='checkbox' checked={useColumnCondition} onChange={e => setUseColumnCondition(e.target.checked)} />
            指定列条件
          </label>
          {useColumnCondition && <div className='assertion-field-row'>
            <label>
              列名
              <select value={columnName} onChange={e => setColumnName(e.target.value)}>
                <option value='名称'>名称</option>
                <option value='描述'>描述</option>
                <option value='状态'>状态</option>
                <option value='自定义'>自定义</option>
              </select>
            </label>
            <label>
              匹配值
              <input type='text' value={columnValue} onChange={e => setColumnValue(e.target.value)} placeholder='WAN2' />
            </label>
          </div>}
        </details>
      </>}
      {subject === 'toast' && <label>
        提示内容
        <input type='text' value={expected} onChange={e => setExpected(e.target.value)} placeholder='保存成功' />
      </label>}
      {subject === 'api' && <>
        <div className='assertion-field-row'>
          <label>
            方法
            <select value={apiMethod} onChange={e => setApiMethod(e.target.value)}>
              <option value='POST'>POST</option>
              <option value='PUT'>PUT</option>
              <option value='PATCH'>PATCH</option>
              <option value='DELETE'>DELETE</option>
              <option value='GET'>GET</option>
            </select>
          </label>
          <label>
            状态码
            <input type='text' value={apiStatus} onChange={e => setApiStatus(e.target.value)} placeholder='200' />
          </label>
        </div>
        <label>
          URL 包含
          <input type='text' value={apiUrl} onChange={e => setApiUrl(e.target.value)} placeholder='/api/site' />
        </label>
        {type === 'apiRequestContains' && <label>
          请求参数包含
          <input type='text' value={requestContains} onChange={e => setRequestContains(e.target.value)} placeholder='WAN2' />
        </label>}
      </>}
      {subject === 'custom' && <label>
        自定义说明
        <textarea rows={2} value={expected} onChange={e => setExpected(e.target.value)} />
      </label>}
      <label>
        备注
        <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} />
      </label>
      <label className='assertion-enabled'>
        <input type='checkbox' checked={enabled} onChange={e => setEnabled(e.target.checked)} />
        启用
      </label>
      <div className='assertion-drawer-actions'>
        <button type='button' className='primary assertion-save-button' onClick={save}>{saveButtonLabel ?? '保存断言'}</button>
        <button type='button' onClick={onCancelAddAssertion}>取消</button>
      </div>
    </div>}
  </div>;
};

function defaultAssertionType(step: FlowStep): FlowAssertionType {
  if (step.action === 'navigate')
    return 'urlMatches';
  if (step.action === 'fill')
    return 'valueEquals';
  if (step.action === 'click')
    return 'toastContains';
  return 'visible';
}

function defaultExpected(step: FlowStep) {
  if (step.action === 'navigate')
    return step.url ?? '';
  if (step.action === 'fill')
    return step.value ?? '';
  return '';
}

function fieldValue(value: unknown) {
  return value === undefined || value === null ? '' : String(value);
}

function trimValue(value: string) {
  return value.trim() || undefined;
}

function buildAssertionPatch(options: {
  subject: FlowAssertionSubject;
  type: FlowAssertionType;
  expected: string;
  elementTarget: string;
  pageUrl: string;
  tableArea: string;
  tableSelector: string;
  rowKeyword: string;
  columnName: string;
  columnValue: string;
  apiMethod: string;
  apiUrl: string;
  apiStatus: string;
  requestContains: string;
  useColumnCondition: boolean;
  stepTarget?: FlowTarget;
}): { assertionExpected?: string; params: FlowAssertionParams; target?: FlowTarget } {
  if (options.subject === 'page') {
    const url = trimValue(options.pageUrl);
    return {
      assertionExpected: url,
      params: { url },
    };
  }

  if (options.subject === 'element') {
    const targetSummary = trimValue(options.elementTarget);
    return {
      assertionExpected: trimValue(options.expected),
      params: { targetSummary },
      target: options.stepTarget ?? (targetSummary ? { label: targetSummary } : undefined),
    };
  }

  if (options.subject === 'table') {
    const tableArea = trimValue(options.tableArea);
    const tableSelector = trimValue(options.tableSelector);
    const rowKeyword = trimValue(options.rowKeyword);
    const columnName = options.useColumnCondition ? trimValue(options.columnName) : undefined;
    const columnValue = options.useColumnCondition ? trimValue(options.columnValue) : undefined;
    return {
      assertionExpected: rowKeyword,
      params: { tableArea, tableSelector, rowKeyword, columnName, columnValue },
      target: tableArea || rowKeyword ? { label: tableArea, text: rowKeyword } : undefined,
    };
  }

  if (options.subject === 'toast') {
    return {
      assertionExpected: trimValue(options.expected),
      params: { message: trimValue(options.expected) },
    };
  }

  if (options.subject === 'api') {
    const method = trimValue(options.apiMethod);
    const url = trimValue(options.apiUrl);
    const status = trimValue(options.apiStatus);
    const requestContains = trimValue(options.requestContains);
    return {
      assertionExpected: [method, url, options.type === 'apiRequestContains' ? requestContains : status].filter(Boolean).join(' ') || undefined,
      params: { method, url, status, requestContains },
    };
  }

  return {
    assertionExpected: trimValue(options.expected),
    params: { detail: trimValue(options.expected) },
  };
}
