# 模块：Agent

> 状态：**Current truth**。总纲见[总体设计](00-overview.md)，交互规则见[交互设计](01-interaction.md) §6.2、§6.5。

## 1. 三个不同的东西

| 概念 | 是什么 | 不是什么 |
| --- | --- | --- |
| **外部 Agent 接入** | Codex、Claude Code、OpenCode、WorkBuddy 等通过 Skill + CLI（或 MCP 投影）调用 Flovart | 第二套业务实现 |
| **Agent surface** | 顶栏连接中心：发现、准备、状态、切换 | 聊天页、Tasks / Artifacts 工作区 |
| **Assistant drawer** | Canvas / Reverse 旁的内置上下文助手，调用同一批受控操作 | Host picker、Agent 安装、更高权限 |

三者不复制彼此的 UI、会话、Host picker 或状态。

## 2. 稳定操作面

- 日常：`status`、`workflow.inspect`、`workflow.selection.get`、`workflow.apply`、`workflow.node.run`。
- 委派：`agent.turn` —— 外部 Agent 让内置 Assistant 跑一轮，默认只读、只回摘要（文本 + 工具清单 + draftVersion），同一 mutationId 幂等、一次只跑一轮。
- 连接准备与诊断：`ensure`、`doctor`。
- 生成与素材（宿主路径）：任务提交、`task.get`、`artifact.locate` 等，只有实现、schema、验证齐备后才写进 Skill。
- 命令注册表 `tools/flovart/registry.js` 是唯一来源；文档里出现的命令必须在注册表中（`npm run docs:check` 校验）。

命名：产品与 CLI 统一使用 Flovart / `flovart`。历史宣传片中的 `iris layer.*` 仅为概念示意，不是可执行命令；以当前 CLI contract 为准。

## 3. Transport

| Transport | 角色 |
| --- | --- |
| CLI + Skill | 默认外部路径（`skills/flovart/` 为 canonical，`.agents/`、`.claude/` 为投影快照，不得手改漂移） |
| stdio MCP | 同一 operation contract 的可选投影（`tools/flovart/mcp-server.js`） |
| 内置 Assistant | 同一业务能力的 UI 入口 |
| 宿主 native MCP（Resolve 21.1） | 宿主操作由 Blackmagic 官方 MCP 完成，Flovart 不复制 |

Transport 只做参数解码、权限上下文与结果编码；不做 MCP → CLI 子进程转发。

内置 Assistant 的内核由 `BrowserAgentRuntime` 按项目持有（`services/browserAgentRuntime.ts`）；面板只是生命周期所有者与订阅者，不再直接构造内核。后续若让外部 Agent 通过命令面委派一轮内置对话，入口必须是这个运行时，而不是 React state。

## 4. 权威与安全

- 修改绑定明确 project / revision；重试使用稳定幂等 ID；未知提交先查询。
- Agent 工具权限 ≠ Provider 费用授权；已确认范围内不重复询问，范围变化重新确认。
- 工具调用先过策略层：沙箱 `read-only` / `workspace-write` / `danger-full-access` 决定能不能写，审批 `never` / `on-request` / `untrusted` 决定要不要问；删除与付费执行始终确认，策略层不重复弹命令面已经发起的确认。手动模式 = `untrusted`，自动模式 = `on-request`。
- Skill、日志、连接状态、项目数据不携带 Provider 原始 Key。
- 外部 Agent 不直接写 React store、localStorage schema 或 Runtime 私有数据库。
- 一个 Agent 连接失败不阻塞其他 transport。
- Workspace Lease 有 TTL、续期、过期与接管（见交互设计 §4.3）。

## 5. 宿主中的 Agent（Resolve 首发）

Skill 教 Agent 组合 **Resolve native MCP（宿主状态）+ Flovart CLI（生成与素材）**。面板只显示 Agent 活动条与待确认项；对话留在 Agent 自己的界面。

## 6. 状态语义（面向用户）

已准备 / 需安装 / 需登录 / 离线 / 异常，每个配一个动作。内部 Writer、Projection、URL、Token、协议版本只在高级诊断。

## 6.1 多步制作（提案）

内置 Assistant 驱动多步视频制作（brief → 素材 → 配音 → 合成 → 渲染 → 帧级评审 → 定向修补 → 归档）的 run / trace 模型、pipeline 工具集与放置决定见 [16 Agent 视频流水线（PROPOSAL）](16-agent-video-pipeline.md)。结论：run 在 Canvas 的 Assistant drawer 发起与查看，Agent surface 仍只做连接中心。

## 7. 不采用

Agent 全页聊天；Production Crew / Director / Operator 强制分层；Host 专属 Workflow store；连接中心与 drawer 同时维护 Host picker；跨 Agent 登录态 / 记忆无损迁移。

## 8. 验证

每个 Agent 单独验证：安装 / 发现、登录态、inspect、mutation、node.run、断线恢复、错项目保护、费用与取消。支持等级只看 Support Matrix。
