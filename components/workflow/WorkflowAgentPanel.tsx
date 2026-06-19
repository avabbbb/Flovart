import { Archive, Bot, Circle, History, ImagePlus, Link2, MessageSquare, Plus, ScrollText, Send, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  WorkflowAgentBridge,
  redactWorkflowAgentSnapshot,
  validateWorkflowAgentAttachments,
  type WorkflowAgentAttachment,
} from '../../services/workflowAgentBridge';
import type { WorkflowAgentMessage, WorkflowAgentSession, WorkflowProject } from './types';
import { WorkflowAgentMessages, type WorkflowAgentDisplayMessage } from './WorkflowAgentMessages';

type Tab = 'setup' | 'chat' | 'history' | 'logs';
type Status = 'connecting' | 'connected' | 'disconnected' | 'error';
export type WorkflowAgentMode = 'online' | 'local';
export type WorkflowOnlineAgentEvent =
  | { type: 'assistant_delta'; id: string; text: string }
  | { type: 'assistant'; id?: string; text: string }
  | { type: 'tool'; id: string; title: string; text: string; detail?: unknown; status?: WorkflowAgentDisplayMessage['status'] }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface WorkflowOnlineTurnInput {
  project: WorkflowProject;
  messages: WorkflowAgentDisplayMessage[];
  prompt: string;
  attachments: WorkflowAgentAttachment[];
  signal: AbortSignal;
  emit: (event: WorkflowOnlineAgentEvent) => void;
  confirm: (summary: string) => Promise<boolean>;
}

export interface WorkflowAgentPanelProps {
  project: WorkflowProject;
  onClose: () => void;
  onProjectChange?: (patch: Pick<WorkflowProject, 'agentSessions' | 'activeAgentSessionId'>) => void;
  onOnlineTurn?: (input: WorkflowOnlineTurnInput) => Promise<void>;
}

const tabs: Array<{ id: Tab; label: string; icon: typeof Link2 }> = [
  { id: 'setup', label: '连接', icon: Link2 },
  { id: 'chat', label: '对话', icon: MessageSquare },
  { id: 'history', label: '历史', icon: History },
  { id: 'logs', label: '日志', icon: ScrollText },
];

const safeStorage = (key: string, fallback: string) => {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
};
const id = () => typeof crypto === 'undefined' ? `${Date.now()}-${Math.random()}` : crypto.randomUUID();

