# ProTable / ProForm / Table / Form 全覆盖设计

本文件把 AntD `Form` / `Table` 与 ProComponents `ProForm` / `ProTable` 提升为一等对象。云端 agent 不允许只做 Select、DatePicker、Modal 等原子组件；企业后台的核心页面通常是 `Form + Table + ProTable + ProForm` 的组合。

## 1. 总体原则

### 1.1 Form / Table 是上下文根，不只是普通 DOM

`Form.Item`、`Table`、`ProTable` 不只是一个可点击元素，它们给后续 intent、断言、AI 输入提供业务上下文：

```text
Form.Item.label     → 字段语义
Form.name / field name → 测试数据变量名
Table.title         → 业务对象集合
Table.rowKey        → 行身份
Table.columnTitle   → 当前动作列/字段
ProTable.search     → 查询动作
ProTable.toolbar    → 新建/批量动作
ProTable.rowAction  → 查看/编辑/删除
```

### 1.2 ProForm / ProTable 是组合语义，不要降级成裸 AntD

例如 `ProFormSelect` 最终 DOM 仍然是 AntD Select，但业务语义应该是：

```json
{
  "library": "pro-components",
  "component": "pro-form-field",
  "fieldKind": "pro-form-select",
  "fieldLabel": "WAN",
  "fieldName": "wan",
  "antdComponent": "select"
}
```

`ProTable` 里点击“新建”不应只表达成 `click-button`，而应尽量表达成：

```json
{
  "kind": "protable-toolbar-action",
  "tableTitle": "IP 端口地址池",
  "targetText": "新建"
}
```

## 2. 数据模型补充

修改 `examples/recorder-crx/src/uiSemantics/types.ts`。

### 2.1 扩展 UiComponentKind

必须包含：

```ts
export type UiComponentKind =
  | 'form'
  | 'form-item'
  | 'pro-form'
  | 'pro-form-field'
  | 'table'
  | 'table-row'
  | 'table-cell'
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
  | ...;
```

### 2.2 扩展 UiFormContext

```ts
export interface UiFormContext {
  formKind?: 'antd-form' | 'pro-form' | 'modal-form' | 'drawer-form' | 'steps-form' | 'beta-schema-form';
  formTitle?: string;
  formName?: string;
  fieldKind?:
    | 'input'
    | 'textarea'
    | 'input-number'
    | 'select'
    | 'tree-select'
    | 'cascader'
    | 'date-picker'
    | 'range-picker'
    | 'time-picker'
    | 'switch'
    | 'checkbox'
    | 'radio-group'
    | 'upload'
    | 'pro-form-text'
    | 'pro-form-select'
    | 'pro-form-date-picker'
    | 'pro-form-date-range-picker'
    | 'pro-form-list'
    | 'unknown';
  label?: string;
  name?: string;
  dataIndex?: string;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  status?: 'error' | 'warning' | 'success' | 'validating';
}
```

### 2.3 扩展 UiTableContext

```ts
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
```

### 2.4 扩展 UiActionRecipe.kind

必须包含：

```ts
export type UiActionRecipeKind =
  | 'fill-form-field'
  | 'select-option'
  | 'pick-date'
  | 'pick-range'
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
```

## 3. AntD Form 覆盖

### 3.1 识别 selector

```text
.ant-form
.ant-form-item
.ant-form-item-label label
.ant-form-item-control
.ant-form-item-explain
.ant-form-item-extra
.ant-input
.ant-input-number-input
.ant-select
.ant-picker
.ant-switch
.ant-checkbox-wrapper
.ant-radio-group
.ant-upload
```

### 3.2 必采字段

```text
formKind
formTitle
fieldKind
field label
field name / id / dataIndex
required
placeholder
status
help/error text
root test id
input test id
```

### 3.3 Form action recipe

