/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

export type {
  LegacyUiActionRecipeKind,
  UiActionFramework,
  UiActionOperation,
  UiActionRecipe,
  UiActionRecipeComponent,
  UiActionRecipeOption,
  UiActionRecipeTarget,
  UiActionReplayContract,
  UiReplayExportedStrategy,
  UiReplayParserSafeStrategy,
  UiReplayRuntimeFallback,
} from '../uiSemantics/recipes';

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
