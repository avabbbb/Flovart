import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Element, ImageElement, VideoElement, TextElement, UserApiKey, ModelPreference, CanvasElementBase } from '../../types';
import { generateId } from '../../utils/canvasHelpers';
import { chatCompletionWithTools, resolveChatEndpoint, assistantToolMessage, toolResultMessage } from '../../services/agentChatStream';
import type { ChatToolDefinition, ChatMessage as LLMMessage, ChatToolCall } from '../../services/agentChatStream';
import { ChatMessage, createLog } from './ChatMessage';
import type { ChatLog, ToolCallLog } from './ChatMessage';
import ChatTextarea from './ChatTextarea';

// ── Props ────────────────────────────────────────────────────────────

interface ChatProps {
  theme: 'light' | 'dark';
  compactMode: boolean;
  elements: Element[];
  selectedElementIds: string[];
  setSelectedElementIds: (ids: string[]) => void;
  commitAction: (updater: (prev: Element[]) => Element[]) => void;
  handleGenerate: (
    promptOverride?: string,
    source?: 'prompt' | 'right' | 'agent',
    modeOverride?: 'image' | 'video' | 'keyframe',
    selectedElementIdsOverride?: string[],
    mentionedElementIdsOverride?: string[],
  ) => Promise<void>;
  userApiKeys: UserApiKey[];
  modelPreference: ModelPreference;
  /** Excalidraw 截图 callback，由 App.tsx 通过 ref 暴露（可选） */
  onExportSnapshot?: () => Promise<string | null>;
  /** Phase 1.3: 从画布 pop-bar "加入对话" 注入的待处理附件 */
  pendingAttachments?: Array<{ url: string; mimeType: string }>;
  onConsumeAttachments?: () => void;
}

// ── 工具定义（13 个） ────────────────────────────────────────────────

const TOOLS: ChatToolDefinition[] = [
  { type: 'function', function: { name: 'canvas_get_state', description: '读取画布全部元素、选区、视口快照', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'canvas_get_selection', description: '读取当前选中元素的详细信息', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'canvas_export_snapshot', description: '导出当前画布截图描述', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'canvas_create_text', description: '在画布上创建一个文本元素', parameters: { type: 'object', properties: { text: { type: 'string', description: '文本内容' }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } }, required: ['text'] } } },
  { type: 'function', function: { name: 'canvas_create_image', description: '创建一个图片图层并生成图片', parameters: { type: 'object', properties: { prompt: { type: 'string', description: '图片生成提示词' }, x: { type: 'number' }, y: { type: 'number' }, name: { type: 'string' }, referenceElementIds: { type: 'array', items: { type: 'string' } } }, required: ['prompt'] } } },
  { type: 'function', function: { name: 'canvas_create_video', description: '创建一个视频图层并生成视频', parameters: { type: 'object', properties: { prompt: { type: 'string', description: '视频生成提示词' }, x: { type: 'number' }, y: { type: 'number' }, name: { type: 'string' }, sourceImageIds: { type: 'array', items: { type: 'string' } } }, required: ['prompt'] } } },
  { type: 'function', function: { name: 'canvas_update_element', description: '更新指定元素的属性', parameters: { type: 'object', properties: { id: { type: 'string' }, patch: { type: 'object', description: '要更新的属性键值对' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'canvas_move_elements', description: '移动多个元素位置', parameters: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, dx: { type: 'number' }, dy: { type: 'number' } } } } }, required: ['items'] } } },
  { type: 'function', function: { name: 'canvas_delete_elements', description: '删除指定元素', parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] } } },
  { type: 'function', function: { name: 'canvas_select_elements', description: '设置当前选中元素', parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] } } },
  { type: 'function', function: { name: 'canvas_set_viewport', description: '设置画布视口（滚动和缩放）', parameters: { type: 'object', properties: { viewport: { type: 'object', properties: { scrollX: { type: 'number' }, scrollY: { type: 'number' }, zoom: { type: 'number' } } } }, required: ['viewport'] } } },
  { type: 'function', function: { name: 'canvas_generate_image', description: '直接生成图片到画布（一步到位）', parameters: { type: 'object', properties: { prompt: { type: 'string' }, referenceElementIds: { type: 'array', items: { type: 'string' } }, x: { type: 'number' }, y: { type: 'number' } }, required: ['prompt'] } } },
  { type: 'function', function: { name: 'canvas_generate_video', description: '直接生成视频到画布（一步到位）', parameters: { type: 'object', properties: { prompt: { type: 'string' }, referenceElementIds: { type: 'array', items: { type: 'string' } }, x: { type: 'number' }, y: { type: 'number' } }, required: ['prompt'] } } },
];

