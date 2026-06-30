# Infinite Canvas 仓库执行摘要分析报告

- 仓库：`basketikun/infinite-canvas`
- 分析日期：2026-06-29
- 分析者：Dario（Anthropic 首席执行总监视角，给 Floavrt 迁移/参考用）
- 落盘路径：`H:/WorkSpace_For_VsCode/React/Floavrt/docs/analysis/infinite-canvas-analysis.md`

## 1. 结论前置（执行摘要）

1. **该仓库无任何 Go 后端。** 全仓库 `**/*.go` 0 命中，没有任何 `gin`、`gorm`、`handler/`、`repository/`、`model/` 之类的后端代码。所谓"后端"只有一个 Next.js Node.js 服务（端口 3000）加一个独立可发布的本地 Agent（`@basketikun/canvas-agent`，端口 17371）。
2. **核心架构是"纯前端 + 本地 Agent"。** Next.js 16 App Router 前端承载一切：无限画布、节点流、AI 生成、画布助手、用户配置、素材、本地存储。AI 请求由浏览器**直接请求**用户自配的 OpenAI/Gemini 兼容接口（BYOK），不经任何服务端中转。
3. **画布数据全部持久化在浏览器本地**（localForage / IndexedDB），没有服务端数据库。Dockerfile 只把 Next.js 打成 standalone，运行时只起一个 `node server.js`。
4. **Workflow 节点流的本质**：5 类节点（image/text/config/video/audio）+ 有向连线。`config` 节点聚合一次生成参数，上游 `text/image/video/audio` 节点通过 `connections` 作为参考/输入，运行生成时按输入顺序拼成参考提示词并直连 AI 接口。
5. **画布助手有两套**：
   - 在线助手：浏览器内 Tool-Calling Agent，复用同一套 23 个 `canvas_*` 工具定义，用用户自配文本模型驱动，工具直接改前端画布。
   - 本地 Agent：独立 npm 包，Express + SSE + 可选 MCP server，桥接本地 Codex / Claude Code CLI，通过 SSE 把工具调用下发回已连接的网页画布。
6. **对 Floavrt 的迁移价值排序**：
   - 高价值直接迁移：Workflow 节点模型、连线/参考解析、生成参数约束、画布助手 Tool-Calling 协议、23 个 MCP 工具 schema、canvas-agent 的 MCP/HTTP/SSE 设计。
   - 中价值参考：URL 参数注入配置、本地资源引用 label 设计、提示词库 GitHub 聚合缓存。
   - 需要重写（Floavrt 用 Go + Gin）：所有"持久化"层、所有"AIs key 管理"、提示词库聚合（应下沉到 Go service）、有可能的鉴权/多租户。

## 2. 仓库整体结构

```
infinite-canvas/
├─ web/                      # Next.js 16 应用（唯一面向用户的服务）
├─ canvas-agent/             # 独立 npm 包 @basketikun/canvas-agent（本地 Agent）
├─ plugins/infinite-canvas/  # Codex app 插件（skills + .mcp.json）
├─ docs/                     # 独立 Fumadocs 站点（文档站，Next 16）
├─ docker-compose.yml         # 仅跑 ghcr 镜像，3000 端口
├─ docker-compose.local.yml   # 本地构建 Dockerfile
├─ Dockerfile                # bun build web -> node:22 运行 standalone
├─ render.yaml               # Render 部署配置
├─ VERSION / CHANGELOG.md
```

- **无 `go.mod`、无 `main.go`、无任何 `.go` 文件。** `**/*.go` glob 0 命中；对 `*.ts` 全仓 grep `r\.(GET|POST|PUT|DELETE|Group)` 0 命中（即没有类 Gin 的路由写法）。
- 唯一的"服务端"代码只有两类：
  1. `web/src/app/api/**/route.ts`（Next.js Route Handler），目前只见到 `prompts/route.ts`，做 GitHub 提示词库聚合 + 内存缓存。
  2. `canvas-agent/src/`（独立 Node 包，本地运行，不是部署服务）。

## 3. 技术栈与依赖

