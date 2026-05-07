# 数据模型、AI 输入与导出设计

## 1. 数据模型变更

### 1.1 `PageContextSnapshot`

文件：

```text
examples/recorder-crx/src/flow/pageContextTypes.ts
```

新增：

```ts
import type { UiSemanticContext } from '../uiSemantics/types';

export interface PageContextSnapshot {
  // existing fields
  ui?: UiSemanticContext;
}
```

语义：

```text
ui 是页面侧采集到的组件语义上下文。
它是 annotation，不是 recorder action 的替代品。
```

### 1.2 `FlowStep`

文件：

```text
examples/recorder-crx/src/flow/types.ts
```

新增：

```ts
import type { UiActionRecipe } from '../uiSemantics/types';

export interface FlowStep {
  // existing fields
  uiRecipe?: UiActionRecipe;
}
```

语义：

```text
uiRecipe 是当前步骤推荐的组件级动作。
它来源于 context.before.ui.recipe，后续可被 intent / AI / export / codegen 使用。
```

### 1.3 FlowTarget 补强

无需强制新增字段，但 `flowTargetFromPageContext()` 应优先使用 UI 语义：

```text
ui.targetTestId → target.testId
ui.form.label → target.label
ui.option.text → target.text/displayName
ui.targetText → target.name/text/displayName
```

## 2. business-flow.json 输出

business-flow.json 可以保留 `context.before.ui` 和 `uiRecipe`，因为它们是结构化业务语义，不是完整 DOM。

示例：

```json
{
  "id": "s023",
  "action": "select",
  "intent": "选择 WAN 为 WAN2",
  "target": {
    "testId": "site-wan-select",
    "label": "WAN",
    "text": "WAN2"
  },
  "uiRecipe": {
    "kind": "select-option",
    "library": "antd",
    "component": "select",
    "fieldLabel": "WAN",
    "optionText": "WAN2"
  },
  "context": {
    "before": {
      "ui": {
        "library": "antd",
        "component": "select",
        "form": { "label": "WAN" },
        "option": { "text": "WAN2" }
      }
    }
  }
}
```

不要输出：

```text
完整 DOM
完整 HTML
cookie/token/password/authorization
完整 response body
API key
```

## 3. compact-flow.yaml 输出

文件：

```text
examples/recorder-crx/src/flow/compactExporter.ts
```

每个 step 增加简洁 `ui` 字段。

示例：

```yaml
- id: s023
  order: 23
  intent: 选择 WAN 为 WAN2
  action: select
  target: site-wan-select
  ui:
    library: antd
    component: select
    recipe: select-option
    field: WAN
    option: WAN2
    overlay: 新建共享 WAN
```

ProTable 示例：

```yaml
- id: s041
  order: 41
  intent: 编辑 WAN1 共享 WAN
  action: click
  target: ha-wan-row-edit-action
  ui:
    library: pro-components
    component: pro-table
    recipe: table-row-action
    table: 共享 WAN
    row: WAN1
    column: 操作
    target: 编辑
```

EditableProTable 示例：

```yaml
- id: s055
  order: 55
  intent: 编辑 WAN1 的 MTU
  action: fill
  ui:
    library: pro-components
    component: editable-pro-table
    recipe: editable-table-cell
    table: 共享 WAN
    row: WAN1
    column: MTU
```

## 4. AI Intent 输入

AI input 应包含 UI 语义，但必须是压缩后的。

推荐输入：

```json
{
  "stepId": "s023",
  "action": "select",
  "target": {
    "testId": "site-wan-select",
    "text": "WAN2",
    "label": "WAN"
  },
  "ui": {
    "library": "antd",
    "component": "select",
    "recipe": "select-option",
    "fieldLabel": "WAN",
    "optionText": "WAN2",
    "overlayTitle": "新建共享 WAN",
    "targetText": "WAN2"
  }
}
```

不要传：

```text
context.before.ui.locatorHints 全量可以不传，只传 best hint
rawAction
sourceCode
complete nearbyText
complete overlay text
hidden text
敏感输入值
```

## 5. `compactUiContext(step)` 伪代码

```ts
function compactUiContext(step: FlowStep) {
  const ui = step.context?.before?.ui;
  const recipe = step.uiRecipe || ui?.recipe;

  if (!ui && !recipe)
    return undefined;

  return compactObject({
    library: ui?.library || recipe?.library,
    component: ui?.component || recipe?.component,
    recipe: recipe?.kind,
    field: recipe?.fieldLabel || ui?.form?.label,
    option: recipe?.optionText || ui?.option?.text,
    table: recipe?.tableTitle || ui?.table?.title,
    row: recipe?.rowKey || ui?.table?.rowKey,
    column: recipe?.columnTitle || ui?.table?.columnTitle,
    overlay: recipe?.overlayTitle || ui?.overlay?.title,
    target: recipe?.targetText || ui?.targetText,
  });
}

function compactObject<T extends Record<string, unknown>>(object: T): Partial<T> | undefined {
  const entries = Object.entries(object).filter(([, value]) => value !== undefined && value !== '');
  return entries.length ? Object.fromEntries(entries) as Partial<T> : undefined;
}
```

## 6. Intent 生成优先级

推荐：

```text
user intent
  > AI intent already accepted
  > ui recipe rule suggestion
  > old page context rule suggestion
  > fallback action text
```

如果 step.intentSource === 'user'，任何自动 suggestion 都不能覆盖。

## 7. Codegen 边界

本轮不要大改 Playwright codegen，只做 annotation。后续可以基于 `uiRecipe` 生成 helper：

```ts
await antd.selectOption(page, { field: 'WAN', option: 'WAN2' });
await antd.editTableRow(page, { table: '共享 WAN', row: 'WAN1', action: '编辑' });
```

但 MVP 0.1.4 不要求实现 helper codegen。



# 补充：Form / Table / ProForm / ProTable 导出要求

compact-flow.yaml 中必须输出 Form/Table 语义，不允许只输出低层 selector。

## ProForm 字段

```yaml
ui:
  library: pro-components
  component: pro-form-field
  recipe: select-option
  formKind: modal-form
  fieldKind: pro-form-select
  field: WAN
  fieldName: wan
  option: WAN2
  overlay: 新建 IP 端口地址池
```

## ProTable 查询

```yaml
ui:
  library: pro-components
  component: pro-table-search
  recipe: protable-search
  table: IP 端口地址池
  field: 名称
  target: 查询
```

## ProTable 行操作

```yaml
ui:
  library: pro-components
  component: pro-table
  recipe: table-row-action
  table: IP 端口地址池
  row: pool-1
  column: 操作
  target: 编辑
```

## EditableProTable 单元格

```yaml
ui:
  library: pro-components
  component: editable-pro-table
  recipe: editable-table-cell
  table: 共享 WAN
  row: WAN1
  column: MTU
  field: MTU
```

## AntD Table 分页

```yaml
ui:
  library: antd
  component: pagination
  recipe: paginate
  table: 告警方式列表
  target: 下一页
```

## ProDescriptions 断言

```yaml
ui:
  library: pro-components
  component: pro-descriptions
  recipe: assert-description-field
  section: 基础信息
  field: 站点名称
  valuePreview: Tokyo-1
```

注意：`valuePreview` 必须经过脱敏，手机号、邮箱、token、密码、授权头等不能输出。
