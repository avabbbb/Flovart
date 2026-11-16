# 2026-11-16 Agent 可靠性：流式、重试、插话、中止与按节点 rebase

范围：网页端内置 Agent（`services/browserAgentKernel.ts` 的 `createBrowserAgentStream` + pi-agent-core 循环）、`FlovartAgentPanel` 的发送 / 停止 / 换线路、Workflow 草稿版本冲突（浏览器草稿权威 + 本地 Agent lease）、`workflow.node.update` 与 Operation 原位升级。触发来源是 [会议室现场评测](2026-11-16-meeting-room-field-test.md) 与之后的基准测试。

## 一、问题清单：现象 → 根因 → 修复 → 测试

| # | 现象 | 根因 | 修复 | 测试 |
| --- | --- | --- | --- | --- |
| 1 | 停止或运行中改 Key / 切模型后，会话里留下红色错误卡「signal is aborted without reason」 | 面板在 `browserRouteSignature` 变化时立即销毁并重建内核，abort 掉正在跑的一轮；底层 DOMException 文案原样写进助手消息；中止控制器在多次尝试间复用 | 新增 `components/agent/agentAbort.ts` 统一识别各层中止文案，显示中性的「已中止」（系统消息，不进错误卡）；内核在 `stopReason === 'aborted'` 时写 `AGENT_ABORTED_MESSAGE`（旧会话也按此显示）；面板只在空闲时应用新线路（`kernelRouteSignature`），运行中不重建内核；每轮、每次请求尝试各用新的 `AbortController`，用户停止通过级联传递 | `browserAgentStreamReliability.test.ts` › marks a user stop as aborted；`flovartAgentPanelKernelRoute.test.tsx` › keeps a running turn alive across a model switch / shows a stopped turn as 已中止；`browserAgentSteering.test.ts` › recognises raw abort texts |
| 2 | 回复不流式：整段写完才一次性出现，长回复期间只看到「思考中」 | pi-agent-core 只在收到 `start` 事件后才转发 `text_delta` / `thinking_delta`；`createBrowserAgentStream` 从不推 `start` | 第一个增量前推一次 `start` | `browserAgentStreamReliability.test.ts` › emits start before the first delta；`agentThinking.test.ts` 事件序列更新 |
| 3 | 上游 503 / 429 / 断连 / 长时间不出字时，一轮直接失败或无限「思考中」 | 没有重试；没有首字与空闲超时 | 卡住检测：首个 SSE 事件 90 s、事件间静默 60 s；在推出任何增量前，对网络错误 / 408 / 429 / 5xx / 卡住最多重试 2 次，指数退避并遵守 `Retry-After`（上限 5 s）；已经推过增量则不重试（避免同一回复出现两遍）；全部尝试都卡住时报明确的超时文案而不是中止 | `browserAgentStreamReliability.test.ts` › retries a 503 / network failure / stalled stream、reports a clear timeout、does not retry after text was already streamed |
| 4 | 内置 Agent 实际上没有系统提示词 | `buildBrowserAgentRequestBody` 忽略 `context.systemPrompt` | 系统提示词作为第一条 `system` 消息固定在最前（稳定前缀，利于前缀缓存） | `browserAgentStreamReliability.test.ts` › sends the system prompt as the first message |
| 5 | 历史里有一条旧错误后，之后每一轮都被标成失败（活动指示器变红） | 失败判断用 `snapshot.messages.some(error)`，扫的是整段历史 | 只看最新一条助手消息，且用户停止不算失败（`latestTurnFailed`） | 面板测试 |
| 6 | DeepSeek 的缓存命中始终显示 0 | `extractTokenUsage` 不认 DeepSeek 原生字段 `prompt_cache_hit_tokens`；网关同时给两个字段且一个为 0 时 0 会盖掉真实值 | 读取 `prompt_cache_hit_tokens` 并在多个候选字段中取最大值；流式 usage 写入 `cacheRead`，`input` 扣除命中部分 | `browserAgentStreamReliability.test.ts` › reads DeepSeek prompt_cache_hit_tokens |
| 7 | 运行中不能再发消息，只能先停止；发送与停止是同一个按钮 | 面板在非 idle 时直接丢弃发送；内核没有插话接口 | 内核 `steer()`：运行中把消息注入当前这一轮（下一个步骤边界生效），`send()` 结束后继续处理迟到的插话，停止时清空插话队列；面板运行中显示独立的「发送（不打断当前任务）」与「停止」两个按钮；带媒体的消息或托管 Agent 排队到这一轮之后发送 | `browserAgentSteering.test.ts`；`flovartAgentPanelKernelRoute.test.tsx` |
| 8 | 现场评测：Agent 读到 v21，用户在界面里挪了别的节点（v22），`node.run` / `node.update` 被 `REVISION_CONFLICT` 拒绝 | 草稿版本是全局计数，浏览器草稿权威、Dispatcher 与本地 Agent lease 都按整体版本比对 | 新增 `components/workflow/revisionRebase.ts`：`workflow.node.update` / `workflow.node.run` / 只含 `update_node` 的 `workflow.apply` 只在目标节点自 expectedRevision 以来被改过时才冲突，冲突带 `changedObjectIds` 并标 `retryable`；`agent/session.js` / `workspace-lease.js` 对这些命令推迟版本检查给浏览器，`REVISION_CONFLICT` 标为可重试 | `revisionRebase.test.ts`；`workflowDispatcher.test.ts` › per-node revision rebase |
| 9 | `workflow.node.update --title X` 报「写入内容与当前节点完全一致」；节点 run 后标题全被改回「图片生成」 | `--title` 没有映射进 patch，空 patch 被当成无变化；`ensureWorkflowImageGenerateOperation` 原位升级时用默认标题覆盖 | `--title` 作为 `patch.title` 简写，空 patch 报可操作的错误（提示 `--patch-json`）；升级为 Operation 时保留用户起的非默认标题 | `workflowDispatcher.test.ts` › accepts --title；`workflowOperations.test.ts` › keeps a user-given node title |
| 10 | 网页端只配了图片 / 视频服务时，面板报「需要 Codex / Claude / OpenCode 协作 Agent 在线」 | 冷启动失败一律按协作方离线分类 | 网页端没有可用文本线路时显示凭据卡（`textRouteRequired`：添加带文本模型的 OpenAI 兼容 Key） | `flovartAgentPanel.test.tsx` › points to a text-model key |

