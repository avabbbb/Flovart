---
name: flovart
description: "Flovart AI Canvas Studio 操作技能 — 通过代码操控 Flovart 全功能：图片生成、视频生成、多Agent协作、节点工作流、画布元素操作、Provider配置、Extension构建。支持 17 个 AI Provider（Google/OpenAI/Anthropic/RunningHub/MiniMax 等）。当用户提到 Flovart、AI画布、Canvas Studio、画布生成、AI Canvas 时触发。"
argument-hint: "描述你要在 Flovart 中做什么（如：添加新 Provider、生成图片、配置工作流）"
user-invocable: true
disable-model-invocation: false
---

# Flovart AI Canvas Studio 操作技能

> 让 AI 助手（Copilot / Claude Code / Codex）直接操控 Flovart 项目——从 Provider 配置到图片/视频生成、多 Agent 协作、节点工作流配置、画布元素操作，全链路代码级掌控。

## 自动化脚本

本 Skill 提供 3 个自动化脚本，Agent 可直接运行完成多文件联动操作：

### add-provider — 添加新 AI Provider（自动修改 6 个文件）

```bash
node skills/flovart/scripts/add-provider.js \
  --name "myProvider" \
  --label "My Provider" \
  --models "text:model-a,model-b;image:model-img-1;video:model-vid-1" \
  --keyPrefix "^mp-" \
  --modelPrefix "^myp" \
  --baseUrl "https://api.myprovider.com/v1"
```

自动修改: `types.ts`, `services/aiGateway.ts`(3处), `services/baseUrl.ts`

### add-agent-role — 添加 Agent 角色

```bash
node skills/flovart/scripts/add-agent-role.js \
  --id "brand_strategist" \
  --name "品牌策略师" \
  --emoji "📊" \
  --color "#3B82F6" \
  --description "从品牌视角审视视觉方案" \
  --systemPrompt "你是一位品牌策略师..."
```

自动修改: `types.ts`(AgentRoleId), `services/agentOrchestrator.ts`(PRESET_ROLES)

### add-workflow-template — 添加节点工作流模板

```bash
node skills/flovart/scripts/add-workflow-template.js \
  --name "myTemplate" \
  --label "My Workflow" \
  --json '{"nodes":[{"id":"n1","kind":"prompt","x":100,"y":100}],"edges":[]}'
```

自动修改: `components/nodeflow/templates.ts`

---

## 触发条件

当用户提到以下关键词时激活：
- "flovart"、"AI画布"、"canvas studio"、"AI canvas"
- "配置API"、"添加provider"、"模型切换"
- "生成图片"、"生成视频"、"画布操作"
- "agent对话"、"多agent"、"agent协作"
- "节点工作流"、"workflow"、"DAG"
- "扩展构建"、"extension build"、"上架商店"
- 任何涉及操作 Flovart 源码、配置或构建的请求

## 项目概览

**Flovart** 是一个纯前端 AI Canvas Studio（React 19 + TypeScript + Vite + Tauri），数据存储在本地（localStorage + AES-GCM 加密 keyVault）。

- **仓库**: `https://github.com/Paker-kk/Flovart`
- **Pages**: `https://paker-kk.github.io/Flovart/`
- **技术栈**: React 19.1 / TypeScript 5.8 / Vite 6 / Tailwind 4 / Tauri 2.10 / Tiptap 3.20
- **测试**: Vitest 4.1（`npm run test`）
- **构建**: `npm run build`（Web）/ `npm run tauri:build`（桌面）/ `npm run ext:build`（扩展）

---

## 代码架构

