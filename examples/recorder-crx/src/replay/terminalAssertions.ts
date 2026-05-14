/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { FlowRepeatSegment } from '../flow/types';

export function renderRepeatAssertionTemplate(segment: FlowRepeatSegment) {
  const template = segment.assertionTemplate;
  if (!template)
    return undefined;
  if (template.type === 'tableRowExists' || template.type === 'row-exists')
    return renderRepeatTableRowExistsAssertion(segment, template.params);
  if (template.type === 'row-not-exists') {
    const row = repeatTableRowLocator(segment, template.params);
    return row ? `await expect(${row}).not.toBeVisible();` : undefined;
  }
  return undefined;
}

function renderRepeatTableRowExistsAssertion(segment: FlowRepeatSegment, params: Record<string, string | number | boolean | undefined>) {
  const row = repeatTableRowLocator(segment, params);
  if (!row)
    return undefined;
  const columnValue = repeatTemplateExpression(params.columnText || params.columnValue || params.expected, segment);
  if (columnValue)
    return `await expect(${row}).toContainText(${columnValue});`;
  return `await expect(${row}).toBeVisible();`;
}

function repeatTableRowLocator(segment: FlowRepeatSegment, params: Record<string, string | number | boolean | undefined>) {
  const tableTestId = repeatTemplateStaticText(params.tableTestId, segment);
  const tableSelector = repeatTemplateStaticText(params.tableSelector, segment);
  const tableArea = repeatTemplateStaticText(params.tableArea, segment);
  if (!tableTestId && !tableSelector && !tableArea)
    return undefined;
  const tableLocator = tableTestId ? `page.getByTestId(${stringLiteral(tableTestId)})` :
    tableSelector ? `page.locator(${stringLiteral(tableSelector)})` :
      `page.getByText(${stringLiteral(tableArea || '表格/列表')}).locator('..')`;
  const dynamicRowKey = repeatTemplateCssAttributeValueExpression(params.rowKey, segment);
  if (dynamicRowKey)
    return `${tableLocator}.locator('tr[data-row-key="' + ${dynamicRowKey} + '"], [role="row"][data-row-key="' + ${dynamicRowKey} + '"]')`;
  const rowKey = repeatTemplateStaticText(params.rowKey, segment);
  if (rowKey)
    return `${tableLocator}.locator(${stringLiteral(`tr[data-row-key="${cssAttributeValue(rowKey)}"], [role="row"][data-row-key="${cssAttributeValue(rowKey)}"]`)})`;
  const rowKeywords = repeatRowKeywordExpressions(params, segment);
  if (rowKeywords.length)
    return rowKeywords.reduce((locator, keyword) => `${locator}.filter({ hasText: ${keyword} })`, `${tableLocator}.getByRole('row')`);
  return `${tableLocator}.getByRole('row').first()`;
}

function repeatRowKeywordExpressions(params: Record<string, string | number | boolean | undefined>, segment: FlowRepeatSegment) {
  const values = [
    params.rowKeyword,
    params.rowKeyword2,
    params.rowKeyword3,
    params.rowKeyword4,
    params.columnValue,
    params.expected,
  ];
  const expressions: string[] = [];
  for (const value of values) {
    const expression = repeatTemplateExpression(value, segment);
    if (expression && !expressions.includes(expression))
      expressions.push(expression);
  }
  return expressions;
}

function repeatTemplateExpression(value: unknown, segment: FlowRepeatSegment) {
  const text = stringParam(value);
  if (!text)
    return undefined;
  const exactParameter = exactRepeatTemplateParameter(text, segment);
  if (exactParameter)
    return `String(row.${exactParameter.variableName})`;
  return interpolatedRepeatTemplateExpression(text, segment) ?? stringLiteral(text);
}

function repeatTemplateCssAttributeValueExpression(value: unknown, segment: FlowRepeatSegment) {
  const text = stringParam(value);
  if (!text)
    return undefined;
  const exactParameter = exactRepeatTemplateParameter(text, segment);
  if (exactParameter)
    return cssAttributeValueExpression(`String(row.${exactParameter.variableName})`);
  return interpolatedRepeatTemplateCssAttributeValueExpression(text, segment);
}

function repeatTemplateStaticText(value: unknown, segment: FlowRepeatSegment) {
  const text = stringParam(value);
  if (!text)
    return undefined;
  if (exactRepeatTemplateParameter(text, segment))
    return undefined;
  return replaceTemplateValues(text, segment);
}

function exactRepeatTemplateParameter(value: string, segment: FlowRepeatSegment) {
  return segment.parameters.find(parameter => parameter.enabled && value === `{{${parameter.variableName}}}`);
}

function interpolatedRepeatTemplateExpression(value: string, segment: FlowRepeatSegment) {
  const parameterByName = new Map(segment.parameters.filter(parameter => parameter.enabled).map(parameter => [parameter.variableName, parameter]));
  if (!parameterByName.size)
    return undefined;

  const chunks: string[] = [];
  let lastIndex = 0;
  let foundParameter = false;
  for (const match of value.matchAll(/{{([^{}]+)}}/g)) {
    const index = match.index ?? 0;
    const variableName = match[1];
    const parameter = parameterByName.get(variableName);
    chunks.push(escapeTemplateChunk(value.slice(lastIndex, index)));
    if (parameter) {
      chunks.push('${String(row.' + parameter.variableName + ')}');
      foundParameter = true;
    } else {
      chunks.push(escapeTemplateChunk(match[0]));
    }
    lastIndex = index + match[0].length;
  }
  if (!foundParameter)
    return undefined;
  chunks.push(escapeTemplateChunk(value.slice(lastIndex)));
  return `\`${chunks.join('')}\``;
}

function interpolatedRepeatTemplateCssAttributeValueExpression(value: string, segment: FlowRepeatSegment) {
  const parameterByName = new Map(segment.parameters.filter(parameter => parameter.enabled).map(parameter => [parameter.variableName, parameter]));
  if (!parameterByName.size)
    return undefined;

  const chunks: string[] = [];
  let lastIndex = 0;
  let foundParameter = false;
  for (const match of value.matchAll(/{{([^{}]+)}}/g)) {
    const index = match.index ?? 0;
    const variableName = match[1];
    const parameter = parameterByName.get(variableName);
    chunks.push(escapeTemplateChunk(cssAttributeValue(value.slice(lastIndex, index))));
    if (parameter) {
      chunks.push('${' + cssAttributeValueExpression(`String(row.${parameter.variableName})`) + '}');
      foundParameter = true;
    } else {
      chunks.push(escapeTemplateChunk(cssAttributeValue(match[0])));
    }
    lastIndex = index + match[0].length;
  }
  if (!foundParameter)
    return undefined;
  chunks.push(escapeTemplateChunk(cssAttributeValue(value.slice(lastIndex))));
  return `\`${chunks.join('')}\``;
}

function replaceTemplateValues(value: string, segment: FlowRepeatSegment) {
  return segment.parameters.reduce((current, parameter) => {
    return current.replaceAll(`{{${parameter.variableName}}}`, `row.${parameter.variableName}`);
  }, value);
}

function escapeTemplateChunk(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

function stringParam(value: unknown) {
  return typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : undefined;
}

function cssAttributeValue(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function cssAttributeValueExpression(expression: string) {
  return `${expression}.replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"')`;
}

function stringLiteral(value: unknown) {
  return JSON.stringify(String(value ?? ''));
}
