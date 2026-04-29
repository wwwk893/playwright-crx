# 非 AI 页面上下文采集与 Intent Suggestion 算法设计

## 目标

让测试人员录制业务流程时，插件自动理解当前操作的局部页面语义，并默认生成中文 `step.intent`。

例子：

```text
点击“新建”按钮 + 所在区域“共享 WAN” + 打开弹窗“新建共享 WAN”
=> 打开共享 WAN 新建弹窗

点击行内“编辑”按钮 + 当前行“WAN1” + 表格“共享 WAN”
=> 编辑 WAN1 共享 WAN

填写字段“MTU” + 弹窗“编辑 WAN1 共享 WAN”
=> 填写 WAN1 共享 WAN的 MTU

点击“确定” + 弹窗“编辑 WAN1 共享 WAN”
=> 确认保存 WAN1 共享 WAN配置
```

本能力必须是非 AI 的，本地 DOM 语义规则优先。

---

## 核心原则

1. **只采集局部语义摘要，不采集完整 DOM。**
2. **只在浏览器插件内完成，不接 Native Messaging、本地 Runner、AI。**
3. **不改 Playwright recorder/player/locator 生成逻辑。**
4. **默认自动写入 `step.intent`，减少测试人员心智负担。**
5. **用户修改后的 intent 永远不被自动覆盖。**
6. **宁可不生成或低置信度生成，也不要过度猜测。**
7. **规则少而清楚，先覆盖高频场景：按钮、表单、表格、弹窗、tab。**

---

## 架构概览

```text
页面事件
  ↓
pageContextSidecar 采集 before / after 小型上下文
  ↓
background 维护每个 tab 最近 context events ring buffer
  ↓
side panel 收到 recorder setActions
  ↓
pageContextMatcher 将 rawAction 与 context event 匹配
  ↓
intentRules 生成 IntentSuggestion
  ↓
flowContextMerger 写入 step.context / step.intentSuggestion / step.intent
```

---

## 采集时机

### click

采集：

```text
before + after
```

原因：

- before 能知道点击目标在哪里：按钮、表格行、form item、section、dialog；
- after 能知道点击结果：打开 modal/drawer/dropdown/toast，或者 URL/tab 变化。

适用：

- 新建；
- 编辑；
- 删除；
- 保存；
- 确定；
- tab 切换；
- dropdown option；
- 表格行操作。

### fill / input

采集：

```text
before 为主，after 可选
```

重点：

- form label；
- dialog title；
- section title；
- field placeholder；
- input testId。

不要默认把输入值拼进 intent，避免泄露业务数据。

### select / dropdown option

AntD Select 通常表现为：

```text
click field
click dropdown option
```

策略：

- 点击字段时保存 `lastFieldContext`；
- 3 秒内点击 `.ant-select-dropdown` / `.ant-dropdown` / `.ant-cascader-dropdown` option 时关联该字段；
- 生成 “选择 {fieldLabel} 为 {optionText}”。

### check / uncheck

采集：

```text
before
```

模板：

```text
check   => 开启{fieldLabel}
uncheck => 关闭{fieldLabel}
```

如果字段 label 是“启用”，并且 section/dialog 有更具体名称：

```text
开启 WAN 控制器配置
```

### press

采集：

```text
before
```

特殊规则：

```text
Enter + 搜索字段/表格搜索区域 => 执行当前列表搜索
Escape + dialog => 关闭弹窗
```

其他按键可以生成低置信度：

```text
在{fieldLabel}中按下 Enter
```

### navigate

采集：

```text
after
```

优先使用：

```text
breadcrumb 最后一级 > 页面 h1/title > document.title > URL path
```

模板：

```text
打开{pageTitle}页面
```

---

## 采集范围

每次事件只采集下列字段：

