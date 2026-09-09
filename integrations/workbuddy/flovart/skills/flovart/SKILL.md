---
name: flovart
description: 在 WorkBuddy 中用自然语言操作用户看得见的 Flovart Workflow，并把真实制作结果交给 Flovart 处理。
---

# Flovart

用户只需要说想做什么。你通过 WorkBuddy 已安装的 `flovart-cli` 使用 Flovart 的稳定本地能力；连接细节和服务凭据由 Flovart 管理。

执行修改前阅读随包提供的 [Workflow 操作参考](references/workflow.md)。

## 正常入口

首次使用或本地服务断开时先执行：

```bash
flovart-cli ensure --json
```

然后按需使用：

```bash
flovart-cli status --json
flovart-cli workflow.inspect --agent-identity workbuddy --json
flovart-cli workflow.selection.get --agent-identity workbuddy --json
flovart-cli workflow.apply --agent-identity workbuddy --project-id <id> --expected-revision <n> --mutation-id <stable-id> --idempotency-key <stable-id> --operations-json <json> --json
flovart-cli workflow.node.run --agent-identity workbuddy --project-id <id> --node-id <id> --idempotency-key <stable-id> --json
```

先读取真实项目和版本，再修改；修改后再次 inspect。重试同一个修改时保留同一个 mutation/idempotency 标识，不要重复创建节点。用户切换项目或当前 Workflow 不可用时停止并说明原因，绝不猜测目标。

## 用户语言映射

- “打开 Flovart” → `ensure`，确认结果后再 `workflow.inspect`。
- “查看当前 Workflow” → `workflow.inspect`。
- “选中的内容/当前选择” → `workflow.selection.get`。
- “新增、删除、移动、连线、修改节点” → 一次 `workflow.apply`，提交完整 operations。
- “运行这个节点” → 先确认节点和版本，再 `workflow.node.run`。

Provider 配置、费用确认和生成凭据由 Flovart 管理。配置或本地服务缺失时告诉用户去 Flovart 的产品设置或点击自动修复，不在聊天中收集敏感信息。