| 场景 | Recipe |
|---|---|
| 输入文本 | `fill-form-field` |
| 选择下拉 | `select-option` |
| 选择日期 | `pick-date` / `pick-range` |
| 开关/复选/单选 | `toggle-control` |
| 上传 | `upload-file` |
| 点击提交 | `submit-form` |
| 点击重置 | `reset-form` |

### 3.4 伪代码

```ts
export function collectAntdFormContext(target: Element): Partial<UiSemanticContext> | undefined {
  const formItem = closestBySelectors(target, ['[data-testid*="-field"]', '[data-e2e-field]', '.ant-form-item']);
  const form = closestBySelectors(target, ['.ant-form']);
  if (!formItem && !form)
    return undefined;

  const labelEl = formItem?.querySelector('.ant-form-item-label label, [data-e2e-field-label]');
  const inputEl = formItem?.querySelector('input, textarea, .ant-select, .ant-picker, .ant-switch, .ant-checkbox-wrapper, .ant-radio-group, .ant-upload');

  const fieldKind = detectAntdFieldKind(inputEl || target);
  const label = textOf(labelEl);
  const name = (inputEl as HTMLInputElement | null)?.name || inputEl?.getAttribute('id') || formItem?.getAttribute('data-field-name') || undefined;

  return {
    library: 'antd',
    component: formItem ? 'form-item' : 'form',
    form: {
      formKind: 'antd-form',
      fieldKind,
      label,
      name,
      required: !!formItem?.querySelector('.ant-form-item-required'),
      placeholder: (inputEl as HTMLInputElement | null)?.placeholder || undefined,
      helpText: textOf(formItem?.querySelector('.ant-form-item-explain, .ant-form-item-extra')),
      status: detectFormStatus(formItem),
    },
    targetTestId: testIdOf(inputEl) || testIdOf(formItem) || testIdOf(form),
    locatorHints: buildFormLocatorHints(formItem, labelEl, inputEl),
    confidence: label || inputEl ? 0.86 : 0.5,
    reasons: ['matched AntD Form/Form.Item'],
  };
}
```

## 4. ProForm 覆盖

### 4.1 必须识别的 ProForm 字段

| ProComponents 字段 | AntD 落点 | fieldKind |
|---|---|---|
| `ProFormText` | `.ant-input` | `pro-form-text` |
| `ProFormTextArea` | `textarea.ant-input` | `textarea` |
| `ProFormDigit` | `.ant-input-number-input` | `input-number` |
| `ProFormSelect` | `.ant-select` | `pro-form-select` |
| `ProFormTreeSelect` | `.ant-select-tree` | `tree-select` |
| `ProFormCascader` | `.ant-cascader` | `cascader` |
| `ProFormDatePicker` | `.ant-picker` | `pro-form-date-picker` |
| `ProFormDateRangePicker` | `.ant-picker-range` | `pro-form-date-range-picker` |
| `ProFormSwitch` | `.ant-switch` | `switch` |
| `ProFormCheckbox` | `.ant-checkbox` | `checkbox` |
| `ProFormRadio.Group` | `.ant-radio-group` | `radio-group` |
| `ProFormUploadButton` | `.ant-upload` | `upload` |
| `ProFormList` | repeated `.ant-form-item` blocks | `pro-form-list` |

### 4.2 识别策略

ProForm 本身最终还是 AntD Form DOM，所以第一版不能强依赖 React 组件名。识别顺序：

```text
1. data-testid / data-e2e / data-field-kind 明确标识；
2. .ant-pro-form / .ant-pro-form-* class；
3. ModalForm/DrawerForm/StepsForm 内的 .ant-form；
4. field wrapper 或 input DOM 形态推断。
```

### 4.3 ProForm context

