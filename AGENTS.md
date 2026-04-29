# AGENTS.md

# Repository Agent Instructions

本文件面向 Codex App / coding agent。请严格按照本文件、`ROADMAP.md` 和 `docs/tasks/*.md` 执行。不要跳版本，不要把后续版本能力提前塞进当前版本，除非任务文档明确要求。

---

## 1. 项目使命

本仓库是基于 `ruifigueira/playwright-crx` 的 fork，用于实现内部“业务流程录制与自动化测试生成 MVP”。

核心目标：

```text
测试人员手工验收业务流程
  ↓
插件录制 action
  ↓
测试人员补充业务意图和断言
  ↓
导出 business-flow.json / compact-flow.yaml
  ↓
本地 Node Runner 生成并执行 Playwright spec
  ↓
AI 辅助生成/修复
```

---

## 2. 当前版本边界

严格按版本推进：

- MVP 0.1：浏览器插件内业务流程录制、注释、断言、导出、草稿、脱敏。
- MVP 0.2：本地 Node Runner CLI，手动读取 flow 并生成/运行 spec。
- MVP 0.3：Native Messaging，把插件与本地 Runner 连接起来。
- MVP 0.4：AI 生成、失败修复、CI 准备。

不要在 0.1 中实现 Native Messaging。
不要在 0.2 中实现 AI。
不要在 0.3 中实现复杂平台。
不要在 0.4 中自动提交 Git 或自动发 PR。

---

## 3. 必读文件

开始任何任务前，先读：

```text
ROADMAP.md
docs/tasks/MVP-0.1.md
docs/tasks/MVP-0.2.md
docs/tasks/MVP-0.3.md
docs/tasks/MVP-0.4.md
docs/schemas/business-flow.schema.md
```

当前正在做哪个版本，就额外重点阅读对应任务文件。

---

## 4. 上游仓库保护规则

### 禁止事项

不要随意修改：

```text
playwright/
src/server/*
```

例外：MVP 0.1 允许对 recorder app 做一个最小 patch，用于把 recorded actions 发送给 side panel。如果上游已经提供等价消息，则不要重复 patch。

禁止大改：

```text
chrome debugger transport
Playwright subtree
recorder/player core behavior
package build pipeline
```

### 推荐新增位置

业务层代码优先放在：

```text
examples/recorder-crx/src/flow/
examples/recorder-crx/src/components/
tools/flow-runner/
docs/
```

---

## 5. 实施前检查

每次开始实现前：

1. 查看当前 git status。
2. 确认依赖已安装。
3. 运行原始 build。
4. 确认 `examples/recorder-crx` 可以正常构建。
5. 搜索目标文件是否存在。
6. 如果文档中的路径不存在，先找等价文件，再小幅更新文档或实现路径。

推荐命令：

```bash
npm ci
npm run build
```

如果仓库已有更具体的 example build/test 命令，优先使用仓库现有命令。

---

## 6. 代码风格

- 使用 TypeScript / React 风格，遵循原仓库习惯。
- 新增工具函数保持小而纯。
- UI 组件不要写成一个巨大的文件。
- 所有导出前都经过 redactor。
- 所有本地路径都必须 normalize 并校验 workspace root。
- 不要引入大型依赖。
- 允许轻量依赖，但必须说明原因并更新 lockfile。
- 先优先无依赖实现，比如 YAML 可以先手写简单 exporter，不必引入完整 YAML 库。

---

## 7. 数据模型不变量

`BusinessFlow` 必须满足：

```text
schema === "business-flow/v1"
flow.id 存在
flow.name 存在
steps 是数组
每个 step 有 id/order/action/assertions
assertions 是数组
network 是数组
createdAt/updatedAt 是 ISO string
```

导出前必须：

- 移除或脱敏 password/token/cookie/authorization/secret。
- 不导出浏览器 cookie。
- 不导出 storageState 中的敏感值，除非显式 masked。
- 不导出完整 DOM。
- 不导出完整 response body。
- 不导出大截图或 trace，只导出路径/hash。

---

## 8. Selector 策略

生成/保存 locator 时优先级：

```text
test id / data-e2e
role + name
label
placeholder
text
aria-label
Playwright generated selector
CSS selector
XPath
coordinate fallback, only if unavoidable
```

不要主动鼓励 CSS/XPath。对于 Ant Design / ProComponents 项目，后续应推动 `data-e2e` 或 `data-testid` 规范。

---

## 9. Assertion 策略

录制流程不能只有 action，没有 assertion。

第一版必须支持：

```text
visible
textContains
textEquals
valueEquals
urlMatches
toastContains
tableRowExists
apiStatus
apiRequestContains
custom
```

