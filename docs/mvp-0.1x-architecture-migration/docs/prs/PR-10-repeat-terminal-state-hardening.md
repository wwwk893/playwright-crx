# PR-10: Repeat and Terminal-State Assertions Hardening

## Goal

Make replay tests prove business success, not only script completion.

## Files

Modify:

```text
examples/recorder-crx/src/flow/repeatSegments.ts
examples/recorder-crx/src/replay/repeatRenderer.ts
tests/crx/businessFlowRecorder.spec.ts
tests/crx/humanLikeRecorder.spec.ts
tests/crx/helpers/replayAssertions.ts   # add if useful
```

## Implementation

1. Every generated replay E2E must have terminal-state verification.
2. Repeat segment generated code must preserve terminal assertions per row where possible.
3. Table row assertions should use row identity/table scope.
4. Add helper:

```ts
replayGeneratedPlaywrightCode(context, code, testInfo, async page => {
  await expect(page.getByTestId('...')).toContainText('...');
});
```

5. Add false-green tests for:
   - save before required fields
   - row not created
   - row not deleted
   - modal still open

## Tests

```text
- generated replay fails if row missing
- generated replay fails if save happens before required fields
- repeat row parameter changes produce multiple terminal rows
- tableRowExists assertion rendered and runtime-played
```

Commands:

```bash
npm run test:flow --prefix examples/recorder-crx
cd tests
xvfb-run -a npx playwright test crx/businessFlowRecorder.spec.ts crx/humanLikeRecorder.spec.ts \
  --config=playwright.config.ts --project=Chrome --workers=1 --reporter=line
```

## Rollback

Terminal-state tests can be scoped to new cases first; do not remove existing assertions.