export function WorkflowAgentPanel({ project, onClose, onProjectChange, onOnlineTurn }: WorkflowAgentPanelProps) {
  const [mode, setMode] = useState<WorkflowAgentMode>(() => safeStorage('flovart.workflow.agent.mode', 'online') as WorkflowAgentMode);
  const [tab, setTab] = useState<Tab>('chat');
  const [url, setUrl] = useState(() => safeStorage('flovart.agent.url', 'http://127.0.0.1:17372'));
  const [token, setToken] = useState(() => safeStorage('flovart.agent.token', ''));
  const [status, setStatus] = useState<Status>('disconnected');
  const [prompt, setPrompt] = useState('');
  const [threadId, setThreadId] = useState('');
  const [threads, setThreads] = useState<any[]>([]);
  const [logs, setLogs] = useState<Array<{ id: string; time: string; type: string; text: string }>>([]);
  const [messages, setMessages] = useState<WorkflowAgentDisplayMessage[]>(() => activeSessionMessages(project));
  const [attachments, setAttachments] = useState<WorkflowAgentAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [confirmation, setConfirmation] = useState<{ summary: string; resolve: (approved: boolean) => void }>();
  const bridge = useRef<WorkflowAgentBridge | null>(null);
  const onlineAbort = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewUrls = useRef(new Set<string>());
  const messagesRef = useRef(messages);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => {
    if (mode !== 'online') return;
    replaceMessages(activeSessionMessages(project));
  }, [mode, project.activeAgentSessionId, project.agentSessions]);
  useEffect(() => () => {
    bridge.current?.disconnect();
    onlineAbort.current?.abort();
    previewUrls.current.forEach(preview => URL.revokeObjectURL(preview));
  }, []);
  useEffect(() => {
    if (mode === 'local' && status === 'connected') void bridge.current?.pushSnapshot(project).catch(cause => addLog('error', errorMessage(cause)));
  }, [mode, project, status]);

  const onlineStatus: Status = onOnlineTurn ? 'connected' : 'disconnected';
  const visibleStatus = mode === 'online' ? onlineStatus : status;
  const canSend = mode === 'online' ? Boolean(onOnlineTurn) : status === 'connected';
  const onlineSessions = useMemo(() => project.agentSessions || [], [project.agentSessions]);

  function addLog(type: string, value: unknown) {
    const text = typeof value === 'string' ? value : JSON.stringify(redactWorkflowAgentSnapshot(value));
    setLogs(items => [...items.slice(-159), { id: id(), time: new Date().toLocaleTimeString(), type, text }]);
  }

  function updateMessages(updater: (items: WorkflowAgentDisplayMessage[]) => WorkflowAgentDisplayMessage[]) {
    const next = updater(messagesRef.current);
    messagesRef.current = next;
    setMessages(next);
  }

  function replaceMessages(next: WorkflowAgentDisplayMessage[]) {
    messagesRef.current = next;
    setMessages(next);
  }

  function handleEvent(type: string, payload: any) {
    if (type === 'agent_event') handleCodexEvent(payload);
    else if (type === 'tool_result') upsertToolResult(payload);
    else if (type === 'agent_error') {
      setSending(false);
      appendMessage({ id: id(), role: 'error', text: errorMessage(payload?.message || payload) });
    } else if (type === 'agent_done') setSending(false);
    if (type !== 'ping') addLog(type, payload);
  }

  function handleCodexEvent(payload: any) {
    const method = String(payload?.method || payload?.type || '');
    const params = payload?.params || payload;
    if (method === 'item/agentMessage/delta') {
      const itemId = String(params?.itemId || 'assistant');
      const delta = String(params?.delta || '');
      updateMessages(items => upsertDelta(items, itemId, delta));
      return;
    }
    const item = params?.item || params;
    const itemType = String(item?.type || '');
    if (method === 'item/started' && /mcpToolCall|mcp_tool_call/i.test(itemType)) {
      appendMessage({ id: String(item.id || id()), role: 'tool', title: String(item.tool || item.name || 'Workflow 工具'), text: 'Agent 请求执行工具。', detail: item.arguments || item.input, status: 'pending' });
    }
    if (method === 'item/completed' && /agentMessage|agent_message/i.test(itemType)) {
      const text = String(item.text || item.content || '');
      if (text) updateMessages(items => upsertMessage(items, { id: String(item.id || id()), role: 'assistant', text }));
    }
    if (method === 'item/completed' && /mcpToolCall|mcp_tool_call/i.test(itemType)) {
      const failed = Boolean(item.error) || /failed|error/i.test(String(item.status || ''));
      updateMessages(items => upsertMessage(items, { id: String(item.id || id()), role: 'tool', title: String(item.tool || item.name || 'Workflow 工具'), text: failed ? errorMessage(item.error || '工具执行失败') : '工具执行完成。', detail: item.result || item.output || item, status: failed ? 'error' : 'success' }));
    }
    if (method === 'turn/completed' || method === 'turn.completed') setSending(false);
    if (method === 'error') {
      setSending(false);
      appendMessage({ id: id(), role: 'error', text: errorMessage(params?.message || params) });
    }
  }

  function upsertToolResult(payload: any) {
    const failed = Boolean(payload?.error) || payload?.result?.ok === false;
    const toolId = String(payload?.requestId || id());
    updateMessages(items => upsertMessage(items, {
      id: toolId,
      role: 'tool',
      title: String(payload?.command || 'Workflow 工具'),
      text: failed ? errorMessage(payload?.error || payload?.result?.error?.message) : '工具执行完成。',
      detail: payload?.result,
      status: failed ? payload?.result?.error?.code === 'DENIED' ? 'denied' : 'error' : 'success',
    }));
  }

  function appendMessage(message: WorkflowAgentDisplayMessage) {
    updateMessages(items => [...items.slice(-159), message]);
  }

  const askConfirmation = (summary: string) => new Promise<boolean>(resolve => setConfirmation({ summary, resolve }));

  function connect() {
    bridge.current?.disconnect();
    try {
      const endpoint = new URL(url);
      if (!['http:', 'https:'].includes(endpoint.protocol) || !token.trim()) throw new Error('请填写有效的 Agent 地址和 Token。');
      localStorage.setItem('flovart.agent.url', endpoint.origin);
      localStorage.setItem('flovart.agent.token', token.trim());
      bridge.current = new WorkflowAgentBridge({ url: endpoint.origin, token: token.trim(), onStatus: setStatus, onEvent: handleEvent, confirm: askConfirmation });
      bridge.current.connect();
      setTab('chat');
    } catch (cause) {
      setStatus('error');
      addLog('error', errorMessage(cause));
    }
  }

  async function send() {
    const text = prompt.trim();
    if ((!text && !attachments.length) || !canSend || sending) return;
    try { validateWorkflowAgentAttachments(attachments); }
    catch (cause) { appendMessage({ id: id(), role: 'error', text: errorMessage(cause) }); return; }
    const userMessage: WorkflowAgentDisplayMessage = {
      id: id(), role: 'user', text: text || '发送了图片附件', createdAt: new Date().toISOString(),
      attachments: attachments.map(item => ({ id: item.id, name: item.name, previewUrl: item.previewUrl || item.dataUrl })),
    };
    const sentAttachments = attachments;
    const history = [...messagesRef.current, userMessage];
    messagesRef.current = history;
    setMessages(history);
    setPrompt('');
    setAttachments([]);
    setSending(true);
    addLog('user', { text, attachments: sentAttachments.map(({ name, type, size }) => ({ name, type, size })) });
    if (mode === 'local') {
      try {
        const response = await bridge.current?.sendPrompt({ projectId: project.id, prompt: text || '请分析图片附件。', threadId: threadId || undefined, attachments: sentAttachments });
        if (response?.threadId) setThreadId(response.threadId);
      } catch (cause) {
        setSending(false);
        appendMessage({ id: id(), role: 'error', text: errorMessage(cause) });
      }
      return;
    }
    const controller = new AbortController();
    onlineAbort.current?.abort();
    onlineAbort.current = controller;
    try {
      await onOnlineTurn?.({
        project: redactWorkflowAgentSnapshot(project),
        messages: history,
        prompt: text,
        attachments: sentAttachments,
        signal: controller.signal,
        confirm: askConfirmation,
        emit: event => handleOnlineEvent(event),
      });
      persistOnlineMessages(messagesRef.current);
    } catch (cause) {
      if (!controller.signal.aborted) appendMessage({ id: id(), role: 'error', text: errorMessage(cause) });
    } finally {
      setSending(false);
    }
  }

  function handleOnlineEvent(event: WorkflowOnlineAgentEvent) {
    if (event.type === 'assistant_delta') updateMessages(items => upsertDelta(items, event.id, event.text));
    else if (event.type === 'assistant') updateMessages(items => upsertMessage(items, { id: event.id || id(), role: 'assistant', text: event.text }));
    else if (event.type === 'tool') updateMessages(items => upsertMessage(items, { id: event.id, role: 'tool', title: event.title, text: event.text, detail: event.detail, status: event.status || 'pending' }));
    else if (event.type === 'error') appendMessage({ id: id(), role: 'error', text: event.message });
    else if (event.type === 'done') setSending(false);
    addLog(`online:${event.type}`, event);
  }

  function persistOnlineMessages(nextMessages: WorkflowAgentDisplayMessage[]) {
    if (!onProjectChange) return;
    const now = new Date().toISOString();
    const activeId = project.activeAgentSessionId || id();
    const session: WorkflowAgentSession = {
      id: activeId,
      title: nextMessages.find(item => item.role === 'user')?.text.slice(0, 24) || '新对话',
      messages: nextMessages.map(toStoredMessage),
      createdAt: project.agentSessions.find(item => item.id === activeId)?.createdAt || now,
      updatedAt: now,
    };
    onProjectChange({ agentSessions: [session, ...project.agentSessions.filter(item => item.id !== activeId)], activeAgentSessionId: activeId });
  }

  async function loadThreads() {
    if (mode === 'online' || status !== 'connected') return;
    try {
      const response = await bridge.current?.listThreads(project.id);
      setThreads(response?.data || []);
    } catch (cause) { addLog('error', errorMessage(cause)); }
  }

  async function openThread(nextThreadId: string) {
    try {
      const response = await bridge.current?.resumeThread(project.id, nextThreadId);
      setThreadId(nextThreadId);
      replaceMessages(normalizeThreadMessages(response));
      setTab('chat');
    } catch (cause) { addLog('error', errorMessage(cause)); }
  }

  async function archiveThread(nextThreadId: string) {
    try {
      await bridge.current?.archiveThread(project.id, nextThreadId);
      if (threadId === nextThreadId) { setThreadId(''); replaceMessages([]); }
      await loadThreads();
    } catch (cause) { addLog('error', errorMessage(cause)); }
  }

  async function newConversation() {
    replaceMessages([]);
    if (mode === 'online') {
      const nextId = id();
      onProjectChange?.({ agentSessions: project.agentSessions, activeAgentSessionId: nextId });
      setTab('chat');
      return;
    }
    if (status !== 'connected') return;
    try {
      const response = await bridge.current?.newThread(project.id);
      setThreadId(String(response?.threadId || response?.thread?.id || ''));
      setTab('chat');
    } catch (cause) { addLog('error', errorMessage(cause)); }
  }

  async function addAttachments(files: FileList | File[] | null) {
    if (!files) return;
    const candidates = Array.from(files).filter(file => file.type.startsWith('image/')).slice(0, Math.max(0, 6 - attachments.length));
    try {
      const added = await Promise.all(candidates.map(async file => {
        if (file.size > 8 * 1024 * 1024) throw new Error(`单张图片不能超过 8MB：${file.name}`);
        const previewUrl = URL.createObjectURL(file);
        previewUrls.current.add(previewUrl);
        return { id: id(), name: file.name, type: file.type, size: file.size, dataUrl: await readDataUrl(file), previewUrl };
      }));
      const next = [...attachments, ...added];
      validateWorkflowAgentAttachments(next);
      setAttachments(next);
    } catch (cause) { appendMessage({ id: id(), role: 'error', text: errorMessage(cause) }); }
  }

  function removeAttachment(attachmentId: string) {
    const attachment = attachments.find(item => item.id === attachmentId);
    if (attachment?.previewUrl) { URL.revokeObjectURL(attachment.previewUrl); previewUrls.current.delete(attachment.previewUrl); }
    setAttachments(items => items.filter(item => item.id !== attachmentId));
  }

  function switchMode(nextMode: WorkflowAgentMode) {
    if (nextMode === mode) return;
    localStorage.setItem('flovart.workflow.agent.mode', nextMode);
    if (nextMode === 'online') bridge.current?.disconnect();
    setMode(nextMode);
    replaceMessages(nextMode === 'online' ? activeSessionMessages(project) : []);
    setTab(nextMode === 'local' && status !== 'connected' ? 'setup' : 'chat');
  }

  return (
    <aside className="workflow-agent">
      <header><Bot size={16} /><strong>Workflow Agent</strong><div className="workflow-agent__mode"><button type="button" className={mode === 'online' ? 'is-active' : ''} onClick={() => switchMode('online')}>网站</button><button type="button" className={mode === 'local' ? 'is-active' : ''} onClick={() => switchMode('local')}>本机</button></div><span className={`workflow-agent__status is-${visibleStatus}`}><Circle size={8} />{statusLabel(visibleStatus)}</span><button type="button" title="新对话" onClick={() => void newConversation()}><Plus size={15} /></button><button type="button" aria-label="关闭 Agent" onClick={onClose}><X size={15} /></button></header>
      <nav>{tabs.map(item => { const Icon = item.icon; return <button key={item.id} type="button" className={tab === item.id ? 'is-active' : ''} onClick={() => { setTab(item.id); if (item.id === 'history') void loadThreads(); }}><Icon size={13} />{item.label}</button>; })}</nav>
      <section className="workflow-agent__body">
        {tab === 'setup' && (mode === 'local' ? <div className="workflow-agent__connect"><label>Agent 地址<input value={url} onChange={event => setUrl(event.target.value)} /></label><label>连接 Token<input type="password" value={token} onChange={event => setToken(event.target.value)} /></label><button type="button" onClick={connect}>{status === 'connecting' ? '连接中...' : '连接本机 Agent'}</button><p>运行 <code>npm run flovart:agent</code>，再填入终端显示的 Token。连接仅绑定当前网页 Origin。</p></div> : <div className="workflow-agent__connect"><strong>网站 Agent</strong><p>{onOnlineTurn ? '已连接项目现有 Provider 与 Agent 编排。API Key 仍只保存在浏览器本地。' : '网站 Agent 尚未连接 Provider 编排，请先在设置中配置文本模型。'}</p></div>)}
        {tab === 'chat' && <><WorkflowAgentMessages messages={messages} running={sending} />{attachments.length ? <div className="workflow-agent__attachments">{attachments.map(item => <div key={item.id}><img src={item.previewUrl} alt={item.name} /><button type="button" onClick={() => removeAttachment(item.id)}><X size={11} /></button></div>)}</div> : null}<div className="workflow-agent__composer"><input ref={fileInput} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={event => { void addAttachments(event.target.files); event.target.value = ''; }} /><button type="button" className="is-secondary" title="添加图片" onClick={() => fileInput.current?.click()} disabled={sending}><ImagePlus size={14} /></button><textarea value={prompt} onChange={event => setPrompt(event.target.value)} onPaste={event => { const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); void addAttachments(files); } }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={canSend ? '让 Agent 读取并修改当前 Workflow' : mode === 'online' ? '请先配置网站 Agent' : '请先连接本机 Agent'} /><button type="button" onClick={() => void send()} disabled={!canSend || sending}><Send size={14} /></button></div></>}
        {tab === 'history' && (mode === 'online' ? <div className="workflow-agent__history">{onlineSessions.length ? onlineSessions.map(session => <div key={session.id}><button type="button" onClick={() => { onProjectChange?.({ agentSessions: project.agentSessions, activeAgentSessionId: session.id }); setMessages(session.messages.map(toDisplayMessage)); setTab('chat'); }}><strong>{session.title}</strong><span>{formatTime(session.updatedAt)}</span></button><button type="button" aria-label="删除对话" onClick={() => onProjectChange?.({ agentSessions: project.agentSessions.filter(item => item.id !== session.id), activeAgentSessionId: project.activeAgentSessionId === session.id ? null : project.activeAgentSessionId })}><Trash2 size={13} /></button></div>) : <p>暂无网站 Agent 对话。</p>}</div> : <div className="workflow-agent__history">{threads.length ? threads.map(thread => <div key={thread.id}><button type="button" onClick={() => void openThread(thread.id)}><strong>{thread.name || thread.preview || thread.id}</strong><span>{formatTime(thread.updatedAt || thread.updated_at)}</span></button><button type="button" aria-label="归档线程" onClick={() => void archiveThread(thread.id)}><Archive size={13} /></button></div>) : <p>暂无当前 Workflow 的 Codex 线程。</p>}</div>)}
        {tab === 'logs' && <div className="workflow-agent__logs"><button type="button" onClick={() => setLogs([])}>清空日志</button><pre>{logs.map(item => `${item.time} [${item.type}] ${item.text}`).join('\n') || '暂无日志。'}</pre></div>}
      </section>
      {confirmation && <div className="workflow-agent__confirm"><strong>Agent 请求修改 Workflow</strong><p>{confirmation.summary}</p><div><button type="button" onClick={() => { confirmation.resolve(false); setConfirmation(undefined); }}>拒绝</button><button type="button" onClick={() => { confirmation.resolve(true); setConfirmation(undefined); }}>允许</button></div></div>}
    </aside>
  );
}

