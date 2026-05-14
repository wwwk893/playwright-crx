/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import type { UiActionRecipe as SemanticUiActionRecipe } from '../uiSemantics/recipes';
import type { EffectHint } from './effectHints';
import type { LocatorContract } from './locatorTypes';
import type { SafetyPreflight } from './safetyGuard';

export type {
  LegacyUiActionRecipeKind,
  UiActionFramework,
  UiActionOperation,
  UiActionRecipeComponent,
  UiActionRecipeOption,
  UiActionRecipeTarget,
  UiActionReplayContract,
  UiReplayExportedStrategy,
  UiReplayParserSafeStrategy,
  UiReplayRuntimeFallback,
} from '../uiSemantics/recipes';

export type UiActionRecipe = SemanticUiActionRecipe & {
  effectHints?: EffectHint[];
  locatorContract?: LocatorContract;
  safetyPreflight?: SafetyPreflight;
};

export type { LocatorCandidate, LocatorCandidateKind, LocatorCandidatePayload, LocatorCandidateScope, LocatorContract, LocatorRisk, LocatorRiskSeverity } from './locatorTypes';
export type { EffectHint, EffectHintKind } from './effectHints';
export type { SafetyGuardFinding, SafetyGuardImpact, SafetyGuardStatus, SafetyPreflight, SafetyPreflightCheck, SafetyPreflightCheckKind, SafetyPreflightTiming } from './safetyGuard';

export type RuntimeBridgeKind = 'runtime-bridge' | 'dom-dispatch' | 'native-event' | 'none';

export type RenderOptions = {
  mode: 'exported' | 'parser-safe';
  runtimeBridge?: RuntimeBridgeKind;
};

export type RenderedAction = {
  code: string;
  strategy: string;
  runtimeBridge?: RuntimeBridgeKind;
};
