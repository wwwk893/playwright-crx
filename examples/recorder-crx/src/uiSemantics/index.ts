/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { collectAntdSemanticContext } from './antd';
import { mergeBusinessHints } from './businessHints';
import { collectProComponentsContext } from './proComponents';
import { buildUiRecipe } from './recipes';
import type { UiSemanticContext } from './types';

export function collectUiSemanticContext(target: Element, document: Document = target.ownerDocument): UiSemanticContext {
  const antd = collectAntdSemanticContext(target, document);
  const pro = collectProComponentsContext(target, antd);
  const merged = mergeBusinessHints(target, pro);
  const recipe = buildUiRecipe(merged);
  return {
    ...merged,
    recipe,
  };
}

export type { UiActionRecipe, UiComponentKind, UiFormContext, UiLibrary, UiLocatorHint, UiOverlayContext, UiOptionContext, UiSemanticContext, UiTableContext } from './types';
export { compactUiSemanticContext } from './compact';