```
Flovart/
├── index.tsx              # 入口，挂载 App
├── App.tsx                # 核心编排器（画布状态+UI+生成逻辑）
├── types.ts               # 全局类型定义
├── translations.ts        # 中英双语
├── styles.css             # CSS变量驱动样式
│
├── hooks/
│   ├── useApiKeys.ts      # API Key 管理（加密存储+多Provider路由）
│   ├── useGeneration.ts   # 所有图片/视频生成逻辑
│   └── useCanvasInteraction.ts  # 画布交互（拖拽/缩放/选择/绘制）
│
├── services/
│   ├── aiGateway.ts       # 统一AI网关（17 Provider路由）
│   ├── geminiService.ts   # Google Gemini/Imagen/Veo 专用
│   ├── runningHubService.ts  # RunningHub ComfyUI 云端
│   ├── bananaService.ts   # Banana 视觉Agent
│   ├── modelFetcher.ts    # 模型列表发现+缓存
│   ├── baseUrl.ts         # URL规范化工具
│   ├── agentOrchestrator.ts  # 多Agent圆桌讨论
│   └── workflowEngine.ts  # DAG节点工作流执行器
│
├── components/
│   ├── PromptBar.tsx      # 底部提示词输入+模型选择
│   ├── AgentChatPanel.tsx # Agent聊天面板
│   ├── NodeWorkflowPanel.tsx  # 节点工作流可视化编辑器
│   ├── RightPanel.tsx     # 右侧面板（生成/历史/设置）
│   ├── Toolbar.tsx        # 左侧工具栏
│   ├── WorkspaceSidebar.tsx  # 工作区侧栏
│   └── nodeflow/          # 节点工作流子系统
│       ├── defs.ts        # SVG定义
│       ├── graph.ts       # 图算法（拓扑排序+布局）
│       ├── templates.ts   # 预设工作流模板
│       ├── types.ts       # 节点/边/端口类型
│       └── useNodeWorkflowStore.ts  # 工作流状态管理
│
├── utils/
│   ├── keyVault.ts        # AES-GCM加密API Key存储
│   ├── generationHistory.ts  # 生成历史持久化
│   ├── canvasHelpers.ts   # 画布几何计算
│   ├── assetStorage.ts    # 资产库存储
│   ├── fileUtils.ts       # 文件处理
│   ├── uiScale.ts         # UI缩放计算
│   └── usageMonitor.ts    # 用量监控
│
├── extension/             # Chrome/Edge 扩展（MV3）
│   ├── manifest.json
│   ├── background/service-worker.js
│   ├── content/content.js
│   └── popup/popup.html + popup.js
│
├── tests/                 # Vitest 测试套件
└── src-tauri/             # Tauri 桌面壳
```

---

## 一、Provider 与 API Key 管理

### 支持的 17 个 Provider

| Provider | AIProvider值 | 能力 | Key前缀 |
|----------|-------------|------|---------|
| Google | `google` | text/image/video | `AIzaSy` |
| OpenAI | `openai` | text/image | `sk-` |
| Anthropic | `anthropic` | text | `sk-ant-` |
| DeepSeek | `deepseek` | text | `sk-` |
| 通义千问 | `qwen` | text | — |
| SiliconFlow | `siliconflow` | text | `sk-` |
| RunningHub | `runningHub` | image | 32位hex |
| Banana | `banana` | agent | — |
| 可灵 | `keling` | — | — |
| Flux | `flux` | — | — |
| Midjourney | `midjourney` | — | — |
| MiniMax | `minimax` | text/image/video | — |
| 火山引擎 | `volcengine` | text | — |
| OpenRouter | `openrouter` | text/image | `sk-or-` |
| Custom | `custom` | 自定义 | — |

### 添加新 Provider

在 `services/aiGateway.ts` 的 `DEFAULT_PROVIDER_MODELS` 中注册：

```typescript
// 在 DEFAULT_PROVIDER_MODELS 中添加
newProvider: {
    text: ['model-a', 'model-b'],
    image: ['model-img-1'],
    video: ['model-vid-1'],
},
```

同时需要更新：
1. `types.ts` → `AIProvider` 联合类型，加入新值
2. `services/aiGateway.ts` → `PROVIDER_LABELS` 加中文标签
3. `services/aiGateway.ts` → `inferProviderFromKey()` 加前缀识别规则
4. `services/aiGateway.ts` → `generateImageWithProvider()` / `generateVideoWithProvider()` 加路由分支
5. `services/baseUrl.ts` → `normalizeProviderBaseUrl()` 加默认 base URL
6. `translations.ts` → 加翻译词条
7. `components/PromptBar.tsx` → 确认模型选择器能显示

### API Key 存储机制

**Web端**:
- 加密存储: `keyVault.ts` → AES-GCM + PBKDF2, salt=random 16字节, passphrase=origin+userAgent
- localStorage key: `userApiKeys.v1.vault`
- 旧格式自动迁移: `userApiKeys.v1` (明文) → vault格式

