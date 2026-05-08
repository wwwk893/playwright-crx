# PR #10 Review Checklist: MVP 0.1.5 Semantic Adapter Hardening

## 1. 范围控制

- [ ] PR 只做 MVP 0.1.5 hardening。
- [ ] 没有实现 Runner / Native Messaging / Flow → Spec。
- [ ] 没有引入 Cypress 或第三方 AntD helper runtime dependency。
- [ ] 没有重写 Playwright recorder/player。
- [ ] 没有把业务仓 wrapper 改造塞进本 PR。
- [ ] 没有新增 recipe codegen preview。

## 2. Feature flag / 回退

- [ ] `semanticAdapterEnabled` 存在且默认 true。
- [ ] `semanticAdapterDiagnosticsEnabled` 存在且默认 false。
- [ ] 关闭 adapter 后 `PageContextSnapshot.ui` 不写入。
- [ ] 关闭 adapter 后不新增 `FlowStep.uiRecipe`。
- [ ] 关闭 adapter 后 recorder / pageContext 基础行为不受影响。
- [ ] 有测试覆盖关闭状态。

## 3. Security / Export / Privacy

- [ ] `prepareBusinessFlowForExport()` 清理 `context.before.ui`。
- [ ] `prepareBusinessFlowForExport()` 清理 `step.target.raw.ui`。
- [ ] `prepareBusinessFlowForExport()` 清理 `step.uiRecipe`。
- [ ] 导出 JSON 不包含 `locatorHints`。
- [ ] 导出 JSON 不包含 `reasons`。
- [ ] 导出 JSON 不包含 `table.rowText`。
- [ ] 导出 JSON 不包含 `overlay.text`。
- [ ] 导出 JSON 不包含 `option.value`。
- [ ] 导出 JSON 不包含完整 DOM / HTML / rawAction / actionLog。
- [ ] 导出 JSON 不包含 cookie/token/password/authorization/API key。

## 4. Compact YAML / AI input

- [ ] compact YAML 只输出 compact ui 字段。
- [ ] compact YAML 不输出 `locatorHints` / `reasons` / `rowText` / `overlay.text` / `option.value`。
- [ ] AI input 只输出 compact ui。
- [ ] AI input URL 去 query/hash 或限制到 pathname。
- [ ] AI input 不包含完整 selector / DOM / rawAction / sourceCode。
- [ ] AI input 不因为 semantic context 明显膨胀。

## 5. Diagnostics

- [ ] diagnostics 默认关闭。
- [ ] diagnostics 存在 ring buffer 或等效短期存储。
- [ ] diagnostics 不进入 business-flow.json。
- [ ] diagnostics 不进入 compact-flow.yaml。
- [ ] diagnostics 不进入 AI input。
- [ ] diagnostics 不保存完整 DOM / HTML / nearbyText。
- [ ] diagnostics locator hint value 经过 truncate/redact。
- [ ] weak/unknown/fallback-css 能解释原因。

## 6. 旧 flow 兼容

- [ ] 没有 ui 的旧 flow 可导入。
- [ ] 没有 ui 的旧 flow 可导出。
- [ ] 没有 ui 的旧 flow 可生成 compact YAML。
- [ ] 没有 ui 的旧 flow 可构建 AI input。
- [ ] 缺少 ui 时不输出空 `ui:` YAML block。

## 7. 用户编辑态

- [ ] `intentSource === 'user'` 时不覆盖 `step.intent`。
- [ ] semantic adapter 只更新 context/uiRecipe/suggestion。
- [ ] 有测试覆盖用户 intent 不被覆盖，或明确现有测试已覆盖。

## 8. 测试真实性

- [ ] CRX E2E 使用真实 fixture，不是 mock adapter。
- [ ] 没有删除原 semanticAdapter 断言。
- [ ] 没有用 blind sleep 掩盖异步问题。
- [ ] Select portal / Popconfirm / Tooltip / ProTable row action 至少覆盖 focused E2E。
- [ ] unknown DOM 测试仍在。
- [ ] export / AI input privacy regressions 有 flow/unit 测试。

## 9. 命令

PR 作者应贴出并通过：

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build:examples:recorder
npm run build:tests
xvfb-run -a npx playwright test -c tests/playwright.config.ts tests/crx/semanticAdapter.spec.ts --project=Chrome --workers=1 --reporter=line --global-timeout=300000
npm run build:crx
git diff --check
```

## 10. 后续不塞入本 PR

- [ ] 0.1.6 wrapper / e2eId 改造留到下一 PR。
- [ ] 0.1.7 recipe codegen preview 留到下一 PR。
- [ ] 0.1.8 fixture corpus 留到下一 PR。
- [ ] 0.1.9 AI quality loop 留到下一 PR。
- [ ] 0.2 Flow → Spec 留到后续。
