# 流式调用用量统计：系统分析与分层设计

> 状态：设计稿（2026-10-30）。未实施。

## 1. 盘点：仓内全部流式调用

| # | 调用点 | 协议 | 现状 |
| --- | --- | --- | --- |
| S1 | `aiGateway.streamReversePrompt` · Google | `streamGenerateContent?alt=sse` | 不记录 |
| S2 | `aiGateway.streamReversePrompt` · Anthropic | Messages SSE | 不记录 |
| S3 | `aiGateway.streamReversePrompt` · OpenAI 兼容（OpenAI/OpenRouter/DeepSeek/Qwen/Custom） | Chat Completions SSE | 不记录 |
| S4 | `browserAgentKernel` | Chat Completions SSE | 被动记录：只有流里自带 `usage` 时才记 |
| S5 | `managedFlovartAgent` | 自有事件流（text-delta/tool-*） | 客户端收不到 usage，用量只在服务端 |

问题不只是「流式反推漏记」：
- S1–S3 三段 SSE 解析循环是复制出来的，S4、S5 又各写一份；分块规则也不一致：S1–S3 按 `\n` 分块，S4、S5 按空行分块。
- 三家的 usage 形态不同，而 `extractTokenUsage` 只处理「一个完整 JSON」。
- 取消或报错时不记录。但供应商已经按已消耗的 Token 计费，属于系统性低估。
- 「没拿到 usage」和「没有调用」在界面上无法区分，用户看到的是偏低的数字。

## 2. 各协议流式 usage 形态

| 协议 | usage 出现位置 | 语义 |
| --- | --- | --- |
| Gemini SSE | 各 chunk 的 `usageMetadata` | 累计值，取最后一次 |
| Anthropic SSE | `message_start.message.usage`（输入与缓存）；`message_delta.usage.output_tokens` | 输入取 start，输出取最后一次 delta（累计值） |
| OpenAI 官方 | 仅在请求带 `stream_options.include_usage` 时下发，放在最后一个 `choices: []` 的 chunk | 一次性 |
| OpenAI 兼容网关 | 取决于厂商：部分默认在末尾下发，部分需要 `include_usage`，部分会拒绝未知字段 | 逐家实测，不预设 |

## 3. 分层设计

```
L5 展示/文档  用量页：按 source 拆分；「N 次流式调用未返回 usage」；手册口径
L4 策略        按 API Key 的 streamUsage: 'passive'(默认) | 'request'；只对已验证的网关加 include_usage
L3 记账        finally 中统一提交：完成/取消/报错都记；带 outcome；没有 usage 则计入 missing 计数
L2 传输        readSseEvents(response, signal)：统一分块、跨 read 拼接、[DONE]、错误事件
L1 协议解析    createStreamUsageAccumulator(protocol)：feed(json) / result()，纯函数
```

### L1 协议解析（`services/streamUsage.ts`，纯函数）
- `createStreamUsageAccumulator('gemini' | 'anthropic' | 'openai')`，提供 `feed(event)` 和 `result(): TokenUsage | null`。
- 复用 `extractTokenUsage` 做单对象归一化；Anthropic 单独合并 start 和 delta。
- 不碰网络和存储，便于用真实 SSE 录制做回归测试。

### L2 传输（`services/sse.ts`）
- `async function* readSseEvents(response)`：产出 `{ event?, data }`。分块同时兼容 `\n\n` 和 `\r\n\r\n`，处理跨 chunk 拆行和末尾残留。
- S1–S3 先迁移到这里，并保留 `SseStreamError` 语义；S4、S5 后续迁移，每一步独立提交、独立测试。
- 顺带修正：目前 S1–S3 按 `\n` 分行，只认 `data: ` 前缀（带空格），遇到不带空格的 `data:` 会漏。

### L3 记账
- 在 `reversePromptStreamWithProvider` 的 `try/finally` 里调用一次 `recordTokenUsage({ source: 'reverse-prompt-stream', usage })`。
- `TokenUsageRecord` 增加可选字段 `outcome: 'ok' | 'aborted' | 'error'`；取消时只要已经拿到部分 usage 就记录。
- 新增 `recordUsageMissing({ provider, model, source })` 计数，不估算 Token。不用字符数估算，是为了保持「不编造数字」的口径。
- 存储兼容：字段可选，旧记录不动，存储 key 不升级。

### L4 策略
- 默认 `passive`：不改请求，延续现有原则。
- `request`：只对 OpenAI 官方，或用户在 Key 设置里手动开启的网关，加 `stream_options: { include_usage: true }`。若返回 400 且报错指向该字段，自动去掉字段重试一次，并把该 Key 退回 passive。
- Gemini 和 Anthropic 不需要策略，天然下发 usage。

### L5 展示与文档
- 用量页 Token 表增加 source 筛选，表下方显示「N 次流式调用未返回 usage」。
- 手册和复刻矩阵更新覆盖口径。

## 4. S5（托管 Agent）
用量发生在服务端。客户端只预留对 `usage` 事件的解析，收到就走 L3 记账；服务端下发该事件不在本仓范围内。

## 5. 测试矩阵
- L1：三种协议的真实形态 fixture；缺少 usage、只有 total、缓存/推理 Token、Anthropic 只收到 start。
- L2：一行被拆到两次 read、`\r\n`、`data:` 不带空格、`[DONE]`、错误事件、损坏的 JSON。
- L3：完成、中途取消、供应商错误事件、无 usage 三种路径分别记录正确；一次调用只记一条。
- L4：400 自动降级只重试一次；默认请求体不含 `stream_options`。

## 6. 实施顺序
1. L1 + L2 + L3 接入 S1–S3（不改请求体，风险最低）。
2. L5 展示 missing 计数，并更新文档。
3. S4 迁移到 L2，去掉重复解析。
4. L4 opt-in 策略，默认关闭。
