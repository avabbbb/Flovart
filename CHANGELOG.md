# Changelog

## 0.3.0 — Closed beta / 内测版 (2026-11-06)

- Canvas 多标签页：用 navigator.locks 选出唯一写入标签页，其余标签页只读；只读页不落盘、不清理媒体、不接管中断节点，避免互相覆盖或误删刚生成的媒体。
- Canvas 持久化：保存失败时常驻提示，可重试或导出项目；配额不足单独提示。
- Agent：未完成的工具调用自动补“已取消”结果，停止或中断后可继续对话；停止时关闭待确认卡；workflow.apply 含删除节点时与单独删除一样需要确认。
- API Key 加密存储 v2：密钥派生不再依赖 userAgent，浏览器升级后仍可解密；解密失败时保留原密文，不再被空列表覆盖。
- 删除 Agent 离线浏览模式与武侠风示例模板。
- 逆向工作台暂时显示「正在优化，后续上线」，代码与已保存数据保留；登录 / 注册显示「内测版本，账号功能后续更新」。
- 版本号统一为 0.3.0（package.json / tauri.conf.json / Cargo.toml）。

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

- Agent 沙箱确认卡：画布外抽屉补齐 workflow 颜色变量作用域（此前背景透明、确认内容与消息和输入框互相透叠）；计划卡恢复网格布局，操作按钮可换行，长内容在卡片内滚动。
- Reverse 替换 Table：顶栏改为 Canvas | 逆向 | Agent；services/reverse/ 按 Hypit 架构分层自行实现（temporal / evidence / narrative / align / projection / caption / composition），不引入 Hypit 代码；旧数据里的 'table' 视图自动迁移为 'reverse'（workspace store v3）。
- Canvas 子画布：新增 subgraph 节点与可选 parentId（Workflow 持久化 v2）；逆向一键「转为画布 / 同步到画布」，一次 workflow.apply，同步保留画布上调整过的位置、尺寸与已选版本；支持折叠、整体拖动（含多选）、整体删除，双击回到对应逆向工程。
- 逆向台词与镜头时长：台词保留原文标点与连字符；无 cue 时镜头边界吸附到句末，镜头时长随句子调整。
- 逆向撤下游戏素材方向：Reverse 只保留视频逆向（Hypit 流程）；删除游戏台账 / 风格圣经 / 相似度门面板与服务，旧 game 工程在 reverse store v3 迁移时丢弃。
- 逆向面板改为渐进式披露：参考 → 拆解 → 目标稿 → 替换与变体 → 画布 5 步；镜头表生成前后 3 步只显示标题和解锁条件，新解锁的步骤自动展开；重新进入工程时，当前步之前已完成的步骤折叠为一行摘要，点标题可展开 / 收起。
- README 精简：中英文 README 只保留 60 秒宣传片，删除旧截图、GIF 与录屏素材。
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
