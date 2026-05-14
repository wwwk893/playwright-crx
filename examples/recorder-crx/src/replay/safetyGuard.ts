/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { FlowStep } from '../flow/types';
import type { LocatorRiskSeverity } from './locatorTypes';
import { locatorBlacklistRisks } from './locatorBlacklist';
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
  const sourceFindings = emittedSourceSafetyFindings(source, safety?.impact);
  const mergedSafety = mergeSafetyFindings(safety, sourceFindings);
  if (!mergedSafety || mergedSafety.status === 'pass')
    return source;
  if (mergedSafety.status === 'blocked')
    return [blockedSafetySource(mergedSafety, step, options)];
  if (options.parserSafe)
    return source;
  if (!source?.length)
    return source;
  const before = renderSafetyChecks(mergedSafety, 'before-action', step);
  const after = renderSafetyChecks(mergedSafety, 'after-action', step);
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
  const text = normalizedCriticalText(criticalActionText(recipe, step));
  return /\b(delete|remove|confirm|ok|destroy|trash)\b/i.test(text) || /删除|移除|确\s*定|确认/.test(text) ? 'critical' : 'normal';
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
  return [];
}

function emittedSourceSafetyFindings(source: string[] | undefined, impact: SafetyGuardImpact | undefined): SafetyGuardFinding[] {
  if (impact !== 'critical' || !source?.length)
    return [];
  const emitted = source
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('//'))
      .join('\n');
  if (!emitted)
    return [];
  const findings: SafetyGuardFinding[] = [];
  if (/(^|[.\s])getByText\s*\(|internal:text=|\btext=/.test(emitted)) {
    findings.push({
      severity: 'critical',
      code: 'critical-action-emitted-text-fallback',
      reason: 'BAGLC safety guard blocked critical action from using emitted text fallback source',
      evidence: sourceEvidenceSnippet(emitted, /(^|[.\s])getByText\s*\(|internal:text=|\btext=/),
    });
  }
  for (const risk of locatorBlacklistRisks(emitted)) {
    if (risk.severity !== 'critical' && risk.severity !== 'high')
      continue;
    if ((risk.code === 'ordinal-locator' || risk.code === 'long-css-locator') && isScopedOrdinalEvidenceSource(emitted))
      continue;
    findings.push({
      severity: 'critical',
      code: `critical-action-emitted-${risk.code}`,
      reason: `BAGLC safety guard blocked critical action from emitted brittle locator source: ${risk.reason}`,
      evidence: risk.evidence,
    });
  }
  return uniqueFindings(findings);
}

function isScopedOrdinalEvidenceSource(source: string) {
  return isScopedOverlayConfirmSource(source) || isScopedRowKeyActionSource(source) || isScopedRowTextActionSource(source);
}

function isScopedOverlayConfirmSource(source: string) {
  const confirmButton = /\.last\(\)\.getByRole\(["']button["']/.test(source) && /确定|确 定|确认|OK|Ok|ok|Yes|yes/.test(source);
  if (!confirmButton)
    return false;
  return /\.ant-popover/.test(source) && /:has\(\.ant-popconfirm-buttons\)/.test(source) ||
    /\.ant-modal:not|\.ant-drawer:not|\[role=\\"dialog\\"\]:visible|\[role="dialog"\]:visible/.test(source);
}

function isScopedRowKeyActionSource(source: string) {
  return /data-row-key=/.test(source) && /\.first\(\)\.(?:getByTestId|getByRole|locator)\(/.test(source);
}

function isScopedRowTextActionSource(source: string) {
  const hasRowContainer = /tr, \[role=\\?"row\\?"\], \.ant-table-row/.test(source) || /(?:^|[,\s])tr(?:[,\s]|$)/.test(source) && /\.ant-table-row/.test(source);
  const hasRowTextScope = /\.filter\(\{\s*hasText\s*:\s*\//.test(source);
  const hasStrongActionAnchor = /\.getByTestId\(/.test(source) ||
    /\.getByRole\(["']button["']/.test(source) ||
    /\.locator\([^)]*(?:data-testid|data-e2e-action|data-e2e-role)/.test(source);
  const hasScopedOrdinalClick = /\.(?:first|nth)\s*\([^)]*\)\.click\s*\(/.test(source);
  return hasRowContainer && hasRowTextScope && hasStrongActionAnchor && hasScopedOrdinalClick;
}

function mergeSafetyFindings(safety: SafetyPreflight | undefined, findings: SafetyGuardFinding[]) {
  if (!findings.length)
    return safety;
  const merged: SafetyPreflight = safety || {
    version: 1,
    impact: 'critical',
    status: 'pass',
    findings: [],
    checks: [],
  };
  const allFindings = uniqueFindings([...merged.findings, ...findings]);
  const blockingFinding = allFindings.find(finding => finding.severity === 'critical');
  return {
    ...merged,
    impact: 'critical' as const,
    findings: allFindings,
    status: blockingFinding ? 'blocked' as const : merged.checks.length ? 'preflight' as const : 'pass' as const,
    blockedReason: blockingFinding?.reason || merged.blockedReason,
  };
}

function uniqueFindings(findings: SafetyGuardFinding[]) {
  const seen = new Set<string>();
  return findings.filter(finding => {
    const key = `${finding.code}\n${finding.evidence || ''}`;
    if (seen.has(key))
      return false;
    seen.add(key);
    return true;
  });
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

function normalizedCriticalText(value: string) {
  return value
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[-_:/]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
}

function sourceEvidenceSnippet(value: string, pattern: RegExp) {
  const match = value.match(pattern);
  const text = match?.[0] || value;
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
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
