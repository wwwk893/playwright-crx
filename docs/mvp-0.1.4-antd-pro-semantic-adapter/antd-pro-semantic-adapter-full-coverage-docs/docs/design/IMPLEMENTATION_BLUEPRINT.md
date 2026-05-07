# 实现蓝图：文件、函数、伪代码

本文件给云端 agent 一份可直接执行的代码改造蓝图。

## 1. 新增文件

```text
examples/recorder-crx/src/uiSemantics/
├─ types.ts
├─ dom.ts
├─ antd.ts
├─ proComponents.ts
├─ recipes.ts
├─ compact.ts
└─ index.ts
```

## 2. 修改文件

```text
examples/recorder-crx/src/flow/pageContextTypes.ts
examples/recorder-crx/src/pageContextSidecar.ts
examples/recorder-crx/src/flow/types.ts
examples/recorder-crx/src/flow/flowBuilder.ts
examples/recorder-crx/src/flow/flowContextMerger.ts
examples/recorder-crx/src/flow/intentRules.ts
examples/recorder-crx/src/flow/compactExporter.ts
examples/recorder-crx/src/aiIntent/* 或当前 AI input 构建文件
```

## 3. types.ts

```ts
export type UiLibrary = 'antd' | 'pro-components' | 'unknown';

export type UiComponentKind =
  | 'button'
  | 'form'
  | 'form-item'
  | 'input'
  | 'input-number'
  | 'select'
  | 'tree-select'
  | 'cascader'
  | 'auto-complete'
  | 'date-picker'
  | 'range-picker'
  | 'time-picker'
  | 'modal'
  | 'drawer'
  | 'dropdown'
  | 'menu'
  | 'popover'
  | 'popconfirm'
  | 'tooltip'
  | 'table'
  | 'pagination'
  | 'tabs'
  | 'steps'
  | 'upload'
  | 'switch'
  | 'checkbox'
  | 'radio-group'
  | 'tree'
  | 'collapse'
  | 'card'
  | 'pro-form'
  | 'pro-form-field'
  | 'pro-table'
  | 'pro-table-search'
  | 'pro-table-toolbar'
  | 'editable-pro-table'
  | 'modal-form'
  | 'drawer-form'
  | 'steps-form'
  | 'beta-schema-form'
  | 'pro-descriptions'
  | 'page-container'
  | 'pro-card'
  | 'pro-list'
  | 'unknown';

export interface UiLocatorHint {
  kind: 'testid' | 'role' | 'label' | 'text' | 'css';
  value: string;
  score: number;
  reason: string;
}

export interface UiOverlayContext {
  type?: 'modal' | 'drawer' | 'dropdown' | 'select-dropdown' | 'picker-dropdown' | 'popover' | 'popconfirm' | 'tooltip';
  title?: string;
  text?: string;
  visible?: boolean;
}

export interface UiFormContext {
  formKind?: 'antd-form' | 'pro-form' | 'modal-form' | 'drawer-form' | 'steps-form' | 'beta-schema-form';
  formTitle?: string;
  formName?: string;
  fieldKind?: string;
  label?: string;
  name?: string;
  dataIndex?: string;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  status?: 'error' | 'warning' | 'success' | 'validating';
}

export interface UiTableContext {
  tableKind?: 'antd-table' | 'pro-table' | 'editable-pro-table' | 'pro-list';
  title?: string;
  rowKey?: string;
  rowText?: string;
  columnKey?: string;
  columnTitle?: string;
  dataIndex?: string;
  headers?: string[];
  selectedRowCount?: number;
  totalText?: string;
  currentPage?: string;
  pageSize?: string;
  region?: 'search' | 'toolbar' | 'table-body' | 'row-action' | 'pagination' | 'batch-toolbar' | 'editable-cell' | 'unknown';
}

export interface UiOptionContext {
  text?: string;
  value?: string;
  path?: string[];
}

export interface UiActionRecipe {
  kind:
    | 'click-button'
    | 'fill-form-field'
    | 'select-option'
    | 'pick-date'
    | 'pick-range'
    | 'pick-time'
    | 'toggle-control'
    | 'upload-file'
    | 'submit-form'
    | 'reset-form'
    | 'protable-search'
    | 'protable-reset-search'
    | 'protable-toolbar-action'
    | 'table-row-action'
    | 'table-batch-action'
    | 'editable-table-cell'
    | 'editable-table-save-row'
    | 'editable-table-cancel-row'
    | 'paginate'
    | 'sort-table'
    | 'filter-table'
    | 'modal-action'
    | 'drawer-action'
    | 'confirm-popconfirm'
    | 'dropdown-menu-action'
    | 'show-tooltip'
    | 'switch-tab'
    | 'switch-step'
    | 'assert-description-field'
    | 'raw-dom-action';
  library: UiLibrary;
  component: UiComponentKind;
  formKind?: string;
  fieldKind?: string;
  fieldLabel?: string;
  fieldName?: string;
  optionText?: string;
  tableTitle?: string;
  rowKey?: string;
  columnTitle?: string;
  overlayTitle?: string;
  targetText?: string;
}

export interface UiSemanticContext {
  library: UiLibrary;
  component: UiComponentKind;
  targetText?: string;
  targetTestId?: string;
  targetRole?: string;
  form?: UiFormContext;
  table?: UiTableContext;
  overlay?: UiOverlayContext;
  option?: UiOptionContext;
  locatorHints: UiLocatorHint[];
  recipe?: UiActionRecipe;
  confidence: number;
  reasons: string[];
}
```

