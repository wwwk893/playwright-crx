/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { compactUiSemanticContext } from '../uiSemantics';
import type { BusinessFlow, FlowStep } from '../flow/types';
import type { AiIntentInput, AiIntentStepInput } from './types';
import { redactAiIntentInput } from './redactForModel';

export const INTENT_SYSTEM_PROMPT = [
  '你是业务流程测试录制助手。根据每个步骤的动作和局部页面上下文，生成简短、自然、中文的业务意图。',
  '只输出 JSON，不输出 markdown，不输出解释文字。输出格式必须是 { "items": [ { "stepId": "...", "intent": "...", "confidence": 0.0, "reason": "..." } ] }。',
  '不要泄露敏感值，不要复述 selector、testId、完整 URL、token、cookie、password、authorization 或 API key。',
  'intent 应表达业务含义，不要写成技术操作。上下文不足时使用保守表达并降低 confidence。',
  '常见规则：新建/新增按钮打开新建弹窗；编辑/删除行表示编辑或删除对应记录；确定/保存/提交表示确认保存；fill 表示填写字段；select/dropdown 表示选择某字段为某选项；tab 表示切换页签；search/reset 表示查询或重置。',
].join('\n');

export function buildAiIntentInput(flow: BusinessFlow, steps: FlowStep[]): AiIntentInput {
  const input: AiIntentInput = {
    flow: {
      id: flow.flow.id,
      name: flow.flow.name,
      module: flow.flow.module,
      page: flow.flow.page,
      role: flow.flow.role,
      businessGoal: flow.flow.businessGoal,
    },
    steps: steps.map(compactStep),
  };
  return redactAiIntentInput(input);
}

export function buildTestConnectionInput(): AiIntentInput {
  return {
    flow: {
      name: 'AI Intent 测试',
      module: '站点配置',
      page: '共享 WAN',
      role: '管理员',
      businessGoal: '创建共享 WAN',
    },
    steps: [{
      stepId: 'test-001',
      order: 1,
      action: 'click',
      target: { role: 'button', text: '新建' },
      before: { section: '共享 WAN' },
      after: { dialog: '新建共享 WAN' },
    }],
  };
}

function compactStep(step: FlowStep): AiIntentStepInput {
  const before = step.context?.before;
  const after = step.context?.after;
  return {
    stepId: step.id,
    order: step.order,
    action: step.action,
    target: {
      role: step.target?.role || before?.target?.role,
      text: step.target?.text || step.target?.name || before?.target?.text || before?.target?.title,
      testId: step.target?.testId || before?.target?.testId,
      ariaLabel: before?.target?.ariaLabel,
      placeholder: step.target?.placeholder || before?.target?.placeholder,
    },
    ui: compactUiSemanticContext(before?.ui, step.uiRecipe),
    before: {
      page: before?.title,
      url: compactUrl(before?.url),
      breadcrumb: before?.breadcrumb,
      activeTab: before?.activeTab?.title,
      section: before?.section?.title,
      table: before?.table?.title,
      row: before?.table?.rowKey,
      column: before?.table?.columnName,
      form: before?.form?.title || before?.form?.name,
      field: before?.form?.label,
      dialog: before?.dialog?.title,
      dropdown: before?.dialog?.type === 'dropdown' ? before.dialog.title : undefined,
      target: {
        role: before?.target?.role,
        text: before?.target?.text || before?.target?.title,
        testId: before?.target?.testId,
        ariaLabel: before?.target?.ariaLabel,
        placeholder: before?.target?.placeholder,
      },
    },
    after: {
      activeTab: after?.activeTab?.title,
      dialog: after?.dialog?.title,
      toast: after?.toast,
      url: compactUrl(after?.url),
      selectedOption: before?.target?.selectedOption,
    },
  };
}

function firstText(...values: Array<string | undefined>) {
  return values.map(value => value?.trim()).find(Boolean);
}

function compactUrl(value?: string) {
  if (!value)
    return undefined;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split(/[?#]/)[0];
  }
}

function compactRowText(value?: string) {
  return value?.split(/\s+/).find(token => token.length <= 40 && !/^(编辑|删除|操作|--)$/.test(token));
}
