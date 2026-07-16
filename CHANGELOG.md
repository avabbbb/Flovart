# Changelog

## Unreleased

- CanvasSettings 模型 Tab 新增 per-Key 产品模型映射编辑器（A 方案）：顶部保留 ModelPreference 三选下拉，下方按 API Key 分组平铺 `mergeSuggestedMappings` 合并后的映射行，每行可改 `upstreamModelId`（input+datalist 候选）/`priority`/`enabled`（生效/启用/停用三态）/删除，底部从 `getProductModels` 候选新增映射；改动后自动置 `confirmed=true`，经 `handleUpdateApiKey` 持久化并参与 `resolveProductModelRoute` 路由。
- PromptBar 触发 chip 与浮层全面扁平化：删除独立「高级」chip 入口，联网搜索/真人素材预检测合并进「更多」popover 顶部分段；popover 去掉 `PopoverHeader` 卡片标题与 `rounded-[24px] border bg-card/95 shadow-2xl backdrop-blur-xl` 卡片背景，改用 `isl-pop` 基础浮层 + 内联段标题；model/submode/parameters/batch 动作 chip 去掉 chevron SVG 与 `isl-chip` 胶囊，改无边框文本 + 轻-hover `triggerClass`，`ExpandPanel` 类型移除 `'advanced'`。
- 视频生成 PromptBar 三面板（模式 chip / 时长 / 比例·分辨率·帧数）改为按模型能力灰显：不支持项统一 `disabled + opacity-35 + cursor-not-allowed` 并带 tooltip 说明原因；submode 面板改按 `VIDEO_MODE_ORDER` 全量渲染，chip 入口去掉 `activeProductModel` 硬依赖改由 `getRoutedVideoModes` + StatefulWidget 路由决定可见性。新增 `explainUnsupportedVideoMode()` 与 `paramDisabledReason()` 两个 helper 函数支撑 tooltip 文案生成。
- Workflow 视频节点新增首/尾帧导出工具：`WorkflowNodeToolbar` 追加 `ArrowUpToLine` / `ArrowDownToLine` 两个按钮，点击后经新增 `services/videoFrameExtractor.ts`（`<video>` + `canvas.drawImage` 客户端截帧，不依赖 ffmpeg.wasm）抽首帧或尾帧，`ingestWorkflowMedia` 落地后在视频节点左右两侧生成图片节点并自动建立 video→image 连线；`InfiniteWorkflow` 该处理回调改用 `pushHistory + patchProject` 直接写 nodes/connections，避免早先 `useCallback` 闭包中 `applyOps` TDZ 报错。
- 新增 xAI Grok Imagine Video Provider 完整适配：`productModelCatalog` 落地 `flovart:grok-imagine-video` 与 `flovart:grok-imagine-video-1.5` 两条目录（modes `text-to-video` / `image-to-video` / `video-extension`；7 比例；durations `1/3/5/8/10/15`；resolution `720p`/`1080p`）；`aiGateway` 新增 xai 分支，按 `POST /v1/videos/generations`（文生 / 图生）/ `POST /v1/videos/extensions`（扩展）/ `GET /v1/videos/{request_id}` 异步轮询链路实现，Bearer 鉴权，默认 Base URL `https://api.x.ai/v1`；`AIProvider` union 与 `inferProviderFromKey` / `inferProviderFromModel` / `PROVIDER_LABELS` / `PROVIDER_VIDEO_RATIOS` / `DEFAULT_BASE_URLS` / `DEFAULT_PROVIDER_MODELS` 同步扩展。
- Gemini 图像产品收口：`productModelCatalog` 新增 `gemini-3.1-flash-image`（NB 2，15 比例 + `refs=[0..14]`）、`gemini-3.1-flash-lite-image`（NB 2 Lite，极速）与 `imagen-4`（已弃用，仅文生图且 `maxImageReferences=0`）三条目录；`DEFAULT_PROVIDER_MODELS.google.image` 移除 `gemini-2.5-flash-image`（NB 1），改为 NB 2 / NB 2 Lite / NB Pro / Imagen 4；`generateImageWithProvider` google 分支简化为 NB 系列统一走 `editImage` → `generateContent`（含 `refs=[]` 纯文生图）、Imagen 系列走 `generateImageFromText` → `generateImages`；`CanvasSettings` Google Visual Models 模板 `defaultModel` 改为 `gemini-3.1-flash-image` 并补全下拉列表。
- 收紧 Workflow 固定产品模型与 BYOK 路由：阻止未映射产品 ID 或未知裸媒体模型直达供应商，补齐映射有效性、多 Key 稳定选择、Google 分能力 Base URL 与扩展配置同步。
- 新增 `backend/enterprise` 独立企业服务：组织 + 部门树（邻接表 + 递归 CTE 权限继承）+ 部门级角色绑定 + 11 权限点 + builtin Owner/Admin 角色，复用 hub 的 PostgreSQL 与 JWT。
- 新增企业后台前端管理 UI（`/#/enterprise`）：成员名册（只读 + 增删）、部门管理（左树右面板，toggle 负责人/角色）、角色管理（权限 checkbox 网格，builtin 只读保护）三标签页。
- Tauri 桌面端改用 NSIS 打包，生成 `Flovart_0.2.0_x64-setup.exe`；新增 `flovart install/start/update` CLI 开发环境命令，`start` 一键拉起 vite + hub(:11452) + enterprise(:11453) 全栈并自动起 Docker PostgreSQL。
- 新增 Tauri 应用内自动更新：生成 Ed25519 签名密钥，`useUpdaterStore` 实现自动检查 + 手动更新（StudioTopMenu 按钮），`tauri-plugin-process` 支持更新后重启；新增 GitHub Actions `release.yml` 用 `tauri-action` 矩阵构建三平台安装包并发布 Release + `latest.json`。
- 恢复 Canvas 与 Workflow 双系统切换，并将 Canvas 还原到媒体节点连线改造前的行为。
- 按 `basketikun/infinite-canvas` 交互重构独立多项目 Workflow，补齐节点创建、媒体拖放、连线、PromptBar、ElementToolbar、图片工具、项目导入导出与素材选择。
- 接入现有 Provider、API Key、生成历史、取消/重试、结果节点和在线 Agent 流程。
- 统一 Workflow 浏览器 dispatcher、Flovart CLI、loopback Agent、MCP 和 Codex Agent 面板。
