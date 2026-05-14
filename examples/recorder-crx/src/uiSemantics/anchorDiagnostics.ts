/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { centerContained, visuallyEquivalentRects } from './visualOverlap';
import type { RectLike } from './visualOverlap';

export type AnchorCandidateSource = 'target' | 'composedPath' | 'ancestor' | 'pointed' | 'tableScope' | 'portal';

export interface AnchorCandidateContext {
  formLabel?: string;
  fieldName?: string;
  dialogTitle?: string;
  dialogTestId?: string;
  tableTestId?: string;
  rowKey?: string;
  columnKey?: string;
  proComponent?: string;
}

export interface AnchorCandidateEvidence {
  id: string;
  tag: string;
  role?: string;
  text?: string;
  accessibleName?: string;
  testId?: string;
  dataE2e?: string;
  dataE2eAction?: string;
  classTokens?: string[];
  depthFromTarget: number;
  source: AnchorCandidateSource;
  ruleScore: number;
  reasons: string[];
  risks: string[];
  bbox?: RectLike;
  context?: AnchorCandidateContext;
}

export interface BusinessActionGroundingEvidence {
  rawTarget: AnchorCandidateEvidence;
  chosenAnchor: AnchorCandidateEvidence;
  equivalentAnchors: AnchorCandidateEvidence[];
  candidates: AnchorCandidateEvidence[];
  confidence: number;
  reasons: string[];
}

export function scoreAnchorCandidateEvidence(candidate: AnchorCandidateEvidence): AnchorCandidateEvidence {
  const reasons = new Set(candidate.reasons);
  const risks = new Set(candidate.risks);
  const classTokens = new Set(candidate.classTokens || []);
  const tag = candidate.tag.toLowerCase();
  const role = candidate.role;
  let score = 0;

  if (candidate.testId) {
    score += looksLikeActionToken(candidate.testId) ? 1000 : 240;
    reasons.add(looksLikeActionToken(candidate.testId) ? 'business action test id' : 'business test id');
  }
  if (candidate.dataE2eAction) {
    score += 320;
    reasons.add('data-e2e-action');
  }
  if (candidate.dataE2e) {
    score += 220;
    reasons.add('data-e2e');
  }
  if (candidate.context?.rowKey) {
    score += 210;
    reasons.add('row key context');
  }
  if (candidate.context?.tableTestId) {
    score += 140;
    reasons.add('table scope context');
  }
  if (candidate.context?.dialogTitle || candidate.context?.dialogTestId) {
    score += 120;
    reasons.add('dialog scope context');
  }
  if (candidate.context?.formLabel || candidate.context?.fieldName) {
    score += 100;
    reasons.add('form field context');
  }
  if (tag === 'button' || role === 'button' || classTokens.has('ant-btn')) {
    score += 500;
    reasons.add('button semantic');
  }
  if (role === 'option' || classTokens.has('ant-select-item-option')) {
    score += 420;
    reasons.add('option semantic');
  }
  if (role === 'menuitem' || classTokens.has('ant-dropdown-menu-item') || classTokens.has('ant-menu-item')) {
    score += 400;
    reasons.add('menu item semantic');
  }
  if (role === 'tab' || classTokens.has('ant-tabs-tab')) {
    score += 380;
    reasons.add('tab semantic');
  }
  if (classTokens.has('ant-checkbox-wrapper') || classTokens.has('ant-radio-wrapper') || classTokens.has('ant-radio-button-wrapper')) {
    score += 500;
    reasons.add('control wrapper semantic');
  }
  if (classTokens.has('ant-checkbox') || classTokens.has('ant-radio') || classTokens.has('ant-radio-button') || role === 'checkbox' || role === 'radio') {
    score += 350;
    reasons.add('choice control semantic');
  }
  if (classTokens.has('ant-select-selector') || role === 'combobox') {
    score += 420;
    reasons.add('select trigger semantic');
  }
  if (candidate.text || candidate.accessibleName) {
    score += 30;
    reasons.add('visible name');
  }
  if (candidate.source === 'pointed') {
    score += 20;
    reasons.add('pointed element');
  }

  if (classTokens.has('ant-checkbox-input') || classTokens.has('ant-radio-input') || classTokens.has('ant-radio-button-input')) {
    score -= 260;
    risks.add('inner native input');
  }
  if (tag === 'svg' || tag === 'path' || classTokens.has('anticon')) {
    score -= 300;
    risks.add('icon node');
  }
  if (tag === 'span' && !candidate.testId && !candidate.dataE2eAction) {
    score -= 80;
    risks.add('plain span');
  }
  if (candidate.depthFromTarget > 0)
    score -= candidate.depthFromTarget;

  return {
    ...candidate,
    ruleScore: roundScore(score),
    reasons: [...reasons],
    risks: [...risks],
  };
}

