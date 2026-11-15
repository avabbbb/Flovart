# 2026-11-15 基础功能评测：Agent 经 CLI 驱动画布

本记录收 2026-11-15 的一轮基础功能评测：外部 Agent 只通过 `flovart` CLI 操作可见 Workflow，用真实 RunningHub 账号生成。上一轮记录见 [2026-11-12 第二份](2026-11-12-agent-tool-eval-2.md)。评测中发现的问题在同日修复，提交为 `2d95e46`、`4ef7349`（Fixes #43）、`a8706cc`、`511c723`。

## 范围与方法

- **入口**：`node tools/flovart/cli.js`，经本地 Agent 服务转发到浏览器 Workflow（Browser Workflow 是可见权威）。
- **覆盖的命令**：`workflow.project.create`、`workflow.node.create`、`workflow.node.create-connected`、`workflow.node.run`（单节点与 `--node-ids` 批量）、`workflow.focus.nodes`、`skill.list`、`skill.draft --from-project`、`receipts.list`。
- **模型**：图片用 Seedream 5 Flash（RunningHub 国内站线路，0.11 CNY / 张）；视频用 Seedance 2 Fast 480p 5s 图生视频 1 次（2.5 CNY）。
- **预算**：20 CNY 上限。

## 结果概览

| 指标 | 数值 |
| --- | --- |
| CLI 调用 | 49 次：成功 30、失败 18、未归类 1 |
| 实际花费 | 3.38 CNY / 20 CNY 预算 |
| 图片 | Seedream 5 Flash，0.11 CNY / 张 |
| 视频 | Seedance 2 Fast 480p 5s 图生视频 1 次，2.5 CNY |
| 幂等 | 同一 idempotency key 重放返回同一个 `runId`，没有重复扣费 |

> 49 = 30 + 18 + 1：原始统计只给出成功 30、失败 18，剩下 1 次未归类；这里如实保留，不推断其结果。

## 线路与模型发现

- RunningHub **国内站**对 GPT Image 2、Gemini、悠船（Youchuan）返回 `40310`（该站点不可用）；Seedream 4.5 已下线。因此目录里默认的图片模型在国内站全部失败。
- 选择 Seedream 时画布白屏：PromptBar 的模型同步进入 `Maximum update depth exceeded` 循环。已在 `2d95e46`（CN 可用的 Seedream 5 Flash 线路 + PromptBar 无限更新白屏）修复，之后用 Seedream 5 Flash 完成本轮生成。

## 问题、追踪与修复

每项按「trace 中的现象 → 根因 → 修复 → 测试」记录。

### 1. 批量 `node.run --node-ids a,b` 只有最后一个节点成功

- **现象**：批量运行两个图片节点，返回里只有最后一个节点成功、生成了 take；前一个节点在画布上停在普通图片节点状态，或在 Operation 上没有新 take。
- **根因**：运行图片节点时要先把它原位转换为 `image.generate` Operation。转换计算（含 recipe 哈希）是异步的，旧代码在 `await` 返回后才由调用方把整份 project 写回 store；两个节点并行转换时都基于同一份旧基线，后写的覆盖先写的。随后开新 take 时又用 `await beginWorkflowOperationTake` 之前读到的快照整体写回，再次覆盖另一个节点的状态。
- **修复**：`ensureWorkflowImageGenerateOperation` 增加 `commit`，在读取最新状态并合并本节点变更的同一同步片段内写回；新增 `prepareWorkflowImageGenerateRun`，App 的执行适配器改用它，并在开新 take 之前重新读取最新状态；`runWorkflowGeneration` 开 take 后基于最新状态只替换本节点。
- **测试**：`tests/workflowBatchRunRace.test.ts` 经 dispatcher 用 `nodeIds: 'shot-a,shot-b'` 跑一批，断言两个节点都成功、都转换为 Operation、各有一个 take。用旧的写回顺序跑同一测试会失败。

### 2. `workflow.focus.nodes --node-ids a,b` 参数解析错误

- **现象**：`node.run` 接受逗号分隔的 `--node-ids`，`focus.nodes` 同样的写法报 `nodeIds 不能为空` 或找不到节点。
- **根因**：`focus.nodes` 只认数组形式的 `nodeIds`；CLI 传入的是字符串。
- **修复**：新增共用的 `parseWorkflowNodeIdList`（数组 / 逗号分隔 / JSON 数组字符串），`node.run` 与 `focus.nodes` 共用；CLI 层把 `--node-ids` 统一解析成数组；文件态 runtime 同步。
- **测试**：`tests/workflowDispatcher.test.ts`（逗号、带空格、JSON、数组、单个 `nodeId` 里带逗号、缺失节点、空列表）；`tests/workflowCli.test.js`（CLI 对两个命令给出相同的数组）。

