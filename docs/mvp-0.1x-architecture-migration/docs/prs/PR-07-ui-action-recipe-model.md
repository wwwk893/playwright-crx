# PR-07: UiActionRecipe Model

## Goal

Introduce UiActionRecipe as the shared semantic contract between FlowStep and replay renderers.

## Files

Add:

```text
examples/recorder-crx/src/replay/recipes.ts
examples/recorder-crx/src/replay/recipeBuilder.ts
```

Modify:

```text
examples/recorder-crx/src/flow/types.ts
examples/recorder-crx/src/flow/businessFlowProjection.ts
examples/recorder-crx/src/uiSemantics/**
examples/recorder-crx/src/flow/stepStability.test.ts
```

## Type

```ts
export interface UiActionRecipe {
  version: 1;
  framework: 'antd' | 'procomponents' | 'generic';
  component: 'Input' | 'Select' | 'TreeSelect' | 'Cascader' | 'TableRowAction' | 'ModalButton' | 'PopconfirmButton' | 'Switch' | 'Checkbox' | 'Button';
  operation: 'fill' | 'selectOption' | 'click' | 'confirm' | 'toggle' | 'rowAction';
  target: { testId?: string; label?: string; role?: string; dialog?: unknown; table?: unknown; row?: unknown };
  value?: string;
  option?: { searchText?: string; displayText: string; exactTokens: string[]; path?: string[] };
  replay: { exportedStrategy: string; parserSafeStrategy: string; runtimeFallback?: string };
}
```

## Implementation

1. Add `uiRecipe?: UiActionRecipe` to FlowStep.
2. Build recipe during projection for:
   - Input fill
   - AntD Select option
   - TreeSelect
   - Cascader
   - Table row action
   - Popconfirm confirm
   - Switch/Checkbox
3. Do not yet fully rewrite codePreview; allow renderer to fallback to old logic if no recipe.

## Tests

```text
- input fill step gets Input/fill recipe
- AntD Select transaction gets Select/selectOption recipe
- TreeSelect/Cascader preserve option path
- table row action recipe contains table and row identity
- recipe is stripped/sanitized from compact surfaces unless compact-safe
```

Run:

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build:examples:recorder
```

## Rollback

Recipes are additive. If failing, ignore recipe in codegen until PR-08.
