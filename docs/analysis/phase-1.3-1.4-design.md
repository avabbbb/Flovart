# Phase 1.3-1.4 设计文档：Agent Chat 主交互 + Add to Chat 入口

> 路线：前端编排（jaaz 模式 + infinite-canvas 工具集范式），用户拍板
> 工具集模仿 basketikun/infinite-canvas 的在线画布助手（23 工具 → Flovart 适配 13 工具）
> 后端不参与 LLM 调用，API Key 不离开浏览器
> 日期：2026-06-29

---

## 1. 架构总览

```
用户输入 prompt
    ↓
Agent Chat (前端 Tool-Calling 循环，最多 4 步)
    ↓
chatCompletionWithTools (fetch + ReadableStream SSE, /chat/completions + tools + stream:true)
    ↓                    ↑ onDelta(text 增量) / onToolCalls(工具调用)
OpenAI 兼容 /chat/completions (stream:true, function calling)
    ↓
LLM 返回 delta.content（文本增量）+ delta.tool_calls（工具调用增量，按 index 拼接）
    ↓ finish_reason: "tool_calls"
前端执行工具（13 个 canvas_* 工具）：
  - 读类: get_state / get_selection / export_snapshot → 读画布快照
  - 创建类: create_text / create_image / create_video → commitAction + handleGenerate
  - 编辑类: update_element / move_elements / delete_elements / select_elements
  - 视口类: set_viewport
  - 生成类: generate_image / generate_video → 创建元素 + handleGenerate
    ↓
工具结果回传 LLM（tool message）→ 继续循环
    ↓ finish_reason: "stop"
done / error
```

## 2. 关键决策（已拍板）

| 决策 | 选择 | 原因 |
|------|------|------|
| Agent 路线 | 前端编排 | API Key 不离开浏览器，后端不碰 LLM |
| 工具集范式 | 模仿 infinite-canvas 在线助手 | 23 工具 → Flovart 适配 13 工具 |
| LLM 端点 | /chat/completions + tools + stream:true | 比 /responses 更通用，大多数 OpenAI 兼容接口支持 |
| Tool-Calling 循环 | 最多 4 步（同 infinite-canvas） | 防止无限循环 |
| 首轮 tool_choice | "required"（同 infinite-craft） | 强制首轮必调工具 |
| confirmTools | 支持人工确认开关（同 infinite-canvas） | 写操作弹卡片确认 |
| 视觉上下文 | 按需注入（用户拍板） | 只有 @canvas 或 export_snapshot 时注入截图 |
| 面板位置 | 替换 RightPanel agent tab | 新建 components/agent-chat/ |
| 后端改动 | 不动 | 后端定位是积分/用户/图床/UGC |

## 3. 工具集（13 个，基于 infinite-canvas 适配）

### 读类（3 个）
| 工具 | 参数 | 行为 |
|------|------|------|
| `canvas_get_state` | `{}` | 读取画布全部元素、选区、视口（compactSnapshot） |
| `canvas_get_selection` | `{}` | 读取当前选中元素详情 |
| `canvas_export_snapshot` | `{}` | Excalidraw exportToCanvas → toDataURL → 返回截图描述 |

### 创建类（3 个）
| 工具 | 参数 | 行为 |
|------|------|------|
| `canvas_create_text` | `{ text, x?, y?, width?, height? }` | commitAction(TextElement) |
| `canvas_create_image` | `{ prompt, x?, y?, name?, model?, size?, quality?, count? }` | commitAction(ImageElement) → handleGenerate |
| `canvas_create_video` | `{ prompt, sourceImageIds?, x?, y?, name?, model?, seconds?, vquality? }` | commitAction(VideoElement) → handleGenerate(mode=video) |

### 编辑类（4 个）
| 工具 | 参数 | 行为 |
|------|------|------|
| `canvas_update_element` | `{ id, patch? }` | 更新元素属性 |
| `canvas_move_elements` | `{ items: [{id, x?, y?, dx?, dy?}] }` | 移动元素 |
| `canvas_delete_elements` | `{ ids: [] }` | 删除元素 |
| `canvas_select_elements` | `{ ids: [] }` | 设置选中元素 |

### 视口类（1 个）
| 工具 | 参数 | 行为 |
|------|------|------|
| `canvas_set_viewport` | `{ viewport: {scrollX, scrollY, zoom} }` | 设置画布视口 |

### 生成类（2 个，直接生成不创建独立文本元素）
| 工具 | 参数 | 行为 |
|------|------|------|
| `canvas_generate_image` | `{ prompt, referenceElementIds?, x?, y?, model?, size?, quality?, count? }` | 创建 ImageElement + handleGenerate（一步到位） |
| `canvas_generate_video` | `{ prompt, referenceElementIds?, x?, y?, model?, seconds?, vquality? }` | 创建 VideoElement + handleGenerate(mode=video) |

**与 infinite-canvas 的差异**：
- 无 config 节点 / 连线（Flovart 用 Excalidraw 自由画布，无节点流）
- 无 canvas_create_generation_flow（Flovart 没有文本节点→config 节点→连线的概念）
- 无 canvas_apply_ops（Flovart 的元素操作直接映射，不需要中间 op 层）
- 无 audio 生成（Flovart 暂不支持音频生成）

## 4. Tool-Calling 循环（同 infinite-canvas 模式）

