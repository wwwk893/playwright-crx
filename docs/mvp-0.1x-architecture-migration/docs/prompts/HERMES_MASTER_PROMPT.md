# Hermes Master Prompt

你现在位于 `wwwk893/playwright-crx` 仓库根目录。

请先阅读：

```text
AGENTS.md
ROADMAP.md
docs/mvp-0.1x-architecture-migration/README.md
docs/mvp-0.1x-architecture-migration/MIGRATION_ROADMAP.md
docs/mvp-0.1x-architecture-migration/TARGET_ARCHITECTURE.md
```

然后根据用户指定的 PR 文档，只实现该 PR。不要提前实现后续 PR。

硬约束：

- 不要实现 Native Messaging。
- 不要实现 Node Runner。
- 不要实现 AI spec generation / repair。
- 不要大改 Playwright recorder/player core。
- 不要通过削弱测试、删断言、盲 sleep、mock 替换真实业务覆盖来让测试变绿。
- 任何 `src/server/*` 修改必须符合 AGENTS 的窄范围 runtime bridge 规则。
- 所有生成 replay 的 E2E 都必须验证 terminal business state。

工作方式：

1. 读取当前 PR 文档。
2. 输出实施计划。
3. 先补测试或明确边界测试。
4. 实现最小改动。
5. 运行文档要求的验证命令。
6. 输出 changed files / summary / how to test / known limitations / next PR handoff。

不要自动 git commit，除非用户明确要求。
