# Changelog

## Unreleased

- Agent 视频流水线 P0（实验性）：13 条 pipeline 命令（run / 素材 / TTS / 转写 / 对齐 / 合成修订 / 渲染 / 探测 / 抽帧 / 评审 / 归档），命令边界自动记 trace，评审 → 定向修补（locked 片段不变）→ 重渲染可端到端跑通（`npm run e2e:pipeline`）。
- 流水线 trace 迁入桌面 Runtime 共用的 `flovart-state.db`（migration 5，表名 `pipeline_*`）；Rust Runtime 新增只读 `pipeline.run.get`，与 Node 输出逐字段一致（`npm run e2e:pipeline:parity`）；agent 新增只读 `GET /pipeline/runs`、`/pipeline/runs/:id`、`/pipeline/artifacts/:id`。
- 流水线新增 `capture.ui`：本机无头浏览器打开 localhost 页面按步骤截图或录屏，产物直接进 run；pipeline 命令同时投影为 MCP 工具（`flovart_capture_ui` 等），Skill 增加流水线命令文档。
- 流水线 Remotion 引擎支持文字层、底部字幕与音频轨（音乐随人声闪避），中文字体优先；`npm run e2e:pipeline:remotion` 端到端验证。
- Canvas 抽屉“运行日志”新增视频流水线 run 卡片（状态、版本、评审结论、逐步 trace）；“放到画布”把各版本渲染收进同一组叠放，最新版本在最上面。
- 修复 Linux 构建：`rust-ini` 锁定 0.21.1（0.21.3 与 `tauri-plugin-deep-link` 2.6.2 不兼容）。
- 本地文件夹重新授权后自动重读画布节点，并通过 BroadcastChannel 同步其他标签页；权限失效节点提供“重新连接文件夹”。

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

- DSH 桌面端连接：bootstrap 接受 `dsh-app://` 协议代理（转发时会去掉 Origin/Sec-Fetch-Site），Workspace Operator 允许 `dsh-app://app` 交换 session；新增 `npm run dsh:desktop` 启动器，先复用/拉起 Workspace Operator 再打开 DSH Desktop（`--ensure-only` 只拉起 Operator）。
- 账号入口弹窗跟随应用深浅色主题（含 DSH 内嵌主题），文案改为账号生态探索中、多端同步后续更新，并加入 GitHub 点赞入口。
- Agent 确认卡重做：一句人话说明动作与对象（节点 ID 换成节点标题，不再显示 `workflow.node.delete：…` 这类内部文本），费用明细收进「详情」；「允许」为唯一主按钮，授权范围用一个下拉选择「仅这次 / 本次对话 / 始终允许此类操作」。删除只能逐次确认，付费生成与付费工具最多到「本次对话」（生成仍受任务上限约束），「始终允许」只覆盖可逆操作，存本机并可在模式菜单撤销；Esc 拒绝；颜色变量带兜底，挂到任何容器都不会透明。
- 内置 Agent 新增 `flovart_workflow_node_tool`：与节点工具条同一实现，可直接截取视频任意秒数的帧（position=current + currentTimeSec）、剪辑、音视频分离、拼接、裁剪、放大、去背景等；工具清单从 Operation 注册表生成，后续新增工具自动对 Agent 可用。`workflow.node.tool` 结果新增 `outputNodeIds`；补齐 Agent 路径上的 `audio-stem-split` 与音视频分离的 `audio` 参数。
- Agent 对话：用户气泡不再显示发给模型的引用上下文（nodeId、附带画面说明），工具卡标题改为「读取画布」「查看画面」等人话。
- Canvas 空状态：按钮不再换行溢出，「图片节点」为唯一主按钮，示例画布改为一行文字链接；去掉虚线框与彩色按钮；点阵淡化、间距 24px。
- 逆向生产渲染：ProductionSpec V1 从 Reverse 项目派生镜头帧窗口与资产，Remotion Player 与 Node 渲染共用同一合成；`node scripts/render-production.mjs --spec spec.json --out out.mp4` 已冒烟输出 320×180 / 20 帧 / 2s H.264。
- Agent 沙箱确认卡：画布外抽屉补齐 workflow 颜色变量作用域（此前背景透明、确认内容与消息和输入框互相透叠）；计划卡恢复网格布局，操作按钮可换行，长内容在卡片内滚动；确认卡改为输入框上方的独立占位，不再覆盖输入区。
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
