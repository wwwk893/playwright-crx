/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import type { RecordedTargetSnapshot, RowTargetSnapshot, SnapshotNeighbor } from './adaptiveTargetTypes';
import type { RowIdentity } from './pageContextTypes';
import type { FlowTargetScope, LocatorHint } from './types';

const sensitiveWordPattern = /\b(password|passwd|pwd|token|cookie|authorization|auth|secret|session|apikey|api-key|credential|bearer)\b/ig;
const sensitiveWholePattern = /(authorization|bearer|api\s*token|access\s*token|accesstoken|password|cookie|secret|session)/i;
const jwtPattern = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const longTokenPattern = /\b[A-Za-z0-9+/=_-]{64,}\b/g;
const maxTextLength = 120;

export function redactRecordedTargetSnapshot(snapshot: RecordedTargetSnapshot): RecordedTargetSnapshot {
  return {
    ...snapshot,
    testId: redactDiagnosticText(snapshot.testId),
    dataE2E: redactDiagnosticText(snapshot.dataE2E),
    accessibleName: redactText(snapshot.accessibleName),
    ariaLabel: redactText(snapshot.ariaLabel),
    labelText: redactText(snapshot.labelText),
    placeholder: redactText(snapshot.placeholder),
    title: redactText(snapshot.title),
    normalizedText: redactText(snapshot.normalizedText),
    scope: redactScope(snapshot.scope),
    locatorHint: redactLocatorHint(snapshot.locatorHint),
    row: redactRowSnapshot(snapshot.row),
    diagnosticAttributes: snapshot.diagnosticAttributes ? {
      type: redactDiagnosticText(snapshot.diagnosticAttributes.type),
      name: redactDiagnosticText(snapshot.diagnosticAttributes.name),
      id: redactDiagnosticText(snapshot.diagnosticAttributes.id),
      classTokens: snapshot.diagnosticAttributes.classTokens?.map(token => redactDiagnosticText(token) ?? '').filter(Boolean),
      dataRowKey: redactDiagnosticText(snapshot.diagnosticAttributes.dataRowKey),
    } : undefined,
    parent: redactNeighbor(snapshot.parent),
    siblings: snapshot.siblings?.map(redactNeighbor).filter(Boolean) as SnapshotNeighbor[] | undefined,
    domPath: snapshot.domPath?.map(part => truncate(part)),
  };
}

function redactRowSnapshot(row?: RowTargetSnapshot): RowTargetSnapshot | undefined {
  if (!row)
    return undefined;
  return {
    ...row,
    tableTestId: redactDiagnosticText(row.tableTestId),
    tableTitle: redactText(row.tableTitle),
    rowIdentity: redactRowIdentity(row.rowIdentity),
    rowKey: redactDiagnosticText(row.rowKey),
    rowTextSummary: redactText(row.rowTextSummary),
    keyCells: row.keyCells?.map(cell => ({
      ...cell,
      columnName: redactText(cell.columnName),
      text: redactText(cell.text) ?? '',
    })),
    columnName: redactText(row.columnName),
    actionName: redactText(row.actionName),
    actionRole: redactText(row.actionRole),
    fingerprint: redactDiagnosticText(row.fingerprint),
  };
}

function redactScope(scope?: FlowTargetScope): FlowTargetScope | undefined {
  if (!scope)
    return undefined;
  return {
    dialog: scope.dialog ? {
      ...scope.dialog,
      title: redactText(scope.dialog.title),
      testId: redactDiagnosticText(scope.dialog.testId),
    } : undefined,
    section: scope.section ? {
      ...scope.section,
      title: redactText(scope.section.title),
      testId: redactDiagnosticText(scope.section.testId),
    } : undefined,
    table: scope.table ? {
      ...scope.table,
      title: redactText(scope.table.title),
      testId: redactDiagnosticText(scope.table.testId),
      rowKey: redactDiagnosticText(scope.table.rowKey),
      rowText: redactText(scope.table.rowText),
      rowIdentity: redactRowIdentity(scope.table.rowIdentity),
      columnName: redactText(scope.table.columnName),
      fingerprint: redactDiagnosticText(scope.table.fingerprint),
    } : undefined,
    form: scope.form ? {
      ...scope.form,
      title: redactText(scope.form.title),
      label: redactText(scope.form.label),
      name: redactDiagnosticText(scope.form.name),
      testId: redactDiagnosticText(scope.form.testId),
    } : undefined,
  };
}

function redactRowIdentity(rowIdentity?: RowIdentity): RowIdentity | undefined {
  if (!rowIdentity)
    return undefined;
  return {
    ...rowIdentity,
    value: redactDiagnosticText(rowIdentity.value),
  };
}

function redactLocatorHint(locatorHint?: LocatorHint): LocatorHint | undefined {
  if (!locatorHint)
    return undefined;
  return {
    ...locatorHint,
    reason: redactText(locatorHint.reason),
  };
}

function redactNeighbor(neighbor?: SnapshotNeighbor): SnapshotNeighbor | undefined {
  if (!neighbor)
    return undefined;
  return {
    ...neighbor,
    accessibleName: redactText(neighbor.accessibleName),
    normalizedText: redactText(neighbor.normalizedText),
    testId: redactText(neighbor.testId),
  };
}

function redactDiagnosticText(value?: string) {
  if (!value)
    return value;
  if (sensitiveWholePattern.test(value) || sensitiveWordPattern.test(value)) {
    sensitiveWordPattern.lastIndex = 0;
    return '***';
  }
  sensitiveWordPattern.lastIndex = 0;
  return redactText(value);
}

function redactText(value?: string) {
  if (!value)
    return value;
  const normalized = value.replace(jwtPattern, '***').replace(longTokenPattern, '***');
  if (sensitiveWholePattern.test(normalized) && normalized.replace(sensitiveWordPattern, '').trim().length <= 8)
    return '***';
  if (/^(api\s*)?token$/i.test(normalized.trim()))
    return '***';
  if (/^(authorization|bearer|access\s*token|accesstoken|password|cookie|secret|session)/i.test(normalized.trim()))
    return '***';
  const redacted = normalized.replace(sensitiveWordPattern, '***');
  if (/^(\*{3}\s*)+$/.test(redacted.trim()))
    return '***';
  return truncate(redacted);
}

function truncate(value: string) {
  return value.length > maxTextLength ? `${value.slice(0, maxTextLength)}...***truncated***` : value;
}
