# MVP-0.3.md

# MVP 0.3：Native Messaging 连接插件和本地 Node Runner

## 目标

让浏览器插件能够调用本地 Node Runner，完成一键保存 flow、一键生成 spec、一键运行测试、一键查看结果路径。

MVP 0.3 不做 AI 生成/修复。

---

## 1. 范围

### In scope

- Native Messaging host。
- macOS 安装脚本。
- Native Messaging protocol。
- Extension native client。
- Side panel 操作按钮。
- Workspace allowlist。
- 本地路径安全校验。
- Runner command bridge。
- 结果摘要显示。

### Out of scope

- AI。
- 自动 Git commit/PR。
- 后台平台。
- Windows/Linux installer。
- 传输 trace.zip/视频/大截图。

---

## 2. Native Messaging 设计

Chrome Native Messaging 使用：

```text
Chrome extension
  runtime.connectNative / sendNativeMessage
        ↓
Native host process
        ↓
stdin/stdout length-prefixed JSON
```

Host manifest 需要：

```json
{
  "name": "com.company.business_flow_runner",
  "description": "Business Flow Runner",
  "path": "/absolute/path/to/tools/flow-runner/src/native/host.mjs",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://<EXTENSION_ID>/"
  ]
}
```

macOS 用户级 manifest 默认目录：

```text
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/
```

---

## 3. 建议目录

```text
tools/flow-runner/src/native/
├─ host.mjs
├─ protocol.mjs
├─ commands.mjs
├─ install-macos.mjs
└─ uninstall-macos.mjs

examples/recorder-crx/src/flow/
└─ nativeClient.ts
```

---

## 4. Protocol

### Request

```ts
type NativeRequest =
  | {
      id: string;
      type: 'ping';
      payload?: {};
    }
  | {
      id: string;
      type: 'saveFlow';
      payload: {
        workspaceRoot: string;
        flow: BusinessFlow;
        relativePath?: string;
      };
    }
  | {
      id: string;
      type: 'compactFlow';
      payload: {
        workspaceRoot: string;
        flow: BusinessFlow;
      };
    }
  | {
      id: string;
      type: 'generateSpec';
      payload: {
        workspaceRoot: string;
        flow: BusinessFlow;
        specRelativePath?: string;
      };
    }
  | {
      id: string;
      type: 'runTest';
      payload: {
        workspaceRoot: string;
        flow: BusinessFlow;
        specRelativePath?: string;
      };
    };
```

### Response

```ts
type NativeResponse =
  | {
      id: string;
      ok: true;
      result: unknown;
    }
  | {
      id: string;
      ok: false;
      error: {
        code: string;
        message: string;
        details?: unknown;
      };
    };
```

### Result examples

`ping`:

```json
{
  "id": "1",
  "ok": true,
  "result": {
    "version": "0.3.0",
    "cwd": "/Users/me/project"
  }
}
```

`generateSpec`:

```json
{
  "id": "2",
  "ok": true,
  "result": {
    "flowPath": "/Users/me/project/e2e-flows/admin.customer.create.success.business-flow.json",
    "specPath": "/Users/me/project/tests/e2e/admin.customer.create.success.spec.ts",
    "warnings": []
  }
}
```

`runTest`:

```json
{
  "id": "3",
  "ok": false,
  "error": {
    "code": "PLAYWRIGHT_TEST_FAILED",
    "message": "s003 点击保存后未出现 保存成功 toast",
    "details": {
      "specPath": "/Users/me/project/tests/e2e/admin.customer.create.success.spec.ts",
      "reportPath": "/Users/me/project/playwright-report/index.html",
      "tracePaths": [
        "/Users/me/project/test-results/admin.customer.create.success/trace.zip"
      ]
    }
  }
}
```

---

## 5. Host 实现

新增：`tools/flow-runner/src/native/host.mjs`

职责：

- 从 stdin 读取 4-byte length + JSON。
- 调用 `commands.mjs`。
- 写回 4-byte length + JSON。
- stdout 只输出协议消息。
- debug log 写 stderr。
- 捕获所有异常并返回 structured error。

伪代码：

```js
import { handleRequest } from './commands.mjs';

process.stdin.on('readable', async () => {
  const message = readNativeMessage(process.stdin);
  if (!message) return;
  const response = await handleRequest(message).catch(error => ({
    id: message.id,
    ok: false,
    error: {
      code: 'HOST_ERROR',
      message: error.message
    }
  }));
  writeNativeMessage(process.stdout, response);
});
```

注意：

- 处理 partial chunk。
- message size 超过安全限制时拒绝。
- 不要 `console.log`，使用 `console.error`。

---

## 6. Commands 实现

新增：`tools/flow-runner/src/native/commands.mjs`

命令：

```js
export async function handleRequest(request) {
  switch (request.type) {
    case 'ping':
    case 'saveFlow':
    case 'compactFlow':
    case 'generateSpec':
    case 'runTest':
    default:
  }
}
```

