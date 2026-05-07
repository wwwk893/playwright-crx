# MVP 0.1.4 验收清单：AntD / ProComponents Semantic Adapter 全覆盖版

## 1. 模块结构

- [ ] 新增 `examples/recorder-crx/src/uiSemantics/types.ts`
- [ ] 新增 `examples/recorder-crx/src/uiSemantics/dom.ts`
- [ ] 新增 `examples/recorder-crx/src/uiSemantics/antd.ts`
- [ ] 新增 `examples/recorder-crx/src/uiSemantics/proComponents.ts`
- [ ] 新增 `examples/recorder-crx/src/uiSemantics/recipes.ts`
- [ ] 新增 `examples/recorder-crx/src/uiSemantics/compact.ts`
- [ ] 新增 `examples/recorder-crx/src/uiSemantics/index.ts`

## 2. 数据结构

- [ ] `PageContextSnapshot` 增加 `ui?: UiSemanticContext`
- [ ] `FlowStep` 增加 `uiRecipe?: UiActionRecipe`
- [ ] AI input 包含 compact UI semantic
- [ ] compact-flow.yaml 输出 `ui` 字段
- [ ] business-flow.json 不包含完整 DOM / cookie / token / password / authorization

## 3. AntD 覆盖

### P0 必须通过

- [ ] Button：点击内部 span/svg 仍识别外层 button/testId
- [ ] Form / Form.Item：采集 label/name/required/status/helpText
- [ ] Input / TextArea：采集 field label / placeholder，不泄露敏感值
- [ ] Select：option portal 能关联 fieldLabel + optionText
- [ ] TreeSelect：tree node 能关联 fieldLabel + nodeText
- [ ] Cascader：menu item 能关联 fieldLabel + path/optionText
- [ ] DatePicker：panel click 能关联 fieldLabel
- [ ] RangePicker：双输入和 panel 能识别 range
- [ ] Modal：点击 footer 确定/取消能拿 title
- [ ] Drawer：点击 footer 保存/取消能拿 title
- [ ] Dropdown/Menu：菜单项能识别 overlay text / menuItemText
- [ ] Popconfirm：点击确定能识别 messageText / ok/cancel
- [ ] Tooltip：可见 tooltip 能从 document.body 扫描到 text
- [ ] Table：行操作能拿 table title / rowKey / columnTitle
- [ ] Tabs：点击 tab 能生成 switch-tab recipe
- [ ] Upload：能识别 upload root / file input

### P1/P2 基础识别

- [ ] AutoComplete：弱识别并输出 select-option 或 raw-dom-action
- [ ] TimePicker：弱识别 time panel
- [ ] Pagination：识别 current/pageSize/action
- [ ] Steps：识别 current step / step title
- [ ] Switch：识别 checked/label
- [ ] Checkbox：识别 checked/label
- [ ] RadioGroup：识别 optionText/checked
- [ ] Tree：识别 nodeText
- [ ] Collapse：识别 panelTitle
- [ ] Card：作为 section title 输出

## 4. ProComponents 覆盖

- [ ] ProTable：识别 tableTitle/search/toolbar/table body/row action/pagination
- [ ] ProTable search：查询按钮生成 `protable-search`
- [ ] ProTable reset：重置按钮生成 `protable-reset-search`
- [ ] ProTable toolbar：新建/导入/导出生成 `protable-toolbar-action`
- [ ] ProTable row action：查看/编辑/删除生成 `table-row-action`
- [ ] ProTable batch action：生成 `table-batch-action`
- [ ] ProForm：识别为 `pro-form` / `pro-form-field`
- [ ] ProFormText：识别 fieldKind
- [ ] ProFormSelect：识别 fieldLabel + optionText
- [ ] ProFormDatePicker / RangePicker：识别 picker recipe
- [ ] ProFormSwitch / Checkbox / Radio / Upload：识别 toggle/upload recipe
- [ ] ModalForm：识别 modal title + form submit
- [ ] DrawerForm：识别 drawer title + form submit
- [ ] StepsForm：识别 current step + next/prev/submit
- [ ] EditableProTable：以 rowKey + columnTitle/dataIndex 识别 cell
- [ ] EditableProTable save/cancel：生成 save/cancel row recipe
- [ ] BetaSchemaForm：弱识别为 beta-schema-form，并沿用 Form.Item 字段语义
- [ ] ProDescriptions：采集 item label/value
- [ ] PageContainer：采集 page title/breadcrumb/tab/extra action
- [ ] ProCard：作为 section/card title 输出
- [ ] ProList：弱识别 list item/action

## 5. flowBuilder / intent / export

- [ ] synthetic step 使用 `ui.targetTestId` 补强 target
- [ ] select-option recipe 可把 synthetic action 推断为 `select`
- [ ] fill-form-field recipe 可把 synthetic action 推断为 `fill`
- [ ] `suggestIntentFromUiRecipe` 支持所有核心 recipe
- [ ] 用户手动 intent 不被覆盖
- [ ] compact-flow.yaml 输出简洁 ui 字段
- [ ] AI intent input 包含 compact ui semantic
- [ ] AI input 不包含 rawAction / 完整 DOM / 敏感字段

## 6. 测试

- [ ] 新增 `uiSemantics.test.ts`
- [ ] 覆盖 `FULL_COMPONENT_FIXTURES.md` 所列 fixture
- [ ] 覆盖 flowBuilder synthetic target 补强
- [ ] 覆盖 intentRules from ui recipe
- [ ] 覆盖 compact export ui 字段

## 7. 验证命令

- [ ] `npm run lint` 通过
- [ ] `npm run build --prefix ./examples/recorder-crx` 通过
- [ ] 相关测试通过，或者 PR 明确说明当前仓库没有可用测试命令

## 8. 回滚

- [ ] 有单一开关可关闭 semantic adapter，或至少能通过移除 `snapshot.ui` 接入回滚
- [ ] 不影响原有 Playwright recorder/player
- [ ] 不影响现有 business-flow.json 导出