```text
页面标题
URL
面包屑
当前选中 tab
最近 section/card/panel
最近 table/list
当前 rowKey
当前 rowText
当前 columnName
最近 form item label
最近 dialog/modal/drawer title
目标按钮/输入框文本
aria/testId/role/name/placeholder
少量附近可见文本摘要
```

不要采集：

```text
完整 DOM
完整 innerHTML
完整 body text
完整 trace
完整 response body
cookie/token/password/authorization/secret
```

### nearbyText 限制

`nearbyText` 只用于兜底，限制：

```text
最多 8 条
每条最多 40~60 字
只取 heading / label / button / table header / card title
不要取整页正文
```

---

## DOM 搜索策略

### 从目标元素向上搜索

每个事件从 `event.target` 开始向上找：

```ts
let element = event.target as Element;
for (let depth = 0; element && depth < 10; depth++) {
  collectKnownContext(element);
  element = element.parentElement;
}
```

深度限制：

```text
最多 10 层。
```

原因：AntD DOM 层级较深，但 10 层通常能覆盖 input → form item → form → modal/drawer，button → action cell → row → table。

如果 10 层不够，不要简单加到 30，而是补充“全局可见 overlay 检测”。

### 上下文优先级

合成上下文时优先级：

```text
dialog/modal/drawer
  > form item
  > dropdown option / popover
  > table row
  > table
  > section/card/panel
  > active tab
  > page title / breadcrumb
```

注意：优先级不是简单覆盖，而是组合。

例子：

```text
dialog.title = 编辑 WAN1 共享 WAN
form.label = MTU
action = fill
=> 填写 WAN1 共享 WAN的 MTU
```

---

## Ant Design / ProComponents 识别选择器

建议集中放在 `pageContextSidecar.ts` 中：

```ts
const selectors = {
  modal: '.ant-modal:not([style*="display: none"]), [role="dialog"]',
  modalTitle: '.ant-modal-title',
  drawer: '.ant-drawer-content-wrapper, .ant-drawer',
  drawerTitle: '.ant-drawer-title',
  popover: '.ant-popover, .ant-tooltip',
  dropdown: '.ant-dropdown, .ant-select-dropdown, .ant-cascader-dropdown',
  formItem: '.ant-form-item',
  formLabel: '.ant-form-item-label label',
  tableWrapper: '.ant-table-wrapper, .ant-pro-table',
  table: '.ant-table',
  tableRow: '.ant-table-row, tr[data-row-key]',
  tableCell: 'td, th',
  tabsActive: '.ant-tabs-tab-active',
  card: '.ant-card, .ant-pro-card',
  cardTitle: '.ant-card-head-title, .ant-pro-card-title',
  collapsePanel: '.ant-collapse-item',
  collapseHeader: '.ant-collapse-header',
  breadcrumb: '.ant-breadcrumb, [aria-label="breadcrumb"]',
  toast: '.ant-message-notice-content, .ant-notification-notice-message',
};
```

不要做复杂 selector 配置系统。MVP 只保留这一组常见规则。

---

## 各类上下文采集规则

### Page

采集：

```text
url: location.href
title: 页面 h1 / .ant-page-header-heading-title / document.title
breadcrumb: .ant-breadcrumb 中的短文本
```

标题优先级：

```text
.ant-page-header-heading-title
h1
h2
最后一级 breadcrumb
document.title
```

### Tab

采集：

```text
.ant-tabs-tab-active 文本
aria-selected=true 的 tab 文本
```

只取当前活动 tab。

### Dialog / Drawer

采集全局可见 overlay：

```text
.ant-modal-wrap 中可见 modal
.ant-drawer-content-wrapper 中可见 drawer
role=dialog 且可见元素
```

标题优先级：

```text
.ant-modal-title
.ant-drawer-title
[role=dialog] h1/h2/h3
```

### Section / Card / Panel

从 target 向上找：

```text
.ant-card
.ant-pro-card
.ant-collapse-item
section
fieldset
```

标题来源：

