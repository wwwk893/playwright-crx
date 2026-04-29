# MVP-0.2.md

# MVP 0.2：本地 Node Runner CLI

## 目标

实现一个本地 Node Runner，让 MVP 0.1 导出的 `business-flow.json` 可以在本地项目中被验证、压缩、生成 Playwright spec、执行测试。

MVP 0.2 仍然不接浏览器插件，不做 Native Messaging，不做 AI。

---

## 1. 范围

### In scope

- CLI 工具。
- Flow schema validator。
- Compact YAML CLI。
- Deterministic spec generator。
- Playwright test runner wrapper。
- JSON reporter 结果解析。
- trace/report 路径汇总。
- sample fixture。
- README。

### Out of scope

- Native Messaging。
- 插件按钮触发 Runner。
- AI 生成。
- 自动修复。
- Git commit/PR。
- 后台平台。

---

## 2. 建议目录

```text
tools/flow-runner/
├─ README.md
├─ cli.mjs
├─ src/
│  ├─ schema.mjs
│  ├─ compact.mjs
│  ├─ generateSpec.mjs
│  ├─ runPlaywright.mjs
│  ├─ resultParser.mjs
│  ├─ paths.mjs
│  └─ redact.mjs
└─ fixtures/
   └─ sample.business-flow.json
```

优先使用无外部依赖的 Node ESM 实现。如果要引入依赖，必须说明原因并更新 lockfile。

---

## 3. CLI 命令

实现：

```bash
node tools/flow-runner/cli.mjs validate <flowFile>
node tools/flow-runner/cli.mjs compact <flowFile> [--out <file>]
node tools/flow-runner/cli.mjs generate <flowFile> [--out <specFile>]
node tools/flow-runner/cli.mjs run <flowFile> [--project-root <dir>] [--spec <specFile>]
node tools/flow-runner/cli.mjs inspect <flowFile>
```

### validate

检查：

```text
schema === business-flow/v1
flow.id
flow.name
steps array
step.id/order/action
assertions array
network array
createdAt/updatedAt
敏感数据扫描
```

输出：

```json
{
  "ok": true,
  "flowId": "admin.customer.create.success",
  "steps": 5,
  "assertions": 4,
  "warnings": []
}
```

### compact

输出 compact YAML，逻辑要和插件 exporter 尽量一致。

### generate

根据 flow 生成 `.spec.ts`。

默认输出：

```text
.generated/e2e/{flow.id}.spec.ts
```

### run

如果没有 spec，先 generate，再执行：

```bash
npx playwright test <specFile> --trace retain-on-failure --reporter=json
```

实际命令可以根据项目情况调整，但必须在 README 中写清楚。

### inspect

输出 flow 摘要：

```text
Flow: 客户管理-新增客户-保存成功
Role: 销售管理员
Steps: 8
Assertions: 6
Selected APIs: 1
Has playwrightCode: yes
Warnings:
  - no testData
```

---

## 4. Schema validator

新增：`tools/flow-runner/src/schema.mjs`

API：

```js
export function validateBusinessFlow(flow) {
  return {
    ok: boolean,
    errors: string[],
    warnings: string[],
    summary: {
      flowId,
      name,
      steps,
      assertions,
      selectedNetworkEvents
    }
  };
}
```

不要一开始做复杂 JSON Schema 库。先实现手写校验：

```text
类型校验
必填字段
数组字段
action 枚举
assertion 枚举
敏感字段扫描
```

如果将来平台化，再升级 JSON Schema 或 Zod。

---

## 5. Compact exporter CLI

新增：`tools/flow-runner/src/compact.mjs`

API：

```js
export function toCompactFlow(flow) {
  return string;
}
```

要求：

- 与插件导出的 YAML 语义一致。
- 不输出 rawAction。
- 不输出 artifacts.playwrightCode。
- 不输出完整 network requestPostData，除非是 selected 且已脱敏摘要。
- 不输出 storageState。

---

## 6. Deterministic spec generator

新增：`tools/flow-runner/src/generateSpec.mjs`

### API

```js
export function generateSpecFromFlow(flow, options = {}) {
  return {
    specText,
    warnings
  };
}
```

### 生成策略

使用固定模板，不调用 AI。

示例：

```ts
import { test, expect } from '@playwright/test';

test.describe('客户管理-新增客户-保存成功', () => {
  test('admin.customer.create.success', async ({ page }) => {
    await test.step('s001 进入新增客户页面', async () => {
      await page.goto('/customer/create');
      await expect(page).toHaveURL(/customer\/create/);
    });

    await test.step('s002 填写客户名称', async () => {
      await page.locator('internal:role=textbox[name="客户名称"]').fill(customerName);
      await expect(page.locator('internal:role=textbox[name="客户名称"]')).toHaveValue(customerName);
    });
  });
});
```

### 变量处理

从 `testData` 生成：

