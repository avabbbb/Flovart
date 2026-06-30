# Jaaz — Magic Canvas / Magic Video / Agent Chat 前端架构分析

> 分析对象: jaaz 仓库 (`react/` 前端 + `server/` Python 后端)
> 分析目的: 为 Flovart 画布产品提取可迁移架构与避坑点
> 所有事实均来自源码验证,附 file:line 引用

---

## 1. 顶层结构

### 1.1 Monorepo 布局

| 目录 | 技术栈 | 职责 |
|------|--------|------|
| `react/` | Vite + React 18 + TypeScript | 前端 SPA + Electron 渲染进程 |
| `server/` | Python + FastAPI + Socket.IO | 后端 API + AI 编排 + 数据持久化 |
| `electron/` | Electron | 桌面壳,`electron/main.js` 启动 |
| `asset/` | JSON | ComfyUI workflow 模板文件 |

根 `package.json` 定义 `start` / `dev` / `build:electron` 脚本与 Electron 入口。

### 1.2 前端技术栈 (`react/package.json`)

- **画布引擎**: `@excalidraw/excalidraw` v0.18.0 (`react/package.json:26`)
- **路由**: `@tanstack/react-router` v1 + `@tanstack/router-vite-plugin` (文件式路由 + 自动代码分割)
- **状态管理**: `zustand` (无 middleware) + React Context 包装层;`@tanstack/react-query` + `persist-client` 用 IndexedDB 做查询缓存 (`react/src/App.tsx:29-50`)
- **UI 库**: Radix UI primitives + `lucide-react` 图标 + `motion` (Framer Motion) 动效 + `ahooks` 工具 hooks
- **实时通信**: `socket.io-client` (流式事件) + `fetch` (REST 触发)
- **构建**: Vite,dev 端口 5174,server 端口 57988,`@` 别名映射到 `./src` (`react/vite.config.ts`)

### 1.3 后端技术栈 (`server/`)

- **Web 框架**: FastAPI + `python-socketio` (Socket.IO server)
- **AI 编排**: LangGraph + `langgraph_swarm` (多智能体 swarm 编排) + LangChain `@tool` 装饰器
- **LLM 接入**: `ChatOpenAI` / `ChatOllama`,基于 provider 配置动态选择
- **数据库**: `aiosqlite` 持久化到 `USER_DATA_DIR/localmanus.db`,带 schema 迁移管理 (`server/services/db_service.py`)
- **文件存储**: 资产文件存 `FILES_DIR` 文件系统,通过 `/api/file/{file_id}` 端点提供 (`server/routers/image_router.py:148-154`)

### 1.4 前后端通信协议

| 通道 | 用途 | 端点示例 |
|------|------|----------|
| REST POST | 触发聊天 / Magic 生成 | `/api/chat`, `/api/magic` (`chat_router.py:10,48`) |
| REST POST | 取消任务 | `/api/cancel/{session_id}`, `/api/magic/cancel/{session_id}` |
| REST CRUD | 画布管理 | `/api/canvas/list`, `/api/canvas/{id}/save` (`canvas.py:10-44`) |
| REST | 图片上传 / 文件服务 | `/api/upload_image`, `/api/file/{file_id}` |
| Socket.IO | 流式事件推送 | `delta` / `tool_call` / `image_generated` / `video_generated` / `done` / `error` |

REST 仅负责"触发",流式结果通过 Socket.IO 推送。`chat_router.py:10-26` 的 `/api/chat` 立即返回 `{"status": "done"}`,后台 `asyncio.create_task` 继续执行,通过 socket 推送 streaming events。画布创建同理: `canvas.py:14-22` 的 `/api/canvas/create` 内 `asyncio.create_task(handle_chat(data))` 后立即返回。

### 1.5 Socket.IO 事件类型 (`react/src/types/socket.ts:5-20`)

```
SessionEventType:
  Error | Done | Info | Delta | ToolCall | ToolCallArguments |
  ToolCallResult | ToolCallProgress | ImageGenerated | VideoGenerated |
  AllMessages | ToolCallPendingConfirmation | ToolCallConfirmed | ToolCallCancelled
```

`ImageGenerated` 事件携带 `ExcalidrawImageElement` + `BinaryFileData` + `canvas_id` + `image_url` (`socket.ts:37-43`),前端直接写入 Excalidraw scene。`VideoGenerated` 类似,额外携带 `duration` 字段 (`socket.ts:44-50`)。

### 1.6 数据持久化分层

| 层 | 存储位置 | 内容 |
|----|----------|------|
| 服务端 DB | `localmanus.db` (SQLite) | canvas 数据 / sessions / messages / settings / app_config |
| 服务端文件系统 | `FILES_DIR` | 上传图片 / AI 生成图片 / 视频文件 |
| 浏览器 IndexedDB | TanStack Query persist | API 查询缓存 (模型列表等) |
| 浏览器 localStorage | — | `text_model` / `disabled_tool_ids` / `system_prompt` / `agent-studio-graph` |

---

## 2. 前端模块清单

### 2.1 入口与路由

- `react/src/App.tsx` — `QueryClient` 配置 + IndexedDB `persistQueryClient` + `RouterProvider`
- `react/src/routes/` — TanStack Router 文件式路由,包含 canvas / chat / settings / material / knowledge / agent_studio 等路由

### 2.2 Contexts (`react/src/contexts/`)

| 文件 | 职责 | 关键 API |
|------|------|-----------|
| `canvas.tsx` | 包装 zustand canvas store 到 React Context | `useCanvas()` 返回 `{ canvasId, excalidrawAPI, setCanvasId, setExcalidrawAPI }` |
| `configs.tsx` | 拉取模型/工具列表,管理登录弹窗 | `useConfigs()`, `useRefreshModels()`;内部 `useQuery` 请求 `/api/models` (`configs.tsx:28-36`) |
| `socket.tsx` | Socket.IO 连接生命周期管理 | `SocketContext` 提供 `connected` / `socketManager`;dev URL `http://localhost:57988` (`socket.tsx:44-48`);重连上限 5 次 (`socket.tsx:138-144`) |
| `AuthContext` | 认证状态 | `useAuth()` 返回 `authStatus.is_logged_in` |

Context 模式统一: `createContext` 暴露 zustand store 的 hook 函数,消费方调用 `useCanvas()` 等即得 store 快照,避免层层透传 props。Context 内部可叠加副作用 (如 `configs.tsx` 内 `useQuery` + `useEffect` 拉取并设置模型列表)。

### 2.3 Stores (`react/src/stores/`)

`canvas.ts` (20 行):
- `canvasId: string` — 当前画布 ID
- `excalidrawAPI: ExcalidrawImperativeAPI | null` — Excalidraw 命令式 API 句柄

`configs.ts` (71 行):
- `textModels` / `textModel` — LLM 模型列表与当前选中
- `allTools` / `selectedTools` — 可用工具与已选工具
- `providers: { [key: string]: LLMConfig }` — provider 配置字典
- `showLoginDialog` / `showSettingsDialog` / `showInstallDialog` / `showUpdateDialog` — UI 弹窗状态

均为纯 zustand `create()`,无 Immer middleware,无 persist middleware。

### 2.4 画布组件 (`react/src/components/canvas/`)