**Extension端**:
- Chrome storage: `flovart_user_api_keys` (⚠️ 当前为base64，非真正加密)
- popup.js 直接读写 `chrome.storage.local`

### Key 解析流程

```
useApiKeys.getPreferredApiKey(capability, provider?)
  → 1. 找 isDefault===true 且匹配 capability 的 key
  → 2. 找任意匹配 capability 的 key
  → 3. 找匹配 provider 的 key
  → 4. null（触发"请配置API Key"提示）
```

---

## 二、图片生成

### 入口函数

```typescript
// hooks/useGeneration.ts
handleGenerate(promptOverride?: string, source?: 'prompt' | 'right' | 'agent')
```

### 生成流程

1. 用户在 PromptBar 输入 prompt + 选择模型
2. `handleGenerate()` → 根据 `generationMode` 分流
3. 图片模式 → `aiGateway.generateImageWithProvider(prompt, model, key)`
4. Provider 路由：
   - Google → `geminiService.generateImageFromText()` (Imagen 4.0)
   - OpenAI → `/images/generations` REST
   - RunningHub → `runningHubService.rhRunTask()` (ComfyUI工作流)
   - OpenRouter → 转发到对应后端
5. 结果 → base64 dataUrl → 创建 `ImageElement` → 放置到画布

### 图片编辑

```typescript
// 重绘（inpaint）
handleInpaint()  // 使用 mask + prompt 局部编辑

// 外扩（outpaint）
handleOutpaint(element, direction, expandRatio)

// 超分（upscale）
handleUpscaleImageWithBanana(element)

// 去背景
handleRemoveBackgroundWithBanana(element)

// 图层分割
handleSplitImageWithBanana(element)
```

### 提示词增强

```typescript
handleEnhancePrompt({ prompt, mode, stylePreset })
// mode: 'smart' | 'style' | 'precise' | 'translate'
// 返回: { enhancedPrompt, negativePrompt, suggestions, notes }
```

---

## 三、视频生成

### 支持的视频模型

| Provider | 模型 | 能力 |
|----------|------|------|
| Google | veo-3.1-generate-preview | 文生视频 + 图生视频 |
| Google | veo-3.1-lite-generate-preview | 轻量版 |
| Google | veo-2.0-generate-001 | 稳定版 |
| MiniMax | video-01 | 文生视频 |

### 生成流程

```
handleGenerate() → generationMode === 'video'
  → geminiService.generateVideo(prompt, options)
    → 轮询机制: 10s间隔, 10分钟超时
    → 返回: { videoBlob, mimeType }
  → 创建 VideoElement → 放置到画布
```

### 视频参数

```typescript
{
  aspectRatio: '16:9' | '9:16',
  referenceImages?: ImageInput[],  // 参考图
  model: string,
}
```

---

## 四、多 Agent 协作系统

### 5 个预设角色

| 角色ID | 名称 | Emoji | 职责 |
|--------|------|-------|------|
| `creative_director` | 创意总监 | 🎬 | 构思画面内容和叙事 |
| `prompt_engineer` | 提示词工程师 | ✍️ | 将想法转为精准提示词 |
| `style_master` | 风格大师 | 🎨 | 决定艺术风格和色调 |
| `compositor` | 构图师 | 📐 | 决定画面构图和视角 |
| `quality_reviewer` | 质量审查 | ✅ | 审查最终提示词并提出修改 |

### Agent 会话流程

```
createSession(team, budget)
  → AgentOrchestrator(session, apiKeys, model)
  → loop rounds:
      for each enabled agent:
        → buildConversationContext(history)
        → callLLM(model, systemPrompt, context)
        → estimateCost(response)  // 3 chars ≈ 1 token
        → emit onMessage()
  → detect [FINAL_PROMPT]...[/FINAL_PROMPT]
  → onFinalPrompt() → 自动触发图片生成
```

### 预算控制

```typescript
interface AgentBudget {
  maxCost: number;    // 美元上限
  maxRounds: number;  // 最大轮数
}
// 费率 (近似):
// gpt-5.4: $0.005/1K tokens
// claude-opus-4-6: $0.015/1K tokens
// gemini-3-flash: $0.0001/1K tokens
```

### 添加自定义 Agent 角色

在 `services/agentOrchestrator.ts` 的 `PRESET_ROLES` 数组追加：

