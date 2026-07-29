# 限制 Interaction Command Dispatch

Interaction Command 只能使用四种类型化 Dispatch：平台专用的 `runtime_command` 与 `tui_action`，以及 Production Skill 可声明的 `agent_intent` 与 `capability_request`。Skill 的 Capability Request 必须出现在其 Manifest 权限声明中，并继续受 Runtime 的预算、审批、状态和撤销检查；Community 与 Certified Skill 均不得声明平台 Dispatch，也不得把命令展开为 Shell、Executable、Script 或 HTTP URL。TUI 的帮助、补全和本地别名从平台 Command Registry 与已安装且有效的 Skill Manifest 生成，不建立第二套执行系统。
