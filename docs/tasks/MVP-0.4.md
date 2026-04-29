# MVP-0.4.md

# MVP 0.4：AI 生成、失败修复和 CI 准备

## 目标

在 Node Runner 侧加入 AI 能力，让它根据 `compact-flow.yaml`、原始 `playwrightCode`、项目测试约定和少量上下文生成更稳定的 Playwright spec，并在失败时做有限自动修复。

MVP 0.4 中 AI 不直接在插件里运行，也不自动提交 Git。

---

## 1. 范围

### In scope

- Provider-agnostic AI client。
- AI context builder。
- Prompt templates。
- AI spec generation command。
- AI repair command。
- Playwright failure summarizer。
- Run-and-repair loop，最多 2 次。
- AI operation log。
- Review report。
- CI-ready output layout。

### Out of scope

- AI 在浏览器插件中直接调用。
- 自动 commit。
- 自动 push。
- 自动 PR。
- 自动访问生产环境。
- 后台平台。
- 无限修复循环。

---

## 2. 建议目录

```text
tools/flow-runner/src/ai/
├─ aiClient.mjs
├─ contextBuilder.mjs
├─ generate.mjs
├─ repair.mjs
├─ prompts.mjs
├─ failureSummary.mjs
└─ reviewReport.mjs

docs/prompts/
├─ AI_SPEC_GENERATION.md
└─ AI_REPAIR.md
```

CLI 新增：

```bash
node tools/flow-runner/cli.mjs ai-generate <flowFile> [--project-root <dir>]
node tools/flow-runner/cli.mjs ai-repair <flowFile> --spec <specFile> --result <jsonResult>
node tools/flow-runner/cli.mjs ai-run <flowFile> [--project-root <dir>] [--max-repairs 2]
```

Native Messaging 可新增：

```text
aiGenerateSpec
aiRunAndRepair
```

但 UI 中必须明确标注“需要人工 review”。

---

## 3. AI client

新增：`tools/flow-runner/src/ai/aiClient.mjs`

不要把某个供应商写死在业务逻辑里。使用接口：

```js
export async function callAiModel({
  system,
  user,
  temperature = 0.1,
  maxOutputTokens = 6000
}) {
  // provider adapter
}
```

Provider 配置来自环境变量或 config：

```text
BUSINESS_FLOW_AI_PROVIDER
BUSINESS_FLOW_AI_MODEL
BUSINESS_FLOW_AI_API_KEY
```

如果没有配置，命令应报错：

```text
AI provider is not configured.
Use deterministic generate command or configure AI provider.
```

---

## 4. Context builder

新增：`tools/flow-runner/src/ai/contextBuilder.mjs`

输入：

```text
business-flow.json
projectRoot
optional existing generated spec
optional failure result
```

输出：

```js
{
  compactFlow,
  originalPlaywrightCode,
  projectConventions,
  sampleSpecs,
  fixtureHints,
  failureSummary,
  constraints
}
```

### compactFlow

必须来自 compact exporter，而不是直接 dump JSON。

### originalPlaywrightCode

如果 `flow.artifacts.playwrightCode` 存在，可以提供给 AI，但要截断和脱敏。

### projectConventions

从项目中读取少量文件：

```text
playwright.config.ts
tests/e2e/**/fixtures*
tests/e2e/**/*.spec.ts，最多 3 个短样例
package.json scripts
```

不要读取整个仓库。限制：

```text
最多 20 个文件
每个文件最多 300 行
总上下文大小限制
敏感字段扫描
```

### failureSummary

来自 JSON reporter、stderr 和 trace path。不要把 trace.zip 直接传给 AI。

---

## 5. Prompt：生成 spec

模板见：`docs/prompts/AI_SPEC_GENERATION.md`

输出要求：

- 只输出一个完整 `.spec.ts` 文件内容。
- 不输出解释，除非要求 review report。
- 使用 `@playwright/test`。
- 使用 test.step 包裹业务步骤。
- 优先使用 test id / role / label。
- 保留业务 intent。
- 对关键保存接口做 waitForResponse。
- 对半结构化 assertions 生成 expect。
- 对不确定的 custom assertion 写 TODO 注释。
- 不包含真实 secret。
- 不访问生产 URL。
- 不引入未存在的依赖。

---

## 6. Prompt：修复 spec

模板见：`docs/prompts/AI_REPAIR.md`

输入：

```text
compactFlow
currentSpec
failureSummary
stderr excerpt
json reporter excerpt
trace paths only
```

输出：

```json
{
  "reason": "失败原因判断",
  "changes": ["修改 locator", "调整 waitForResponse 时机"],
  "specText": "完整 spec.ts 内容"
}
```

如果模型不能确定，应该输出：

```json
{
  "reason": "无法确定",
  "needsHumanReview": true,
  "suggestions": []
}
```

