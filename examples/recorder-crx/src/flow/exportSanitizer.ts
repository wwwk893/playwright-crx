/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import type { StepContextSnapshot } from './pageContextTypes';
import type { BusinessFlow, FlowAssertion, FlowAssertionParams, FlowTarget } from './types';
import { sanitizeTerminalAssertionParams } from './terminalAssertions';
import type { UiActionRecipe, UiSemanticContext } from '../uiSemantics/types';

export function prepareBusinessFlowForExport(flow: BusinessFlow, code?: string): BusinessFlow {
  const artifacts = { ...flow.artifacts };
  delete artifacts.deletedStepIds;
  delete artifacts.deletedActionIndexes;
  delete artifacts.deletedActionSignatures;
  delete artifacts.stepActionIndexes;
  delete artifacts.stepMergedActionIndexes;
  delete (artifacts as Record<string, unknown>).adaptiveTargets;
  delete (artifacts as Record<string, unknown>).locatorCandidates;
  delete (artifacts as Record<string, unknown>).replayFailureDiagnostics;
  delete artifacts.recorder;
  return {
    ...flow,
    steps: flow.steps.map(step => {
      const exportStep = { ...step };
      delete exportStep.rawAction;
      delete exportStep.sourceCode;
      return {
        ...exportStep,
        uiRecipe: sanitizeUiRecipe(step.uiRecipe),
        target: sanitizeFlowTarget(step.target),
        context: sanitizeStepContext(step.context),
        assertions: step.assertions.map(sanitizeFlowAssertion),
        url: compactUrl(step.url),
      };
    }),
    artifacts: {
      ...artifacts,
      playwrightCode: code,
    },
    updatedAt: new Date().toISOString(),
  };
}

function sanitizeFlowAssertion(assertion: FlowAssertion): FlowAssertion {
  return {
    ...assertion,
    target: sanitizeFlowTarget(assertion.target),
    params: sanitizeAssertionParams(assertion.params),
  };
}

function sanitizeAssertionParams(params?: FlowAssertionParams): FlowAssertionParams | undefined {
  if (!params)
    return undefined;
  const terminal = sanitizeTerminalAssertionParams(params) || {};
  const legacyAllowed = ['url', 'targetSummary', 'message', 'method', 'status', 'requestContains'];
  for (const key of legacyAllowed) {
    const value = params[key];
    if (value !== undefined && value !== '')
      terminal[key] = value;
  }
  return compactObject(terminal) as FlowAssertionParams;
}

function sanitizeFlowTarget(target?: FlowTarget): FlowTarget | undefined {
  if (!target)
    return undefined;
  return {
    ...target,
    raw: sanitizeRawTarget(target.raw),
  };
}

function sanitizeRawTarget(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return undefined;
  const rawRecord = raw as Record<string, unknown>;
  const target = rawRecord.target && typeof rawRecord.target === 'object' && !Array.isArray(rawRecord.target) ? sanitizeUnknownElementTarget(rawRecord.target as Record<string, unknown>) : undefined;
  const ui = sanitizeUiSemanticContext(rawRecord.ui as UiSemanticContext | undefined);
  return compactObject({ target, ui });
}

function sanitizeStepContext(context?: StepContextSnapshot): StepContextSnapshot | undefined {
  if (!context)
    return undefined;
  return {
    ...context,
    before: sanitizePageContext(context.before),
    after: context.after ? sanitizePageContextAfter(context.after) : undefined,
  };
}

function sanitizePageContext(snapshot: StepContextSnapshot['before']): StepContextSnapshot['before'] {
  return compactObject({
    url: compactUrl(snapshot.url),
    title: snapshot.title,
    breadcrumb: snapshot.breadcrumb,
    activeTab: snapshot.activeTab,
    dialog: snapshot.dialog,
    ancestor: snapshot.ancestor ? compactObject({
      title: snapshot.ancestor.title,
      kind: snapshot.ancestor.kind,
      testId: snapshot.ancestor.testId,
      attributes: sanitizeAncestorAttributes(snapshot.ancestor.attributes),
    }) as StepContextSnapshot['before']['ancestor'] : undefined,
    section: snapshot.section,
    table: snapshot.table ? compactObject({
      title: snapshot.table.title,
      testId: snapshot.table.testId,
      rowKey: snapshot.table.rowKey,
      rowIndex: snapshot.table.rowIndex,
      ariaRowIndex: snapshot.table.ariaRowIndex,
      columnName: snapshot.table.columnName,
      columnIndex: snapshot.table.columnIndex,
      headers: snapshot.table.headers,
      nestingLevel: snapshot.table.nestingLevel,
      parentTitle: snapshot.table.parentTitle,
      fixedSide: snapshot.table.fixedSide,
      rowKind: snapshot.table.rowKind,
      expandedParentRowKey: snapshot.table.expandedParentRowKey,
    }) as StepContextSnapshot['before']['table'] : undefined,
    form: snapshot.form,
    target: sanitizeElementContext(snapshot.target),
    ui: sanitizeUiSemanticContext(snapshot.ui),
  }) as StepContextSnapshot['before'];
}