### 前端 `web/package.json` 关键依赖
- **Next.js 16.2.3**（dev 用 `--webpack`），React 19.2.5，TypeScript。
- UI：**Ant Design v6.4.2**、Tailwind v4、shadcn / radix-ui、`motion`（Framer Motion 的 `motion/react`）、`lucide-react`、`nanoid`、`copy-to-clipboard`。
- 状态：**Zustand v5**、TanStack Query v5。
- 持久化：**localforage**。
- 网络：**axios**。
- 文档站 `docs` 另走 Fumadocs（`fumadocs-core` 16.9 / `fumadocs-mdx` 15）。

### 本地 Agent `canvas-agent`
- 纯 Node（TypeScript），依赖极轻：Express、`@modelcontextprotocol/sdk`、原生 `http`、`spawn` 调 Codex/Claude CLI。
- 不引入数据库、不引入框架级 ORM。

### Docker / 部署
- `Dockerfile`：`oven/bun:1.3.13` 构建 `web`，`node:22-bookworm-slim` 运行 Next.js standalone，`EXPOSE 3000`，`CMD cd /app/web && node server.js`。
- `docker-compose.yml` / `.local.yml` 只有一个 `app` 服务，映射 3000。**AI 请求由浏览器前台直连用户自己的接口**（Dockerfile 注释原话）。

## 4. Workflow 节点流（核心引擎）

### 节点与连线数据结构（`web/src/app/(user)/canvas/types.ts`）

枚举：

```ts
enum CanvasNodeType { Image, Text, Config, Video, Audio }
type CanvasGenerationMode = "text" | "image" | "video" | "audio"
```

`CanvasNodeData`：`id / type / title / position{x,y} / width / height / metadata`。
`metadata` 关键字段：`content / prompt / status(idle|success|loading|error) / generationMode / model / size / quality / count / seconds / vquality / generateAudio / watermark / audioVoice / audioFormat / audioSpeed / audioInstructions / inputOrder / storageKey / mimeType / bytes / naturalWidth/Height / isBatchRoot / batchRootId / batchChildIds / primaryImageId / imageBatchExpanded / freeResize`。

`CanvasConnection = { id, fromNodeId, toNodeId }`——只存 ID，渲染时按节点位置算路径。删除节点会级联删除相关连线；删除图片组根节点会连带删除子图。

### 节点默认尺寸与 spec（`web/src/app/(user)/canvas/constants.ts`）
- `NODE_DEFAULT_SIZE`：每类节点默认宽高。
- `NODE_SPECS`：每类节点初始 `metadata`（例如 config 节点初始化 `generationMode:"image"`、`status:"idle"` 等）。

### 生成流程语义（关键）
1. 用户拖出一个 `text` 节点写提示词，连到 `config` 节点。
2. `config` 节点存一份生成参数（模型、尺寸、质量、数量、时长等）。
3. 触发"运行生成"时，前端按 `config` 的入边收集参考节点（图/视频/音频/文本），按 `inputOrder` 排序，拼成参考提示词文本 + 多张参考图 base64。
4. 直连 OpenAI `/images/generations` `/images/edits` `/responses`（或 Gemini `:generateContent` `:streamGenerateContent`）。
5. 结果落回新节点（图片组根 + 子图）。
6. 持久化只存 `storageKey`，真正 Blob 进 `image_files` / `media_files`。

### 资源引用 label（`web/src/lib/image-reference-prompt.ts`、`canvas-resource-references.ts`）
- 参考图按出现顺序编号成 `图1/图2`（`imageReferenceLabel(index)`）；视频/音频用 `seedanceReferenceLabel`。生成时这些 label 注入 prompt，确保模型按固定顺序理解多图。

### 参考解析（`canvas-resource-references.ts`）
- `buildCanvasResourceReferences` / `getGenerationResourceNodes`：优先取"配置节点的上游参考"，回退到自身上游。
- `getConnectedConfigResourceNodes`：若该节点是某 config 的上游，则用 config 的其它上游作为参考集合。这是"@\[node:xxx\]"连线即输入的关键。

### Agent 生成流构造（`canvas-agent/src/canvas-session.ts` 的 `generationFlowOps`）
本地/在线 Agent 创建一个"生成流"时一次性产出多 op：

