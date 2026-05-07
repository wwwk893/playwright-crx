# AntD / ProComponents 组件覆盖矩阵

本文件定义 MVP 0.1.4 必须覆盖的组件范围。云端 agent 不应只实现 Select / DatePicker / Modal / Table / Form 这五类；本轮需要把 Popconfirm、Tooltip、EditableProTable 等复杂组件也纳入 first PR。



## 0. 强制补充：Form / Table / ProForm / ProTable 是 P0 核心

本轮 PR 必须把以下四类作为一等对象，而不是作为普通 DOM 或弱识别：

| 类型 | 必须程度 | 说明 |
|---|---:|---|
| AntD Form / Form.Item | P0 | 所有字段类操作的业务语义来源，必须采集 label/name/required/status/helpText。 |
| AntD Table | P0 | 所有列表行操作的业务语义来源，必须采集 title/rowKey/columnTitle/headers/region。 |
| ProForm / ProForm fields | P0 | 企业后台表单主力，必须识别 ProFormText/Select/DatePicker/RangePicker/Switch/Checkbox/Upload 等字段语义。 |
| ProTable | P0 | 企业后台列表主力，必须识别 search form、toolbar、row action、batch action、pagination。 |
| EditableProTable | P0 | 复杂编辑表格必须以 rowKey + columnTitle/dataIndex 表达，不能靠行列下标。 |
| ModalForm / DrawerForm | P0 | 必须识别 overlay title + form submit/cancel，生成 modal/drawer form 语义。 |
| StepsForm | P1 | 必须至少识别 current step、next/prev/submit。 |
| BetaSchemaForm | P1 | 必须识别为 schema form，并尽量沿用 Form.Item 字段语义。 |

PR 如果没有覆盖这些内容，视为未完成。

## 1. 优先级定义

- **P0**：本轮必须实现 detection + context + recipe + tests。
- **P1**：本轮必须实现基础 detection + context，recipe 可以保守。
- **P2**：本轮实现弱识别，避免阻塞；后续增强。

## 2. AntD 原子组件

