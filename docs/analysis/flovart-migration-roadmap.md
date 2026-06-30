# Flovart 重构迁移路线图

> 决策基线 (用户 2026-06-29 拍板):
> 1. **Canvas**: 推翻 Konva/SVG, 另起 Magic Canvas (照 jaaz)
> 2. **Workflow**: 全量对齐 LibTV, 含 Agent Skills 开放
> 3. **后端**: 保留 hub + enterprise 两服务, 补 basketikun 同款能力
> 4. **授权**: 全仓前端可自由删改, 后端逐项请示
> 5. **联网**: 开干前再深挖参照源码一轮 (已完成, 三份分析落盘 `docs/analysis/`)
>
> 参照分析:
> - `docs/analysis/jaaz-magic-canvas-analysis.md` (977 行)
> - `docs/analysis/infinite-canvas-analysis.md` (278 行)
> - `docs/analysis/libtv-experience-analysis.md`

---

## 0. 现状盘点(动手前必读)

### 0.1 可保留(直接复用,不动)

| 资产 | 位置 | 价值 |
|------|------|------|
| Provider 适配层 | `services/aiGateway.ts`、`utils/providerAdapterRegistry.ts` | 12+ Provider + RunningHub, 价值最高 |
| R2 上传服务 | `backend/storage/r2.go` + `service/upload_service.go` | 已通, LibTV OSS 同构 |
| Hub 提示词生态 | `backend/hub/...` | 已通, Agent Skill 协议要叠加 |
| Enterprise 组织管理 | `backend/enterprise/...` | 已通, 不动 |
| Flovart CLI / MCP | `tools/flovart/cli.js`、`skills/flovart/` | 23 工具 schema 要扩到 LibTV 范式 |
| localforage 持久化 | `utils/boardPersistence.ts`、`hooks/useIdbImageResolution.ts` | 离线形态保留 |
| CanvasFixedOverlay | `components/canvas/CanvasFixedOverlay.tsx` + `utils/canvasOverlayViewport.ts` | overlay 迁出方案, Magic Canvas 复用 |
| ElementToolbar / PromptBar | `components/canvas/ElementToolbar.tsx`、`PromptBar.tsx` | 选元素后浮动工具栏, Magic Canvas 直接复用 |
| Framer Motion 弹性动效 | Workflow 节点动效 | 已写, 保留 |
| React Router 7 + RouterHost | `RouterHost.tsx` | HashRouter 兼容 Tauri/GH Pages, 保留 |

### 0.2 删除/隔离(本轮推翻)

| 资产 | 位置 | 处置 |
|------|------|------|
| Konva 渲染路径 | `components/canvas/Konva*`、`components/KonvaDemoPage.tsx` | 已删 KonvaDemoPage, Konva 渲染分支本轮下线 |
| SVG `<foreignObject>` Canvas | `App.tsx` 主体 + `components/canvas/*SVG*` | 推翻, Excalidraw 替代 |
| Excalidraw Phase A 托管 | `?excalidraw=1` dev 路径 + `FlovartExcalidrawStage` | 保留底层 adapter, 上提到主路径 |
| 旧 Workflow 重写版 | `components/workflow/*` + App.tsx workflow 分支 | 大改, 加 LibTV 节点字段 + Script 节点 |

### 0.3 新增(本轮新建)

| 资产 | 位置 |
|------|------|
| Magic Canvas 主路径 | `components/magic/` 新目录 |
| Excalidraw adapter | 复用 `utils/excalidrawAdapter.ts` + 扩展 |
| Agent Chat 主交互 | `components/agent-chat/` 新目录 |
| SSE 流式协议 | `services/sseClient.ts` |
| Workflow LibTV 字段 | 扩展 `types/workflow.ts` + `stores/workflowStore.ts` |
| Script 节点 + 9/25 帧分镜服务 | `backend/hub/service/storyboard.go` |
| 角色三视图服务 | `backend/hub/service/character_sheet.go` |
| 摄影机/光线参数注入 | `backend/hub/service/camera_params.go` |
| 关键帧拼成片 | `backend/hub/service/video_stitch.go` |
| 创作后端 Agent | `backend/hub/service/creative_agent.go` |
| Agent Skill 协议层 | `backend/hub/handler/agent_skill.go` + `tools/flovart/skills/` |
| 画布项目 GORM 表 | `backend/hub/model/canvas*.go` |

