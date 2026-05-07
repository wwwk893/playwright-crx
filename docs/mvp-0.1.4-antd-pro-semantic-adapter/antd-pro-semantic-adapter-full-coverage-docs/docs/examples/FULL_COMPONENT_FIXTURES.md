# 全组件测试 Fixture 示例

本文件给云端 agent 用于编写 `uiSemantics.test.ts` 的 DOM fixture 参考。

## 1. Button span/svg

```html
<button class="ant-btn" data-testid="site-create-button">
  <span>新建</span>
  <svg role="img"></svg>
</button>
```

期望：

```ts
component = 'button'
targetTestId = 'site-create-button'
recipe.kind = 'click-button'
```

## 2. AntD Form.Item + Input

```html
<form class="ant-form" data-testid="site-form">
  <div class="ant-form-item">
    <div class="ant-form-item-label"><label class="ant-form-item-required">名称</label></div>
    <div class="ant-form-item-control">
      <input class="ant-input" name="name" data-testid="site-name-field" placeholder="请输入名称" />
    </div>
  </div>
</form>
```

期望：

```ts
component = 'form-item'
form.formKind = 'antd-form'
form.fieldKind = 'input'
form.label = '名称'
form.name = 'name'
form.required = true
```

## 3. ProFormSelect in ModalForm

```html
<div class="ant-modal">
  <div class="ant-modal-title">新建 IP 端口地址池</div>
  <form class="ant-form ant-pro-form" data-testid="modal-form:site-ip-port-pool">
    <div class="ant-form-item" data-field-kind="pro-form-select">
      <div class="ant-form-item-label"><label>WAN</label></div>
      <div class="ant-select" data-testid="site-wan-select">
        <div class="ant-select-selector">WAN1</div>
      </div>
    </div>
  </form>
</div>
<div class="ant-select-dropdown">
  <div class="ant-select-item-option">WAN2</div>
</div>
```

期望：

```ts
library = 'pro-components'
component = 'pro-form-field'
form.formKind = 'modal-form'
form.fieldKind = 'pro-form-select'
form.label = 'WAN'
option.text = 'WAN2'
recipe.kind = 'select-option'
```

## 4. AntD DatePicker / RangePicker

```html
<div class="ant-form-item">
  <div class="ant-form-item-label"><label>生效时间</label></div>
  <div class="ant-picker ant-picker-range" data-testid="effective-range-field">
    <div class="ant-picker-input"><input /></div>
    <div class="ant-picker-input"><input /></div>
  </div>
</div>
<div class="ant-picker-dropdown">
  <div class="ant-picker-cell ant-picker-cell-in-view">15</div>
  <button class="ant-btn ant-btn-primary">确定</button>
</div>
```

期望：

```ts
component = 'range-picker'
form.label = '生效时间'
overlay.type = 'picker-dropdown'
recipe.kind = 'pick-range'
```

## 5. Modal submit

```html
<div class="ant-modal">
  <div class="ant-modal-title">编辑共享 WAN</div>
  <div class="ant-modal-footer">
    <button class="ant-btn">取消</button>
    <button class="ant-btn ant-btn-primary" data-testid="modal-submit-button">确定</button>
  </div>
</div>
```

期望：

```ts
component = 'modal'
overlay.title = '编辑共享 WAN'
recipe.kind = 'modal-action'
targetText = '确定'
```

## 6. DrawerForm submit

```html
<div class="ant-drawer">
  <div class="ant-drawer-title">编辑站点</div>
  <form class="ant-form ant-pro-form" data-testid="drawer-form:site-edit">
    <button class="ant-btn ant-btn-primary">保存</button>
  </form>
</div>
```

期望：

```ts
library = 'pro-components'
component = 'drawer-form'
form.formKind = 'drawer-form'
overlay.title = '编辑站点'
recipe.kind = 'drawer-action'
```

## 7. Popconfirm

```html
<button class="ant-btn" data-testid="row-delete-action">删除</button>
<div class="ant-popover ant-popconfirm">
  <div class="ant-popconfirm-message-title">确定删除吗？</div>
  <div class="ant-popconfirm-buttons">
    <button class="ant-btn">取消</button>
    <button class="ant-btn ant-btn-primary">确定</button>
  </div>
</div>
```

期望：

```ts
component = 'popconfirm'
overlay.type = 'popconfirm'
overlay.text contains '确定删除吗？'
recipe.kind = 'confirm-popconfirm'
```

## 8. Tooltip / Popover

