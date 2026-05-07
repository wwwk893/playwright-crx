# Semantic Context 示例

## 1. Button 内部 span/svg

DOM：

```html
<button class="ant-btn" data-testid="site-ip-port-pool-create-button">
  <span>新建</span>
</button>
```

点击 `span` 时，期望：

```json
{
  "library": "antd",
  "component": "button",
  "targetText": "新建",
  "targetTestId": "site-ip-port-pool-create-button",
  "recipe": {
    "kind": "click-button",
    "library": "antd",
    "component": "button",
    "targetText": "新建"
  }
}
```

FlowTarget：

```json
{
  "testId": "site-ip-port-pool-create-button",
  "role": "button",
  "text": "新建",
  "displayName": "新建"
}
```

## 2. Select option portal

DOM：

```html
<div class="ant-form-item">
  <div class="ant-form-item-label"><label>WAN</label></div>
  <div class="ant-select" data-testid="site-wan-select">
    <div class="ant-select-selector"></div>
  </div>
</div>

<div class="ant-select-dropdown">
  <div class="ant-select-item-option">WAN2</div>
</div>
```

点击 `WAN2` option，期望：

```json
{
  "library": "antd",
  "component": "select",
  "targetText": "WAN2",
  "targetTestId": "site-wan-select",
  "form": {
    "label": "WAN"
  },
  "option": {
    "text": "WAN2"
  },
  "overlay": {
    "type": "select-dropdown",
    "visible": true
  },
  "recipe": {
    "kind": "select-option",
    "library": "antd",
    "component": "select",
    "fieldLabel": "WAN",
    "optionText": "WAN2",
    "targetText": "WAN2"
  }
}
```

Intent：

```text
选择 WAN 为 WAN2
```

compact-flow.yaml：

```yaml
ui:
  library: antd
  component: select
  recipe: select-option
  field: WAN
  option: WAN2
  target: WAN2
```

## 3. TreeSelect node

```json
{
  "library": "antd",
  "component": "tree-select",
  "form": { "label": "部门" },
  "option": { "text": "研发部" },
  "recipe": {
    "kind": "select-option",
    "fieldLabel": "部门",
    "optionText": "研发部"
  }
}
```

Intent：

```text
选择部门为研发部
```

## 4. Cascader option

```json
{
  "library": "antd",
  "component": "cascader",
  "form": { "label": "区域" },
  "option": { "text": "上海" },
  "recipe": {
    "kind": "select-option",
    "fieldLabel": "区域",
    "optionText": "上海"
  }
}
```

Intent：

```text
选择区域为上海
```

## 5. DatePicker

```json
{
  "library": "antd",
  "component": "date-picker",
  "form": {
    "label": "生效日期"
  },
  "overlay": {
    "type": "picker-dropdown",
    "visible": true
  },
  "recipe": {
    "kind": "pick-date",
    "fieldLabel": "生效日期"
  }
}
```

Intent：

```text
选择生效日期
```

## 6. RangePicker

```json
{
  "library": "antd",
  "component": "range-picker",
  "form": {
    "label": "有效期"
  },
  "recipe": {
    "kind": "pick-range",
    "fieldLabel": "有效期"
  }
}
```

Intent：

```text
选择有效期
```

## 7. Modal submit

DOM：

```html
<div class="ant-modal">
  <div class="ant-modal-title">新建共享 WAN</div>
  <button class="ant-btn ant-btn-primary">确定</button>
</div>
```

期望：

```json
{
  "library": "antd",
  "component": "modal",
  "targetText": "确定",
  "overlay": {
    "type": "modal",
    "title": "新建共享 WAN",
    "visible": true
  },
  "recipe": {
    "kind": "modal-action",
    "overlayTitle": "新建共享 WAN",
    "targetText": "确定"
  }
}
```

Intent：

```text
确认保存新建共享 WAN
```

## 8. Drawer submit

```json
{
  "library": "antd",
  "component": "drawer",
  "targetText": "保存",
  "overlay": {
    "type": "drawer",
    "title": "编辑站点配置"
  },
  "recipe": {
    "kind": "drawer-action",
    "overlayTitle": "编辑站点配置",
    "targetText": "保存"
  }
}
```

Intent：

```text
确认保存编辑站点配置
```

## 9. Dropdown menu item

```json
{
  "library": "antd",
  "component": "dropdown",
  "targetText": "禁用",
  "overlay": {
    "type": "dropdown",
    "visible": true
  },
  "recipe": {
    "kind": "dropdown-menu-action",
    "targetText": "禁用"
  }
}
```