```text
.ant-card-head-title
.ant-pro-card-title
.ant-collapse-header
legend
h2/h3/h4
```

### Table

从 target 向上找 table row 和 table wrapper。

字段：

```text
table.title:
  最近 card title / section title / ProTable title / wrapper 上 data-testid 推导

table.testId:
  table wrapper data-testid 或祖先 data-testid

rowKey:
  tr[data-row-key]
  data-row-key

rowText:
  当前行前 3~5 个短 cell 文本

columnName:
  根据 td.cellIndex 找对应 th 文本

headers:
  表头短文本，最多 12 个
```

不要从整页文本硬猜 rowKey。

### Form

从 target 向上找 `.ant-form-item`。

字段：

```text
label: .ant-form-item-label label 文本
name: input/select/textarea 的 name 属性
required: label 上是否有 required 标记
```

如果是 ProFormSelect，真实 input 可能很深，优先从 `.ant-form-item` 找 label。

### Target

采集：

```text
tag
role
data-testid / data-e2e
aria-label
title
placeholder
短文本
valuePreview
normalizedText
```

valuePreview 限制：

```text
只对非 password 输入；
最多 40 字；
导出前走 redactor；
不用于 intent 默认文本，除非是 select option。
```

---

## action 与 context event 匹配

rawAction 中通常有：

```json
"startTime": 50597.599,
"endTime": 50828.9
```

content script 使用：

```ts
performance.now()
```

匹配规则：

```ts
function matchContextEvent(action, events) {
  const start = action.startTime;
  const end = action.endTime ?? action.startTime;
  return events
    .filter(event => isCompatibleEvent(action.name, event.kind))
    .filter(event => event.time >= start - 300 && event.time <= end + 800)
    .sort((a, b) => Math.abs(a.time - start) - Math.abs(b.time - start))[0];
}
```

兼容关系：

```text
click          => click
fill           => input / change
select         => click / change
check/uncheck  => click / change
press          => keydown
navigate       => navigation / after snapshot
```

如果匹配不到：

```text
不生成高置信度 suggestion；
保留原 step；
可以生成“点击 xxx”这类低置信度 suggestion，但不要覆盖 user intent。
```

---

## Intent 生成规则

### 文本归一化

基础 normalize：

```text
去首尾空格
合并连续空白
去掉多余换行
“确 定” => “确定”
“保 存” => “保存”
```

按钮同义词：

```ts
const actionWords = {
  create: ['新建', '新增', '添加', '创建', 'Add', 'Create'],
  edit: ['编辑', '修改', 'Edit'],
  delete: ['删除', '移除', 'Delete'],
  save: ['保存', '提交', '确定', '确认', 'OK'],
  cancel: ['取消', '关闭', '返回', 'Cancel'],
  search: ['查询', '搜索', '筛选', 'Search'],
  reset: ['重置', 'Reset'],
};
```

### 规则 1：点击新建打开弹窗

条件：

```text
action = click
target.text 属于 create words
after.dialog.title 存在
```

模板：

```text
打开{area}新建弹窗
```

area 优先级：

```text
table.title > section.title > activeTab.title > page title
```

如果 `after.dialog.title` 已很完整，也可：

```text
打开{after.dialog.title}弹窗
```

建议输出更自然的：

```text
打开共享 WAN 新建弹窗
```

### 规则 2：点击行内编辑

条件：

```text
action = click
target.text 属于 edit words
table.rowKey 或 table.rowText 存在
table.title 存在
```

模板：

```text
编辑{rowKey}{tableTitle}
```

如果 after dialog title 存在：

```text
打开{after.dialog.title}弹窗
```

### 规则 3：点击删除

条件：

```text
action = click
target.text 属于 delete words
table.rowKey 存在
```

模板：

```text
删除{rowKey}{tableTitle}
```

如果 after 出现 popover/popconfirm：

```text
打开删除{rowKey}{tableTitle}确认框
```