const SYSTEM_PROMPT = `你是 Flovart 画布助手。当前画布 JSON 会随用户消息提供。
首轮必须调用工具：只读问题调用 canvas_get_state，需要改动画布时调用 canvas_* 工具。
需要生成内容时直接调用 canvas_generate_image、canvas_generate_video 或 canvas_create_image。
不要输出 JSON ops，不要编造执行结果。
工具参数涉及已有元素时必须使用当前画布 JSON 中真实存在的 id；
缺少必要 id 或用户意图不明确时直接说明需要用户明确选择或说明，不要猜测。
工具返回结果后，再根据真实结果回答用户。`;

const MAX_STEPS = 4;
const STORAGE_KEY = 'flovart.agentChat.logs.v2';
const OLD_STORAGE_KEY = 'agentChat.logs.v1';

// Migrate old AgentChatPanel logs (v1) to new ChatLog format (v2)
function migrateV1Logs(): ChatLog[] | null {
  try {
    const raw = localStorage.getItem(OLD_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const migrated: ChatLog[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const sender = (item as { sender?: string }).sender;
      const text = (item as { text?: string }).text;
      const time = (item as { time?: string }).time;
      if (!sender || !text) continue;
      const role = sender === 'user' ? 'user' : sender === 'agent' ? 'assistant' : 'system';
      migrated.push(createLog({ role, content: text, time: time || undefined }));
    }
    return migrated.length > 0 ? migrated : null;
  } catch { return null; }
}

// ── compactSnapshot ──────────────────────────────────────────────────

function buildCompactSnapshot(elements: Element[], selectedElementIds: string[]) {
  return {
    selectedIds: selectedElementIds,
    elements: elements.map(el => {
      const base = el as CanvasElementBase;
      return {
        id: base.id,
        type: base.type,
        name: base.name || '',
        x: base.x,
        y: base.y,
        width: (el as { width?: number }).width || 0,
        height: (el as { height?: number }).height || 0,
        prompt: base.generationState?.promptPayload?.rawText?.slice(0, 500) || '',
        status: base.generationState?.status || undefined,
      };
    }),
  };
}

// ── 工具执行 ──────────────────────────────────────────────────────────

function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: {
    elements: Element[];
    selectedElementIds: string[];
    setSelectedElementIds: (ids: string[]) => void;
    commitAction: (updater: (prev: Element[]) => Element[]) => void;
    handleGenerate: ChatProps['handleGenerate'];
    onExportSnapshot?: () => Promise<string | null>;
  },
): Promise<{ ok: boolean; data: unknown; message: string }> {
  switch (name) {
    case 'canvas_get_state': {
      const snap = buildCompactSnapshot(ctx.elements, ctx.selectedElementIds);
      return Promise.resolve({ ok: true, data: snap, message: '画布快照已读取' });
    }
    case 'canvas_get_selection': {
      const selected = ctx.elements.filter(el => ctx.selectedElementIds.includes(el.id));
      const data = selected.map(el => {
        const b = el as CanvasElementBase;
        return { id: b.id, type: b.type, name: b.name, x: b.x, y: b.y, prompt: b.generationState?.promptPayload?.rawText?.slice(0, 300) || '' };
      });
      return Promise.resolve({ ok: true, data, message: `选中 ${selected.length} 个元素` });
    }
    case 'canvas_export_snapshot': {
      if (ctx.onExportSnapshot) {
        return ctx.onExportSnapshot().then(url => ({ ok: true, data: { screenshot: !!url }, message: url ? '截图已生成' : '截图失败' }));
      }
      const snap = buildCompactSnapshot(ctx.elements, ctx.selectedElementIds);
      return Promise.resolve({ ok: true, data: snap, message: '已返回画布快照（无截图）' });
    }
    case 'canvas_create_text': {
      const { text, x = 100, y = 100, width = 200, height = 60 } = args;
      const el: TextElement = {
        id: generateId(), type: 'text', text: String(text),
        x: Number(x), y: Number(y), width: Number(width), height: Number(height),
        fontSize: 16, fontColor: '#1a1a1a',
      };
      ctx.commitAction(prev => [...prev, el]);
      return Promise.resolve({ ok: true, data: { id: el.id }, message: '文本元素已创建' });
    }
    case 'canvas_create_image':
    case 'canvas_generate_image': {
      const { prompt, x, y, name, referenceElementIds } = args;
      const newId = generateId();
      const placeholder: ImageElement = {
        id: newId, type: 'image', href: '', width: 256, height: 256,
        mimeType: 'image/png', x: Number(x) || 120, y: Number(y) || 120,
        name: String(name || 'Agent 图片'),
        generationState: {
          promptPayload: { rawText: String(prompt), resolvedReferences: [] },
          provider: 'openai_compatible', modelId: '', status: 'queued',
        },
      };
      ctx.commitAction(prev => [...prev, placeholder]);
      ctx.setSelectedElementIds([newId]);
      void ctx.handleGenerate(String(prompt), 'agent', 'image', [newId], (referenceElementIds as string[]) || []);
      return Promise.resolve({ ok: true, data: { id: newId }, message: '图片生成已启动' });
    }
    case 'canvas_create_video':
    case 'canvas_generate_video': {
      const { prompt, x, y, name, sourceImageIds, referenceElementIds } = args;
      const newId = generateId();
      const placeholder: VideoElement = {
        id: newId, type: 'video', href: '', width: 320, height: 180,
        mimeType: 'video/mp4', x: Number(x) || 120, y: Number(y) || 120,
        name: String(name || 'Agent 视频'),
        generationState: {
          promptPayload: { rawText: String(prompt), resolvedReferences: [] },
          provider: 'openai_compatible', modelId: '', status: 'queued',
        },
      };
      ctx.commitAction(prev => [...prev, placeholder]);
      ctx.setSelectedElementIds([newId]);
      const refs = (sourceImageIds || referenceElementIds) as string[] | undefined;
      void ctx.handleGenerate(String(prompt), 'agent', 'video', [newId], refs || []);
      return Promise.resolve({ ok: true, data: { id: newId }, message: '视频生成已启动' });
    }
    case 'canvas_update_element': {
      const { id, patch = {} } = args;
      ctx.commitAction(prev => prev.map(el => {
        if (el.id !== id) return el;
        return { ...el, ...(patch as Record<string, unknown>) } as Element;
      }));
      return Promise.resolve({ ok: true, data: { id }, message: '元素已更新' });
    }
    case 'canvas_move_elements': {
      const items = (args.items as Array<{ id: string; x?: number; y?: number; dx?: number; dy?: number }>) || [];
      ctx.commitAction(prev => prev.map(el => {
        const item = items.find(i => i.id === el.id);
        if (!item) return el;
        const b = el as CanvasElementBase;
        return { ...el, x: item.x !== undefined ? item.x : b.x + (item.dx || 0), y: item.y !== undefined ? item.y : b.y + (item.dy || 0) } as Element;
      }));
      return Promise.resolve({ ok: true, data: { count: items.length }, message: `${items.length} 个元素已移动` });
    }
    case 'canvas_delete_elements': {
      const ids = (args.ids as string[]) || [];
      ctx.commitAction(prev => prev.filter(el => !ids.includes(el.id)));
      return Promise.resolve({ ok: true, data: { count: ids.length }, message: `${ids.length} 个元素已删除` });
    }
    case 'canvas_select_elements': {
      const ids = (args.ids as string[]) || [];
      ctx.setSelectedElementIds(ids);
      return Promise.resolve({ ok: true, data: { ids }, message: `已选中 ${ids.length} 个元素` });
    }
    case 'canvas_set_viewport': {
      return Promise.resolve({ ok: true, data: args.viewport, message: '视口已设置（待接入）' });
    }
    default:
      return Promise.resolve({ ok: false, data: null, message: `未知工具: ${name}` });
  }
}

