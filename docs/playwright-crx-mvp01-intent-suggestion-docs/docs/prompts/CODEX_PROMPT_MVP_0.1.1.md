# 给 Codex App 的第一条 Prompt：MVP 0.1.1 页面上下文采集 + intent suggestion

直接复制下面整段给 Codex App。

---

```text
你现在位于一个 fork 后的 playwright-crx 仓库根目录。当前仓库已经完成“业务流程录制 MVP 0.1”，现在要实现 MVP 0.1.1：P0 修复 + 插件内非 AI 页面上下文采集 + 自动 intent suggestion。

请先完整阅读：

1. AGENTS.md
2. ROADMAP.md
3. docs/tasks/MVP-0.1.md
4. docs/schemas/business-flow.schema.md
5. 如果存在：docs/mvp-0.1.1-page-context-intent/README.md
6. 如果存在：docs/mvp-0.1.1-page-context-intent/docs/review/MVP-0.1-REVIEW.md
7. 如果存在：docs/mvp-0.1.1-page-context-intent/docs/design/BUSINESS_FLOW_CONTEXT_EXTENSION.md
8. 如果存在：docs/mvp-0.1.1-page-context-intent/docs/design/PAGE_CONTEXT_INTENT_DESIGN.md
9. 如果存在：docs/mvp-0.1.1-page-context-intent/docs/design/ENGINEERING_PLAN.md
10. 如果存在：docs/mvp-0.1.1-page-context-intent/docs/tasks/MVP-0.1.1-PAGE-CONTEXT-INTENT.md
11. 如果存在：docs/mvp-0.1.1-page-context-intent/docs/checklists/MVP-0.1.1-ACCEPTANCE_CHECKLIST.md

如果这些 mvp-0.1.1 文档不在 docs/mvp-0.1.1-page-context-intent/ 下，请在仓库中搜索同名文件并阅读。

硬边界：

- 不要实现 Native Messaging；
- 不要实现本地 Node Runner；
- 不要实现 AI 生成 Playwright spec；
- 不要实现 AI 修复；
- 不要实现 CI；
- 不要实现自动 Git/PR；
- 不要重写 Playwright recorder；
- 不要重写 Playwright player；
- 不要重写 locator 生成逻辑；
- 不要采集完整 DOM；
- 不要采集完整 trace；
- 不要采集完整 response body；
- 不要采集 cookie/token/password/authorization/secret；
- 不要把 crxRecorder.tsx 继续堆成巨型文件；
- 不要引入复杂状态管理；
- 不要为了兜底写满屏 try/catch；
- 不要修改 node_modules。

本轮任务目标：

1. 修复当前 P0 问题：
   - 修复 extractTestId() 对 internal:testid=[data-testid="xxx"s] 的解析；
   - Step comment 始终可编辑；
   - FlowStep 增加 intentSource / intentSuggestion / context；
   - 用户手动修改 intent 后，不再被自动建议覆盖；
   - 保存记录时保留删除/插入/继续录制所需的 recorder 映射状态，仅导出时清理内部状态。

2. 增加插件内页面上下文采集：
   - 新增 pageContextSidecar 或等价模块；
   - 监听 click/input/change/keydown；
   - click 采集 before + after；
   - 采集小型页面语义摘要，包括 page title、url、breadcrumb、active tab、section/card/panel、table、row、column、form label、dialog title、target text/testId/role/name；
   - 限制搜索深度和文本长度；
   - 不采集完整 DOM 和敏感信息。

3. 增加 action/context 匹配：
   - 用 action.startTime/endTime 与 context event 的 performance.now() 时间匹配；
   - 匹配窗口大致为 start - 300ms 到 end + 800ms；
   - click/fill/select/check/press/navigate 分别匹配相容事件；
   - 无法匹配时跳过，不生成误导性高置信度 intent。

4. 增加非 AI intent suggestion：
   - 根据 target text、dialog、form label、table、row、section、tab 等生成中文业务意图；
   - 默认把高置信度 suggestion 写入 step.intent；
   - intentSource = auto；
   - 用户手动修改后 intentSource = user，并且永不自动覆盖；
   - suggestion 包含 text、confidence、rule、provenance。

5. 更新导出：
   - business-flow.json 包含 step.context / step.intentSuggestion / step.intentSource；
   - compact-flow.yaml 包含短 context、intentSource、suggestionConfidence；
   - compact-flow.yaml 不包含 rawAction、完整 DOM、完整 trace、完整 response body；
   - redactor 覆盖 context 和 provenance。

建议新增文件：

- examples/recorder-crx/src/flow/pageContextTypes.ts
- examples/recorder-crx/src/flow/pageContextMatcher.ts
- examples/recorder-crx/src/flow/intentRules.ts
- examples/recorder-crx/src/flow/flowContextMerger.ts
- examples/recorder-crx/src/pageContextSidecar.ts

允许修改：

- examples/recorder-crx/src/flow/types.ts
- examples/recorder-crx/src/flow/flowBuilder.ts
- examples/recorder-crx/src/flow/compactExporter.ts
- examples/recorder-crx/src/flow/redactor.ts
- examples/recorder-crx/src/components/StepEditor.tsx
- examples/recorder-crx/src/components/StepList.tsx
- examples/recorder-crx/src/background.ts
- examples/recorder-crx/src/crxRecorder.tsx

请按以下顺序执行。

第一步：仓库检查

请先查看：

- examples/recorder-crx/src/flow/types.ts
- examples/recorder-crx/src/flow/flowBuilder.ts
- examples/recorder-crx/src/flow/compactExporter.ts
- examples/recorder-crx/src/flow/redactor.ts
- examples/recorder-crx/src/components/StepEditor.tsx
- examples/recorder-crx/src/background.ts
- examples/recorder-crx/src/crxRecorder.tsx

确认当前代码结构后，先输出简短 implementation plan，再修改代码。

第二步：修 P0

修复：

- extractTestId bug；
- comment textarea 始终显示；
- intentSource / intentSuggestion / context 字段；
- 用户编辑 intent 时设置 intentSource = user；
- 保存记录时保留 recorder 映射状态。

第三步：实现上下文类型和采集

新增 pageContextTypes.ts 和 pageContextSidecar.ts。

采集限制：

- 向上最多 10 层；
- nearbyText 最多 8 条；
- 单条文本最多约 60 字；
- 不采集 password/token/cookie/authorization/secret；
- 不采集完整 DOM。

第四步：实现 background ring buffer

每个 tab 保存最近 200 条事件或最近 5 分钟事件。

side panel 能请求当前 tab 最近事件。

第五步：实现 matcher 和 rules

新增 pageContextMatcher.ts、intentRules.ts。

intent 规则至少支持：

- 点击 新建/新增/添加 + 弹窗：打开 xxx 新建弹窗；
- 点击表格行编辑：编辑 xxx；
- 点击表格行删除：删除 xxx / 打开删除 xxx 确认框；
- 点击弹窗确定/保存/提交：确认保存 xxx；
- fill 字段：填写 xxx 的 yyy；
- dropdown option：选择 xxx 为 yyy；
- check/uncheck：开启/关闭 xxx；
- tab 切换：切换到 xxx 页签；
- navigate：打开 xxx 页面。

第六步：合并 context 到 flow

新增 flowContextMerger.ts。

合并规则：

- 匹配到 event 后写入 step.context；
- 调用 suggestIntent；
- suggestion confidence >= 0.60 且 intent 为空或 intentSource=auto 时，写入 step.intent；
- intentSource=user 时不覆盖。

第七步：更新 UI

StepEditor 中：

- intent 输入旁显示“自动生成”或“人工修改”；
- 可选显示 confidence；
- 用户改 intent 后设置 intentSource=user；
- comment 始终可编辑。

第八步：更新导出

compact-flow.yaml 输出每步短 context：

- page
- tab
- section
- table
- row
- dialog
- field
- target
- resultDialog
- selectedOption

不要输出完整 DOM。

第九步：验证

请运行：

- npm run build

如果有 examples/recorder-crx 单独 build，也运行。

手工验证建议：

1. 加载插件；
2. 打开一个包含 ProTable + ModalForm 的页面；
3. 点击“新建”；
4. 检查 step.intent 自动填为“打开 xxx 新建弹窗”；
5. 在弹窗中选择一个字段；
6. 检查 step.intent 自动填为“选择 xxx 为 yyy”；
7. 手动修改某一步 intent；
8. 继续录制，确认该 intent 不被覆盖；
9. 导出 JSON/YAML，确认 context 存在且没有完整 DOM/敏感信息。

最终回复请包含：

1. Summary；
2. Changed files；
3. How to test；
4. Acceptance checklist 对照；
5. Known limitations；
6. Next handoff；
7. 风险点，尤其是是否改动了 Playwright CRX 底层。

请不要自动 git commit，除非我明确要求。
```
