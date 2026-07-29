# 区分 Managed Agent 与 Connected Agent 支持

Agent Toolkit V1 只把 Codex 声明为 Managed Agent，因为当前实现已经通过 Codex `app-server` 支持线程创建、恢复、取消、事件观察和进程回收；`flovart start` 可以选择并托管该 Agent。Claude Code、OpenCode、Cursor 等宿主在完成各自连接测试后可以作为 Connected Agent，通过 MCP Server、CLI 或 Production Skill 调用同一 Runtime Capability，但 Flovart 不宣称能够启动、恢复或控制它们的会话。

产品界面、文档和诊断输出必须显示实际支持等级，不能把“生成了一份 MCP 配置”描述为“完整 Agent 集成”。后续只有在某个宿主具备稳定的进程检测、登录复用、会话创建与恢复、取消、事件映射和自动化测试后，才能为它增加 Coding Agent Adapter 并升级为 Managed Agent；这不会改变 Provider、Runtime 或 Command Registry 契约。
