# ROADMAP.md

# Business Flow Recorder MVP Roadmap

> 项目目标：基于 `ruifigueira/playwright-crx`，把 Playwright CRX 从“代码录制器”扩展为“业务流程录制 + 自动化测试生成工作台”。
>
> 第一阶段不重写 Playwright recorder、不重写 locator 生成、不重写回放能力；只在现有 recorder/player/side panel 能力上增加业务流程 IR、步骤注释、半结构化断言、导出、本地 Runner、Native Messaging 和 AI 生成/修复闭环。

---

## 0. 基础判断

### 为什么以 Playwright CRX 为底座

Playwright CRX 已经提供：

- Chrome / Chromium / Edge 中的 Playwright recorder。
- Action button / context menu attach 当前 tab。
- Side panel recorder UI。
- 快捷键。
- TestID Attribute 配置。
- Recorder / player。
- Playwright tracing 兼容能力。

参考：

- https://github.com/ruifigueira/playwright-crx
- https://playwright.dev/docs/codegen
- https://playwright.dev/docs/locators
- https://playwright.dev/docs/trace-viewer
- https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging

### 本项目新增什么

我们新增的是“业务流程资产层”：

```text
Playwright CRX recorder/player
        ↓
Business Flow IR
        ↓
business-flow.json
compact-flow.yaml
        ↓
Node Runner
        ↓
generated Playwright spec
        ↓
local run / trace / report
        ↓
AI generate / repair
```

### 设计原则

1. **录制的是业务流程事实，不是只录制代码。**
2. **AI 默认只读 compact-flow.yaml，不读完整 DOM / trace / network。**
3. **CI 最终执行确定性的 Playwright spec，不让 AI 每次临场操作页面。**
4. **插件负责录制和交互，Node Runner 负责本地工程执行。**
5. **第一版不要做后台平台、不要做权限系统、不要做 PR 自动化。**
6. **不要大改 Playwright CRX 底层；业务能力尽量放在 example extension 和新增目录。**

---

## 1. 目标架构

```text
Chrome Extension / Side Panel
  ├─ Playwright CRX Recorder
  │   ├─ attach current tab
  │   ├─ record actions
  │   ├─ generate locators
  │   ├─ generate Playwright code
  │   └─ replay recorded instructions
  │
  ├─ Business Flow Layer
  │   ├─ flow metadata
  │   ├─ step intent/comment
  │   ├─ structured assertions
  │   ├─ selected network summaries
  │   ├─ redaction
  │   ├─ IndexedDB draft storage
  │   ├─ JSON export
  │   └─ compact YAML export
  │
  └─ Native Messaging Client, MVP 0.3+
      ├─ save flow to local project
      ├─ generate spec
      ├─ run test
      └─ return report/trace paths

Local Node Runner
  ├─ validate flow
  ├─ compact flow
  ├─ deterministic spec generation
  ├─ run npx playwright test
  ├─ parse test results
  ├─ save artifacts
  ├─ AI generation/repair, MVP 0.4+
  └─ Git/CI preparation, future
```

---

## 2. 仓库建议结构

在 fork 后，建议尽量保持上游结构不被打散。新增文件集中放：

```text
.
├─ AGENTS.md
├─ ROADMAP.md
├─ docs/
│  ├─ tasks/
│  │  ├─ MVP-0.1.md
│  │  ├─ MVP-0.2.md
│  │  ├─ MVP-0.3.md
│  │  └─ MVP-0.4.md
│  ├─ schemas/
│  │  └─ business-flow.schema.md
│  └─ prompts/
│     ├─ AI_SPEC_GENERATION.md
│     └─ AI_REPAIR.md
│
├─ examples/recorder-crx/src/
│  ├─ flow/
│  │  ├─ types.ts
│  │  ├─ flowBuilder.ts
│  │  ├─ compactExporter.ts
│  │  ├─ download.ts
│  │  ├─ storage.ts
│  │  ├─ redactor.ts
│  │  ├─ networkRecorder.ts
│  │  └─ nativeClient.ts             # MVP 0.3+
│  └─ components/
│     ├─ FlowMetaPanel.tsx
│     ├─ StepList.tsx
│     ├─ StepEditor.tsx
│     └─ AssertionEditor.tsx
│
├─ tools/
│  └─ flow-runner/
│     ├─ README.md
│     ├─ cli.mjs
│     ├─ src/
│     │  ├─ schema.mjs
│     │  ├─ compact.mjs
│     │  ├─ generateSpec.mjs
│     │  ├─ runPlaywright.mjs
│     │  ├─ paths.mjs
│     │  ├─ ai/
│     │  │  ├─ aiClient.mjs           # MVP 0.4+
│     │  │  ├─ contextBuilder.mjs     # MVP 0.4+
│     │  │  ├─ generate.mjs           # MVP 0.4+
│     │  │  └─ repair.mjs             # MVP 0.4+
│     │  └─ native/
│     │     ├─ host.mjs               # MVP 0.3+
│     │     ├─ protocol.mjs           # MVP 0.3+
│     │     └─ install-macos.mjs      # MVP 0.3+
│     └─ fixtures/
│        └─ sample.business-flow.json
```

