# Changelog

## Unreleased

- 新增 `backend/enterprise` 独立企业服务：组织 + 部门树（邻接表 + 递归 CTE 权限继承）+ 部门级角色绑定 + 11 权限点 + builtin Owner/Admin 角色，复用 hub 的 PostgreSQL 与 JWT。
- 新增企业后台前端管理 UI（`/#/enterprise`）：成员名册（只读 + 增删）、部门管理（左树右面板，toggle 负责人/角色）、角色管理（权限 checkbox 网格，builtin 只读保护）三标签页。
- Tauri 桌面端改用 NSIS 打包，生成 `Flovart_0.2.0_x64-setup.exe`；新增 `flovart install/start/update` CLI 开发环境命令，`start` 一键拉起 vite + hub(:8080) + enterprise(:8081) 全栈并自动起 Docker PostgreSQL。
- 新增 Tauri 应用内自动更新：生成 Ed25519 签名密钥，`useUpdaterStore` 实现自动检查 + 手动更新（StudioTopMenu 按钮），`tauri-plugin-process` 支持更新后重启；新增 GitHub Actions `release.yml` 用 `tauri-action` 矩阵构建三平台安装包并发布 Release + `latest.json`。
- 恢复 Canvas 与 Workflow 双系统切换，并将 Canvas 还原到媒体节点连线改造前的行为。
- 按 `basketikun/infinite-canvas` 交互重构独立多项目 Workflow，补齐节点创建、媒体拖放、连线、PromptBar、ElementToolbar、图片工具、项目导入导出与素材选择。
- 接入现有 Provider、API Key、生成历史、取消/重试、结果节点和在线 Agent 流程。
- 统一 Workflow 浏览器 dispatcher、Flovart CLI、loopback Agent、MCP 和 Codex Agent 面板。
