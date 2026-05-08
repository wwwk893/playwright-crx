# MVP 0.1.6 Business Components × Semantic Adapter Alignment

适用仓库：

- 插件仓：`wwwk893/playwright-crx`
- 业务仓：包含 `networking/` 模块的公司前端仓库

本包是 PR #10 / MVP 0.1.5 Semantic Adapter Hardening 之后的下一阶段规划文档。目标是让公司业务组件与 Playwright CRX 插件的 AntD / ProComponents Semantic Adapter 形成稳定契约，而不是继续靠 DOM 猜测和临时 corner-case patch。

## Reviewed inputs

本计划基于以下上下文：

- `CONTEXT.md`
- PR #10 metadata and diff summaries
- `files/current/examples/recorder-crx/src/uiSemantics/*`
- `files/current/examples/recorder-crx/src/pageContextSidecar.ts`
- `files/current/examples/recorder-crx/src/flow/exportSanitizer.ts`
- `files/current/tests/crx/semanticAdapter.spec.ts`
- PR #10 hardening docs under `docs/pr10-mvp015-semantic-hardening-docs/`
- user-provided proprietary business component archive: `inputs/networking.zip`

`networking.zip` was used only to infer component patterns and pilot selection. Secret scan metadata indicated possible sensitive findings in selected files; this document does not quote any secret values.

## Summary

MVP 0.1.4/0.1.5 makes the plugin able to infer semantic context from AntD / ProComponents DOM. MVP 0.1.6 should make the business frontend expose stable, generic, low-cost semantic hints so the plugin can stop guessing so much.

The recommended direction is:

```text
business wrapper components emit stable data-testid + optional semantic data attributes
  ↓
pageContextSidecar collects generic hints
  ↓
UiSemanticContext prefers business hints over AntD DOM fallback
  ↓
FlowStep.uiRecipe becomes more stable and less domain-specific
```

## Recommended execution order

1. Merge PR #10 first if CI remains green.
2. Open a business-repo PR that adds a small shared E2E helper module and adapts the highest-value wrappers / pilot pages.
3. Open a plugin PR that consumes generic business hints without hardcoding `networking` names.
4. Run a paired pilot on selected flows from `networking/Site/Detail/Device/components/IpPools` and `networking/Site/Detail/Security/components`.
5. Only after the pilot proves the contract, expand wrapper coverage across the business repo.

## Recommended PR shape

MVP 0.1.6 should be split into at least two repos / PRs:

```text
Business repo PR A:
  e2e id contract utility + wrapper passthrough + pilot pages

playwright-crx PR B:
  generic business-hint collector + semantic adapter merge + tests
```

They can be developed in parallel, but plugin PR B must degrade gracefully when the business hints are absent.

## What to defer

Do not include these in MVP 0.1.6:

- recipe → Playwright helper/code preview generation, MVP 0.1.7
- Storybook / Playwright CT fixture corpus, MVP 0.1.8
- AI intent scoring dashboard, MVP 0.1.9
- Flow → Playwright spec generation / Runner / Native Messaging / CI automation, MVP 0.2
- broad business-domain hardcoding in `playwright-crx`
- rewriting Playwright recorder/player internals

## Documents

```text
docs/tasks/MVP-0.1.6-BUSINESS-COMPONENTS-SEMANTIC-ALIGNMENT.md
docs/design/E2E_ID_CONVENTION.md
docs/design/BUSINESS_WRAPPER_ADAPTATION.md
docs/design/PLAYWRIGHT_CRX_ADAPTER_ALIGNMENT.md
docs/design/PILOT_PAGE_SELECTION.md
docs/testing/MVP_0.1.6_ACCEPTANCE_TEST_PLAN.md
docs/checklists/MVP_0.1.6_REVIEW_CHECKLIST.md
docs/planning/PR_SPLIT_PLAN.md
docs/prompts/CODEX_PROMPT_MVP_0.1.6.md
```
