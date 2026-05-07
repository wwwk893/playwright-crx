/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import React from 'react';
import type { AiIntentSettings } from '../aiIntent/types';
import type { BusinessFlow, FlowMeta } from '../flow/types';

export type FlowFormSheetMode = 'new' | 'edit';
export type FlowFormSheetAction = 'saveDraft' | 'saveAndStart' | 'saveChanges';

export const FlowFormSheet: React.FC<{
  mode: FlowFormSheetMode;
  flow: BusinessFlow;
  globalAiMode: AiIntentSettings['mode'];
  onClose: () => void;
  onSubmit: (flow: BusinessFlow, action: FlowFormSheetAction) => Promise<void> | void;
}> = ({ mode, flow, globalAiMode, onClose, onSubmit }) => {
  const [draft, setDraft] = React.useState<BusinessFlow>(() => cloneFlow(flow));
  const [savingAction, setSavingAction] = React.useState<FlowFormSheetAction>();

  React.useEffect(() => {
    setDraft(cloneFlow(flow));
    setSavingAction(undefined);
  }, [flow, mode]);

  const updateMeta = React.useCallback((patch: Partial<FlowMeta>) => {
    setDraft(current => ({
      ...current,
      flow: {
        ...current.flow,
        ...patch,
      },
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const updateUrl = React.useCallback((url: string) => {
    setDraft(current => ({
      ...current,
      env: {
        ...current.env,
        url: url || undefined,
      },
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const updateAiOverride = React.useCallback((override: 'inherit' | 'enabled' | 'disabled') => {
    setDraft(current => ({
      ...current,
      artifacts: {
        ...current.artifacts,
        aiIntent: {
          ...current.artifacts?.aiIntent,
          override,
        },
      },
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const submit = React.useCallback((action: FlowFormSheetAction) => {
    setSavingAction(action);
    Promise.resolve(onSubmit(touchFlow(draft), action))
        .catch(error => {
          window.alert(error instanceof Error ? error.message : String(error));
        })
        .finally(() => setSavingAction(undefined));
  }, [draft, onSubmit]);

  const title = mode === 'new' ? '新建流程' : `编辑流程：${flow.flow.name || '未命名业务流程'}`;
  const canSubmit = !!draft.flow.name.trim() && !savingAction;
  const aiOverride = draft.artifacts?.aiIntent?.override ?? 'inherit';

  return <div className='sheet-backdrop' role='presentation' onMouseDown={event => {
    if (event.target === event.currentTarget)
      onClose();
  }}>
    <section className='flow-form-sheet sheet-surface' role='dialog' aria-modal='true' aria-label={title}>
      <header className='sheet-header'>
        <div>
          <h2>{title}</h2>
          <p>{mode === 'new' ? '填写流程上下文后，可保存为草稿或立即进入录制。' : '修改会更新当前流程草稿和流程库记录。'}</p>
        </div>
        <button type='button' className='sheet-close' onClick={onClose} aria-label='关闭'>×</button>
      </header>

      <div className='sheet-body'>
        <label className='flow-form-field full'>
          <span><span className='required'>*</span>流程名称</span>
          <input autoFocus required type='text' value={draft.flow.name} placeholder='例如：站点配置 / 新增共享 WAN' onChange={event => updateMeta({ name: event.target.value })} />
        </label>

        <div className='flow-sheet-two-col'>
          <label className='flow-form-field'>
            <span>应用 / 模块 · 应用</span>
            <input type='text' value={draft.flow.app ?? ''} placeholder='控制台 / Portal' onChange={event => updateMeta({ app: event.target.value || undefined })} />
          </label>
          <label className='flow-form-field'>
            <span>应用 / 模块 · 模块</span>
            <input type='text' value={draft.flow.module ?? ''} placeholder='站点配置' onChange={event => updateMeta({ module: event.target.value || undefined })} />
          </label>
        </div>

        <div className='flow-sheet-two-col'>
          <label className='flow-form-field'>
            <span>起始 URL / 页面 · URL</span>
            <input type='text' value={draft.env.url ?? ''} placeholder='https://staging.example.com/site' onChange={event => updateUrl(event.target.value)} />
          </label>
          <label className='flow-form-field'>
            <span>起始 URL / 页面 · 页面</span>
            <input type='text' value={draft.flow.page ?? ''} placeholder='/site/edit 或 页面名称' onChange={event => updateMeta({ page: event.target.value || undefined })} />
          </label>
        </div>

        <label className='flow-form-field full'>
          <span>仓库 / 路径</span>
          <input type='text' value={draft.flow.repo ?? ''} placeholder='frontend/app 或 tests/e2e/site' onChange={event => updateMeta({ repo: event.target.value || undefined })} />
        </label>

        <div className='flow-sheet-two-col'>
          <label className='flow-form-field'>
            <span>角色</span>
            <input type='text' value={draft.flow.role ?? ''} placeholder='管理员 / 运营' onChange={event => updateMeta({ role: event.target.value || undefined })} />
          </label>
          <label className='flow-form-field'>
            <span>优先级</span>
            <select value={draft.flow.priority ?? ''} onChange={event => updateMeta({ priority: event.target.value as FlowMeta['priority'] || undefined })}>
              <option value=''>未设置</option>
              <option value='P0'>P0 - 阻塞核心链路</option>
              <option value='P1'>P1 - 高优先级</option>
              <option value='P2'>P2 - 常规回归</option>
              <option value='P3'>P3 - 辅助覆盖</option>
            </select>
          </label>
        </div>

        <div className='flow-sheet-two-col'>
          <label className='flow-form-field'>
            <span>标签</span>
            <input type='text' value={(draft.flow.tags ?? []).join(', ')} placeholder='smoke, site, wan' onChange={event => updateMeta({ tags: splitList(event.target.value) })} />
          </label>
          <label className='flow-form-field'>
            <span>AI Intent 模式</span>
            <select value={aiOverride} onChange={event => updateAiOverride(event.target.value as 'inherit' | 'enabled' | 'disabled')}>
              <option value='inherit'>跟随全局（{formatAiMode(globalAiMode)}）</option>
              <option value='enabled'>此流程启用 AI Intent</option>
              <option value='disabled'>此流程关闭 AI Intent</option>
            </select>
          </label>
        </div>
      </div>

      <footer className='sheet-actions'>
        {mode === 'new' ? <>
          <button type='button' onClick={() => submit('saveDraft')} disabled={!canSubmit}>{savingAction === 'saveDraft' ? '正在保存...' : '仅保存草稿'}</button>
          <button type='button' className='primary' onClick={() => submit('saveAndStart')} disabled={!canSubmit}>{savingAction === 'saveAndStart' ? '正在开始...' : '保存并开始录制'}</button>
        </> : <>
          <button type='button' onClick={onClose} disabled={!!savingAction}>取消</button>
          <button type='button' className='primary' onClick={() => submit('saveChanges')} disabled={!canSubmit}>{savingAction === 'saveChanges' ? '正在保存...' : '保存修改'}</button>
        </>}
      </footer>
    </section>
  </div>;
};

function touchFlow(flow: BusinessFlow): BusinessFlow {
  return {
    ...flow,
    flow: {
      ...flow.flow,
      name: flow.flow.name.trim(),
      tags: flow.flow.tags?.filter(Boolean),
    },
    updatedAt: new Date().toISOString(),
  };
}

function cloneFlow(flow: BusinessFlow): BusinessFlow {
  return JSON.parse(JSON.stringify(flow)) as BusinessFlow;
}

function splitList(value: string) {
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

function formatAiMode(mode: AiIntentSettings['mode']) {
  if (mode === 'ai-first')
    return 'AI 优先';
  if (mode === 'rule-fallback')
    return '规则优先，AI 兜底';
  return '仅手动';
}
