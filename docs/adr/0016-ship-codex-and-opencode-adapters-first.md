# 首发 Codex 与 OpenCode Adapter

V1 同时交付 Codex 与 OpenCode 两个 First-Class Agent Adapter，Claude Code 等其他宿主延后接入。两者必须通过同一个 Coding Agent Adapter 契约提供会话创建与恢复、结构化事件、取消、审批和健康检查；不得以 PTY 键盘模拟、ANSI 输出解析或宿主私有文件抓取伪装兼容。宿主缺少任一必需能力时应显式降级为独立终端兼容模式，不能在 TUI 中显示为完整支持。