function sanitizePageContextAfter(snapshot: NonNullable<StepContextSnapshot['after']>): NonNullable<StepContextSnapshot['after']> {
  return compactObject({
    url: compactUrl(snapshot.url),
    title: snapshot.title,
    breadcrumb: snapshot.breadcrumb,
    activeTab: snapshot.activeTab,
    dialog: snapshot.dialog,
    openedDialog: snapshot.openedDialog,
    toast: snapshot.toast,
  }) as NonNullable<StepContextSnapshot['after']>;
}

function sanitizeElementContext(target?: StepContextSnapshot['before']['target']): StepContextSnapshot['before']['target'] | undefined {
  if (!target)
    return undefined;
  return compactObject({
    tag: target.tag,
    role: target.role,
    testId: target.testId,
    ariaLabel: target.ariaLabel,
    title: target.title,
    text: target.text,
    placeholder: target.placeholder,
    selectedOption: target.selectedOption,
    normalizedText: target.normalizedText,
    framework: target.framework,
    controlType: target.controlType,
    locatorQuality: target.locatorQuality,
    optionPath: target.optionPath,
    uniqueness: target.uniqueness,
  }) as StepContextSnapshot['before']['target'];
}

function sanitizeAncestorAttributes(attributes?: Record<string, string>) {
  if (!attributes)
    return undefined;
  const allowed: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (!/^data-[\w-]+$/.test(key))
      continue;
    if (/password|passwd|pwd|token|cookie|authorization|auth|secret|session/i.test(key) || /password|passwd|pwd|token|cookie|authorization|auth|secret|session/i.test(value))
      continue;
    allowed[key] = value;
  }
  return Object.keys(allowed).length ? allowed : undefined;
}

function sanitizeUnknownElementTarget(target: Record<string, unknown>) {
  return compactObject({
    tag: typeof target.tag === 'string' ? target.tag : undefined,
    role: typeof target.role === 'string' ? target.role : undefined,
    testId: typeof target.testId === 'string' ? target.testId : undefined,
    ariaLabel: typeof target.ariaLabel === 'string' ? target.ariaLabel : undefined,
    title: typeof target.title === 'string' ? target.title : undefined,
    text: typeof target.text === 'string' ? target.text : undefined,
    placeholder: typeof target.placeholder === 'string' ? target.placeholder : undefined,
  });
}

function sanitizeUiSemanticContext(ui?: UiSemanticContext): UiSemanticContext | undefined {
  if (!ui)
    return undefined;
  return compactObject({
    library: ui.library,
    component: ui.component,
    targetText: ui.targetText,
    targetTestId: ui.targetTestId,
    form: ui.form ? compactObject({
      formKind: ui.form.formKind,
      formTitle: ui.form.formTitle,
      formName: ui.form.formName,
      testId: ui.form.testId,
      fieldKind: ui.form.fieldKind,
      label: ui.form.label,
      name: ui.form.name,
      dataIndex: ui.form.dataIndex,
      required: ui.form.required,
      placeholder: ui.form.placeholder,
      status: ui.form.status,
    }) : undefined,
    table: ui.table ? compactObject({
      tableKind: ui.table.tableKind,
      title: ui.table.title,
      tableId: ui.table.tableId,
      testId: ui.table.testId,
      rowKey: ui.table.rowKey,
      columnKey: ui.table.columnKey,
      columnTitle: ui.table.columnTitle,
      dataIndex: ui.table.dataIndex,
      selectedRowCount: ui.table.selectedRowCount,
      totalText: ui.table.totalText,
      currentPage: ui.table.currentPage,
      pageSize: ui.table.pageSize,
      region: ui.table.region,
    }) : undefined,
    overlay: ui.overlay ? compactObject({
      type: ui.overlay.type,
      title: ui.overlay.title,
      visible: ui.overlay.visible,
    }) : undefined,
    option: ui.option ? compactObject({
      text: ui.option.text,
      path: ui.option.path,
    }) : undefined,
    recipe: sanitizeUiRecipe(ui.recipe),
    confidence: ui.confidence,
    weak: ui.weak,
  }) as UiSemanticContext | undefined;
}

function sanitizeUiRecipe(recipe?: UiActionRecipe): UiActionRecipe | undefined {
  if (!recipe)
    return undefined;
  return compactObject({
    kind: recipe.kind,
    library: recipe.library,
    component: recipe.component,
    formKind: recipe.formKind,
    fieldKind: recipe.fieldKind,
    fieldLabel: recipe.fieldLabel,
    fieldName: recipe.fieldName,
    optionText: recipe.optionText,
    tableTitle: recipe.tableTitle,
    rowKey: recipe.rowKey,
    columnTitle: recipe.columnTitle,
    overlayTitle: recipe.overlayTitle,
    targetText: recipe.targetText,
  }) as UiActionRecipe | undefined;
}

function compactUrl(value?: string) {
  if (!value)
    return undefined;
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.origin === 'null' ? url.href : `${url.origin}${url.pathname}`;
  } catch {
    return value.split(/[?#]/)[0];
  }
}

function compactObject<T extends Record<string, unknown>>(object: T): Partial<T> | undefined {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined || value === '' || (Array.isArray(value) && !value.length))
      continue;
    result[key as keyof T] = value as T[keyof T];
  }
  return Object.keys(result).length ? result : undefined;
}
