/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { BusinessFlow, FlowRepeatSegment, FlowStep } from '../flow/types';
import { createReplaySkipPolicy, type ReplaySkipPolicyHooks } from './replaySkipPolicy';
import { stringLiteral } from './stepEmitterUtils';

type RepeatEmitStepOptions = {
  parserSafe?: boolean;
  previousStep?: FlowStep;
  nextStep?: FlowStep;
  safetyGuard?: boolean;
  suppressRowExistsAssertions?: boolean;
};

export type RepeatRendererHooks = ReplaySkipPolicyHooks & {
  emitStep: (lines: string[], step: FlowStep, indent: string, segment?: FlowRepeatSegment, rowValues?: Record<string, string>, options?: RepeatEmitStepOptions) => void;
  renderRepeatAssertionTemplate: (segment: FlowRepeatSegment) => string | undefined;
  activePopupOptionDispatchSource: (locator: string, expectedExpression: string) => string;
};

export function emitRepeatSegment(lines: string[], flow: BusinessFlow, segment: FlowRepeatSegment, hooks: RepeatRendererHooks) {
  const parameterById = new Map(segment.parameters.map(parameter => [parameter.id, parameter]));
  const data = segment.rows.map(row => Object.fromEntries(Object.entries(row.values).map(([parameterId, value]) => {
    const parameter = parameterById.get(parameterId);
    return [parameter?.variableName ?? parameterId, value];
  })));
  lines.push(`  // 循环片段: ${segment.name}`);
  lines.push(`  const ${segmentDataName(segment)} = ${JSON.stringify(data, null, 2).replace(/\n/g, '\n  ')};`);
  lines.push(`  for (const row of ${segmentDataName(segment)}) {`);
  const segmentSteps = flow.steps.filter(step => segment.stepIds.includes(step.id));
  const segmentHasNonPlaceholderStep = segmentSteps.some(step => !hooks.isPlaceholderSelectOptionClick(step));
  const skipPolicy = createReplaySkipPolicy('exported', hooks);
  let previousEmittedStep: FlowStep | undefined;
  for (const [index, step] of segmentSteps.entries()) {
    if (skipPolicy.shouldSkipRepeatStep({ step, steps: segmentSteps, index, previousEmittedStep }))
      continue;
    if (hooks.isPlaceholderSelectOptionClick(step)) {
      if (!segmentHasNonPlaceholderStep)
        emitSkippedPlaceholderSelectOption(lines, step, '    ');
      continue;
    }
    hooks.emitStep(lines, step, '    ', segment, undefined, { previousStep: previousEmittedStep, nextStep: segmentSteps[index + 1] });
    previousEmittedStep = step;
  }
  const repeatAssertion = hooks.renderRepeatAssertionTemplate(segment);
  if (repeatAssertion)
    lines.push(`    ${repeatAssertion}`);
  lines.push('  }');
}

export function firstSegmentStepId(flow: BusinessFlow, segment: FlowRepeatSegment) {
  return flow.steps.find(step => segment.stepIds.includes(step.id))?.id;
}

export function emitExpandedRepeatSegment(lines: string[], flow: BusinessFlow, segment: FlowRepeatSegment, hooks: RepeatRendererHooks, options: RepeatEmitStepOptions = {}) {
  const rows = segment.rows.length ? segment.rows : [{ id: 'row-1', values: {} }];
  rows.forEach((row, rowIndex) => {
    lines.push(`  // 循环片段 ${segment.name}: 第 ${rowIndex + 1} 行`);
    const segmentSteps = flow.steps.filter(step => segment.stepIds.includes(step.id));
    const segmentHasNonPlaceholderStep = segmentSteps.some(step => !hooks.isPlaceholderSelectOptionClick(step));
    const skipPolicy = createReplaySkipPolicy('parserSafe', hooks);
    let previousEmittedStep: FlowStep | undefined;
    for (const [index, step] of segmentSteps.entries()) {
      if (skipPolicy.shouldSkipRepeatStep({ step, steps: segmentSteps, index, previousEmittedStep }))
        continue;
      if (hooks.isPlaceholderSelectOptionClick(step)) {
        if (!segmentHasNonPlaceholderStep)
          emitSkippedPlaceholderSelectOption(lines, step, '  ');
        continue;
      }
      hooks.emitStep(lines, step, '  ', segment, row.values, { ...options, previousStep: previousEmittedStep, nextStep: segmentSteps[index + 1], suppressRowExistsAssertions: !!segment.assertionTemplate });
      previousEmittedStep = step;
    }
    if (segment.assertionTemplate)
      lines.push(`  // template assertion: ${replaceTemplateValuesWithRow(segment.assertionTemplate.description, segment, row.values)}`);
  });
}