function upsertDelta(items: WorkflowAgentDisplayMessage[], itemId: string, delta: string) {
  return items.some(item => item.id === itemId)
    ? items.map(item => item.id === itemId ? { ...item, text: item.text + delta } : item)
    : [...items.slice(-159), { id: itemId, role: 'assistant' as const, text: delta }];
}

function upsertMessage(items: WorkflowAgentDisplayMessage[], message: WorkflowAgentDisplayMessage) {
  return items.some(item => item.id === message.id) ? items.map(item => item.id === message.id ? { ...item, ...message } : item) : [...items.slice(-159), message];
}

function activeSessionMessages(project: WorkflowProject) {
  const session = project.agentSessions?.find(item => item.id === project.activeAgentSessionId);
  return session?.messages.map(toDisplayMessage) || [];
}

function toStoredMessage(message: WorkflowAgentDisplayMessage): WorkflowAgentMessage {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    title: message.title,
    detail: message.detail === undefined ? undefined : redactWorkflowAgentSnapshot(message.detail),
    status: message.status,
    createdAt: message.createdAt || new Date().toISOString(),
  };
}

function toDisplayMessage(message: WorkflowAgentMessage): WorkflowAgentDisplayMessage {
  return { id: message.id, role: message.role, text: message.text, title: message.title, detail: message.detail, status: message.status, createdAt: message.createdAt };
}