## 4. index.ts

```ts
export function collectUiSemanticContext(target: Element, document: Document): UiSemanticContext {
  const antd = collectAntdSemanticContext(target, document);
  const pro = collectProComponentsContext(target, document, antd);
  const merged = mergeUiContexts(antd, pro);
  return {
    ...merged,
    recipe: buildUiRecipe(merged),
  };
}
```

## 5. pageContextSidecar 接入

```ts
const ui = semanticAdapterEnabled ? collectUiSemanticContext(anchor, document) : undefined;

return {
  ...snapshot,
  ui,
};
```

## 6. flowBuilder 接入

```ts
function flowTargetFromPageContext(snapshot: PageContextSnapshot): FlowTarget | undefined {
  const ui = snapshot.ui;
  const target = snapshot.target;
  const best = ui?.locatorHints?.sort((a, b) => b.score - a.score)[0];

  return {
    testId: ui?.targetTestId || (best?.kind === 'testid' ? best.value : undefined) || target?.testId,
    role: ui?.targetRole || target?.role,
    name: target?.name || ui?.targetText,
    text: ui?.option?.text || ui?.targetText || target?.text,
    label: ui?.form?.label || target?.label,
    placeholder: ui?.form?.placeholder || target?.placeholder,
    displayName: ui?.recipe?.optionText || ui?.recipe?.targetText || ui?.targetText || target?.normalizedText,
    raw: { target, ui },
  };
}
```

`buildSyntheticClickStep`：

```ts
const uiRecipe = before.ui?.recipe;
const action = inferFlowActionFromRecipe(uiRecipe) || 'click';

return {
  ...step,
  action,
  uiRecipe,
};
```

## 7. intentRules 接入

```ts
export function suggestIntentFromUiRecipe(recipe?: UiActionRecipe): IntentSuggestion | undefined {
  if (!recipe)
    return undefined;

  switch (recipe.kind) {
    case 'select-option':
      if (recipe.fieldLabel && recipe.optionText)
        return suggestion(`选择 ${recipe.fieldLabel} 为 ${recipe.optionText}`, 0.93, 'ui.select-option', recipe);
      break;
    case 'fill-form-field':
      if (recipe.fieldLabel)
        return suggestion(`填写${recipe.fieldLabel}`, 0.85, 'ui.fill-form-field', recipe);
      break;
    case 'protable-search':
      return suggestion(`查询${recipe.tableTitle || '列表'}`, 0.88, 'ui.protable-search', recipe);
    case 'protable-toolbar-action':
      if (recipe.targetText)
        return suggestion(`${recipe.targetText}${recipe.tableTitle || ''}`, 0.88, 'ui.protable-toolbar-action', recipe);
      break;
    case 'table-row-action':
      if (recipe.targetText && recipe.rowKey && recipe.tableTitle)
        return suggestion(`${recipe.targetText}${recipe.rowKey}${recipe.tableTitle}`, 0.9, 'ui.table-row-action', recipe);
      break;
    case 'editable-table-cell':
      if (recipe.rowKey && recipe.columnTitle)
        return suggestion(`编辑${recipe.rowKey}的${recipe.columnTitle}`, 0.88, 'ui.editable-table-cell', recipe);
      break;
    case 'confirm-popconfirm':
      if (recipe.targetText)
        return suggestion(`确认${recipe.targetText}`, 0.84, 'ui.confirm-popconfirm', recipe);
      break;
    case 'switch-tab':
      if (recipe.targetText)
        return suggestion(`切换到${recipe.targetText}页签`, 0.86, 'ui.switch-tab', recipe);
      break;
  }

  return undefined;
}
```

## 8. compact.ts

```ts
export function compactUiSemanticContext(ui?: UiSemanticContext, recipe?: UiActionRecipe) {
  if (!ui && !recipe)
    return undefined;

  return {
    library: ui?.library || recipe?.library,
    component: ui?.component || recipe?.component,
    recipe: recipe?.kind || ui?.recipe?.kind,
    formKind: recipe?.formKind || ui?.form?.formKind,
    fieldKind: recipe?.fieldKind || ui?.form?.fieldKind,
    field: recipe?.fieldLabel || ui?.form?.label,
    option: recipe?.optionText || ui?.option?.text,
    table: recipe?.tableTitle || ui?.table?.title,
    row: recipe?.rowKey || ui?.table?.rowKey,
    column: recipe?.columnTitle || ui?.table?.columnTitle,
    overlay: recipe?.overlayTitle || ui?.overlay?.title,
    target: recipe?.targetText || ui?.targetText,
  };
}
```

## 9. settings

如果项目已有 settings：

```ts
semanticAdapterEnabled: true
semanticAdapterDebug?: boolean
```

如加设置成本高，可以先在模块里用常量：

```ts
export const semanticAdapterEnabled = true;
```

## 10. 不做的事

- 不把 `.ant-*` 当最终业务 locator；
- 不改 Playwright recorder/player；
- 不引入 Cypress；
- 不修改业务仓库代码；
- 不把所有组件做成完美 recipe，弱识别也可以，但必须有 context 和测试。
