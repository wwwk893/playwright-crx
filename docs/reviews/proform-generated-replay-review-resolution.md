# ProForm Generated Replay Review Resolution

## Scope

PR #3: `fix: prevent ProForm generated replay false greens`

This document records the combined follow-up from two reviewers:

1. GPT-5.5 Pro external review, provided out of band by the repository owner.
2. GitHub Codex automated PR review on PR #3.

The review target is the CRX business-flow generated replay path, especially the ProForm network-resource flow that previously could false-green when generated code clicked `network-resource-save` before filling required fields.

## Combined verdict before follow-up

- P0 false-green risk: materially addressed by PR #3.
- Merge blocker: one P1 ordering edge remained in `flowBuilder.ts`.
- Non-blocking but worth fixing in the same PR:
  - parameterized dropdown option replay should avoid partial first-match clicks;
  - human-like generated replay should also assert terminal business state for the network-resource smoke case;
  - human-like smoke is still a pragmatic hybrid in a few deterministic clicks, not a pure mouse-only test.

## Findings and disposition

### P1 — Mixed timestamp recorded batch could append after synthetic steps

Source:

- GPT-5.5 Pro review
- GitHub Codex inline comment on `examples/recorder-crx/src/flow/flowBuilder.ts`

Problem:

`shouldPlaceRecordedBatchAroundSyntheticSteps()` checks whether any draft in the batch has `wallTime`, but the insertion index was computed from `drafts[0]`. If the first draft was untimed and a later draft was timed, `projectedDraftInsertionIndex()` fell back to `steps.length`, appending the whole recorded batch after an existing synthetic page-context step.

Resolution:

- Added regression test:
  - `recorded action batch with first untimed draft uses first timed draft for synthetic-relative insertion`
- Added `insertionAnchorDraft()` and changed batch insertion to anchor on the first timed draft, falling back to `drafts[0]` only when the whole batch is untimed.

Files:

- `examples/recorder-crx/src/flow/flowBuilder.ts`
- `examples/recorder-crx/src/flow/stepStability.test.ts`

### P1/P2 — Parameterized popup option replay should not use partial first-match clicks

Source:

- GPT-5.5 Pro review

Problem:

Parameterized dropdown replay previously emitted or could retain first-match paths such as `filter({ hasText: String(row.vrf) }).first().click()`. That is scoped to the active popup, but still risks choosing a longer partial option such as `NAT集群A-备份` when the expected value is `NAT集群A`.

Resolution:

- Strengthened the flow stability test to require `evaluateAll((elements, expectedText) => ...)` exact validation and to reject fallback to `elements[elements.length - 1]`.
- Removed the `|| elements[elements.length - 1]` fallback from AntD option dispatch.
- Added an exact active-popup dispatch helper for raw parameterized `getByText(...).click()` replacement paths.

Files:

- `examples/recorder-crx/src/flow/codePreview.ts`
- `examples/recorder-crx/src/flow/stepStability.test.ts`

### P2 — Human-like network-resource generated replay should assert terminal state

Source:

- GPT-5.5 Pro review

Problem:

The deterministic `@proform-fields` path had terminal-state assertions, but the human-like network-resource smoke replay still only executed generated code. That was not the original P0, but it left the same class of false-green risk in an adjacent smoke path.

Resolution:

- Extended `replayGeneratedPlaywrightCode()` in `tests/crx/humanLikeRecorder.spec.ts` to accept an inline verification callback and standalone verification lines.
- Added terminal-state assertions for the network-resource human smoke replay:
  - `res-web-01`
  - `edge-lab:WAN1`
  - `生产VRF`
  - `华东生产区`
  - `NAT集群A`
  - `web:443`
  - `生产访问策略`

File:

- `tests/crx/humanLikeRecorder.spec.ts`

### Follow-up from stress verification — stable testId fill must beat polluted label context

Source:

- Full CRX replay terminal-state failure for `@proform-fields`.

Problem:

One generated replay filled `pool-proform-alpha` into the WAN ProFormSelect search input instead of the resource-name input. The affected step still had the stable `network-resource-name` test id, but its display/name context had been polluted by nearby WAN select text. `codePreview.ts` preferred the polluted label/form context over the stable test id for fill actions.

Resolution:

- For non-combobox fill actions, `codePreview.ts` now prefers `page.getByTestId(...).fill(...)` when a stable test id exists.
- Added flow regression test:
  - `fill with stable test id ignores polluted ProFormSelect label context`.

Files:

- `examples/recorder-crx/src/flow/codePreview.ts`
- `examples/recorder-crx/src/flow/stepStability.test.ts`

### Follow-up from stress verification — synthetic submit clicks must stay after earlier timed recorded fields

Source:

- Local `@proform-fields` focused stress after the initial P1 fix.

Problem:

