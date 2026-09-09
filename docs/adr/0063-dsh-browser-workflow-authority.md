# ADR 0063：DSH 只使用 Browser Workflow Authority

状态：Accepted

## Context

DeepSeek Harness 需要一个原生的 Cordis service、模型工具和
`conversation.view`，但 Harness 自己保存 Workflow Draft 会形成第二份持久
authority。那会让 DSH、Flovart WebUI 和 Agent 对同一个项目产生分歧，也会让
宿主在没有可见 Browser Workflow 时误以为可以继续执行。

## Decision

DSH 仍然以 Native Plugin 形式安装，但“Native”只描述 Harness 插件机制，不
描述另一份 Workflow 存储。`ctx.flovart`、五个投影工具和 contextual
`conversation.view` 都通过 Link 的受限 Host proxy 调用 Flovart stable CLI
contract；Workflow truth、mutation、resource resolution、Executor、Provider
和 Artifact 仍由 Flovart Core/可见 Browser Workflow 持有。

DSH profile 固定使用 `workspaceMode=browser`。没有可见 Browser Workflow 时，
服务返回 `WORKSPACE_REQUIRED` 或 `WORKSPACE_UNAVAILABLE`；禁止创建 Native
Draft、读取旧文件、选择随机 Tab 或回退到 last-focused project。

## Consequences

- DSH 的 view 是当前可见 Workflow 的摘要和上下文入口，不是独立无限画布。
- `workflow.apply` 和 `workflow.node.run` 仍然沿用同一个 Agent/Browser lease、
  revision 和 idempotency contract。
- 没有 Browser Workflow 的 profile smoke 只能证明 fail-closed 行为；真实
  Harness 登录、页面 tracer 和 Provider/Artifact 回写仍必须单独认证。
- 旧 ADR 0062 记录的是已废止的 Native Draft 方案，仅保留作历史记录。