```typescript
{
    id: 'your_role_id',
    name: '角色名',
    emoji: '🎯',
    color: '#hex',
    description: '一句话描述',
    systemPrompt: `详细的系统提示词...`,
}
```

---

## 五、节点工作流系统

### 支持的节点类型

| kind | 输入端口 | 输出端口 | 用途 |
|------|---------|---------|------|
| `prompt` | — | text | 文本输入源 |
| `loadImage` | — | image | 图片输入源 |
| `llm` | text | text | LLM文本处理 |
| `enhancer` | text | text | 提示词增强 |
| `imageGen` | text, image? | image | 图片生成 |
| `videoGen` | text, image? | video | 视频生成 |
| `httpRequest` | text | text | HTTP API调用 |
| `runningHub` | text, image? | image | RunningHub任务 |
| `template` | text | text | 文本模板填充 |
| `condition` | text | text | 条件分支 |
| `merge` | textA, textB | text | 文本合并 |
| `preview` | image/text/video | — | 预览输出 |
| `saveToCanvas` | image | — | 放置到画布 |

### 工作流 JSON 格式

```typescript
interface WorkflowNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  config?: Record<string, unknown>;
}

interface WorkflowEdge {
  id: string;
  fromNode: string;
  fromPort: string;
  toNode: string;
  toPort: string;
}
```

### 创建工作流模板

在 `components/nodeflow/templates.ts` 添加：

```typescript
export const myTemplate: { nodes: WorkflowNode[]; edges: WorkflowEdge[] } = {
  nodes: [
    { id: 'n1', kind: 'prompt', x: 100, y: 100, config: { text: '默认提示词' } },
    { id: 'n2', kind: 'enhancer', x: 350, y: 100, config: { mode: 'smart' } },
    { id: 'n3', kind: 'imageGen', x: 600, y: 100, config: { model: 'imagen-4.0-generate-001' } },
    { id: 'n4', kind: 'saveToCanvas', x: 850, y: 100 },
  ],
  edges: [
    { id: 'e1', fromNode: 'n1', fromPort: 'text', toNode: 'n2', toPort: 'text' },
    { id: 'e2', fromNode: 'n2', fromPort: 'text', toNode: 'n3', toPort: 'text' },
    { id: 'e3', fromNode: 'n3', fromPort: 'image', toNode: 'n4', toPort: 'image' },
  ],
};
```

### 执行流程

```
runGraph(nodes, edges, context)
  → topologicalSort(nodes, edges)  // 含环检测
  → for each node in sorted order:
      → collectInputs(node, edges, outputsMap)
      → executeNode(node, inputs, context)
      → storeOutputs(node.id, result)
  → 错误: 逐节点log，不中断整体
```

---

## 六、画布元素操作

### Element 类型体系

```typescript
type Element =
  | ImageElement    // { id, x, y, width, height, href, filters, mask, ... }
  | VideoElement    // { id, x, y, width, height, href, posterHref, ... }
  | PathElement     // { id, points, strokeColor, strokeWidth, ... }
  | ShapeElement    // { id, x, y, shape: 'rectangle'|'circle'|'triangle', ... }
  | TextElement     // { id, x, y, text, fontSize, fontFamily, ... }
  | ArrowElement    // { id, startX, startY, endX, endY, ... }
  | LineElement     // { id, startX, startY, endX, endY, ... }
  | GroupElement    // { id, childIds, ... }
```

### 画布状态结构

```typescript
interface Board {
  id: string;
  name: string;
  elements: Element[];
  history: Element[][];         // undo/redo堆栈
  panOffset: { x: number; y: number };
  zoom: number;
  canvasBackgroundColor: string;
}
```

### 通过代码放置元素到画布

在 `App.tsx` 中，通过 `commitAction()` 修改画布：

```typescript
// 添加图片到画布
const newImage: ImageElement = {
  id: crypto.randomUUID(),
  type: 'image',
  x: 100,
  y: 100,
  width: 512,
  height: 512,
  href: 'data:image/png;base64,...',
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
};
commitAction([...elements, newImage]);
```

---

## 七、Extension 构建与上架

### 构建

```bash
npm run ext:build
# 输出: dist-extension/
```

### 目录结构

```
dist-extension/
├── manifest.json     # MV3 manifest
├── app/index.html    # 嵌入的Canvas应用
├── background/service-worker.js
├── content/content.js + content.css
├── popup/popup.html + popup.js + popup.css
└── icons/            # 16/32/48/128 px
```

