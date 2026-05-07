你现在位于 playwright-crx fork 仓库根目录。

请实现 MVP 0.1.4：AntD / ProComponents Semantic Adapter 全覆盖版，并创建一个 PR。

## 必读文档

请先完整阅读：

```text
docs/mvp-0.1.4-antd-pro-semantic-adapter/README.md
docs/mvp-0.1.4-antd-pro-semantic-adapter/docs/design/ANTD_PRO_SEMANTIC_ADAPTER.md
docs/mvp-0.1.4-antd-pro-semantic-adapter/docs/design/COMPONENT_COVERAGE_MATRIX.md
docs/mvp-0.1.4-antd-pro-semantic-adapter/docs/design/PROTABLE_PROFORM_TABLE_FORM_COVERAGE.md
docs/mvp-0.1.4-antd-pro-semantic-adapter/docs/design/DATA_MODEL_AND_EXPORT.md
docs/mvp-0.1.4-antd-pro-semantic-adapter/docs/design/IMPLEMENTATION_BLUEPRINT.md
docs/mvp-0.1.4-antd-pro-semantic-adapter/docs/tasks/MVP-0.1.4-SEMANTIC-ADAPTER.md
docs/mvp-0.1.4-antd-pro-semantic-adapter/docs/checklists/ACCEPTANCE_CHECKLIST.md
docs/mvp-0.1.4-antd-pro-semantic-adapter/docs/examples/FULL_COMPONENT_FIXTURES.md
```

## 硬约束

- 不重写 Playwright recorder/player；
- 不引入 Cypress；
- 不把 `cypress-antd`、`ant-design-testing` 或其他 helper 当 runtime dependency；
- 不把 `.ant-*` class 作为最终业务 locator，只用于组件识别与 fallback；
- 不引入大型状态管理；
- 不修改业务仓库代码；
- 不做 Native Messaging / Node Runner / CI；
- 第一版只做 annotation / intent / compact export 辅助，不强制覆盖 recorder action；
- 代码要简洁可读，避免过度抽象。

## 本轮不能缩水

你不能只实现 Select、DatePicker、Modal、Table、Form 五类。必须覆盖以下组件，至少弱识别并有测试：

```text
AntD Button
AntD Form / Form.Item / Input / TextArea / InputNumber
AntD Select / TreeSelect / Cascader / AutoComplete
AntD DatePicker / RangePicker / TimePicker
AntD Modal / Drawer
AntD Dropdown / Menu / Popover / Popconfirm / Tooltip
AntD Table / Pagination
AntD Tabs / Steps
AntD Upload
AntD Switch / Checkbox / Radio
AntD Tree / Collapse / Card 弱识别
ProComponents ProTable
ProComponents ProForm / ProForm fields
ProComponents EditableProTable
ProComponents ModalForm
ProComponents DrawerForm
ProComponents StepsForm
ProComponents BetaSchemaForm 弱识别
ProComponents ProDescriptions
ProComponents PageContainer
ProComponents ProCard
ProComponents ProList 弱识别
```

## 实现步骤

### 1. 新增 uiSemantics 模块

新增：

```text
examples/recorder-crx/src/uiSemantics/types.ts
examples/recorder-crx/src/uiSemantics/dom.ts
examples/recorder-crx/src/uiSemantics/antd.ts
examples/recorder-crx/src/uiSemantics/proComponents.ts
examples/recorder-crx/src/uiSemantics/recipes.ts
examples/recorder-crx/src/uiSemantics/compact.ts
examples/recorder-crx/src/uiSemantics/index.ts
```

### 2. 实现 AntD adapter

`antd.ts` 必须实现：

```text
collectAntdSemanticContext
collectAntdButtonContext
collectAntdFormContext
collectAntdSelectContext
collectAntdPickerContext
collectAntdOverlayContext
collectAntdTableContext
collectAntdPaginationContext
collectAntdTabsContext
collectAntdStepsContext
collectAntdUploadContext
collectAntdToggleContext
collectAntdTreeContext
collectAntdCollapseContext
```