```ts
export function collectProFormContext(target: Element): Partial<UiSemanticContext> | undefined {
  const proFormRoot = closestBySelectors(target, [
    '[data-testid^="pro-form:"]',
    '[data-e2e^="pro-form:"]',
    '.ant-pro-form',
    '.ant-modal .ant-form',
    '.ant-drawer .ant-form',
  ]);

  const formCtx = collectAntdFormContext(target);
  if (!proFormRoot && !formCtx)
    return undefined;

  const fieldKind = detectProFormFieldKind(target, formCtx?.form?.fieldKind);

  return {
    ...formCtx,
    library: 'pro-components',
    component: 'pro-form-field',
    form: {
      ...formCtx?.form,
      formKind: detectProFormKind(target),
      fieldKind,
    },
    recipe: buildUiRecipe({
      ...formCtx,
      library: 'pro-components',
      component: 'pro-form-field',
      form: { ...formCtx?.form, fieldKind },
    } as UiSemanticContext),
    reasons: [...(formCtx?.reasons || []), 'matched ProForm field'],
  };
}
```

## 5. AntD Table 覆盖

### 5.1 识别 selector

```text
.ant-table-wrapper
.ant-table
.ant-table-thead th
.ant-table-tbody tr
tr[data-row-key]
td.ant-table-cell
.ant-table-row-selected
.ant-table-pagination
.ant-pagination
```

### 5.2 必采字段

```text
tableKind
root test id
title / card title / section title
headers
rowKey
rowText
columnTitle
columnKey / dataIndex if present
region = table-body / row-action / pagination / batch-toolbar / unknown
selectedRowCount
current page
pageSize
```

### 5.3 伪代码

```ts
export function collectAntdTableContext(target: Element): Partial<UiSemanticContext> | undefined {
  const wrapper = closestBySelectors(target, ['[data-testid^="table:"]', '.ant-table-wrapper', '.ant-table']);
  if (!wrapper)
    return undefined;

  const row = closestBySelectors(target, ['tr[data-row-key]', '[data-row-key]', '[data-testid$="-row"]']);
  const cell = closestBySelectors(target, ['td', 'th']);
  const headers = collectTableHeaders(wrapper);
  const columnTitle = resolveColumnTitle(cell, headers);
  const title = collectTableTitle(wrapper);

  return {
    library: 'antd',
    component: 'table',
    table: {
      tableKind: 'antd-table',
      title,
      rowKey: row?.getAttribute('data-row-key') || row?.getAttribute('data-row-id') || undefined,
      rowText: textOf(row)?.slice(0, 160),
      columnTitle,
      headers,
      region: detectTableRegion(target, wrapper),
      selectedRowCount: wrapper.querySelectorAll('tr.ant-table-row-selected').length,
      currentPage: textOf(wrapper.querySelector('.ant-pagination-item-active')),
      pageSize: textOf(wrapper.querySelector('.ant-pagination-options .ant-select-selection-item')),
    },
    targetTestId: testIdOf(target) || testIdOf(row) || testIdOf(wrapper),
    confidence: row || headers.length ? 0.86 : 0.58,
    reasons: ['matched AntD Table'],
  };
}
```

## 6. ProTable 覆盖

### 6.1 ProTable 分区

ProTable 必须识别这些 region：

```text
search form
toolbar
batch toolbar / selected row alert
table body
row action
pagination
editable cell
```

### 6.2 selector

```text
.ant-pro-table
.ant-pro-table-search
.ant-pro-table-list-toolbar
.ant-pro-table-list-toolbar-title
.ant-pro-table-alert
.ant-table-wrapper
tr[data-row-key]
.ant-table-cell
.ant-pagination
```

### 6.3 ProTable recipe

| 区域 | 操作 | Recipe |
|---|---|---|
| search form | 查询 | `protable-search` |
| search form | 重置 | `protable-reset-search` |
| toolbar | 新建/导入/导出 | `protable-toolbar-action` |
| row action | 查看/编辑/删除/启用 | `table-row-action` |
| batch toolbar | 批量删除/批量启用 | `table-batch-action` |
| pagination | 页码/pageSize | `paginate` |
| sortable header | 排序 | `sort-table` |
| filter dropdown | 筛选 | `filter-table` |