如果上游仓库结构变化，先搜索等价文件，再更新文档中对应路径；不要硬改不存在的路径。

---

## 3. 版本路线

## MVP 0.1：浏览器插件内的业务流程录制

### 目标

让测试人员在浏览器里完成：

```text
开始录制
  ↓
手工走一遍业务流程
  ↓
给流程填写名称、模块、角色、目标
  ↓
给关键步骤添加 intent/comment/assertions
  ↓
Replay 确认流程能回放
  ↓
导出 business-flow.json
  ↓
导出 compact-flow.yaml
```

### 交付物

- 将 Playwright recorded actions 暴露给 recorder side panel。
- 新增 BusinessFlow TypeScript 类型。
- 新增 Flow Builder，把 Playwright actions 合并成 Flow steps。
- 新增 Flow metadata UI。
- 新增 step annotation UI。
- 新增 assertion editor。
- 新增 JSON/YAML 导出。
- 新增 IndexedDB 草稿保存。
- 新增脱敏工具。
- 新增 best-effort network summary。
- 保留原有 Playwright code 导出和 replay。

### 成功标准

- 原 Playwright CRX 可以 build。
- 原 recorder/player 不被破坏。
- 可以录制 click/fill/select/navigate/assert。
- Side panel 显示业务流程和步骤列表。
- 每个步骤可以填写 intent/comment。
- 每个步骤可以添加至少 8 类断言。
- 可以导出 business-flow.json。
- 可以导出 compact-flow.yaml。
- 刷新 recorder UI 后草稿不丢。
- 导出内容不包含明显 password/token/cookie/authorization。

详细任务见：`docs/tasks/MVP-0.1.md`

---

## MVP 0.2：本地 Node Runner，先不接插件

### 目标

在本地项目中手动运行 Node Runner，验证 flow JSON 可以进入工程化执行链路。

```text
business-flow.json
  ↓
node tools/flow-runner/cli.mjs validate
  ↓
node tools/flow-runner/cli.mjs compact
  ↓
node tools/flow-runner/cli.mjs generate
  ↓
node tools/flow-runner/cli.mjs run
```

### 交付物

- Flow schema validator。
- Compact exporter CLI。
- Deterministic Playwright spec generator。
- Playwright test runner wrapper。
- JSON result parser。
- Artifact path summary。
- 生成文件路径规范。
- CLI README。

### 成功标准

- 手动导出的 business-flow.json 可以被 validate。
- compact 命令输出与插件导出的 YAML 语义一致。
- generate 命令能生成可读的 `.spec.ts`。
- run 命令能执行 generated spec。
- 失败时返回错误摘要和 trace/report 路径。
- CLI 不依赖 Native Messaging。
- CLI 不调用 AI。

详细任务见：`docs/tasks/MVP-0.2.md`

---

## MVP 0.3：Native Messaging 连接插件和本地 Node Runner

### 目标

把插件与本地 Runner 打通，让测试人员不用手动复制文件和命令。

```text
插件 Flow UI
  ↓
Connect Local Runner
  ↓
Save to Project
  ↓
Generate Local Spec
  ↓
Run Local Test
  ↓
显示结果 / report path / trace path
```

### 交付物

- Native Messaging host。
- macOS installer/uninstaller。
- Native Messaging protocol。
- Extension native client。
- Side panel buttons。
- Workspace allowlist。
- Security checks。
- Result summary UI。

### 成功标准

- macOS 上可以注册 native host。
- 插件可以 connectNative。
- 插件可以把 flow 保存到本地项目。
- 插件可以触发 generate spec。
- 插件可以触发 run test。
- 插件能显示通过/失败、spec 路径、report 路径、trace 路径。
- Native Messaging 不传大文件，只传 JSON 命令、结果、路径。
- path traversal 被拦截。
- 只有指定 extension origin 能调用 host。