```html
<button class="ant-btn" data-testid="help-button">?</button>
<div class="ant-tooltip">
  <div class="ant-tooltip-inner">这是帮助说明</div>
</div>
```

期望：

```ts
component = 'tooltip'
overlay.type = 'tooltip'
overlay.text = '这是帮助说明'
recipe.kind = 'show-tooltip'
```

## 9. AntD Table row action

```html
<div class="ant-card">
  <div class="ant-card-head-title">共享 WAN</div>
  <div class="ant-table-wrapper" data-testid="shared-wan-table">
    <table>
      <thead><tr><th>名称</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>
        <tr data-row-key="WAN1">
          <td>WAN1</td>
          <td>启用</td>
          <td><button class="ant-btn" data-testid="shared-wan-row-edit-action">编辑</button></td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
```

期望：

```ts
component = 'table'
table.title = '共享 WAN'
table.rowKey = 'WAN1'
table.columnTitle = '操作'
recipe.kind = 'table-row-action'
```

## 10. ProTable search / toolbar / row action

```html
<div class="ant-pro-table" data-testid="protable:site-ip-port-pool">
  <form class="ant-form ant-pro-table-search">
    <div class="ant-form-item">
      <div class="ant-form-item-label"><label>名称</label></div>
      <input class="ant-input" name="name" />
    </div>
    <button class="ant-btn ant-btn-primary">查询</button>
    <button class="ant-btn">重置</button>
  </form>
  <div class="ant-pro-table-list-toolbar">
    <div class="ant-pro-table-list-toolbar-title">IP 端口地址池</div>
    <button class="ant-btn ant-btn-primary" data-testid="site-ip-port-pool-create-button">新建</button>
  </div>
  <div class="ant-table-wrapper">
    <table>
      <thead><tr><th>名称</th><th>操作</th></tr></thead>
      <tbody>
        <tr data-row-key="pool-1">
          <td>pool-1</td>
          <td><button class="ant-btn">编辑</button></td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
```

期望：

```ts
搜索字段: component='pro-table-search', recipe.kind='fill-form-field' or 'protable-search'
查询按钮: recipe.kind='protable-search'
重置按钮: recipe.kind='protable-reset-search'
新建按钮: recipe.kind='protable-toolbar-action', table.title='IP 端口地址池'
编辑按钮: recipe.kind='table-row-action', rowKey='pool-1'
```

## 11. EditableProTable cell edit

```html
<div class="ant-pro-table" data-testid="protable:editable-wan">
  <div class="ant-pro-table-list-toolbar-title">共享 WAN</div>
  <table>
    <thead><tr><th>WAN</th><th>MTU</th><th>操作</th></tr></thead>
    <tbody>
      <tr data-row-key="WAN1">
        <td>WAN1</td>
        <td>
          <div class="ant-form-item">
            <input class="ant-input" value="1500" />
          </div>
        </td>
        <td>
          <button class="ant-btn">保存</button>
          <button class="ant-btn">取消</button>
        </td>
      </tr>
    </tbody>
  </table>
</div>
```

期望：

```ts
component = 'editable-pro-table'
table.rowKey = 'WAN1'
table.columnTitle = 'MTU'
recipe.kind = 'editable-table-cell'
```

保存按钮：

```ts
recipe.kind = 'editable-table-save-row'
```

## 12. StepsForm

```html
<div data-testid="steps-form:create-site">
  <div class="ant-steps">
    <div class="ant-steps-item ant-steps-item-process"><div class="ant-steps-item-title">基础信息</div></div>
    <div class="ant-steps-item"><div class="ant-steps-item-title">网络配置</div></div>
  </div>
  <form class="ant-form ant-pro-form">
    <button class="ant-btn ant-btn-primary">下一步</button>
  </form>
</div>
```

期望：

```ts
component = 'steps-form'
form.formKind = 'steps-form'
recipe.kind = 'switch-step'
targetText = '下一步'
```

## 13. ProDescriptions / PageContainer / ProCard

```html
<div class="ant-pro-page-container">
  <div class="ant-page-header-heading-title">站点详情</div>
  <div class="ant-pro-card">
    <div class="ant-pro-card-title">基础信息</div>
    <div class="ant-pro-descriptions">
      <div class="ant-descriptions-item">
        <span class="ant-descriptions-item-label">站点名称</span>
        <span class="ant-descriptions-item-content">Tokyo-1</span>
      </div>
    </div>
  </div>
</div>
```

期望：

```ts
page-container: title = '站点详情'
pro-card: title = '基础信息'
pro-descriptions: label='站点名称', value='Tokyo-1'
recipe.kind='assert-description-field'
```
