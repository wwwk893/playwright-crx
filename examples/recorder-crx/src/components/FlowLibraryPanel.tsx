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
import { GlobalAiIntentCard } from './GlobalAiIntentCard';
import type { AiIntentSettings, AiProviderProfile, AiUsageRecord } from '../aiIntent/types';
import { flowStats } from '../flow/display';
import type { BusinessFlow } from '../flow/types';

type FlowLibraryFilter = 'all' | 'draft' | 'done' | 'high';

export const FlowLibraryPanel: React.FC<{
  records: BusinessFlow[];
  selectedRecordId?: string;
  draftStatus: string;
  onNewFlow: () => void;
  onOpenRecord: (flow: BusinessFlow) => void;
  onEditRecord: (flow: BusinessFlow) => void;
  onDuplicateRecord: (flow: BusinessFlow) => void;
  onDeleteRecord: (flow: BusinessFlow) => void;
  onRestoreRecord: (flow: BusinessFlow) => void;
  onRestoreLatestDraft: () => void;
  onImportJson: (file: File) => void;
  onExportAll: () => void;
  aiSettings: AiIntentSettings;
  aiProfiles: AiProviderProfile[];
  activeAiProfile?: AiProviderProfile;
  aiUsageRecords: AiUsageRecord[];
  onAiSettingsChange: (settings: AiIntentSettings) => void;
  onOpenAiSettings: () => void;
  onOpenAiUsage: () => void;
}> = ({
  records,
  selectedRecordId,
  draftStatus,
  onNewFlow,
  onOpenRecord,
  onEditRecord,
  onDuplicateRecord,
  onDeleteRecord,
  onRestoreRecord,
  onRestoreLatestDraft,
  onImportJson,
  onExportAll,
  aiSettings,
  aiProfiles,
  activeAiProfile,
  aiUsageRecords,
  onAiSettingsChange,
  onOpenAiSettings,
  onOpenAiUsage,
}) => {
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<FlowLibraryFilter>('all');
  const [deletingFlow, setDeletingFlow] = React.useState<BusinessFlow>();
  const [deleteConfirmed, setDeleteConfirmed] = React.useState(false);
  const [lastDeletedFlow, setLastDeletedFlow] = React.useState<BusinessFlow>();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const filteredRecords = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return records.filter(flow => {
      if (!matchesFilter(flow, filter))
        return false;
      if (!normalizedQuery)
        return true;
      const haystack = [
        flow.flow.name,
        flow.flow.app,
        flow.flow.repo,
        flow.flow.module,
        flow.flow.page,
        flow.flow.role,
        flow.flow.priority,
        ...(flow.flow.tags ?? []),
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [filter, query, records]);

  return <div className='flow-library'>
    <div className='library-heading'>
      <div>
        <h2>业务流程记录</h2>
        <span>共 {records.length} 条记录</span>
      </div>
      <div className='library-heading-actions'>
        <button type='button' className='primary' onClick={onNewFlow}>+ 新建流程</button>
        <button type='button' onClick={() => fileInputRef.current?.click()}>导入 JSON</button>
        <input
          ref={fileInputRef}
          hidden
          type='file'
          accept='.json,application/json'
          onChange={e => {
            const file = e.target.files?.[0];
            if (file)
              onImportJson(file);
            e.currentTarget.value = '';
          }}
        />
      </div>
    </div>

    <input
      className='library-search'
      type='search'
      value={query}
      placeholder='搜索流程名称 / 模块 / 标签'
      onChange={e => setQuery(e.target.value)}
    />

    <div className='library-filters'>
      <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>全部</FilterButton>
      <FilterButton active={filter === 'draft'} onClick={() => setFilter('draft')}>草稿</FilterButton>
      <FilterButton active={filter === 'done'} onClick={() => setFilter('done')}>已完成</FilterButton>
      <FilterButton active={filter === 'high'} onClick={() => setFilter('high')}>高优先级</FilterButton>
      <button type='button' className='filter-menu'>筛选</button>
    </div>

    <GlobalAiIntentCard
      settings={aiSettings}
      profiles={aiProfiles}
      activeProfile={activeAiProfile}
      records={aiUsageRecords}
      onSettingsChange={onAiSettingsChange}
      onOpenSettings={onOpenAiSettings}
      onOpenUsage={onOpenAiUsage}
    />

    <div className='library-card-list'>
      {filteredRecords.length === 0 && <div className='business-flow-empty library-empty'>
        暂无匹配的业务流程记录。可以新建流程，或从 JSON 导入已有记录。
      </div>}
      {filteredRecords.map(flow => <FlowRecordCard
        key={flow.flow.id}
        flow={flow}
        selected={flow.flow.id === selectedRecordId}
        onOpen={() => onOpenRecord(flow)}
        onEdit={() => onEditRecord(flow)}
        onDuplicate={() => onDuplicateRecord(flow)}
        onDelete={() => {
          setDeletingFlow(flow);
          setDeleteConfirmed(false);
        }}
      />)}
    </div>

    <div className='library-footer'>
      <div className='library-save-state'><span></span>{draftStatus || '最近草稿已保存'}</div>
      <button type='button' onClick={onRestoreLatestDraft}>恢复最近草稿</button>
      <button type='button' onClick={onExportAll}>导出全部</button>
    </div>

    {deletingFlow && <div className='library-modal-backdrop'>
      <div className='delete-record-modal'>
        <button type='button' className='modal-close' onClick={() => setDeletingFlow(undefined)}>x</button>
        <div className='modal-warning-icon'>!</div>
        <h3>删除业务流程记录？</h3>
        <h4>{deletingFlow.flow.name || '未命名业务流程'}</h4>
        <p>删除后将移除该流程的元数据、步骤、断言和草稿，已导出的 JSON/YAML 文件不会受影响。</p>
        <label className='delete-confirm-check'>
          <input type='checkbox' checked={deleteConfirmed} onChange={e => setDeleteConfirmed(e.target.checked)} />
          我确认删除这个业务流程记录
        </label>
        <div className='modal-actions'>
          <button type='button' onClick={() => setDeletingFlow(undefined)}>取消</button>
          <button
            type='button'
            className='danger'
            disabled={!deleteConfirmed}
            onClick={() => {
              onDeleteRecord(deletingFlow);
              setLastDeletedFlow(deletingFlow);
              setDeletingFlow(undefined);
            }}
          >删除记录</button>
        </div>
      </div>
    </div>}

    {lastDeletedFlow && <div className='library-toast'>
      <span></span>
      已删除：{lastDeletedFlow.flow.name || '未命名业务流程'}
      <button type='button' onClick={() => {
        onRestoreRecord(lastDeletedFlow);
        setLastDeletedFlow(undefined);
      }}>撤销</button>
      <button type='button' onClick={() => setLastDeletedFlow(undefined)}>x</button>
    </div>}
  </div>;
};

const FilterButton: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => <button type='button' className={active ? 'selected' : ''} onClick={onClick}>{children}</button>;

const FlowRecordCard: React.FC<{
  flow: BusinessFlow;
  selected: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}> = ({ flow, selected, onOpen, onEdit, onDuplicate, onDelete }) => {
  const stats = flowStats(flow);
  const done = stats.stepCount > 0 && stats.missingAssertionCount === 0;
  const highPriority = flow.flow.priority === 'P0' || flow.flow.priority === 'P1';

  return <article className={selected ? 'library-card selected' : 'library-card'}>
    <div className='library-card-title'>
      <div>
        <h3>{flow.flow.name || '未命名业务流程'}</h3>
        {highPriority && <span className='priority-badge'>高优先级</span>}
      </div>
      <span className={done ? 'status-badge done' : 'status-badge draft'}>{done ? '已完成' : '草稿'}</span>
    </div>
    <div className='library-card-meta'>
      <Meta label='应用' value={flow.flow.app} />
      <Meta label='模块' value={flow.flow.module} />
      <Meta label='仓库' value={flow.flow.repo} />
      <Meta label='角色' value={flow.flow.role} />
      <Meta label='步骤' value={String(stats.stepCount)} />
      <Meta label='断言' value={String(stats.assertionCount)} />
      <Meta label='更新于' value={formatDateTime(flow.updatedAt)} />
      <Meta label='标签' value={<TagList tags={flow.flow.tags} />} />
    </div>
    <div className='library-card-actions'>
      <button type='button' onClick={onOpen}>打开</button>
      <button type='button' onClick={onEdit}>编辑</button>
      <button type='button' onClick={onDuplicate}>复制</button>
      <button type='button' className='danger' onClick={onDelete}>删除</button>
    </div>
  </article>;
};

const Meta: React.FC<{
  label: string;
  value?: React.ReactNode;
}> = ({ label, value }) => <div className='library-meta-row'>
  <span>{label}</span>
  <strong>{value || '--'}</strong>
</div>;

const TagList: React.FC<{
  tags?: string[];
}> = ({ tags }) => {
  if (!tags?.length)
    return <>--</>;
  return <span className='library-tags'>{tags.slice(0, 2).map(tag => <em key={tag}>{tag}</em>)}</span>;
};

function matchesFilter(flow: BusinessFlow, filter: FlowLibraryFilter) {
  const stats = flowStats(flow);
  if (filter === 'draft')
    return stats.stepCount === 0 || stats.missingAssertionCount > 0;
  if (filter === 'done')
    return stats.stepCount > 0 && stats.missingAssertionCount === 0;
  if (filter === 'high')
    return flow.flow.priority === 'P0' || flow.flow.priority === 'P1';
  return true;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    return value;
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}
