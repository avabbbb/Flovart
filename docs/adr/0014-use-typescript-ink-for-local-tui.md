# 使用 TypeScript 与 Ink 实现本地 TUI

Flovart Terminal Command Center 使用独立的 TypeScript/Node + Ink package 实现，复用现有机器可读 Command Registry、CLI/MCP 类型和后续 Runtime Client，不在 TUI 中复制业务命令或生产状态。TUI 的 React/Ink 依赖与 Web 前端隔离并独立锁定，避免为了终端界面升级或约束 Web React。V1 不新增 Go TUI，也不使用 Rust 重写 Agent/命令交互层；Tauri/Rust 继续作为 Desktop Runtime，Go 继续用于云端 Hub 与 To B 后端。
