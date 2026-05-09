# Executive Summary: Post-PR #11 Next Step

## Current baseline

Treat PR #11 as merged baseline. The context states PR #11 merged at `3184c73408f1afa1658d04ea787aa9989944d4f8` and completed MVP 0.1.6 business semantic alignment.

Validated before merge:

```bash
npm run test:flow --prefix examples/recorder-crx
# 152 flow stability tests passed

Focused WAN/runtime replay tests
# 3 passed

businessFlowRecorder + humanLikeRecorder sequential CRX
# 15 passed

npm run build
# passed

git diff --check
# passed

Full local CRX regression
# 168 passed, 3 skipped
```

Remote checks passed:

```text
build                SUCCESS
CRX full regression  SUCCESS
CRX full regression  SUCCESS
```

No clear P0 blocker was identified in the provided bundle. Do not reopen PR #11 unless CI or owner reports a new blocker.

## Highest-leverage next step

The next step should be **MVP 0.1.7: Recorder Business Replay Hardening**.

Focus first on:

1. **Terminal-state assertions**;
2. **generated replay quality / parser-safe playback**;
3. **privacy-safe diagnostics/debuggability**.

Do not focus first on adding many more business wrappers. PR #11 already proved generic business hints can be consumed. More wrappers help, but without stronger terminal-state assertions the system can still produce false-green flows that click correctly but do not prove the business outcome.

## Why not jump straight to more business wrappers?

Business wrapper contracts are necessary, but the next bottleneck exposed by PR #11 is replay correctness, not hint ingestion.

PR #11 had to fix or harden:

- Select placeholder text such as `选择一个VRF` being replayed as an option;
- duplicate row actions losing row/table scope and becoming global `getByTestId(...).click()`;
- whitespace-sensitive row text exact matching;
- Popconfirm timing and visible popover scoping.

These are replay asset quality issues. If left unresolved, additional business hints can still compile into fragile replay.

## Recommended focus ranking

| Rank | Focus | Decision | Why |
|---:|---|---|---|
| 1 | Terminal-state assertions | Do first | Prevents false-green replay that only proves clicks happened. |
| 2 | Generated replay quality / parser-safe playback | Do first | PR #11 fixes show replay generation still needs guardrails. |
| 3 | Diagnostics/debuggability | Do with 1/2 | Needed to explain why locator/assertion was emitted, without leaking data. |
| 4 | Downstream business repo integration | Parallel, scoped | Keep contract adoption moving, but do not block plugin hardening. |
| 5 | More business wrapper contracts | Continue selectively | Good as pilot support, but not the main plugin next step. |

## Top P0/P1 risks

### P0 risks

1. **False-green replay**: test clicks happen but terminal state is not proven.
2. **Duplicate row action mis-scope**: repeated `data-testid` buttons replay against the wrong row/container.
3. **Unsafe Select option emission**: placeholder or search text becomes option click after repeat/parameter substitution.
4. **Privacy regression**: diagnostics/AI input/export accidentally include raw DOM, rawAction, sourceCode, locator hints, reasons, rowText, overlay.text, or option values.
5. **Hardcoded domain rules**: WAN/IP Pools names leak into plugin core instead of staying as fixture-only scenarios.

### P1 risks

1. **Whitespace-sensitive row matching** causes flake on AntD/ProTable text layout.
2. **Popconfirm/overlay timing** causes replay to click a stale or wrong popover button.
3. **Business repo and plugin contract drift**: downstream emits attributes the plugin does not understand, or plugin expects hints not yet emitted.
4. **Diagnostic over-collection**: useful debugging fields become privacy liabilities.
5. **Scope creep into MVP 0.2**: attempts to build full spec generation/Runner before replay asset quality is stable.

## Split recommendation

Use at least three plugin PR slices plus one downstream business repo slice:

```text
Plugin PR A: terminal-state assertion planning and regression tests
Plugin PR B: parser-safe/runtime-safe replay quality hardening
Plugin PR C: privacy-safe replay diagnostics
Business PR D: pilot wrappers/pages keep emitting terminal-state-friendly generic hints
```

If the owner wants fewer PRs, combine A+B only after tests are written first. Keep C separate if diagnostic UI/storage expands.

## What downstream business repo owns

Downstream app owns:

- stable generic `data-testid` / `data-e2e-*` contracts;
- `data-row-key` and `data-column-key` where table/entity identity matters;
- terminal-state friendly DOM hooks for table row existence/disappearance, modal closed/open, validation visible, selected value shown;
- no secrets in attributes.

## What `playwright-crx` owns

Plugin owns:

- generic hint consumption;
- semantic context compaction;
- replay locator generation and parser-safe code preview;
- terminal-state assertion suggestion/serialization;
- privacy-safe diagnostics;
- real CRX E2E coverage.

## Evidence needed for remaining uncertainty

The raw downstream repo is intentionally omitted. To finalize business-side implementation details, a local business repo agent should report:

- actual wrapper paths and current props;
- existing `e2eId` / `e2eIds` patterns;
- available test/build commands;
- whether pilot pages expose deterministic test data or require seeded fixtures;
- whether row keys can be stable non-sensitive IDs.