| 组件 | 文件 | 职责 |
|------|------|------|
| 主画布 | `CanvasExcali.tsx` | 挂载 Excalidraw `Main`,注入 imperative API 到 store |
| 悬浮工具栏 | `pop-bar/index.tsx` | 监听 `excalidrawAPI.onChange`,选中元素时显示悬浮按钮,计算定位 |
| 工具栏容器 | `pop-bar/CanvasPopbarContainer.tsx` | `motion.div` 定位 + 入场动效 (opacity/y, 200ms easeInOut) |
| Add to Chat | `pop-bar/CanvasPopbar.tsx` | 选中图片时显示,emit `Canvas::AddImagesToChat`,快捷键 Cmd+Enter |
| Magic Generate | `pop-bar/CanvasMagicGenerator.tsx` | 选中 >= 2 元素时显示,exportToCanvas 转 base64 后 emit,快捷键 Cmd+B |
| 底部工具栏 | `menu/CanvasToolMenu.tsx` | hand / selection / rectangle / ellipse / arrow / line / freedraw / text / image (`CanvasToolMenu.tsx:20-32`) |
| 缩放控制 | `menu/CanvasViewMenu.tsx` | 右上角,10% / 50% / 100% / 150% / 200% + fit-to-content |
| 视频元素 | `VideoElement.tsx` | 画布内嵌视频播放器 (Excalidraw custom HTML element) |

### 2.5 聊天组件 (`react/src/components/chat/`)

| 组件 | 职责 |
|------|------|
| `Chat.tsx` | 主聊天 UI,Socket.IO streaming + tool_call 渲染 + magic 生成进度展示 |
| `ChatMagicGenerator.tsx` | 纯逻辑组件 (return null),监听 `Canvas::MagicGenerate` 事件,构建 Message 后 POST `/api/magic` |
| `ChatTextarea.tsx` | 输入框,监听 `Canvas::AddImagesToChat` / `Material::AddImagesToChat` 事件,插入图片引用 |

### 2.6 其他前端模块

| 目录/文件 | 职责 |
|-----------|------|
| `components/material/MaterialManager.tsx` | 本地文件系统素材浏览器,调 `/file_service` API 列文件,读 PNG 元数据 |
| `components/knowledge/Knowledge.tsx` | 知识库列表/切换页,调 `/api/knowledge/list` 分页查询 |
| `components/settings/AddProviderDialog.tsx` | Provider 配置弹窗,内置 Anthropic / OpenRouter / Wavespeed / Replicate 预设标签 |
| `components/comfyui/` | ComfyUI workflow 管理 UI |
| `components/agent_studio/AgentStudio.tsx` | **死代码** — ReactFlow 原型,localStorage 持久化,无路由挂载,无后端 API |
| `api/magic.ts` | `sendMagicGenerate` / `cancelMagicGenerate` 封装 |
| `api/knowledge.ts` | `getKnowledgeList` 分页查询 (`knowledge.ts:58-76`) |
| `api/model.ts` | `listModels` 拉取 `{ llm: ModelInfo[], tools: ToolInfo[] }` |
| `lib/event.ts` | mitt 事件总线,定义 `Canvas::AddImagesToChat` / `Canvas::MagicGenerate` / `Material::AddImagesToChat` |
| `lib/socket.ts` | `SocketIOManager` 封装,自动重连 (上限 5 次) |

### 2.7 事件总线模式 (`react/src/lib/event.ts`)

mitt 实例,三个核心事件:

- `Canvas::AddImagesToChat` — 选中图片元素后发送到聊天输入框
- `Canvas::MagicGenerate` — 选中 >= 2 元素截图后触发魔法生成
- `Material::AddImagesToChat` — 素材库图片发送到聊天输入框

事件总线解耦画布与聊天:画布组件只 emit,聊天组件只 listen,无直接 import 引用。Flovart 可直接复用此模式。

### 2.8 后端路由 (`server/routers/`)

| 文件 | prefix | 端点 |
|------|--------|------|
| `canvas.py` | `/api/canvas` | `GET /list`, `POST /create`, `GET /{id}`, `POST /{id}/save`, `POST /{id}/rename`, `DELETE /{id}/delete` |
| `chat_router.py` | `/api` | `POST /chat`, `POST /cancel/{session_id}`, `POST /magic`, `POST /magic/cancel/{session_id}` |
| `image_router.py` | `/api` | `POST /upload_image`, `GET /file/{file_id}`, `POST /comfyui/object_info` |
| `websocket_router.py` | — | Socket.IO `connect` / `disconnect` / `ping` 事件 |
| `comfyui_execution.py` | — | `execute()` 函数 + `WorkflowExecution` 类 (非路由,被 provider 调用) |
| `settings.py` | — | `/api/settings` 读写 |
| `tool_confirmation.py` | — | 工具调用确认 |

---

## 3. Magic Canvas 交互机制

### 3.1 触发条件

`pop-bar/index.tsx:21-105` 注册 `excalidrawAPI.onChange` 回调,每次画布变化时:

1. 读取 `appState.selectedElementIds`,空则隐藏弹窗 (`index.tsx:23-28`)
2. 过滤出选中的 image 元素 (`index.tsx:30-32`)
3. `showAddToChat` = 选中图片数 > 0 (`index.tsx:35-36`)
4. `showMagicGenerate` = 选中元素总数 >= 2 (`index.tsx:39-40`)
5. 两者均不满足则隐藏 (`index.tsx:43-46`)

关键阈值: **>= 2 个任意类型元素** 触发 Magic Generate,不限于图片。单独选中 1 个图片元素只显示 Add to Chat,不显示 Magic Generate。

### 3.2 悬浮工具栏定位

`index.tsx:68-103` 计算悬浮栏位置:

- 若有选中图片: `centerX` = 图片中心 X 均值,`bottomY` = 图片底部 Y 最大值
- 否则: `centerX` = 所有选中元素中心 X 均值,`bottomY` = 底部 Y 最大值
- 映射到屏幕坐标: `offsetX = (scrollX + centerX) * zoom`,`offsetY = (scrollY + bottomY) * zoom`

`CanvasPopbarContainer.tsx:26-36` 用 `motion.div` 渲染:
- `initial={{ opacity: 0, y: -3 }}` 到 `animate={{ opacity: 1, y: 0 }}`
- `transition={{ duration: 0.2, ease: 'easeInOut' }}`
- CSS: `bg-primary-foreground/75 backdrop-blur-lg` 毛玻璃 + 轻微阴影

### 3.3 Magic Generate 执行流程 (前端)

`CanvasMagicGenerator.tsx:22-64`:

1. 获取 `excalidrawAPI.getAppState()` 和 `selectedElementIds` (`CanvasMagicGenerator.tsx:26-31`)
2. 调用 `exportToCanvas({ elements: selectedElements, appState, files, mimeType: 'image/png', maxWidthOrHeight: 2048, quality: 1 })` (`CanvasMagicGenerator.tsx:36-46`) — `@excalidraw/excalidraw` 官方 SDK 的栅格化导出 API
3. `canvas.toDataURL('image/png', 0.8)` 转 base64 PNG (`CanvasMagicGenerator.tsx:49`)
4. `eventBus.emit('Canvas::MagicGenerate', { fileId: 'magic-${Date.now()}', base64, width, height, timestamp })` (`CanvasMagicGenerator.tsx:52-58`)
5. 清除选中状态 `excalidrawAPI.updateScene({ appState: { selectedElementIds: {} } })` (`CanvasMagicGenerator.tsx:61-63`)

快捷键: Cmd+B / Ctrl+B (`CanvasMagicGenerator.tsx:66`)

**核心事实**: Magic 输入是选中元素的 **栅格化 PNG 截图**,不是结构化草图数据。所有矢量/层级/元素类型信息在 `exportToCanvas` 导出时丢失。AI 模型看到的是像素,不是"矩形 + 箭头 + 文字"的结构。