```ts
[
  add_text_node(id=textId, text=prompt),
  add_config_node(id=configId, prompt="@[node:textId]\n@[node:refN]...", mode, options...),
  connect(textId -> configId),
  ...refs.map(r => connect(r -> configId)),
  select([configId]),
  ...(autoRun ? [run_generation(configId, mode, tokens)] : [])
]
```

即 Agent 一次工具调用就能在画布上生成"提示词节点 + 配置节点 + 连线 + 触发执行"的完整闭环。

## 5. 画布助手（在线 + 本地双模）

### 在线助手（`canvas-assistant-panel.tsx`）
- **纯浏览器内 Tool-Calling Agent**：调用 `requestToolResponse`（见 §6），把 23 个 `canvas_*` 工具声明喂给用户自配的文本模型，`tool_choice:"required"` 强制首轮必调工具，最多 `ONLINE_AGENT_MAX_STEPS=4` 步循环。
- 工具与本地 Agent 的 MCP schema 完全对齐（见 §7），同一份 `CANVAS_OP_SCHEMA`（add/update/delete/connect/set_viewport/select/run_generation）。
- 工具执行直接走 `executeOnlineTool -> onlineToolToOps -> executeOps -> onApplyOps`，直接改前端画布 store。
- `confirmTools` 开关：写操作需弹卡片人工确认（approveOnlineTool / rejectOnlineTool）。
- 上下文注入：`buildToolAgentMessages(snapshot, history, userMessage)` 把当前画布快照（节点的紧凑形态）拼进 system / user 消息。
- 系统 prompt（`ONLINE_AGENT_PROMPT`）：要求只读问题先调 `canvas_get_state`，改动画布用 infinite-canvas 工具，不输出 JSON ops，不编造结果，节点 id 必须用真实 id。

### 本地 Agent（`canvas-local-agent-panel.tsx` + `canvas-agent/`）
- 面板默认 `agentUrl=http://127.0.0.1:17371`，通过 SSE `/events` 连接，token 认证。
- 连接后网页把画布快照通过 `POST /api/canvas/update-state` 推给 Agent；Agent 工具调用以 `tool_call` SSE 事件下发，网页在 30s 内回 `resolveResult`。
- 目的是让 **本地 Codex / Claude Code CLI** 通过 MCP 操控当前网页画布，生成结果"流回"画布。

### Canvas Agent Op（`utils/canvas-agent-ops.ts`）
统一 8 种 op，是两套助手与 Agent 之间的唯一写接口：

```ts
type CanvasAgentOp =
 | { type:"add_node"; nodeType; title?; position?; width?; height?; metadata? }
 | { type:"update_node"; id; patch?; metadata? }
 | { type:"delete_node"; ids?; all? }
 | { type:"delete_connections"; ids }
 | { type:"connect_nodes"; fromNodeId; toNodeId }
 | { type:"set_viewport"; viewport }
 | { type:"select_nodes"; ids }
 | { type:"run_generation"; nodeId; mode; prompt? }
```

`summarizeCanvasAgentOps` 给工具结果回执生成人类可读文本。

## 6. AI 接口与 BYOK（`web/src/services/api/image.ts` + `use-config-store.ts`）

### 配置（`use-config-store.ts`）
`AiConfig`：`channelMode(remote|local) / baseUrl / apiKey / apiFormat(openai|gemini) / model / imageModel / videoModel / textModel / audioModel / systemPrompt / quality / size / count / 秒/质量等`，外加 `ModelChannel[]` 多通道（每个 channel 自带 baseUrl/apiKey/apiFormat）。`resolveModelRequestConfig` 按模型名解析到具体 channel。
- `client-root-init.tsx` 支持 URL 参数 `?baseUrl=...&apiKey=...` 自动写入第一个 channel，用于一键预配。

### 直连实现（`image.ts`，关键事实）
- **浏览器直连，无后端中转。** Authorization `Bearer ${apiKey}` 或 Gemini `x-goog-api-key`。
- 支持 `apiFormat:"openai"` 和 `"gemini"` 两套协议：
  - OpenAI：`/images/generations`、`/images/edits`（multipart，多参考图 + 可选 mask）、`/responses`（流式，消费 `response.output_text.delta` / `response.completed`，支持函数调用）。
  - Gemini：`:generateContent` / `:streamGenerateContent?alt=sse`，message↔contents 转换、`functionCall` / `functionResponse` 映射。
