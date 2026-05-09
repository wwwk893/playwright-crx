# Replay Compiler Design

## Current problem

`codePreview.ts` currently does too much: inherited dialog/table context, Select inference, repeat rendering, assertion rendering, exported code, parser-safe runtime code, and action counting.

## Target files

```text
examples/recorder-crx/src/replay/recipeBuilder.ts
examples/recorder-crx/src/replay/exportedRenderer.ts
examples/recorder-crx/src/replay/parserSafeRenderer.ts
examples/recorder-crx/src/replay/assertionRenderer.ts
examples/recorder-crx/src/replay/repeatRenderer.ts
examples/recorder-crx/src/replay/actionCounter.ts
```

`codePreview.ts` remains as façade:

```ts
export function generateBusinessFlowPlaywrightCode(flow: BusinessFlow) {
  return exportedRenderer(renderableFlowFromBusinessFlow(flow));
}

export function generateBusinessFlowPlaybackCode(flow: BusinessFlow) {
  return parserSafeRenderer(renderableFlowFromBusinessFlow(flow));
}

export function countBusinessFlowPlaybackActions(flow: BusinessFlow) {
  return countParserSafeActions(renderableFlowFromBusinessFlow(flow));
}
```

## Renderer rules

### Exported renderer

May use:

- `evaluateAll`
- exact match dispatch
- conditional checks
- terminal-state assertions

### Parser-safe renderer

Must only output parser-compatible lines:

- `await page.locator(...).click();`
- `await page.locator(...).fill(...);`
- `await expect(...).toBeVisible();`

No complex `if`, callbacks, `.catch()`, custom functions.

## Acceptance

- Exported and parser-safe code produce same business state.
- Action count equals parser-safe rendered action count.
- Existing public functions remain stable.
