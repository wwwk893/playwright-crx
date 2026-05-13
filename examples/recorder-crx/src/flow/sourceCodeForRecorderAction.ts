/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import type { Source } from '@recorder/recorderTypes';
import { asLocator } from '@isomorphic/locatorGenerators';
import { extractTargetFromRecorderAction } from '../capture/targetFromRecorderSelector';
import type { ActionLike } from './recorderActionModel';
import { extractRecorderActionValue, normalizeWaitMilliseconds, renderStableWaitSource, stringLiteral } from './recorderActionModel';

export function recordedSourceActions(sources: unknown[]) {
  const source = sources.find(source => {
    const candidate = source as Partial<Source>;
    return candidate?.isRecorded;
  }) as Source | undefined;
  if (!source)
    return [];
  if (Array.isArray(source.actions))
    return source.actions;
  return extractRunnableSourceLines(source.text);
}

export function sourceCodeForRecordedAction(candidate: string | undefined, action: ActionLike) {
  return sourceCodeMatchesAction(candidate, action) ? candidate : renderActionSource(action);
}

function extractRunnableSourceLines(text?: string) {
  return text
      ?.split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => isRunnableActionSourceLine(line)) ?? [];
}

function isRunnableActionSourceLine(line: string) {
  return /^(await|const|let|var)\s/.test(line) && !line.includes(' has no runnable Playwright action source');
}

function sourceCodeMatchesAction(sourceCode: string | undefined, action: ActionLike) {
  if (!sourceCode)
    return false;

  if (action.name === 'click' && !/\.click\(/.test(sourceCode))
    return false;
  if (action.name === 'fill' && !/\.fill\(/.test(sourceCode))
    return false;
  if (action.name === 'press' && !/\.press\(/.test(sourceCode))
    return false;
  if ((action.name === 'wait' || action.name === 'waitForTimeout') && !/\.waitForTimeout\(/.test(sourceCode))
    return false;
  if ((action.name === 'select' || action.name === 'selectOption') && !/\.selectOption\(/.test(sourceCode))
    return false;

  const target = extractTargetFromRecorderAction(action);
  if (target?.testId)
    return sourceCode.includes(target.testId);
  if (action.name === 'click' && /getByTestId\(/.test(sourceCode))
    return true;

  const tokens = [
    target?.name,
    target?.label,
    target?.text,
    target?.placeholder,
    action.text,
    action.value,
    action.key,
    ...(action.options ?? []),
  ].filter(Boolean) as string[];
  return !tokens.length || tokens.some(token => sourceCode.includes(token));
}

function renderActionSource(action: ActionLike) {
  switch (action.name) {
    case 'navigate':
    case 'goto':
    case 'openPage':
      return action.url ? `await page.goto(${stringLiteral(action.url)});` : undefined;
    case 'click':
      return action.selector ? `await ${locatorExpression(action.selector)}.click();` : undefined;
    case 'fill':
      return action.selector ? `await ${locatorExpression(action.selector)}.fill(${stringLiteral(extractRecorderActionValue(action) ?? '')});` : undefined;
    case 'press':
      return action.selector ? `await ${locatorExpression(action.selector)}.press(${stringLiteral(action.key ?? '')});` : undefined;
    case 'wait':
    case 'waitForTimeout':
      return renderStableWaitSource(normalizeWaitMilliseconds(Number(extractRecorderActionValue(action) ?? action.value ?? action.text)));
    case 'check':
      return action.selector ? `await ${locatorExpression(action.selector)}.check();` : undefined;
    case 'uncheck':
      return action.selector ? `await ${locatorExpression(action.selector)}.uncheck();` : undefined;
    case 'select':
    case 'selectOption':
      return action.selector ? `await ${locatorExpression(action.selector)}.selectOption(${stringLiteral(action.options?.[0] ?? extractRecorderActionValue(action) ?? '')});` : undefined;
    case 'setInputFiles':
      return action.selector ? `await ${locatorExpression(action.selector)}.setInputFiles(${stringLiteral(action.files?.[0] ?? '')});` : undefined;
    default:
      return undefined;
  }
}

function locatorExpression(selector: string) {
  try {
    return `page.${asLocator('javascript', selector)}`;
  } catch {
    return `page.locator(${stringLiteral(selector)})`;
  }
}
