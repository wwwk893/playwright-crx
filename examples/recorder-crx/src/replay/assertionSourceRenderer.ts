/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { BusinessFlow, FlowAssertion } from '../flow/types';
import {
  cssAttributeValue,
  locatorExpressionForSelector,
  numberParam,
  rowTextRegexLiteral,
  stringLiteral,
  stringParam,
} from './stepEmitterUtils';

export function renderAssertionCodePreview(flow: BusinessFlow) {
  const lines: string[] = [];
  for (const step of flow.steps) {
    const assertions = step.assertions.filter(assertion => assertion.enabled);
    if (!assertions.length)
      continue;

    lines.push(`// ${step.id} ${step.intent || step.comment || step.action}`);
    for (const assertion of assertions)
      lines.push(renderAssertion(assertion));
  }
  return lines.join('\n');
}

export function isTerminalAssertionParserUnsafe(assertion: FlowAssertion) {
  return assertion.type === 'row-exists' ||
    assertion.type === 'row-not-exists' ||
    assertion.type === 'modal-closed' ||
    assertion.type === 'drawer-closed' ||
    assertion.type === 'popover-closed' ||
    assertion.type === 'selected-value-visible' ||
    assertion.type === 'form-validation-visible' ||
    assertion.type === 'toast-visible';
}

function renderTerminalStateAssertion(assertion: FlowAssertion) {
  switch (assertion.type) {
    case 'row-exists': {
      const row = terminalRowLocator(assertion);
      const columnText = stringParam(assertion.params?.columnText || assertion.params?.columnValue || assertion.expected);
      if (columnText)
        return `await expect(${row}).toContainText(${stringLiteral(columnText)});`;
      return `await expect(${row}).toBeVisible();`;
    }
    case 'row-not-exists':
      return `await expect(${terminalRowLocator(assertion)}).not.toBeVisible();`;
    case 'modal-closed':
      return `await ${terminalOverlayLocator('modal', assertion)}.waitFor({ state: "hidden", timeout: ${numberParam(assertion.params?.timeout, 10000)} });`;
    case 'drawer-closed':
      return `await ${terminalOverlayLocator('drawer', assertion)}.waitFor({ state: "hidden", timeout: ${numberParam(assertion.params?.timeout, 10000)} });`;
    case 'popover-closed':
      return `await ${terminalOverlayLocator('popover', assertion)}.waitFor({ state: "hidden", timeout: ${numberParam(assertion.params?.timeout, 5000)} });`;
    case 'selected-value-visible': {
      const target = assertion.params?.targetTestId || assertion.target?.testId;
      const locator = target ? `page.getByTestId(${stringLiteral(target)})` : locatorExpressionForSelector(assertion.target?.selector) || `page.getByText(${stringLiteral(assertion.expected || assertion.params?.expected || '选中值')})`;
      return `await expect(${locator}).toContainText(${stringLiteral(assertion.expected || assertion.params?.expected || '')});`;
    }
    case 'form-validation-visible': {
      const message = assertion.expected || assertion.params?.message || '';
      return `await expect(page.locator(${stringLiteral('.ant-form-item-explain-error, [role="alert"]')}).filter({ hasText: ${stringLiteral(message)} }).first()).toBeVisible();`;
    }
    case 'toast-visible': {
      const message = assertion.expected || assertion.params?.message || '';
      return `await expect(page.locator(${stringLiteral('.ant-message, .ant-notification, [role="alert"], .ant-form-item-explain-error')}).filter({ hasText: ${stringLiteral(message)} }).first()).toBeVisible();`;
    }
    default:
      return undefined;
  }
}