### 3.4 Chat 端接收与发送

`ChatMagicGenerator.tsx:29-78`:

1. 检查 `authStatus.is_logged_in`,未登录则 `setShowLoginDialog(true)` 并 return (`ChatMagicGenerator.tsx:31-34`)
2. `setPending('text')` 标记处理中状态 (`ChatMagicGenerator.tsx:37`)
3. 构建 Message: `{ role: 'user', content: [{ type: 'text', text: 'Magic Magic! Wait about 1~2 minutes please...' }, { type: 'image_url', image_url: { url: data.base64 } }] }` (`ChatMagicGenerator.tsx:40-54`)
4. 更新消息列表 `setMessages([...messages, magicMessage])` + 滚动到底 (`ChatMagicGenerator.tsx:56-59`)
5. 调 `sendMagicGenerate({ sessionId, canvasId, newMessages, systemPrompt })` (`ChatMagicGenerator.tsx:63-68`)
   - `systemPrompt` 从 `localStorage.getItem('system_prompt')` 读取,fallback 到 `DEFAULT_SYSTEM_PROMPT`
6. 事件监听注册: `eventBus.on('Canvas::MagicGenerate', handleMagicGenerate)` (`ChatMagicGenerator.tsx:81-88`),卸载时 `eventBus.off`

该组件 `return null`,是纯逻辑组件,不渲染任何 UI。

### 3.5 后端处理链

`chat_router.py:48-64`:
- POST `/api/magic` 接收 JSON,调 `handle_magic(data)`,返回 `{"status": "done"}`
- POST `/api/magic/cancel/{session_id}` 取消任务

`magic_service.handle_magic` -> `create_jaaz_response(messages, session_id, canvas_id)`:

`jaaz_magic_agent.py:14-153`:
1. 从 `messages[-1]` 提取 `image_url` content (`jaaz_magic_agent.py:21-29`) — 遍历 content list 找 `type == 'image_url'` 的项
2. 创建 `JaazService()` 实例,读取 `app_config.jaaz.url` / `app_config.jaaz.api_key` (`jaaz_magic_agent.py:43-55`) — 未配置则返回错误文本
3. `jaaz_service.generate_magic_image(image_content)` 调云端 API (`jaaz_magic_agent.py:58`)
4. 下载结果图片: `get_image_info_and_save(image_url, file_path)` (`jaaz_magic_agent.py:109-111`)
5. 尺寸减半: `width = max(1, int(width / 2))`,`height = max(1, int(height / 2))` (`jaaz_magic_agent.py:113-114`) — 避免生成图过大占用画布
6. `save_image_to_canvas(session_id, canvas_id, filename, mime_type, width, height)` (`jaaz_magic_agent.py:120`) — 写入 Excalidraw image element + websocket 广播
7. 返回 assistant 文本消息含 markdown 图片引用 (`jaaz_magic_agent.py:127`)

### 3.6 JaazService 云端 API (`server/services/jaaz_service.py`)

`generate_magic_image` (`jaaz_service.py:202-237`):
1. `create_magic_task(image_content)` — POST `{api_url}/image/magic`,body `{ image: base64 }`,60s 超时 (`jaaz_service.py:42-83`)
   - 要求 `image_content` 以 `data:image/` 开头
   - 返回 `task_id`
2. `poll_for_task_completion(task_id, max_attempts=120, interval=5.0)` — GET `{api_url}/task/{task_id}`,轮询 120 次 * 5s = 最长 10 分钟 (`jaaz_service.py:144-200`)
   - 状态: `succeeded` / `failed` / `cancelled` / `processing`
   - 超时抛 `Task polling timeout after 120 attempts`
3. 返回 `{ result_url, ... }`

API URL 从 `app_config.jaaz.url` 读取,自动补 `/api/v1` 后缀 (`jaaz_service.py:26-27`)。认证: `Bearer {api_token}` (`jaaz_service.py:37-40`)。

### 3.7 结果回传画布

`save_image_to_canvas` (在 `tools/utils/image_canvas_utils.py`):
- 生成 `ExcalidrawImageElement` (含 fileId / x / y / width / height / status)
- 生成 `BinaryFileData` (含 dataURL 或 URL)
- 通过 Socket.IO emit `image_generated` 事件 (`SessionEventType.ImageGenerated`)
- 前端 `Chat.tsx` 接收后调 `excalidrawAPI.updateScene()` 写入画布

**端到端延迟**: 云端 magic 任务轮询最长 10 分钟,用户靠 "Wait about 1~2 minutes" 文案等待。

---

## 4. Magic Video 交互机制

### 4.1 结论: 源码中不存在 "Magic Video" 功能

在 `react/src` 和 `server` 中 grep 搜索 `magic.?video|video.?step|sketch|arrow.?step|prompt?-free|Lego` 均无匹配。

用户描述的"在视频上画框写步骤"的 Magic Video 功能在 jaaz 源码中 **完全不存在**。

### 4.2 画布上的视频: 仅嵌入播放

`VideoElement.tsx` 是 Excalidraw 画布内的 custom HTML element:
- 在 Excalidraw scene 中渲染 `<video>` 播放器
- 支持播放 / 暂停 / 进度控制
- **不支持** 在视频帧上绘制标注 / 步骤 / 箭头 / 文字

### 4.3 视频生成: 仅存在于 Agent Chat 工具调用

视频生成能力在 `server/services/jaaz_service.py` 中:

- `generate_video(prompt, model, resolution, duration, aspect_ratio, input_images)` (`jaaz_service.py:239-294`) — POST `{api_url}/video/sunra/generations`
- `generate_video_by_seedance(prompt, model, resolution, duration, aspect_ratio, input_images)` (`jaaz_service.py:296-368`) — POST `{api_url}/video/seedance/generation`

这些方法被 LangChain `@tool` 装饰的视频生成工具调用,仅在 Agent Chat 多智能体流程中由 `image_video_creator` 智能体触发,不是画布上的独立交互。

### 4.4 视频结果回传

`tools/video_generation/video_canvas_utils.py`:
- 保存视频文件到 `FILES_DIR`
- 创建 Excalidraw 视频元素 (类似 image element,含 duration)
- 通过 Socket.IO emit `video_generated` 事件 (`socket.ts:44-50`)
- 前端接收后写入画布,由 `VideoElement.tsx` 渲染播放

### 4.5 对 Flovart 的启示

若 Flovart 要实现"画框写步骤"的视频标注功能,需从零设计:
- 视频帧截图 + Excalidraw 标注层叠加的数据模型
- 时间轴 + 步骤序列化存储
- 标注与帧的映射关系
- 标注渲染 + 回放交互

jaaz 在此领域不提供任何可参考的实现。

---

## 5. Agent Chat 系统

### 5.1 前端 Chat 架构

`Chat.tsx` 是主聊天 UI,职责:
- Socket.IO 事件监听: `delta` (流式文本) / `tool_call` / `tool_call_arguments` / `tool_call_result` / `tool_call_progress` / `image_generated` / `video_generated` / `done` / `error`
- 消息列表渲染 (user / assistant / tool messages)
- Tool call UI: 展示工具名、参数 JSON、执行进度、返回结果
- Magic 生成 UI: 展示 "Magic Magic!" 消息 + pending 状态
- 输入框 `ChatTextarea.tsx`: 监听 `Canvas::AddImagesToChat` / `Material::AddImagesToChat` 事件插入图片引用

### 5.2 后端 Chat 编排

`chat_router.py:10-26` -> `handle_chat(data)` -> `chat_service.handle_chat` -> `langgraph_multi_agent`

