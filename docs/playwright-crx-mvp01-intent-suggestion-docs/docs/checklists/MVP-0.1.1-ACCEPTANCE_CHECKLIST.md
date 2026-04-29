# MVP 0.1.1 验收清单

用于 Codex 完成后自检，也用于人工验收。

---

# 1. Build / 基础功能

- [ ] `npm run build` 通过，或当前仓库约定的 build 命令通过。
- [ ] 如果有 `examples/recorder-crx` 独立 build 命令，也能通过。
- [ ] TypeScript 无新增类型错误。
- [ ] 原有 Playwright CRX recorder 可以 attach 当前 tab。
- [ ] 原有录制 click/fill/select/check 等 action 能正常工作。
- [ ] 原有 code preview 能正常显示。
- [ ] 原有 replay/player 没有被破坏。
- [ ] 原有 flow library CRUD 没有被破坏。
- [ ] 原有草稿保存和恢复没有被破坏。

---

# 2. P0 修复验收

## 2.1 testId extraction

- [ ] `internal:testid=[data-testid="ha-wan-add-button"s]` 能解析为 `ha-wan-add-button`。
- [ ] `internal:testid=[data-testid="xxx"i]` 能解析为 `xxx`。
- [ ] `[data-testid="xxx"]` 能解析为 `xxx`。
- [ ] `[data-e2e="xxx"]` 能解析为 `xxx`。
- [ ] 导出的 `FlowTarget.testId` 不含 `[data-testid=...` 残片。
- [ ] compact YAML 的 target 优先显示纯 test id。

## 2.2 comment editor

- [ ] 每个 recorded step 都显示备注输入框。
- [ ] 新建空步骤也显示备注输入框。
- [ ] 保存/打开记录后 comment 不丢失。

## 2.3 intentSource

- [ ] 自动生成的 intent 标记为 `intentSource: auto`。
- [ ] 用户手动编辑 intent 后标记为 `intentSource: user`。
- [ ] 用户手动修改后的 intent 不会被后续自动 suggestion 覆盖。
- [ ] 导入旧 flow 时，如果 step.intent 存在但 intentSource 不存在，默认视为 `user`。

## 2.4 recorder state

- [ ] 删除步骤后保存记录，再打开继续录制，不会把已删除 action 自动合回来。
- [ ] 插入录制后保存记录，再打开，步骤顺序仍正确。
- [ ] 导出 compact YAML 不包含内部 recorder state。

---

# 3. 页面上下文采集验收

- [ ] 插件 attach 页面后，pageContextSidecar 被注入一次，不重复安装。
- [ ] click 事件能产生 context event。
- [ ] input/change 事件能产生 context event。
- [ ] keydown 事件能产生 context event。
- [ ] 每个 tab 只保留最近 context events，数量有限。
- [ ] context events 不持久化到 IndexedDB。
- [ ] context event 中不包含完整 DOM。
- [ ] context event 中不包含 cookie/token/password/authorization。
- [ ] 采集文本长度有限制。
- [ ] 附近可见文本条数有限制。

---

# 4. 上下文字段验收

至少能在典型页面采集到：

- [ ] `url`。
- [ ] 页面标题或 document title。
- [ ] breadcrumb，如果页面存在。
- [ ] 当前 active tab，如果页面存在。
- [ ] modal title，如果弹窗存在。
- [ ] drawer title，如果抽屉存在。
- [ ] form label，如果点击/输入发生在表单项内。
- [ ] table title，如果点击发生在表格区域内且可识别。
- [ ] rowKey，如果行有 `data-row-key`。
- [ ] rowText，短文本摘要。
- [ ] columnName，如果能识别。
- [ ] target text。
- [ ] target testId。
- [ ] target role/aria-label/placeholder，能取到时。

---

# 5. intent suggestion 验收

## 5.1 新建弹窗

场景：点击“新建/新增/添加/创建”按钮，随后打开弹窗。

- [ ] 自动生成类似：`打开共享 WAN 新建弹窗`。
- [ ] 有 `intentSuggestion.rule`，例如 `click.create.open-dialog`。
- [ ] 有 `confidence`。
- [ ] provenance 包含 target text 和 dialog/section/table 依据。

## 5.2 行内编辑

场景：在表格行点击“编辑”。

