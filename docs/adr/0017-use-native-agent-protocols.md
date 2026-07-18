# 使用 Codex 与 OpenCode 原生协议

Codex Adapter 以 `codex app-server` 的 stdio JSON-RPC/JSONL 作为主传输，使用官方 Thread、Turn、流式事件、审批和中断协议；`codex exec --json` 只作为能力不足或协议不兼容时的显式降级路径。OpenCode Adapter 使用官方 TypeScript SDK 管理绑定在 `127.0.0.1` 随机端口的本地 Server，通过随机 Basic Auth 密码保护连接，并使用类型化 Session API 与 SSE 事件流。两个 Adapter 启动时都必须执行 Agent Protocol Handshake，校验宿主版本、健康状态和必需能力；禁止解析交互式 TUI 或 ANSI 文本，也不得自动升级用户安装的宿主。
