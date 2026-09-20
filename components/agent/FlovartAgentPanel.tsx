import { AtSign, Box, Check, Circle, Hand, History, Image as ImageIcon, Plus, RotateCw, Send, Settings2, ShieldCheck, Square, Trash2, Video, WandSparkles, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getManagedAgentConnection } from '../../services/managedAgentConnection';
import {
  ManagedFlovartAgentClient,
  type FlovartAgentSnapshot,
  type FlovartAgentTurnEvent,
} from '../../services/managedFlovartAgent';
import { WorkflowAgentBridge } from '../../services/workflowAgentBridge';
import { WorkflowAgentMessages, type WorkflowAgentDisplayMessage } from '../workflow/WorkflowAgentMessages';
import type { WorkflowProject } from '../workflow/types';
import type { AgentPanelStatus } from './agentWorkspaceStore';
import { ProductionSkillDeck } from './ProductionSkillDeck';
import {
  createProductionSkillAttachment,
  createSkillAttachment,
  getBundledProductionSkill,
  type ProductionSkillAttachment,
} from '../../services/productionSkillCatalog';
import { createLocalSkillRegistry } from '../../services/localSkillRegistry';
import { consumePendingProductionSkill } from '../../stores/useProductionSkillComposerStore';
import { BrowserAgentKernel, createBrowserAgentTools, resolveBrowserAgentTextRoute } from '../../services/browserAgentKernel';
import type { AssetLibrary, UserApiKey } from '../../types';

interface FlovartAgentPanelProps {
  project: WorkflowProject;
  onActivityChange: (status: AgentPanelStatus) => void;
  onOpenSettings: () => void;
  assetLibrary?: AssetLibrary;
  onFocusNode?: (nodeId: string) => void;
  /** 浏览器内置 PI 内核的 agent-text 线路来源（OpenAI 兼容 Key 的模型映射） */
  userApiKeys?: UserApiKey[];
}

interface AgentReference {
  id: string;
  type: 'node' | 'asset';
  label: string;
  mediaType?: string;
}

const AGENT_TEXT_CONFIGURATION_MESSAGE = '内置助手还需要一个 AI 服务。设置完成后即可在当前画布旁直接对话。';

function isAgentTextConfigurationError(error?: string) {
  const message = String(error || '').toLowerCase();
  return message.includes('no agent-text route')
    || message.includes('no configured agent-text credential');
}

function displayError(error: string) {
  return isAgentTextConfigurationError(error) ? AGENT_TEXT_CONFIGURATION_MESSAGE : error;
}

function formatSessionTime(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '';
  const delta = Date.now() - time;
  if (delta < 60_000) return '刚刚';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  return new Date(time).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function snapshotNeedsConfiguration(snapshot: FlovartAgentSnapshot) {
  const latestAssistant = [...snapshot.messages].reverse().find(message => message.role === 'assistant');
  return isAgentTextConfigurationError(latestAssistant?.error);
}

function displayMessages(snapshot: {
  messages: Array<{ id: string; role: string; text: string; toolName?: string; isError?: boolean; timestamp?: number; error?: string }>;
  boundProductionSkill?: ProductionSkillAttachment | null;
}): WorkflowAgentDisplayMessage[] {
  return snapshot.messages.map(message => ({
    id: message.id,
    role: (message.error ? 'error' : message.role) as WorkflowAgentDisplayMessage['role'],
    text: message.error ? displayError(message.error) : message.text,
    title: message.role === 'tool' ? message.toolName : undefined,
    status: message.role === 'tool' ? message.isError ? 'error' : 'success' : undefined,
    createdAt: message.timestamp ? new Date(message.timestamp).toISOString() : undefined,
  }));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'Flovart Agent 运行失败');
}

function toolResultText(result: unknown) {
  const content = (result as { content?: Array<{ type?: string; text?: string }> })?.content;
  return content?.filter(item => item.type === 'text').map(item => item.text).filter(Boolean).join('\n') || 'Workflow 操作已完成';
}

