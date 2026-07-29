# 分离 Agent 与 Production 审批

Terminal Command Center 同时展示但严格区分 Agent Tool Approval 与 Production Gate Approval。`/agent approve <request-id>` 只响应 Codex 或 OpenCode 的 Shell、文件、网络和工具权限请求；`/flovart approve <gate-id>` 只向 Desktop Runtime 提交预算、安全、素材或审片决定。允许 Agent 工具调用不代表允许付费生成，批准 Run Budget 也不扩大 Agent 系统权限；两类审批使用不同视觉标识、分别审计，且不提供合并批准或“全部允许”。Agent、Production Skill 和 Autonomous Review Policy 均不能代替用户批准 System Gate，也不能绕过宿主安全策略。
