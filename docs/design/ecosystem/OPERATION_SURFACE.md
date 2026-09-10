# Flovart Operation Surface

状态：E0 现状 + E1 收敛基线。

## Surface 关系

```text
Canonical Registry / Operation Gateway
                 │
       ┌─────────┼─────────┐
       ▼         ▼         ▼
      CLI        MCP     DSH SDK
                 │
                 ▼
          Creative Host SDK
```

Operation 是语义，Transport 只负责参数解码、权限上下文和结果编码。所有 projection 都应能将结果归一化为同一份 operation receipt；Transport 名称不能进入 Workflow domain。

## 当前稳定公开面

| Operation | 当前 registry 命令 | MCP 名称 | side effect | 幂等/前置条件 |
| --- | --- | --- | --- | --- |
| 状态 | `status` | `flovart_status` | 只读 | 无；返回本机 readiness，不能冒充 Provider 登录 |
| 查看图 | `workflow.inspect` | `flovart_workflow_inspect` | 只读 | Browser Workflow 必须可用；结果脱敏 |
| 查看选择 | `workflow.selection.get` | `flovart_workflow_selection` | 只读 | Browser Workflow 必须可用；结果脱敏 |
| 应用变更 | `workflow.apply` | `flovart_workflow_apply` | 写入可见 Workflow | `expectedRevision` + `mutationId` + `idempotencyKey` |
| 运行节点 | `workflow.node.run` | `flovart_workflow_run` | 可能触发生成 | `nodeId`；写入操作必须有 `idempotencyKey`，费用/Provider gate 仍由 Flovart 控制 |

MCP projection 只注册上述五个工具。`command.list`、`command.schema`、granular Workflow 命令、`production.run` 和直接 Provider 生成命令不进入这一阶段的 model-facing MCP surface。实现入口为 `tools/flovart/mcp-server.js`，当前状态是 Experimental。

## 参数规则

- 业务参数来自 `tools/flovart/contracts/runtime/command-registry.v1.json`；Transport 不复制另一份业务 schema。
- `idempotencyKey` 是写操作的 projection-level envelope field，不进入 Workflow operation args。
- `agentIdentity` / `hostSessionId` 是可选 caller context；它们用于 Active Host/Lease 校验，不改变 Workflow 语义。
- `workspaceMode` 固定为 `browser`；任何 native/headless fallback 都应返回 `WORKSPACE_REQUIRED`。
- MCP tool result 同时提供可读 text 和结构化 JSON；Secret 和原始 Provider credential 永不进入 result。

## 受控扩展面

后续可以把以下 Runtime 能力作为非模型公开的 SDK/Resource：

```text
workspace.status
task.get / task.list / task.cancel
task.inspect / task.resume
event.stream
production.status
artifact.inspect / artifact.materialize
```

每一项需要单独的权限、错误、事件游标和跨 projection parity 测试；“已在 CLI Registry”不等于“应该注册成 MCP tool”。

## 错误语义

MCP 不吞掉 Flovart 错误，也不把失败伪装成自然语言成功：

```json
{
  "code": "WORKSPACE_UNAVAILABLE",
  "message": "当前没有已连接并同步项目的 Flovart Workflow。",
  "retryable": true,
  "details": {}
}
```

Transport 可以用 MCP `isError: true` 表达失败，但保留原始 `code`、`retryable` 和 `details`。
