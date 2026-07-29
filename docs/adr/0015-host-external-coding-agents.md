# TUI 托管外部 Coding Agent

Terminal Command Center 通过 Coding Agent Adapter 检测并启动用户已经安装、登录的 Codex、Claude Code 或 OpenCode，并为每个 Flovart Project 保存可恢复的 Agent Session Binding。Flovart 不自建模型对话服务：自然语言与需要规划的 Production Skill Interaction Command 进入外部 Agent，状态、审批、取消等确定性平台命令直接调用 Runtime，不经过 LLM。Provider API Key 继续保存在系统 Keyring 且不注入 Agent 环境；Agent 或 TUI 退出只中断当前对话，不停止已经提交并由 Desktop Runtime 持久化的 ProductionRun。