### Chrome Web Store 上架清单

1. **manifest.json** 版本号递增
2. **隐私政策** URL（必须可公开访问）
3. **权限说明** — 解释 `<all_urls>`、`contextMenus`、`storage` 的用途
4. **CSP** — popup.html 需要 Content-Security-Policy
5. **截图** — 1280×800 或 640×400，至少1张最多5张
6. **图标** — 128×128 商店图标
7. **分类** — "Productivity" 或 "Developer Tools"
8. **$5 开发者注册费**

### Edge Add-ons 上架

Edge 兼容 MV3，使用相同 dist-extension 包：
1. 前往 `https://partner.microsoft.com/dashboard/microsoftedge`
2. MV3 manifest 无需修改
3. 审核通常 1-3 个工作日

### ⚠️ 安全修复（上架前必须）

**P0: Extension API Key 加密**

当前 `popup.js` 存储明文 base64 key 到 `chrome.storage.local`。修复方案：

```javascript
// popup.js — 用 Web Crypto API 加密
async function encryptKey(key) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(chrome.runtime.id), 'PBKDF2', false, ['deriveKey']
  );
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('flovart-ext'), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, enc.encode(key));
  return { iv: Array.from(iv), ct: Array.from(new Uint8Array(ct)) };
}
```

**P0: useApiKeys Chrome bridge 加密**

`encodeKeysForStorage()` 当前用 base64，需替换为真正加密（与 keyVault.ts 同方案）。

---

## 八、常用命令速查

```bash
# 开发
npm install          # 安装依赖
npm run dev          # 启动开发服务器 (Vite)
npm run build        # 构建生产版本
npm run test         # 运行测试 (Vitest)
npx tsc --noEmit     # TypeScript 类型检查（可能有预存问题）

# 桌面应用
npm run tauri:dev    # Tauri 开发模式
npm run tauri:build  # Tauri 打包

# 扩展
npm run ext:build    # 构建 Chrome/Edge 扩展
```

---

## 九、与其他 Skill 的协作矩阵

Flovart 作为中枢，与其他 Skill 的对接方式：

| 协作 Skill | 对接方式 | 数据流向 |
|-----------|---------|---------|
| `aigc-storyboard` | 生成分镜 JSON → Flovart 批量创建 ImageElement | Skill → Flovart |
| `midjourney-prompt` | 生成MJ提示词 → 填入 PromptBar | Skill → Flovart |
| `runninghub-api` | Flovart 调用 RunningHub service 执行工作流 | Flovart → API |
| `runninghub-batch` | 批量任务提交 → 结果批量导入画布 | 双向 |
| `libtv-skill` | LibTV生成 → 下载结果 → 放入画布 | Skill → Flovart |
| `ffmpeg-compose` | 导出画布视频元素 → FFmpeg合成 | Flovart → Skill |
| `capcut-mate` | 导出到剪映时间线 | Flovart → Skill |
| `baoyu-translate` | 翻译提示词 / UI文案 | 双向 |
| `remotion` / `video-toolkit` | 编程化视频渲染 | Flovart → Skill |
| `social-push` / `typefully` | 导出画布截图+文案 → 发布 | Flovart → Skill |

---

## 十一、Runtime API（Phase 2）— 实时操控运行中的画布

Flovart 暴露 `window.__flovartAPI` 供 AI Agent 脚本实时操控画布。

### 连接方式

```bash
# 1. 以调试模式启动Chrome
chrome --remote-debugging-port=9222

# 2. 打开 Flovart（localhost:5173 或扩展页）

# 3. 运行脚本
node skills/flovart/scripts/canvas-query.js
node skills/flovart/scripts/generate-image.js --prompt "a cute cat"
node skills/flovart/scripts/batch-generate.js --file prompts.txt
```

### API 表面

| 方法 | 描述 |
|------|------|
| `canvas.addElement(partial)` | 添加元素到画布，返回 id |
| `canvas.getElements()` | 获取所有元素（仅元数据，不含 base64） |
| `canvas.removeElement(id)` | 删除指定元素 |
| `canvas.updateElement(id, updates)` | 更新元素属性 |
| `canvas.clear()` | 清空画布 |
| `canvas.getSelected()` | 获取当前选中元素 id 列表 |
| `canvas.select(ids)` | 设置选中元素 |
| `generate.image(prompt, source?)` | 触发图片生成 |
| `view.getZoom()` | 获取当前缩放级别 |
| `view.getPan()` | 获取当前平移偏移 |
| `config.getProviders()` | 获取所有已配置的 Provider 名称 |

