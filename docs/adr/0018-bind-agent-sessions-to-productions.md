# 按作品绑定 Agent Session

`/flovart new` 创建一部作品的 ProductionSession，并为其绑定一个 Codex 或 OpenCode Agent Session；一个 Flovart Project 可以包含多个相互隔离的 ProductionSession。每个 ProductionSession 持续关联其创作 Brief、Agent 对话、ProductionSpec Revision 和多次 ProductionRun，使重规划、审片和局部重做保留上下文，同时阻止不同作品之间发生提示词、风格或素材泄漏。该决定取代 ADR 0015 中按 Flovart Project 保存单一 Agent Session Binding 的粒度，但不改变 Agent 退出不能终止 ProductionRun 的边界。