### 6.4 伪代码

```ts
export function collectProTableContext(target: Element): Partial<UiSemanticContext> | undefined {
  const root = closestBySelectors(target, ['[data-testid^="protable:"]', '.ant-pro-table']);
  if (!root)
    return undefined;

  const tableCtx = collectAntdTableContext(target);
  const title = textOf(root.querySelector('.ant-pro-table-list-toolbar-title')) || tableCtx?.table?.title;
  const region = detectProTableRegion(target, root);

  return {
    ...tableCtx,
    library: 'pro-components',
    component: region === 'editable-cell' ? 'editable-pro-table' : 'pro-table',
    table: {
      ...tableCtx?.table,
      tableKind: region === 'editable-cell' ? 'editable-pro-table' : 'pro-table',
      title,
      region,
    },
    recipe: buildProTableRecipe(target, root, { ...tableCtx?.table, title, region }),
    confidence: Math.max(tableCtx?.confidence || 0, 0.88),
    reasons: [...(tableCtx?.reasons || []), 'matched ProTable'],
  };
}
```

## 7. EditableProTable 覆盖

EditableProTable 必须以 `rowKey + columnTitle/dataIndex` 表达，不能按第几行第几列。

### 7.1 必采字段

```text
rowKey
rowText
columnTitle
dataIndex if exposed
field label
editable state
save/cancel/delete action
validation error
```

### 7.2 recipe

```json
{
  "kind": "editable-table-cell",
  "rowKey": "WAN1",
  "columnTitle": "MTU",
  "fieldLabel": "MTU"
}
```

保存行：

```json
{
  "kind": "editable-table-save-row",
  "rowKey": "WAN1",
  "tableTitle": "共享 WAN"
}
```

取消行：

```json
{
  "kind": "editable-table-cancel-row",
  "rowKey": "WAN1"
}
```

## 8. Form/Table 对 intent 的影响

新增 intent 规则：

```ts
if (recipe.kind === 'protable-search')
  return `查询${recipe.tableTitle || '列表'}`;

if (recipe.kind === 'protable-toolbar-action' && recipe.targetText)
  return `${recipe.targetText}${recipe.tableTitle || ''}`;

if (recipe.kind === 'table-row-action' && recipe.targetText && recipe.rowKey && recipe.tableTitle)
  return `${recipe.targetText}${recipe.rowKey}${recipe.tableTitle}`;

if (recipe.kind === 'editable-table-cell' && recipe.rowKey && recipe.columnTitle)
  return `编辑${recipe.rowKey}的${recipe.columnTitle}`;

if (recipe.kind === 'submit-form' && recipe.formTitle)
  return `提交${recipe.formTitle}`;

if (recipe.kind === 'fill-form-field' && recipe.fieldLabel)
  return `填写${recipe.fieldLabel}`;
```

## 9. compact-flow.yaml 输出

必须输出：

```yaml
ui:
  library: pro-components
  component: pro-table
  recipe: table-row-action
  table: 共享 WAN
  row: WAN1
  column: 操作
  target: 编辑
```

ProForm 字段：

```yaml
ui:
  library: pro-components
  component: pro-form-field
  recipe: select-option
  formKind: modal-form
  fieldKind: pro-form-select
  field: WAN
  option: WAN2
  overlay: 新建共享 WAN
```

## 10. 验收

必须有测试覆盖：

```text
AntD Form.Item label + input
AntD Form submit/reset
AntD Table row action
AntD Table pagination
ProFormText / ProFormSelect / ProFormDatePicker
ProTable search form 查询/重置
ProTable toolbar 新建
ProTable row edit/delete
EditableProTable cell edit/save/cancel
ModalForm submit
DrawerForm submit
StepsForm next/prev/submit
ProDescriptions item label/value
PageContainer title/breadcrumb/tab/extra action
```