export function FlovartAgentPanel({ project, onActivityChange, onOpenSettings, assetLibrary, onFocusNode, userApiKeys = [] }: FlovartAgentPanelProps) {
  const client = useRef<ManagedFlovartAgentClient | undefined>(undefined);
  const kernelRef = useRef<BrowserAgentKernel | undefined>(undefined);
  const unsubscribeRef = useRef<(() => void) | undefined>(undefined);
  const userApiKeysRef = useRef(userApiKeys);
  userApiKeysRef.current = userApiKeys;
  const workspaceBridge = useRef<WorkflowAgentBridge | undefined>(undefined);
  const abort = useRef<AbortController | undefined>(undefined);
  const composer = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const skillAttachmentDirty = useRef(false);
  const activity = useRef(onActivityChange);
  const modeRef = useRef<'manual' | 'auto'>('auto');
  const confirmationRef = useRef<{ summary: string; resolve: (approved: boolean) => void } | undefined>(undefined);
  const [messages, setMessages] = useState<WorkflowAgentDisplayMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [skillAttachment, setSkillAttachment] = useState<ProductionSkillAttachment>();
  const [status, setStatus] = useState<'connecting' | 'ready' | 'error'>('connecting');
  const [workspaceStatus, setWorkspaceStatus] = useState<'connecting' | 'ready' | 'error'>('connecting');
  const [sending, setSending] = useState(false);
  const [needsConfiguration, setNeedsConfiguration] = useState(false);
  const [confirmation, setConfirmation] = useState<{ summary: string; resolve: (approved: boolean) => void }>();
  const [mode, setMode] = useState<'manual' | 'auto'>('auto');
  const [modeOpen, setModeOpen] = useState(false);
  const [references, setReferences] = useState<AgentReference[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState<AgentReference | null>(null);
  const [infoPanel, setInfoPanel] = useState<'context' | 'safety' | null>(null);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [sessionList, setSessionList] = useState<Array<{ id: string; title: string; updatedAt: string }>>([]);
  const [activeSessionId, setActiveSessionId] = useState('');

  const referenceGroups = useMemo(() => {
    const query = mentionQuery.trim().toLowerCase();
    const matches = (label: string) => !query || label.toLowerCase().includes(query);
    return {
      nodes: project.nodes
        .filter(node => node.isVisible !== false && matches(node.title || node.id))
        .map(node => ({ id: node.id, type: 'node' as const, label: node.title || '未命名节点', mediaType: node.type })),
      assets: (assetLibrary?.items || [])
        .filter(item => matches(item.name || '未命名素材'))
        .map(item => ({ id: item.id, type: 'asset' as const, label: item.name || '未命名素材', mediaType: item.mimeType })),
    };
  }, [assetLibrary?.items, mentionQuery, project.nodes]);

  useEffect(() => { activity.current = onActivityChange; }, [onActivityChange]);

  // UX-AGT-02: every popover in the agent panel (生成模式 menu, 制作上下文 /
  // 安全边界 info panes, 历史对话 list) must dismiss on Escape and on outside
  // click — the standard transient-layer contract. While open they cover the
  // composer textarea, so leaving them pinned is a real blocker.
  useEffect(() => {
    const anyOpen = modeOpen || infoPanel !== null || sessionsOpen || mentionOpen || attachmentOpen;
    if (!anyOpen) return;
    const closeAll = () => {
      setModeOpen(false);
      setInfoPanel(null);
      setSessionsOpen(false);
      setMentionOpen(false);
      setAttachmentOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAll();
    };
    const onPointer = (event: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const target = event.target as Node | null;
      if (target && root.contains(target)) {
        // Click inside the panel — only dismiss if it landed outside the
        // popover/menu itself so clicks on menu items still register.
        const el = target as Element;
        if (el.closest?.('.agent-mode-menu, .agent-session-menu, .agent-mention-menu, .agent-attachment-menu, [aria-expanded="true"]')) return;
      }
      closeAll();
    };
    document.addEventListener('keydown', onKey);
    // pointerdown (not mousedown): the canvas uses React synthetic pointer
    // events that may preventDefault the mousedown that would follow, so a
    // mousedown listener can be flaky here — pointerdown is the reliable one.
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [modeOpen, infoPanel, sessionsOpen, mentionOpen, attachmentOpen]);
  useEffect(() => {
    skillAttachmentDirty.current = false;
    setSkillAttachment(undefined);
    setReferences([]);
    setMentionOpen(false);
    const pending = consumePendingProductionSkill(project.id);
    if (!pending) return;
    setPrompt(pending.prompt);
    const showError = (message: string) => {
      skillAttachmentDirty.current = false;
      setMessages(items => [...items, { id: crypto.randomUUID(), role: 'error', text: message }]);
    };
    const bundled = getBundledProductionSkill(pending.skillId);
    if (bundled && bundled.version === pending.skillVersion) {
      skillAttachmentDirty.current = true;
      void createProductionSkillAttachment(bundled)
        .then(setSkillAttachment)
        .catch(error => showError(errorMessage(error)));
      return;
    }
    void (async () => {
      try {
        const registry = await createLocalSkillRegistry();
        if (!registry) throw new Error('本机 Skill 需要桌面端 Managed Agent 连接。');
        const manifest = await registry.getSkillManifest(pending.skillId);
        if (manifest.version !== pending.skillVersion) {
          throw new Error(`制作 Skill 版本不匹配：${pending.skillId}@${pending.skillVersion}`);
        }
        skillAttachmentDirty.current = true;
        setSkillAttachment(createSkillAttachment({
          id: manifest.id,
          version: manifest.version,
          contentHash: manifest.contentHash,
          displayName: manifest.displayName,
          trustTier: manifest.trustTier,
        }));
      } catch (error) {
        showError(errorMessage(error));
      }
    })();
  }, [project.id]);
  useEffect(() => {
    let active = true;
    client.current = undefined;
    kernelRef.current = undefined;
    setConfirmation(undefined);
    setStatus('connecting');

    const startBrowserKernel = async () => {
      const route = resolveBrowserAgentTextRoute(userApiKeysRef.current);
      if (!route) {
        if (!active) return;
        setStatus('ready');
        setWorkspaceStatus('ready');
        setNeedsConfiguration(true);
        setMessages([{ id: 'agent-text-config', role: 'error', text: AGENT_TEXT_CONFIGURATION_MESSAGE }]);
        activity.current('error');
        return;
      }
      const confirm = (summary: string) => new Promise<boolean>(resolve => {
        const next = { summary, resolve };
        confirmationRef.current = next;
        setConfirmation(next);
        activity.current('waiting');
      });
      const kernel = new BrowserAgentKernel({
        projectId: project.id,
        route,
        tools: createBrowserAgentTools({ projectId: project.id, confirm, activeChangeSetId: '' }),
        confirm,
      });
      await kernel.openSession();
      if (!active) { await kernel.close(); return; }
      kernelRef.current = kernel;
      const snapshot = await kernel.snapshot();
      const unsubscribe = kernel.subscribe(event => {
        if (!active) return;
        mapKernelEvent(event);
      });
      unsubscribeRef.current = unsubscribe;
      setMessages(displayMessages(snapshot));
      if (snapshot.boundProductionSkill) setSkillAttachment(snapshot.boundProductionSkill);
      setStatus('ready');
      setWorkspaceStatus('ready');
      setNeedsConfiguration(false);
      activity.current(snapshot.messages.length ? 'done' : 'idle');
      void refreshSessions();
    };

    void getManagedAgentConnection()
      .then(async connection => {
        if (!connection) return startBrowserKernel();
        const next = new ManagedFlovartAgentClient(connection);
        const snapshot = await next.session(project.id);
        if (!active) return;
        client.current = next;
        if (typeof EventSource === 'function') {
          const bridge = new WorkflowAgentBridge({
            url: connection.url,
            token: connection.token,
            confirm: summary => new Promise<boolean>(resolve => {
              const next = { summary, resolve };
              confirmationRef.current = next;
              setConfirmation(next);
              activity.current('waiting');
            }),
            confirmWrite: summary => modeRef.current === 'auto' || new Promise<boolean>(resolve => {
              const next = { summary, resolve };
              confirmationRef.current = next;
              setConfirmation(next);
              activity.current('waiting');
            }),
            onStatus: nextStatus => {
              if (!active) return;
              setWorkspaceStatus(nextStatus === 'connected' ? 'ready' : nextStatus === 'error' ? 'error' : 'connecting');
            },
          });
          workspaceBridge.current = bridge;
          bridge.connect();
          await bridge.pushSnapshot(project);
        }
        setMessages(displayMessages(snapshot));
        if (!skillAttachmentDirty.current) setSkillAttachment(snapshot.boundProductionSkill);
        if (snapshot.productionSkillBindingError) {
          setMessages(items => [...items, { id: 'skill-binding-error', role: 'error', text: snapshot.productionSkillBindingError! }]);
        }
        setStatus('ready');
        const configurationNeeded = snapshotNeedsConfiguration(snapshot);
        setNeedsConfiguration(configurationNeeded);
        activity.current(configurationNeeded ? 'error' : snapshot.messages.length ? 'done' : 'idle');
      })
      .catch(error => {
        if (!active) return;
        setStatus('error');
        setWorkspaceStatus('error');
        setNeedsConfiguration(false);
        setMessages([{ id: 'connection-error', role: 'error', text: errorMessage(error) }]);
        activity.current('error');
      });
    return () => {
      active = false;
      abort.current?.abort();
      confirmationRef.current?.resolve(false);
      confirmationRef.current = undefined;
      workspaceBridge.current?.disconnect();
      workspaceBridge.current = undefined;
      unsubscribeRef.current?.();
      unsubscribeRef.current = undefined;
      void kernelRef.current?.close();
      kernelRef.current = undefined;
    };
  }, [project.id]);

  useEffect(() => {
    if (workspaceBridge.current) void workspaceBridge.current.pushSnapshot(project).catch(() => setWorkspaceStatus('error'));
  }, [project]);

  const handleEventRef = useRef<(event: FlovartAgentTurnEvent, assistantId: string) => void>(() => undefined);
  // 内置 PI 内核事件（pi-agent-core）→ 面板事件流（与 Managed Agent 的 SSE 事件同构）
  const mapKernelEvent = useCallback((event: { type: string; [key: string]: unknown }) => {
    if (event.type === 'message_update') {
      const update = (event as { assistantMessageEvent?: { type: string; delta?: string } }).assistantMessageEvent;
      if (update?.type === 'text_delta' && update.delta) {
        handleEventRef.current({ type: 'text-delta', delta: update.delta }, `stream-${crypto.randomUUID()}`);
      }
      return;
    }
    if (event.type === 'agent_start') {
      activity.current('running');
      return;
    }
    if (event.type === 'tool_execution_start') {
      handleEventRef.current({
        type: 'tool-start',
        id: String(event.toolCallId || ''),
        name: String(event.toolName || ''),
        args: event.args,
      }, `tool-${event.toolCallId || ''}`);
      return;
    }
    if (event.type === 'tool_execution_end') {
      handleEventRef.current({
        type: 'tool-end',
        id: String(event.toolCallId || ''),
        name: String(event.toolName || ''),
        result: event.result,
        isError: Boolean(event.isError),
      }, `tool-${event.toolCallId || ''}`);
      return;
    }
    if (event.type === 'session_switched') {
      const kernel = kernelRef.current;
      if (kernel) void kernel.snapshot().then(snapshot => setMessages(displayMessages(snapshot as FlovartAgentSnapshot)));
      return;
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    const kernel = kernelRef.current;
    if (!kernel) return;
    try {
      setSessionList(await kernel.listSessions());
      const snapshot = await kernel.snapshot();
      setActiveSessionId(String((snapshot as { sessionId?: string }).sessionId || ''));
    } catch { /* 会话列表读取失败时保持现状 */ }
  }, []);

  const handleNewConversation = async () => {
    const kernel = kernelRef.current;
    if (!kernel) return;
    try {
      await kernel.newSession();
      await refreshSessions();
      setSessionsOpen(false);
    } catch (error) {
      setMessages(items => [...items, { id: crypto.randomUUID(), role: 'error', text: errorMessage(error) }]);
    }
  };

  const handleOpenSession = async (sessionId: string) => {
    const kernel = kernelRef.current;
    if (!kernel || sending) return;
    try {
      abort.current?.abort();
      await kernel.openSessionById(sessionId);
      await refreshSessions();
      setSessionsOpen(false);
    } catch (error) {
      setMessages(items => [...items, { id: crypto.randomUUID(), role: 'error', text: errorMessage(error) }]);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    const kernel = kernelRef.current;
    if (!kernel) return;
    try {
      await kernel.deleteSession(sessionId);
      await refreshSessions();
    } catch (error) {
      setMessages(items => [...items, { id: crypto.randomUUID(), role: 'error', text: errorMessage(error) }]);
    }
  };

  useEffect(() => { handleEventRef.current = handleEvent; });

  const handleEvent = (event: FlovartAgentTurnEvent, assistantId: string) => {    if (event.type === 'text-delta') {
      setNeedsConfiguration(false);
      setMessages(items => items.some(item => item.id === assistantId)
        ? items.map(item => item.id === assistantId ? { ...item, text: item.text + event.delta } : item)
        : [...items, { id: assistantId, role: 'assistant', text: event.delta }]);
    } else if (event.type === 'snapshot') {
      setNeedsConfiguration(snapshotNeedsConfiguration(event.snapshot));
      setMessages(displayMessages(event.snapshot));
      skillAttachmentDirty.current = false;
      setSkillAttachment(event.snapshot.boundProductionSkill);
    } else if (event.type === 'tool-start') {
      const needsApproval = /production_(?:approve|run)|task_cancel/.test(event.name);
      const productionTool = /production_|workflow_projection|provider_status|task_get/.test(event.name);
      setMessages(items => [...items, {
        id: `tool-${event.id}`,
        role: 'tool',
        title: event.name,
        text: needsApproval ? '等待你的 Production 授权' : productionTool ? '正在读取或编译 Production Plan' : '正在操作同一 Workflow Draft',
        detail: event.args,
        status: 'pending',
      }]);
    } else if (event.type === 'tool-end') {
      setMessages(items => items.map(item => item.id === `tool-${event.id}` ? {
        ...item,
        text: toolResultText(event.result),
        detail: event.result,
        status: event.isError ? 'error' : 'success',
      } : item));
    } else if (event.type === 'error') {
      setNeedsConfiguration(isAgentTextConfigurationError(event.message));
      setMessages(items => [...items, { id: crypto.randomUUID(), role: 'error', text: displayError(event.message) }]);
    }
  };

  const send = async () => {
    const text = prompt.trim();
    if ((!text && references.length === 0) || sending || needsConfiguration) return;
    if (!client.current && !kernelRef.current) {
      setMessages(items => [...items, { id: crypto.randomUUID(), role: 'error', text: 'Flovart Agent 未连接：仅桌面端可用。' }]);
      return;
    }
    const referenceContext = references.length ? `引用上下文：\n${references.map(reference => `- @${reference.label}（${reference.type === 'node' ? `工作流节点 nodeId=${reference.id}` : `我的素材 assetId=${reference.id}`}）`).join('\n')}` : '';
    const requestText = [text, referenceContext].filter(Boolean).join('\n\n');
    const displayText = [text, references.length ? `引用：${references.map(reference => `@${reference.label}`).join('、')}` : ''].filter(Boolean).join('\n\n');
    const assistantId = `stream-${crypto.randomUUID()}`;
    setMessages(items => [...items, { id: crypto.randomUUID(), role: 'user', text: displayText }]);
    setPrompt('');
    setReferences([]);
    setMentionOpen(false);
    setSending(true);
    setStatus('ready');
    setNeedsConfiguration(false);
    activity.current('running');
    const controller = new AbortController();
    abort.current = controller;
    let failed = false;
    try {
      if (kernelRef.current) {
        // 浏览器内置 PI 内核：事件已通过 subscribe 实时推送，这里只需等待完成并同步 snapshot
        await kernelRef.current.send(requestText, [], skillAttachment);
        const snapshot = await kernelRef.current.snapshot();
        if (snapshot.messages.some(message => message.error)) failed = true;
        handleEvent({ type: 'snapshot', snapshot: snapshot as FlovartAgentSnapshot }, assistantId);
      } else {
        await client.current!.turn(project.id, requestText, event => {
          if (event.type === 'error' || (event.type === 'snapshot' && event.snapshot.messages.some(message => message.error))) failed = true;
          handleEvent(event, assistantId);
        }, controller.signal, skillAttachment);
      }
      activity.current(failed ? 'error' : 'done');
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = errorMessage(error);
        setNeedsConfiguration(isAgentTextConfigurationError(message));
        setMessages(items => [...items, { id: crypto.randomUUID(), role: 'error', text: displayError(message) }]);
        activity.current('error');
      }
    } finally {
      setSending(false);
    }
  };

  const updatePrompt = (value: string) => {
    setPrompt(value);
    const match = value.match(/@([^@\s]*)$/);
    setMentionOpen(Boolean(match));
    setMentionQuery(match?.[1] || '');
    setAttachmentOpen(false);
    setReplaceTarget(null);
  };

  const addReference = (reference: AgentReference) => {
    if (replaceTarget) {
      // 替换模式：用新引用顶替目标 chip（保持原位置与类型）
      setReferences(current => current.map(item => item === replaceTarget ? { ...reference } : item));
      setReplaceTarget(null);
    } else {
      setReferences(current => current.some(item => item.id === reference.id && item.type === reference.type) ? current : [...current, reference]);
    }
    setPrompt(current => current.replace(/@([^@\s]*)$/, ''));
    setMentionOpen(false);
    setMentionQuery('');
    window.requestAnimationFrame(() => textarea.current?.focus());
  };

  const openReferencePicker = (type?: AgentReference['type']) => {
    setAttachmentOpen(false);
    setMentionQuery('');
    setMentionOpen(true);
    if (type === 'asset') setPrompt(current => current.replace(/@([^@\s]*)$/, ''));
    window.requestAnimationFrame(() => textarea.current?.focus());
  };

  const startReplace = (reference: AgentReference) => {
    setReplaceTarget(reference);
    openReferencePicker(reference.type);
  };

  const referenceIcon = (reference: AgentReference) => reference.type === 'asset'
    ? reference.mediaType?.startsWith('video/') ? <Video size={13} /> : <ImageIcon size={13} />
    : reference.mediaType === 'video' ? <Video size={13} /> : reference.mediaType === 'image' ? <ImageIcon size={13} /> : <Box size={13} />;

  return (
    <div ref={rootRef} className="workflow-agent is-embedded agent-conversation">
      <header className="workflow-agent__utility agent-conversation__header">
        <strong>对话</strong>
        <span className={`workflow-agent__status is-${needsConfiguration || workspaceStatus === 'error' ? 'error' : status === 'ready' && workspaceStatus === 'ready' ? 'connected' : status}`}>
          <Circle size={8} />{status === 'connecting' ? '连接中' : status === 'error' ? '连接失败' : needsConfiguration ? '需要配置' : workspaceStatus === 'error' ? '工作区断开' : workspaceStatus !== 'ready' ? '同步工作区' : '已就绪'}
        </span>
        {needsConfiguration && <button type="button" className="ml-2 flex items-center gap-1 text-[9px] font-semibold" onClick={onOpenSettings}><Settings2 size={10} />设置 AI</button>}
        <span className="agent-conversation__history ml-auto">
          <button
            type="button"
            aria-label="历史对话"
            aria-expanded={sessionsOpen}
            title="历史对话"
            onClick={() => { setSessionsOpen(open => !open); if (!sessionsOpen) void refreshSessions(); }}
          ><History size={13} />{sessionList.length ? `${sessionList.length}` : ''}</button>
          {sessionsOpen && (
            <div className="agent-session-menu" role="menu" aria-label="历史对话列表">
              <button type="button" role="menuitem" onClick={() => void handleNewConversation()}><Plus size={14} /><span><strong>新对话</strong><small>开启一段全新会话</small></span></button>
              <div className="agent-session-menu__list">
                {sessionList.length === 0 && <p className="agent-session-menu__empty">暂无历史对话</p>}
                {sessionList.map(session => (
                  <div key={session.id} className={`agent-session-menu__item${session.id === activeSessionId ? ' is-active' : ''}`}>
                    <button type="button" role="menuitem" onClick={() => void handleOpenSession(session.id)}>
                      <strong>{session.title || '新对话'}</strong>
                      <small>{formatSessionTime(session.updatedAt)}</small>
                    </button>
                    <button type="button" aria-label={`删除对话 ${session.title}`} onClick={() => void handleDeleteSession(session.id)}><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </span>
      </header>
      <section className="workflow-agent__body">
        <div className="agent-conversation__messages"><WorkflowAgentMessages messages={messages} running={sending} /></div>
        {!messages.some(message => message.role === 'user' || message.role === 'assistant' || message.role === 'tool') && !skillAttachment && <ProductionSkillDeck
          attachment={skillAttachment}
          onChange={value => { skillAttachmentDirty.current = true; setSkillAttachment(value); }}
          dropTargetRef={composer}
          onPromptChange={setPrompt}
          showWelcome
        />}
        {confirmation && <div className="workflow-agent__confirm"><strong>Agent 请求确认</strong><p>{confirmation.summary}</p><div><button type="button" onClick={() => { confirmationRef.current = undefined; confirmation.resolve(false); setConfirmation(undefined); activity.current('running'); }}>拒绝</button><button type="button" onClick={() => { confirmationRef.current = undefined; confirmation.resolve(true); setConfirmation(undefined); activity.current('running'); }}>允许</button></div></div>}
        <div ref={composer} className="workflow-agent__composer">
          <ProductionSkillDeck attachment={skillAttachment} onChange={value => { skillAttachmentDirty.current = true; setSkillAttachment(value); }} dropTargetRef={composer} />
          {mentionOpen && <div className="agent-reference-picker" role="listbox" aria-label="@ 引用节点和资产">
            <div className="agent-reference-picker__search"><AtSign size={14} /><span>{replaceTarget ? `替换“${replaceTarget.label}”为…` : mentionQuery ? `搜索“${mentionQuery}”` : '引用节点或我的素材'}</span></div>
            <div className="agent-reference-picker__list">
              <ReferenceGroup label="节点" items={referenceGroups.nodes} onSelect={addReference} icon={referenceIcon} empty="没有匹配节点" />
              <ReferenceGroup label="资产" items={referenceGroups.assets} onSelect={addReference} icon={referenceIcon} empty={assetLibrary?.items.length ? '没有匹配资产' : '我的素材为空'} />
            </div>
          </div>}
          {references.length > 0 && <div className="agent-reference-chips" aria-label="已引用内容">{references.map(reference => <span key={`${reference.type}:${reference.id}`} className="agent-reference-chip">
            <button type="button" className="agent-reference-chip__target" aria-label={reference.type === 'node' ? `定位节点 ${reference.label}` : `已引用资产 ${reference.label}`} onClick={() => reference.type === 'node' && onFocusNode?.(reference.id)}>{referenceIcon(reference)}<span>{reference.label}</span></button>
            <button type="button" aria-label={`替换引用 ${reference.label}`} onClick={() => startReplace(reference)}><RotateCw size={12} /></button>
            <button type="button" aria-label={`移除引用 ${reference.label}`} onClick={() => setReferences(current => current.filter(item => item !== reference))}><X size={12} /></button>
          </span>)}</div>}
          <textarea
            ref={textarea}
            value={prompt}
            onChange={event => updatePrompt(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape' && mentionOpen) { event.preventDefault(); setMentionOpen(false); setReplaceTarget(null); return; }
              if (event.key === 'Backspace' && !prompt && references.length) { event.preventDefault(); setReferences(current => current.slice(0, -1)); return; }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder={needsConfiguration ? '先设置 AI 服务后即可对话' : status === 'ready' ? '告诉 Flovart Agent 你想制作什么' : 'Flovart Agent 连接失败'}
            aria-label="开始你的创作，或者 @ 引用工作流/节点/资源"
            aria-describedby={needsConfiguration ? 'agent-composer-setup-help' : undefined}
            disabled={status === 'connecting'}
          />
          {needsConfiguration && <div id="agent-composer-setup-help" role="status" className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[10px]" style={{ color: 'var(--isl-ink-soft)', background: 'var(--agent-subtle)' }}><span>内置助手还需要一个 AI 服务。</span><button type="button" className="font-semibold" style={{ color: 'var(--isl-accent)' }} onClick={onOpenSettings}>立即设置</button></div>}
          <div className="agent-composer__controls">
            <div className="agent-composer__tools">
              <div className="agent-attachment-control">
                <button type="button" aria-label="添加附件" aria-expanded={attachmentOpen} onClick={() => { setAttachmentOpen(open => !open); setMentionOpen(false); }}><Plus size={17} /></button>
                {attachmentOpen && <div className="agent-attachment-menu" role="menu" aria-label="添加引用">
                  <button type="button" role="menuitem" onClick={() => openReferencePicker('node')}><Box size={15} /><span><strong>引用工作流节点</strong><small>从当前画布选择</small></span></button>
                  <button type="button" role="menuitem" onClick={() => openReferencePicker('asset')}><ImageIcon size={15} /><span><strong>从我的素材添加</strong><small>{assetLibrary?.items.length || 0} 个本地资产</small></span></button>
                </div>}
              </div>
              <div className="agent-mode-control">
                <button type="button" aria-label="制作上下文" aria-expanded={infoPanel === 'context'} title="查看当前项目上下文" onClick={() => setInfoPanel(panel => panel === 'context' ? null : 'context')}><WandSparkles size={16} /></button>
                {infoPanel === 'context' && <div className="agent-mode-menu" role="dialog" aria-label="制作上下文">
                  <div style={{ padding: '10px 12px' }}>
                    <strong style={{ display: 'block', fontSize: 13 }}>{project.title}</strong>
                    <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
                      {[[project.nodes.length, '节点'], [project.connections.length, '连接'], [(project.draftChangeSets || []).length, '变更']].map(([value, label]) => <span key={String(label)} style={{ fontSize: 11, color: 'var(--isl-ink-soft)' }}><b style={{ display: 'block', fontSize: 15, color: 'var(--isl-ink)' }}>{value}</b>{label}</span>)}
                    </div>
                    <p style={{ margin: '10px 0 0', fontSize: 10, lineHeight: 1.6, color: 'var(--isl-ink-ghost)' }}>Agent 自动读取当前 Workflow Draft，可逆操作直接进入画布时间线，无需手动同步。</p>
                  </div>
                </div>}
              </div>
              <div className="agent-mode-control">
                <button type="button" aria-label="安全边界" aria-expanded={infoPanel === 'safety'} title="查看确认策略" onClick={() => setInfoPanel(panel => panel === 'safety' ? null : 'safety')}><ShieldCheck size={16} /></button>
                {infoPanel === 'safety' && <div className="agent-mode-menu" role="dialog" aria-label="安全边界">
                  <div style={{ padding: '10px 12px' }}>
                    <strong style={{ display: 'block', fontSize: 13 }}>确认策略</strong>
                    <p style={{ margin: '8px 0 0', fontSize: 10, lineHeight: 1.7, color: 'var(--isl-ink-soft)' }}>{mode === 'manual' ? '手动模式：每个 Workflow 写操作都会先询问。' : '自动模式：可逆操作自动推进；'}<br />删除、付费生成、Production 批准/运行、任务取消<b style={{ color: 'var(--isl-ink)' }}>始终需要确认</b>。</p>
                  </div>
                </div>}
              </div>
              <button type="button" aria-label="重新同步" title="重新同步" onClick={() => void workspaceBridge.current?.pushSnapshot(project).catch(() => setWorkspaceStatus('error'))}><RotateCw size={15} /></button>
              <div className="agent-mode-control">
                <button type="button" aria-label="生成模式" aria-expanded={modeOpen} onClick={() => setModeOpen(value => !value)}>{mode === 'manual' ? <Hand size={15} /> : <RotateCw size={15} />}<span>{mode === 'manual' ? '手动' : '自动'}</span></button>
                {modeOpen && <div className="agent-mode-menu" role="menu" aria-label="生成模式">
                  <button type="button" role="menuitem" aria-pressed={mode === 'manual'} onClick={() => { modeRef.current = 'manual'; setMode('manual'); setModeOpen(false); }}><Hand size={17} /><span><strong>手动模式</strong><small>每个写操作前询问</small></span>{mode === 'manual' && <Check size={15} />}</button>
                  <button type="button" role="menuitem" aria-pressed={mode === 'auto'} onClick={() => { modeRef.current = 'auto'; setMode('auto'); setModeOpen(false); }}><RotateCw size={17} /><span><strong>自动模式</strong><small>可逆操作自动推进；付费、删除仍确认</small></span>{mode === 'auto' && <Check size={15} />}</button>
                </div>}
              </div>
            </div>
            {sending
              ? <button type="button" className="agent-composer__send" aria-label="停止" onClick={() => { abort.current?.abort(); activity.current('idle'); if (kernelRef.current) kernelRef.current.cancel(); else void client.current?.cancel(project.id); }}><Square size={13} /></button>
              : <button type="button" className="agent-composer__send" aria-label="发送" onClick={() => void send()} disabled={status !== 'ready' || needsConfiguration || (!prompt.trim() && references.length === 0)}><Send size={16} /></button>}
          </div>
        </div>
      </section>
    </div>
  );
}

function ReferenceGroup({ label, items, onSelect, icon, empty }: { label: string; items: AgentReference[]; onSelect: (reference: AgentReference) => void; icon: (reference: AgentReference) => React.ReactNode; empty: string }) {
  return <section className="agent-reference-group"><strong>{label}</strong>{items.length
    ? items.slice(0, 12).map(item => <button type="button" role="option" key={`${item.type}:${item.id}`} onClick={() => onSelect(item)}>{icon(item)}<span>{item.label}</span><small>{item.type === 'node' ? item.mediaType : item.mediaType?.replace(/^\w+\//, '')}</small></button>)
    : <p>{empty}</p>}</section>;
}