```ts
const customerName = `AUTO_CUSTOMER_${Date.now()}`;
```

规则：

```text
strategy === generated -> 根据 rule 生成
strategy === literal -> 字符串 literal
strategy === runtime -> process.env
strategy === masked -> 不直接生成，warning
```

### action 映射

```text
navigate -> page.goto(url)
click    -> locator.click()
fill     -> locator.fill(value)
select   -> locator.selectOption(value)
check    -> locator.check()
uncheck  -> locator.uncheck()
press    -> locator.press(value)
upload   -> locator.setInputFiles(value)
unknown  -> 注释 + warning
```

### target 映射

优先：

```text
target.testId -> page.getByTestId(...)
target.role + name -> page.getByRole(...)
target.label -> page.getByLabel(...)
target.placeholder -> page.getByPlaceholder(...)
target.text -> page.getByText(...)
target.selector -> page.locator(...)
```

不要把 selector 字符串直接插入 TypeScript 代码，必须 escape。

### assertion 映射

```text
visible -> await expect(locator).toBeVisible()
textContains -> await expect(locator).toContainText(expected)
textEquals -> await expect(locator).toHaveText(expected)
valueEquals -> await expect(locator).toHaveValue(expected)
urlMatches -> await expect(page).toHaveURL(...)
toastContains -> await expect(page.getByText(expected)).toBeVisible()
apiStatus -> waitForResponse + expect(response.status()).toBe(...)
apiRequestContains -> warning first; MVP 可以输出 TODO
tableRowExists -> page.getByRole('row', { name: ... }) or TODO
custom -> comment TODO
```

### network 映射

对 `apiStatus`：

```ts
const responsePromise = page.waitForResponse(response =>
  response.url().includes('/api/customer/create') &&
  response.request().method() === 'POST'
);

await page.getByRole('button', { name: '保存' }).click();

const response = await responsePromise;
expect(response.status()).toBe(200);
```

注意：如果 `apiStatus` 附着在 click step，应在 click 前创建 wait promise。

---

## 7. Playwright runner wrapper

新增：`tools/flow-runner/src/runPlaywright.mjs`

API：

```js
export async function runGeneratedSpec({ projectRoot, specFile, trace = 'retain-on-failure' }) {
  return {
    ok,
    exitCode,
    stdout,
    stderr,
    jsonReportPath,
    htmlReportPath,
    tracePaths,
    errorSummary
  };
}
```

实现：

- 使用 `child_process.spawn`。
- 不拼接 shell 字符串，避免注入。
- 设置 cwd 为 projectRoot。
- 使用数组参数。
- 捕获 stdout/stderr。
- 如果有 JSON reporter 输出，保存到 `.generated/results/{flow.id}.json`。

命令示例：

```js
spawn('npx', ['playwright', 'test', specFile, '--trace', 'retain-on-failure', '--reporter=json'], {
  cwd: projectRoot,
  shell: false
});
```

---

## 8. Path 工具

新增：`tools/flow-runner/src/paths.mjs`

实现：

```js
export function resolveProjectRoot(input)
export function ensureInsideRoot(root, target)
export function safeFlowFileName(flowId)
export function defaultSpecPath(root, flowId)
export function defaultResultPath(root, flowId)
```

必须防止：

```text
../
绝对路径逃逸
空 flowId
奇怪字符
```

---

## 9. README

新增：`tools/flow-runner/README.md`

必须包含：

```text
安装/构建
命令列表
validate 示例
compact 示例
generate 示例
run 示例
输出目录
已知限制
MVP 0.3 Native Messaging 预告
```

---

## 10. Sample fixture

从 MVP 0.1 导出的真实或模拟 flow 中放一个：

```text
tools/flow-runner/fixtures/sample.business-flow.json
```

要求：

- 至少 3 个 steps。
- 至少 2 个 assertions。
- 至少 1 个 testData。
- 至少 1 个 selected network event。
- 已脱敏。

---

## 11. QA checklist

执行：

```bash
node tools/flow-runner/cli.mjs validate tools/flow-runner/fixtures/sample.business-flow.json
node tools/flow-runner/cli.mjs compact tools/flow-runner/fixtures/sample.business-flow.json
node tools/flow-runner/cli.mjs generate tools/flow-runner/fixtures/sample.business-flow.json
node tools/flow-runner/cli.mjs inspect tools/flow-runner/fixtures/sample.business-flow.json
```

如果本地有可跑的 Playwright 项目：

```bash
node tools/flow-runner/cli.mjs run tools/flow-runner/fixtures/sample.business-flow.json --project-root .
```

---

## 12. 版本完成定义

MVP 0.2 完成时：

- 手动导出的 flow 能被 CLI validate。
- CLI 能生成 `.spec.ts`。
- CLI 能执行或至少正确调用 Playwright。
- 失败时能输出可读错误摘要。
- 不需要插件、不需要 Native Messaging、不需要 AI。
