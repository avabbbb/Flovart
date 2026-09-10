# Flovart 当前生态架构审计

状态：E0 真实代码审计。本文只记录当前工作树能够由源码、测试或已生成包证明的事实；目标能力见 [TARGET_ARCHITECTURE.md](TARGET_ARCHITECTURE.md)。

## 结论

当前 Flovart 已经有一条可复用的 Runtime/CLI/Browser Workflow 基础，并新增了一个只投影五个稳定 Agent 命令的公开 stdio MCP Server。`ProductionTask v1` 已作为现有 `ProductionRun`/`StageRun`/scheduler task 的规范化生命周期投影落地；真实 Agent 跨会话 tracer 仍未完成。新增生态能力应围绕现有 Contract 收敛，不应恢复历史 `agent/mcp.js` 或全量命令包装器。

## 当前权威边界

| 领域 | 当前权威 | 代码证据 | 当前状态 |
| --- | --- | --- | --- |
| 可见 Workflow 图 | Browser Workflow 页面与 `WorkflowAgentSession` | `agent/session.js`、`tools/flovart/workspace-client.js`、`services/workflowDispatcher.ts` | 已实现；无可见 Browser 时返回 `WORKSPACE_UNAVAILABLE` |
| Workflow mutation | Browser Adapter/Dispatcher 的 revision + mutation/idempotency contract | `agent/session.js`、`services/workflowDispatcher.ts`、`components/workflow/operationRegistry.ts` | 已实现；不能由新 Transport 另写一份 |
| 生产事实 | Desktop `ProductionRuntime` | `src-tauri/src/runtime/`、`src-tauri/src/runtime/control_server.rs` | 已实现 Runtime V1；Provider/任务仍以实际支持矩阵为准 |
| 本地 Runtime 控制 | 动态 loopback、Bearer token、discovery record | `tools/flovart/runtime-client.js`、`src-tauri/src/runtime/control_server.rs` | 已实现；不对浏览器暴露 Runtime token |
| CLI 命令元数据 | 单一 canonical registry | `tools/flovart/contracts/runtime/command-registry.v1.json`、`tools/flovart/registry.js` | 已实现；Registry hash 参与握手 |
| Agent 稳定模型工具 | 五个稳定命令 | `tools/flovart/agent-surface.js`、`agent/tools.js`、`dsh-plugin/src/tools.ts` | `status`、`workflow.inspect`、`workflow.selection.get`、`workflow.apply`、`workflow.node.run` |
| CLI 投影 | `tools/flovart/cli.js` | `tools/flovart/cli.js`、`tools/flovart/core.js` | 已实现；除五个稳定命令外还包含兼容、诊断和 Runtime 命令 |
| 公开 MCP 投影 | `tools/flovart/mcp-server.js` 的 stdio Server | `operation-gateway.js`、`mcp-server.js`、`tests/flovartMcpProjection.test.ts` | 已实现五工具 + 两个只读 Resource；当前 Experimental，不等于真实 Host 认证 |
| DSH 投影 | Cordis `FlovartService` + `ctx.flovart`，工具从 CLI registry 派生 | `dsh-plugin/src/service.ts`、`dsh-plugin/src/tools.ts` | 已实现 RC8 包形状；真实 Harness 仍是外部认证门 |
| WorkBuddy 投影 | CLI Connector + Skill | `integrations/workbuddy/flovart/cli.json`、`connector-meta.json`、随包 Skill | 包已生成/校验；真实客户端尚未认证 |
| TeleAgent 投影 | MCP + canonical Skill 准备包 | `integrations/teleagent/README.md`、`tools/flovart/mcp-server.js` | 本地 projection 已实现；官方客户端导入/权限/tracer 仍是外部门槛 |
| Canonical Skill | Flovart Operation Skill 的仓库/打包副本 | `tools/flovart/skill/SKILL.md`、`skills/flovart/SKILL.md`、`.agents/skills/flovart/SKILL.md` | 内容已收敛；复制/发布流程仍需明确 source-of-truth 校验 |
| ProductionTask | `ProductionRun` ID + `StageRun` checkpoint + `production.run` RuntimeTask | `src-tauri/src/runtime/production_task.rs`、`docs/design/ecosystem/PRODUCTION_TASK.md` | `task.inspect` / 安全 `task.resume` 已实现；Agent 新会话与真实远端恢复仍是 External Gate |
| Artifact | Runtime task result 或 Studio artifact registry | `dsh-plugin/src/service.ts`、`services/studio/artifactRegistry.ts` | 已有非秘密引用；尚未统一为独立跨 Surface Artifact operation family |
| Creative Host | Shared `CreativeHostAdapter` + Host-specific packages | `integrations/studio/shared/host-contract.js`、`integrations/studio/*` | 面板/契约/mock 已有；Photoshop/Premiere/AE/Resolve 真实宿主均未认证 |

## 当前调用关系

```text
Coding Agent / DSH
        │
        ├─ Operation Skill + CLI ──┐
        └─ DSH ctx.flovart ────────┤
                                   ▼
                         Agent / Workspace Adapter
                                   │
                       visible Browser Workflow authority
                                   │
                                   ▼
                       Workflow Dispatcher / Executor
                                   │
              ┌────────────────────┴────────────────────┐
              ▼                                         ▼
       Browser generation path                    Desktop Runtime path
       (Provider adapter)                         (tasks / artifacts / BYOK)
```

`source: mcp` 既用于内部转发，也由公开 stdio Server 使用；Server 复用同一 Workspace client、stable allowlist 和 Browser authority，不通过 CLI 子进程串联业务调用。

## 已确认的约束

- Workflow、Table、Agent 是三个产品工作区，不能因为新集成再创建第四个 Canvas/Native workspace。
- Browser Workflow 仍是可见 Workflow 的 authority；新 CLI/MCP/Host 不得隐式创建 native fallback。
- Provider credentials 不进入 Skill、Host Context、MCP result、CLI stdout、DSH service state 或宿主面板。
- Host adapter 只负责上下文、选区物化和产物导入，不能直连 Provider 或拥有 Workflow mutation 逻辑。
- WorkBuddy 与 CodeBuddy Code 是不同产品；WorkBuddy 当前包采用 CLI + Skill，不混装 MCP。
- 真实 Codex 登录、TeleAgent 客户端、DSH 登录会话和四个创作软件宿主都是 `EXTERNAL_CERTIFICATION_GATE`，不能用 package build 代替。
