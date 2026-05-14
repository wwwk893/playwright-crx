/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { FlowStep } from '../flow/types';
import type { LocatorCandidate, LocatorRiskSeverity } from './locatorTypes';
import type { UiActionRecipe } from './types';

export type SafetyGuardImpact = 'normal' | 'critical';
export type SafetyGuardStatus = 'pass' | 'preflight' | 'blocked';
export type SafetyPreflightTiming = 'before-action' | 'after-action';
export type SafetyPreflightCheckKind = 'visible-modal-root-count' | 'visible-popconfirm-root-count';

export interface SafetyGuardFinding {
  severity: LocatorRiskSeverity;
  code: string;
  reason: string;
  evidence?: string;
}

export interface SafetyPreflightCheck {
  kind: SafetyPreflightCheckKind;
  timing: SafetyPreflightTiming;
  locator: string;
  expectedCount: number;
  reason: string;
}

export interface SafetyPreflight {
  version: 1;
  impact: SafetyGuardImpact;
  status: SafetyGuardStatus;
  findings: SafetyGuardFinding[];
  checks: SafetyPreflightCheck[];
  blockedReason?: string;
}

export function buildSafetyPreflight(recipe: UiActionRecipe, step: FlowStep): SafetyPreflight {
  const impact = criticalActionImpact(recipe, step);
  const findings = [
    ...rowActionFindings(recipe, step),
    ...criticalFallbackFindings(recipe, step, impact),
  ];
  const checks = [
    ...modalRootChecks(recipe, step),
    ...popconfirmRootChecks(recipe, step, impact),
  ];
  const blockingFinding = findings.find(finding => finding.severity === 'critical');
  const status: SafetyGuardStatus = blockingFinding ? 'blocked' : checks.length ? 'preflight' : 'pass';
  return {
    version: 1,
    impact,
    status,
    findings,
    checks,
    blockedReason: blockingFinding?.reason,
  };
}

