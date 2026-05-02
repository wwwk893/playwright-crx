/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import type { FlowActionType, FlowTargetScope, LocatorHint } from './types';
import type { RowIdentity, UiControlType, UiFramework } from './pageContextTypes';

export type AdaptiveTargetRef =
  | `step:${string}`
  | `assertion:${string}`;

export interface AdaptiveTargetRecord {
  version: 1;
  ref: AdaptiveTargetRef;
  stepId?: string;
  assertionId?: string;
  action?: FlowActionType;
  capturedAt: string;
  source: 'page-context-sidecar' | 'recorder-action' | 'assertion-picker';
  snapshot: RecordedTargetSnapshot;
  locatorCandidates: LocatorCandidate[];
}

export interface RecordedTargetSnapshot {
  version: 1;
  tagName?: string;
  role?: string;
  controlType?: UiControlType;
  framework?: UiFramework;
  testId?: string;
  dataE2E?: string;
  accessibleName?: string;
  ariaLabel?: string;
  labelText?: string;
  placeholder?: string;
  title?: string;
  normalizedText?: string;
  scope?: FlowTargetScope;
  locatorHint?: LocatorHint;
  row?: RowTargetSnapshot;
  diagnosticAttributes?: DiagnosticAttributes;
  parent?: SnapshotNeighbor;
  siblings?: SnapshotNeighbor[];
  domPath?: string[];
  domDepth?: number;
  bbox?: SnapshotBoundingBox;
}

export interface RowTargetSnapshot {
  tableTestId?: string;
  tableTitle?: string;
  rowIdentity?: RowIdentity;
  rowKey?: string;
  rowTextSummary?: string;
  keyCells?: Array<{
    columnName?: string;
    text: string;
  }>;
  columnName?: string;
  actionName?: string;
  actionRole?: string;
  nestingLevel?: number;
  fixedSide?: 'left' | 'right';
  fingerprint?: string;
}

export interface DiagnosticAttributes {
  type?: string;
  name?: string;
  id?: string;
  classTokens?: string[];
  dataRowKey?: string;
}

export interface SnapshotNeighbor {
  tagName?: string;
  role?: string;
  accessibleName?: string;
  normalizedText?: string;
  testId?: string;
}

export interface SnapshotBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LocatorCandidateKind =
  | 'testid'
  | 'data-e2e'
  | 'role'
  | 'label'
  | 'placeholder'
  | 'text'
  | 'table-row'
  | 'antd-select-option'
  | 'antd-tree-select-option'
  | 'antd-cascader-option'
  | 'scoped-css'
  | 'xpath';

export interface LocatorCandidate {
  kind: LocatorCandidateKind;
  value: string;
  score: number;
  reason: string;
  scope?: 'page' | 'dialog' | 'section' | 'table' | 'form';
  pageCount?: number;
  scopeCount?: number;
  strict?: boolean;
}