`langgraph_service/agent_service.py`:
- 使用 `langgraph_swarm.create_swarm` 编排多智能体
- 智能体定义在 `agent_manager.py` / `planner_config.py` / `base_config.py` / `image_vide_creator_config.py` / `image_designer_config.py`
- 智能体间通过 handoff tools 序列化交接消息
- LLM: `ChatOpenAI` 或 `ChatOllama`,基于 provider 配置动态选择

### 5.3 智能体配置

| 配置文件 | 智能体 | 工具 |
|----------|--------|------|
| `planner_config.py` | Planner | `write_plan_tool` — 生成执行计划 |
| `image_vide_creator_config.py` | Image/Video Creator | 图像/视频生成工具 + handoff |
| `image_designer_config.py` | Image Designer | 图像编辑工具 + handoff |
| `base_config.py` | Base | 公共配置基类 |
| `agent_manager.py` | — | 智能体注册 + handoff tool 创建 |

handoff 机制: `langgraph_swarm` 的 `create_handoff_tool` 序列化当前智能体的消息历史,传递给目标智能体继续处理。智能体间通过 handoff tool 名称实现路由。

### 5.4 工具系统

工具定义在 `server/tools/`:
- `generate_image_by_*.py` — 5 个 LangChain `@tool` 图像生成工具,分别对应 5 个 provider (jaaz / openai / replicate / volces / wavespeed)
- `video_generation/` — 视频生成工具 (Kling v2 等)
- 工具用 `@tool` 装饰,参数注入 `InjectedToolCallId` + `RunnableConfig`
- `RunnableConfig` 携带 `canvas_id` / `session_id` 上下文,从 `config.configurable` 读取
- 每个工具内部调 `generate_image_with_provider(provider, model, ...)`,provider 从注册表获取

### 5.5 Tool Call 确认流程 (Human-in-the-Loop)

`types/socket.ts:16-18`:
- `ToolCallPendingConfirmation` — 工具调用前请求用户确认,携带 `id` / `name` / `arguments` (`socket.ts:81-87`)
- `ToolCallConfirmed` — 用户确认执行 (`socket.ts:89-92`)
- `ToolCallCancelled` — 用户取消 (`socket.ts:94-97`)

对应后端 `routers/tool_confirmation.py`,实现 human-in-the-loop 审批。前端展示工具名和参数,用户点击确认/取消后通过 REST 或 Socket.IO 回传。

### 5.6 流式事件处理

`Chat.tsx` 监听 Socket.IO 事件,按 `SessionEventType` 分发:

| 事件 | 处理 |
|------|------|
| `Delta` | 追加流式文本到当前 assistant 消息 |
| `ToolCall` | 创建工具调用 UI 条目 (展示工具名) |
| `ToolCallArguments` | 追加工具参数 JSON 片段 |
| `ToolCallProgress` | 更新工具执行进度文本 (如 "Executing node 3...") |
| `ToolCallResult` | 展示工具返回结果 |
| `ToolCallPendingConfirmation` | 弹出确认弹窗 |
| `ImageGenerated` | 将 `ExcalidrawImageElement` + `BinaryFileData` 写入画布 |
| `VideoGenerated` | 将视频元素写入画布 |
| `AllMessages` | 全量消息同步 (重连恢复) |
| `Done` | 结束 pending 状态 |
| `Error` | 展示错误信息 |

### 5.7 取消机制

`chat_router.py:28-46`:
- POST `/api/cancel/{session_id}` -> `get_stream_task(session_id)` -> `task.cancel()`
- 返回 `{"status": "cancelled"}` 或 `{"status": "not_found_or_done"}`

Magic 取消类似: `chat_router.py:66-84` -> POST `/api/magic/cancel/{session_id}`

取消通过 `asyncio.Task.cancel()` 实现,不保证立即终止 (需被取消任务响应 `CancelledError`)。

---

## 6. Provider / Model 抽象

### 6.1 图片 Provider 注册表

`tools/utils/image_generation_core.py:11-30`:

| Provider | 说明 |
|----------|------|
| `jaaz` | Jaaz 云端 API (magic + midjourney + video) |
| `openai` | OpenAI DALL-E / GPT Image |
| `replicate` | Replicate 平台模型 |
| `volces` | 火山引擎 |
| `wavespeed` | WaveSpeed 平台 |

ComfyUI provider 在注册表中被注释掉,代码完整但未启用。

### 6.2 Provider 抽象基类

`tools/image_providers/image_base_provider.py`:
- 抽象类 `ImageProviderBase`
- 核心方法: `generate(model, prompt, ...)` -> 返回图片 URL 或 base64
- 各 provider 子类实现具体 API 调用逻辑
- 统一接口使得工具层不关心具体 provider 实现

### 6.3 ComfyUI Provider

`tools/image_providers/comfyui_provider.py`:
- 从 `asset/` 目录加载 JSON workflow 模板文件
- 替换 workflow JSON 中的参数占位符 (prompt / seed / 图片 URL 等)
- 调用 `routers.comfyui_execution.execute(workflow, base_url)` 执行
- 返回输出图片 URL

### 6.4 ComfyUI 执行引擎 (`routers/comfyui_execution.py`)

`execute(workflow, base_url, wait=True, ...)` (`comfyui_execution.py:29-83`):

1. `check_comfy_server_running(base_url)` — GET `{base_url}/api/prompt` 确认在线 (`comfyui_execution.py:22-26`)
2. `WorkflowExecution` 类管理执行生命周期 (`comfyui_execution.py:111-357`)
3. WebSocket 连接 `{ws_url}/ws?clientId={uuid}` 监听执行事件 (`comfyui_execution.py:143-153`)
4. POST `{base_url}/prompt` 提交 workflow JSON (`comfyui_execution.py:155-177`)
5. `watch_execution()` 循环处理 WebSocket 消息 (`comfyui_execution.py:179-199`)

事件处理 (`comfyui_execution.py:230-356`):

| ComfyUI 事件 | 处理 | 前端推送 |
|--------------|------|----------|
| `status` | 读取队列剩余数 | `tool_call_progress: "In queue, there's N works ahead..."` |
| `executing` | 记录当前节点,更新剩余节点集 | `tool_call_progress: "Executing {node_title}"` |
| `execution_cached` | 跳过已缓存节点 | — |
| `progress` | 计算节点进度百分比 | `tool_call_progress: "Executing {node} N%"` |
| `executed` | 收集输出图片/GIF URL | `tool_call_progress: ""` (清空进度) |
| `execution_error` | 报告错误 | `error: {json}` |

所有进度通过 `send_to_websocket(session_id, { type: "tool_call_progress", tool_call_id, session_id, update })` 推送到前端。

`upload_image(image, base_url)` (`comfyui_execution.py:359-380`):
- POST `{base_url}/upload/image` 上传图片到 ComfyUI input 目录
- 返回 `{subfolder}/{filename}` 路径

### 6.5 前端 Provider 配置

`components/settings/AddProviderDialog.tsx` 内置预设标签:
- Anthropic Claude (文本 LLM)
- OpenRouter (文本 LLM,多模型路由)
- Wavespeed (仅媒体生成)
- Replicate (媒体 + 视频生成)
- volces / jaaz (在前端代码中配置,文本 + 媒体)

模型列表通过 `api/model.ts` `listModels()` -> GET `/api/models` -> `{ llm: ModelInfo[], tools: ToolInfo[] }`。