### FlovartClient 编程使用

```javascript
const { FlovartClient } = require('./skills/flovart/scripts/flovart-client');
const client = new FlovartClient();
await client.connect();
await client.addElement({ type: 'text', text: 'Hello from Agent', x: 100, y: 100 });
const elements = await client.getElements();
await client.generateImage('cyberpunk city at sunset');
await client.disconnect();
```

### CLI 快捷模式

```bash
node skills/flovart/scripts/flovart-client.js canvas.getElements
node skills/flovart/scripts/flovart-client.js canvas.addElement '{"type":"text","text":"Hi"}'
node skills/flovart/scripts/flovart-client.js generate.image "a cat"
```

### 一站式 CLI 入口（推荐）

装完 skill 后只跑一个文件即可——不用记 `npm run flovart:cli --`：

```bash
# 任何位置、任何环境只要在 Flovart 仓库根目录就能跑
node skills/flovart/scripts/flovart-cli.mjs status --json
node skills/flovart/scripts/flovart-cli.mjs canvas.inspect --json
node skills/flovart/scripts/flovart-cli.mjs canvas.add-image --url "https://..." --x 100 --y 100
node skills/flovart/scripts/flovart-cli.mjs generate.image "a cat"
node skills/flovart/scripts/flovart-cli.mjs provider.status --json
```

**自动路径搜索**（找到第一个存在就停）：
1. 环境变量 `FLOVART_CLI`（强制覆盖）
2. `../../tools/flovart/cli.js`（skill 在仓库内）
3. `../../../tools/flovart/cli.js`（skill 装到 `~/.claude/skills/`）
4. 当前工作目录 `tools/flovart/cli.js`（在仓库根跑）

**等价于：** `npm run flovart:cli -- <command> --json`

用户装完桌面 app 之后，`FLOVART_CLI` 也可指向安装路径（未来 Release 把 CLI 集成进安装包时用）。

### 扩展 Bridge（可选）

安装 Flovart 浏览器扩展后，外部网页可通过 `chrome.runtime.sendMessage(extensionId, { type: 'FLOVART_COMMAND', method, args })` 调用 API，无需 CDP。

### 协作脚本（Phase 3）

| 脚本 | 用途 | 依赖 |
|------|------|------|
| `import-from-libtv.js` | 从 LibTV 会话导入生成结果到画布 | `LIBTV_ACCESS_KEY` |
| `import-from-runninghub.js` | 从 RunningHub 任务导入输出到画布 | `RUNNINGHUB_API_KEY` |
| `export-to-ffmpeg.js` | 导出画布元素为 FFmpeg concat/script | — |
| `export-canvas-data.js` | 导出画布状态为 JSON | — |

```bash
# LibTV → Flovart
node skills/flovart/scripts/import-from-libtv.js --session abc123 --layout grid

# RunningHub → Flovart
node skills/flovart/scripts/import-from-runninghub.js --task task123 --layout row

# Flovart → FFmpeg
node skills/flovart/scripts/export-to-ffmpeg.js --output concat.txt --format concat

# Flovart → JSON (给其他 skill 消费)
node skills/flovart/scripts/export-canvas-data.js --output canvas.json
```

---

## 十二、修改守则

遵循项目 `copilot-instructions.md`：

1. **最小化改动** — 保持现有 React + TypeScript 风格
2. **复用已有工具** — 用 `types.ts`、`translations.ts`、`utils/` 现有函数
3. **CSS变量驱动** — 修改样式用 `styles.css` 中的变量
4. **双语对齐** — 新增用户文案同步更新 `translations.ts`（en + zh）
5. **窄范围编辑** — App.tsx 混合了大量逻辑，只改必要部分
6. **Provider在service层** — API调用逻辑放 `services/`，不放组件
7. **PromptBar优先** — 提示词相关UX扩展现有底栏，不新建
8. **UI一致性** — 侧栏/面板/工具栏改动需全局同步尺寸和动画