```
step 1: buildToolAgentMessages(snapshot, history, userMessage)
  → requestChatCompletion(messages, tools, tool_choice:"required", onDelta)
  → 有 toolCalls → executeTools → 继续 step 2
  → 无 toolCalls → 返回 content

step 2+: 把 toolCalls + toolResults 加到 messages
  → requestChatCompletion(messages, tools, tool_choice:"auto", onDelta)
  → 有 toolCalls → executeTools → 继续 step+1
  → 无 toolCalls → 返回 content
  → step >= 4 → 停止，返回最后结果
```

## 5. SSE 事件格式（/chat/completions stream:true）

OpenAI 兼容 SSE 流式返回：
```
data: {"choices":[{"delta":{"content":"Hello"}}]}
data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_xxx","function":{"name":"canvas_get_state","arguments":""}}]}}]}
data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]}}]}
data: {"choices":[{"finish_reason":"tool_calls"}]}
data: [DONE]
```

前端处理：
- `delta.content` → onDelta(text) 增量回调
- `delta.tool_calls` → 按 index 拼接 tool_calls（id/name/arguments）
- `finish_reason: "tool_calls"` → 本轮有工具调用，执行工具后继续循环
- `finish_reason: "stop"` → 本轮结束，返回 content

## 6. 上下文注入（compactSnapshot，同 infinite-canvas 模式）

system message（ONLINE_AGENT_PROMPT 适配版）：
```
你是 Flovart 画布助手。当前画布 JSON 会随用户消息提供。
首轮必须调用工具：只读问题调用 canvas_get_state，需要改动画布时调用 canvas_* 工具。
需要生成内容时直接调用 canvas_generate_image、canvas_generate_video 或 canvas_create_image。
不要输出 JSON ops，不要编造执行结果。
工具参数涉及已有元素时必须使用当前画布 JSON 中真实存在的 id；
缺少必要 id 或用户意图不明确时直接说明需要用户明确选择或说明，不要猜测。
工具返回结果后，再根据真实结果回答用户。
```

user message：
```
当前画布：{compactSnapshot JSON}
用户需求：{user text}
[选中元素图片（如果有）]
```

compactSnapshot（精简画布快照）：
```typescript
{
  selectedIds: string[],
  viewport: { scrollX, scrollY, zoom },
  elements: elements.map(el => ({
    id, type, name, x, y, width, height,
    prompt: el.prompt?.slice(0, 500),
    status: el.status,
  }))
}
```

## 7. 模块清单

### 7.1 服务层

**`services/agentChatStream.ts`**（新建）
- `chatCompletionWithTools(opts)`：fetch + ReadableStream 调 /chat/completions + tools + stream:true
- 支持 OpenAI 兼容 + Google Gemini（functionCall 映射）
- onDelta / onToolCalls / onDone / onError 回调
- 复用 `aiGateway.ts` 的 provider 解析 + baseUrl + apiKey 逻辑
- 支持 AbortSignal 取消
- SSE 解析：delta.content + delta.tool_calls（按 index 拼接）

### 7.2 组件层

**`components/agent-chat/Chat.tsx`**（新建，主面板）
- Tool-Calling 循环（最多 4 步，同 infinite-canvas）
- 消息列表渲染
- 上下文注入：compactSnapshot + 选中元素图片
- 工具执行：executeTool(name, args) → 读类/写类映射
- confirmTools 人工确认开关
- 会话持久化：localforage

**`components/agent-chat/ChatTextarea.tsx`**（新建，输入框）
- 文本输入 + 图片附件拖拽/粘贴
- 模型选择（复用现有 modelPreference）
- 发送/停止按钮
- Enter 发送，Shift+Enter 换行

**`components/agent-chat/ChatMessage.tsx`**（新建，消息组件）
- 用户消息：文本 + 图片附件
- Agent 消息：流式文本（delta 增量渲染）+ 工具调用卡片
- 工具卡片：工具名 + 参数 + 结果 + 状态（pending/success/error）
- 系统消息：错误提示

### 7.3 入口层

**Phase 1.3 — Add to Chat 入口**
- FlovartExcalidrawStage pop-bar 新增 "加入对话" 按钮
- 选中图片元素 → 点击 → 通过 store 传递图片到 Agent Chat 输入框

### 7.4 替换层

**RightPanel.tsx**
- `activeTab === 'agent'` 渲染新的 `<Chat>` 替换旧 `<AgentChatPanel>`
- 传入 elements / selectedElementIds / viewport / handleGenerate / commitAction 等

## 8. 复用清单

| 现有代码 | 复用方式 |
|----------|----------|
| `aiGateway.ts` provider 解析 / baseUrl / apiKey / inferProviderFromModel | 直接 import |
| `aiGateway.ts` SSE ReadableStream 解析模式 | 参考，在新文件里实现 /chat/completions + tools |
| `handleGenerate` | 工具 create_image/create_video/generate_image/generate_video 调用 |
| `commitAction` | 工具创建/更新/删除元素 |
| `exportToCanvas` (Excalidraw) | 工具 export_snapshot |
| `modelPreference` / `userApiKeys` | ChatTextarea 模型选择 |
| `canvasThemes` / `useThemeStore` | 面板主题 |
| `normalizeProviderBaseUrl` | baseUrl 规范化 |

## 9. 实施顺序

1. `services/agentChatStream.ts` — /chat/completions + tools + stream:true SSE 流式
2. `components/agent-chat/ChatMessage.tsx` — 消息组件
3. `components/agent-chat/ChatTextarea.tsx` — 输入框
4. `components/agent-chat/Chat.tsx` — 主面板 + Tool-Calling 循环 + 工具执行
5. RightPanel.tsx 替换 agent tab
6. Phase 1.3 Add to Chat 入口（pop-bar 新增按钮）
7. 文档更新
