/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { locatorBlacklistRisks, maxRiskSeverity } from './locatorBlacklist';
import type { LocatorCandidate, LocatorCandidateKind, LocatorCandidatePayload, LocatorCandidateScope, LocatorRisk } from './locatorTypes';

export function createLocatorCandidate(input: {
  kind: LocatorCandidateKind;
  value?: string;
  scope: LocatorCandidateScope;
  payload?: LocatorCandidatePayload;
  reasons: string[];
  baseScore: number;
  risks?: LocatorRisk[];
}): LocatorCandidate | undefined {
  const value = normalizedValue(input.value);
  if (!value)
    return undefined;
  const risks = [...(input.risks || []), ...locatorBlacklistRisks(value)];
  const risk = maxRiskSeverity(risks);
  return {
    kind: input.kind,
    value,
    scope: input.scope,
    payload: cleanPayload(input.payload),
    score: Math.max(0, input.baseScore - riskPenalty(risk)),
    risk,
    reasons: input.reasons,
    risks,
    diagnosticsOnly: true,
  };
}

function cleanPayload(payload?: LocatorCandidatePayload) {
  if (!payload)
    return undefined;
  const cleaned: LocatorCandidatePayload = {};
  for (const [key, value] of Object.entries(payload)) {
    const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    if (text)
      (cleaned as Record<string, string>)[key] = text;
  }
  return Object.keys(cleaned).length ? cleaned : undefined;
}

export function rankLocatorCandidates(candidates: LocatorCandidate[]) {
  return uniqueCandidates(candidates)
      .sort((left, right) => right.score - left.score || riskRank(left.risk) - riskRank(right.risk) || left.kind.localeCompare(right.kind));
}

export function aggregateLocatorRisks(candidates: LocatorCandidate[], extraValues: string[] = []) {
  const risks = new Map<string, LocatorRisk>();
  for (const candidate of candidates) {
    for (const risk of candidate.risks)
      risks.set(`${risk.code}:${risk.evidence || ''}`, risk);
  }
  for (const value of extraValues) {
    for (const risk of locatorBlacklistRisks(value))
      risks.set(`${risk.code}:${risk.evidence || ''}`, risk);
  }
  return [...risks.values()].sort((left, right) => riskRank(right.severity) - riskRank(left.severity) || left.code.localeCompare(right.code));
}

function uniqueCandidates(candidates: LocatorCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter(candidate => {
    const key = `${candidate.kind}:${candidate.scope}:${candidate.value}`;
    if (seen.has(key))
      return false;
    seen.add(key);
    return true;
  });
}

function normalizedValue(value?: string) {
  const text = value?.replace(/\s+/g, ' ').trim();
  return text || undefined;
}

function riskPenalty(risk: LocatorRisk['severity']) {
  if (risk === 'critical')
    return 700;
  if (risk === 'high')
    return 420;
  if (risk === 'medium')
    return 160;
  return 0;
}

function riskRank(risk: LocatorRisk['severity']) {
  return risk === 'critical' ? 3 : risk === 'high' ? 2 : risk === 'medium' ? 1 : 0;
}