Intent：

```text
点击禁用菜单项
```

## 10. Popconfirm OK

```json
{
  "library": "antd",
  "component": "popconfirm",
  "targetText": "确定",
  "overlay": {
    "type": "popconfirm",
    "text": "确定删除吗？"
  },
  "table": {
    "title": "共享 WAN",
    "rowKey": "WAN1"
  },
  "recipe": {
    "kind": "confirm-popconfirm",
    "targetText": "确定",
    "tableTitle": "共享 WAN",
    "rowKey": "WAN1"
  }
}
```

Intent：

```text
确认删除 WAN1 共享 WAN
```

## 11. Tooltip

```json
{
  "library": "antd",
  "component": "tooltip",
  "targetText": "帮助",
  "overlay": {
    "type": "tooltip",
    "text": "这里配置共享 WAN 的优先级"
  },
  "recipe": {
    "kind": "show-tooltip",
    "targetText": "帮助"
  }
}
```

Intent：

```text
查看帮助提示
```

## 12. ProTable row action

DOM：

```html
<div class="ant-pro-table" data-testid="ha-wan-config-table">
  <div class="ant-pro-table-list-toolbar-title">共享 WAN</div>
  <table>
    <thead><tr><th>名称</th><th>状态</th><th>操作</th></tr></thead>
    <tbody>
      <tr data-row-key="WAN1">
        <td>WAN1</td>
        <td>启用</td>
        <td><button class="ant-btn">编辑</button></td>
      </tr>
    </tbody>
  </table>
</div>
```

期望：

```json
{
  "library": "pro-components",
  "component": "pro-table",
  "targetText": "编辑",
  "targetTestId": "ha-wan-config-table",
  "table": {
    "title": "共享 WAN",
    "rowKey": "WAN1",
    "rowText": "WAN1 启用 编辑",
    "columnTitle": "操作"
  },
  "recipe": {
    "kind": "table-row-action",
    "tableTitle": "共享 WAN",
    "rowKey": "WAN1",
    "columnTitle": "操作",
    "targetText": "编辑"
  }
}
```

Intent：

```text
编辑 WAN1 共享 WAN
```

## 13. EditableProTable cell

```json
{
  "library": "pro-components",
  "component": "editable-pro-table",
  "form": {
    "label": "MTU"
  },
  "table": {
    "title": "共享 WAN",
    "rowKey": "WAN1",
    "columnTitle": "MTU"
  },
  "recipe": {
    "kind": "editable-table-cell",
    "tableTitle": "共享 WAN",
    "rowKey": "WAN1",
    "columnTitle": "MTU",
    "fieldLabel": "MTU"
  }
}
```

Intent：

```text
编辑 WAN1 的 MTU
```

## 14. ModalForm

```json
{
  "library": "pro-components",
  "component": "modal-form",
  "form": {
    "label": "名称"
  },
  "overlay": {
    "type": "modal",
    "title": "新建 IP 端口地址池"
  },
  "recipe": {
    "kind": "modal-action",
    "overlayTitle": "新建 IP 端口地址池"
  }
}
```

Intent：

```text
填写新建 IP 端口地址池的名称
```

或者提交时：

```text
确认保存新建 IP 端口地址池
```

## 15. DrawerForm

```json
{
  "library": "pro-components",
  "component": "drawer-form",
  "overlay": {
    "type": "drawer",
    "title": "编辑 WAN 配置"
  },
  "recipe": {
    "kind": "drawer-action",
    "overlayTitle": "编辑 WAN 配置",
    "targetText": "保存"
  }
}
```

Intent：

```text
确认保存编辑 WAN 配置
```

## 16. StepsForm

```json
{
  "library": "pro-components",
  "component": "steps-form",
  "targetText": "下一步",
  "recipe": {
    "kind": "switch-step",
    "targetText": "下一步"
  }
}
```

Intent：

```text
进入下一步
```

## 17. Upload

```json
{
  "library": "antd",
  "component": "upload",
  "form": {
    "label": "证书文件"
  },
  "recipe": {
    "kind": "upload-file",
    "fieldLabel": "证书文件"
  }
}
```

Intent：

```text
上传证书文件
```

## 18. Switch / Checkbox / Radio

```json
{
  "library": "antd",
  "component": "switch",
  "form": {
    "label": "启用"
  },
  "recipe": {
    "kind": "toggle-control",
    "fieldLabel": "启用",
    "targetText": "开启"
  }
}
```