function emitSkippedPlaceholderSelectOption(lines: string[], step: FlowStep, indent: string) {
  lines.push(`${indent}// ${step.id} skipped unsafe placeholder select option replay.`);
}

export function parameterizeLine(line: string, step: FlowStep, segment: FlowRepeatSegment, rowValues: Record<string, string> | undefined, activePopupOptionDispatchSource: RepeatRendererHooks['activePopupOptionDispatchSource']) {
  const parameter = segment.parameters.find(parameter => parameter.enabled && parameter.sourceStepId === step.id);
  if (!parameter?.currentValue)
    return line;
  const replacement = rowValues ? stringLiteral(rowValues[parameter.id] ?? parameter.currentValue) : `String(row.${parameter.variableName})`;
  const activePopupReplacement = parameterizedActivePopupOptionClick(line, step, replacement, activePopupOptionDispatchSource);
  if (activePopupReplacement)
    return activePopupReplacement;
  return line
      .replaceAll(JSON.stringify(parameter.currentValue), replacement)
      .replaceAll(`'${escapeSingleQuoted(parameter.currentValue)}'`, replacement)
      .replaceAll(`"${parameter.currentValue.replace(/"/g, '\\"')}"`, replacement);
}

function parameterizedActivePopupOptionClick(line: string, step: FlowStep, replacement: string, activePopupOptionDispatchSource: RepeatRendererHooks['activePopupOptionDispatchSource']) {
  const isGlobalTextClick = /\.getByText\([^)]*\)\.click\(\);/.test(line);
  const isActivePopupLocatorClick = /ant-select-dropdown:visible|ant-cascader-dropdown:visible/.test(line) && /\.filter\(\{ hasText:/.test(line) && /\.click\(\);/.test(line);
  if (!isGlobalTextClick && !isActivePopupLocatorClick)
    return undefined;
  if (!isPopupOptionStep(step))
    return undefined;
  return activePopupOptionDispatchSource('page.locator(' + stringLiteral('.ant-select-dropdown:visible .ant-select-item-option, .ant-select-dropdown:visible .ant-select-tree-node-content-wrapper, .ant-select-dropdown:visible .ant-select-tree-title, .ant-cascader-dropdown:visible .ant-cascader-menu-item') + ')', replacement);
}

function isPopupOptionStep(step: FlowStep) {
  const contextTarget = step.context?.before?.target;
  const ui = step.context?.before?.ui;
  const joined = [
    step.target?.role,
    step.target?.scope?.form?.label,
    contextTarget?.role,
    contextTarget?.controlType,
    contextTarget?.ariaLabel,
    ui?.component,
    ui?.form?.fieldKind,
    ui?.overlay?.type,
    ui?.recipe?.kind,
    ui?.recipe?.component,
    ui?.recipe?.fieldKind,
    ui?.option?.text ? 'option' : undefined,
  ].filter(Boolean).join('|');
  return /option|select|tree-select|cascader|dropdown|listbox|combobox/i.test(joined);
}

function replaceTemplateValuesWithRow(value: string, segment: FlowRepeatSegment, rowValues: Record<string, string>) {
  return segment.parameters.reduce((current, parameter) => {
    return current.replaceAll(`{{${parameter.variableName}}}`, rowValues[parameter.id] ?? parameter.currentValue);
  }, value);
}

function segmentDataName(segment: FlowRepeatSegment) {
  return `${segment.id.replace(/[^a-zA-Z0-9_$]/g, '_')}Data`;
}

function escapeSingleQuoted(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export type { FlowRepeatSegment };
