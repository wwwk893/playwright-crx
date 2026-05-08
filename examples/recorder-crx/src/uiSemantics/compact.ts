/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { UiActionRecipe, UiSemanticContext } from './types';

export interface CompactUiSemanticContext {
  [key: string]: string | number | boolean | undefined;
  library?: string;
  component?: string;
  recipe?: string;
  formKind?: string;
  fieldKind?: string;
  field?: string;
  fieldName?: string;
  option?: string;
  table?: string;
  row?: string;
  column?: string;
  overlay?: string;
  target?: string;
  targetTestId?: string;
  confidence?: number;
  weak?: boolean;
}

export function compactUiSemanticContext(ui?: UiSemanticContext, recipe?: UiActionRecipe): CompactUiSemanticContext | undefined {
  if (!ui && !recipe)
    return undefined;
  return compactObject({
    library: ui?.library || recipe?.library,
    component: ui?.component || recipe?.component,
    recipe: recipe?.kind || ui?.recipe?.kind,
    formKind: recipe?.formKind || ui?.form?.formKind,
    fieldKind: recipe?.fieldKind || ui?.form?.fieldKind,
    field: recipe?.fieldLabel || ui?.form?.label,
    fieldName: recipe?.fieldName || ui?.form?.name,
    option: recipe?.optionText || ui?.option?.text,
    table: recipe?.tableTitle || ui?.table?.title,
    row: recipe?.rowKey || ui?.table?.rowKey,
    column: recipe?.columnTitle || ui?.table?.columnTitle,
    overlay: recipe?.overlayTitle || ui?.overlay?.title,
    target: recipe?.targetText || ui?.targetText,
    targetTestId: ui?.targetTestId,
    confidence: ui?.confidence,
    weak: ui?.weak || undefined,
  });
}

function compactObject<T extends Record<string, unknown>>(object: T): Partial<T> | undefined {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined || value === '' || (Array.isArray(value) && !value.length))
      continue;
    result[key as keyof T] = value as T[keyof T];
  }
  return Object.keys(result).length ? result : undefined;
}
