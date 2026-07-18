# 在原子运行时命令之上保留生产意图命令

Flovart 保留 `workflow.node.run`、`generate.image` 和 `generate.video` 等面向 Coding Agent、CLI 与 WebUI 的 Production Intent Command，但不再把它们视为重试、计费或恢复的原子边界；Desktop Runtime 通过版本化 Runtime Control API 提供带封闭类型输入、幂等键、持久任务句柄、状态查询与取消语义的 Atomic Runtime Command，并把每个生产意图展开为 ProductionRun、StageRun、ProviderAttempt 和 Artifact 状态转换。Canvas、Workflow、CLI、MCP 与 WebUI 必须复用同一 Runtime dispatch，不各自实现 Provider 调用或图状态真相。该分层增加了底层契约数量，但同时保留 Agent 使用的简洁入口和长视频制作所需的断连恢复、阶段重试、预算归属与进度观察能力。
