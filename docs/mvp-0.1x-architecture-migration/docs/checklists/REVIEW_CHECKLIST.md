# Review Checklist

## Architecture

- Does this PR keep raw events, transactions, steps, recipes, and renderers separate?
- Did it avoid putting business inference into codegen or CrxPlayer?
- Does it preserve stable step ids and user edits?
- Does it avoid changing public UI behavior outside scope?

## Input/Select

- Does typing become one fill step?
- Are intermediate values dropped?
- Does stop recording commit open inputs?
- Does Select/TreeSelect/Cascader preserve trigger → search → option semantics?
- Are popup option matches exact or scoped?

## Replay

- Do exported code and runtime code come from the same recipe?
- Does parser-safe code stay parser-safe?
- Is action count tested?
- Does generated replay prove terminal business state?

## Privacy

- Does export sanitizer strip internal event journal, raw actions, source code, adaptive targets?
- Are text previews redacted/truncated?
- Are cookie/token/authorization/password absent?

## Tests

- Was a failing/edge case test added first?
- Are L1/L2/L3 layers used correctly and reported separately?
- L1: did `npm run test:crx:business-flow:l1` cover pure flow/codegen/recipe contracts?
- L2: did `npm run test:crx:business-flow:l2 -- --reporter=line --global-timeout=1200000` cover deterministic CRX generated replay terminal state?
- L3: did `npm run test:crx:business-flow:l3 -- --reporter=line --global-timeout=1200000` cover human-like smoke paths when user interaction stability matters?
- Did the current aggregate `npm run test:crx:business-flow -- --reporter=line --global-timeout=1200000` remain available for full parity?
- Are human-like fallbacks failing or reported?
- Are real AntD/ProComponents fixtures preserved?