A deeper ordering edge remained: when page-context synthetic clicks such as scope/cascader/final save had already been appended, a later recorder batch could still leave timed recorded fields (`healthUrl`, `serviceName`, `port`, `remark`) after a later synthetic submit click. That reproduced the original P0 shape: generated code could click final save before required fields.

Resolution:

- Added a local synthetic-submit ordering normalization in `flowBuilder.ts`:
  - only applies to synthetic submit/save/confirm clicks;
  - moves later-listed timed steps back before that synthetic submit when their wall time is earlier;
  - intentionally does not globally sort recorder batches;
  - intentionally does not touch dropdown/cascader option synthetic clicks, preserving option-trigger adjacency.
- Added flow regression test:
  - `late recorded fields are restored before a later synthetic submit click`.

Files:

- `examples/recorder-crx/src/flow/flowBuilder.ts`
- `examples/recorder-crx/src/flow/stepStability.test.ts`

### Follow-up from stress verification — order assertions should target submit safety, not independent field ordering

Source:

- Local `@proform-fields --repeat-each=10` verification after review fixes.

Problem:

The generated artifact sometimes placed independent synthetic/select steps such as `发布范围/华东生产区` before the health URL fill, while the final submit still happened after all required fields and terminal replay assertions still proved successful persistence. The previous string order assertion overfit independent field ordering and did not directly represent the P0 false-green condition.

Resolution:

- Kept the opening validation order check (`add -> first save -> resource name`).
- Strengthened `assertNoNetworkResourceSubmitBeforeRequiredFields()` so the final `network-resource-save` must appear after every critical business marker:
  - resource name, WAN, VRF, ARP/health controls, health URL, scope, egress path, service/port, remark.
- This keeps the P0 guard against save-before-fields while allowing independent fields to be generated in a safe order.

File:

- `tests/crx/businessFlowRecorder.spec.ts`

### Follow-up from stress verification — IPv4 deterministic helper needed state-tied submit sync

Source:

- Local `@ipv4-pool --repeat-each=10` verification after review fixes.

Problem:

The IPv4 deterministic flow clicked confirm once and immediately asserted the table row. In repeat pressure, Playwright could report the confirm button as detached during the click, or the row assertion could race the dialog close/save transition.

Resolution:

- Confirmed input values are landed before submit.
- Click confirm until either the dialog closes or the target row becomes visible.
- Preserve the business assertion that the target row must contain `test1`, `xtest16:WAN1`, `1.1.1.1`, and `2.2.2.2`.

File:

- `tests/crx/businessFlowRecorder.spec.ts`

### Follow-up from full CRX verification — stale recorder surface recovery should rediscover extension pages

Source:

- Full business-flow file run after review fixes.

Problem:

`attachRecorder()` recovery from a stale extension page closed the old page and then waited only for the next `page` event. In full-suite pressure, the extension surface could be created/reused without that specific waiter observing the event, causing an infra failure: `Recorder surface business-flow did not recover after closing stale extension page`.

Resolution:

- After closing a stale extension page, the helper now:
  - waits for a fresh page event;
  - if the event is missed, rediscover existing extension pages in the context;
  - retries attach once before failing.
- This is a test synchronization fix; it does not weaken recorder/business-flow assertions.

File:

- `tests/crx/crxRecorderTest.ts`

### Accepted limitation — human-like smoke remains pragmatic hybrid

Source:

- GPT-5.5 Pro review

Observation:

The network-resource human-like smoke still uses a few deterministic Playwright clicks for the health switch/save retry loop. These are not silent fallbacks, and strict human options are already used for the select/tree/cascader paths most likely to hide recorder or codegen bugs.

Disposition:

Accepted for this PR. The test should be described as `human-like hybrid smoke`, not as a pure mouse-only test. The important false-green gap is addressed by terminal-state replay assertions.

## Verification completed in this follow-up

- `npm run test:flow --prefix examples/recorder-crx` → `104 flow stability tests passed`
- `npm run build:examples:recorder` → passed
- `npm run build:tests` → passed
- `xvfb-run -a npx playwright test -c tests/playwright.config.ts tests/crx/businessFlowRecorder.spec.ts --project=Chrome --grep '@proform-fields|@ipv4-pool' --workers=1 --repeat-each=5 --reporter=line --global-timeout=700000` → `10 passed`
- `xvfb-run -a npx playwright test -c tests/playwright.config.ts tests/crx/businessFlowRecorder.spec.ts --project=Chrome --workers=1 --reporter=line --global-timeout=600000` → `5 passed`
- `xvfb-run -a npx playwright test -c tests/playwright.config.ts tests/crx/humanLikeRecorder.spec.ts --project=Chrome --grep 'network resource complex form' --workers=1 --reporter=line --global-timeout=300000` → passed
- `npm run test:crx:all -- --reporter=line --global-timeout=1800000` → `153 passed / 3 skipped`
- `git diff --check` → passed

## Merge recommendation after follow-up

If GitHub CI remains green, the review disposition changes from `Request changes` to `Approve after CI`.
