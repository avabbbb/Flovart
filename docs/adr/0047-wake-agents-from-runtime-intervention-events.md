# 通过 Runtime 介入事件唤醒 Coding Agent

Desktop Runtime 与 Terminal Command Center 持续监控 ProviderAttempt、StageRun、预算和进度，不让 Codex 或 OpenCode 会话在模型等待期间持续轮询；只有创意重规划、不可机械恢复的失败诊断、审片或额外输入产生 Agent Intervention Event 时，Coding Agent Adapter 才恢复当前 Active Agent Binding。Agent 退出、断线或切换不终止 ProductionRun，普通状态事件也不消耗 Agent Turn，从而保持实时可见性而不建立第二套状态判断或浪费上下文。
