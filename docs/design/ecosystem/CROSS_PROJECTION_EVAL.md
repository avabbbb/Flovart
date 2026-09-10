# Cross-Projection Evaluation

状态：本地契约与夹具验证通过；真实第三方 Host/Provider 仍是 External Certification Gate。

## 当前结果

| 指标 | 当前证据 | 结果 | 边界 |
| --- | --- | --- | --- |
| CLI/MCP normalized parity | `tests/flovartProjectionParity.test.ts` | 4/4 Workflow operation cases pass | 覆盖 `inspect`、`selection`、`apply`、`node.run`；不等于真实 MCP Host tracer |
| MCP stable surface | `tests/flovartMcpProjection.test.ts` | 5/5 tools + 2 read-only resources | `status` 与四个 Workflow tool；未把 Runtime 全量命令暴露给模型 |
| State hash parity | `tests/flovartProjectionParity.test.ts` | 1/1 controlled mutation fixture | 同一初始状态、同一 `workflow.apply`，CLI/MCP 最终 hash 相同；不是远端 Provider benchmark |
| Duplicate paid-like submissions | `tests/releaseCandidateProviderResilience.test.ts` | 0 duplicates / 100 submissions | Fake Provider HTTP fixture；真实账单语义仍未认证 |
| Runtime idempotency replay | `src-tauri/tests/runtime_ledger.rs` | 同 key 同 payload 返回同一 receipt；payload drift 明确拒绝 | 覆盖 Runtime ledger，不替代真实网络重试认证 |
| Wrong-project writes | Browser session/lease focused tests + `runtime_production_plan` | 0 observed | 当前 focused suite；尚未完成长期 chaos 压力测试 |
| Recovery | `src-tauri/tests/runtime_recovery.rs`、`runtime_production_plan.rs` | restart/lease/checkpoint scenarios pass | `ProductionTask` 新 Agent 跨会话与真实 429/提交未知恢复仍是 External Gate |

## 运行方式

所有 Node/Vitest 临时文件应设置到仓库 H 盘 `.tmp`；Rust 使用 H 盘 `CARGO_TARGET_DIR`。核心命令：

```bash
npx vitest run tests/flovartProjectionParity.test.ts tests/flovartMcpProjection.test.ts
cargo test --manifest-path src-tauri/Cargo.toml --no-fail-fast
```

`workflow.apply` 和 `workflow.node.run` 仍要求 projection-level `idempotencyKey`；Gateway 固定 `workspaceMode=browser`，因此 parity 不会绕过现有 Browser Workflow authority。

## 尚未声称的结果

- 没有真实 TeleAgent、WorkBuddy、Codex 外部客户端 transcript；
- 没有真实 DSH 登录会话和 service unload/reload tracer；
- 没有真实 Premiere/Photoshop/After Effects/Resolve 宿主闭环；
- 没有真实 Provider 价格、扣费、取消、429 和提交未知 benchmark；
- 没有把 mock、package build 或 stdio handshake 写成 Stable。

这些状态以根目录 `SUPPORT_MATRIX.md` 为准。