---

## 7. AI generate command

实现：

```bash
node tools/flow-runner/cli.mjs ai-generate <flowFile> --project-root .
```

行为：

1. validate flow。
2. build AI context。
3. call AI。
4. write spec to:

```text
.generated/e2e-ai/{safeFlowId}.spec.ts
```

5. write operation log to:

```text
.generated/ai-runs/{safeFlowId}/{timestamp}/generate.json
```

6. run generated spec unless `--no-run`。
7. write review report。

---

## 8. AI repair command

实现：

```bash
node tools/flow-runner/cli.mjs ai-repair <flowFile> \
  --project-root . \
  --spec .generated/e2e-ai/foo.spec.ts \
  --result .generated/results/foo.json
```

行为：

1. parse failure。
2. build repair context。
3. call AI。
4. write repaired spec to:

```text
.generated/e2e-ai/{safeFlowId}.repaired-1.spec.ts
```

5. write repair log。
6. optionally run repaired spec。

---

## 9. AI run-and-repair loop

实现：

```bash
node tools/flow-runner/cli.mjs ai-run <flowFile> --project-root . --max-repairs 2
```

流程：

```text
ai-generate
  ↓
run
  ↓ passed -> done
  ↓ failed -> ai-repair #1
  ↓ run
  ↓ passed -> done
  ↓ failed -> ai-repair #2
  ↓ run
  ↓ passed -> done
  ↓ failed -> produce human review report
```

限制：

```text
max repairs 默认 2
每次都保存 spec
每次都保存日志
不要无限循环
不要删除历史 spec
```

---

## 10. Failure summarizer

新增：`tools/flow-runner/src/ai/failureSummary.mjs`

输入：

```text
Playwright JSON report
stderr
stdout
trace paths
spec path
```

输出：

```js
{
  failedStepTitle,
  errorMessage,
  locator,
  expected,
  actual,
  stackExcerpt,
  tracePaths,
  likelyCause,
  relatedFlowStepId
}
```

relatedFlowStepId 可以通过 test.step title 中的 `s001` 匹配。

---

## 11. Review report

新增：`tools/flow-runner/src/ai/reviewReport.mjs`

输出 Markdown：

```text
.generated/ai-runs/{flowId}/{timestamp}/review.md
```

内容：

```text
Flow
Generated spec path
Run status
Repair attempts
What changed
Remaining failures
Human review checklist
Security notes
```

---

## 12. CI 准备

MVP 0.4 不需要完整 CI 集成，但输出结构要便于后续接入：

```text
e2e-flows/
tests/e2e/generated/
.generated/results/
.generated/ai-runs/
playwright-report/
test-results/
```

建议后续 Git 策略：

```text
提交：
  e2e-flows/*.business-flow.json
  tests/e2e/generated/*.spec.ts

不提交：
  .generated/
  test-results/
  playwright-report/
```

可新增 `.gitignore` 建议，但不要覆盖上游已有规则。

---

## 13. Native Messaging 集成， optional

如果 MVP 0.3 已完成，可以增加按钮：

```text
AI Generate Spec
AI Run & Repair
```

UI 必须提示：

```text
AI-generated tests require human review before committing.
```

结果显示：

```text
spec path
status
repair attempts
review report path
```

---

## 14. 安全要求

- AI 不读取生产真实数据。
- AI 不接收 cookie/token/password。
- AI 不接收完整 trace.zip。
- AI 不自动提交 Git。
- AI 修改必须落盘为 reviewable spec。
- AI 操作日志必须保留。
- 失败后不得伪造通过结果。

---

## 15. QA checklist

### 配置缺失

```bash
node tools/flow-runner/cli.mjs ai-generate tools/flow-runner/fixtures/sample.business-flow.json --project-root .
```

无 provider 时应给出清晰错误，不应崩。

### 生成

配置 provider 后：

```bash
node tools/flow-runner/cli.mjs ai-generate tools/flow-runner/fixtures/sample.business-flow.json --project-root .
```

检查：

```text
.generated/e2e-ai/*.spec.ts
.generated/ai-runs/*/generate.json
.generated/ai-runs/*/review.md
```

### run-and-repair

```bash
node tools/flow-runner/cli.mjs ai-run tools/flow-runner/fixtures/sample.business-flow.json --project-root . --max-repairs 2
```

检查：

```text
最多 2 次 repair
每次有 spec
每次有 log
最终有 review report
```

---

## 16. 版本完成定义

MVP 0.4 完成时：

- AI 可以基于 compact-flow 生成 spec。
- 生成 spec 会被本地执行验证。
- 失败时可以做最多 2 次修复。
- 所有 AI 行为有日志。
- 最终产出 review report。
- 插件端不直接调用 AI。
- 不自动提交 Git。