---

## 1. 阶段划分(按依赖顺序)

### Phase 1: Magic Canvas 重构 (前端, 2-3 周)

**目标**: 用 Excalidraw 替换 Konva/SVG, 实现 jaaz 风格的"选元素 → 截图 → AI 生成"闭环。

**步骤**:

1.1. **Excalidraw 主路径化**
- 把 `?excalidraw=1` dev 路径的 `FlovartExcalidrawStage` 上提到主路径, 替换 `App.tsx` 中的 SVG Canvas 渲染分支
- 保留 `utils/excalidrawAdapter.ts` (Flovart ↔ Excalidraw 双向转换)
- 删除 `components/canvas/Konva*`、SVG `<foreignObject>` 主体渲染
- 保留 `CanvasFixedOverlay` portal 机制, 重新挂到 Excalidraw 容器

1.2. **Magic Generate 入口** ✅ 已完成（待用户测试）
- 复用 jaaz `pop-bar/CanvasMagicGenerator.tsx` 模式: 选中 ≥2 元素时显示浮动按钮 ✅
- 触发链: `exportToCanvas()` → `canvas.toDataURL()` → 创建 Flovart `ImageElement`(href=dataUrl) → `commitAction` 加入画布 → `handleGenerate` 用新元素 ID 做 `mentionedElementId` ✅
- 底部 PromptBar 范式: 选中任意元素 + 写 prompt + @ 引用 → `onGenerate` → `handleGenerate` ✅
- 截图会留在画布上作为新 ImageElement（按用户拍板的设计决策）✅
- ~~快捷键 Cmd+B (jaaz 同款)~~ → 后续 Phase 补充
- ~~SSE POST 到 `/api/magic`~~ → 当前直接走前端 `handleGenerate`，SSE 协议在 Phase 1.3-1.4 接入

1.3. **Add to Chat 入口** ✅ 已完成
- pop-bar 在选中 1 个图片元素时显示"加入对话"按钮（与 Magic Generate ≥2 互斥）✅
- FlovartExcalidrawStage 新增 `onAddToChat` prop + `handleAddToChat`(resolveHref → dataUrl 回调) ✅
- App.tsx state lifting: `pendingChatAttachments` state + `setPendingChatAttachments` ✅
- 数据流: Stage → onAddToChat → App.tsx state → RightPanel → Chat → ChatTextarea(useEffect 合并附件 + onConsumeAttachments 清空) ✅
- 快捷键 Cmd+Enter — 待后续补充

1.4. **Agent Chat 主交互** ✅ 已完成（待用户测试）
- 新建 `components/agent-chat/` 目录: Chat.tsx (主面板) + ChatTextarea.tsx (输入) + ChatMessage.tsx (消息) ✅
- 前端编排: 直接调 `/chat/completions` + `tools` + `stream:true`（API Key 不离开浏览器）✅
- 13 工具定义（读类 3 + 创建类 3 + 编辑类 4 + 视口类 1 + 生成类 2），模仿 infinite-canvas 在线助手 ✅
- Tool-Calling 循环: 最多 4 步, 首轮 `tool_choice:"required"`, `parallel_tool_calls: false` ✅
- 流式渲染: `delta.content` 文本增量 + `delta.tool_calls` 工具调用卡片 ✅
- compactSnapshot 上下文注入: 元素列表 + 选区 + 视口 ✅
- confirmTools 人工确认开关（默认自动执行）✅
- 会话日志 localStorage 持久化 ✅
- RightPanel agent tab 替换为新 `<Chat>` ✅
- `services/agentChatStream.ts`: SSE 流式 + provider 解析复用 aiGateway ✅

1.5. **保留复用 overlay**
- `ElementToolbar` (AI 动作: Split/Upscale/RemoveBG/Outpaint/Mask/ReversePrompt) 直接挂到 Excalidraw 选中元素
- `PromptBar` (`@` 引用 + 模型 + 批量 + 停止 + 重试) 挂到生成中节点
- `canvasOverlayViewport` 的 `placeOverlay` 四向翻转 + clamping 不动

**验收**: 用户可在 Excalidraw 画布上画草图 + 选中 + Cmd+B 触发 AI 生成, 结果回写到画布; 选中图片 + Cmd+Enter 加入 Agent Chat 对话上下文。

---

### Phase 2: Workflow LibTV 全量对齐 (前端 + 后端, 3-4 周)

