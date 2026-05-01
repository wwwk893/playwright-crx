# Agent Model Benchmark

这个目录用于把用户上传的业务原型（例如页面/流程压缩包）转成可复用的模型评测任务，比较 GPT、Kimi、DeepSeek 在真实插件/录制/replay 场景里的表现。

## 评测目标

默认 case 复刻当前插件里的 **IPv4 地址池 / WAN 口 ProFormSelect** 场景，重点看模型能否：

1. 理解业务意图：创建 IPv4 地址池、选择 WAN 口、保存配置；
2. 抽出关键实体：`地址池名称`、`WAN口`、`开始地址`、`结束地址`、`保存配置`；
3. 为批量循环生成可用测试数据；
4. 识别真实自动化风险：AntD / ProComponents / ProFormSelect / portal dropdown / 动态 `rc_select_*` / `combobox` 不稳；
5. 在不同上下文比例下保持准确，同时控制速度和成本。

## 快速运行

只做 dry-run，不调用模型：

```bash
python3 benchmarks/agent_models/agent_model_benchmark.py \
  --dry-run \
  --models gpt-codex,kimi-k2.5,deepseek-v4-flash \
  --context-ratios 0.35,0.6,1.0
```

真实调用模型：

```bash
python3 benchmarks/agent_models/agent_model_benchmark.py \
  --models gpt-codex,kimi-k2.5,deepseek-v4-flash \
  --context-ratios 0.35,0.6,1.0 \
  --no-raw
```

使用用户上传的业务原型 zip：

```bash
python3 benchmarks/agent_models/agent_model_benchmark.py \
  --prototype-zip /path/to/business-prototype.zip \
  --models gpt-codex,kimi-k2.5,deepseek-v4-flash \
  --context-ratios 0.35,0.6,1.0 \
  --no-raw
```

输出默认写到：

```text
benchmarks/agent_models/results/latest.json
```

该目录已被 `.gitignore` 忽略，避免把模型输出或内部业务原型提交进仓库。

## 模型来源

脚本通过 Hermes CLI 调模型，因此优先使用本机已有订阅/配置：

| id | provider | model |
| --- | --- | --- |
| `gpt-codex` | `openai-codex` | `gpt-5.5` |
| `kimi-k2.5` | `kimi-coding` | `kimi-k2.5` |
| `deepseek-v4-flash` | OpenAI-compatible API | `deepseek-v4-flash` non-thinking |
| `deepseek-chat` | OpenAI-compatible API | legacy compatibility alias |

需要的 key 从环境变量或 `--env-file`（默认 `~/.hermes/.env`）读取。脚本不会打印 key，并会对输出里的 `sk-*`、token、secret 做基础脱敏。

## 评分

当前是 deterministic rubric，不依赖另一个 LLM 当裁判：

- 25%：业务意图关键词；
- 20%：关键实体覆盖；
- 10%：关键选项值覆盖；
- 30%：批量测试数据字段和 IP 合法性；
- 15%：自动化/replay 风险识别。

综合排序还会加一点速度和成本因素：

```text
composite = accuracy * 0.70 + speed * 0.20 - cost_penalty * 0.10
```

成本默认按估算 token 与配置价格计算；如果走订阅制或无法拿到精确用量，先按 `0` 记录，后续可以补真实 usage/cost adapter。

## 单元测试

```bash
python3 -m unittest benchmarks.agent_models.test_agent_model_benchmark -v
```