// ── 主组件 ────────────────────────────────────────────────────────────

const INITIAL_LOG: ChatLog = createLog({
  role: 'assistant',
  content: '我是画布助手。告诉我你想做什么——生成图片、创建文本、移动元素，都可以。',
});

export const Chat: React.FC<ChatProps> = ({
  theme: _theme, compactMode, elements, selectedElementIds, setSelectedElementIds,
  commitAction, handleGenerate, userApiKeys, modelPreference, onExportSnapshot,
  pendingAttachments, onConsumeAttachments,
}) => {
  const [logs, setLogs] = useState<ChatLog[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed as ChatLog[];
      }
      // Fallback: try migrating from old v1 format
      const migrated = migrateV1Logs();
      if (migrated && migrated.length > 0) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        localStorage.removeItem(OLD_STORAGE_KEY);
        return migrated;
      }
    } catch { /* ignore */ }
    return [INITIAL_LOG];
  });
  const [isRunning, setIsRunning] = useState(false);
  const [confirmTools, setConfirmTools] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const elementsRef = useRef(elements);
  const selectedRef = useRef(selectedElementIds);

  elementsRef.current = elements;
  selectedRef.current = selectedElementIds;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    try {
      const trimmed = logs.slice(-100);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch { /* ignore */ }
  }, [logs]);

  const updateLog = (id: string, patch: Partial<ChatLog>) => {
    setLogs(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
  };

  const updateToolCall = (logId: string, toolId: string, patch: Partial<ToolCallLog>) => {
    setLogs(prev => prev.map(l => {
      if (l.id !== logId || !l.toolCalls) return l;
      return { ...l, toolCalls: l.toolCalls.map(tc => tc.id === toolId ? { ...tc, ...patch } : tc) };
    }));
  };

  const handleClear = () => setLogs([INITIAL_LOG]);

  const handleStop = () => {
    abortRef.current?.abort();
    setIsRunning(false);
  };

  const handleSend = useCallback(async (text: string, attachments: Array<{ url: string; mimeType: string }>, textModel: string) => {
    if (isRunning) return;

    const userLog = createLog({ role: 'user', content: text, attachments: attachments.length ? attachments : undefined });
    setLogs(prev => [...prev, userLog]);

    setIsRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;

    const { apiKey, baseUrl } = resolveChatEndpoint(textModel, userApiKeys.find(k =>
      (k.models?.some(m => m.id === textModel)) || (k.customModels?.includes(textModel)) || k.capabilities?.includes('agent')
    ));

    if (!apiKey) {
      setLogs(prev => [...prev, createLog({ role: 'system', content: '未找到对应模型的 API Key，请在设置中配置。' })]);
      setIsRunning(false);
      return;
    }

    const assistantLog = createLog({ role: 'assistant', content: '', isStreaming: true });
    setLogs(prev => [...prev, assistantLog]);

    const snapshot = buildCompactSnapshot(elementsRef.current, selectedRef.current);
    const userContent: LLMMessage = {
      role: 'user',
      content: `当前画布：${JSON.stringify(snapshot)}\n用户需求：${text}`,
    };

    const llmMessages: LLMMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      userContent,
    ];

    let step = 0;
    let lastContent = '';

    try {
      while (step < MAX_STEPS) {
        step++;
        const toolChoice = step === 1 ? 'required' : 'auto';

        const result = await chatCompletionWithTools({
          model: textModel,
          messages: llmMessages,
          tools: TOOLS,
          toolChoice,
          apiKey,
          baseUrl,
          signal: controller.signal,
          onDelta: (delta) => {
            lastContent += delta;
            updateLog(assistantLog.id, { content: lastContent, isStreaming: true });
          },
        });

        // 本轮结束
        if (result.toolCalls.length === 0) {
          updateLog(assistantLog.id, { content: result.content || lastContent || '完成。', isStreaming: false });
          break;
        }

        // 有工具调用
        const toolCallLogs: ToolCallLog[] = result.toolCalls.map(tc => ({
          id: tc.id, name: tc.name, arguments: tc.arguments, status: 'pending',
        }));
        updateLog(assistantLog.id, { content: lastContent, isStreaming: false, toolCalls: toolCallLogs });

        // 把 assistant 的 tool_calls 加入 messages
        llmMessages.push(assistantToolMessage(result.content, result.toolCalls));

        // 执行工具
        for (let i = 0; i < result.toolCalls.length; i++) {
          const tc = result.toolCalls[i];
          const tcLog = toolCallLogs[i];
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.arguments); } catch { /* ignore */ }

          const toolResult = await executeTool(tc.name, args, {
            elements: elementsRef.current,
            selectedElementIds: selectedRef.current,
            setSelectedElementIds,
            commitAction,
            handleGenerate,
            onExportSnapshot,
          });

          updateToolCall(assistantLog.id, tcLog.id, {
            status: toolResult.ok ? 'success' : 'error',
            result: toolResult.message,
          });

          llmMessages.push(toolResultMessage(tc.id, toolResult.data ?? toolResult.message));
        }

        // 准备下一轮 assistant log
        lastContent = '';
        if (step < MAX_STEPS - 1) {
          const nextAssistantLog = createLog({ role: 'assistant', content: '', isStreaming: true });
          setLogs(prev => [...prev, nextAssistantLog]);
          // 替换引用以便后续 onDelta 更新新的 log
          assistantLog.id = nextAssistantLog.id;
        }
      }

      if (step >= MAX_STEPS) {
        updateLog(assistantLog.id, { content: lastContent || '已达最大步数，停止执行。', isStreaming: false });
      }
    } catch (err) {
      if (controller.signal.aborted) {
        updateLog(assistantLog.id, { content: lastContent + '\n（已停止）', isStreaming: false });
      } else {
        const msg = err instanceof Error ? err.message : '请求失败';
        updateLog(assistantLog.id, { content: lastContent, isStreaming: false });
        setLogs(prev => [...prev, createLog({ role: 'system', content: msg })]);
      }
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  }, [isRunning, userApiKeys, setSelectedElementIds, commitAction, handleGenerate, onExportSnapshot]);

  return (
    <div className="flv-agent-dock flex h-full min-h-0 flex-col" style={{ background: 'var(--isl-surface)', borderLeft: '1.5px solid var(--isl-border)', color: 'var(--isl-ink)', fontFamily: 'var(--isl-font)' }}>
      {/* 头部 */}
      <div className="flex items-center justify-between gap-3 px-3.5 py-2.5" style={{ borderBottom: '1.5px solid var(--isl-border)' }}>
        <div className="text-[14px] font-extrabold tracking-[-0.01em]" style={{ color: 'var(--isl-ink)' }}>
          画布助手
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setConfirmTools(prev => !prev)}
            className={`isl-chip h-7 px-2.5 text-[11px] ${confirmTools ? 'isl-chip--active' : ''}`}
            title="开启后写操作需人工确认"
          >
            {confirmTools ? '确认 ✓' : '自动执行'}
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={logs.length <= 1}
            className="isl-chip h-7 px-2.5 text-[11px] disabled:opacity-40 disabled:cursor-not-allowed"
            title="清空对话"
          >
            清空
          </button>
        </div>
      </div>

      {/* 消息列表 */}
      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3.5 py-3">
        {logs.map(log => (
          <ChatMessage key={log.id} log={log} />
        ))}
      </div>

      {/* 输入区 */}
      <ChatTextarea
        compactMode={compactMode}
        userApiKeys={userApiKeys}
        modelPreference={modelPreference}
        isRunning={isRunning}
        onSend={handleSend}
        onStop={handleStop}
        pendingAttachments={pendingAttachments}
        onConsumeAttachments={onConsumeAttachments}
      />
    </div>
  );
};

export default Chat;
