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
 */
import type { PageContextEvent, IntentProvenance, IntentSuggestion, StepContextSnapshot } from './pageContextTypes';
import type { FlowStep } from './types';

export function suggestBasicIntent(step: FlowStep): IntentSuggestion | undefined {
  const targetText = firstText(step.target?.displayName, step.target?.name, step.target?.label, step.target?.placeholder, step.target?.text, step.target?.testId);
  if (step.action === 'click' && targetText && /新建|新增|添加|创建/i.test(targetText))
    return makeSuggestion('打开新建入口', 0.68, 'basic.click.create', provenance('target', targetText));
  if (step.action === 'click' && targetText && /保存|提交|确定|确认|完成/i.test(targetText))
    return makeSuggestion(/保存|提交/i.test(targetText) ? '保存当前配置' : `确认${targetText}`, 0.68, 'basic.click.save', provenance('target', targetText));
  if (step.action === 'click' && targetText && /编辑|修改/i.test(targetText))
    return makeSuggestion('编辑当前记录', 0.64, 'basic.click.edit', provenance('target', targetText));
  if (step.action === 'click' && targetText && /删除|移除/i.test(targetText))
    return makeSuggestion('删除当前记录', 0.64, 'basic.click.delete', provenance('target', targetText));
  if (step.action === 'fill' && targetText)
    return makeSuggestion(`填写${targetText}`, 0.7, 'basic.fill.field', provenance('field', targetText, 'value', step.value));
  if (step.action === 'select' && targetText)
    return makeSuggestion(`选择${step.value || targetText}`, 0.66, 'basic.select.option', provenance('field', targetText, 'value', step.value));
  if (step.action === 'wait')
    return makeSuggestion('等待页面稳定后继续', 0.64, 'basic.wait.stable', provenance('milliseconds', step.value));
  return undefined;
}

export function suggestWaitIntent(previousStep?: FlowStep): IntentSuggestion {
  const previousTarget = firstText(previousStep?.target?.displayName, previousStep?.target?.name, previousStep?.target?.label, previousStep?.target?.text);
  if (previousStep?.action === 'click' && previousTarget && /保存|提交|确定|确认|完成/i.test(previousTarget))
    return makeSuggestion('等待保存完成，页面稳定后继续', 0.78, 'wait.after-save.stable', provenance('previousStep', previousStep.id, 'target', previousTarget));
  return makeSuggestion('等待页面稳定后继续', 0.64, 'wait.stable', provenance('previousStep', previousStep?.id));
}

