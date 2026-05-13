/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { UiActionRecipe } from './types';

export type AntDRecipeRendererCapability =
  | 'antd-owned-option-dispatch'
  | 'antd-tree-option-dispatch'
  | 'antd-cascader-path-dispatch'
  | 'field-trigger-search-option'
  | 'active-popup-option'
  | 'field-locator-fill'
  | 'table-row-action'
  | 'table-row-scoped-action'
  | 'popover-confirm'
  | 'dialog-scoped-action';

export function isRecipeBackedAntdSelectOption(recipe: UiActionRecipe | undefined) {
  return !!recipe &&
    recipe.operation === 'selectOption' &&
    recipe.component === 'Select' &&
    (recipe.framework === 'antd' || recipe.framework === 'procomponents') &&
    recipe.replay?.runtimeFallback === 'active-antd-popup-option' &&
    !!(recipe.option?.displayText || recipe.option?.text || recipe.optionText);
}

export function recipeOptionText(recipe: UiActionRecipe | undefined) {
  return recipe?.option?.displayText || recipe?.option?.text || recipe?.optionText;
}

export function recipeOptionSearchText(recipe: UiActionRecipe | undefined) {
  return recipe?.option?.searchText;
}
