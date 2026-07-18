# CLI 按需启动 Desktop Runtime

CLI 与 MCP 在执行前自动发现 Desktop Runtime，未运行时以 Runtime-Only Mode 启动已安装的 Tauri 应用；开机自启默认关闭。存在非终态 ProductionRun 时关闭窗口只隐藏到托盘，所有任务结束后才允许正常退出或空闲自动退出。需要 API Key、System Gate 或人工审片时返回 Action Required 与 `flovart://` deep link，由用户界面完成操作而不是让 Coding Agent 代为批准。