**目标**: 在已有 Workflow 节点流上加 LibTV 节点字段 + Script 节点 + 20+ 专业控制(优先 5 个)。

**模块化分析文档**: `docs/analysis/libtv-modules/` (10 模块 + 总览, 2026-06-29 落盘)
- 01 画布+节点+工作流 / 02 Script 脚本节点 / 03 Slash 命令 / 04 图像工具 / 05 视频工具
- 06 导演台 / 07 音频工具 / 08 图像生成器 / 09 视频生成器 / 10 模型清单
- **Script 节点已拍板放 Workflow 侧**作为第 6 种节点类型
- **分 5 子阶段**: 2.1(01+02) → 2.2(03+08+09) → 2.3(04+05) → 2.4(06+07) → 2.5(10)

**步骤**:

2.1. **节点模型扩展** (前端)
- `types/workflow.ts`: `CanvasNodeType` 扩展 `Script` 枚举值
- `CanvasNodeData.metadata` 加 LibTV 字段: `nodeSubtype / camera / lighting / gridSpec / characterRefs / scriptBreakdown / stitchFrom`
- `NODE_SPECS` 补 Script 节点初始 metadata

2.2. **Script 节点 UI**
- 新建 `components/workflow/ScriptNode.tsx`: 双击空白 → 选 "脚本节点" → 选模式 (剧本→分镜 / 视频→分镜 / 角色→分镜)
- 表格 UI: 双击编辑, 右键替换/删除参考图, 上传角色图 / 风格参考
- 全屏按钮: 表格全屏编辑
- "生成"按钮: 调 hub `POST /api/storyboard/breakdown` (新建), 返回 shots 数组

2.3. **摄影机/光线参数面板**
- `components/workflow/CameraPanel.tsx`: camera (Sony Venice/ARRI/RED) / lens / focalLength / aperture / cameraMove (push/pull/pan/tilt/dolly)
- `components/workflow/LightingPanel.tsx`: preset / intensity / temperature + "电影级光影校正" 一键按钮
- 挂到 Image/Video 节点的 ElementToolbar

2.4. **9/25 帧分镜网格**
- `components/workflow/StoryboardGrid.tsx`: 选择 3×3 或 5×5 模板
- 调 hub `POST /api/storyboard/grid` (新建), 传 prompt + rows + cols
- 结果: 1 个图片组根节点 + N 个子节点, 自动连线到 Script 节点

2.5. **角色三视图**
- `components/workflow/CharacterSheet.tsx`: 上传 1 张角色图 → 调 hub `POST /api/character/three-view` (新建)
- 输出 3 个图片节点 (前/侧/后), 自动打上 `characterRefs` 标签
- 后续生成节点选中时, 自动把 characterRefs 注入参考图

2.6. **关键帧拼成片**
- 多选视频节点 → 右键 "拼成片" → 调 hub `POST /api/video/stitch` (新建), 传 videoUrls 数组
- 后端 ffmpeg concat, 返回最终视频 URL, 创建新视频节点

2.7. **8 CanvasAgentOp 适配**
- 把 basketikun 的 8 种 op (`add_node / update_node / delete_node / delete_connections / connect_nodes / set_viewport / select_nodes / run_generation`) 写到 `utils/workflowAgentOps.ts`
- 这是 Agent(在线 + 本地) 改 Workflow 的唯一写入协议
- 在线助手 Tool-Calling 直接执行 op; 本地 Agent 通过 SSE 下发 op

2.8. **23 MCP 工具 schema**
- 把 basketikun `canvas-agent/src/schemas.ts` 的 23 个工具定义搬到 `tools/flovart/skills/canvas-tools.ts`
- 与现有 Flovart CLI registry 合并, 一份 schema 两处用 (在线助手 + MCP server)

**验收**: 用户可双击空白创建 Script 节点 → 输入一句话 → 一键拆分镜 → 9 宫格批量生成 → 选中角色图生成三视图 → 拼成最终视频。

---

### Phase 3: Agent Skill 双入口 (后端 + 前端工具, 1-2 周)

**目标**: 实现 LibTV 风格的"用户侧 Agent 不做创作, 只做传话"协议层。

**前置依赖**: Phase 2 的 `creative_agent.go` 必须先建好, 否则用户侧 Agent 会把弱模型带崩。

**步骤**:

