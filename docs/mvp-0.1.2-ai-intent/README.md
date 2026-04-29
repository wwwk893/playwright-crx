# Playwright CRX 业务流程录制 MVP 0.1.2：AI Intent Suggestion 文档包

本包用于指导 Codex App 在当前 `playwright-crx` fork 的 MVP 0.1 / 0.1.1 基础上，完成一轮插件内 AI intent suggestion 能力。

> 本轮目标：把“非 AI 规则生成 intent 效果不足”的问题，用可配置的 Flash 模型能力补上，并让每次调用的 token、费用、延迟、成功率都能被记录和查看。

## 硬边界

本轮仍然只做浏览器插件内能力：

- 不做 Native Messaging；
- 不做本地 Node Runner；
- 不生成 Playwright spec；
- 不做 AI 修复；
- 不做 CI；
- 不做 Git/PR 自动化；
- 不重写 Playwright recorder/player/locator 生成逻辑；
- 不采集完整 DOM、完整 trace、完整 response body；
- 不发送 cookie/token/password/authorization/API key 到业务 flow 或导出文件。

## 文档目录

```text
playwright-crx-mvp01-ai-intent-docs/
├─ README.md
└─ docs/
   ├─ design/
   │  ├─ AI_INTENT_INTEGRATION.md
   │  ├─ MODEL_PROVIDER_PROTOCOLS.md
   │  ├─ TOKEN_COST_ACCOUNTING.md
   │  └─ SECURITY_PRIVACY.md
   ├─ tasks/
   │  └─ MVP-0.1.2-AI-INTENT.md
   ├─ prompts/
   │  └─ CODEX_PROMPT_MVP_0.1.2_AI_INTENT.md
   ├─ checklists/
   │  └─ MVP-0.1.2-ACCEPTANCE_CHECKLIST.md
   └─ examples/
      ├─ model-profiles.sample.json
      ├─ intent-ai-request.sample.json
      ├─ intent-ai-response.sample.json
      └─ ai-usage-log.sample.jsonl
```

## 推荐复制位置

建议复制到 fork 仓库内：

```text
docs/mvp-0.1.2-ai-intent/
```

然后把 `docs/prompts/CODEX_PROMPT_MVP_0.1.2_AI_INTENT.md` 的内容直接发给 Codex App。

## 本轮交付物

完成后，插件应具备：

1. AI Intent 设置页；
2. Provider Profile 管理，支持 OpenAI-compatible 和 Anthropic-compatible 协议；
3. API key 用户本地输入，不写入源码，不随 flow 导出；
4. 模型价格配置，支持输入/输出/cache hit/cache miss 等单价；
5. AI 批量生成 step.intent；
6. 每次调用记录 token、费用、延迟、provider、model、stepIds；
7. Usage 面板和导出 usage JSONL；
8. 失败不影响录制，不覆盖用户手写 intent。
