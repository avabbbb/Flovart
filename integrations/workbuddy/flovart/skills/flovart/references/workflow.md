# Flovart Workflow 操作参考

先完成一次 `flovart-cli ensure --json`，再读取真实项目和版本。日常只使用下面的稳定命令：

```text
flovart-cli status --json
flovart-cli workflow.inspect --agent-identity workbuddy --json
flovart-cli workflow.selection.get --agent-identity workbuddy --json
flovart-cli workflow.apply --agent-identity workbuddy --project-id <id> --expected-revision <revision> --mutation-id <stable-id> --idempotency-key <stable-id> --operations-json <json> --json
flovart-cli workflow.node.run --agent-identity workbuddy --project-id <id> --node-id <id> --idempotency-key <stable-id> --json
```

修改前先 `workflow.inspect`，使用返回的 `projectId`、节点 ID 和 `revision`。一次用户请求的节点、连线和布局修改合并为一次 `workflow.apply`；修改后再次 inspect，确认 Flovart 可见的 Workflow 与请求一致。

重试必须保留同一组 `mutationId` 与 `idempotencyKey`，不能用新的随机值重复创建节点。出现项目切换、当前 Workflow 不可用、版本冲突或资源不可执行时停止写入并报告错误，让 Flovart 提供恢复动作；不要猜测另一个项目，也不要回退到旧项目。

生成、费用确认、Provider 凭据和结果归档由 Flovart 处理。不要向用户索要密钥，不要直接请求 Provider。