### 3. RunningHub 运行的计费一直停在 `unknown`

- **现象**：生成成功后，用量记录与节点上的计费状态仍是 `unknown`，看不到实际金额。
- **根因**：RunningHub 任务结果的 `usage` 里有实际扣费（`consumeMoney`，或第三方模型的 `thirdPartyConsumeMoney`，单位元），但 RunningHub 的图片 / 视频成功路径从不发出 `usage` 生命周期事件，Workflow 的用量回填因此永远拿不到金额。
- **修复**：`runningHubTaskCost` 读取扣费字段（RH 币 `consumeCoins` 不能换算成人民币，不用于回填）；`reportRunningHubTaskCost` 在图片与视频任务成功后发出 `{ phase: 'usage', amount, currency: 'CNY' }`，用量记为 `actual`。拿不到金额时不发事件，仍保持 `unknown`，不假装成实际值。
- **测试**：`tests/runningHubCostBackfill.test.ts`，含一次从任务查询到图片下载的端到端回填。

### 4. `receipts.list` 为空

- **现象**：`node.run` 成功后 `receipts.list --project-id <id>` 仍是空的，`skill.draft --from-project` 拿不到产物回执。
- **根因**：回执只在显式 `POST /receipts` 或 `workflow.batch.pick` 时写入，`node.run` 的成功路径从不写。
- **修复**：Agent 会话在 `workflow.node.run` 成功后自动写 `artifact` 回执，每个成功且带 `runId` 的节点一条，`externalRef = run:<runId>`，按 runId 去重（幂等重放或另一个调用方上报同一 runId 都不会重复写）；写回执失败只告警，不影响生成结果。
- **测试**：`tests/agentRunReceipts.test.ts`（单节点 / 批量结果、失败不写、按 runId 去重）。

### 5. `skill.run` 报错暴露旧代号 “Iris”

- **现象**：误用不存在的 `skill.run` 时返回 `Unknown Iris command: skill.run`，也不提示该用哪个命令。
- **根因**：未知命令的报错文案沿用旧代号，且不看命名空间。
- **修复**：未知命令报 `Unknown Flovart command: <name>`，列出同一命名空间下真实可用的命令（如 `skill.*`），并带 `availableCommands`；CLI 返回码改为 `UNKNOWN_COMMAND`。Agent 系统提示词（`agent/kernel.js`）、TUI、DSH 帮助文案（实际页签名就是 Flovart）、宿主投影提示、CLI 文案与法律文档中的 Iris 统一改为 Flovart。README 中更名前录制的概念片说明与 AGENTS.md 的品牌规则保持不动。
- **测试**：`tests/flovartBranding.test.ts`；`tests/flovartLibtvCompat.test.ts` 的断言同步更新。

### 6. 验证 Key 时网络 / CORS 失败被报成「Key 无效」

- **现象**：浏览器里验证 RunningHub Key 遇到跨域拦截或断网，设置页显示 Key 无效。
- **根因**：`rhTestApiKey` 把任何异常都当作 `false`（= 无效）；其他服务的 `fetch` 异常也与 401 走同一条失败路径，界面再兜底显示「API Key 无效」。
- **修复**：新增 `rhProbeApiKey`，区分 `valid` / `invalid` / `unreachable`；模型发现与 `validateApiKey` 在网络 / CORS / 超时时返回 `reason: 'network'`，文案明确「未能判定 Key 是否有效」；设置页显示中英文「无法连接到服务……这不代表 API Key 无效」，批量测试遇到网络失败不把 Key 标成 error。真实的 401 / 鉴权错误仍报无效。
- **测试**：`tests/apiKeyValidationNetwork.test.ts`（OpenAI / Google / RunningHub / Anthropic / Kling 的网络失败、真实 401、RunningHub 鉴权错误、中英文文案）。

### 7. Workflow 命令文档与实际不符