function normalizeThreadMessages(response: any): WorkflowAgentDisplayMessage[] {
  if (Array.isArray(response?.messages)) return response.messages.map((item: any, index: number) => ({ id: String(item.id || `history-${index}`), role: normalizeRole(item.role), text: String(item.text || item.content || ''), title: item.title, detail: item.detail }));
  const turns = response?.thread?.turns || response?.turns || [];
  const result: WorkflowAgentDisplayMessage[] = [];
  turns.forEach((turn: any) => (turn?.items || []).forEach((item: any) => {
    const type = String(item?.type || '');
    if (/userMessage|user_message/i.test(type)) result.push({ id: String(item.id || id()), role: 'user', text: extractText(item) });
    else if (/agentMessage|agent_message/i.test(type)) result.push({ id: String(item.id || id()), role: 'assistant', text: extractText(item) });
    else if (/mcpToolCall|mcp_tool_call/i.test(type)) result.push({ id: String(item.id || id()), role: 'tool', title: String(item.tool || item.name || 'Workflow 工具'), text: item.error ? errorMessage(item.error) : '工具执行记录', detail: item.result || item.arguments, status: item.error ? 'error' : 'success' });
  }));
  return result;
}

function extractText(item: any) {
  if (typeof item?.text === 'string') return item.text;
  if (typeof item?.content === 'string') return item.content;
  if (Array.isArray(item?.content)) return item.content.map((part: any) => part?.text || '').join('');
  return '';
}

function normalizeRole(role: unknown): WorkflowAgentDisplayMessage['role'] {
  return ['user', 'assistant', 'system', 'tool', 'error'].includes(String(role)) ? role as WorkflowAgentDisplayMessage['role'] : 'system';
}

function readDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

function formatTime(value: unknown) {
  if (!value) return '';
  const numeric = typeof value === 'number' && value < 10_000_000_000 ? value * 1000 : value;
  const date = new Date(numeric as string | number);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

function statusLabel(status: Status) {
  return status === 'connected' ? '已连接' : status === 'connecting' ? '连接中' : status === 'error' ? '异常' : '未连接';
}

function errorMessage(value: unknown) {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  return String((value as any)?.message || value || '未知错误');
}