export function suggestIntent(step: FlowStep, context: StepContextSnapshot): IntentSuggestion | undefined {
  const before = context.before;
  const after = context.after;
  const targetText = firstText(before.target?.text, before.target?.title, before.target?.ariaLabel, before.target?.placeholder, step.target?.name, step.target?.text, step.target?.testId);
  const dialogTitle = firstText(before.dialog?.title, after?.dialog?.title);
  const tableTitle = before.table?.title;
  const rowKey = firstText(before.table?.rowKey, compactRowText(before.table?.rowText));
  const sectionTitle = before.section?.title;
  const fieldLabel = firstText(before.form?.label, before.target?.placeholder, step.target?.label);
  const selectedOption = firstText(before.target?.selectedOption, targetText, step.value);
  const isDropdownSelection = step.action === 'click' && !!selectedOption && before.dialog?.type === 'dropdown';
  const resultDialogTitle = !isDropdownSelection && after?.dialog?.title && after.dialog.title !== before.dialog?.title ? after.dialog.title : undefined;
  const entity = entityName(dialogTitle, rowKey, tableTitle, sectionTitle);

  if (step.action === 'navigate')
    return makeSuggestion(`打开${firstText(lastItem(after?.breadcrumb), lastItem(before.breadcrumb), before.title, step.url, '目标')}页面`, 0.7, 'navigate.open-page', provenance('page', before.title, 'url', step.url));

  if (isDropdownSelection && fieldLabel) {
    const container = firstText(after?.dialog?.title, before.form?.title, dialogTitle);
    const prefix = container ? `在${stripDialogVerb(container)}中` : '';
    return makeSuggestion(`${prefix}选择${selectedOption}为${fieldLabel}`, 0.84, 'click.dropdown.option', provenance('field', fieldLabel, 'selectedOption', selectedOption, 'dialog', container, 'dropdown', before.dialog?.title));
  }

  if (step.action === 'click' && targetText && /新建|新增|添加|创建/i.test(targetText)) {
    const text = resultDialogTitle ? `打开${resultDialogTitle}` : `打开${firstText(sectionTitle, tableTitle, '当前模块')}新建弹窗`;
    return makeSuggestion(text, resultDialogTitle ? 0.92 : 0.78, 'click.create.open-dialog', provenance('target', targetText, 'section', sectionTitle, 'table', tableTitle, 'resultDialog', resultDialogTitle));
  }

  if (step.action === 'click' && resultDialogTitle && /新建|新增|添加|创建/i.test(resultDialogTitle))
    return makeSuggestion(`打开${resultDialogTitle}`, 0.9, 'click.result-dialog.create', provenance('target', targetText, 'resultDialog', resultDialogTitle, 'section', sectionTitle, 'table', tableTitle));

  if (step.action === 'click' && targetText && /编辑|修改/i.test(targetText)) {
    const text = resultDialogTitle ? `打开${resultDialogTitle}` : `编辑${[rowKey, tableTitle].filter(Boolean).join(' ') || entity || '当前记录'}`;
    return makeSuggestion(text, resultDialogTitle ? 0.9 : 0.78, 'click.row.edit', provenance('target', targetText, 'row', rowKey, 'table', tableTitle, 'resultDialog', resultDialogTitle));
  }

  if (step.action === 'click' && resultDialogTitle && /编辑|修改/i.test(resultDialogTitle))
    return makeSuggestion(`打开${resultDialogTitle}`, 0.88, 'click.result-dialog.edit', provenance('target', targetText, 'row', rowKey, 'resultDialog', resultDialogTitle));

  if (step.action === 'click' && targetText && /删除|移除/i.test(targetText)) {
    const text = resultDialogTitle ? `打开删除${rowKey || entity || '当前记录'}确认框` : `删除${[rowKey, tableTitle].filter(Boolean).join(' ') || entity || '当前记录'}`;
    return makeSuggestion(text, resultDialogTitle ? 0.86 : 0.76, 'click.row.delete', provenance('target', targetText, 'row', rowKey, 'table', tableTitle, 'resultDialog', resultDialogTitle));
  }

  if (step.action === 'click' && targetText && /确定|确认|保存|提交|完成/i.test(targetText)) {
    const text = dialogTitle ? `确认保存${stripDialogVerb(dialogTitle)}配置` : `点击${targetText}`;
    return makeSuggestion(text, dialogTitle ? 0.82 : 0.62, 'click.confirm.save', provenance('target', targetText, 'dialog', dialogTitle, 'section', sectionTitle));
  }

  if (step.action === 'click' && isTabClick(context.eventId, before, after, targetText)) {
    const tab = firstText(after?.activeTab?.title, before.activeTab?.title, targetText);
    return makeSuggestion(`切换到${tab}页签`, 0.8, 'click.tab.switch', provenance('target', targetText, 'tab', tab));
  }

  if (step.action === 'fill' && fieldLabel) {
    const text = entity ? `填写${entity}的${fieldLabel}` : `填写${fieldLabel}`;
    return makeSuggestion(text, 0.82, 'fill.form-field', provenance('field', fieldLabel, 'dialog', dialogTitle, 'section', sectionTitle));
  }

  if (step.action === 'select' && fieldLabel && selectedOption) {
    const prefix = dialogTitle ? `在${stripDialogVerb(dialogTitle)}中` : '';
    return makeSuggestion(`${prefix}选择${selectedOption}为${fieldLabel}`, 0.82, 'select.option', provenance('field', fieldLabel, 'selectedOption', selectedOption, 'dialog', dialogTitle));
  }

  if ((step.action === 'check' || step.action === 'uncheck') && fieldLabel)
    return makeSuggestion(`${step.action === 'check' ? '开启' : '关闭'}${fieldLabel}`, 0.76, `toggle.${step.action}`, provenance('field', fieldLabel, 'section', sectionTitle));

  if (step.action === 'press' && targetText)
    return makeSuggestion(`在${fieldLabel || targetText}中按键`, 0.55, 'press.field-key', provenance('target', targetText, 'field', fieldLabel));

  if (step.action === 'click' && targetText)
    return makeSuggestion(`点击${targetText}`, 0.55, 'click.fallback', provenance('target', targetText, 'section', sectionTitle));

  return undefined;
}

export function stepContextFromEvent(event: PageContextEvent, actionIndex?: number): StepContextSnapshot {
  return {
    eventId: event.id,
    actionIndex,
    capturedAt: event.time,
    before: event.before,
    after: event.after,
  };
}

function makeSuggestion(text: string, confidence: number, rule: string, provenance: IntentProvenance[]): IntentSuggestion {
  return {
    text,
    confidence,
    source: 'rule',
    ruleHint: rule,
    provenance,
  };
}

function provenance(...pairs: Array<string | undefined>): IntentProvenance[] {
  const result: IntentProvenance[] = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const field = pairs[i];
    const value = pairs[i + 1];
    if (field && value)
      result.push({ field, value });
  }
  return result;
}

function firstText(...values: Array<string | undefined>) {
  return values.map(value => value?.trim()).find(Boolean);
}

function lastItem(values?: string[]) {
  return values?.[values.length - 1];
}

function entityName(dialogTitle?: string, rowKey?: string, tableTitle?: string, sectionTitle?: string) {
  if (dialogTitle)
    return stripDialogVerb(dialogTitle);
  if (rowKey && tableTitle)
    return `${rowKey} ${tableTitle}`;
  return tableTitle || sectionTitle;
}

function stripDialogVerb(title: string) {
  return title.replace(/^(新建|新增|添加|创建|编辑|修改|删除)\s*/, '').trim() || title;
}

function compactRowText(value?: string) {
  return value?.split(/\s+/).find(token => token.length <= 40 && !/^(编辑|删除|操作|--)$/.test(token));
}

function isTabClick(_eventId: string, before: StepContextSnapshot['before'], after?: StepContextSnapshot['after'], targetText?: string) {
  if (!targetText)
    return false;
  return before.target?.role === 'tab' || before.activeTab?.title === targetText || after?.activeTab?.title === targetText;
}