- 图片尺寸约束：`QUALITY_BASE`（low 1024 / medium 2048 / high 2880），16 像素对齐，最长边 ≤3840，比例 ≤3:1，像素区间 [655360, 8294400]。`resolveSize` 按 quality + ratio 反推 `WxH`。
- 出口函数：`requestGeneration / requestEdit / requestImageQuestion / requestToolResponse / fetchImageModels / fetchChannelModels`。
- 错误处理：401/403→鉴权失败，429→限流/额度。axios 取消 / AbortError →"请求已取消"。
- 安全含义：API Key 存浏览器本地；前端越域直连第三方接口（用户需自备可跨域的网关或支持 CORS 的供应商）。

## 7. 本地 Agent（`canvas-agent/`）详解

### 入口（`src/index.ts`）
`mcp` 参数 → 启 MCP server（stdio，供 Codex/Claude 注册）；否则 → 启 HTTP server（默认 17371）。

### HTTP server（`http-server.ts`）
- Express + CORS + token 认证 + Origin 白名单。
- `/health` `/config` `/events`(SSE) `/api/tools` `/api/threads` 等。
- SSE 保活：15s 一次 `ping`。

### MCP server（`mcp-server.ts` + `schemas.ts`）
注册 **23 个画布工具**，通过 `POST /api/tools` 转发回本地 HTTP Server 的 `CanvasSession.callTool`：

```
canvas_get_state / canvas_get_selection / canvas_export_snapshot / canvas_apply_ops
canvas_create_node / canvas_create_text_node / canvas_create_text_nodes
canvas_create_config_node / canvas_create_image_prompt_flow / canvas_create_generation_flow
canvas_generate_text / image / video / audio
canvas_update_node / canvas_update_node_text / canvas_move_nodes / canvas_resize_node
canvas_delete_nodes / canvas_connect_nodes / canvas_select_nodes / canvas_set_viewport / canvas_run_generation
```

### Canvas 会话（`canvas-session.ts`）
- 维护 `clients`(SSE 连接) 与 `canvasState`（网页推上来的快照）。
- 23 个工具最终都归约成 `canvas_apply_ops`（读类工具直接读快照），通过 `requestCanvasTool` 以 `tool_call` SSE 下发到网页，30s 超时。
- `nextCanvasX` / `compactCanvasState` / `compactNode`：把画布压缩成给模型的紧凑 JSON。

### 桥接 Codex / Claude（`agents.ts`）
- `runClaudeTurn`：`claude -p --output-format stream-json --allowedTools mcp__infinite-canvas__*`。
- Codex 走 `CodexAppClient`：`codex app-server --stdio`，JSON-RPC over stdin/stdout，`thread/start` `thread/resume` `turn/start`，`approvalPolicy:"never"`、`sandbox:"workspace-write"`，`codexQueue` 串行执行，断线自动重启。

### 配置（`config.ts`）
- `~/.infinite-canvas/canvas-agent.json` 存 token / origin / workspace / port。
- `DEFAULT_PORT=17371`。
- 内置 `AGENT_PROMPT` 系统提示。

## 8. Codex 插件（`plugins/infinite-canvas/`）
- `.codex-plugin/plugin.json`：声明 `skills` + `mcpServers` + 默认 prompt（"打开 Infinite Canvas / 读取当前画布 / 根据选中节点创建一组生图提示词"）。
- `.mcp.json`：`npx -y @basketikun/canvas-agent mcp`，startup 20s / tool 90s 超时。
- `skills/canvas/SKILL.md` 与 `skills/open-canvas/SKILL.md`：教 Codex "打开画布、读节点、创建生图流程"的技能描述。
- 安装：`codex plugin marketplace add ~ && codex plugin add infinite-canvas@personal`。
- 关键点：插件拉起 MCP，MCP 启动时自动尝试起本地 Agent；Agent 检查 3000 端口归属避免误识别。

## 9. 文档与提示词库

