# MVP 0.1.4 AntD / ProComponents Semantic Adapter 全覆盖文档包

这套文档用于让云端 agent 在 `playwright-crx` fork 中创建一个 PR：给业务流程录制器增加 **AntD / ProComponents Semantic Adapter**。本版是“全覆盖强约束版”，明确把以下组件提升为必须覆盖对象：

```text
AntD Form / Form.Item / Input / InputNumber / TextArea
AntD Table / Pagination / Tabs / Upload / Switch / Checkbox / Radio
AntD Select / TreeSelect / Cascader / AutoComplete
AntD DatePicker / RangePicker / TimePicker
AntD Modal / Drawer / Dropdown / Menu / Popover / Popconfirm / Tooltip
ProComponents ProTable / ProForm / ProFormSelect / ProFormDatePicker / ModalForm / DrawerForm / StepsForm
ProComponents EditableProTable / BetaSchemaForm / ProDescriptions / PageContainer / ProCard / ProList
```

## 背景

当前插件已经有：

- Playwright CRX recorder actions；
- `BusinessFlow` / `FlowStep`；
- page context sidecar；
- synthetic step fallback；
- stable step model；
- AI intent suggestion；
- compact-flow.yaml / business-flow.json 导出。

现在的问题是：低层 DOM action 仍然经常无法表达 AntD / ProComponents 的组件语义。例如：

- 点击 Button 内部的 `span/svg`，丢失外层 `data-testid`；
- Select / TreeSelect / Cascader 的 option 挂在 `body`，不在字段 DOM 下；
- DatePicker / RangePicker 的 input 与 panel 分离；
- Tooltip / Popover / Popconfirm / Dropdown 是 portal；
- Table / ProTable 同时包含 search form、toolbar、table body、row action、pagination；
- ProForm 包了一层 AntD Form.Item，字段类型来自 ProFormText / ProFormSelect / ProFormDatePicker 等；
- EditableProTable 需要 `rowKey + dataIndex/columnTitle`，不能靠行列下标；
- ModalForm / DrawerForm / StepsForm 是多个 AntD 原子组件组合后的业务结构。

## 本轮目标

实现一个保守、可回滚、可渐进增强的语义适配层：

```text
pageContextSidecar
  ↓
AntD Semantic Adapter
  ↓
ProComponents Semantic Adapter
  ↓
Intent Suggestion / AI Intent
  ↓
Business Flow Step
  ↓
compact-flow.yaml / future Playwright recipe
```

第一版只做 annotation 和辅助 intent，不要重写 Playwright recorder/player，也不要强制替换 recorder action。

## 文档目录

```text
antd-pro-semantic-adapter-full-coverage-docs/
├─ README.md
└─ docs/
   ├─ design/
   │  ├─ ANTD_PRO_SEMANTIC_ADAPTER.md
   │  ├─ COMPONENT_COVERAGE_MATRIX.md
   │  ├─ PROTABLE_PROFORM_TABLE_FORM_COVERAGE.md
   │  ├─ DATA_MODEL_AND_EXPORT.md
   │  └─ IMPLEMENTATION_BLUEPRINT.md
   ├─ tasks/
   │  └─ MVP-0.1.4-SEMANTIC-ADAPTER.md
   ├─ prompts/
   │  └─ CLOUD_AGENT_PR_PROMPT.md
   ├─ checklists/
   │  └─ ACCEPTANCE_CHECKLIST.md
   └─ examples/
      ├─ SEMANTIC_CONTEXT_EXAMPLES.md
      └─ FULL_COMPONENT_FIXTURES.md
```

## 给云端 agent 的建议执行方式

把整个目录复制到仓库：

```text
docs/mvp-0.1.4-antd-pro-semantic-adapter/
```

然后把下面这份 prompt 发给 agent：

```text
请先阅读 docs/mvp-0.1.4-antd-pro-semantic-adapter/README.md 和其中所有 design/task/checklist/example 文档，然后实现 MVP 0.1.4 AntD / ProComponents Semantic Adapter。严格遵守硬约束：不重写 Playwright recorder/player，不引入 Cypress，不把第三方 helper 当运行时依赖，不把 .ant-* class 作为最终业务 locator，只用于组件识别与 fallback。完成后创建一个 PR，并在 PR 描述中逐项勾选验收清单。

本轮不能缩水：必须覆盖 AntD Form、Table、Select、DatePicker、Modal、Drawer、Dropdown、Popover、Popconfirm、Tooltip、Tabs、Upload、Switch、Checkbox、Radio，以及 ProComponents ProTable、ProForm、ModalForm、DrawerForm、StepsForm、EditableProTable、BetaSchemaForm、ProDescriptions、PageContainer、ProCard。弱识别也必须输出 UiSemanticContext 和测试。
```

完整 prompt 见：

```text
docs/prompts/CLOUD_AGENT_PR_PROMPT.md
```

## 本轮 PR 的边界

必须做：

- 新增 `uiSemantics` 模块；
- `PageContextSnapshot` 增加 `ui?: UiSemanticContext`；
- `FlowStep` 增加 `uiRecipe?: UiActionRecipe`；
- sidecar 采集时写入 UI 语义；
- synthetic step 和 intent 优先使用 UI 语义；
- AI intent input 带 compact UI 语义；
- compact YAML 输出简洁 `ui` 字段；
- 覆盖 AntD 常见复杂组件和 ProComponents 组合组件；
- 加单元测试和 flowBuilder 集成测试。

不要做：

- 不替换 Playwright recorder / player；
- 不接入 Cypress；
- 不把 `cypress-antd` / `ant-design-testing` 当 runtime dependency；
- 不引入大型状态管理；
- 不改业务仓库代码；
- 不做 Native Messaging / Node Runner / CI。

## 成功标准

ProForm 字段至少能表达：

```json
{
  "library": "pro-components",
  "component": "pro-form-field",
  "recipe": {
    "kind": "fill-form-field",
    "formKind": "pro-form",
    "fieldKind": "pro-form-select",
    "fieldLabel": "WAN",
    "fieldName": "wan"
  }
}
```

ProTable 行操作至少能表达：

```json
{
  "library": "pro-components",
  "component": "pro-table",
  "recipe": {
    "kind": "table-row-action",
    "tableTitle": "共享 WAN",
    "rowKey": "WAN1",
    "columnTitle": "操作",
    "targetText": "编辑"
  }
}
```

Popconfirm 至少能表达：

```json
{
  "library": "antd",
  "component": "popconfirm",
  "recipe": {
    "kind": "confirm-popconfirm",
    "messageText": "确定删除吗？",
    "targetText": "确定"
  }
}
```

这轮完成后，插件仍然可以按原路径录制、编辑、导出，只是 step 有更多语义上下文。