## 二、前后指标（`scripts/bench-agent.mjs`）

基准用真实的浏览器内核（pi-agent-core 循环 + `createBrowserAgentStream`）跑多轮会话，每会话含一次运行中插话。原始结果在 `.tmp/bench/*.keep.json`（gitignored，不入库）。

- **mock**：本地确定性 OpenAI 兼容服务，种子 7，注入 4% HTTP 503 + 4% 断连 + 4% 卡住不出字，延迟 250–500 ms，按 DeepSeek 规则（64 token 块）模拟前缀缓存。只反映本仓库代码的容错与请求结构，**不代表真实模型延迟**。40 会话，并发 8。
- **real**：RunningHub `deepseek/deepseek-v4.1-flash`，4 会话，串行。**样本很小**（17 / 20 次 LLM 调用），p95 基本就是最大值，只能看方向，不能当显著性结论；两次运行时间不同，上游负载也不同。

### mock（故障注入，40 会话）

| 指标 | 修复前 | 修复后 |
| --- | --- | --- |
| 会话成功率 | 57.5%（23/40） | 100%（40/40） |
| 失败分类 | 网络 6、HTTP 5xx 9、卡住 2 | 无 |
| LLM 调用错误率 | 12.3%（138 次调用） | 0%（160 次调用） |
| 发生重试的调用 | 0 | 17 |
| 可见首字 p50 / p95 | 730 / 878 ms（不流式，等于整段时长） | 427 / 1085 ms |
| 单次调用总时长 p50 / p95 | 730 / 878 ms | 803 / 1437 ms（p95 含重试退避） |
| 有流式增量的调用占比 | 0% | 75%（其余是纯工具调用） |
| 插话 | 不支持 10 次 | 接受 10 次，丢失 0 |
| 前缀缓存命中率（模拟） | 96.9%（平均 prompt 5223 token） | 97.7%（平均 prompt 6711 token，含系统提示词） |

修复前的调用次数更少，是因为失败的会话提前结束。

### real（DeepSeek v4.1 flash，4 会话）

| 指标 | 修复前 | 修复后 |
| --- | --- | --- |
| 会话成功率 | 4/4 | 4/4 |
| LLM 调用次数 / 错误 | 17 / 0 | 20 / 0 |
| 可见首字 p50 / p95 | 2772 / 4732 ms（不流式） | 2304 / 4091 ms |
| 单次调用总时长 p50 / p95 | 2772 / 4732 ms | 3358 / 5574 ms |
| 有流式增量的调用占比 | 0% | 100% |
| 每轮时长 p50 / p95 | 3904 / 8320 ms | 3904 / 14090 ms |
| 插话 | 不支持 1 次 | 接受 1 次 |
| 缓存命中率（服务端 usage） | 91.6%（平均 prompt 5969 token） | 92.9%（平均 prompt 8097 token） |

解读：修复后请求带上了此前缺失的系统提示词，平均 prompt 增加约 2100 token，单次调用与每轮 p95 变长，这是补上正确行为的代价，不是回退；用户感知的首字因为流式提前约 0.5 s 出现。真实环境样本太小，没有遇到故障，重试路径只在 mock 与单测里验证过。

## 三、未完成 / 后续

- **顶栏 Ready · Agent 一致性**：顶栏状态与面板内的实际可用性（无文本线路、内核重建中、托管 Agent 离线）还没有统一来源，可能显示 Ready 而面板给出凭据卡。
- **托管桌面 Agent 只能排队**：托管 Agent 的 `/turn` 没有插话接口，运行中发出的消息只能排到这一轮结束后发送，不能注入当前这一轮；带媒体的消息在内置内核里同样排队。
- 真实模型下的重试 / 卡住路径、长会话缓存命中还需要更大样本复测。
