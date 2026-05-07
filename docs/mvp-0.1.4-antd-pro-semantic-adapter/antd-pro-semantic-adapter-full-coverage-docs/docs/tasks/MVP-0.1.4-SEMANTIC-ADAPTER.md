# MVP 0.1.4 任务：AntD / ProComponents Semantic Adapter 全覆盖实现

## 1. 目标

实现插件内 UI 语义适配层，使 pageContextSidecar 在录制期间能把低层 DOM action 转成 AntD / ProComponents 组件语义。

本轮必须覆盖：

```text
AntD Form / Form.Item / Input / InputNumber / TextArea
AntD Table / Pagination / Tabs / Upload / Switch / Checkbox / Radio
AntD Select / TreeSelect / Cascader / AutoComplete
AntD DatePicker / RangePicker / TimePicker
AntD Modal / Drawer / Dropdown / Menu / Popover / Popconfirm / Tooltip
ProComponents ProTable / ProForm / ModalForm / DrawerForm / StepsForm
ProComponents EditableProTable / BetaSchemaForm / ProDescriptions / PageContainer / ProCard / ProList
```

## 2. 非目标

- 不重写 Playwright recorder/player；
- 不引入 Cypress；
- 不把第三方 helper 作为 runtime dependency；
- 不强制覆盖 recorder action，只做 annotation 和辅助 intent；
- 不修改业务仓库代码；
- 不做 Native Messaging / Node Runner / CI。

## 3. 新增模块

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

## 4. 修改现有数据结构

### 4.1 `flow/pageContextTypes.ts`

`PageContextSnapshot` 增加：

```ts
ui?: UiSemanticContext;
```

### 4.2 `flow/types.ts`

`FlowStep` 增加：

```ts
uiRecipe?: UiActionRecipe;
```

## 5. 接入 sidecar

修改 `pageContextSidecar.ts`：

- 在 action anchor 确认后调用 `collectUiSemanticContext(anchor, document)`；
- 写入 `snapshot.ui`；
- 不删除原有 target/form/table/dialog/context 采集；
- anchor 选择应优先外层 `button/.ant-btn/[data-testid]`，避免 span/svg 抢 target。

## 6. 接入 flowBuilder

修改 `flowBuilder.ts`：

- `flowTargetFromPageContext` 优先使用 `snapshot.ui.targetTestId`、`ui.locatorHints`、`ui.form.label`、`ui.option.text`；
- `buildSyntheticClickStep` 写入 `uiRecipe: before.ui?.recipe`；
- 如果 recipe 是 `select-option`，action 可推断为 `select`；
- 如果 recipe 是 `fill-form-field`，action 可推断为 `fill`；
- 其他保持 click；
- 不覆盖用户已编辑的 intent/comment/assertions。

## 7. 接入 intentRules

新增 `suggestIntentFromUiRecipe(recipe)`，并在现有 intent suggestion 中优先使用。

必须支持：

```text
select-option         -> 选择 {fieldLabel} 为 {optionText}
fill-form-field       -> 填写 {fieldLabel}
pick-date             -> 选择 {fieldLabel} 日期
pick-range            -> 选择 {fieldLabel} 时间范围
modal-action submit   -> 确认保存 {overlayTitle}
drawer-action submit  -> 确认保存 {overlayTitle}
confirm-popconfirm    -> 确认 {targetText/messageText}
protable-search       -> 查询 {tableTitle}
protable-reset-search -> 重置 {tableTitle} 查询条件
protable-toolbar-action -> {targetText}{tableTitle}
table-row-action      -> {targetText}{rowKey}{tableTitle}
table-batch-action    -> 批量{targetText}{tableTitle}
editable-table-cell   -> 编辑 {rowKey} 的 {columnTitle}
editable-table-save-row -> 保存 {rowKey}
switch-tab            -> 切换到 {targetText} 页签
switch-step           -> 切换到 {targetText} 步骤
upload-file           -> 上传 {fieldLabel}
```

## 8. 接入 AI input

找到 AI intent input 构建文件，加入 compact UI semantic：

```json
{
  "ui": {
    "library": "pro-components",
    "component": "pro-table",
    "recipe": "table-row-action",
    "table": "共享 WAN",
    "row": "WAN1",
    "column": "操作",
    "target": "编辑"
  }
}
```

禁止发送：

```text
完整 DOM
rawAction
cookie/token/password/authorization
真实敏感值
```

## 9. 接入 compact-flow.yaml

修改 `compactExporter.ts`：每个 step 增加简洁 `ui` 输出。

示例：

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

## 10. 测试要求

新增：

```text
examples/recorder-crx/src/uiSemantics/uiSemantics.test.ts
```

至少覆盖：

```text
Button 内部 span/svg，外层 data-testid 保留
AntD Form.Item label + input
AntD Form submit/reset
Select option portal
TreeSelect node option
Cascader menu item
DatePicker / RangePicker panel
Modal submit
Drawer submit
Dropdown menu item
Popover visible overlay
Popconfirm confirm button
Tooltip visible text
AntD Table row action
AntD Table pagination
Tabs switch
Upload root/file input
Switch/Checkbox/Radio label + checked
ProFormText
ProFormSelect
ProFormDatePicker
ProFormDateRangePicker
ProTable search input / 查询 / 重置
ProTable toolbar 新建
ProTable row edit/delete
ProTable batch action
EditableProTable cell edit/save/cancel
ModalForm submit
DrawerForm submit
StepsForm next/prev/submit
BetaSchemaForm weak detection
ProDescriptions item label/value
PageContainer title/breadcrumb
ProCard title as section
```

同时补充 flowBuilder / compact / intent 测试：

```text
synthetic step 使用 ui targetTestId
select-option recipe 生成 action=select
fill-form-field recipe 生成 action=fill
intentRules 基于 ui recipe 生成中文 intent
compact-flow.yaml 输出 ui 字段
AI input 包含 compact ui 且不含 rawAction
```

## 11. 验收命令

至少运行：

```bash
npm run lint
npm run build --prefix ./examples/recorder-crx
```

如果项目已有测试命令，运行：

```bash
npm test -- --runInBand examples/recorder-crx/src/uiSemantics/uiSemantics.test.ts
```

或使用仓库现有测试方式执行相关测试。

## 12. PR 输出要求

PR 描述必须包含：

```text
Summary
Changed files
Coverage table
How to test
Acceptance checklist
Known limitations
Risks and rollback
```

不能只写“实现 semantic adapter”。必须列出已覆盖组件清单。
