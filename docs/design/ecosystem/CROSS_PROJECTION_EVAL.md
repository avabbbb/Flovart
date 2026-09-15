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

## FlovartBench v0.1（系统级 Agent / Workflow / Runtime Eval Harness）

存在的代码：`eval/`（入口 `npm run eval:*`）。机器生成的事实来源是
`eval/reports/<run-id>/report.json`，`report.md` 只是它的投影；下面的数字全部来自该文件，
任何人可用同一命令重跑。基线 SHA `9a1534b035350152c87d93a5f6e07f7452f3f66f`（`main`，工作区含本轮未提交改动）。

| 指标 | 结果 | 边界 |
| --- | --- | --- |
| 数据集 | 57 个任务 / 7 个 suite | 可准入 53；3 个 known gap、1 个仅 POSIX；dev 8 / regression 49，holdout 不入库 |
| 准入（Oracle ×5 + NOP） | 53/53 stable 5/5；NOP 53/53 失败；5 次 trial 必须产出同一个 canonical world | 参照解由能表达该任务的 runner 执行；NOP 失败证明 grader 有区分度 |
| 确定性基线（oracle+cli+mcp ×5） | pass@1 615/615；pass^5 43/43 | 参照解跑参照面，衡量的是 harness 与投影一致性，**不是 Agent 能力** |
| 判分方式 | 43 个任务带冻结 canonical hash（615 trial 全部额外做整世界相等判定） | 谓词判分常开；哈希由 `eval:oracle --freeze-hashes` 从真实参照运行导出，不手写；失配报 stale 而非静默通过 |
| Safety hard gate | PASS（6 项全 0） | `wrongTargetAttempts 15`、`unapprovedPaidAttempts 20`：被守卫挡下的企图单独计数，不是破坏 |
| Agent 基线 | 已认证外部 Agent 0/120 trials | Codex runner 无二进制时自报 blocked → `EXTERNAL_FAILURE`，不计入 pass@1/pass^5 |
| 环境迁移 | pass@1 20/20（POSIX 用例在 Windows 记 PLATFORM_NOT_APPLICABLE） | 真实 ACL / mode 位，调用生产 `verifyDiscoveryPermissions` |
| tokens / cost | 未测量（615 个执行 trial 无一报告 usage） | 确定性 runner 不调用模型；报告写「未测量」而不是 0，避免读成「免费」 |
| 红队（对 benchmark 本身） | 12/12 攻击被防住 | 含写答案文件、改 expected、删 grader 输入、自报成功、重复扣费、泄露密钥、跨 trial 残留状态、哈希判分退化 |
| Hosted CI blocker | 已修复并纳入回归 | `environment-discovery-*` 复现 strict DACL；两个原失败文件 19/19 通过 |

已声明的产品缺口（由 benchmark 发现，不以通过掩盖）：

- Agent 稳定面（`AGENT_PUBLIC_COMMANDS`）不暴露 `task.inspect` / `task.resume`，
  因此 ProductionTask 的查询与恢复目前不是 Agent 可达能力；
- 同一稳定面没有费用确认参数，已批准的付费生成只能经内部 workspace seam 表达；
- `first_frame` 来自 video 节点时只在输入解析期产生 `ROLE_CONFLICT` 诊断，不拒绝图写入；
- 失败分类中 `EXTERNAL_FAILURE`（外部 Agent 不可用）与能力失败严格分开统计。

## 运行方式

所有 Node/Vitest 临时文件应设置到仓库 H 盘 `.tmp`；Rust 使用 H 盘 `CARGO_TARGET_DIR`。核心命令：

```bash
npx vitest run tests/flovartProjectionParity.test.ts tests/flovartMcpProjection.test.ts
cargo test --manifest-path src-tauri/Cargo.toml --no-fail-fast

npm run eval:validate    # 数据集契约
npm run eval:redteam     # 对 benchmark 本身的攻击
npm run eval:oracle      # Oracle ×5 + NOP 准入
npm run eval:core        # oracle + cli + mcp 确定性基线
npm run eval:report      # 生成 report.json / report.md
```

`workflow.apply` 和 `workflow.node.run` 仍要求 projection-level `idempotencyKey`；Gateway 固定 `workspaceMode=browser`，因此 parity 不会绕过现有 Browser Workflow authority。

## 尚未声称的结果

- 没有真实 TeleAgent、WorkBuddy、Codex 外部客户端 transcript；
- 没有真实 DSH 登录会话和 service unload/reload tracer；
- 没有真实 Premiere/Photoshop/After Effects/Resolve 宿主闭环；
- 没有真实 Provider 价格、扣费、取消、429 和提交未知 benchmark；
- 没有把 mock、package build 或 stdio handshake 写成 Stable。

这些状态以根目录 `SUPPORT_MATRIX.md` 为准。