- **现象**：Agent 按文档 `--type config` 建节点被拒；不知道要传 `config.modelId`；把提示词放在上游文本节点里，生成时没有用上；不清楚视频要等多久、超时后能不能重试。
- **修复**：重写 `skills/flovart/commands/workflow.md`（及 `.agents` 投影）：删掉不存在的 `config` 节点类型，说明生成设置放在 `metadata.config`，`modelId` 必填；文本节点不作为生成输入；`--idempotency-key` 的重放语义；视频等待时长（CLI 16 分钟、Agent 会话 15 分钟、RunningHub 轮询 10 分钟后取消上游）、不自动重试、`SEEDANCE_SUBMISSION_UNKNOWN` 不得重试、刷新后续接同一上游任务。
- **验证**：`npm run docs:check` 通过。

### 8. 导出是否包含脚本、服务地址与模型映射说不清

- **现象**：两种导出（不含 Key / 带 Key）其实都包含自定义用户脚本、自定义服务地址（Base URL）和模型映射，但按钮文字只说「不含 Key」，用户以为迁移会丢配置。
- **修复**：按钮文字与悬停提示（中英文）写明导出内容。
- **测试**：`tests/configMigration.test.ts` 断言两种导出都包含用户脚本、Base URL、模型映射，以及中英文文案。

### 9. GitHub #43：模型发现的超时没有覆盖读取响应体

- **现象**：响应头先到、响应体卡住的接口会让「获取模型」无限挂起，10 秒截止时间不生效。
- **根因**：`fetchWithModelDiscoveryTimeout` 在 `fetch` 返回响应头后就清掉计时器，之后的 `response.text()` 不受截止时间约束。
- **修复**：截止时间同时竞速 `fetch` 与读取响应体，返回已完整读入的 Response；修法不针对任何服务商。
- **测试**：`tests/modelFetcherDeadline.test.ts`（响应体卡住、响应头卡住、正常响应）。

### 10. RunningHub 预设模型被移除、获取模型覆盖手填

- **现象**：设置页提示「不再内置 RunningHub 旧预设模型」，新建 RunningHub 服务后模型列表为空，必须先点「获取模型」；获取 / 验证后手填的模型被覆盖。
- **修复**：RunningHub 预设恢复内置模型表与 Route Catalog 已核验线路，默认 Seedream 5 Flash；「获取模型」与「验证并更新」改为合并追加；提示文案同步（中英文）。RunningHub 在正式商业化前保持内置。
- **测试**：`tests/runningHubPresetModels.test.ts`。

### 11. 「获取模型」读的是国际站模型列表

- **现象**：Base URL 填国内站 `https://www.runninghub.cn/openapi/v2` 时，设置页「获取模型」列出的是国际站（runninghub.ai）的模型目录，与国内站可用模型不一致。
- **根因**：`services/modelFetcher.ts` 的 `fetchRunningHubModels` 把模型目录页写死为 `https://www.runninghub.ai/page-api`；Key 探测用的是用户的 Base URL，目录却不跟随。
- **修复**：新增 `runningHubDocsModelUrl(baseUrl)`：主机名是 `runninghub.ai`（含子域）时读 `https://www.runninghub.ai/page-api`，其余（国内站、无法判断的代理地址、默认值）读 `https://www.runninghub.cn/page-api`。两站目录页结构相同（`__NUXT_DATA__`），同一解析器可用；已用当日抓取的国内站页面核对能解析出约 50 个图片 / 视频模型。
- **测试**：`tests/runningHubModelDiscoverySite.test.ts`：地址映射（含 `evil-runninghub.ai.example.com` 不被当成国际站）；国内站与国际站 Base URL 各跑一次「获取模型」，断言只请求对应站点的 `page-api`，结果里有该站独有的模型。

## 仍未修复

- PromptBar 显示 1:1，而节点 `config.aspectRatio` 是 16:9：两处显示不一致。
- Seedream 输出的宽高比不稳定，与请求的比例不总是一致。
- `--web` 模式下若前端已在运行，`ensure` 无法启动 Agent；临时办法：改用 `--source` 启动。
- 自动产物回执（第 4 项）只经单元测试验证，尚未在真实画布上确认。

## 验证

- `npx tsc --noEmit -p .`：只有 `dsh-plugin/` 与 `tests/dshService.test.ts` 中缺少 `@deepseek-ai` 包导致的 17 个既有错误，没有新增。
- `npx vitest run`：1944 通过、4 失败、1 跳过。失败的 `dshService`（缺 `@deepseek-ai` 包）、`operationRegistryLocalize`（英文模式下的「半音」标签）、`pipelineTrace`（本机无 CJK 字体）在改动前就失败（`git stash` 对照确认）；`workflowEditor` 只在全量负载下失败，单跑通过。
- `npm run docs:check`：通过。