3.1. **hub 新增 4 个 Agent Skill 端点** (后端, 需用户授权)
- `POST /api/v1/agent/session` — 创建会话 / 发消息
- `GET /api/v1/agent/session/:sessionId` — 查询会话消息(`?afterSeq=N` 增量)
- `POST /api/v1/agent/session/change-project` — 切换绑定项目
- 复用已有 `POST /api/v1/uploads/presign` + `confirm` 作为 file/upload 等价物

3.2. **创作后端 Agent** (后端, 需用户授权)
- `backend/hub/service/creative_agent.go`: 接住裸 prompt, 拆解任务, 调用 storyboard/character_sheet/camera_params/video_stitch 服务
- 用 Go 实现 LangGraph 风格的状态机 (或简单 FSM)
- 默认用强文本模型 (用户配的 Provider 中选最强的, 自动探测)

3.3. **Flovart 版 5 脚本** (前端工具)
- `tools/flovart/skills/agent-skill/`: `create_session.ts` / `query_session.ts` / `change_project.ts` / `upload_file.ts` / `download_results.ts`
- TS 实现, 用 `fetch` + `EventSource`, 不用 Python (Flovart 是 JS 生态)
- `SKILL.md` 系统提示照抄 LibTV 原文 "用户侧不做创作, 只做传话"

3.4. **轮询策略**
- 8 秒间隔, 增量 seq, 3 分钟超时, 单次重试 1 次, 连续 3 次失败停止
- 自动下载 + 语义前缀命名 (复用 `exportMediaArchive`)

3.5. **OpenClaw 规范兼容**
- SKILL.md frontmatter 加 `openclaw` metadata 字段
- 上 ClawHub (`openclaw skills install @flovart/agent-skill`)

**验收**: 外部 Agent (Codex/Claude/任意 OpenClaw 客户端) 一句话 "生成武侠打斗 30 秒短剧" → Flovart 后端创作 Agent 自动拆分镜 → 生成 9 帧 → 角色三视图 → 批量视频 → 拼成片 → 自动下载到本地。

---

### Phase 4: 后端补 basketikun 同款能力 (后端, 需逐项请示, 2-3 周)

**目标**: 把 basketikun 的画布助手 / 提示词聚合 / BYOK 中转能力下沉到 Go hub。

**步骤** (每步需用户单独授权):

4.1. **画布项目 GORM 落库**
- `backend/hub/model/canvas_project.go` / `canvas_node.go` / `canvas_connection.go`
- AutoMigrate 启动建表
- 同步更新 `docs/content/docs/backend/backend-database.mdx`
- 前端 `services/canvasApi.ts`: 项目 CRUD + 节点 CRUD + 连线 CRUD
- **决策点**: 离线形态是否仍主存 localforage, 在线形态才落库? (建议: 双写, localforage 优先读, 后端异步同步)

4.2. **AI Key 加密存储 + 后端代理**
- `backend/hub/service/apikey_vault.go`: AES-GCM 加密, 用户级密钥派生
- `backend/hub/handler/ai_proxy.go`: 透传 OpenAI / Gemini / Anthropic / RunningHub 请求
- 前端 `services/aiGateway.ts` 改为走 hub 代理, 不再直接持有 raw key
- **决策点**: 是否完全废弃前端直连? (建议: 保留"本地模式"开关, 默认走后端代理)

4.3. **提示词库聚合下沉**
- `backend/hub/service/prompt_library.go`: 抓 6 个 GitHub 仓库 (basketikun 同款) + DB 缓存 + etag
- `backend/hub/handler/prompt_library.go`: `GET /api/v1/prompts/library` 分页 + tag 过滤
- 前端 `services/promptApi.ts` 已有, 改 baseUrl
- 删除原 `web/src/app/api/prompts/route.ts` (若 Flovart 有同款)

4.4. **SSE 推送服务**
- `backend/hub/handler/sse.go`: `/api/v1/agent/stream` SSE 端点
- 推送事件: `delta / tool_call / image_generated / video_generated / done / error`
- 前端 `services/sseClient.ts`: EventSource 封装, 自动重连

4.5. **本地 Agent 桥接**
- 保留 `tools/flovart/agent/` (本机 Agent)
- 改为连 hub SSE 而非直接操作画布
- 兼容 Codex/Claude CLI (复用 basketikun `agents.ts` 范式)