`contexts/configs.tsx:38-88`:
- `setTextModels(llmModels)` / `setAllTools(toolList)`
- 从 `localStorage.getItem('text_model')` 恢复选中模型,格式 `provider:model`
- 从 `localStorage.getItem('disabled_tool_ids')` 恢复禁用工具列表 (JSON array)
- 默认全选工具,禁用列表过滤
- 模型或工具为空时 `setShowLoginDialog(true)` 弹登录

### 6.6 LLM 接入

后端根据 provider 配置选择:
- `ChatOpenAI` — OpenAI 兼容接口 (含 OpenRouter / volces 等)
- `ChatOllama` — 本地 Ollama 模型

配置存储在 SQLite `app_config` 表,通过 `/api/settings` 读写。前端 `AddProviderDialog` 提交后调 `/api/settings` 持久化。

### 6.7 视频生成 Provider

`jaaz_service.py` 提供两个视频生成路径:
- `generate_video()` — Sunra 模型,POST `{api_url}/video/sunra/generations`
- `generate_video_by_seedance()` — Seedance 模型,POST `{api_url}/video/seedance/generation`

两者都走 `poll_for_task_completion` 轮询等待结果。

---

## 7. 资产 / 提示词 / 角色库

### 7.1 素材管理 (`components/material/MaterialManager.tsx`)

- 基于文件系统的素材浏览器,调 `/file_service` API 列出 `FILES_DIR` 中的文件
- 读取 PNG 元数据 (宽高等)
- 选中素材后 emit `Material::AddImagesToChat` 事件,聊天输入框插入图片
- 无标签 / 分类 / 搜索 / 收藏功能
- 不支持云端同步

### 7.2 文件上传与服务 (`routers/image_router.py`)

`POST /api/upload_image` (`image_router.py:20-97`):
- 接受 multipart form 上传,参数 `max_size_mb` 默认 3.0
- 超过 3MB 自动压缩:
  1. 迭代降低 JPEG quality (95 -> 85 -> 75 -> ... -> 10) (`image_router.py:107-119`)
  2. 仍超限则迭代缩小尺寸 (scale 0.8 -> 0.7 -> ... -> 0.3) + quality 70 (`image_router.py:121-139`)
  3. 最后兜底 quality 30 (`image_router.py:141-144`)
- 透明图 (RGBA / LA / P) 转白底 JPEG (`image_router.py:43-49`)
- 返回 `{ file_id, url, width, height }`,URL 格式 `http://localhost:{port}/api/file/{file_id}`

`GET /api/file/{file_id}` (`image_router.py:148-154`):
- 从 `FILES_DIR` 直接返回 `FileResponse`

`POST /api/comfyui/object_info` (`image_router.py:157-179`):
- 代理 ComfyUI `/api/object_info` 请求,获取节点信息
- ComfyUI 不可用时返回 503

### 7.3 知识库 (`components/knowledge/Knowledge.tsx` + `api/knowledge.ts`)

- 分页列表: GET `/api/knowledge/list?pageSize=10&pageNumber=1&search=` (`knowledge.ts:58-76`)
- 数据结构: `{ id, user_id, name, description, cover, is_public, created_at, updated_at, content? }` (`knowledge.ts:5-15`)
- 分页信息: `{ current_page, page_size, total_count, total_pages, has_next, has_prev }` (`knowledge.ts:18-25`)
- 切换知识库后通过 `/api/settings` 持久化选择
- 响应结构: `{ success, data: { list, pagination, is_admin }, message }` (`knowledge.ts:28-36`)
- 无知识库编辑 UI (仅列表 / 切换)

### 7.4 提示词管理

- System prompt 存 `localStorage.getItem('system_prompt')` (`ChatMagicGenerator.tsx:67`),fallback 到 `DEFAULT_SYSTEM_PROMPT` 常量
- **无提示词库 / 模板库 / 角色库**
- Magic 生成完全依赖用户当前输入的图片截图,不涉及角色/提示词存储与调用
- Agent Chat 的智能体 system prompt 硬编码在 `planner_config.py` / `image_vide_creator_config.py` 等 `*_config.py` 中

### 7.5 对 Flovart 的启示

jaaz 在资产/提示词/角色库方面极其薄弱:
- 素材管理 = 文件系统浏览,无元数据管理
- 知识库 = 远程 API 列表,无本地编辑
- 提示词 = localStorage 单值,无库概念
- 角色库 = 不存在

Flovart 若已有素材/提示词/角色库后端 (Go + GORM),无需从 jaaz 迁移任何实现。

---

## 8. 可迁移至 Flovart 的能力

### 8.1 Excalidraw 悬浮工具栏模式

`pop-bar/index.tsx` 的 onChange 监听 + 选中元素计数 + 屏幕坐标计算 (scrollX / scrollY / zoom 映射) 模式,可直接用于 Flovart 画布的上下文操作栏。位置计算逻辑 (`index.tsx:68-103`) 是通用几何,与 Excalidraw 无强耦合。Flovart 若用 Excalidraw 可直接复用;若用其他画布库,需替换 onChange 监听和坐标映射。

### 8.2 mitt 事件总线跨组件解耦

`lib/event.ts` 用 mitt 实现 `Canvas::AddImagesToChat` / `Canvas::MagicGenerate` 事件,画布组件 emit、聊天组件 listen,无直接 import。Flovart 画布与 AI 面板交互可复用此模式,避免 prop drilling。类型安全可通过泛型 event map 实现。

### 8.3 选中元素栅格化为生成输入

`CanvasMagicGenerator.tsx:36-49` 用 `exportToCanvas` + `toDataURL` 将选中 Excalidraw 元素栅格化为 base64 PNG,作为 AI 生成输入。此 pipeline 适用于任何"截图 -> 发给 vision model"场景。Flovart 若用 Excalidraw 可直接复用;若用 React Flow 或自研画布,需替换导出 API (如 `html2canvas` 或原生 Canvas API)。

### 8.4 Socket.IO 流式事件协议

`types/socket.ts:5-113` 的 `SessionEventType` enum + discriminated union 定义了完整的 AI 流式交互事件类型:
- 文本流式: `Delta`
- 工具调用: `ToolCall` / `ToolCallArguments` / `ToolCallResult` / `ToolCallProgress`
- 媒体生成: `ImageGenerated` / `VideoGenerated`
- 人审: `ToolCallPendingConfirmation` / `Confirmed` / `Cancelled`
- 生命周期: `Done` / `Error` / `AllMessages` (重连恢复)

Flovart 可直接参考此事件分类设计 WebSocket 协议,TypeScript discriminated union 模式值得复用。

### 8.5 Zustand + Context 全局状态模式

`contexts/canvas.tsx` + `stores/canvas.ts` 的 "zustand store -> Context 包装 -> hook 消费" 三层模式,轻量且避免 prop drilling。Flovart 已有 `useThemeStore` 等同类实现,可直接对齐。关键: Context value 是 store 的 hook 函数本身,消费方调用 `useCanvas()` 得 store 快照。

### 8.6 LangGraph Swarm 多智能体编排

`langgraph_service/agent_service.py` 用 `create_swarm` 编排 Planner + Image/Video Creator + Image Designer,通过 handoff tools 交接。若 Flovart 需多智能体工作流 (如"规划 -> 生成 -> 编辑"pipeline),可参考此架构。但需评估 token 成本和调试复杂度 (handoff 序列化消息历史增加上下文长度)。

### 8.7 Provider 注册表 + 抽象基类

