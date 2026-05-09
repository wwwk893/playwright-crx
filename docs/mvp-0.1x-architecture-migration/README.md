# Playwright CRX Business Flow Architecture Migration Docs

这份文档包用于指导 Hermes / Codex / coding agent 分 PR 完成 `playwright-crx` 的架构迁移。

目标不是继续“修下一个 flake”，而是把当前 recorder 从：

```text
action merge + codegen patch + runtime fallback
```

迁移到：

```text
Raw Events
  → Event Journal
  → Interaction Transactions
  → Business Step Projection
  → UiActionRecipe
  → Replay Compiler
  → Narrow Runtime Bridge
```

核心原则：

```text
Raw event 是事实。
Transaction 是用户交互。
FlowStep 是业务步骤。
UiActionRecipe 是回放语义。
Renderer 只是输出代码。
CrxPlayer 只做窄范围 runtime bridge。
```

## 使用方式

建议把本目录复制到仓库根目录：

```text
docs/mvp-0.1x-architecture-migration/
```

然后让 Hermes 每次只执行一个 PR 文档。例如：

```text
请阅读 AGENTS.md、docs/mvp-0.1x-architecture-migration/README.md、MIGRATION_ROADMAP.md，
然后只执行 docs/mvp-0.1x-architecture-migration/docs/prs/PR-03-session-finalizer.md。
不要提前实现后续 PR。
```

## 文档结构

```text
README.md
EXECUTIVE_SUMMARY.md
MIGRATION_ROADMAP.md
TARGET_ARCHITECTURE.md
AGENTS_UPDATE_PROPOSAL.md

docs/design/
  EVENT_JOURNAL.md
  TRANSACTIONS.md
  UI_ACTION_RECIPE.md
  REPLAY_COMPILER.md

docs/prs/
  PR-01-architecture-guardrails-and-agents.md
  PR-02-event-journal-and-recorder-state-v3.md
  PR-03-session-finalizer.md
  PR-04-input-transactions.md
  PR-05-select-popup-transactions.md
  PR-06-business-step-projection-refactor.md
  PR-07-ui-action-recipe-model.md
  PR-08-replay-compiler-split.md
  PR-09-runtime-player-bridge-contract.md
  PR-10-repeat-terminal-state-hardening.md
  PR-11-diagnostics-adaptive-target-snapshot.md
  PR-12-cleanup-and-deprecation.md

docs/prompts/
  HERMES_MASTER_PROMPT.md
  PR-01.prompt.md ... PR-12.prompt.md

docs/checklists/
  ACCEPTANCE_GATES.md
  REVIEW_CHECKLIST.md
  RISK_REGISTER.md

docs/testing/
  TESTING_STRATEGY.md
  HUMAN_LIKE_E2E_POLICY.md
  TERMINAL_STATE_ASSERTIONS.md

docs/migration/
  LEGACY_FIELD_MIGRATION.md
  MODULE_BOUNDARIES.md
```

## 总体节奏

这是一条渐进迁移链，不是一次性重写：

```text
PR-01：先更新 AGENTS 和架构护栏。
PR-02：引入 Event Journal，但保持现有行为。
PR-03：引入 Session Finalizer，修 stop/export/review 最后一跳丢失。
PR-04：Input Transaction，修 typing/fill/press/change 混乱。
PR-05：Select/Popup Transaction，修 AntD Select/TreeSelect/Cascader 事务。
PR-06：Business Step Projection，收敛 flowBuilder 职责。
PR-07：UiActionRecipe，统一业务回放语义。
PR-08：Replay Compiler，拆 exported/runtime/parser-safe renderer。
PR-09：Runtime Player Bridge，只保留窄范围 fallback。
PR-10：Repeat + terminal-state assertions hardening。
PR-11：Diagnostics/adaptive target snapshot，fail-closed。
PR-12：清理旧字段、移除过时 patch、冻结迁移。
```

## 硬边界

不要在这条迁移里实现：

```text
Native Messaging
Node Runner
AI spec generation
AI repair
CI platform
自动 PR / Git 提交
完整 selector self-healing
全局文本 fallback
mock 替代真实 AntD / ProComponents fixture
```


---

## V2 addendum: final file tree contract

This package now includes:

- `FINAL_FILE_TREE.md` — the target directory structure after PR-12.
- `PR_TO_FILE_MAP.md` — exactly which files each PR may create/modify.
- `ARCHITECTURE_CONTRACT.md` — hard reviewer checks to prevent drift back into `flowBuilder.ts` / `codePreview.ts` patch accumulation.
- `docs/prompts/HERMES_MASTER_PROMPT_V2.md` — stricter master prompt for Hermes.

Hermes must read these files before starting PR-01.
