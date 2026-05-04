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
import type { BusinessFlow, FlowAssertion, FlowRepeatSegment, FlowStep } from './types';
import { actionLabel, summarizeStepSubject } from './display';
import { asLocator } from '@isomorphic/locatorGenerators';

export function generateBusinessFlowPlaywrightCode(flow: BusinessFlow) {
  const effectiveFlow = withInheritedAntdSelectOptionContext(flow);
  const lines = [
    `import { test, expect } from '@playwright/test';`,
    '',
    `test(${stringLiteral(effectiveFlow.flow.name || 'business flow')}, async ({ page }) => {`,
  ];

  const emittedRepeatStepIds = new Set<string>();
  for (const step of effectiveFlow.steps) {
    const segment = (effectiveFlow.repeatSegments ?? []).find(segment => firstSegmentStepId(effectiveFlow, segment) === step.id);
    if (segment) {
      emitRepeatSegment(lines, effectiveFlow, segment);
      segment.stepIds.forEach(stepId => emittedRepeatStepIds.add(stepId));
      continue;
    }
    if (emittedRepeatStepIds.has(step.id))
      continue;

    emitStep(lines, step, '  ');
  }

  lines.push('});');
  return `${lines.join('\n')}\n`;
}

export function generateBusinessFlowPlaybackCode(flow: BusinessFlow) {
  const effectiveFlow = withInheritedAntdSelectOptionContext(flow);
  const lines = [
    `import { test, expect } from '@playwright/test';`,
    '',
    `test(${stringLiteral(effectiveFlow.flow.name || 'business flow')}, async ({ page }) => {`,
  ];

  const emittedRepeatStepIds = new Set<string>();
  for (const step of effectiveFlow.steps) {
    const segment = (effectiveFlow.repeatSegments ?? []).find(segment => firstSegmentStepId(effectiveFlow, segment) === step.id);
    if (segment) {
      emitExpandedRepeatSegment(lines, effectiveFlow, segment, { parserSafe: true });
      segment.stepIds.forEach(stepId => emittedRepeatStepIds.add(stepId));
      continue;
    }
    if (emittedRepeatStepIds.has(step.id))
      continue;

    emitStep(lines, step, '  ', undefined, undefined, { parserSafe: true });
  }

  lines.push('});');
  return `${lines.join('\n')}\n`;
}

export function countBusinessFlowPlaybackActions(flow: BusinessFlow) {
  const effectiveFlow = withInheritedAntdSelectOptionContext(flow);
  let count = 0;
  const emittedRepeatStepIds = new Set<string>();
  for (const step of effectiveFlow.steps) {
    const segment = (effectiveFlow.repeatSegments ?? []).find(segment => firstSegmentStepId(effectiveFlow, segment) === step.id);
    if (segment) {
      const rows = segment.rows.length ? segment.rows : [{ id: 'row-1', values: {} }];
      const segmentSteps = effectiveFlow.steps.filter(step => segment.stepIds.includes(step.id));
      count += rows.length * segmentSteps.reduce((total, step) => total + countStepActions(step, { parserSafe: true }), 0);
      segment.stepIds.forEach(stepId => emittedRepeatStepIds.add(stepId));
      continue;
    }
    if (emittedRepeatStepIds.has(step.id))
      continue;

    count += countStepActions(step, { parserSafe: true });
  }
  return count;
}

function withInheritedAntdSelectOptionContext(flow: BusinessFlow): BusinessFlow {
  let activeSelectStep: FlowStep | undefined;
  let changed = false;
  const steps = flow.steps.map(step => {
    if (isAntdSelectFieldStep(step)) {
      activeSelectStep = step;
      return step;
    }

    if (activeSelectStep && isContextlessOptionTextClickAfterSelect(step, activeSelectStep)) {
      changed = true;
      const optionText = step.target?.text || step.target?.name || step.target?.displayName;
      const activeForm = selectStepFormContext(activeSelectStep);
      return {
        ...step,
        target: {
          ...step.target,
          scope: {
            ...step.target?.scope,
            dialog: selectTriggerDialog(activeSelectStep),
            form: activeForm,
          },
        },
        context: {
          ...step.context,
          before: {
            ...step.context?.before,
            dialog: { type: 'dropdown', visible: true },
            form: activeForm,
            target: {
              ...step.context?.before.target,
              framework: activeSelectStep.context?.before.target?.framework || 'antd',
              controlType: inheritedPopupOptionControlType(activeForm?.label),
              text: optionText,
              normalizedText: optionText,
            },
          },
          after: {
            ...step.context?.after,
            dialog: selectTriggerDialog(activeSelectStep),
          },
        },
      } as FlowStep;
    }

    if (step.action !== 'fill' && step.action !== 'press')
      activeSelectStep = undefined;
    return step;
  });
  return changed ? { ...flow, steps } : flow;
}

