/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

export type LocatorCandidateKind =
  | 'testid'
  | 'row-scoped-testid'
  | 'row-scoped-role'
  | 'dialog-scoped-testid'
  | 'dialog-scoped-role'
  | 'field-label'
  | 'active-popup-option'
  | 'visible-popconfirm-confirm'
  | 'role'
  | 'text'
  | 'css'
  | 'xpath'
  | 'ordinal'
  | 'raw-selector';

export type LocatorRiskSeverity = 'low' | 'medium' | 'high' | 'critical';

export type LocatorCandidateScope =
  | 'page'
  | 'dialog'
  | 'drawer'
  | 'form'
  | 'table-row'
  | 'active-popup'
  | 'popconfirm'
  | 'unknown';

export interface LocatorRisk {
  severity: LocatorRiskSeverity;
  code: string;
  reason: string;
  evidence?: string;
}

export interface LocatorCandidatePayload {
  testId?: string;
  role?: string;
  name?: string;
  text?: string;
  label?: string;
  tableTestId?: string;
  tableTitle?: string;
  rowKey?: string;
  rowText?: string;
  dialogTitle?: string;
  dialogTestId?: string;
  dialogType?: string;
  optionText?: string;
  searchText?: string;
}

export interface LocatorCandidate {
  kind: LocatorCandidateKind;
  value: string;
  scope: LocatorCandidateScope;
  payload?: LocatorCandidatePayload;
  score: number;
  risk: LocatorRiskSeverity;
  reasons: string[];
  risks: LocatorRisk[];
  diagnosticsOnly: true;
}

export interface LocatorContract {
  version: 1;
  diagnosticsOnly: true;
  primaryDiagnostic?: LocatorCandidate;
  primaryExecutable?: LocatorCandidate;
  primary?: LocatorCandidate;
  candidates: LocatorCandidate[];
  risks: LocatorRisk[];
}
