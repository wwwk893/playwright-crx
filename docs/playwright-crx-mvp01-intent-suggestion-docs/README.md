# Playwright CRX 业务流程录制 MVP 0.1.1 文档包

本包用于指导 Codex App 在当前 `playwright-crx` fork 的 MVP 0.1 基础上继续完成一轮小步演进：

> **MVP 0.1.1：P0 修复 + 插件内页面上下文采集 + 非 AI intent suggestion 自动填入。**

本轮目标是让测试人员录制业务流程时，不再大量手写 `step.intent`。插件在用户点击、输入、选择、切换等操作发生时，采集小型页面语义上下文，并用本地规则自动生成中文业务意图，默认写入 `step.intent`。

## 硬边界

本轮仍属于 MVP 0.1 系列，只允许浏览器插件内能力。

禁止实现：

- Native Messaging
- 本地 Node Runner
- AI 生成 Playwright spec
- AI 修复
- CI
- 自动 Git / PR
- 重写 Playwright recorder
- 重写 Playwright player
- 重写 locator 生成逻辑
- 采集完整 DOM
- 采集完整 trace
- 采集完整 response body
- 采集 cookie / token / password / authorization / secret

## 文档目录

```text
playwright-crx-mvp01-intent-suggestion-docs/
├─ README.md
└─ docs/
   ├─ review/
   │  └─ MVP-0.1-REVIEW.md
   ├─ design/
   │  ├─ BUSINESS_FLOW_CONTEXT_EXTENSION.md
   │  ├─ PAGE_CONTEXT_INTENT_DESIGN.md
   │  └─ ENGINEERING_PLAN.md
   ├─ tasks/
   │  └─ MVP-0.1.1-PAGE-CONTEXT-INTENT.md
   ├─ prompts/
   │  └─ CODEX_PROMPT_MVP_0.1.1.md
   ├─ checklists/
   │  └─ MVP-0.1.1-ACCEPTANCE_CHECKLIST.md
   └─ examples/
      └─ compact-flow-with-context.yaml
```

## 推荐给 Codex App 的阅读顺序

1. 仓库根目录 `AGENTS.md`
2. 仓库根目录 `ROADMAP.md`
3. 仓库内 `docs/tasks/MVP-0.1.md`
4. 仓库内 `docs/schemas/business-flow.schema.md`
5. 本包 `docs/review/MVP-0.1-REVIEW.md`
6. 本包 `docs/design/BUSINESS_FLOW_CONTEXT_EXTENSION.md`
7. 本包 `docs/design/PAGE_CONTEXT_INTENT_DESIGN.md`
8. 本包 `docs/design/ENGINEERING_PLAN.md`
9. 本包 `docs/tasks/MVP-0.1.1-PAGE-CONTEXT-INTENT.md`
10. 本包 `docs/checklists/MVP-0.1.1-ACCEPTANCE_CHECKLIST.md`

## 给 Codex 的启动入口

直接复制这个文件里的 prompt：

```text
docs/prompts/CODEX_PROMPT_MVP_0.1.1.md
```

## 期望效果

录制结果从：

```text
点击 ha-wan-add-button
点击 WAN2
点击 确定
```

提升为：

```text
打开共享 WAN 新建弹窗
选择 WAN 为 WAN2
确认保存新建共享 WAN
```

并在 `business-flow.json` 和 `compact-flow.yaml` 中保留简短 context：

```yaml
context:
  page: 全局配置
  tab: WAN
  section: 共享 WAN
  table: 共享 WAN
  dialog: 新建共享 WAN
  target: 新建
```

## 代码风格要求

- 简单规则优先，少写兜底。
- 没有明确复用点，不要过度抽象。
- 不要把 `crxRecorder.tsx` 继续堆成更大的总控文件。
- 失败时宁可不生成 suggestion，也不要生成误导性强的高置信度 intent。
- 自动生成内容必须可见、可改、可被人工覆盖。
- 用户修改过的 `intent` 永远不要被自动覆盖。
