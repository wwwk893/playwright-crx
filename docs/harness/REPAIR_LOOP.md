# Repair Loop

Use this loop for recorder/replay failures and flaky investigation.

## Loop

```text
1. Identify the failing layer.
2. Reproduce targeted.
3. Collect artifacts.
4. Classify the failure.
5. Add or tighten an eval/regression.
6. Patch the smallest owning layer.
7. Run required validation.
8. Update or close the issue.
```

## Classification

| Class | Fix location |
| --- | --- |
| Product/replay bug | projection, recipe, replay renderer, runtime bridge |
| Harness timing bug | test helper or wait condition tied to real state |
| Stale test target | update test intent and document migration |
| Privacy/redaction issue | redactor/export/diagnostic sanitizer |
| Architecture boundary violation | move logic to the owning layer |

## Targeted Reproduction

Prefer the narrowest command that still reproduces the failure:

```bash
npm run test:crx:business-flow:l1
CI=1 npm run test:crx:business-flow:l2 -- --reporter=line --global-timeout=1200000 -g "case name"
CI=1 npm run test:crx:business-flow:l3 -- --reporter=line --global-timeout=1200000 -g "case name"
```

If a single spec passes but CI fails, run the relevant serial suite with
`CI=1`, `--workers=1`, and the same reporter/timeout used by CI.

## Patch Rule

Patch the owning layer:

```text
projection bug -> flow / interactions
recipe bug -> uiSemantics / recipeBuilder
exported code bug -> replay exported renderer
parser-safe code bug -> replay parser-safe renderer + action counter
runtime gap -> recipe runtimeFallback + narrow runtime bridge + tests
terminal oracle bug -> terminalAssertions + L1/L2 coverage
```

Do not patch `src/server/*` to guess business semantics.

## Closeout

A fix PR should state:

```text
root cause
affected layer
new or tightened eval case
commands run
remaining flaky risk or issue link
```