| 组件 | 优先级 | 识别 selector | 必采字段 | Recipe | 主要坑 | 验收 |
|---|---:|---|---|---|---|---|
| Button | P0 | `button`, `.ant-btn`, `[role="button"]` | text, testId, disabled/loading, icon-only | `click-button` | 点到 span/svg；图标按钮无文本 | 内部 span/svg click 仍识别外层 button/testId |
| Form.Item | P0 | `.ant-form-item`, `[data-e2e-field]` | label, name, required, helpText, status | `fill-form-field` 基础上下文 | label 与 input 分离 | 能从 input 找到 label |
| Input/TextArea | P0 | `.ant-input`, `input`, `textarea` | label, placeholder, valuePreview | `fill-form-field` | password/sensitive value | 不泄露敏感值 |
| InputNumber | P1 | `.ant-input-number`, `.ant-input-number-input` | label, placeholder, min/max if readable | `fill-form-field` | 内层 input 才能填 | 能识别字段 label |
| Select | P0 | `.ant-select`, `.ant-select-selector`, `.ant-select-item-option` | fieldLabel, selectedValue, optionText, dropdown visible, multiple | `select-option` | option portal / virtual list | 点击 option 能得到 field + option |
| TreeSelect | P0 | `.ant-select-tree`, `.ant-select-tree-node-content-wrapper` | fieldLabel, nodeText, checked/selected | `select-option` | option 是 tree node，不一定 role=option | 能识别 node text |
| Cascader | P0 | `.ant-cascader`, `.ant-cascader-menu-item` | fieldLabel, pathText, optionText | `select-option` | 多列 menu；option portal | 能识别选中 path 的末级文本 |
| AutoComplete | P1 | `.ant-select-auto-complete`, `.ant-select-item-option` | fieldLabel, query, optionText | `select-option` | 和 Select DOM 相似 | 识别为 auto-complete 而不是普通 select 更好，不强制 |
| Mentions | P2 | `.ant-mentions`, `.ant-mentions-dropdown` | fieldLabel, optionText | `select-option` | 输入触发 dropdown | 弱识别即可 |
| DatePicker | P0 | `.ant-picker`, `.ant-picker-dropdown`, `.ant-picker-cell` | fieldLabel, panelText, selectedDate, needConfirm | `pick-date` | input 与 panel 分离 | 点击 panel 能关联 field |
| RangePicker | P0 | `.ant-picker-range`, `.ant-picker-dropdown` | fieldLabel, start/end, panelText | `pick-range` | 双 input + panel | 识别 range picker |
| TimePicker | P1 | `.ant-picker-time-panel`, `.ant-picker-dropdown` | fieldLabel, timeText | `pick-time` | 时间列滚动 | 基础识别 |
| Modal | P0 | `.ant-modal`, `.ant-modal-title`, `.ant-modal-root` | title, footer button text, topmost modal | `modal-action` | 多层 modal / animation | 点击确定时能拿 modal title |
| Drawer | P0 | `.ant-drawer`, `.ant-drawer-title`, `.ant-drawer-root` | title, footer button text, topmost drawer | `drawer-action` | Drawer root / content wrapper | 点击保存时能拿 drawer title |
| Dropdown/Menu | P0 | `.ant-dropdown`, `.ant-dropdown-menu-item`, `.ant-menu-item` | triggerText, menuItemText, overlay text | `dropdown-menu-action` | overlay portal | 点击菜单项能识别菜单文本 |
| Popover | P1 | `.ant-popover`, `.ant-popover-title`, `.ant-popover-inner-content` | title, text, triggerText | `modal-action` or `raw-dom-action` | hover/click/focus trigger | 能从 body 扫到 visible popover |
| Popconfirm | P0 | `.ant-popover`, `.ant-popconfirm`, `.ant-popconfirm-buttons` | confirmText, messageText, ok/cancel | `confirm-popconfirm` | 实际 DOM 是 popover | 点击确定能生成确认 intent |
| Tooltip | P0 | `.ant-tooltip`, `.ant-tooltip-inner` | tooltipText, triggerText | `show-tooltip` | hover 触发；只做 annotation | hover/click 后能识别 tooltip text |
| Table | P0 | `.ant-table-wrapper`, `.ant-table`, `tr[data-row-key]` | title, rowKey, rowText, columnTitle, headers | `table-row-action` | 固定列、虚拟列表、分页 | 行操作能拿 rowKey |
| Pagination | P1 | `.ant-pagination`, `.ant-pagination-item-active`, `.ant-pagination-options` | current, pageSize, action text | `paginate` | 多个表格分页 | 能识别所属 table 更好 |
| Tabs | P0 | `.ant-tabs`, `.ant-tabs-tab`, `.ant-tabs-tab-active` | tabText, activeTab | `switch-tab` | overflow more | 点击 tab 生成切换页签 |
| Steps | P1 | `.ant-steps`, `.ant-steps-item` | stepTitle, currentStep | `switch-step` | StepsForm 组合语义更重要 | 弱识别 |
| Upload/Dragger | P0 | `.ant-upload`, `.ant-upload-drag`, `input[type=file]` | fieldLabel, fileName if visible, list status | `upload-file` | hidden input / customRequest | 能定位 upload root |
| Switch | P1 | `.ant-switch`, `[role="switch"]` | label, checked | `toggle-control` | label 不一定关联 | 识别 checked |
| Checkbox | P1 | `.ant-checkbox-wrapper`, `.ant-checkbox`, `[type=checkbox]` | label, checked | `toggle-control` | 点 wrapper/span | 识别 label |
| Radio/RadioGroup | P1 | `.ant-radio-wrapper`, `.ant-radio-group` | group label, optionText, checked | `toggle-control` | group label 需要 Form.Item | 识别 optionText |
| Slider | P2 | `.ant-slider`, `.ant-slider-handle` | fieldLabel, value if aria | `raw-dom-action` | 拖拽复杂 | 弱识别 |
| Rate | P2 | `.ant-rate`, `.ant-rate-star` | fieldLabel, score | `raw-dom-action` | 星级 click | 弱识别 |
| Transfer | P2 | `.ant-transfer`, `.ant-transfer-list` | source/target item | `transfer-item` | 复杂双列表 | 弱识别 |
| Tree | P1 | `.ant-tree`, `.ant-tree-node-content-wrapper` | nodeText, expanded/checked | `tree-node-action` | virtual tree | 基础识别 |
| Collapse | P1 | `.ant-collapse`, `.ant-collapse-header` | panelTitle, expanded | `raw-dom-action` | header 点击 | 基础识别 |
| Card | P2 | `.ant-card`, `.ant-card-head-title` | title | context only | 主要作为 section | 采集 section title |

