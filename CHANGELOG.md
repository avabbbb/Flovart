# Changelog

## 0.2.0 — Closed beta / 内测版 (2026-10-19)

- Canvas: align, distribute, duplicate (Ctrl/Cmd+D), arrow-key nudge with one undo entry per held key, pane context menu, Alt+Shift+F auto layout, F to focus the selection.
- Fix Delete inside dialogs and menus removing canvas nodes; flush pending project writes on pagehide.
- Coalesce wheel pan/zoom into one viewport write per animation frame.
- Add a local, redacted, offline crash log and AppErrorBoundary with diagnostics export.
- Gate GitHub Pages deploys on npm ci, docs:check, tsc and tests; unify the version to 0.2.0 across all release sources.

## 0.1.0-beta.2 — Closed beta / 内测版 (2026-10-15)

- Restore the Flovart product name across Canvas, Table, Agent, desktop, host panels and current documentation; preserve persisted IDs and protocol compatibility.
- Consolidate the shell, documentation, Workflow run-state/version/handoff, Resolve Inspector and non-blocking Canvas simplification PRs into main.
- Add the 60-second concept film and bilingual, outcome-first README; distinguish the vision from verified capabilities.
- Automatically build Windows x64 EXE and macOS Apple Silicon / Intel DMGs on main; tagged builds are published only after release and security checks.
- This is a prerelease. Creative hosts remain Experimental and paid-provider certification remains pending. macOS uses ad-hoc signing, without Apple notarization; Windows Authenticode is not configured. This version resets the public beta numbering and is not an automatic downgrade from 0.3.x previews.

## Unreleased

- Canvas 图层 / 导出 / 快照（参考 ComfyArt）：图层面板支持重命名、显隐、锁定、排序；工具箱可将选区或整张画布导出为 PNG / PDF（零依赖 PDF 封装，超大画布自动降倍率）；历史菜单支持命名快照保存、恢复（走普通 mutation，可撤销）、删除，每项目最多 30 个，快照引用的媒体不会被清理；菜单、选中态增加轻量过渡动画并尊重 prefers-reduced-motion。
- **Docs canonicalization**：把 current product truth 收敛为 7 份核心文档；旧 Agent/Crew/Production Skill/ecosystem/responsive 多代设计蒸馏为单一 historical snapshot，避免 coding agent 从旧稿反向推导产品。
- **Three-surface IA**：Canvas | Table | Agent 为当前顶栏；Agent 只做本地/外部 Coding Agent connection hub；Canvas/Table 右侧保留 Assistant / Context / History。
- **Container-driven Studio layout (#15)**：Studio shell、Workflow、Assistant drawer 与 Table 按容器重排，移除旧 drawer inset math 与 viewport-specific patches。
- **Agent connection hub (#13)**：恢复顶级 Agent surface，同时避免在 Agent 页复制内置 Assistant。
- **README product truth**：中英文 README 与当前 IA、Agent Integration Skill、Support Matrix 口径统一。
- **Browser video/audio tools**：ffmpeg core 使用正确 ESM / core-mt worker 路径并规避 Vite worker 预打包问题。
- **Agent Link bootstrap**：Host discovery 区分 fast/deep probe 并加入短 TTL，避免冷启动探针超时。
- **Real Codex gate**：真实 `codex exec` Golden Task 已有连续通过证据；公开安装包首次启动、真实 Provider 与登录恢复仍是外部门禁。
- **FlovartBench v0.1**：系统级 Agent/Workflow/Runtime eval harness 已建立；外部 Agent 与真实 Provider 结果仍按实测状态分别认证。
- **Release hardening**：Hosted CI、dependency/security、package/signing 与真实 Creative Host/Provider 继续按 Support Matrix / pending-test 作为发布门禁。

历史施工流水由 Git history 与 `docs/archive/historical-design/` 保存，不再继续堆入 Unreleased。