**验收**: 用户登录后, 画布项目自动落库, AI Key 不再暴露在前端, 提示词库从 hub 加载, Agent Chat 通过 SSE 流式推送。

---

### Phase 5: 文档与发版 (1 周)

5.1. 三份分析文档已落盘 `docs/analysis/`
5.2. 更新 `docs/content/docs/progress/todo.mdx`: 移除本轮已完成项
5.3. 更新 `docs/content/docs/progress/pending-test.mdx`: 记录本轮可测试变更
5.4. `CHANGELOG.md` Unreleased 记录本轮重构
5.5. **不更新** `docs/content/docs/overview/features.mdx` 直到用户测试通过
5.6. 发版本时按 AGENTS.md 流程: 整理 Unreleased → 升 VERSION → 提交 → 打 tag

---

## 2. 关键技术决策(需用户拍板)

### 2.1 Magic Canvas 生成入口范式? ✅ 已拍板(2026-06-29)

**用户决策: 保留两种方式, 工具栏切换** —— 不二选一, 同时支持:
1. **jaaz 截图范式**: 选中 ≥2 元素 → `exportToCanvas` → `toDataURL` → SSE 生成 (适合"画草图+箭头描述+AI生成")
2. **PromptBar 范式**: 选中任意元素 + 写 prompt + `@` 引用 (适合精确控制, 复用现有 PromptBar)

工具栏放切换开关, 用户按场景选用。两种范式共享同一套 SSE 生成后端 + 结果回写 Excalidraw 逻辑。

### 2.2 Workflow 是新建 Script 节点还是用 basketikun config 节点扩展? ✅ 已拍板

**用户决策: 新建 Script 节点**。LibTV 用户体验上 Script 是一等公民, 与 config 混在一起会让 UI 复杂。

### 2.3 后端创作 Agent 用 Go 还是接 LangGraph.js? ✅ 已拍板

**用户决策: Go 自研 FSM**。Flovart 后端是 Go, 引入 Node/Python 子进程会破坏 monorepo 简洁性。LangGraph 核心是状态机, Go 200 行内可搞定。

### 2.4 离线形态是否保留 localforage 主存? ✅ 已拍板

**用户决策: 保留 localforage 主存 + 后端异步同步**。Flovart README 明确写"本地优先的 AI 创作工具", 双写: localforage 优先读, 后端异步同步。

### 2.5 Agent Skill 是否同时开放给 Codex/Claude CLI 和 OpenClaw? ✅ 已拍板

**用户决策: 同时开放 Codex/Claude + OpenClaw**。Flovart 已有 Codex/Claude 桥, 同时开放 OpenClaw 是 LibTV 双入口哲学。

---

## 3. 风险与避坑

1. **Excalidraw 适配 Vite + React 19**: ✅ 已验证通过(2026-06-29)。Excalidraw 0.18.1 官方 peer deps 支持 `^19.0.0`, PR #9182 已合并, Flovart 已装 `@excalidraw/excalidraw@^0.18.1` + `react@^19.1.1` 且 Phase A 托管 `FlovartExcalidrawStage` 已工作。唯一待补: `vite.config.ts` 加 `optimizeDeps.esbuildOptions.target: 'es2022'` (Excalidraw 0.18 locale ESM 导出要求)。radix-ui peer 警告不阻塞安装。详见末尾"Phase 1.1 前置验证结果"。
2. **AntD v? 与 Excalidraw 主题冲突**: Excalidraw 自带主题, AntD v5/v6 token 要对齐, 否则双主题割裂。
3. **Magic Canvas 截图性能**: `exportToCanvas` 大画布会卡, 需限制选中元素数量或区域裁剪。
4. **SSE 鉴权**: hub 现有 JWT 中间件要适配 SSE (Authorization header 不能用, 改 query token)。
5. **创作 Agent 后端默认模型选择**: 用户 BYOK 可能配弱模型, 创作质量崩盘。需在文档强提示 + UI 默认选最强。
6. **LibTV 20+ 专业能力全抄成本**: 本轮只做 5 个最高价值 (角色三视图 / 9 宫格分镜 / 摄影机参数 / 关键帧拼成片 / 风格迁移), 其余 15+ 留到下轮。
7. **本地 Agent 与后端创作 Agent 职责重叠**: 本地 Agent (Codex/Claude 桥) 与后端创作 Agent (FSM) 都能改画布。需明确: 本地 Agent 走 23 工具协议改画布元素, 后端创作 Agent 走 Agent Skill 协议跑创作链路。两者不冲突。
8. **上下文有限**: 本轮每个 Phase 落盘后再开下一 Phase, 避免一次性重构失控。