### 3. 实现 ProComponents adapter

`proComponents.ts` 必须实现：

```text
collectProComponentsContext
collectProFormContext
collectProTableContext
collectEditableProTableContext
collectModalFormContext
collectDrawerFormContext
collectStepsFormContext
collectBetaSchemaFormContext
collectProDescriptionsContext
collectPageContainerContext
collectProCardContext
collectProListContext
```

### 4. 实现 recipes

`recipes.ts` 必须支持：

```text
click-button
fill-form-field
select-option
pick-date
pick-range
pick-time
toggle-control
upload-file
submit-form
reset-form
protable-search
protable-reset-search
protable-toolbar-action
table-row-action
table-batch-action
editable-table-cell
editable-table-save-row
editable-table-cancel-row
paginate
sort-table
filter-table
modal-action
drawer-action
confirm-popconfirm
dropdown-menu-action
show-tooltip
switch-tab
switch-step
assert-description-field
raw-dom-action
```

### 5. 接入 PageContextSnapshot

修改：

```text
examples/recorder-crx/src/flow/pageContextTypes.ts
examples/recorder-crx/src/pageContextSidecar.ts
```

`PageContextSnapshot` 增加：

```ts
ui?: UiSemanticContext;
```

sidecar 在采集 action anchor 后调用：

```ts
collectUiSemanticContext(anchor, document)
```

### 6. 接入 FlowStep / flowBuilder

修改：

```text
examples/recorder-crx/src/flow/types.ts
examples/recorder-crx/src/flow/flowBuilder.ts
examples/recorder-crx/src/flow/flowContextMerger.ts
```

`FlowStep` 增加：

```ts
uiRecipe?: UiActionRecipe;
```

`flowTargetFromPageContext` 优先使用 UI semantic 的 testId / label / option / recipe。

`buildSyntheticClickStep` 写入 `uiRecipe`，并根据 recipe 推断 action：

```text
select-option -> select
fill-form-field -> fill
pick-date/range -> select
其他 -> click
```

### 7. 接入 intentRules

修改：

```text
examples/recorder-crx/src/flow/intentRules.ts
```

新增：

```ts
suggestIntentFromUiRecipe(recipe)
```

不得覆盖用户手动 intent。

### 8. 接入 AI input

找到 AI intent request 构建文件，把 compact UI semantic 加入请求。

只发送：

```text
ui.library
ui.component
ui.recipe.kind
formKind
fieldKind
field label/name
option text
table title/rowKey/columnTitle
overlay title/text
target text/testId
```

不要发送完整 DOM、rawAction、cookie/token/password/authorization。

### 9. 接入 compact-flow.yaml

修改：

```text
examples/recorder-crx/src/flow/compactExporter.ts
```

每个 step 增加：

```yaml
ui:
  library
  component
  recipe
  formKind
  fieldKind
  field
  option
  table
  row
  column
  overlay
  target
```

### 10. 测试

新增：

```text
examples/recorder-crx/src/uiSemantics/uiSemantics.test.ts
```

至少覆盖 `FULL_COMPONENT_FIXTURES.md` 中列出的所有 fixture。

同时补充 flowBuilder / intent / compact export 测试。

## 验收命令

运行：

```bash
npm run lint
npm run build --prefix ./examples/recorder-crx
```

如果仓库已有测试命令，请运行相关测试。

## PR 描述要求

PR 描述必须包含：

```text
Summary
Changed files
Component coverage table
How to test
Acceptance checklist
Known limitations
Risks and rollback
```

Component coverage table 必须逐项列出：

```text
AntD Form/Table/Select/DatePicker/Modal/Drawer/Dropdown/Popover/Popconfirm/Tooltip/Tabs/Upload/Switch/Checkbox/Radio
ProComponents ProTable/ProForm/EditableProTable/ModalForm/DrawerForm/StepsForm/BetaSchemaForm/ProDescriptions/PageContainer/ProCard
```

不要自动 merge。完成后提交 PR。