详细任务见：`docs/tasks/MVP-0.3.md`

---

## MVP 0.4：AI 生成、失败修复和 CI 准备

### 目标

让 Node Runner 根据 compact-flow.yaml、原始录制代码和项目测试约定生成更稳定的 Playwright spec，并在失败时做有限自动修复。

```text
compact-flow.yaml
+ original playwrightCode
+ project conventions
+ nearby fixtures/sample specs
  ↓
AI generate spec
  ↓
run test
  ↓
failure context
  ↓
AI repair, max 2 rounds
  ↓
human review
```

### 交付物

- Provider-agnostic AI client。
- Prompt templates。
- Context builder。
- Spec generation command。
- Repair command。
- Test result/failure summarizer。
- AI operation log。
- Generated spec review report。
- CI-ready generated output layout。

### 成功标准

- AI 不在浏览器插件内直接调用。
- AI 输入默认使用 compact-flow.yaml，而不是完整 trace/DOM。
- 生成 spec 后必须本地执行。
- 修复循环最多 2 次。
- 每次 AI 修改都保存 diff 或说明。
- 未经人工确认，不自动提交 Git。
- 3 条真实 P0 流程可以完成录制 → 生成 → 执行 → 失败修复/说明。

详细任务见：`docs/tasks/MVP-0.4.md`

---

## 4. 业务 Flow 数据模型摘要

### business-flow.json

用于保存完整业务流程资产。

特点：

- 面向长期保存。
- 保留 rawAction、sourceCode、network summary、artifacts。
- 可以被 Runner validate/generate/run。
- 可以被后续平台导入。

### compact-flow.yaml

用于 AI 上下文。

特点：

- 面向模型阅读。
- 删除 rawAction、完整 network、完整 DOM、cookie/token 等。
- 只保留业务目标、步骤、定位摘要、断言摘要、关键接口摘要。
- token 成本低。

Schema 详见：`docs/schemas/business-flow.schema.md`

---

## 5. 风险和控制

### 风险：上游 Playwright CRX 结构变化

控制：

- 每次实现前先运行原始 build。
- 修改前搜索等价文件。
- 只做最小 patch。
- 不改 `playwright/` subtree。
- 业务代码集中在 `examples/recorder-crx/src/flow` 和 `components`。

### 风险：录制步骤可以跑，但没有断言价值

控制：

- AssertionEditor 是 MVP 0.1 的核心，不允许后置。
- 导出时统计 enabled assertions 数量。
- 如果一个 flow 没有任何 assertion，导出时给 warning。

### 风险：selector 不稳定

控制：

- 优先 test id / role / label / text。
- 允许配置 testIdAttribute。
- 项目内部逐步推动 `data-e2e` 规范。
- CSS/XPath 只作兜底。

### 风险：敏感数据泄漏

控制：

- 插件导出前脱敏。
- Runner validate 时二次扫描。
- AI context builder 再次脱敏。
- Native Messaging 不传 token/cookie。
- 禁止生产环境真实数据录制。

### 风险：Native Messaging 安装复杂

控制：

- 0.1 和 0.2 不依赖 Native Messaging。
- 0.3 才接入。
- 先支持 macOS，因为研发和测试机器都是 Mac。
- installer/uninstaller 必须可重复执行。

### 风险：AI 生成不稳定

控制：

- 0.2 先做 deterministic generator。
- 0.4 AI 只作为增强。
- AI 输出必须经过 Runner 执行验证。
- 修复循环限制次数。
- 最终代码需要人工 review。

---

## 6. 推荐执行顺序

```text
1. Fork playwright-crx，确认原始 recorder-crx build/load/record/replay。
2. 按 MVP-0.1.md 完成插件端业务 Flow。
3. 用 3 条真实但低风险 staging 流程验证导出质量。
4. 按 MVP-0.2.md 完成本地 Node Runner。
5. 用 MVP 0.1 导出的 flow 手动跑 CLI。
6. 按 MVP-0.3.md 接 Native Messaging。
7. 按 MVP-0.4.md 接 AI generate/repair。
8. 之后再考虑平台化、Git PR、CI 回归集、客服/运维知识库。
```

---

## 7. 版本完成后的建议产物

每个版本完成后，仓库中应该有：

```text
CHANGELOG 或 release note
QA checklist
已知问题
截图或录屏
一条 sample business-flow.json
一条 sample compact-flow.yaml
一条 generated spec
```

每个版本都要保留一条真实业务流程作为回归样例。
