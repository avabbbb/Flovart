# Flovart × TeleAgent

这是 TeleAgent 的接入准备包，不是未经官方 schema 验证的 Marketplace
Connector。Flovart 已提供一个基于 canonical Agent surface 的本地 stdio MCP
projection；真实 TeleAgent 导入、权限、长任务等待和错误展示仍属于
`EXTERNAL_TELEAGENT_CERTIFICATION`。

## Projection

```text
TeleAgent
  ├─ canonical Flovart Skill
  └─ local stdio MCP
       └─ flovart_status
          flovart_workflow_inspect
          flovart_workflow_selection
          flovart_workflow_apply
          flovart_workflow_run
```

从源码仓库运行：

```bash
node tools/flovart/mcp-server.js
```

发布 CLI 安装后运行：

```bash
flovart-mcp
```

MCP Server 只通过现有本机 Workspace Adapter 操作可见 Browser Workflow；它
不读取 Provider API Key，不在 TeleAgent 中保存 Flovart token，也不创建第二套
Workflow 状态。写操作必须携带 `idempotencyKey`，调用方可以额外提供
`agentIdentity: "teleagent"` 和 `hostSessionId` 参与 Active Host 校验。

## Skill

Skill 的业务语义以仓库根目录 `.agents/skills/flovart/SKILL.md` 为准。TeleAgent
专用包装层只应补充导入方式和客户端限制，不应复制 Workflow、Provider 或费用
规则。当前没有把官方 TeleAgent 专用文件格式伪装成已验证格式。

## Certification checklist

- [ ] 在真实 TeleAgent 版本中导入 Skill；
- [ ] 导入本地 stdio MCP 并完成握手；
- [ ] `workflow.inspect` 能读取当前可见 Workflow；
- [ ] `workflow.apply` 与 `workflow.run` 的失败码可见且不丢失；
- [ ] TeleAgent 会话退出后，运行中的 Flovart 任务不会被错误地伪装为已完成；
- [ ] MCP 结果、Skill 和客户端日志中没有 API Key、Authorization 或本机 token。
