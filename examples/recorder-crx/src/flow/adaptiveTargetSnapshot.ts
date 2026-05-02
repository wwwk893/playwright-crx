/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import { redactRecordedTargetSnapshot } from './adaptiveTargetRedactor';
import type { RecordedTargetSnapshot, RowTargetSnapshot } from './adaptiveTargetTypes';
import type { StepContextSnapshot } from './pageContextTypes';
import type { FlowStep, FlowTargetScope } from './types';

export function recordedTargetSnapshotFromStep(step: FlowStep): RecordedTargetSnapshot | undefined {
  const context = step.context;
  const contextTarget = context?.before.target;
  const target = step.target;
  if (!contextTarget && !target)
    return undefined;

  const snapshot: RecordedTargetSnapshot = {
    version: 1,
    tagName: contextTarget?.tag,
    role: target?.role || contextTarget?.role,
    controlType: contextTarget?.controlType,
    framework: contextTarget?.framework,
    testId: target?.testId || contextTarget?.testId,
    accessibleName: target?.name || contextTarget?.ariaLabel,
    ariaLabel: contextTarget?.ariaLabel,
    labelText: target?.label || context?.before.form?.label,
    placeholder: target?.placeholder || contextTarget?.placeholder,
    title: contextTarget?.title,
    normalizedText: target?.text || contextTarget?.normalizedText || contextTarget?.text,
    scope: target?.scope || scopeFromContext(context),
    locatorHint: target?.locatorHint,
    row: rowSnapshotFromContext(step, context),
  };

  return redactRecordedTargetSnapshot(snapshot);
}

function rowSnapshotFromContext(step: FlowStep, context?: StepContextSnapshot): RowTargetSnapshot | undefined {
  const table = context?.before.table;
  if (!table)
    return undefined;
  const actionName = step.target?.name || step.target?.text || context?.before.target?.text || context?.before.target?.ariaLabel;
  return {
    tableTestId: table.testId,
    tableTitle: table.title,
    rowIdentity: table.rowIdentity,
    rowKey: table.rowKey,
    rowTextSummary: table.rowText,
    keyCells: table.columnName && table.rowText ? [{ columnName: table.columnName, text: table.rowText }] : undefined,
    columnName: table.columnName,
    actionName,
    actionRole: step.target?.role || context?.before.target?.role,
    nestingLevel: table.nestingLevel,
    fixedSide: table.fixedSide,
    fingerprint: table.fingerprint,
  };
}

function scopeFromContext(context?: StepContextSnapshot): FlowTargetScope | undefined {
  if (!context)
    return undefined;
  const { dialog, section, table, form } = context.before;
  const scope: FlowTargetScope = {};
  if (dialog) {
    scope.dialog = {
      type: dialog.type,
      title: dialog.title,
      testId: dialog.testId,
      visible: dialog.visible,
    };
  }
  if (section) {
    scope.section = {
      title: section.title,
      testId: section.testId,
      kind: section.kind,
    };
  }
  if (table) {
    scope.table = {
      title: table.title,
      testId: table.testId,
      rowKey: table.rowKey,
      rowText: table.rowText,
      rowIdentity: table.rowIdentity,
      columnName: table.columnName,
      nestingLevel: table.nestingLevel,
      fixedSide: table.fixedSide,
      fingerprint: table.fingerprint,
    };
  }
  if (form) {
    scope.form = {
      title: form.title,
      label: form.label,
      name: form.name,
      testId: form.testId,
    };
  }
  return Object.keys(scope).length ? scope : undefined;
}