---

## 4. 执行顺序建议

**本周 (Phase 1.1 + 1.2)**: Excalidraw 主路径化 + Magic Generate 入口。最小可见变化, 验证 Excalidraw + React 19 + Vite 适配。

**下周 (Phase 1.3 + 1.4)**: Agent Chat 主交互 + SSE 协议。打通"画布 ↔ 后端 ↔ Agent"闭环。

**第三周 (Phase 2.1 + 2.2 + 2.3)**: Workflow 节点字段扩展 + Script 节点 + 摄影机面板。LibTV 体验骨架。

**第四-五周 (Phase 2.4 + 2.5 + 2.6 + 2.7)**: 9/25 帧分镜 + 角色三视图 + 关键帧拼成片 + 8 op 适配。LibTV 专业能力 5 个。

**第六周 (Phase 3)**: Agent Skill 双入口。外部 Agent 一句话跑全链路。

**第七-八周 (Phase 4)**: 后端补 basketikun 能力, 逐项请示。

**第九周 (Phase 5)**: 文档 + 发版。

---

## 5. 立即可动的第一步

**Phase 1.1 — Excalidraw 主路径化**:

1. 读 `App.tsx` 找到 Canvas 渲染分支 (SVG/Konva)
2. 读 `components/canvas/FlovartExcalidrawStage.tsx` 现状
3. 把 `?excalidraw=1` 路径条件去掉, 直接渲染 FlovartExcalidrawStage
4. 删除 Konva 渲染分支 (用户已授权全仓前端)
5. 保留 CanvasFixedOverlay, 重新挂到 Excalidraw 容器
6. 验证: `npm run dev` 主路径显示 Excalidraw 画布, 旧 SVG/Konva 不再渲染

这一步风险最小, 可见性最高, 不动后端, 不动 Provider。

---

路线图完。5 个关键技术决策已全部拍板(§2 已标记 ✅)。本周从 Phase 1.1 开始, 兼容性已验证通过。

---

## 6. Phase 1.1 前置兼容性验证结果 (2026-06-29)

### 6.1 Excalidraw 0.18.1 + React 19.1.1 + Vite 6.2 兼容性: ✅ 通过

**证据链**:
1. **官方支持**: Excalidraw 0.18.x peer deps 明确声明 `react: ^17.0.2 || ^18.2.0 || ^19.0.0`。PR #9182 "chore: upgrade to react@19" 于 2025-02-25 合并, issue #8923 "Support for React 19" 同日关闭。
2. **Flovart 已装好**: `package.json:22` `@excalidraw/excalidraw@^0.18.1`, `package.json:40-41` `react@^19.1.1` / `react-dom@^19.1.1`, `package.json:60` `vite@^6.2.0`。
3. **Phase A 托管已工作**: `components/canvas/FlovartExcalidrawStage.tsx` 已实现 Flovart↔Excalidraw 双向 adapter + diff 同步 + 图片文件注册, `components/canvas/ExcalidrawInner.tsx:3` 已 `import '@excalidraw/excalidraw/index.css'`。
4. **当前入口**: `App.tsx:3378-3389` `?excalidraw=1` dev 路径条件渲染 `FlovartExcalidrawStage`, 否则走 `AppShell` (SVG/Konva)。

### 6.2 待补: vite.config.ts es2022 target

**问题**: `vite.config.ts:26-28` 当前 `optimizeDeps` 只有 `entries: ['index.html']`, 缺 Excalidraw 0.18 release notes 明确要求的 `esbuildOptions.target: 'es2022'`。Excalidraw 0.18 locale 改用 ES module 导出 `export { english as "en-us" }` ("Arbitrary module namespace identifier names"), Vite 默认 target 不支持, 会解析失败。

**补丁** (Phase 1.1 第一步执行):
```ts
optimizeDeps: {
  entries: ['index.html'],
  esbuildOptions: {
    target: 'es2022',
    treeShaking: true,
  },
},
```

### 6.3 不阻塞: radix-ui peer 警告

