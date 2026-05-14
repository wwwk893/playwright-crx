# Scoring Rubrics

Use these rubrics when deciding whether a change is mergeable.

## L1 Flow / Codegen / Recipe

Pass:

- Pure contract output matches expected.
- Parser-safe action count equals runnable line count.
- Recipe strategy is explicit and stable.
- Redaction/export surfaces do not leak internals.

Fail:

- Action count diverges.
- A renderer re-infers business semantics independently.
- Terminal assertions disappear or weaken.
- Raw diagnostics leak into exported JSON/YAML.

## L2 Deterministic CRX Generated Replay

Pass:

- The real extension records/exported flow.
- Generated replay proves a terminal business state.
- Deterministic helpers only drive setup or hard portal controls.

Fail:

- Script completion is treated as success without terminal state.
- Real AntD/ProComponents fixture coverage is replaced by a mock.
- Assertions are deleted to make replay green.

## L3 Human-Like Smoke

Pass:

- Real mouse/keyboard behavior records the path.
- Replay reaches terminal business state.
- Fallbacks either fail the path or attach explicit evidence.

Fail:

- Helper silently force-clicks, dispatches, mocks, or sleeps through the core
  user interaction.
- The test verifies only that generated code exists.
- The path no longer resembles realistic user behavior.

## Redaction / Privacy

Pass:

- Sensitive fields are masked or omitted.
- Diagnostics are compact and privacy-safe.
- Artifact uploads exclude hidden/private raw data unless intentionally allowed
  and redacted.

Fail:

- Cookies, tokens, passwords, auth headers, full DOM, or full response bodies
  appear in exported flow or attached artifacts.

## Future AI Repair

Pass:

- AI repair input is compact, redacted, and tied to failure artifacts.
- Generated patches are reviewable and locally validated.
- The repair does not change business intent.

Fail:

- AI repair weakens tests.
- AI input includes private raw browser state.
- The patch cannot be reviewed or reproduced.
