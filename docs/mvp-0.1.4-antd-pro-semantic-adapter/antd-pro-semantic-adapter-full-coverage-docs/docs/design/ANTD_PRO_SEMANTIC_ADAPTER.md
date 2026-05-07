# AntD / ProComponents Semantic Adapter 设计方案

## 1. 目标

为当前 Playwright CRX 业务流程录制器增加 UI 组件语义识别层，把低层 DOM action 提升为稳定的组件语义上下文。

当前 recorder 看到的是：

```text
click div
click span
click svg
click body 下的 option
fill input
```

业务流程真正需要的是：

```text
点击“新建”按钮
选择 WAN 为 WAN2
在“编辑 WAN1 共享 WAN”弹窗中填写 MTU
确认删除 WAN1 共享 WAN
编辑 ProTable 中 WAN1 行的带宽字段
```

本适配层的目标是把 `PageContextSnapshot` 从“附近 DOM 文本”增强为“组件语义”：

```ts
snapshot.ui = {
  library: 'antd',
  component: 'select',
  form: { label: 'WAN' },
  option: { text: 'WAN2' },
  recipe: {
    kind: 'select-option',
    fieldLabel: 'WAN',
    optionText: 'WAN2'
  }
}
```

## 2. 非目标

本轮不做：

- 不重写 Playwright recorder；
- 不重写 Playwright player；
- 不改 locator generator；
- 不强制把 UI recipe 编译成最终 Playwright code；
- 不接入第三方 AntD helper 作为运行时依赖；
- 不改业务仓库代码；
- 不解决所有业务二次封装组件，只提供可扩展入口。

## 3. 设计原则

### 3.1 annotation first

第一版只做 annotation：

```text
raw action 保留
page context 保留
ui semantic context 增强
FlowStep.uiRecipe 作为辅助字段
```

不要把 recorder action 强制改写为 recipe action。这样有问题可以随时关闭 adapter，不影响原录制链路。

### 3.2 class 用于识别，不用于最终业务契约

`.ant-*` class 可以用于：

```text
判断这个元素是不是 Select / Modal / Table
找到最近 Form.Item
找到当前可见 overlay
找到当前 table row / column
```

但不要把 `.ant-*` class 当最终稳定 locator 输出。最终业务 locator 仍然优先：

```text
data-testid
role/name
label
text
component recipe fallback
```

### 3.3 overlay 必须从 document/body 观察

AntD 的 Select、DatePicker、Dropdown、Tooltip、Popover、Popconfirm 经常通过 portal 挂到 `body`。不能只从 target 往上找。必须在 sidecar 采集时扫描当前页面所有可见 overlay。

### 3.4 ProComponents 是组合语义，不是普通 AntD class

ProTable / ModalForm / DrawerForm / StepsForm / EditableProTable 应该在 AntD 语义基础上二次提升。比如 ModalForm 不是“Modal + Form + Button”三步，而是：

```text
open modal form
fill modal form
submit modal form
```

### 3.5 test id 是最终稳定契约

你们已有 `data-testid` 规范，继续沿用：

```text
data-testid="site-ip-port-pool-create-button"
data-testid="ha-wan-config-table"
data-testid="site-save-button"
```

adapter 需要兼容读取：

```text
data-testid
data-test-id
data-e2e
```

但文档和推荐写法只推荐 `data-testid`。

## 4. 新增目录结构

新增：

```text
examples/recorder-crx/src/uiSemantics/
├─ types.ts
├─ dom.ts
├─ overlay.ts
├─ antd.ts
├─ proComponents.ts
├─ recipes.ts
└─ index.ts
```

如果为了简洁，`overlay.ts` 可以合并进 `antd.ts`，但建议单独文件，因为 overlay 是高频复用能力。

## 5. 类型设计

新增：

