# UiActionRecipe Design

## Purpose

UiActionRecipe 是业务步骤与回放代码之间的稳定语义层。Exported Playwright code 和 plugin runtime parser-safe code 都必须从同一个 Recipe 渲染。

## Type sketch

```ts
export interface UiActionRecipe {
  version: 1;
  framework: 'antd' | 'procomponents' | 'generic';
  component:
    | 'Input'
    | 'Select'
    | 'TreeSelect'
    | 'Cascader'
    | 'TableRowAction'
    | 'ModalButton'
    | 'PopconfirmButton'
    | 'Switch'
    | 'Checkbox'
    | 'Radio'
    | 'Tab'
    | 'Button';
  operation:
    | 'fill'
    | 'selectOption'
    | 'click'
    | 'confirm'
    | 'toggle'
    | 'rowAction';
  target: {
    testId?: string;
    label?: string;
    role?: string;
    dialog?: unknown;
    table?: unknown;
    row?: unknown;
  };
  value?: string;
  option?: {
    searchText?: string;
    displayText: string;
    exactTokens: string[];
    path?: string[];
  };
  replay: {
    exportedStrategy: string;
    parserSafeStrategy: string;
    runtimeFallback?: string;
  };
}
```

## Rules

- Recipe is created during projection/recipeBuilder, not in renderer.
- Renderer must not infer AntD/ProComponents semantics from raw selectors if recipe exists.
- If parser-safe cannot express action, recipe must declare runtimeFallback.
- Recipe is internal by default; compact YAML only gets compact business semantics, not raw locator internals.

## Examples

### AntD Select

```ts
{
  framework: 'antd',
  component: 'Select',
  operation: 'selectOption',
  target: { label: 'WAN口', dialog: { title: '新建IPv4地址池' } },
  option: {
    searchText: 'xtest16',
    displayText: 'xtest16:WAN1',
    exactTokens: ['xtest16:WAN1']
  },
  replay: {
    exportedStrategy: 'antd-dispatch-option',
    parserSafeStrategy: 'active-popup-click',
    runtimeFallback: 'active-antd-popup-dispatch'
  }
}
```