### 文档站（`docs/`，独立 Fumadocs）
- 独立 Next 16 应用，结构 `content/docs/{overview,backend,canvas,business,progress,support}`。
- `index.md` 明确两条事实：① 画布项目与素材主要在浏览器本地，跨设备可用 WebDAV；② AI API Key 保存在浏览器本地，前端直连 OpenAI 兼容接口。
- `backend/canvas-data-structure.mdx` 完整描述了 localForage 4 个 store（`app_state` 存 JSON、`image_files`/`media_files` 存 Blob、`asset_store` 存素材）和图片迁移/清理（按 `storageKey` 引用计数回收）。

### 提示词库聚合（`web/src/app/api/prompts/route.ts`）
- 这是**整个仓库唯一有意义的后端型逻辑**，但仍只是 Next.js Route Handler。
- 从 6 个 GitHub raw 仓库聚合（gpt-image-2、awesome-gpt-image、awesome-gpt4o-image-prompts、youmind-gpt-image-2、youmind-nano-banana-pro、davidwu-gpt-image2-prompts）。
- `runtime:"nodejs"`、`dynamic:"force-dynamic"`。
- **进程内内存缓存**：`memoryCache` 变量 + `loadingPrompts` 去重并发，`cacheTtlMs=1h`。无 Redis、无持久化、多实例不共享。
- 解析方式：拉各仓库 README.md / prompts.json，正则提取 `### 标题` + 提示词代码块 + 图片，按 tag / 关键词 / 分类分页过滤。

## 10. 对 Floavrt 的迁移取舍建议

> Floavrt 技术约定：Vite 静态前端 + Go(Gin + GORM) 后端 + `handler/service/repository/model` 分层 + `{code,data,msg}` 响应。本节按这个目标对齐。

### A. 直接复用（搬到 Go/前端几乎不用改思路）
1. **Workflow 节点模型与连线**：`CanvasNodeType` 五类 + `CanvasNodeData` + `CanvasConnection` 结构可以直接成为 Go `model.CanvasNode`。Floavrt 要把项目存数据库时，把这个结构做成 JSONB 一列即可。
2. **CanvasAgentOp 8 种 op**：这是助手/Agent 改画布的唯一写入协议，应整体保留，未来 Go service 的 `ApplyOps` 入口直接接这套 schema。
3. **23 个 MCP 工具 schema**：直接搬成 Go service 的 openapi/工具定义，前端 Tool-Calling 与本地 Agent MCP 共用同一份描述，最强复用点。
4. **生成参数约束**（16 像素对齐、≤3840、≤3:1、像素区间）：纯算法，原样移植到 Go `service/imagegen`。
5. **资源引用 label（图1/图2、seedance 顺序）**：保留语义，避免改 AI 理解顺序。
6. **Generation Flow 构造逻辑**（`generationFlowOps`：文本+config+连线+run_generation）：搬到 Go service 的"批量创建节点+连线+触发"原子事务。

### B. 重写（必须按 Go 后端范式重新实现）
1. **持久化层**：原仓全在 localForage。Floavrt 必须落 MySQL/PG：`canvas_projects / canvas_nodes / canvas_connections / chat_sessions / assets / image_files`。沿用 GORM AutoMigrate，写进 `docs/backend-database.md`。
2. **AI Key 管理**：原仓 key 存浏览器、前端直连。Floavrt 应改成 Go service 持有密钥、前端不接触 raw key；保留"BYOK"但 key 落库加密 + 后端代理转发，解决 CORS 与泄露问题。
3. **AI 接口适配**：OpenAI/Gemini 双格式、流式 SSE 解析、工具调用映射，整体搬到 Go service（用成熟库如 `sashabaranov/go-openai` + 手写 Gemini 转换），`repository` 层做 provider 适配，`service` 做 prompt/参数/参考图组装。
4. **提示词库聚合**：原 `prompts/route.ts` 的内存缓存 + GitHub 拉取，应下沉为 Go service + 定时任务 + DB 缓存（带 `fetched_at`、etag），`handler` 暴露 `/api/prompts` 分页。
5. **本地 Agent**：原 `canvas-agent` 是浏览器 ↔ 本地 CLI 的桥。Floavrt 若保留本地 Agent 能力，可把它改成"连 Go 后端 WebSocket 的瘦客户端"，或保持 MCP + SSE 但回源 Go service；务必在文档写清这是本地进程、不存储密钥。
6. **URL 参数注入配置**（`client-root-init.tsx`）：迁移后只做"演示用预配"入口，真配置走 Go 后端账号体系。

