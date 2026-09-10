# Flovart 目标生态架构

状态：E0/E1 目标设计；代码只有在对应测试和真实宿主证据存在后才可提升 Support Matrix 状态。

## 五个边界

```text
Workflow       = Domain / 可见生产状态
CLI / MCP      = Transport / Operation Projection
Skill          = Knowledge / 制作方法与调用规则
Agent          = Executor / 理解、规划和调用
Creative Host  = Host / 选区上下文、渲染与导入
```

## 目标调用图

```text
                         Production Skill
                                │
                                ▼
                    ┌────────────────────────┐
                    │  Canonical Operations  │
                    │  + Flovart Runtime     │
                    │  Workflow / Task /     │
                    │  Artifact / Provider   │
                    └────────────┬───────────┘
                                 │
                         Operation Gateway
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
                  CLI           MCP        Native SDK
                    │            │            │
              Codex/CC/       TeleAgent    DSH ctx.flovart
              OpenCode/       and MCP
              WorkBuddy*      Hosts
                    │
                    └────────────┬────────────┘
                                 ▼
                    Browser Workflow / Runtime
                                 │
                                 ▼
                      CreativeHostAdapter
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
                 Premiere     Photoshop   Resolve / AE
```

## 不变的权威

目标架构增加 Projection，不迁移权威：

- 可见 Workflow 图仍由 Browser Workflow authority 保存和修改。
- ProductionTask 只保存执行生命周期、checkpoint、job/artifact 引用和恢复信息，不复制 Workflow 图。
- Provider adapter 只接收 canonical generation input，不知道 Codex、MCP、Premiere 等调用者。
- Creative Host 只提供 `HostContext`、`HostSelection`、materialize/import 能力。
- DSH `ctx.flovart` 是 Native SDK projection，不是另一个 Workflow store。

## Canonical operation families

第一阶段沿用当前五个稳定 model-facing operations：

```text
status
workflow.inspect
workflow.selection.get
workflow.apply
workflow.node.run
```

内部/受控 Runtime operation 可以逐步纳入：

```text
workspace.status
job.inspect / job.cancel
artifact.inspect / artifact.materialize
task.inspect / task.resume
```

新增名字只有在现有 Registry、输入输出 contract、权限、幂等和至少一个 projection 有证据时才进入公开 Skill。不要为了“完整”一次性暴露几十个 granular tools。

## Transport policy

1. CLI 与 MCP 都调用 Operation Gateway；不得出现 MCP → CLI 子进程 → 另一套业务逻辑的串联。
2. MCP 第一阶段只支持 stdio。若未来增加 loopback HTTP，必须复用现有 dynamic discovery、token、protocolVersion 和 registryHash，并保持 localhost-only 与最小权限。
3. WorkBuddy 继续 CLI + Skill，因为一个 WorkBuddy Connector 不能混合 CLI 与 MCP。
4. TeleAgent 目标为 MCP + Skill，但在真实接口验证前只标为候选/External Gate。
5. DSH 继续 Native Service + Skill/Tool projection；插件不得持有 stale Service instance，也不得直接读 React store。

## 长任务方向

统一 `ProductionTask` 需要能够从现有 Runtime task/ProductionRun 逐步适配：

```text
intent snapshot
→ target binding
→ workflow revision
→ run/job ids
→ checkpoint
→ artifact ids
→ resume / cancel / recover
```

它必须记录逻辑提交身份，并在网络超时、Agent 会话退出、Runtime 重启和 Provider `429` 时先查询原任务；不能靠重提请求恢复。

## 发布状态规则

没有真实 Client/Host tracer 的集成只能是 `Experimental`、`Developer Preview` 或 `External Gate`；不能因 SDK、manifest、mock、MCP handshake 或 package build 通过而写成 `Stable`。