`tools/utils/image_generation_core.py` 的 provider 注册表 + `ImageProviderBase` 抽象基类,统一了 5 个图片生成 provider 的调用接口。Flovart 若要支持多 AI provider (OpenAI / Replicate / ComfyUI / 自有),可参考此抽象:
- 注册表 dict 映射 provider name -> class
- 抽象基类定义 `generate()` 接口
- 各子类实现具体 API 调用
- ComfyUI provider 的 JSON workflow 模板 + 参数替换模式尤其值得参考

### 8.8 ComfyUI WebSocket 执行 + 进度回传

`comfyui_execution.py:111-357` 的 `WorkflowExecution` 类:
- WebSocket 监听 ComfyUI 执行事件
- `status` / `executing` / `progress` / `executed` 事件分类处理
- 每个事件通过 `send_to_websocket` 推送 `tool_call_progress` 到前端

Flovart 若集成 ComfyUI,可直接参考此执行引擎实现。进度回传模式 (节点级 + 整体级) 对用户体验很重要。

### 8.9 Tool Call 人审确认流程

`tool_confirmation.py` + `SessionEventType.ToolCallPendingConfirmation / Confirmed / Cancelled` 实现了 human-in-the-loop 工具审批。对需要用户确认的 AI 操作 (如消耗积分的生成、删除操作) 有参考价值。前端展示工具名 + 参数,用户确认/取消后回传。

### 8.10 图片上传压缩策略

`image_router.py:100-144` 的迭代压缩:
1. quality 95 -> 10 降质量
2. scale 0.8 -> 0.3 缩尺寸 + quality 70
3. quality 30 兜底

简单有效,Flovart 后端可直接参考 (但用 Go 重写)。Pillow 转白底处理透明图的逻辑也值得参考。

---

## 9. 取舍与风险

### 9.1 Magic Canvas 输入 = 截图,非结构化数据

`CanvasMagicGenerator.tsx:36-49` 将选中元素栅格化为 PNG,丢失所有矢量/层级/类型信息。AI 看到的是像素,不是"矩形 + 箭头 + 文字"的结构。

**风险**: Flovart 若要 AI 理解草图结构 (如"这个箭头指向这个矩形"),需自行设计结构化序列化方案 (如将 Excalidraw elements JSON + 位置关系作为文本输入),jaaz 无法参考。

### 9.2 Magic 强依赖 Jaaz 云端 API

`jaaz_magic_agent.py:43-55` 创建 `JaazService()` 必须读取 `app_config.jaaz.url` / `api_key`,未配置则直接返回错误文本。无本地 fallback,无多 provider 路由。

**风险**: Flovart 若自研 Magic 功能,需替换为自有后端或多 provider 路由,不能依赖 Jaaz 云。

### 9.3 "Magic Video" 完全不存在

源码中无视频帧标注 / 步骤绘制 / Lego 式步骤 UI。`VideoElement.tsx` 仅播放,视频生成仅在 Agent Chat 中通过工具调用。

**风险**: Flovart 若要实现"在视频上画框写步骤"功能,需从零设计数据模型和交互,jaaz 零参考价值。

### 9.4 Agent Studio 是死代码

`agent_studio/AgentStudio.tsx:51-135` 用 ReactFlow + localStorage (`agent-studio-graph` key),无路由挂载,无后端 API。`loadInitialGraph` 从 localStorage 读取,`saveGraph` debounce 500ms 写回。纯原型,功能未完成。

**风险**: 勿作为多智能体可视化编排的参考。Flovart 若需此功能应从零设计。

### 9.5 SQLite 单文件 + 文件系统资产

`db_service.py` 用 aiosqlite 单文件数据库 (`localmanus.db`),资产存文件系统 `FILES_DIR`。简单但不支持多用户/并发/云同步。

**风险**: Flovart 已有 Go + GORM + MySQL 后端,此模式不适用。勿迁移数据库设计,只迁移架构思路。

### 9.6 localStorage 滥用

jaaz 在 localStorage 存: `agent-studio-graph` / `text_model` / `disabled_tool_ids` / `system_prompt`。违反 Flovart 规范 ("业务数据用 localforage,localStorage 仅用于极小简单配置")。

**风险**: 迁移时需将业务数据 (如禁用工具列表) 改用 localforage,localStorage 只留极小配置 (如当前选中模型 ID)。

### 9.7 ComfyUI Provider 被注释

`image_generation_core.py:11-30` 中 ComfyUI 注册被注释掉,虽然 `comfyui_provider.py` 代码完整。

**风险**: Flovart 若要启用 ComfyUI,需取消注释并测试,不能假设已验证。`comfyui_execution.py` 的 WebSocket 执行引擎也需端到端验证。

### 9.8 认证强耦合

`ChatMagicGenerator.tsx:31-34` 强制 `authStatus.is_logged_in` 才能触发 Magic,未登录直接弹登录框。Flovart 的 "API Key 存本地前端直连" 模式不同,需调整认证逻辑或移除认证门槛。

### 9.9 Socket.IO 重连上限硬编码

`socket.tsx:138-144` 硬编码 max 5 次重连 (`isMaxReconnectAttemptsReached()`)。长任务 (10 分钟 Magic 生成) 期间若断连,无法恢复,生成结果丢失。

**风险**: Flovart 若用 WebSocket 推流,需设计更健壮的重连策略 + 任务恢复机制 (如 `AllMessages` 事件全量同步)。

### 9.10 轮询而非 WebSocket 等待

`jaaz_service.py:144-200` 用 HTTP 轮询 (120 次 * 5s) 等待云端任务完成,而非 WebSocket。10 分钟轮询消耗 120 个 HTTP 请求。

**风险**: Flovart 若对接类似异步任务 API,建议改用 WebSocket 或 webhook 回调,减少无效轮询。或至少增加指数退避策略。

### 9.11 尺寸减半的硬编码

`jaaz_magic_agent.py:113-114` 将生成图片宽高各减半 (`width / 2`, `height / 2`),无配置项。可能导致生成图在画布上偏小。

**风险**: Flovart 应将此作为可配置参数,或根据画布视口自适应缩放。

### 9.12 错误处理以文本返回为主

`jaaz_magic_agent.py` 的错误处理统一返回 `{ role: 'assistant', content: [{ type: 'text', text: 'Magic Generation Error: ...' }] }`,不使用 `SessionEventType.Error` 事件。前端靠解析文本判断失败。

**风险**: Flovart 应使用结构化错误事件 (`Error` type),而非文本消息,前端按事件类型渲染错误 UI。

---

## 附录: 关键文件索引