function inheritedPopupOptionControlType(label?: string) {
  if (/发布范围/.test(label || ''))
    return 'tree-select-option';
  if (/出口路径/.test(label || ''))
    return 'cascader-option';
  return 'select-option';
}

function isAntdSelectFieldStep(step: FlowStep) {
  const controlType = step.context?.before.target?.controlType;
  const framework = step.context?.before.target?.framework;
  const label = selectStepFormContext(step)?.label;
  const selector = rawAction(step.rawAction).selector || step.target?.selector || step.target?.locator || '';
  const source = step.sourceCode || '';
  const sourceCombobox = /getByRole\(["']combobox["']/.test(source) || /role=combobox/.test(selector);
  const isAntdLike = framework === 'antd' || framework === 'procomponents' || step.target?.role === 'combobox' || sourceCombobox;
  const isPopupField = controlType === 'select' || controlType === 'tree-select' || controlType === 'cascader' || step.target?.role === 'combobox' || sourceCombobox;
  return !!label && isAntdLike && isPopupField && (step.action === 'click' || step.action === 'fill');
}

function selectStepFormContext(step: FlowStep) {
  const form = step.context?.before.form || step.target?.scope?.form;
  if (form?.label)
    return form;
  const label = step.target?.label || popupFieldLabelFromName(step.target?.name || step.target?.text || step.target?.displayName);
  return label ? { ...form, label } : form;
}

function popupFieldLabelFromName(value?: string) {
  const text = value?.replace(/^\*\s*/, '').trim();
  if (!text)
    return undefined;
  if (/发布范围|出口路径|关联VRF|WAN口/.test(text))
    return text;
  return undefined;
}

function isContextlessOptionTextClickAfterSelect(step: FlowStep, selectStep: FlowStep) {
  if (step.action !== 'click' || isAntdSelectOptionStep(step))
    return false;
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  if (/^(checkbox|radio|switch)$/.test(controlType) || /^(checkbox|radio|switch)$/.test(step.target?.role || ''))
    return false;
  const optionText = step.target?.text || step.target?.name || step.target?.displayName;
  if (!optionText)
    return false;
  const selector = rawAction(step.rawAction).selector || step.target?.selector || step.target?.locator || '';
  if (selector && !selector.includes('internal:text') && !/getByText|text=/.test(step.sourceCode || ''))
    return false;
  const query = String(selectStep.value || rawAction(selectStep.rawAction).text || rawAction(selectStep.rawAction).value || '').trim();
  return !query || optionText.includes(query);
}

function emitRepeatSegment(lines: string[], flow: BusinessFlow, segment: FlowRepeatSegment) {
  const parameterById = new Map(segment.parameters.map(parameter => [parameter.id, parameter]));
  const data = segment.rows.map(row => Object.fromEntries(Object.entries(row.values).map(([parameterId, value]) => {
    const parameter = parameterById.get(parameterId);
    return [parameter?.variableName ?? parameterId, value];
  })));
  lines.push(`  // 循环片段: ${segment.name}`);
  lines.push(`  const ${segmentDataName(segment)} = ${JSON.stringify(data, null, 2).replace(/\n/g, '\n  ')};`);
  lines.push(`  for (const row of ${segmentDataName(segment)}) {`);
  for (const step of flow.steps.filter(step => segment.stepIds.includes(step.id)))
    emitStep(lines, step, '    ', segment);
  if (segment.assertionTemplate)
    lines.push(`    // template assertion: ${replaceTemplateValues(segment.assertionTemplate.description, segment)}`);
  lines.push('  }');
}

function firstSegmentStepId(flow: BusinessFlow, segment: FlowRepeatSegment) {
  return flow.steps.find(step => segment.stepIds.includes(step.id))?.id;
}

type EmitStepOptions = {
  parserSafe?: boolean;
};

function emitExpandedRepeatSegment(lines: string[], flow: BusinessFlow, segment: FlowRepeatSegment, options: EmitStepOptions = {}) {
  const rows = segment.rows.length ? segment.rows : [{ id: 'row-1', values: {} }];
  rows.forEach((row, rowIndex) => {
    lines.push(`  // 循环片段 ${segment.name}: 第 ${rowIndex + 1} 行`);
    for (const step of flow.steps.filter(step => segment.stepIds.includes(step.id)))
      emitStep(lines, step, '  ', segment, row.values, options);
    if (segment.assertionTemplate)
      lines.push(`  // template assertion: ${replaceTemplateValuesWithRow(segment.assertionTemplate.description, segment, row.values)}`);
  });
}

function emitStep(lines: string[], step: FlowStep, indent: string, segment?: FlowRepeatSegment, rowValues?: Record<string, string>, options: EmitStepOptions = {}) {
  lines.push(`${indent}// ${step.id} ${actionLabel[step.action]}: ${summarizeStepSubject(step)}`);
  const sourceCode = sourceCodeForStep(step, options);
  if (sourceCode)
    lines.push(...sourceCode.map(line => `${indent}${segment ? parameterizeLine(line, step, segment, rowValues) : line}`));
  else
    lines.push(`${indent}// ${step.id} has no runnable Playwright action source.`);

  for (const assertion of step.assertions.filter(assertion => assertion.enabled))
    lines.push(`${indent}${segment ? parameterizeLine(renderAssertion(assertion), step, segment, rowValues) : renderAssertion(assertion)}`);
}

function countStepActions(step: FlowStep, options: EmitStepOptions = {}) {
  const sourceActionCount = sourceCodeForStep(step, options)
      ?.filter(line => isRunnableLine(line))
      .length ?? 0;
  const assertionActionCount = step.assertions
      .filter(assertion => assertion.enabled)
      .map(renderAssertion)
      .filter(line => isRunnableLine(line))
      .length;
  return sourceActionCount + assertionActionCount;
}

function isRunnableLine(line: string) {
  return /^(await|const|let|var)\s/.test(line.trim());
}

function sourceCodeForStep(step: FlowStep, options: EmitStepOptions = {}) {
  if (isNonInteractiveContainerClick(step))
    return undefined;
  const sourceCode = normalizeActionSource(step.sourceCode);
  const fallback = renderRawActionSource(step, options);
  if (fallback)
    return normalizeActionSource(fallback);
  if (sourceCode && sourceMatchesStep(sourceCode, step))
    return sourceCode;
  return sourceCode;
}

function sourceMatchesStep(sourceCode: string[], step: FlowStep) {
  const joined = sourceCode.join('\n');
  switch (step.action) {
    case 'click':
      return /\.click\(/.test(joined) && sourceMentionsStepTarget(joined, step);
    case 'fill':
      return /\.fill\(/.test(joined) && (!step.value || joined.includes(step.value));
    case 'press':
      return /\.press\(/.test(joined) && (!step.value || joined.includes(step.value));
    case 'wait':
      return /\.waitForTimeout\(/.test(joined) && (!step.value || joined.includes(step.value));
    case 'select':
      return /\.selectOption\(/.test(joined) || /\.click\(/.test(joined);
    case 'check':
      return /\.check\(/.test(joined);
    case 'uncheck':
      return /\.uncheck\(/.test(joined);
    case 'upload':
      return /\.setInputFiles\(/.test(joined);
    case 'navigate':
      return /\.goto\(/.test(joined) && (!step.url || joined.includes(step.url));
    default:
      return true;
  }
}

function sourceMentionsStepTarget(sourceCode: string, step: FlowStep) {
  const targetTokens = [
    step.target?.testId,
    step.target?.name,
    step.target?.label,
    step.target?.text,
    step.target?.placeholder,
    step.target?.displayName,
  ].filter(Boolean) as string[];
  return !targetTokens.length || targetTokens.some(token => sourceCode.includes(token));
}

function isNonInteractiveContainerClick(step: FlowStep) {
  if (step.action !== 'click')
    return false;
  const testId = step.target?.testId || step.context?.before.target?.testId;
  if (!testId)
    return false;
  const hasTargetText = !!(step.target?.text || step.target?.name || step.target?.label || step.target?.displayName || step.context?.before.target?.text || step.context?.before.target?.normalizedText);
  if (hasTargetText)
    return false;
  const dialogType = step.target?.scope?.dialog?.type || step.context?.before.dialog?.type;
  const looksLikeOverlayRoot = /(modal|drawer|dialog)$/i.test(testId) || (/(container|root)$/i.test(testId) && /^(modal|drawer|dialog)$/i.test(dialogType || ''));
  if (!looksLikeOverlayRoot)
    return false;
  const role = step.target?.role || step.context?.before.target?.role;
  if (/^(button|link|checkbox|radio|switch|combobox|option|menuitem|tab)$/i.test(role || ''))
    return false;
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  if (/^(button|checkbox|radio|switch|select|tree-select|cascader|select-option|tree-select-option|cascader-option)$/i.test(controlType || ''))
    return false;
  return true;
}

function renderRawActionSource(step: FlowStep, options: EmitStepOptions = {}) {
  const action = rawAction(step.rawAction);
  const selector = action.selector || step.target?.selector || step.target?.locator;
  switch (action.name || step.action) {
    case 'navigate':
    case 'goto':
    case 'openPage':
      return action.url || step.url ? `await page.goto(${stringLiteral(action.url || step.url)});` : undefined;
    case 'click': {
      const testIdLocator = globalTestIdLocator(step);
      if (testIdLocator)
        return `await ${testIdLocator}.click();`;
      const rawSelectOption = rawSelectOptionClickSource(step);
      if (rawSelectOption)
        return options.parserSafe ? rawSelectOptionParserSafeSource(step) : rawSelectOption;
      const selectOption = antdSelectOptionLocator(step);
      if (selectOption)
        return options.parserSafe ? `await ${selectOption}.last().click();` : selectOptionClickSource(selectOption);
      const treeOption = antdTreeSelectOptionLocator(step);
      if (treeOption)
        return antdPopupOptionDispatchSource(treeOption, popupOptionName(step));
      const cascaderOption = antdCascaderOptionLocator(step);
      if (cascaderOption)
        return antdPopupOptionDispatchSource(cascaderOption, popupOptionName(step), { stabilizeAfterClickMs: 120 });
      const activePopupOption = activeDropdownOptionLocator(step);
      if (activePopupOption)
        return `await ${activePopupOption}.last().click();`;
      const preferred = preferredTargetLocator(step);
      if (preferred)
        return `await ${preferred}.click();`;
      return selector ? `await ${locatorExpressionForSelector(selector)}.click();` : targetClickFallback(step);
    }
    case 'fill': {
      const value = stringLiteral(action.text ?? action.value ?? step.value ?? '');
      const isComboboxFill = step.target?.role === 'combobox' || /^(select|tree-select|cascader)$/.test(step.context?.before.target?.controlType || '');
      const preferred = isComboboxFill ? undefined : fieldLocator(step);
      if (preferred)
        return `await ${preferred}.fill(${value});`;
      return selector ? `await ${locatorExpressionForSelector(selector)}.fill(${value});` : undefined;
    }
    case 'press':
      return selector ? `await ${locatorExpressionForSelector(selector)}.press(${stringLiteral(action.key ?? step.value ?? '')});` : undefined;
    case 'wait':
    case 'waitForTimeout':
      return renderStableWaitSource(waitMilliseconds(step.value ?? action.timeout ?? action.value ?? action.text));
    case 'check':
      return selector ? `await ${locatorExpressionForSelector(selector)}.check();` : undefined;
    case 'uncheck':
      return selector ? `await ${locatorExpressionForSelector(selector)}.uncheck();` : undefined;
    case 'select':
    case 'selectOption':
      return selector ? `await ${locatorExpressionForSelector(selector)}.selectOption(${stringLiteral(action.options?.[0] ?? step.value ?? '')});` : undefined;
    case 'setInputFiles':
    case 'upload':
      return selector ? `await ${locatorExpressionForSelector(selector)}.setInputFiles(${stringLiteral(action.files?.[0] ?? step.value ?? '')});` : undefined;
    default:
      return undefined;
  }
}

function waitMilliseconds(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric))
    return 1000;
  return Math.max(0, Math.round(numeric));
}

function renderStableWaitSource(milliseconds: number) {
  return [
    `await page.waitForLoadState('networkidle').catch(() => {});`,
    `await page.waitForTimeout(${milliseconds});`,
  ].join('\n');
}

function targetClickFallback(step: FlowStep) {
  const preferred = preferredTargetLocator(step);
  if (preferred)
    return `await ${preferred}.click();`;
  const text = step.target?.text || step.target?.name || step.target?.label || step.target?.displayName;
  return text ? `await page.getByText(${stringLiteral(text)}).click();` : undefined;
}

function preferredTargetLocator(step: FlowStep) {
  return globalTestIdLocator(step) ||
    antdTreeSelectOptionLocator(step) ||
    antdCascaderOptionLocator(step) ||
    antdSelectOptionLocator(step) ||
    activeDropdownOptionLocator(step) ||
    tableScopedLocator(step) ||
    choiceControlLocator(step) ||
    fieldLocator(step) ||
    dialogScopedLocator(step) ||
    sectionScopedLocator(step) ||
    globalRoleLocator(step) ||
    fallbackTextLocator(step);
}

function antdSelectOptionLocator(step: FlowStep) {
  if (!isAntdSelectOptionStep(step))
    return undefined;
  const optionName = antdSelectOptionName(step);
  if (!optionName)
    return undefined;
  return `page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").last().locator(".ant-select-item-option").filter({ hasText: ${stringLiteral(optionName)} })`;
}

function isAntdSelectOptionStep(step: FlowStep) {
  if (isOrdinaryFormLabelClick(step))
    return false;
  const contextTarget = step.context?.before.target;
  const selector = rawAction(step.rawAction).selector || step.target?.selector || step.target?.locator || '';
  const framework = contextTarget?.framework;
  const controlType = contextTarget?.controlType;
  const hasAntdSelector = /\.ant-select-item-option|\.ant-select-dropdown/.test(selector);
  const hasRawTitle = !!rawSelectOptionTitle(step);
  const fieldLabel = step.context?.before.form?.label || step.target?.scope?.form?.label || step.target?.label;
  if (/tree-select-option|cascader-option/.test(controlType || ''))
    return false;
  const optionName = step.target?.text || step.target?.name || step.target?.displayName || contextTarget?.text || contextTarget?.normalizedText;
  const isFormScopedDropdownOption = step.action === 'click' && !!fieldLabel && !!optionName && (
    step.context?.before.dialog?.type === 'dropdown' || step.target?.scope?.dialog?.type === 'dropdown'
  );
  return ((framework === 'antd' || framework === 'procomponents') && controlType === 'select-option') ||
    hasAntdSelector ||
    isFormScopedDropdownOption ||
    (hasRawTitle && controlType === 'select-option' && (framework === 'antd' || framework === 'procomponents'));
}

function isOrdinaryFormLabelClick(step: FlowStep) {
  if (step.action !== 'click')
    return false;
  const contextTarget = step.context?.before.target;
  const tag = contextTarget?.tag || String((step.target?.raw as { tag?: unknown } | undefined)?.tag || '');
  if (tag !== 'label')
    return false;
  const targetText = normalizeComparableText(step.target?.text || step.target?.name || step.target?.displayName || contextTarget?.text || contextTarget?.normalizedText);
  const formLabel = normalizeComparableText(step.context?.before.form?.label || step.target?.scope?.form?.label || step.target?.label);
  if (!targetText || !formLabel || targetText !== formLabel)
    return false;
  const selector = rawAction(step.rawAction).selector || step.target?.selector || step.target?.locator || '';
  return !/ant-select|ant-cascader|ant-tree|role=option|role=menuitem/.test(selector);
}

function normalizeComparableText(value?: string) {
  return value?.replace(/\s+/g, ' ').trim();
}

function antdTreeSelectOptionLocator(step: FlowStep) {
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  const selector = rawAction(step.rawAction).selector || step.target?.selector || step.target?.locator || '';
  if (controlType !== 'tree-select-option' && !/ant-select-tree/.test(selector))
    return undefined;
  const optionName = step.target?.text || step.target?.name || step.target?.displayName || step.context?.before.target?.text;
  if (!optionName)
    return undefined;
  return `page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").last().locator(".ant-select-tree-node-content-wrapper").filter({ hasText: ${stringLiteral(optionName)} })`;
}

function antdCascaderOptionLocator(step: FlowStep) {
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  const selector = rawAction(step.rawAction).selector || step.target?.selector || step.target?.locator || '';
  if (controlType !== 'cascader-option' && !/ant-cascader-menu-item/.test(selector))
    return undefined;
  const optionName = step.target?.text || step.target?.name || step.target?.displayName || step.context?.before.target?.text;
  if (!optionName)
    return undefined;
  return `page.locator(".ant-cascader-dropdown:not(.ant-cascader-dropdown-hidden)").last().locator(".ant-cascader-menu-item").filter({ hasText: ${stringLiteral(optionName)} })`;
}

function activeDropdownOptionLocator(step: FlowStep) {
  if (step.action !== 'click' || isOrdinaryFormLabelClick(step))
    return undefined;
  const optionName = popupOptionName(step);
  if (!optionName)
    return undefined;
  const selector = rawAction(step.rawAction).selector || step.target?.selector || step.target?.locator || '';
  const dropdown = step.context?.before.dialog || step.target?.scope?.dialog;
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  const framework = step.context?.before.target?.framework || String((step.target?.raw as { framework?: unknown } | undefined)?.framework || '');
  const looksLikeActivePopupOption = dropdown?.type === 'dropdown' || (/option/.test(controlType) && /^(antd|procomponents)$/.test(framework)) || /ant-select|ant-cascader/.test(selector);
  if (!looksLikeActivePopupOption)
    return undefined;
  return `page.locator(${stringLiteral('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option, .ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-tree-node-content-wrapper, .ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-tree-title, .ant-cascader-dropdown:not(.ant-cascader-dropdown-hidden) .ant-cascader-menu-item')}).filter({ hasText: ${stringLiteral(optionName)} })`;
}

function popupOptionName(step: FlowStep) {
  return step.target?.text || step.target?.name || step.target?.displayName || step.context?.before.target?.text;
}

function rawSelectOptionClickSource(step: FlowStep) {
  const optionLocator = antdSelectOptionLocator(step);
  if (!optionLocator)
    return undefined;
  return antdSelectOptionClickSource(step, optionLocator);
}

function rawSelectOptionParserSafeSource(step: FlowStep) {
  const optionLocator = antdSelectOptionLocator(step);
  return optionLocator ? `await ${optionLocator}.last().click();` : undefined;
}

function selectOptionClickSource(optionLocator: string) {
  return antdSelectOptionClickSource(undefined, optionLocator);
}

function antdSelectOptionClickSource(step: FlowStep | undefined, optionLocator: string) {
  const triggerLocator = step ? antdSelectTriggerLocator(step) : `page.locator(".ant-select-selector").last()`;
  const optionName = step ? antdSelectOptionName(step) : undefined;
  return [
    `// AntD Select virtual dropdown replay workaround: locator.click() may hit search input or portal/modal overlays.`,
    `if (!await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").first().isVisible().catch(() => false))`,
    `  await ${triggerLocator}.click();`,
    optionName ? `if (!await ${optionLocator}.first().isVisible().catch(() => false)) {\n  if (await ${triggerLocator}.locator("input").count().catch(() => 0))\n    await ${triggerLocator}.locator("input").first().fill(${stringLiteral(optionName)}, { timeout: 1000 }).catch(async () => { await ${triggerLocator}.fill(${stringLiteral(optionName)}, { timeout: 1000 }).catch(() => {}); });\n  else\n    await ${triggerLocator}.fill(${stringLiteral(optionName)}, { timeout: 1000 }).catch(() => {});\n}` : undefined,
    antdSelectOptionDispatchSource(optionLocator, optionName),
    `await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").first().waitFor({ state: "hidden", timeout: 1000 }).catch(() => {});`,
  ].filter(Boolean).join('\n');
}

function antdSelectOptionName(step: FlowStep) {
  const contextTarget = step.context?.before.target;
  const rawTitle = rawSelectOptionTitle(step);
  return contextTarget?.text ||
    contextTarget?.normalizedText ||
    contextTarget?.title ||
    contextTarget?.ariaLabel ||
    step.target?.text ||
    step.target?.name ||
    step.target?.displayName ||
    rawTitle;
}

function antdSelectTriggerLocator(step: FlowStep) {
  return antdSelectFieldLocator(step) || `page.locator(".ant-select-selector").last()`;
}

function antdSelectFieldLocator(step: FlowStep) {
  const testId = step.context?.before.form?.testId ||
    step.target?.scope?.form?.testId ||
    step.context?.before.target?.testId;
  if (testId)
    return `page.getByTestId(${stringLiteral(testId)})`;
  const label = step.context?.before.form?.label || step.target?.scope?.form?.label || step.target?.label;
  if (!label)
    return undefined;
  const dialog = selectTriggerDialog(step);
  const root = dialog?.testId ?
    `page.getByTestId(${stringLiteral(dialog.testId)})` :
    dialog?.title ?
      `page.locator(${stringLiteral('.ant-modal, .ant-drawer, [role="dialog"]')}).filter({ hasText: ${stringLiteral(dialog.title)} })` :
      'page';
  return `${root}.locator(${stringLiteral('.ant-form-item')}).filter({ hasText: ${stringLiteral(label)} }).locator(${stringLiteral('.ant-select-selector')}).first()`;
}

function selectTriggerDialog(step: FlowStep) {
  const scoped = step.target?.scope?.dialog;
  if ((scoped?.title || scoped?.testId) && scoped.type !== 'dropdown')
    return scoped;
  const before = step.context?.before.dialog;
  if ((before?.title || before?.testId) && before.type !== 'dropdown')
    return before;
  const after = step.context?.after?.dialog;
  if ((after?.title || after?.testId) && after.type !== 'dropdown')
    return after;
  return undefined;
}

function antdPopupOptionDispatchSource(locator: string, optionName?: string, options: { stabilizeAfterClickMs?: number } = {}) {
  const source = antdSelectOptionDispatchSource(locator, optionName, { includeHoverEvents: true });
  return options.stabilizeAfterClickMs ? `${source}\nawait page.waitForTimeout(${options.stabilizeAfterClickMs});` : source;
}

function antdSelectOptionDispatchSource(locator: string, optionName?: string, options: { includeHoverEvents?: boolean } = {}) {
  const hoverLines = options.includeHoverEvents ? [
    `  element.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, view: window }));`,
    `  element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));`,
    `  element.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, cancelable: true, view: window }));`,
  ] : [];
  if (!optionName) {
    return [
      `await ${locator}.last().evaluate(element => {`,
      ...hoverLines,
      `  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));`,
      `  element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));`,
      `  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));`,
      `});`,
    ].join('\n');
  }
  return [
    `await ${locator}.first().waitFor({ state: "visible", timeout: 10000 });`,
    `await ${locator}.evaluateAll((elements, expectedText) => {`,
    `  const normalize = (value) => (value || "").replace(/\\s+/g, " ").trim();`,
    `  const expected = normalize(expectedText);`,
    `  const element = elements.find(element => normalize(element.getAttribute("title")) === expected || normalize(element.textContent) === expected) || elements[elements.length - 1];`,
    `  if (!element)`,
    `    throw new Error(\`AntD option not found: \${expected}\`);`,
    `  const text = normalize(element.textContent);`,
    `  if (text !== expected && normalize(element.getAttribute("title")) !== expected)`,
    `    throw new Error(\`AntD option text mismatch: expected \${expected}, got \${text}\`);`,
    `  if (element.getAttribute("aria-disabled") === "true" || element.classList.contains("ant-select-item-option-disabled"))`,
    `    throw new Error(\`AntD option is disabled: \${expected}\`);`,
    ...hoverLines,
    `  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));`,
    `  element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));`,
    `  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));`,
    `}, ${stringLiteral(optionName)});`,
  ].join('\n');
}

function rawSelectOptionTitle(step: FlowStep) {
  const selector = rawAction(step.rawAction).selector || step.target?.selector || step.target?.locator || '';
  const match = selector.match(/internal:attr=\[title=(?:\\"|\")([^\\"]+)(?:\\"|")i\]/) || selector.match(/\[title=["']([^"']+)["']\]/);
  return match?.[1];
}

function globalTestIdLocator(step: FlowStep) {
  if (step.target?.testId)
    return `page.getByTestId(${stringLiteral(step.target.testId)})`;
  const contextControlType = step.context?.before.target?.controlType || '';
  const contextDialogType = step.context?.before.dialog?.type;
  if (/(select|tree-select|cascader)-option/.test(contextControlType) || contextDialogType === 'dropdown')
    return undefined;
  const testId = step.context?.before.target?.testId;
  if (testId)
    return `page.getByTestId(${stringLiteral(testId)})`;
  return undefined;
}

function tableScopedLocator(step: FlowStep) {
  const table = step.target?.scope?.table || step.context?.before.table;
  const targetName = targetNameForLocator(step);
  const role = step.target?.role || 'button';
  if (!table?.testId || !targetName)
    return undefined;

  const rowIdentity = table.rowIdentity;
  const stableRowValue = table.rowKey || (rowIdentity?.stable ? rowIdentity.value : undefined);
  if (stableRowValue) {
    const rowSelector = `tr[data-row-key="${stableRowValue}"], [data-row-key="${stableRowValue}"]`;
    const rowLocator = `page.getByTestId(${stringLiteral(table.testId)}).locator(${stringLiteral(rowSelector)})`;
    if (role === 'row')
      return `${rowLocator}.first()`;
    return rowLocator +
      `.filter({ has: page.getByRole(${stringLiteral(role)}, { name: ${stringLiteral(targetName)} }) })` +
      `.first()` +
      `.getByRole(${stringLiteral(role)}, { name: ${stringLiteral(targetName)} })`;
  }

  const fallbackRowText = rowIdentity?.value || table.rowText;
  if (fallbackRowText) {
    const rowLocator = `page.getByTestId(${stringLiteral(table.testId)})` +
      `.locator(${stringLiteral('tr, [role="row"]')})` +
      `.filter({ hasText: ${stringLiteral(fallbackRowText)} })`;
    if (role === 'row')
      return `${rowLocator}.first()`;
    return `${rowLocator}.getByRole(${stringLiteral(role)}, { name: ${stringLiteral(targetName)} })`;
  }
  return undefined;
}

function dialogScopedLocator(step: FlowStep) {
  const dialog = step.target?.scope?.dialog || step.context?.before.dialog;
  const targetName = targetNameForLocator(step);
  if (!dialog || !targetName)
    return undefined;
  const role = step.target?.role || 'button';
  if (dialog.testId)
    return `page.getByTestId(${stringLiteral(dialog.testId)}).getByRole(${stringLiteral(role)}, { name: ${stringLiteral(targetName)} })`;
  if (!dialog.title)
    return undefined;
  return `page.locator(${stringLiteral('.ant-modal, .ant-drawer, [role="dialog"]')})` +
    `.filter({ hasText: ${stringLiteral(dialog.title)} })` +
    `.getByRole(${stringLiteral(role)}, { name: ${stringLiteral(targetName)} })`;
}

function sectionScopedLocator(step: FlowStep) {
  const section = step.target?.scope?.section || step.context?.before.section;
  const targetName = targetNameForLocator(step);
  if (!section?.testId || !targetName)
    return undefined;
  const role = step.target?.role || 'button';
  return `page.getByTestId(${stringLiteral(section.testId)}).getByRole(${stringLiteral(role)}, { name: ${stringLiteral(targetName)} })`;
}

function choiceControlLocator(step: FlowStep) {
  if (step.action !== 'click' && step.action !== 'check' && step.action !== 'uncheck')
    return undefined;
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  if (!/^(checkbox|radio|switch)$/.test(controlType) && !/^(checkbox|radio|switch)$/.test(step.target?.role || ''))
    return undefined;
  const text = step.target?.text || step.target?.name || step.target?.displayName || step.target?.label;
  if (!text)
    return undefined;
  const dialog = step.target?.scope?.dialog || step.context?.before.dialog;
  const base = dialog?.title ? `page.getByRole('dialog', { name: ${stringLiteral(dialog.title)} })` : 'page';
  return `${base}.locator('label').filter({ hasText: ${stringLiteral(text)} })`;
}

function fieldLocator(step: FlowStep) {
  if (step.target?.role === 'button' || step.context?.before.target?.controlType === 'button')
    return undefined;
  const label = step.target?.label || step.target?.scope?.form?.label || step.context?.before.form?.label;
  const controlType = step.context?.before.target?.controlType;
  if (label && (controlType === 'select' || controlType === 'tree-select' || step.target?.role === 'combobox'))
    return antdSelectFieldLocator(step) || `page.getByRole('combobox', { name: ${stringLiteral(label)} })`;
  if (label)
    return `page.getByLabel(${stringLiteral(label)})`;
  if (step.target?.placeholder)
    return `page.getByPlaceholder(${stringLiteral(step.target.placeholder)})`;
  return undefined;
}

function globalRoleLocator(step: FlowStep) {
  const targetName = targetNameForLocator(step);
  const pageCount = step.target?.locatorHint?.pageCount ?? step.context?.before.target?.uniqueness?.pageCount;
  if (pageCount && pageCount > 1)
    return undefined;
  if (step.target?.role && targetName)
    return `page.getByRole(${stringLiteral(step.target.role)}, { name: ${stringLiteral(targetName)} })`;
  return undefined;
}

function fallbackTextLocator(step: FlowStep) {
  const text = step.target?.text || step.target?.displayName || step.target?.name;
  return text ? `page.getByText(${stringLiteral(text)})` : undefined;
}

function targetNameForLocator(step: FlowStep) {
  return step.target?.name || step.target?.text || step.target?.displayName;
}

function rawAction(value: unknown) {
  const record = value && typeof value === 'object' ? value as { action?: Record<string, unknown> } & Record<string, unknown> : {};
  const action = record.action && typeof record.action === 'object' ? record.action : record;
  return action as {
    name?: string;
    selector?: string;
    url?: string;
    text?: string;
    value?: string;
    timeout?: number;
    key?: string;
    options?: string[];
    files?: string[];
  };
}

export function generateAssertionCodePreview(flow: BusinessFlow) {
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

function renderAssertion(assertion: FlowAssertion) {
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

function normalizeActionSource(sourceCode?: string) {
  return sourceCode
      ?.split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
}

function parameterizeLine(line: string, step: FlowStep, segment: FlowRepeatSegment, rowValues?: Record<string, string>) {
  const parameter = segment.parameters.find(parameter => parameter.enabled && parameter.sourceStepId === step.id);
  if (!parameter?.currentValue)
    return line;
  const replacement = rowValues ? stringLiteral(rowValues[parameter.id] ?? parameter.currentValue) : `String(row.${parameter.variableName})`;
  return line
      .replaceAll(JSON.stringify(parameter.currentValue), replacement)
      .replaceAll(`'${escapeSingleQuoted(parameter.currentValue)}'`, replacement)
      .replaceAll(`"${parameter.currentValue.replace(/"/g, '\\"')}"`, replacement);
}

function replaceTemplateValues(value: string, segment: FlowRepeatSegment) {
  return segment.parameters.reduce((current, parameter) => {
    return current.replaceAll(`{{${parameter.variableName}}}`, `row.${parameter.variableName}`);
  }, value);
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

function locatorExpressionForSelector(selector: unknown) {
  if (typeof selector !== 'string' || !selector.trim())
    return undefined;
  try {
    return `page.${asLocator('javascript', selector)}`;
  } catch {
    return `page.locator(${stringLiteral(selector)})`;
  }
}

function stringLiteral(value: unknown) {
  return JSON.stringify(String(value ?? ''));
}
