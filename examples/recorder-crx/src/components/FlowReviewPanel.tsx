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
import { actionLabel, flowStats, summarizeStepSubject } from '../flow/display';
import { createRepeatSegment, repeatSegmentStats } from '../flow/repeatSegments';
import type { BusinessFlow, FlowRepeatSegment } from '../flow/types';
import { RepeatSegmentEditor } from './RepeatSegmentEditor';
import { ScrollJumpDock } from './ScrollJumpDock';

export const FlowReviewPanel: React.FC<{
  flow: BusinessFlow;
  redactionEnabled: boolean;
  onAddAssertion: (stepId: string) => void;
  onDeleteStep: (stepId: string) => void;
  onDeleteSteps: (stepIds: string[]) => void;
  onContinueRecording: () => void;
  onContinueRecordingFrom: (afterStepId: string) => void;
  onInsertEmptyStep: (afterStepId: string) => void;
  onInsertWaitStep: (afterStepId: string, milliseconds: number) => void;
  onSaveDraft: () => void;
  onSaveRecord: () => void;
  onClearSteps: () => void;
  onExportJson: () => void;
  onExportYaml: () => void;
  onSaveRepeatSegment: (segment: FlowRepeatSegment) => void;
  onDeleteRepeatSegment: (segmentId: string) => void;
}> = ({ flow, redactionEnabled, onAddAssertion, onDeleteStep, onDeleteSteps, onContinueRecording, onContinueRecordingFrom, onInsertEmptyStep, onInsertWaitStep, onSaveDraft, onSaveRecord, onClearSteps, onExportJson, onExportYaml, onSaveRepeatSegment, onDeleteRepeatSegment }) => {
  const stats = flowStats(flow);
  const repeatStats = repeatSegmentStats(flow);
  const [activeInsertStepId, setActiveInsertStepId] = React.useState<string>();
  const [editingRepeatSegment, setEditingRepeatSegment] = React.useState<FlowRepeatSegment>();
  const coveredRepeatStepIds = React.useMemo(() => new Set((flow.repeatSegments ?? []).flatMap(segment => segment.stepIds)), [flow.repeatSegments]);
  const visibleSteps = React.useMemo(() => flow.steps.filter(step => !coveredRepeatStepIds.has(step.id)), [coveredRepeatStepIds, flow.steps]);
  const [selectedRepeatStepIds, setSelectedRepeatStepIds] = React.useState<string[]>([]);
  const selectionState = React.useMemo(() => repeatSelectionState(visibleSteps, selectedRepeatStepIds), [selectedRepeatStepIds, visibleSteps]);
  const [dragSelectionAnchorId, setDragSelectionAnchorId] = React.useState<string>();

  React.useEffect(() => {
    setSelectedRepeatStepIds(stepIds => stepIds.filter(stepId => visibleSteps.some(step => step.id === stepId)));
  }, [visibleSteps]);

  React.useEffect(() => {
    if (!dragSelectionAnchorId)
      return;
    const stopDragging = () => setDragSelectionAnchorId(undefined);
    window.addEventListener('pointerup', stopDragging);
    return () => window.removeEventListener('pointerup', stopDragging);
  }, [dragSelectionAnchorId]);

  const insertFrom = React.useCallback((stepId: string) => {
    onContinueRecordingFrom(stepId);
    setActiveInsertStepId(undefined);
  }, [onContinueRecordingFrom]);

  const insertEmpty = React.useCallback((stepId: string) => {
    onInsertEmptyStep(stepId);
    setActiveInsertStepId(undefined);
  }, [onInsertEmptyStep]);

  const insertWait = React.useCallback((stepId: string) => {
    const secondsText = window.prompt('等待几秒后继续执行？', '2');
    if (secondsText === null)
      return;
    const seconds = Number(secondsText);
    if (!Number.isFinite(seconds) || seconds < 0) {
      window.alert('请输入大于等于 0 的秒数。');
      return;
    }
    onInsertWaitStep(stepId, Math.round(seconds * 1000));
    setActiveInsertStepId(undefined);
  }, [onInsertWaitStep]);

  const toggleRepeatStep = React.useCallback((stepId: string) => {
    setSelectedRepeatStepIds(stepIds => {
      const next = stepIds.includes(stepId) ? stepIds.filter(id => id !== stepId) : [...stepIds, stepId];
      return sortStepIdsByVisibleOrder(visibleSteps, next);
    });
  }, [visibleSteps]);

  const beginDragSelect = React.useCallback((event: React.PointerEvent, stepId: string) => {
    if (isInteractiveTarget(event.target))
      return;
    setDragSelectionAnchorId(stepId);
    setSelectedRepeatStepIds([stepId]);
  }, []);

  const extendDragSelect = React.useCallback((stepId: string) => {
    if (!dragSelectionAnchorId)
      return;
    setSelectedRepeatStepIds(stepRangeIds(visibleSteps, dragSelectionAnchorId, stepId));
  }, [dragSelectionAnchorId, visibleSteps]);

  const deleteSelectedSteps = React.useCallback(() => {
    if (!selectedRepeatStepIds.length)
      return;
    if (!window.confirm(`删除选中的 ${selectedRepeatStepIds.length} 个步骤？删除后会同时移除这些步骤的断言和循环引用。`))
      return;
    onDeleteSteps(selectedRepeatStepIds);
    setSelectedRepeatStepIds([]);
  }, [onDeleteSteps, selectedRepeatStepIds]);

  if (editingRepeatSegment) {
    return <RepeatSegmentEditor
      flow={flow}
      segment={editingRepeatSegment}
      onCancel={() => setEditingRepeatSegment(undefined)}
      onSave={segment => {
        onSaveRepeatSegment(segment);
        setEditingRepeatSegment(undefined);
      }}
    />;
  }

  return <div className='review-panel'>
    <ScrollJumpDock />
    <div className='review-toolbar'>
      <button type='button' className='primary' onClick={onContinueRecording}>继续录制</button>
      <button type='button' onClick={onSaveDraft}>保存为草稿</button>
      <button type='button' className='save-record' onClick={onSaveRecord}>保存记录</button>
      <button type='button' className='danger-outline' onClick={onClearSteps}>清空步骤</button>
      <span>继续录制会接在当前步骤后；也可以在步骤之间插入操作。</span>
    </div>
    <div className='review-summary-grid'>
      <div><strong>{repeatStats.segmentCount ? repeatStats.rowCount : stats.stepCount}</strong><span>{repeatStats.segmentCount ? '循环次数' : '步骤'}</span></div>
      <div><strong>{repeatStats.segmentCount ? repeatStats.expandedStepCount : stats.assertionCount}</strong><span>{repeatStats.segmentCount ? '展开步骤' : '断言'}</span></div>
      <div className={stats.missingAssertionCount && !repeatStats.segmentCount ? 'warning' : ''}><strong>{repeatStats.segmentCount ? repeatStats.parameterCount : stats.missingAssertionCount}</strong><span>{repeatStats.segmentCount ? '参数' : '缺少断言'}</span></div>
      <div className='ok'><strong>{redactionEnabled ? '开启' : '关闭'}</strong><span>{repeatStats.segmentCount ? '模板断言' : '敏感数据脱敏'}</span></div>
    </div>
    {!repeatStats.segmentCount && visibleSteps.length > 1 && <div className={selectionState.canCreate ? 'repeat-create-banner ready' : 'repeat-create-banner'}>
      <div>
        <strong>{selectionState.selectedCount ? `已选择 ${selectionState.selectedCount} 个步骤` : '选择要循环的步骤'}</strong>
        <span>{selectionState.message}</span>
      </div>
      <div className='repeat-create-actions'>
        <button type='button' onClick={() => setSelectedRepeatStepIds(visibleSteps.map(step => step.id))}>选择全部</button>
        <button type='button' onClick={() => setSelectedRepeatStepIds([])}>清空</button>
        <button type='button' className='danger-outline' disabled={!selectionState.selectedCount} onClick={deleteSelectedSteps}>删除选中</button>
        <button type='button' className='primary' disabled={!selectionState.canCreate} onClick={() => setEditingRepeatSegment(createRepeatSegment(flow, selectedRepeatStepIds))}>设为循环片段</button>
      </div>
    </div>}
    {stats.missingAssertionCount > 0 && <div className='review-warning'>
      {stats.missingAssertionCount} 个步骤没有启用断言
    </div>}
    <div className='section-heading row'>
      <span>步骤检查</span>
      <span className='review-inline-note'>可逐条补断言</span>
    </div>
    <div className='review-step-list'>
      {(flow.repeatSegments ?? []).map(segment => <RepeatSegmentCard
        key={segment.id}
        flow={flow}
        segment={segment}
        onEdit={() => setEditingRepeatSegment(segment)}
        onDelete={() => onDeleteRepeatSegment(segment.id)}
      />)}
      {visibleSteps.map((step, index) => {
        const assertionCount = step.assertions.filter(assertion => assertion.enabled).length;
        const selectedForRepeat = selectedRepeatStepIds.includes(step.id);
        const adaptiveTarget = flow.artifacts?.recorder?.adaptiveTargets?.[`step:${step.id}`];
        return <React.Fragment key={step.id}>
          <div
            className={selectedForRepeat ? 'review-step-row selected-for-repeat' : 'review-step-row'}
            onPointerDown={event => beginDragSelect(event, step.id)}
            onPointerEnter={() => extendDragSelect(step.id)}
          >
            <button type='button' className={selectedForRepeat ? 'repeat-step-selector selected' : 'repeat-step-selector'} onClick={() => toggleRepeatStep(step.id)} aria-label={`选择 ${step.id} 作为循环步骤`}>
              <span></span>
            </button>
            <span className='review-step-index'>{step.order}</span>
            <span className='review-step-id'>{step.id}</span>
            <span className='review-step-main'>
              <strong>{actionLabel[step.action]}</strong>
              <span>{summarizeStepSubject(step)}</span>
            </span>
            <span className='review-step-actions'>
              {assertionCount > 0 ? <span className='review-badge ok'>{assertionCount} 个断言</span> : <button className='review-badge warning' type='button' onClick={() => onAddAssertion(step.id)}>添加断言</button>}
              <button className='review-delete-button' type='button' onClick={() => {
                if (window.confirm(`删除 ${step.id}？删除后会同时移除该步骤的断言。`))
                  onDeleteStep(step.id);
              }}>删除</button>
            </span>
            {adaptiveTarget?.locatorCandidates?.length ? <div className='review-adaptive-target' aria-label={`${step.id} 定位候选`}>
              <strong>定位候选</strong>
              {adaptiveTarget.locatorCandidates.slice(0, 3).map(candidate => <span key={`${candidate.kind}:${candidate.value}`} className='review-adaptive-candidate'>
                {candidate.kind} · {candidate.score} · {candidate.scope ?? 'page'}
              </span>)}
              <span className='review-inline-note'>{adaptiveTarget.locatorCandidates[0]?.reason}</span>
            </div> : null}
          </div>
          {index < visibleSteps.length - 1 && <div className={activeInsertStepId === step.id ? 'review-insert-slot active' : 'review-insert-slot'}>
            <button type='button' onClick={() => setActiveInsertStepId(activeInsertStepId === step.id ? undefined : step.id)}>
              <span>+</span> 在这里插入操作
            </button>
            {activeInsertStepId === step.id && <div className='review-insert-popover'>
              <div>在当前位置与下一步之间插入新操作</div>
              <div className='review-insert-actions'>
                <button type='button' className='primary' onClick={() => insertFrom(step.id)}>从这里继续录制</button>
                <button type='button' onClick={() => insertWait(step.id)}>插入等待</button>
                <button type='button' onClick={() => insertEmpty(step.id)}>插入空步骤</button>
              </div>
            </div>}
          </div>}
        </React.Fragment>;
      })}
    </div>
    <div className='review-export'>
      <div className='section-heading'>导出</div>
      <div className='review-export-actions'>
        <button type='button' onClick={onExportJson}>导出流程 JSON</button>
        <button type='button' onClick={onExportYaml}>导出紧凑 YAML</button>
      </div>
      <div className='review-ready'>{stats.missingAssertionCount ? '已准备导出。建议先补齐缺少断言的步骤。' : '已准备导出。所有步骤已捕获，建议复查后导出。'}</div>
    </div>
  </div>;
};