| 文件 | 行数 | 用途 |
|------|------|------|
| `react/src/components/canvas/pop-bar/index.tsx` | 124 | 选中元素 -> 悬浮工具栏显示/隐藏 + 定位 |
| `react/src/components/canvas/pop-bar/CanvasMagicGenerator.tsx` | 75 | Magic 触发: exportToCanvas -> base64 -> emit |
| `react/src/components/canvas/pop-bar/CanvasPopbar.tsx` | 34 | Add to Chat 按钮: emit `Canvas::AddImagesToChat` |
| `react/src/components/canvas/pop-bar/CanvasPopbarContainer.tsx` | 49 | 悬浮栏容器: motion.div 定位 + 动效 |
| `react/src/components/canvas/menu/CanvasToolMenu.tsx` | 56 | 底部工具栏 (9 种工具) |
| `react/src/components/canvas/menu/CanvasViewMenu.tsx` | 87 | 右上角缩放控制 |
| `react/src/components/chat/ChatMagicGenerator.tsx` | 93 | Magic 监听 -> POST `/api/magic` |
| `react/src/lib/event.ts` | — | mitt 事件总线 (3 个事件类型) |
| `react/src/types/socket.ts` | 113 | Socket.IO 事件类型定义 (14 种) |
| `react/src/stores/canvas.ts` | 20 | Zustand canvas store |
| `react/src/stores/configs.ts` | 71 | Zustand configs store |
| `react/src/contexts/canvas.tsx` | 22 | Canvas Context |
| `react/src/contexts/configs.tsx` | 113 | Configs Context (含 useQuery 拉模型) |
| `react/src/contexts/socket.tsx` | 149 | Socket.IO Context (重连上限 5 次) |
| `react/src/components/agent_studio/AgentStudio.tsx` | 135 | 死代码: ReactFlow 原型 |
| `server/routers/chat_router.py` | 84 | `/api/chat` + `/api/magic` 端点 |
| `server/routers/canvas.py` | 45 | 画布 CRUD 端点 |
| `server/routers/image_router.py` | 179 | 上传 + 文件服务 + ComfyUI object_info |
| `server/routers/websocket_router.py` | 20 | Socket.IO connect/disconnect/ping |
| `server/routers/comfyui_execution.py` | 380 | ComfyUI workflow 执行引擎 |
| `server/services/OpenAIAgents_service/jaaz_magic_agent.py` | 156 | Magic 生成后端逻辑 |
| `server/services/jaaz_service.py` | 468 | Jaaz 云端 API 客户端 |
| `server/tools/utils/image_generation_core.py` | — | 图片 provider 注册表 (5 个) |
| `server/tools/image_providers/image_base_provider.py` | — | Provider 抽象基类 |
| `server/tools/image_providers/comfyui_provider.py` | — | ComfyUI provider 实现 |
| `server/tools/utils/image_canvas_utils.py` | — | save_image_to_canvas |
| `server/tools/video_generation/video_canvas_utils.py` | — | 视频保存 + 画布广播 |
| `server/services/db_service.py` | — | aiosqlite + 迁移管理 |

---

*分析完成。所有事实均来自源码验证。*

---

## 10. 端到端数据流总览

### 10.1 Magic Canvas 完整数据流

```
[用户选中 >= 2 个 Excalidraw 元素]
    |
    v
[pop-bar/index.tsx: onChange 回调]
    |  selectedCount >= 2 -> setShowMagicGenerate(true)
    |  计算悬浮栏位置 (scrollX/scrollY/zoom 映射)
    v
[CanvasPopbarContainer.tsx: motion.div 渲染悬浮栏]
    |
    v
[CanvasMagicGenerator.tsx: 用户点击 "Magic Generate" 或按 Cmd+B]
    |  excalidrawAPI.getAppState() -> selectedElementIds
    |  exportToCanvas({ elements, appState, files, mimeType: 'image/png', maxWidthOrHeight: 2048 })
    |  canvas.toDataURL('image/png', 0.8) -> base64
    |  eventBus.emit('Canvas::MagicGenerate', { fileId, base64, width, height, timestamp })
    v
[ChatMagicGenerator.tsx: eventBus.on('Canvas::MagicGenerate')]
    |  检查 authStatus.is_logged_in
    |  构建 Message { role: 'user', content: [text + image_url] }
    |  setPending('text')
    |  sendMagicGenerate({ sessionId, canvasId, newMessages, systemPrompt })
    v
[POST /api/magic -> chat_router.py:48 -> handle_magic -> magic_service]
    |  asyncio.create_task -> create_jaaz_response(messages, session_id, canvas_id)
    v
[jaaz_magic_agent.py: create_jaaz_response]
    |  提取 messages[-1] 中的 image_url (base64)
    |  JaazService() 初始化 (读取 app_config.jaaz.url / api_key)
    |  jaaz_service.generate_magic_image(image_content)
    v
[JaazService.generate_magic_image: jaaz_service.py:202-237]
    |  create_magic_task: POST {api_url}/image/magic { image: base64 } -> task_id
    |  poll_for_task_completion: GET {api_url}/task/{task_id} (120 次 * 5s)
    |  返回 { result_url }
    v
[jaaz_magic_agent.py: 下载 + 保存]
    |  get_image_info_and_save(result_url, file_path) -> mime_type, width, height, extension
    |  width /= 2, height /= 2 (硬编码减半)
    |  save_image_to_canvas(session_id, canvas_id, filename, mime_type, width, height)
    v
[image_canvas_utils.py: save_image_to_canvas]
    |  创建 ExcalidrawImageElement + BinaryFileData
    |  Socket.IO emit('image_generated', { element, file, canvas_id, image_url })
    v
[Chat.tsx: 监听 image_generated 事件]
    |  excalidrawAPI.updateScene({ elements: [...existing, newElement] })
    |  excalidrawAPI.addFiles([newFileData])
    v
[画布显示生成的图片]
```

### 10.2 Agent Chat 完整数据流

```
[用户在 ChatTextarea 输入文本/图片 -> 发送]
    |
    v
[POST /api/chat -> chat_router.py:10 -> handle_chat]
    |  asyncio.create_task -> langgraph_multi_agent(data)
    v
[langgraph_service/agent_service.py: create_swarm]
    |  创建 Planner + Image/Video Creator + Image Designer 智能体
    |  配置 handoff tools 实现智能体间路由
    |  LLM: ChatOpenAI 或 ChatOllama
    v
[Planner 智能体: 接收用户消息]
    |  调用 write_plan_tool 生成执行计划
    |  handoff 到 Image/Video Creator 或 Image Designer
    v
[Specialist 智能体: 执行工具]
    |  @tool 装饰的 generate_image_by_* / video_generation 工具
    |  RunnableConfig 传递 canvas_id / session_id
    |  generate_image_with_provider(provider, model, prompt, ...)
    v
[Provider 调用 (如 JaazService / OpenAI / Replicate)]
    |  返回图片 URL
    |  save_image_to_canvas 或 video_canvas_utils 保存到画布
    v
[Socket.IO 推送流式事件]
    |  delta: 流式文本片段
    |  tool_call: 工具调用开始
    |  tool_call_arguments: 工具参数 JSON
    |  tool_call_progress: 执行进度 (如 ComfyUI 节点进度)
    |  tool_call_result: 工具返回结果
    |  image_generated / video_generated: 媒体写入画布
    v
[Chat.tsx: 实时渲染]
    |  流式文本追加到 assistant 消息
    |  工具调用 UI 展示
    |  媒体元素写入 Excalidraw 画布
    |  done 事件结束 pending 状态
```

### 10.3 ComfyUI 执行数据流

```
[Agent 工具调用 -> comfyui_provider.py]
    |  从 asset/ 加载 JSON workflow 模板
    |  替换参数占位符 (prompt / seed / input_image)
    v
[comfyui_execution.py: execute(workflow, base_url)]
    |  check_comfy_server_running: GET {base_url}/api/prompt
    |  WorkflowExecution 初始化 (client_id = uuid4)
    v
[WebSocket 连接: {ws_url}/ws?clientId={client_id}]
    |
    v
[POST {base_url}/prompt { prompt: workflow, client_id }]
    |  返回 prompt_id
    v
[watch_execution: 循环处理 WebSocket 消息]
    |  status -> 推送队列位置
    |  executing -> 推送当前节点名
    |  progress -> 推送节点进度百分比
    |  executed -> 收集输出图片 URL
    |  execution_error -> 推送错误
    v
[每个事件: send_to_websocket(session_id, { type: "tool_call_progress", ... })]
    |  前端 Chat.tsx 实时展示 ComfyUI 执行进度
    v
[执行完成: 返回 outputs (图片 URL 列表)]
    |  save_image_to_canvas 写入画布
```