如果 flow 没有 enabled assertion，导出时显示 warning，但不要阻止导出。

---

## 10. Network 策略

MVP 0.1 只做 best-effort network summary。

允许记录：

```text
method
url
urlPattern
status
resourceType
requestPostData after redaction
timestamp
selected
stepId
```

不要记录：

```text
完整 response body
authorization header
cookie header
真实 token
大文件请求
```

如果网络记录实现复杂，不要阻塞 0.1 主流程；但要保留扩展点。

---

## 11. Native Messaging 策略，MVP 0.3+

Native Messaging 只传：

```text
命令
小型 flow JSON
结果摘要
本地文件路径
错误摘要
```

不要传：

```text
trace.zip
视频
大量截图
完整 HTML report
大 response body
```

Host 必须：

- 校验 caller origin。
- 使用 allowlist workspace root。
- 拦截 path traversal。
- 不执行任意 shell 字符串。
- 只执行明确白名单命令。
- 所有 stdout 只输出 Native Messaging 协议消息。
- debug 日志写 stderr。

---

## 12. AI 策略，MVP 0.4+

AI 只在 Node Runner 侧调用，不在浏览器插件中调用。

AI 输入优先：

```text
compact-flow.yaml
原始 playwrightCode，若有
项目测试约定摘要
少量 sample spec/fixture
失败摘要
```

AI 输入禁止默认包含：

```text
完整 DOM
完整 trace
cookie/token
真实客户数据
完整 response body
```

AI 输出必须：

- 落盘为可 review 文件。
- 本地执行验证。
- 保存生成/修复日志。
- 最多自动修复 2 次。
- 不自动 git commit。
- 不自动推送。
- 不自动创建 PR。

---

## 13. 测试与验收

每个任务完成后至少执行：

```bash
npm run build
```

如果新增 CLI：

```bash
node tools/flow-runner/cli.mjs validate tools/flow-runner/fixtures/sample.business-flow.json
node tools/flow-runner/cli.mjs compact tools/flow-runner/fixtures/sample.business-flow.json
node tools/flow-runner/cli.mjs generate tools/flow-runner/fixtures/sample.business-flow.json
```

如果有 Playwright 可执行样例：

```bash
node tools/flow-runner/cli.mjs run tools/flow-runner/fixtures/sample.business-flow.json
```

手工 QA 必须覆盖：

- 插件加载。
- attach 当前 tab。
- record。
- replay。
- flow meta 编辑。
- step intent/comment 编辑。
- assertion 编辑。
- 导出 JSON/YAML。
- 刷新后草稿恢复。
- 脱敏效果。

### CRX 构建与本地扩展重载注意点

修改 parser / codegen / player / recorder action 类型，或任何会进入 `playwright-crx` 根包的 server/client 代码时，不能只构建 `examples/recorder-crx`。测试与示例扩展可能同时依赖 root `lib/` 和 example `dist/`，必须按顺序验证：

```bash
npm run build:crx
npm run build:examples:recorder
npm run build:tests
```

若只改 `src/` 或 `playwright/packages/**` 后直接跑 `examples/recorder-crx` 测试，可能出现源码已修但测试仍使用旧 `lib` / 旧 codegen 产物的假失败。

本地 Chrome 中已加载的 unpacked extension 不会自动吃到新 `examples/recorder-crx/dist`，手工验证前必须在扩展管理页重新加载扩展，或重启测试环境。

---

## 14. 交付格式

每个版本完成后，给出：

```text
Changed files
What was implemented
How to test
Known limitations
Next version handoff
```

不要只说“完成了”。必须附可执行验证步骤。

---

## 15. 分支建议

```text
feat/mvp-0.1-business-flow-recorder
feat/mvp-0.2-flow-runner
feat/mvp-0.3-native-messaging
feat/mvp-0.4-ai-generation-repair
```

每个版本保持一个独立 PR 或 merge commit，方便回退。

---

## 16. 失败时处理

如果某个上游 API 或路径和文档不一致：

1. 不要猜。
2. 在本地搜索相关 symbol。
3. 找到最小替代路径。
4. 修改实现时保留注释。
5. 在完成摘要中说明差异。

如果 build 失败：

1. 先判断是否由本次改动引起。
2. 若是本次改动，修复。
3. 若是上游已有问题，记录并尽量不扩大改动面。

---

## 17. 最重要的规则

**这个项目的核心不是生成代码，而是沉淀业务流程。**

所以不要为了让代码生成看起来快，而牺牲：

- 业务意图。
- 断言质量。
- 脱敏。
- 可回放性。
- 可审查性。
- 长期资产化。
