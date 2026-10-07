# 模块：Agent

> 状态：**Current truth**。总纲见[总体设计](00-overview.md)，交互规则见[交互设计](01-interaction.md) §6.2、§6.5。

## 1. 三个不同的东西

| 概念 | 是什么 | 不是什么 |
| --- | --- | --- |
| **外部 Agent 接入** | Codex、Claude Code、OpenCode、WorkBuddy、DSH 等通过 Skill + CLI（或 MCP 投影）调用 Iris | 第二套业务实现 |
| **Agent surface** | 顶栏连接中心：发现、准备、状态、切换 | 聊天页、Tasks / Artifacts 工作区 |
| **Assistant drawer** | Canvas / Table 旁的内置上下文助手，调用同一批受控操作 | Host picker、Agent 安装、更高权限 |

三者不复制彼此的 UI、会话、Host picker 或状态。

## 2. 稳定操作面

- 日常：`status`、`workflow.inspect`、`workflow.selection.get`、`workflow.apply`、`workflow.node.run`。
- 连接准备与诊断：`ensure`、`doctor`。
- 生成与素材（宿主路径）：任务提交、`task.get`、`artifact.locate` 等，只有实现、schema、验证齐备后才写进 Skill。
- 命令注册表 `tools/flovart/registry.js` 是唯一来源；文档里出现的命令必须在注册表中（`npm run docs:check` 校验）。

命名：当前 CLI 为 legacy `flovart`。宣传片中的 `iris layer.*` 是提议命名；改名属于独立迁移，需提供别名与弃用期，不并存两套语义。

## 3. Transport

| Transport | 角色 |
| --- | --- |
| CLI + Skill | 默认外部路径（`skills/flovart/` 为 canonical，`.agents/`、`.claude/` 为投影快照，不得手改漂移） |
| stdio MCP | 同一 operation contract 的可选投影（`tools/flovart/mcp-server.js`） |
| 内置 Assistant | 同一业务能力的 UI 入口 |
| 宿主 native MCP（Resolve 21.1） | 宿主操作由 Blackmagic 官方 MCP 完成，Iris 不复制 |

Transport 只做参数解码、权限上下文与结果编码；不做 MCP → CLI 子进程转发。

## 4. 权威与安全

- 修改绑定明确 project / revision；重试使用稳定幂等 ID；未知提交先查询。
- Agent 工具权限 ≠ Provider 费用授权；已确认范围内不重复询问，范围变化重新确认。
- Skill、日志、连接状态、项目数据不携带 Provider 原始 Key。
- 外部 Agent 不直接写 React store、localStorage schema 或 Runtime 私有数据库。
- 一个 Agent 连接失败不阻塞其他 transport。
- Workspace Lease 有 TTL、续期、过期与接管（见交互设计 §4.3）。

## 5. 宿主中的 Agent（Resolve 首发）

Skill 教 Agent 组合 **Resolve native MCP（宿主状态）+ Iris CLI（生成与素材）**。面板只显示 Agent 活动条与待确认项；对话留在 Agent 自己的界面。

## 6. 状态语义（面向用户）

已准备 / 需安装 / 需登录 / 离线 / 异常，每个配一个动作。内部 Writer、Projection、URL、Token、协议版本只在高级诊断。

## 7. 不采用

Agent 全页聊天；Production Crew / Director / Operator 强制分层；Host 专属 Workflow store；连接中心与 drawer 同时维护 Host picker；跨 Agent 登录态 / 记忆无损迁移。

## 8. 验证

每个 Agent 单独验证：安装 / 发现、登录态、inspect、mutation、node.run、断线恢复、错项目保护、费用与取消。支持等级只看 Support Matrix。
