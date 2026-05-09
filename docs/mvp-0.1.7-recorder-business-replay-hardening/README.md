# MVP 0.1.7 Recorder Business Replay Hardening Docs

## Summary

This package defines the recommended next phase after `wwwk893/playwright-crx` PR #11 was merged.

PR #11 completed the MVP 0.1.6 business semantic alignment baseline:

- generic business hint ingestion through `data-testid`, `data-e2e-*`, `data-row-key`, and `data-column-key`;
- `UiSemanticContext` improvements without hardcoding `networking` domain names;
- realistic WAN/IP Pools equivalent AntD/ProComponents CRX fixtures;
- fixes for Select placeholder replay, duplicate row action test ids, row text whitespace matching, and Popconfirm/confirm timing;
- privacy constraints from PR #10 preserved.

The highest-leverage next step is **MVP 0.1.7: Recorder Business Replay Hardening**.

The goal is not to add more component coverage for its own sake. The goal is to make recorded business-flow assets more reviewable, parser-safe, replay-safe, and capable of proving business terminal state instead of merely proving that clicks happened.

## Inputs reviewed

This package is based on the provided handoff bundle:

- `CONTEXT.md`
- `metadata/summary.json`
- `metadata/diff_pr11.patch`
- `metadata/pr11_checks.txt`
- PR #11 issue / inline review summaries
- `docs/mvp-0.1.6-business-components-semantic-alignment/**`
- `files/current/examples/recorder-crx/src/uiSemantics/*`
- `files/current/examples/recorder-crx/src/flow/codePreview.ts`
- `files/current/examples/recorder-crx/src/flow/exportSanitizer.ts`
- `files/current/examples/recorder-crx/src/flow/flowBuilder.ts`
- `files/current/examples/recorder-crx/src/flow/pageContextMatcher.ts`
- `files/current/examples/recorder-crx/src/flow/stepStability.test.ts`
- `files/current/tests/crx/semanticAdapter.spec.ts`
- `files/current/tests/crx/humanLikeRecorder.spec.ts`
- `files/current/tests/server/src/antdWanTransportRealApp.tsx`
- `inputs/networking_contract_summary.md`

The raw downstream business archive is not included and should not be requested for this planning step. Sensitive values must remain `[REDACTED]`.

## Recommended direction

Prioritize in this order:

1. **Terminal-state assertions** for realistic business replay.
2. **Generated replay quality** for parser-safe and runtime-safe code preview/playback.
3. **Privacy-safe diagnostics** for why replay locators/assertions were emitted.
4. **Downstream business repo integration** to keep wrappers emitting stable generic hints.
5. Additional component contracts only where terminal-state coverage needs them.

Do not jump to MVP 0.2 Runner / Flow-to-spec generation yet.

## Recommended execution order

1. Start a plugin PR for MVP 0.1.7 focused on replay asset quality and terminal-state assertion mapping.
2. Add failing regression tests first for PR #11 failure modes:
   - Select placeholder must never replay as option;
   - duplicate row action test ids must remain row/container scoped;
   - Popconfirm confirmation must be scoped to visible popover and terminally asserted;
   - row text matching must be tokenized, not exact whitespace-sensitive;
   - replay must prove row added/changed/deleted, not only click sequence.
3. Implement small, focused code changes in `codePreview.ts`, `flowBuilder.ts`, `pageContextMatcher.ts`, and semantic compact helpers as needed.
4. Run CRX realistic fixtures and full flow tests.
5. In parallel, have the downstream business repo continue wrapper contract adoption, but do not block plugin hardening on broad business instrumentation.

## What to defer

Defer these out of MVP 0.1.7:

- Native Messaging;
- local Node Runner;
- CI automation over downstream apps;
- full Flow → Playwright spec generation;
- AI scoring dashboard;
- Storybook / Playwright CT corpus build-out;
- broad downstream wrapper migration beyond pilot flows;
- hardcoding WAN/IP Pools/networking rules in plugin core;
- replacing real CRX E2E with mocked DOM unit tests.

## Documents

```text
EXECUTIVE_SUMMARY.md
docs/tasks/MVP-0.1.7-RECORDER-BUSINESS-REPLAY-HARDENING.md
docs/design/RECORDER_REPLAY_ASSET_QUALITY.md
docs/design/BUSINESS_SEMANTIC_CONTRACT_NEXT.md
docs/design/DIAGNOSTICS_PRIVACY_SAFE_DEBUGGABILITY.md
docs/testing/E2E_TERMINAL_STATE_ASSERTIONS.md
docs/testing/WAN_AND_IP_POOLS_REALISTIC_COVERAGE_PLAN.md
docs/checklists/REVIEW_CHECKLIST.md
docs/checklists/PR_SPLIT_AND_ACCEPTANCE_GATES.md
docs/prompts/CODEX_OR_CLOUD_AGENT_IMPLEMENTATION_PROMPT.md
docs/prompts/LOCAL_BUSINESS_REPO_AGENT_PROMPT.md
```