---

## 11. Flovart 集成建议

### 11.1 画布选型决策

jaaz 使用 `@excalidraw/excalidraw` v0.18.0 作为画布引擎。Excalidraw 的优势:
- 内置 `exportToCanvas` / `exportToBlob` 栅格化导出 API
- imperative API (`ExcalidrawImperativeAPI`) 支持外部 `updateScene` / `addFiles` / `setActiveTool`
- `onChange` 回调监听元素变化和 appState 变化
- 支持 custom HTML element (如 `VideoElement.tsx` 视频播放)
- 自带文件管理 (BinaryFileData / image element fileId 关联)

Flovart 若已选定 Excalidraw,可直接复用 jaaz 的 pop-bar 模式和 magic 触发流程。若选用其他画布库 (如 React Flow / tldraw),需替换:
- 导出 API: 用 `html2canvas` 或原生 Canvas API 替代 `exportToCanvas`
- 命令式 API: 自行设计 scene 操作接口
- onChange 监听: 自行设计变化检测

### 11.2 Magic Canvas 迁移路线

若 Flovart 要实现类似 Magic Canvas 功能:

1. **保留**: 选中元素 -> 悬浮按钮 -> 栅格化截图 -> 发给 AI 的交互模式
2. **替换后端**: 将 `JaazService` 替换为 Flovart 自有后端 (Go + Gin),或直接前端调 OpenAI 兼容接口
3. **增强输入**: 除了栅格化截图,可额外传递 Excalidraw elements JSON (结构化数据),让 AI 同时获得视觉和结构信息
4. **增强输出**: 支持多图返回 + 选择最佳 + 局部重绘
5. **移除认证门槛**: Flovart 的 API Key 存本地模式不需要 `is_logged_in` 检查
6. **错误处理**: 用 `SessionEventType.Error` 结构化事件替代文本错误消息

### 11.3 Agent Chat 迁移路线

若 Flovart 要实现多智能体 Chat:

1. **后端语言**: jaaz 用 Python LangGraph;Flovart 后端是 Go,需用 Go 重写编排逻辑,或保留 Python 微服务
2. **简化智能体**: jaaz 的 Planner + Creator + Designer 三智能体可能过重,Flovart 可先用单智能体 + 多工具
3. **工具系统**: 参考 jaaz 的 `@tool` + `RunnableConfig` 模式,在 Go 中设计工具注册表 + context 传递
4. **流式协议**: 直接参考 `SessionEventType` 设计 Flovart 的 WebSocket 事件类型
5. **人审确认**: 若 Flovart 有消耗积分的操作,参考 `ToolCallPendingConfirmation` 实现确认流程

### 11.4 Provider 抽象迁移路线

Flovart 若要支持多 AI provider:

```
// Go 伪代码
type ImageProvider interface {
    Generate(ctx context.Context, model string, prompt string, opts ...Option) (*Result, error)
}

var providerRegistry = map[string]ImageProvider{
    "openai":    &OpenAIProvider{},
    "replicate": &ReplicateProvider{},
    "comfyui":   &ComfyUIProvider{},
    "jaaz":      &JaazProvider{},
}

func GenerateImageWithProvider(providerName, model, prompt string, ...) (*Result, error) {
    provider, ok := providerRegistry[providerName]
    if !ok {
        return nil, fmt.Errorf("unknown provider: %s", providerName)
    }
    return provider.Generate(ctx, model, prompt, opts...)
}
```

参考 jaaz 的 `ImageProviderBase` 抽象 + `image_generation_core.py` 注册表模式,在 Go 中实现等价结构。

### 11.5 ComfyUI 集成迁移路线

若 Flovart 要集成 ComfyUI:

1. **Go WebSocket 客户端**: 用 `gorilla/websocket` 或 `nhooyr.io/websocket` 替代 Python `websockets`
2. **workflow 模板**: JSON 文件存本地 `asset/` 目录,运行时加载 + 参数替换
3. **进度回传**: Go 后端接收 ComfyUI WebSocket 事件,通过 Flovart 的 WebSocket 推送到前端
4. **健康检查**: 复用 `GET {base_url}/api/prompt` 确认 ComfyUI 在线
5. **图片上传**: 复用 `POST {base_url}/upload/image` 上传 input 图片到 ComfyUI

关键参考: `comfyui_execution.py:111-357` 的 `WorkflowExecution` 类,包含完整的 WebSocket 事件处理逻辑。

### 11.6 事件总线迁移

Flovart 前端可直接复用 mitt 事件总线模式:

```typescript
// lib/event.ts
import mitt from 'mitt'

type Events = {
  'Canvas::AddImagesToChat': TCanvasAddImagesToChatEvent
  'Canvas::MagicGenerate': TCanvasMagicGenerateEvent
  'Material::AddImagesToChat': TCanvasAddImagesToChatEvent
}

export const eventBus = mitt<Events>()
```

类型安全通过泛型 `mitt<Events>` 保证。画布组件 emit,聊天面板 listen,无直接耦合。

### 11.7 状态管理对齐

Flovart 前端已有 Zustand + `useThemeStore` 模式,可直接对齐 jaaz 的:

- `stores/canvas.ts` -> Flovart 的 `stores/canvas.ts` (存 canvasId + 画布 API 句柄)
- `stores/configs.ts` -> Flovart 的 `stores/configs.ts` (存模型列表 + 选中模型 + provider 配置)
- Context 包装层 -> 复用 Flovart 现有 `AppProviders` 模式

**注意**: Flovart 规范要求 "全局/跨页面状态优先放在 `web/src/stores/`",与 jaaz 模式一致。但 Flovart 规范禁止 "全局组件/常量/配置作为 props 层层传递",需确保 Context 消费方直接调 hook,不透传。

---

## 12. 关键发现总结

1. **Magic Canvas = 截图发给 AI**: 核心机制是将选中 Excalidraw 元素栅格化为 PNG base64,发给云端 AI 生成图片,再写回画布。无结构化草图理解。

2. **Magic Video 不存在**: 源码中无任何视频帧标注/步骤绘制功能。`VideoElement.tsx` 仅播放,视频生成仅在 Agent Chat 工具调用中。

3. **Agent Chat = LangGraph Swarm**: 多智能体编排通过 `langgraph_swarm.create_swarm` 实现,Planner 规划 + Specialist 执行 + handoff 交接。

4. **5 个图片 Provider + ComfyUI (未启用)**: jaaz / openai / replicate / volces / wavespeed 已注册,ComfyUI 代码完整但被注释。

5. **Socket.IO 流式协议设计成熟**: 14 种事件类型覆盖文本流式 / 工具调用 / 媒体生成 / 人审确认 / 生命周期,值得直接参考。

6. **事件总线解耦画布与聊天**: mitt 实现的 `Canvas::MagicGenerate` / `Canvas::AddImagesToChat` 事件,画布 emit + 聊天 listen,无直接引用。

7. **Agent Studio 是死代码**: ReactFlow 原型,localStorage 持久化,无路由无 API,勿作参考。

8. **资产/提示词/角色库极弱**: 素材管理 = 文件浏览,提示词 = localStorage 单值,角色库 = 不存在。Flovart 无需从此迁移。

9. **localStorage 滥用**: `text_model` / `disabled_tool_ids` / `system_prompt` / `agent-studio-graph` 全塞 localStorage,违反 Flovart 规范。

10. **认证强耦合**: Magic 生成强制 `is_logged_in`,与 Flovart "API Key 存本地前端直连" 模式冲突。

*分析完成。所有事实均来自源码验证。*
