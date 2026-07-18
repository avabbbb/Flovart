# 保留 Flovart 斜杠命令命名权

TUI 以 `/flovart <action>` 作为唯一稳定的平台入口，Director Skill 只能通过 Manifest 在 `/flovart <skill-slug> <action>` 下声明带 Schema 的交互命令，不得占用平台命令或注册任意全局名称。`/vox` 一类短入口只能由用户在本机显式启用并通过冲突检查，发布者不能默认获得该命名权。斜杠命令只负责把输入解析为规范 CLI Command、Agent Intent 或 Runtime Capability 请求，不得成为第二套执行后端，也不得直接展开为任意 Shell 或 HTTP；现有机器可读 Command Registry 继续作为原子 CLI 命令的权威来源。
