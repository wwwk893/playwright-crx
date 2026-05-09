# Migration Roadmap

## Baseline 假设

本文档假设当前仓库已经具备：

- `BusinessFlow.steps` stable id / order projection。
- `artifacts.recorder.actionLog`。
- `pageContextSidecar` 采集 page context / AntD / ProComponents context。
- `uiSemantics` / business hints。
- `codePreview.ts` 生成 exported Playwright code 和 parser-safe playback code。
- `CrxPlayer` 有少量 runtime fallback。
- L1 flow tests、L2 businessFlowRecorder、L3 humanLikeRecorder。

如实际仓库路径不同，Hermes 应先搜索等价 symbol，再按最小改动适配。

## PR 序列

| PR | 名称 | 核心目标 | 是否改行为 |
|---|---|---|---|
| PR-01 | Architecture Guardrails + AGENTS | 更新仓库规则和架构不变量 | 不改产品行为 |
| PR-02 | Event Journal v3 | 将 recorder/page-context/user-edit 事实统一入 journal | 尽量不改行为 |
| PR-03 | Session Finalizer | stop/review/export 前 drain + finalize | 改 stop/export 边界 |
| PR-04 | Input Transactions | typing/fill/press/change 归并成 committed fill | 改输入步骤生成 |
| PR-05 | Select/Popup Transactions | Select/TreeSelect/Cascader 归并成 select transaction | 改 popup 步骤生成 |
| PR-06 | Business Step Projection | flowBuilder 瘦身，transaction → FlowStep | 有限行为收敛 |
| PR-07 | UiActionRecipe | 统一业务回放语义 | 新增内部模型 |
| PR-08 | Replay Compiler Split | exported/runtime codegen 从 recipe 渲染 | 改 codegen 内部结构 |
| PR-09 | Runtime Player Bridge Contract | CrxPlayer fallback 窄化和显式化 | 小范围改 server runtime |
| PR-10 | Repeat + Terminal State Hardening | repeat/replay 终态断言和 false-green 防线 | 加强测试/断言 |
| PR-11 | Diagnostics + Adaptive Snapshot | fail-closed diagnostics，不自愈 | 新增诊断，不改 replay 主路径 |
| PR-12 | Cleanup + Deprecation | 清理旧字段/旧 patch/冻结迁移 | 清理行为 |

## 依赖关系

```text
PR-01 → PR-02 → PR-03 → PR-04 → PR-05 → PR-06 → PR-07 → PR-08 → PR-09 → PR-10 → PR-11 → PR-12
```

PR-10 可以在 PR-07/08 后与 PR-09 并行推进，但推荐串行，避免 replay semantics 分叉。

## 每个 PR 的最低验证

所有 PR 至少运行：

```bash
git diff --check
npm run test:flow --prefix examples/recorder-crx
npm run build:examples:recorder
```

涉及 `src/server/*`、parser、runtime player 的 PR 必须额外运行：

```bash
npm run build:crx
npm run build:tests
```

涉及业务 E2E 的 PR 必须至少跑 targeted CRX：

```bash
cd tests
xvfb-run -a npx playwright test crx/businessFlowRecorder.spec.ts crx/humanLikeRecorder.spec.ts \
  --config=playwright.config.ts --project=Chrome --workers=1 --reporter=line
```

具体 PR 还有各自的 targeted grep。
