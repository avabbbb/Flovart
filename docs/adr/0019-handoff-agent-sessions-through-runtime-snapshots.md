# 通过 Runtime Snapshot 切换 Agent

一个 ProductionSession 同时只有一个 Active Agent Binding，但用户可以在 Codex 与 OpenCode 之间切换。切换时 Desktop Runtime 从权威状态生成不可变的 Agent Handoff Snapshot，并用它创建或恢复目标宿主会话；快照只包含作品 Brief、Production Skill 与版本、当前 ProductionSpec Revision、已确认决策、ProductionRun 摘要、待处理审批、Artifact 引用和预算状态，不复制原始对话、隐藏推理、凭据或无关上下文。旧 Binding 归档但不删除，切换过程写入审计事件，且不得暂停、重启或重新提交正在执行的 ProductionRun。
