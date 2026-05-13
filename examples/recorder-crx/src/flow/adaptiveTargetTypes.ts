/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import type { FlowActionType } from './types';
import type { RowIdentity } from './pageContextTypes';

export type AdaptiveLocatorCandidateKind = 'testid' | 'table-row' | 'role' | 'label' | 'text' | 'css';

export interface AdaptiveLocatorCandidate {
  kind: AdaptiveLocatorCandidateKind;
  value: string;
  score: number;
  reason: string;
  scope?: 'page' | 'dialog' | 'drawer' | 'section' | 'table' | 'form' | 'overlay';
}

export interface AdaptiveTargetCoreSnapshot {
  testId?: string;
  role?: string;
  name?: string;
  displayName?: string;
  label?: string;
  placeholder?: string;
  text?: string;
  title?: string;
  ariaLabel?: string;
  selector?: string;
  locator?: string;
  controlType?: string;
}

export interface AdaptiveTableRowSnapshot {
  tableTestId?: string;
  tableTitle?: string;
  rowKey?: string;
  rowText?: string;
  rowIdentity?: RowIdentity;
  columnName?: string;
  nestingLevel?: number;
  fixedSide?: 'left' | 'right';
}

export interface AdaptiveTargetContextSnapshot {
  url?: string;
  pageTitle?: string;
  dialogTitle?: string;
  sectionTitle?: string;
  formLabel?: string;
  formName?: string;
}

export interface AdaptiveTargetSnapshot {
  version: 1;
  stepId: string;
  action: FlowActionType;
  capturedAt: string;
  target: AdaptiveTargetCoreSnapshot;
  tableRow?: AdaptiveTableRowSnapshot;
  context?: AdaptiveTargetContextSnapshot;
  candidates: AdaptiveLocatorCandidate[];
}
