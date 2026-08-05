# 区分内置、Managed 与 Connected Agent

Flovart Agent 是产品内置且对制作结果负责的 Agent；外部 Coding Agent 只是操作 Flovart 的宿主。外部宿主只有在 Flovart 能稳定完成进程检测、登录复用、线程创建与恢复、取消、结构化事件映射和进程回收时，才标记为 Managed Agent；当前仅 Codex 满足该等级。Claude Code、OpenCode、Cursor 等可以在各自连接验证后通过 MCP、CLI 或操作 Skill 成为 Connected Agent，但不能被描述成完整托管集成。

外部 Agent Session 按 ProductionSession 绑定并只通过 Runtime/Workspace 的类型化接口读写；Provider Secret、Runtime SQLite 和任意用户文件不注入 Agent。需要切换宿主时使用只含稳定制作引用的 Handoff Snapshot，不复制隐藏推理或凭据。Agent 退出、断线或切换不得终止已持久化的 ProductionRun，Agent Tool Approval 与 Production Gate Approval 始终分离。

产品界面、文档和诊断输出必须展示真实支持等级。具体宿主协议、TUI 框架和首发适配器清单属于可变实施细节，不再各自创建 ADR。
