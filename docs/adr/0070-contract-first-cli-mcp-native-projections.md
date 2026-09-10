# ADR 0070：以 Canonical Contract 驱动 CLI、MCP 与 Native Projection

## 状态

已接受（实施分阶段；真实 Host/Agent 认证仍是外部门槛）

## 背景

Flovart 已有 canonical CLI registry、五个稳定 Agent 命令、Browser Workflow authority、Runtime control plane 和 DSH `ctx.flovart` Service。历史上曾存在全量 MCP/Managed Agent 包装器，后来因为它们复制模型工具、混淆 Browser authority 和 Runtime authority 而删除。新的生态目标需要 MCP，但不能恢复那种第二套业务面。

## 决策

1. Workflow 是 domain；CLI、MCP 和 Native SDK 是同一 Operation Contract 的 projection。Projection 不拥有 Workflow、Provider 或 Artifact 业务逻辑。
2. 第一阶段的 model-facing MCP surface 与现有稳定 Agent surface 完全一致：`status`、`workflow.inspect`、`workflow.selection.get`、`workflow.apply`、`workflow.node.run`。
3. MCP 第一阶段只支持 stdio，并通过现有 Workspace Adapter/Runtime client 访问本机服务。它不读取 Browser token、Provider key，不创建第二个 Workflow store，也不通过 CLI 子进程串联业务调用。
4. `idempotencyKey` 只作为写操作的 Transport envelope field；`expectedRevision`、`mutationId`、Browser lease 和既有 Execution Gate 仍由现有实现负责。
5. DSH 保持 Native `ctx.flovart`；WorkBuddy 使用 CLI + Skill；TeleAgent 目标使用 MCP + Skill。一个 WorkBuddy Connector 不混合 CLI 和 MCP。
6. Browser Workflow authority 不迁移到 Runtime DB。`ProductionTask` 若实现，只记录执行生命周期、checkpoint、job/artifact 引用和恢复信息，不复制 Workflow state。

## 结果

- Codex/Claude/OpenCode/WorkBuddy/TeleAgent/DSH 可以按不同 transport 接入相同 operation semantics。
- MCP tool 数量保持小，`command.list`/`command.schema`/granular compatibility 命令不自动暴露给模型。
- Creative Host 可以在不理解 Provider 的情况下复用同一 Runtime；Premiere 是第一条 tracer。
- 旧“没有 Coding Agent MCP Server”的文档表述只代表历史决策，不再是当前目标；在实现/测试完成前不得把 MCP 写成 Stable。

## 安全与放行

- MCP result、Skill、CLI stdout、DSH state、Host Context 和面板都不得包含 raw API key、Authorization、Runtime token 或 Provider secret。
- Loopback HTTP（若未来实现）必须复用 dynamic discovery、Bearer auth、protocolVersion 和 registryHash；stdio 是第一阶段唯一公开 transport。
- 每个 projection 需要 contract parity、mutation parity、错误/恢复测试；真实 Agent 客户端和创作宿主仍分别是 `EXTERNAL_CERTIFICATION_GATE`。

## 不做

- 不恢复历史 `agent/mcp.js`。
- 不把 CLI 的所有 compatibility commands 变成 MCP tools。
- 不让 Host 直连 Provider。
- 不为了 MCP 迁移 Browser authority，不新增 Native Workflow fallback。
