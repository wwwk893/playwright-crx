# 安全与隐私边界

## 核心原则

AI intent suggestion 是浏览器插件内能力，但模型 API 是外部服务。必须默认最小化发送内容。

## API Key

### 不能做

- 不能把 API key 写入源码；
- 不能把 API key 打进 extension bundle；
- 不能把 API key 写入 `business-flow.json`；
- 不能把 API key 写入 `compact-flow.yaml`；
- 不能把 API key 写入 usage log；
- 不能从 content script 读取 API key；
- 不能在页面上下文 `window` 上暴露 API key。

### 可以做

MVP 阶段允许用户手动输入自己的 key：

```text
AI Intent Settings → Provider Profile → API Key
```

保存策略：

```text
Persist key: chrome.storage.local
Session key: chrome.storage.session
```

建议默认：

```text
Session key，不持久化
```

如果用户选择持久化，再写入 `chrome.storage.local`。

在 extension 初始化时调用：

```ts
chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
```

让 `storage.local` 尽量只暴露给受信任的 extension context，而不是 content scripts。

## 请求发起位置

只允许：

```text
background/service worker
extension side panel trusted context
```

不允许：

```text
content script
page window
injected script
```

推荐：side panel 发送 message 给 background，由 background 读取 key 并调用模型。

## 发送给模型的数据

允许：

```text
action type
target role/text/testId
page title
breadcrumb
active tab title
section title
table title
table rowKey / short rowText
table columnName
form label/name
dialog title
toast text
```

不允许：

```text
完整 DOM
完整 HTML
完整 trace
完整 network response body
cookie
token
password
authorization
API key
storageState
真实手机号
真实邮箱
身份证号
长文本输入值
敏感业务值
```

## 脱敏函数

AI 请求前必须再跑一遍脱敏，不要假设上游已经脱敏。

```ts
export function redactAiIntentInput(input: AiIntentInput): AiIntentInput {
  // 递归处理 string
  // 删除 value/rawAction/sourceCode 等字段
  // password/token/cookie/authorization/secret -> ***
  // phone/email/id/JWT/base64-like -> ***
}
```

## 不保存完整 prompt

Usage record 中不要保存完整 prompt。需要 debug 时只保存：

```text
requestSizeChars
responseSizeChars
stepIds
provider/model
```

如果确实需要 debug prompt，加一个开发开关：

```text
Store debug prompt: false by default
```

默认必须关闭。

## Flow 导出

`business-flow.json` 可以保存：

```text
intent
intentSource
intentSuggestion.provider/model/confidence
usageRecordId
```

不要保存：

```text
apiKey
完整模型请求
完整模型响应
```

## 失败与合规提示

设置页加一段说明：

```text
AI Intent 会把当前步骤的局部页面语义摘要发送给你配置的模型服务。不会发送完整 DOM、cookie、token、password、authorization、完整接口响应或 API key。请只在测试/预发环境使用，并确认符合公司数据安全要求。
```

## 生产化建议，非本轮实现

正式大规模上线时，最好通过企业服务端代理统一管理 key、审计和访问控制。但本轮 MVP 0.1.2 不实现服务端代理，也不引入 Native Messaging。