```ts
export type UiLibrary = 'antd' | 'pro-components' | 'unknown';

export type UiComponentKind =
  | 'button'
  | 'form-item'
  | 'input'
  | 'textarea'
  | 'input-number'
  | 'select'
  | 'tree-select'
  | 'cascader'
  | 'auto-complete'
  | 'mentions'
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
  | 'pro-table'
  | 'editable-pro-table'
  | 'modal-form'
  | 'drawer-form'
  | 'steps-form'
  | 'beta-schema-form'
  | 'pro-descriptions'
  | 'page-container'
  | 'pro-card'
  | 'pro-list'
  | 'upload'
  | 'tabs'
  | 'pagination'
  | 'steps'
  | 'switch'
  | 'checkbox'
  | 'radio'
  | 'slider'
  | 'rate'
  | 'transfer'
  | 'tree'
  | 'collapse'
  | 'card'
  | 'unknown';

export interface UiLocatorHint {
  kind: 'testid' | 'role' | 'label' | 'text' | 'css';
  value: string;
  score: number;
  reason: string;
}

export interface UiOverlayContext {
  type?: 'modal' | 'drawer' | 'dropdown' | 'menu' | 'select-dropdown' | 'picker-dropdown' | 'popover' | 'popconfirm' | 'tooltip';
  title?: string;
  text?: string;
  visible?: boolean;
  rootTestId?: string;
}

export interface UiFormContext {
  label?: string;
  name?: string;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  status?: 'error' | 'warning' | 'success' | 'validating';
}

export interface UiTableContext {
  title?: string;
  rowKey?: string;
  rowText?: string;
  columnTitle?: string;
  columnKey?: string;
  headers?: string[];
  selectedRowCount?: number;
  pagination?: {
    current?: string;
    pageSize?: string;
  };
}

export interface UiOptionContext {
  text?: string;
  value?: string;
  selected?: boolean;
}

export interface UiActionRecipe {
  kind:
    | 'click-button'
    | 'fill-form-field'
    | 'select-option'
    | 'pick-date'
    | 'pick-range'
    | 'pick-time'
    | 'modal-action'
    | 'drawer-action'
    | 'dropdown-menu-action'
    | 'confirm-popconfirm'
    | 'show-tooltip'
    | 'table-row-action'
    | 'protable-search'
    | 'editable-table-cell'
    | 'switch-tab'
    | 'switch-step'
    | 'upload-file'
    | 'paginate'
    | 'toggle-control'
    | 'transfer-item'
    | 'tree-node-action'
    | 'raw-dom-action';

  library: UiLibrary;
  component: UiComponentKind;
  fieldLabel?: string;
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

## 6. 接入点

### 6.1 `PageContextSnapshot`

修改：

```text
examples/recorder-crx/src/flow/pageContextTypes.ts
```

加入：

```ts
import type { UiSemanticContext } from '../uiSemantics/types';

export interface PageContextSnapshot {
  // existing fields
  ui?: UiSemanticContext;
}
```

### 6.2 `pageContextSidecar.ts`

修改：

```text
examples/recorder-crx/src/pageContextSidecar.ts
```

在采集 page context 时：

```ts
import { collectUiSemanticContext } from './uiSemantics';

const anchor = actionAnchorForElement(target);
const snapshot: PageContextSnapshot = {
  ...existing,
  ui: collectUiSemanticContext(anchor, document),
};
```

不要删除原有 `target/form/table/dialog` 采集。UI semantic 是增强，不是替代。

### 6.3 `FlowStep`

修改：

```text
examples/recorder-crx/src/flow/types.ts
```

加入：

```ts
import type { UiActionRecipe } from '../uiSemantics/types';

export interface FlowStep {
  // existing fields
  uiRecipe?: UiActionRecipe;
}
```

### 6.4 `flowBuilder.ts`

修改：

```text
examples/recorder-crx/src/flow/flowBuilder.ts
```

重点函数：

- `flowTargetFromPageContext`
- `buildSyntheticClickStep`
- `mergeStepContextsIntoFlow` 或等价 context merge 逻辑

规则：

```text
snapshot.ui.targetTestId 优先补 target.testId
snapshot.ui.form.label 优先补 target.label
snapshot.ui.option.text 优先补 target.text/displayName
snapshot.ui.recipe 写入 step.uiRecipe
recipe.kind=select-option 时 synthetic action 可推断为 select
recipe.kind=fill-form-field 时 synthetic action 可推断为 fill
```

### 6.5 `intentRules.ts`

新增基于 recipe 的 intent suggestion：

```ts
select-option => 选择 {fieldLabel} 为 {optionText}
fill-form-field => 填写 {fieldLabel}
modal-action + 保存/确定 => 确认保存 {overlayTitle}
table-row-action => {targetText}{rowKey}{tableTitle}
switch-tab => 切换到 {targetText} 页签
confirm-popconfirm => 确认 {targetText} {rowKey/tableTitle}
editable-table-cell => 编辑 {rowKey} 的 {columnTitle}
```

不要覆盖用户手动 intent。

### 6.6 AI intent input

修改构造 AI input 的模块，把语义上下文加入输入：

```json
{
  "ui": {
    "library": "antd",
    "component": "select",
    "recipe": {
      "kind": "select-option",
      "fieldLabel": "WAN",
      "optionText": "WAN2"
    }
  }
}
```

不要发送：

```text
完整 DOM
rawAction
cookie/token/password/authorization
完整接口响应
```

### 6.7 `compactExporter.ts`

每个 step 输出简洁 UI 语义：

```yaml
ui:
  library: antd
  component: select
  recipe: select-option
  field: WAN
  option: WAN2
  table: 共享 WAN
  row: WAN1
  overlay: 新建共享 WAN
  target: WAN2
```

## 7. Feature flag

建议在设置中增加：

```ts
semanticAdapterEnabled?: boolean;
```

默认：

```ts
semanticAdapterEnabled: true
```

如果改设置 UI 成本高，本轮可以先使用常量：

```ts
const SEMANTIC_ADAPTER_ENABLED = true;
```

## 8. 回滚策略

最小回滚：

```text
关闭 semanticAdapterEnabled
```

因为本轮只做 annotation，不重写 recorder/player，即使 adapter 出错，也不应该破坏原始录制流程。