- [ ] 如果能识别 rowKey 和 table title，生成类似：`编辑 WAN1 共享 WAN`。
- [ ] 如果随后打开编辑弹窗，优先生成类似：`打开编辑 WAN1 共享 WAN弹窗`。

## 5.3 删除 / 确认框

场景：在表格行点击“删除”。

- [ ] 生成类似：`删除 WAN1 共享 WAN`。
- [ ] 如果出现确认框，生成类似：`打开删除 WAN1 共享 WAN确认框`。

## 5.4 填写字段

场景：在弹窗或表单中填写字段。

- [ ] 如果能识别 field label，生成类似：`填写 WAN1 共享 WAN的 MTU`。
- [ ] 不把敏感输入值拼进 intent。
- [ ] 没有 entity 时，至少生成：`填写 MTU`。

## 5.5 选择下拉选项

场景：点击 Select 字段后选择选项。

- [ ] 能结合 lastFieldContext 生成：`选择 WAN 为 WAN2`。
- [ ] 如果在弹窗中，生成：`在新建共享 WAN中选择 WAN 为 WAN2`。

## 5.6 保存 / 确认

场景：在弹窗中点击“确定/保存/提交”。

- [ ] 生成类似：`确认保存 WAN1 共享 WAN配置`。
- [ ] 弹窗关闭后仍能使用 before.dialog.title。

## 5.7 Tab 切换

场景：点击 tab。

- [ ] 生成类似：`切换到 WAN 页签`。

## 5.8 fallback

- [ ] 无法获取上下文时，不报错。
- [ ] 可以生成低置信度 intent，例如 `点击 保存`。
- [ ] 不覆盖用户已修改的 intent。

---

# 6. 导出验收

## business-flow.json

- [ ] 每个有匹配上下文的 step 包含 `context`。
- [ ] 每个有 suggestion 的 step 包含 `intentSuggestion`。
- [ ] 自动生成 intent 的 step 包含 `intentSource: auto`。
- [ ] 用户修改的 step 包含 `intentSource: user`。
- [ ] 导出前执行脱敏。
- [ ] 不包含完整 DOM。
- [ ] 不包含 cookie/token/password/authorization。

## compact-flow.yaml

- [ ] 每个 step 保留 `intent`。
- [ ] 每个 step 可输出 `intentSource`。
- [ ] 每个 step 可输出短 `context`。
- [ ] context 只包含短字段，例如 page/tab/section/table/row/field/dialog/target/resultDialog。
- [ ] 不输出 rawAction。
- [ ] 不输出完整 sourceCode。
- [ ] 不输出完整 DOM。
- [ ] 不输出完整 response body。
- [ ] 不输出敏感字段。

---

# 7. 负向验收

确认没有做这些：

- [ ] 没有实现 Native Messaging。
- [ ] 没有实现本地 Node Runner。
- [ ] 没有实现 AI 生成 Playwright spec。
- [ ] 没有实现 AI 修复。
- [ ] 没有接 CI。
- [ ] 没有自动 git commit / PR。
- [ ] 没有重写 Playwright recorder。
- [ ] 没有重写 Playwright player。
- [ ] 没有重写 locator 生成逻辑。
- [ ] 没有采集完整 DOM。
- [ ] 没有采集完整 trace。
- [ ] 没有采集完整 response body。

---

# 8. 建议手工测试流程

1. 打开一个有 ProTable 的页面。
2. 开始录制。
3. 点击“新建”。
4. 在弹窗中填写一个普通字段。
5. 选择一个 Select 选项。
6. 点击“确定”。
7. 在表格行点击“编辑”。
8. 修改一个字段。
9. 点击“保存/确定”。
10. 停止录制。
11. 检查 step.intent 是否自动填入。
12. 手动修改其中一个 intent。
13. 继续录制一两个步骤。
14. 确认手动修改的 intent 没被覆盖。
15. 导出 business-flow.json。
16. 导出 compact-flow.yaml。
17. 检查 context 和敏感信息。

---

# 9. 最终输出要求

Codex 最终回复必须包含：

```text
Summary
Changed files
How to test
Acceptance checklist
Known limitations
Next handoff
Risks
```

并明确说明：

```text
没有实现后续 MVP 能力。
没有自动 git commit。
```