### 规则 4：点击确定/保存

条件：

```text
action = click
target.text 属于 save words
before.dialog.title 存在
```

模板：

```text
确认保存{dialogEntity}配置
```

如果 dialog title 是：

```text
编辑 WAN1 共享 WAN
```

输出：

```text
确认保存 WAN1 共享 WAN配置
```

如果没有 dialog：

```text
保存{section/page}配置
```

### 规则 5：表单填写

条件：

```text
action = fill
form.label 存在
```

模板：

```text
填写{entity}的{fieldLabel}
```

entity 优先级：

```text
dialog.title > section.title > table.title > page title
```

例子：

```text
dialog = 编辑 WAN1 共享 WAN
field = MTU
=> 填写 WAN1 共享 WAN的 MTU
```

如果无 entity：

```text
填写 MTU
```

### 规则 6：选择下拉选项

条件：

```text
action = click/select
context.target 位于 dropdown/select option
lastFieldContext.form.label 存在
option text 存在
```

模板：

```text
选择{fieldLabel}为{optionText}
```

如果有 dialog：

```text
在{dialogTitle}中选择{fieldLabel}为{optionText}
```

### 规则 7：check/uncheck

```text
check   => 开启{fieldLabel 或 sectionTitle}
uncheck => 关闭{fieldLabel 或 sectionTitle}
```

如果 field label 是“启用”，且 section 是“WAN 控制器配置”：

```text
开启 WAN 控制器配置
```

### 规则 8：切换 tab

条件：

```text
target 位于 .ant-tabs-tab
```

模板：

```text
切换到{tabTitle}页签
```

### 规则 9：导航

条件：

```text
action = navigate
```

模板：

```text
打开{pageTitle}页面
```

---

## 置信度设计

第一版用固定分值，不做复杂模型：

```text
0.95：dialog.title + target action + row/field/table
0.90：table.title + rowKey + action
0.85：form.label + dialog.title
0.75：section/title + target text
0.60：只有 target text + action
0.40：只有 action
```

自动写入规则：

```text
如果 step.intent 为空：写入 suggestion.text。
如果 step.intentSource = auto：可用新 suggestion 更新。
如果 step.intentSource = user：不覆盖，只更新 intentSuggestion。
```

建议 `confidence >= 0.6` 自动写入。低于 0.6 只保留 suggestion，不自动填 intent。

---

## 示例

### 点击新建

before：

```json
{
  "target": { "text": "新建", "testId": "ha-wan-add-button", "role": "button" },
  "section": { "title": "共享 WAN" },
  "table": { "title": "共享 WAN", "testId": "ha-wan-config-table" },
  "title": "全局配置"
}
```

after：

```json
{
  "dialog": { "type": "modal", "title": "新建共享 WAN", "visible": true }
}
```

suggestion：

```json
{
  "text": "打开共享 WAN 新建弹窗",
  "confidence": 0.92,
  "rule": "click.create.open-dialog",
  "provenance": [
    { "field": "target.text", "value": "新建" },
    { "field": "table.title", "value": "共享 WAN" },
    { "field": "after.dialog.title", "value": "新建共享 WAN" }
  ]
}
```

### 填写字段

context：

```json
{
  "before": {
    "dialog": { "type": "modal", "title": "编辑 WAN1 共享 WAN", "visible": true },
    "form": { "label": "MTU" },
    "target": { "tag": "input", "testId": "ha-wan-mtu-field" }
  }
}
```

suggestion：

```text
填写 WAN1 共享 WAN的 MTU
```

### 点击确定

context：

```json
{
  "before": {
    "dialog": { "type": "modal", "title": "编辑 WAN1 共享 WAN", "visible": true },
    "target": { "text": "确定", "role": "button" }
  },
  "after": {
    "toast": "保存成功"
  }
}
```

suggestion：

```text
确认保存 WAN1 共享 WAN配置
```