### C. 不建议照搬
1. **进程内内存缓存做提示词库**：多实例失效，迁到 Go 后端用 Redis 或 DB。
2. **Dockerfile 只跑 Next.js**：Floavrt 是前后端分离，compose 要加 Go service + DB。
3. **API Key 暴露在前端** 与项目"安全说明"自相矛盾的部分——Floavrt 应在后端代理。

### D. 关键风险与待澄清问题（请用户决策）
1. **本地 Agent 在 Floavrt 是否保留?** 保留则需兼容 Codex/Claude CLI 桥接，工程量大；去掉则失去"本地大模型驱动画布"卖点。
2. **画布数据是否仍主要存浏览器?** Floavrt 既然后端 Go+GORM，按 §A.1 落库更合理；但若要离线/零后端产品形态则保留 localForage，这是产品方向决策。
3. **BYOK by 前端 vs 后端代理?** 前端直连性能好但有 CORS 与泄露风险；后端代理安全但成本与延迟上升。需用户拍板。
4. **是否保留 docs 独立 Fumadocs 站?** Floavrt 已有 `docs/content/docs/**` 约定，文档站是否复用此结构而非独立 Fumadocs 工程。
5. **Framer Motion `motion/react` 版本与 AntD v6 在 Vite 下的适配**：原仓 Next webpack，迁 Vite 需验证 motion v? + antd v6 的 SSR/打包。

## 附录 A：关键文件索引（绝对路径，相对仓库根）

- `web/package.json`、`web/src/app/(user)/canvas/types.ts`
- `web/src/app/(user)/canvas/constants.ts`（NODE_DEFAULT_SIZE / NODE_SPECS）
- `web/src/app/(user)/canvas/stores/use-canvas-store.ts`（Zustand+localForage）
- `web/src/app/(user)/canvas/stores/use-canvas-agent-store.ts`
- `web/src/app/(user)/canvas/utils/canvas-agent-ops.ts`（8 种 op + summarize）
- `web/src/app/(user)/canvas/utils/canvas-resource-references.ts`
- `web/src/app/(user)/canvas/components/canvas-assistant-panel.tsx`（在线助手/Tool-Calling）
- `web/src/app/(user)/canvas/components/canvas-local-agent-panel.tsx`
- `web/src/stores/use-config-store.ts`（AiConfig/ModelChannel/apiFormat）
- `web/src/components/layout/client-root-init.tsx`（URL 注入配置）
- `web/src/services/api/image.ts`（OpenAI/Gemini 直连）
- `web/src/app/api/prompts/route.ts`（提示词库聚合 + 1h 内存缓存）
- `canvas-agent/src/{index,http-server,mcp-server,schemas,canvas-session,agents,config,tools}.ts`
- `plugins/infinite-canvas/.codex-plugin/plugin.json`、`.mcp.json`、`skills/*/SKILL.md`
- `docs/content/docs/backend/canvas-data-structure.mdx`（存储/迁移/清理机制）
- `Dockerfile`、`docker-compose.yml`、`docker-compose.local.yml`、`render.yaml`

## 附录 B：事实校验清单

- 全仓 `**/*.go` 命中数：0（无 Go 后端）。
- 全仓 `*.ts` 中 `r\.(GET|POST|PUT|DELETE|Group)` 命中数：0（无类 Gin 路由）。
- Dockerfile 仅构建并运行 Next.js standalone（`node server.js`，端口 3000）。
- `docs/index.md` 明示：画布与素材主要在浏览器本地，可自配 WebDAV；API Key 存浏览器，前端直连 OpenAI 兼容接口。
- 提示词库为 Route Handler + 1 小时进程内内存缓存，无持久化。
- 23 个 MCP 工具名与 http-tools 注册名一一对应，与在线助手工具定义一一对应。

---

报告完。
