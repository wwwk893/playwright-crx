/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { collectAntdSemanticContext } from './antd';
import { collectProComponentsContext } from './proComponents';
import { buildUiRecipe } from './recipes';
import type { UiSemanticContext } from './types';

export function collectUiSemanticContext(target: Element, document: Document = target.ownerDocument): UiSemanticContext {
  const antd = collectAntdSemanticContext(target, document);
  const merged = collectProComponentsContext(target, antd);
  const recipe = buildUiRecipe(merged);
  return {
    ...merged,
    recipe,
  };
}

export type { UiActionRecipe, UiComponentKind, UiFormContext, UiLibrary, UiLocatorHint, UiOverlayContext, UiOptionContext, UiSemanticContext, UiTableContext } from './types';
export { compactUiSemanticContext } from './compact';