Intent：

```text
开启启用
```

后续可优化为：

```text
启用当前配置
```


# 补充：ProForm / ProTable / Table / Form 示例

## ProFormSelect in ModalForm

```json
{
  "library": "pro-components",
  "component": "pro-form-field",
  "targetText": "WAN2",
  "targetTestId": "site-wan-select",
  "form": {
    "formKind": "modal-form",
    "formTitle": "新建 IP 端口地址池",
    "fieldKind": "pro-form-select",
    "label": "WAN",
    "name": "wan"
  },
  "overlay": {
    "type": "select-dropdown",
    "visible": true
  },
  "option": {
    "text": "WAN2"
  },
  "recipe": {
    "kind": "select-option",
    "library": "pro-components",
    "component": "pro-form-field",
    "formKind": "modal-form",
    "fieldKind": "pro-form-select",
    "fieldLabel": "WAN",
    "fieldName": "wan",
    "optionText": "WAN2",
    "overlayTitle": "新建 IP 端口地址池"
  },
  "confidence": 0.92,
  "reasons": ["matched ProForm field", "matched AntD Select", "matched visible select dropdown"]
}
```

## ProTable toolbar 新建

```json
{
  "library": "pro-components",
  "component": "pro-table",
  "targetText": "新建",
  "targetTestId": "site-ip-port-pool-create-button",
  "table": {
    "tableKind": "pro-table",
    "title": "IP 端口地址池",
    "region": "toolbar"
  },
  "recipe": {
    "kind": "protable-toolbar-action",
    "library": "pro-components",
    "component": "pro-table",
    "tableTitle": "IP 端口地址池",
    "targetText": "新建"
  },
  "confidence": 0.91,
  "reasons": ["matched ProTable", "matched toolbar action"]
}
```

## ProTable row edit

```json
{
  "library": "pro-components",
  "component": "pro-table",
  "targetText": "编辑",
  "targetTestId": "site-ip-port-pool-row-edit-action",
  "table": {
    "tableKind": "pro-table",
    "title": "IP 端口地址池",
    "rowKey": "pool-1",
    "rowText": "pool-1 启用 编辑 删除",
    "columnTitle": "操作",
    "region": "row-action"
  },
  "recipe": {
    "kind": "table-row-action",
    "library": "pro-components",
    "component": "pro-table",
    "tableTitle": "IP 端口地址池",
    "rowKey": "pool-1",
    "columnTitle": "操作",
    "targetText": "编辑"
  },
  "confidence": 0.93,
  "reasons": ["matched ProTable row action", "resolved rowKey from tr[data-row-key]"]
}
```

## EditableProTable cell edit

```json
{
  "library": "pro-components",
  "component": "editable-pro-table",
  "targetText": "1500",
  "form": {
    "formKind": "pro-form",
    "fieldKind": "input",
    "label": "MTU"
  },
  "table": {
    "tableKind": "editable-pro-table",
    "title": "共享 WAN",
    "rowKey": "WAN1",
    "columnTitle": "MTU",
    "region": "editable-cell"
  },
  "recipe": {
    "kind": "editable-table-cell",
    "library": "pro-components",
    "component": "editable-pro-table",
    "tableTitle": "共享 WAN",
    "rowKey": "WAN1",
    "columnTitle": "MTU",
    "fieldLabel": "MTU"
  },
  "confidence": 0.9,
  "reasons": ["matched EditableProTable cell", "resolved rowKey and columnTitle"]
}
```

## AntD Form submit

```json
{
  "library": "antd",
  "component": "form",
  "targetText": "提交",
  "form": {
    "formKind": "antd-form",
    "formTitle": "告警方式配置"
  },
  "recipe": {
    "kind": "submit-form",
    "library": "antd",
    "component": "form",
    "formKind": "antd-form",
    "targetText": "提交"
  },
  "confidence": 0.84,
  "reasons": ["matched form submit button"]
}
```

## AntD Table pagination

```json
{
  "library": "antd",
  "component": "pagination",
  "targetText": "2",
  "table": {
    "tableKind": "antd-table",
    "title": "告警方式列表",
    "region": "pagination",
    "currentPage": "1",
    "pageSize": "20 / 页"
  },
  "recipe": {
    "kind": "paginate",
    "library": "antd",
    "component": "pagination",
    "tableTitle": "告警方式列表",
    "targetText": "2"
  },
  "confidence": 0.82,
  "reasons": ["matched AntD Pagination", "associated pagination with nearest table"]
}
```