function terminalRowLocator(assertion: FlowAssertion) {
  const tableTestId = stringParam(assertion.params?.tableTestId || assertion.target?.scope?.table?.testId);
  const tableLocator = tableTestId ? `page.getByTestId(${stringLiteral(tableTestId)})` : locatorExpressionForSelector(assertion.params?.tableSelector) || `page.getByText(${stringLiteral(assertion.params?.tableArea || '表格/列表')}).locator('..')`;
  const rowKey = stringParam(assertion.params?.rowKey || assertion.target?.scope?.table?.rowKey);
  if (rowKey)
    return `${tableLocator}.locator(${stringLiteral(`tr[data-row-key="${cssAttributeValue(rowKey)}"], [role="row"][data-row-key="${cssAttributeValue(rowKey)}"]`)})`;
  const rowText = stringParam(assertion.params?.rowKeyword || assertion.target?.scope?.table?.rowText || assertion.expected);
  if (rowText) {
    const rowKeywords = [
      rowText,
      stringParam(assertion.params?.rowKeyword2),
      stringParam(assertion.params?.rowKeyword3),
      stringParam(assertion.params?.rowKeyword4),
    ].filter((value, index, values): value is string => !!value && values.indexOf(value) === index);
    return rowKeywords.reduce((locator, keyword) => `${locator}.filter({ hasText: ${rowTextRegexLiteral(keyword)} })`, `${tableLocator}.getByRole('row')`);
  }
  return `${tableLocator}.getByRole('row').first()`;
}

function terminalOverlayLocator(kind: 'modal' | 'drawer' | 'popover', assertion: FlowAssertion) {
  const testId = stringParam(assertion.params?.testId || assertion.target?.scope?.dialog?.testId);
  if (testId)
    return `page.getByTestId(${stringLiteral(testId)})`;
  const title = stringParam(assertion.params?.title || assertion.target?.scope?.dialog?.title || assertion.expected);
  const selector = kind === 'popover'
    ? '.ant-popover:not(.ant-popover-hidden):not(.ant-zoom-big-leave):not(.ant-zoom-big-leave-active)'
    : kind === 'drawer'
      ? '.ant-drawer, [role="dialog"]'
      : '.ant-modal, [role="dialog"]';
  const locator = `page.locator(${stringLiteral(selector)})`;
  return title ? `${locator}.filter({ hasText: ${stringLiteral(title)} })` : `${locator}.last()`;
}

export function renderAssertion(assertion: FlowAssertion) {
  const terminalAssertion = renderTerminalStateAssertion(assertion);
  if (terminalAssertion)
    return terminalAssertion;
  switch (assertion.subject) {
    case 'page':
      return `// assert page URL matches ${stringLiteral(assertion.expected || assertion.params?.url || '')}`;
    case 'element': {
      const targetExpression = locatorExpressionForSelector(assertion.target?.selector) ||
        `page.getByText(${stringLiteral(assertion.params?.targetSummary || assertion.target?.label || assertion.target?.text || '目标元素')})`;
      if (assertion.type === 'visible')
        return `await expect(${targetExpression}).toBeVisible();`;
      if (assertion.type === 'valueEquals')
        return `await expect(${targetExpression}).toHaveValue(${stringLiteral(assertion.expected || '')});`;
      if (assertion.type === 'textEquals')
        return `await expect(${targetExpression}).toHaveText(${stringLiteral(assertion.expected || '')});`;
      return `await expect(${targetExpression}).toContainText(${stringLiteral(assertion.expected || '')});`;
    }
    case 'table': {
      const tableLocator = locatorExpressionForSelector(assertion.params?.tableSelector) ||
        `page.getByText(${stringLiteral(assertion.params?.tableArea || '表格/列表')}).locator('..')`;
      const rowKeyword = stringLiteral(assertion.params?.rowKeyword || assertion.expected || '');
      const columnName = assertion.params?.columnName;
      const columnValue = assertion.params?.columnValue;
      const rowLocator = `${tableLocator}.getByRole('row').filter({ hasText: ${rowKeyword} })`;
      if (columnName && columnValue)
        return `await expect(${rowLocator}).toContainText(${stringLiteral(columnValue)});`;
      return `await expect(${rowLocator}).toBeVisible();`;
    }
    case 'toast':
      return `await expect(page.getByText(${stringLiteral(assertion.expected || assertion.params?.message || '')})).toBeVisible();`;
    case 'api':
      return `// expect response ${[assertion.params?.method, assertion.params?.url, assertion.params?.status || assertion.params?.requestContains].filter(Boolean).join(' ')}`;
    default:
      return `// custom assertion: ${assertion.expected || assertion.note || assertion.type}`;
  }
}
