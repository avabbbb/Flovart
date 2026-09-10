# ProductionTask v1

状态：已实现规范化投影，真实跨会话 Agent tracer 仍待验证。

`ProductionTask` 不是新的 Workflow store，也不是第二个 scheduler。当前实现复用已有 `ProductionRun` 作为 durable task identity，并从其 `StageRun` DAG 和关联的 `RuntimeTask` 记录生成稳定的生命周期视图：

```text
ProductionRun ID
      │
      ├─ StageRun status/checkpoint
      ├─ RuntimeTask scheduler lease
      └─ Artifact public references
             │
             ▼
      ProductionTask v1
```

## Contract

`tools/flovart/contracts/runtime/schemas/production-task.v1.json` 定义以下边界：

- `taskId` 与 `productionRunId` 相同，避免额外的 identity mapping；
- `workflowId` 只是目标可见 Workflow project ID，不复制 Workflow 图；
- `checkpoint` 只记录 Run/Stage 的恢复摘要和生产 revision；
- `jobIds` 指向 Runtime child task；`artifactIds` 只使用 Artifact identity（如 `sha256:`），不输出 `storeRelpath`；
- `retryPolicy` 明确禁止重跑已完成 Stage，并要求重复提交被拒绝；
- `runtimeTask` 只暴露 scheduler task ID/status，不泄漏参数、Provider credential 或内部 lease。

## Commands

```text
task.inspect --task-id <production-run-id>
task.resume --task-id <production-run-id>
```

`task.inspect` 是只读规范化查询。`task.resume` 是安全恢复检查：只有存在 `queued` 或 `working` 的 `production.run` scheduler record 时才返回成功；它重新连接已有 Runtime 任务，不创建第二个 Provider submission。未提交的 Run、已结束的 Run 或 Runtime 记录不一致时返回明确错误。

## Recovery boundary

Runtime 已有 StageRun 幂等 key `stage:{runId}:{stageKey}` 与 scheduler lease recovery。当前代码可以证明 Runtime restart 后从持久化 StageRun 继续调度；以下仍属于 `EXTERNAL_CERTIFICATION_GATE`：

- Agent conversation 退出后由新 Agent session 调用 `task.inspect` / `task.resume`；
- 真实 Provider 429、提交未知和远端取消的跨会话恢复；
- UI Task Center 对这些状态的完整展示。