export function applySafetyPreflightToSource(source: string[] | undefined, safety: SafetyPreflight | undefined, step: FlowStep, options: { parserSafe?: boolean } = {}) {
  if (!safety || safety.status === 'pass')
    return source;
  if (safety.status === 'blocked')
    return [blockedSafetySource(safety, step, options)];
  if (options.parserSafe)
    return source;
  if (!source?.length)
    return source;
  const before = renderSafetyChecks(safety, 'before-action', step);
  const after = renderSafetyChecks(safety, 'after-action', step);
  if (!after.length)
    return [...before, ...source];
  const firstActionIndex = source.findIndex(line => /\.click\(|\.press\(|\.check\(|\.uncheck\(|\.fill\(|\.selectOption\(/.test(line));
  if (firstActionIndex < 0)
    return [...before, ...source, ...after];
  return [
    ...before,
    ...source.slice(0, firstActionIndex + 1),
    ...after,
    ...source.slice(firstActionIndex + 1),
  ];
}

function criticalActionImpact(recipe: UiActionRecipe, step: FlowStep): SafetyGuardImpact {
  if (recipe.operation === 'confirm' || recipe.component === 'PopconfirmButton')
    return 'critical';
  const text = criticalActionText(recipe, step);
  return /(^|[-_\s])(delete|remove|confirm|ok)([-_\s]|$)|删除|移除|确定|确认/i.test(text) ? 'critical' : 'normal';
}

function rowActionFindings(recipe: UiActionRecipe, step: FlowStep): SafetyGuardFinding[] {
  if (recipe.operation !== 'rowAction')
    return [];
  const rowKey = recipe.locatorContract?.primaryDiagnostic?.payload?.rowKey || recipe.rowKey || step.target?.scope?.table?.rowKey || step.context?.before.table?.rowKey;
  if (rowKey)
    return [];
  return [{
    severity: 'critical',
    code: 'row-action-without-row-key',
    reason: 'BAGLC safety guard blocked table row action without rowKey',
    evidence: recipe.locatorContract?.primaryDiagnostic?.payload?.rowText || step.target?.scope?.table?.rowText || step.context?.before.table?.rowText || recipe.targetText || recipe.target?.testId,
  }];
}

function criticalFallbackFindings(recipe: UiActionRecipe, step: FlowStep, impact: SafetyGuardImpact): SafetyGuardFinding[] {
  if (impact !== 'critical')
    return [];
  const primary = recipe.locatorContract?.primaryDiagnostic || recipe.locatorContract?.primary;
  if (!primary) {
    return [{
      severity: 'critical',
      code: 'critical-action-without-locator-contract',
      reason: 'BAGLC safety guard blocked critical action without a locator contract candidate',
      evidence: criticalActionText(recipe, step),
    }];
  }
  if (primary.risk === 'critical' || fallbackCandidate(primary) || inferredRoleCandidateWithoutRoleEvidence(primary, step)) {
    return [{
      severity: 'critical',
      code: 'critical-action-unsafe-locator-fallback',
      reason: 'BAGLC safety guard blocked critical action from using a brittle fallback locator',
      evidence: primary.value,
    }];
  }
  return [];
}

function fallbackCandidate(candidate: LocatorCandidate) {
  return candidate.risk === 'high' || candidate.kind === 'text' || candidate.kind === 'css' || candidate.kind === 'xpath' || candidate.kind === 'ordinal' || candidate.kind === 'raw-selector';
}

function inferredRoleCandidateWithoutRoleEvidence(candidate: LocatorCandidate, step: FlowStep) {
  return candidate.kind === 'role' && !(step.target?.role || step.context?.before.target?.role);
}

function modalRootChecks(recipe: UiActionRecipe, step: FlowStep): SafetyPreflightCheck[] {
  if (step.action !== 'click' && step.action !== 'press')
    return [];
  if (recipe.operation === 'selectOption' || recipe.operation === 'fill' || recipe.operation === 'toggle')
    return [];
  const role = step.target?.role || step.context?.before.target?.role || '';
  const controlType = step.context?.before.target?.controlType || '';
  if (/(select|tree-select|cascader|option|checkbox|radio|switch|input|textarea)/i.test(controlType) || /^(combobox|option|checkbox|radio|switch|textbox)$/i.test(role))
    return [];
  const dialog = step.target?.scope?.dialog || step.context?.before.dialog || recipe.target?.dialog as { title?: string; type?: string; testId?: string; visible?: boolean } | undefined;
  if (!dialog || dialog.type === 'popover' || dialog.type === 'dropdown' || dialog.visible === false)
    return [];
  return [{
    kind: 'visible-modal-root-count',
    timing: 'before-action',
    locator: dialogRootLocator(dialog),
    expectedCount: 1,
    reason: 'BAGLC safety guard requires exactly one visible modal/drawer root before a dialog action',
  }];
}

function popconfirmRootChecks(recipe: UiActionRecipe, step: FlowStep, impact: SafetyGuardImpact): SafetyPreflightCheck[] {
  const dialog = step.target?.scope?.dialog || step.context?.before.dialog || recipe.target?.dialog as { title?: string; type?: string; visible?: boolean } | undefined;
  const opened = step.context?.after?.openedDialog || step.context?.after?.dialog;
  const beforeExplicitConfirm = recipe.operation === 'confirm' || recipe.component === 'PopconfirmButton' || dialog?.type === 'popover';
  const afterDeleteOpener = impact === 'critical' && opened?.type === 'popover';
  if (!beforeExplicitConfirm && !afterDeleteOpener)
    return [];
  return [{
    kind: 'visible-popconfirm-root-count',
    timing: afterDeleteOpener && !beforeExplicitConfirm ? 'after-action' : 'before-action',
    locator: popconfirmRootLocator(beforeExplicitConfirm ? dialog : opened),
    expectedCount: 1,
    reason: 'BAGLC safety guard requires exactly one visible Popconfirm before confirming',
  }];
}

function renderSafetyChecks(safety: SafetyPreflight, timing: SafetyPreflightTiming, step: FlowStep) {
  return safety.checks
      .filter(check => check.timing === timing)
      .map(check => `await expect(${check.locator}, ${stringLiteral(`${check.reason}: ${step.id}`)}).toHaveCount(${check.expectedCount});`);
}

function blockedSafetySource(safety: SafetyPreflight, step: FlowStep, options: { parserSafe?: boolean } = {}) {
  const finding = safety.findings.find(finding => finding.severity === 'critical') || safety.findings[0];
  const message = `BAGLC safety guard blocked ${step.id}: ${finding?.code || 'unsafe-action'}${finding?.evidence ? ` (${finding.evidence})` : ''}`;
  if (options.parserSafe)
    return `await page.locator(${stringLiteral(`[data-baglc-safety-guard-blocked="${step.id}"]`)}).click(); // ${message}`;
  return `await expect(false, ${stringLiteral(message)}).toBeTruthy();`;
}

function criticalActionText(recipe: UiActionRecipe, step: FlowStep) {
  return [
    recipe.kind,
    recipe.operation,
    recipe.component,
    recipe.targetText,
    recipe.target?.testId,
    recipe.target?.text,
    step.target?.testId,
    step.target?.name,
    step.target?.text,
    step.target?.displayName,
    step.context?.before.target?.testId,
    step.context?.before.target?.text,
  ].filter(Boolean).join(' ');
}

function dialogRootLocator(dialog?: { title?: string; type?: string; testId?: string }) {
  if (dialog?.testId)
    return `page.getByTestId(${stringLiteral(dialog.testId)})`;
  const root = dialog?.type === 'drawer'
    ? 'page.locator(".ant-drawer:visible, [role=\\"dialog\\"]:visible")'
    : 'page.locator(".ant-modal:visible, .ant-drawer:visible, [role=\\"dialog\\"]:visible")';
  return dialog?.title ? `${root}.filter({ hasText: ${stringLiteral(dialog.title)} })` : root;
}

function popconfirmRootLocator(dialog?: { title?: string }) {
  const root = 'page.locator(".ant-popover:not(.ant-popover-hidden):not(.ant-zoom-big-leave):not(.ant-zoom-big-leave-active):has(.ant-popconfirm-buttons)")';
  return dialog?.title ? `${root}.filter({ hasText: ${stringLiteral(dialog.title)} })` : root;
}

function stringLiteral(value: string) {
  return JSON.stringify(value);
}
