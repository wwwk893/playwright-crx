/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import type { StepContextSnapshot } from './pageContextTypes';
import type { BusinessFlow } from './types';
import type { UiSemanticContext } from '../uiSemantics/types';

export function prepareBusinessFlowForExport(flow: BusinessFlow, code?: string): BusinessFlow {
  const artifacts = { ...flow.artifacts };
  delete artifacts.deletedStepIds;
  delete artifacts.deletedActionIndexes;
  delete artifacts.deletedActionSignatures;
  delete artifacts.stepActionIndexes;
  delete artifacts.stepMergedActionIndexes;
  delete artifacts.recorder;
  return {
    ...flow,
    steps: flow.steps.map(step => ({
      ...step,
      context: sanitizeStepContext(step.context),
    })),
    artifacts: {
      ...artifacts,
      playwrightCode: code,
    },
    updatedAt: new Date().toISOString(),
  };
}

function sanitizeStepContext(context?: StepContextSnapshot): StepContextSnapshot | undefined {
  if (!context)
    return undefined;
  return {
    ...context,
    before: {
      ...context.before,
      ui: sanitizeUiSemanticContext(context.before.ui),
    },
    after: context.after ? { ...context.after } : undefined,
  };
}

function sanitizeUiSemanticContext(ui?: UiSemanticContext): UiSemanticContext | undefined {
  if (!ui)
    return undefined;
  const sanitized = {
    ...ui,
    table: ui.table ? {
      tableKind: ui.table.tableKind,
      title: ui.table.title,
      rowKey: ui.table.rowKey,
      columnKey: ui.table.columnKey,
      columnTitle: ui.table.columnTitle,
      dataIndex: ui.table.dataIndex,
      selectedRowCount: ui.table.selectedRowCount,
      totalText: ui.table.totalText,
      currentPage: ui.table.currentPage,
      pageSize: ui.table.pageSize,
      region: ui.table.region,
    } : undefined,
    overlay: ui.overlay ? {
      type: ui.overlay.type,
      title: ui.overlay.title,
      visible: ui.overlay.visible,
    } : undefined,
    option: ui.option ? {
      text: ui.option.text,
      path: ui.option.path,
    } : undefined,
  };
  delete (sanitized as Partial<UiSemanticContext>).locatorHints;
  delete (sanitized as Partial<UiSemanticContext>).reasons;
  return sanitized as UiSemanticContext;
}