export function rankAnchorCandidates(candidates: AnchorCandidateEvidence[]) {
  return candidates
      .map(scoreAnchorCandidateEvidence)
      .sort((left, right) => right.ruleScore - left.ruleScore || left.depthFromTarget - right.depthFromTarget);
}

export function equivalentAnchorCandidates(chosen: AnchorCandidateEvidence, candidates: AnchorCandidateEvidence[]) {
  return candidates.filter(candidate => candidate.id === chosen.id || areEquivalentAnchorCandidates(chosen, candidate));
}

export function areEquivalentAnchorCandidates(left: AnchorCandidateEvidence, right: AnchorCandidateEvidence) {
  if (sameStrictInteractiveFamily(left, right))
    return visuallyEquivalentRects(left.bbox, right.bbox);
  return knownControlSubpartPair(left, right) && nestedSubpartRects(left, right);
}

export function groundingConfidence(chosen: AnchorCandidateEvidence, candidates: AnchorCandidateEvidence[]) {
  if (!candidates.length)
    return 0;
  const runnerUp = candidates.find(candidate => candidate.id !== chosen.id);
  const margin = runnerUp ? Math.max(0, chosen.ruleScore - runnerUp.ruleScore) : 150;
  const base = chosen.ruleScore >= 700 ? 0.86 : chosen.ruleScore >= 420 ? 0.72 : chosen.ruleScore >= 180 ? 0.58 : 0.38;
  return Math.min(0.98, roundScore(base + Math.min(0.12, margin / 2000)));
}

function sameStrictInteractiveFamily(left: AnchorCandidateEvidence, right: AnchorCandidateEvidence) {
  const leftFamily = strictInteractiveFamily(left);
  const rightFamily = strictInteractiveFamily(right);
  return !!leftFamily && leftFamily === rightFamily;
}

function strictInteractiveFamily(candidate: AnchorCandidateEvidence) {
  const classTokens = new Set(candidate.classTokens || []);
  if (candidate.role === 'button' || candidate.tag === 'button' || classTokens.has('ant-btn'))
    return 'button';
  if (candidate.role === 'checkbox' || classTokens.has('ant-checkbox-wrapper'))
    return 'checkbox';
  if (candidate.role === 'radio' || classTokens.has('ant-radio-wrapper') || classTokens.has('ant-radio-button-wrapper'))
    return 'radio';
  if (candidate.role === 'option' || classTokens.has('ant-select-item-option'))
    return 'option';
  if (candidate.role === 'combobox' || classTokens.has('ant-select-selector'))
    return 'select';
  if (candidate.role === 'menuitem' || classTokens.has('ant-menu-item') || classTokens.has('ant-dropdown-menu-item'))
    return 'menu';
  if (candidate.role === 'tab' || classTokens.has('ant-tabs-tab'))
    return 'tab';
  return undefined;
}

function knownControlSubpartPair(left: AnchorCandidateEvidence, right: AnchorCandidateEvidence) {
  return isKnownSubpartOf(left, right) || isKnownSubpartOf(right, left);
}

function isKnownSubpartOf(subpart: AnchorCandidateEvidence, anchor: AnchorCandidateEvidence) {
  const family = strictInteractiveFamily(anchor);
  if (!family)
    return false;
  const classTokens = new Set(subpart.classTokens || []);
  if (subpart.tag === 'svg' || subpart.tag === 'path' || classTokens.has('anticon'))
    return family === 'button';
  if (subpart.tag === 'span')
    return family === 'button' || family === 'option' || family === 'select' || family === 'checkbox' || family === 'radio' || family === 'tab' || family === 'menu';
  if (subpart.tag === 'input')
    return family === 'checkbox' || family === 'radio' || family === 'select';
  if (classTokens.has('ant-checkbox-inner') || classTokens.has('ant-checkbox-input'))
    return family === 'checkbox';
  if (classTokens.has('ant-radio-inner') || classTokens.has('ant-radio-input') || classTokens.has('ant-radio-button-input'))
    return family === 'radio';
  if (classTokens.has('ant-select-selection-item') || classTokens.has('ant-select-selection-search') || classTokens.has('ant-select-selection-search-input'))
    return family === 'select';
  if (classTokens.has('ant-select-item-option-content'))
    return family === 'option';
  return false;
}

function nestedSubpartRects(left: AnchorCandidateEvidence, right: AnchorCandidateEvidence) {
  if (!left.bbox || !right.bbox)
    return false;
  return centerContained(left.bbox, right.bbox) || centerContained(right.bbox, left.bbox);
}

function looksLikeActionToken(value: string) {
  return /(^|[-_])(button|btn|link|tab|switch|checkbox|radio|select|input|create|add|new|save|delete|remove|edit|confirm|cancel|submit|ok|option|menu|action)([-_]|$)/i.test(value);
}

function roundScore(value: number) {
  return Math.round(value * 1000) / 1000;
}
