/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

export function looksLikeStructuralDialogTargetTestId(testId: string, dialogTestId?: string, options: { isDialogOpener?: boolean } = {}) {
  if (dialogTestId && testId === dialogTestId)
    return true;
  if (options.isDialogOpener)
    return false;
  return /(^|[-_])(modal|dialog|drawer|form|container|wrapper|root)$/i.test(testId) ||
    /(^|[-_])(section|card|content|region)$/i.test(testId);
}

export function looksLikeDialogOpenerTestId(testId: string) {
  return /(^|[-_])(create|add|new|open|edit)([-_]|$)|新建|创建|添加|新增|打开|编辑/i.test(testId);
}