**现象**: excalidraw 0.18.0 内部 `@radix-ui/react-tabs@1.0.2` 等仅声明 `react: ^16.8 || ^17.0 || ^18.0`, 与 react 19 冲突, `npm install` 报 ERESOLVE warning (issue #9435 / #9253)。

**结论**: Flovart 已成功安装(package.json 有版本), 说明 npm 默认把 ERESOLVE 当 warning 不阻塞。维护者已在 nightly 修复, 0.18.1 stable 未含但仅警告。**不需要处理**, 若想消除警告可加 `.npmrc` `legacy-peer-deps=true` 或用 pnpm。

### 6.4 Phase 1.1 执行清单(确认版)

1. ✅ `vite.config.ts` 补 `optimizeDeps.esbuildOptions.{target:'es2022', treeShaking:true}`
2. ✅ `App.tsx` 去掉 `?excalidraw=1` dev 判断, 主路径直接渲染 `FlovartExcalidrawStage`（保留 AppShell 外壳）
3. ✅ 删除 `App.tsx` 中 SVG/Konva Canvas 渲染分支（原 3700-4543 行，843 行）
4. ✅ 删除 `components/canvas/KonvaCanvas.tsx` + `KonvaCanvasDemo.tsx`（`KonvaDemoPage.tsx` 此前已删）
5. ⏸️ `CanvasFixedOverlay` portal 重新挂到 Excalidraw 容器 → **Phase 1.5 已完成**（ElementToolbar 补回，viewport 通过 onViewportChange 暴露）
6. ✅ 保留 `utils/excalidrawAdapter.ts` + `ExcalidrawInner.tsx` + `FlovartExcalidrawStage.tsx`（新增 `onSelectionChange` prop）
7. ⏳ 用户自测: `npm run dev` 主路径显示 Excalidraw 画布, 旧 SVG/Konva 不再渲染

**实际执行结果**: App.tsx 从 4549 行缩减到 3700 行。Excalidraw 现为 Canvas 主路径，AppShell 外壳不变。overlay（PromptBar/ElementToolbar/属性面板）随 SVG 移除，Phase 1.5 已补回 ElementToolbar。旧 SVG 交互变量保留在组件中（`noUnusedLocals` 关闭，不阻塞编译）。

**风险**: 最小。不动后端, 不动 Provider, 不动 adapter。只动渲染入口 + vite 配置 + 删旧文件。

### Phase 1.2 — Magic Generate 入口 + 底部 PromptBar ✅

**实际执行结果**: `FlovartExcalidrawStage` 新增 `bottomBar` prop + pop-bar（选中≥2元素→Magic Generate / 选中单图→加入对话）。App.tsx 传入 `<PromptBar>` 作为 bottomBar，新增 `handleMagicGenerate` handler。

### Phase 1.3-1.4 — Agent Chat 主交互（Tool-Calling 循环 + 13 画布工具）✅

**实际执行结果**: 新建 `services/agentChatStream.ts`（SSE 流式 + tools）、`components/agent-chat/Chat.tsx`（13 工具 + Tool-Calling 循环 + executeTool）、`ChatMessage.tsx`、`ChatTextarea.tsx`。RightPanel agent tab 条件渲染新 Chat 或回退旧 AgentChatPanel。

### Phase 1.5 — Overlay 适配 Excalidraw viewport + ElementToolbar 补回 ✅

**实际执行结果**:
- `canvasOverlayViewport.ts` 无需重写——早已 viewport 无关设计（`CanvasViewport { zoom, panScreenX, panScreenY }` 对 Konva 和 Excalidraw 均适用）。
- `FlovartExcalidrawStage.tsx` 新增 `onViewportChange` + `containerRef` props，在 `handleSceneChange` 中回调视口、ref 附着到 `.excalidraw-container`。
- App.tsx 新增 `excalidrawViewport` state + `excalidrawContainerRef` ref，`canvasViewport` 通过 `useMemo` 转换（`panScreenX = scrollX * zoom`），`canvasContainerRect` 改用 Excalidraw 容器 ref。
- 新建 `handleGroupSelection` + `handleExportSelection`；`<ElementToolbar>` JSX 补回，通过 `placeOverlay` + `CanvasFixedOverlay` 定位，传入 `viewport={canvasViewport}` + `containerRect={canvasContainerRect}`。
- 未补回：inpaint 蒙版 prompt（需重新设计交互）、stageLabel（Phase 2 视频工具范畴）、属性面板/文本编辑（Excalidraw 自带）。
