# Agent 架构设计索引

本目录是 Flovart Agent 子系统的主设计入口。目标架构始终只有两个 AI 角色：

1. **External Director Harness**：外部导演台，持有主对话、总体目标与跨任务调度。
2. **Workspace Operator**：Flovart 唯一内置的轻量执行 Agent，只把一个有界意图转换为类型化工具操作。

`Production Crew` 只是“Workspace Operator + Dispatcher + Runtime Worker”等执行组件的集合名，不是第三个 Agent，也不是多 Agent 制作团队。Dispatcher、Runtime、Provider Worker、Review Tool 都是普通工具或服务。

> 这些文档描述目标架构，不代表当前代码已经完成迁移。当前实现仍把一个基于 `@earendil-works/pi-agent-core` 的旧内置 Agent 作为主对话，并把 Codex 放在子任务位置；这里的包名不是目标产品角色，也不同于外部 Pi Coding Agent Harness。真实差距与删除门槛见第 10 份文档，DSH/Flovart P0 契约见第 11–15 份文档。

## 阅读顺序

1. [架构总览](01-architecture-overview.md)：一分钟理解导演台、制作组、Runtime 与三个工作区。
2. [权威与职责边界](02-authority-and-responsibility.md)：谁能决定、谁能执行、谁保存真相。
3. [外部导演 Harness、CLI 与扩展](03-director-harness-cli-and-extensions.md)：共同 CLI 工具边界、DeepSeek RC8 Profile/Bundle、Client Slot、Skill 与 Plugin。
4. [唯一内置执行 Agent 与制作组](04-production-crew-and-operator.md)：一个轻量 Operator、普通工具/服务与受限微规划。
5. [本地控制协议](05-local-control-protocol.md)：CLI 背后的版本化命令、事件、取消和回执。
6. [会话绑定、投影与交接](06-session-projection-and-handoff.md)：外部主记忆与 Flovart 本地读模型。
7. [Agent Workspace 体验](07-agent-workspace-experience.md)：制作控制板，而不是第二个聊天客户端。
8. [Workflow 工具与执行模型](08-workflow-tool-and-execution-model.md)：Intent、ChangeSet、Registry、对象版本与长任务。
9. [安全、审批与信任边界](09-security-approval-and-trust.md)：Secret、插件、网络、费用和不可恢复操作。
10. [迁移与验收](10-migration-and-acceptance.md)：从当前双主路径迁到目标架构的切片与放行门。
11. [SPEC-001：`ctx.flovart` Service Contract](11-flovart-service-contract.md)：Runtime Adapter、语义 Service 和模型工具入口。
12. [SPEC-002：Workflow Mutation Contract](12-workflow-mutation-contract.md)：显式范围、revision、Mutation ID、Receipt 与冲突。
13. [SPEC-003：DSH Session / Flovart Project Binding](13-session-project-binding.md)：会话绑定、Selection Context 和 UI 临时状态。
14. [SPEC-004：Flovart Durable Projection Events](14-durable-flovart-projection-events.md)：Conversation Node、Tool Card 与 DSH Job 投影。
15. [SPEC-005：Flovart UI Availability 与 Mode Contract](15-flovart-ui-availability-and-mode-contract.md)：Session 入口、Runtime offline、Standalone/DSH 模式与未来 Global Flovart。

## 文档规则

- [`CONTEXT.md`](../../maintenance/agent/CONTEXT.md) 只定义领域词；行为、协议和迁移细节只写在本目录。
- 每一项能力都要明确标为“当前已有”“目标设计”或“迁移后删除”，不能用未来设计冒充已实现功能。
- Coding Agent Projections 的模型工具统一从 Flovart CLI 与 Operation Skill 获得能力；Flovart 不向 Coding Agent 暴露 MCP Server。DeepSeek RC8 主壳只额外注册一个 `conversation.view` Flovart Workflow View，并可用 `shell.overlay` 呈现轻量审批/状态/Artifact；它们仅为 UI、事件与恢复使用受限私有通道，不形成第二套模型工具协议。
- CLI 的机器注册表来自 `command.list` 与 `command.schema`，仅用于 bootstrap、兼容诊断和调试；正常 Agent 操作使用五个稳定命令面，面向人的 stdout 不是内部协议。
- Production Runtime、Workflow Draft 与外部 Harness 会话各自只有一个权威，禁止镜像后双写。
- 产品语言只把 External Director Harness 和 Workspace Operator 称为 Agent；“制作组”与各类 Worker/Tool 不得写成额外 Agent。

## Coding Agent Projection 与 Mainstream Host

Codex 是当前 professional golden path；DeepSeek Harness 保留显式 native Plugin projection；CodeBuddy Code、Claude Code、OpenCode、Pi Coding Agent Harness 通过 stable Operation Skill + CLI contract 兼容。DeepSeek 额外采用专用 Profile + 可卸载 Bundle：Harness 继续作为主壳和默认导演，Client Plugin 只在原生会话中追加一个隔离 Flovart Workflow View 与轻弹层，不嵌入 Table、Agent Production Control 或 Agent Bridge。WorkBuddy 是未来 mainstream、skill-mediated projection 候选，不加入当前 `director.bind`。

- [Codex 官方文档](https://developers.openai.com/codex/)：CLI、Skill、非交互模式与 App Server 提供可选深度连接面。
- [DeepSeek Harness 官方 RC8](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.0-rc.8)：首个精确兼容基线；Profile/Bundle、`dsh.client` 与 UI Slot 均按该标签实现和验收，developer preview 的后续 RC 不自动视为兼容。
- [Claude Code 官方 CLI 文档](https://code.claude.com/docs/en/cli-usage)：Skill、结构化输出与 Session 恢复可用于标准接入。
- [OpenCode Server 官方文档](https://opencode.ai/docs/server/)：OpenAPI、SSE 与 Session API 可用于可选深度连接。
- [Pi 官方文档](https://pi.dev/docs/latest)：Agent Skills、RPC、JSON 事件流与 Session 格式可用于标准接入和后续深度连接。

## 决策依据

- [ADR 0061：外部导演 Harness 与唯一内置 Operator](../../adr/0061-use-external-director-and-internal-production-crew.md)
- [ADR 0062：DeepSeek Harness 内置原生 Workflow 画布](../../adr/0062-use-native-workflow-canvas-in-deepseek-harness.md)
- [ADR 0063：DSH 记录会话投影，Flovart Runtime 裁定生产事实](../../adr/0063-runtime-owns-production-facts.md)
- [ADR 0064：DSH Session 使用显式 Flovart Project Binding](../../adr/0064-bind-dsh-session-to-explicit-flovart-project.md)
- [ADR 0065：Workflow 变更使用版本前置条件与幂等 Mutation ID](../../adr/0065-idempotent-revisioned-workflow-mutations.md)
- [ADR 0066：DSH 集成模式下 Flovart 导航与连接状态解耦](../../adr/0066-decouple-flovart-navigation-from-runtime-availability.md)

旧的内置主 Agent、Managed/Connected 分级与多份 Agent 实施稿已由本设计包替代，历史只保留在 Git。AI 原生 Workflow Draft、Production Runtime 与 Production Skill 的仍有效决定继续由对应 ADR 和专项文档约束。