### saveFlow

保存到：

```text
{workspaceRoot}/e2e-flows/{safeFlowId}.business-flow.json
```

或用户提供的 `relativePath`，但必须在 workspaceRoot 内。

### compactFlow

生成：

```text
{workspaceRoot}/e2e-flows/{safeFlowId}.compact-flow.yaml
```

### generateSpec

调用 MVP 0.2 的 generator，输出：

```text
{workspaceRoot}/tests/e2e/generated/{safeFlowId}.spec.ts
```

### runTest

调用 MVP 0.2 的 runPlaywright。

---

## 7. Workspace allowlist

新增配置：

```text
~/.business-flow-runner/config.json
```

示例：

```json
{
  "allowedWorkspaceRoots": [
    "/Users/me/projects/admin-frontend",
    "/Users/me/projects/portal-frontend"
  ]
}
```

Host 必须检查：

```text
workspaceRoot 在 allowlist 内
所有输出路径在 workspaceRoot 内
不允许 path traversal
```

如果没有 allowlist：

- 第一次运行返回错误，提示执行 install/config 命令。
- 不要默认允许任意路径。

---

## 8. macOS installer

新增：`tools/flow-runner/src/native/install-macos.mjs`

职责：

1. 读取 extension ID 参数。
2. 生成 native host manifest。
3. 写入：

```text
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.company.business_flow_runner.json
```

4. 确保 host path 是绝对路径。
5. 确保 host 可执行。
6. 初始化 `~/.business-flow-runner/config.json`。
7. 打印后续步骤。

命令：

```bash
node tools/flow-runner/src/native/install-macos.mjs \
  --extension-id <EXTENSION_ID> \
  --workspace-root /Users/me/projects/admin-frontend
```

卸载：

```bash
node tools/flow-runner/src/native/uninstall-macos.mjs
```

---

## 9. Extension native client

新增：`examples/recorder-crx/src/flow/nativeClient.ts`

API：

```ts
export async function pingNativeRunner(): Promise<NativeResponse>;
export async function saveFlowToProject(flow: BusinessFlow, workspaceRoot: string): Promise<NativeResponse>;
export async function generateLocalSpec(flow: BusinessFlow, workspaceRoot: string): Promise<NativeResponse>;
export async function runLocalTest(flow: BusinessFlow, workspaceRoot: string): Promise<NativeResponse>;
```

实现：

- 优先使用 `chrome.runtime.connectNative` 建立 port。
- 或用 `sendNativeMessage` 做一次性调用。
- 处理 disconnect。
- 超时。
- 错误消息转为 UI 可读文字。

Manifest 增加 permission：

```json
"permissions": [
  "nativeMessaging"
]
```

如果原 manifest 动态生成，按上游方式加入。

---

## 10. UI

在 side panel 增加 Local Runner 区域：

```text
Local Runner
  Workspace Root: [ /Users/me/projects/admin-frontend ]
  [Connect]
  [Save Flow]
  [Generate Spec]
  [Run Test]
```

显示：

```text
Connection status
Last operation
Flow path
Spec path
Report path
Trace path
Error summary
```

按钮启用条件：

```text
flow.name 不为空
workspaceRoot 不为空
native runner connected
```

---

## 11. 安全要求

必须实现：

```text
allowed_origins 限制 extension ID
workspace allowlist
路径必须 stay inside workspace
禁用任意 shell 字符串
stdout 只写 protocol
stderr 写 debug
敏感字段保存前 redaction
Native message 不传大文件
```

不要实现：

```text
执行任意命令
读取任意本地文件
上传 trace
自动提交 Git
```

---

## 12. QA checklist

### 安装 host

```bash
node tools/flow-runner/src/native/install-macos.mjs \
  --extension-id <EXTENSION_ID> \
  --workspace-root /Users/me/projects/admin-frontend
```

### 插件测试

1. 打开插件。
2. 录制或加载一个 flow。
3. 填 workspace root。
4. 点击 Connect。
5. 点击 Save Flow。
6. 确认本地出现 `e2e-flows/*.business-flow.json`。
7. 点击 Generate Spec。
8. 确认本地出现 `tests/e2e/generated/*.spec.ts`。
9. 点击 Run Test。
10. UI 显示 passed/failed。
11. 若 failed，显示 report/trace path。

### 安全测试

- workspaceRoot 指向 `/tmp` 且不在 allowlist：应失败。
- relativePath 使用 `../../x`：应失败。
- flow 内含 token/password：保存后应脱敏。
- host stdout 不应出现 debug log。

---

## 13. 版本完成定义

MVP 0.3 完成时：

- macOS 上插件能连接本地 Runner。
- 插件能保存 flow 到本地项目。
- 插件能生成 spec。
- 插件能运行测试。
- 插件能展示结果路径。
- 不传大文件。
- 不调用 AI。