## 3. ProComponents 组合组件

| 组件 | 优先级 | 识别 selector | 必采字段 | Recipe | 主要坑 | 验收 |
|---|---:|---|---|---|---|---|
| ProTable | P0 | `.ant-pro-table`, `[data-e2e^="protable:"]` | tableTitle, search fields, toolbar, rowKey, columnTitle | `protable-search`, `table-row-action` | 搜索/toolbar/row action 混合 | 新建、搜索、行编辑能区分 |
| EditableProTable | P0 | `.ant-pro-table` + tbody form item / editable cell 标识 | rowKey, dataIndex/columnTitle, edit state | `editable-table-cell` | 行序号不稳定 | 以 rowKey+columnTitle 表达 |
| ProForm fields | P0 | `.ant-pro-form`, `.ant-form-item`, field wrappers | label, name, valueType if visible | `fill-form-field` / select/picker recipes | ProFormSelect/DatePicker 包装 | 仍能识别 AntD 原子语义 |
| ModalForm | P0 | `.ant-modal .ant-form`, `[data-e2e^="modal-form:"]` | modal title, form labels, submit button | `modal-action` | Modal + Form + submitter | 提交 intent 包含标题 |
| DrawerForm | P0 | `.ant-drawer .ant-form`, `[data-e2e^="drawer-form:"]` | drawer title, form labels, submit button | `drawer-action` | Drawer + Form + submitter | 提交 intent 包含标题 |
| StepsForm | P1 | `.ant-steps` + `.ant-form`, `[data-e2e^="steps-form:"]` | current step, step title, next/prev/submit | `switch-step` | 多阶段状态机 | 识别当前步骤 |
| BetaSchemaForm / SchemaForm | P1 | schema form root if test id, `.ant-form` fallback | label, field name, valueType if data attr | per field recipe | 动态 schema 不暴露 | 基础识别即可 |
| ProDescriptions | P1 | `.ant-pro-descriptions`, `.ant-descriptions` | item label/value, title | context/assertion | 多用于断言 | 能采 item label/value |
| PageContainer | P1 | `.ant-pro-page-container`, page title/breadcrumb | page title, breadcrumb, tabs, extra actions | context only | 页面上下文 | 写入 page/section context |
| ProCard | P1 | `.ant-pro-card`, `.ant-pro-card-title` | card title | context only | section title | 作为 section title |
| ProList | P2 | `.ant-pro-list`, list item | item title, action text | `table-row-action`-like | 类 Table 但结构不同 | 弱识别 |

## 4. 实现顺序建议

云端 agent 一晚上做 PR，建议按以下顺序：

1. 先实现公共 DOM + overlay scanner；
2. 实现 Button/Form/Select/Picker/Overlay/Table/Tabs/Upload；
3. 实现 Popconfirm/Tooltip/Dropdown；
4. 实现 ProTable/EditableProTable/ModalForm/DrawerForm/StepsForm；
5. 接入 pageContextSidecar；
6. 接入 FlowStep / intent / compact export；
7. 加测试。

## 5. 不允许缩水项

本轮不能只做五个组件。至少这些必须进入代码和测试：

```text
Button
Form.Item/Input
Select
TreeSelect/Cascader
DatePicker/RangePicker
Modal/Drawer
Dropdown/Menu
Popover/Popconfirm/Tooltip
Table/Pagination
Tabs
Upload
Switch/Checkbox/Radio
ProTable
EditableProTable
ModalForm
DrawerForm
StepsForm
ProDescriptions/PageContainer/ProCard 弱识别
```

弱识别也要输出 `UiSemanticContext`，哪怕 recipe 是 `raw-dom-action`。
