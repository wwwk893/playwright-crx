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
- Are L1/L2/L3 layers used correctly?
- Are human-like fallbacks failing or reported?
- Are real AntD/ProComponents fixtures preserved?