function repeatSelectionState(steps: BusinessFlow['steps'], selectedStepIds: string[]) {
  if (!selectedStepIds.length) {
    return {
      selectedCount: 0,
      canCreate: false,
      message: '勾选一段连续步骤后，可创建为循环片段。',
    };
  }
  if (selectedStepIds.length < 2) {
    return {
      selectedCount: selectedStepIds.length,
      canCreate: false,
      message: '至少选择 2 个连续步骤，才能形成可重复执行的片段。',
    };
  }
  const selectedIndexes = selectedStepIds
      .map(stepId => steps.findIndex(step => step.id === stepId))
      .filter(index => index >= 0)
      .sort((a, b) => a - b);
  const continuous = selectedIndexes.every((index, position) => position === 0 || index === selectedIndexes[position - 1] + 1);
  return {
    selectedCount: selectedStepIds.length,
    canCreate: continuous,
    message: continuous ? '可创建为循环片段，用数据表批量替换输入参数。' : '当前选择不连续，请选择同一段相邻步骤。',
  };
}

function sortStepIdsByVisibleOrder(steps: BusinessFlow['steps'], stepIds: string[]) {
  return [...stepIds].sort((left, right) => steps.findIndex(step => step.id === left) - steps.findIndex(step => step.id === right));
}

