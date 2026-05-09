# Human-like E2E Policy

## Definition

Human-like means using real browser page, real extension UI, and realistic mouse/keyboard interactions for critical business paths.

It does not mean every helper must be pure mouse. The suite may be hybrid, but fallback must be explicit.

## Rules

- Critical Select/TreeSelect/Cascader/Popconfirm/Modal interactions should use mouse/keyboard where possible.
- If helper falls back to force click / dispatch / locator.click, it must either fail in L3 or attach fallback diagnostics.
- Do not use hidden DOM evaluate to click extension UI.
- Do not replace real AntD/ProComponents fixtures with mock-only fixtures.

## Allowed in L2 but not L3

- deterministic `dispatchEvent` for AntD virtual option replay
- direct `locator.click()` fallback
- helper-generated repeat selection from exported JSON

## Required evidence

Human-like smoke should attach:

```text
business-flow.json
generated.spec.ts
recorder screenshot
business page screenshot
runtime log
trace/video on failure
```
