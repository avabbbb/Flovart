# 云端使用 Go，本地制作扩展 Tauri Runtime

Flovart 的 Go 服务继续作为云端 Hub 与 To B 管理面，负责账号、UGC、组织、额度、审批和公共资源，不承接个人本地 ProductionRun。可靠本地制作扩展现有 Tauri/Rust Desktop Runtime，复用 SQLite WAL、系统 Keyring、本地 HTTP 和打包能力；Production Skill、Provider Adapter、CLI、MCP 与 Codex Bridge 继续使用 TypeScript/Node。`flovart-host` 保持 Chrome Native Messaging 转发器职责，不再新增本地 Go 守护进程，也不在 Rust 中重写全部 Provider 协议。