function stepRangeIds(steps: BusinessFlow['steps'], startStepId: string, endStepId: string) {
  const start = steps.findIndex(step => step.id === startStepId);
  const end = steps.findIndex(step => step.id === endStepId);
  if (start < 0 || end < 0)
    return [];
  const [from, to] = start <= end ? [start, end] : [end, start];
  return steps.slice(from, to + 1).map(step => step.id);
}

function isInteractiveTarget(target: EventTarget) {
  return target instanceof Element && !!target.closest('button, input, textarea, select, a, [role="button"]');
}

const RepeatSegmentCard: React.FC<{
  flow: BusinessFlow;
  segment: FlowRepeatSegment;
  onEdit: () => void;
  onDelete: () => void;
}> = ({ flow, segment, onEdit, onDelete }) => {
  const [expanded, setExpanded] = React.useState(false);
  const enabledParameters = segment.parameters.filter(parameter => parameter.enabled);
  const firstRow = segment.rows[0];
  const range = repeatSegmentRange(flow, segment);
  return <div className='repeat-segment-card'>
    <div className='review-step-index repeat'>1</div>
    <div className='repeat-card-main'>
      <div className='repeat-card-title'>
        <strong>循环 x{Math.max(segment.rows.length, 1)}：{segment.name}</strong>
        <span>{range}</span>
      </div>
      <div className='repeat-card-meta'>
        <span>参数：{enabledParameters.map(parameter => parameter.variableName).join('、') || '--'}</span>
        <span>数据：{segment.rows.length} 行</span>
      </div>
      {firstRow && <div className='repeat-card-preview'>
        {enabledParameters.slice(0, 4).map(parameter => <span key={parameter.id}>
          <em>{parameter.label}</em>{firstRow.values[parameter.id] || '--'}
        </span>)}
      </div>}
      {segment.assertionTemplate && <div className='repeat-template-assertion'>
        <strong>断言（模板级）</strong>
        <span>{segment.assertionTemplate.description}</span>
      </div>}
      {expanded && <div className='repeat-expanded-steps'>
        {segment.stepIds.map(stepId => <span key={stepId}>{stepId}</span>)}
      </div>}
    </div>
    <div className='repeat-card-actions'>
      <button type='button' onClick={onEdit}>编辑数据</button>
      <button type='button' onClick={() => setExpanded(value => !value)}>{expanded ? '收起步骤' : '展开步骤'}</button>
      <button type='button' className='danger' onClick={onDelete}>删除循环</button>
    </div>
  </div>;
};

function repeatSegmentRange(flow: BusinessFlow, segment: FlowRepeatSegment) {
  const steps = segment.stepIds
      .map(stepId => flow.steps.find(step => step.id === stepId))
      .filter((step): step is BusinessFlow['steps'][number] => !!step)
      .sort((left, right) => left.order - right.order);
  if (!steps.length)
    return '包含步骤：--';
  const first = steps[0];
  const last = steps[steps.length - 1];
  return `包含步骤：#${first.order} ${first.id}${first.id === last.id ? '' : ` - #${last.order} ${last.id}`}`;
}
