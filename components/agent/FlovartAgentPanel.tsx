import { AtSign, Box, Check, ChevronDown, Copy, GitBranch, Hand, Image as ImageIcon, KeyRound, LayoutGrid, Plus, RotateCw, Send, Square, Trash2, Video, X } from 'lucide-react';
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AGENT_ATTACHMENT_MAX, composerAttachmentsToImages, createComposerAttachment, mergeComposerAttachments, releaseComposerAttachment, type AgentComposerAttachment } from '../../services/agentComposerAttachments';
import { getManagedAgentConnection } from '../../services/managedAgentConnection';
import { isTauri } from '@tauri-apps/api/core';
import {
  ManagedFlovartAgentClient,
  type FlovartAgentSnapshot,
  type FlovartAgentTurnEvent,
} from '../../services/managedFlovartAgent';
import { setAgentGateKeysProvider, WorkflowAgentBridge } from '../../services/workflowAgentBridge';
import { WorkflowAgentMessages, type WorkflowAgentDisplayMessage } from '../workflow/WorkflowAgentMessages';
import type { WorkflowProject } from '../workflow/types';
import type { AgentPanelStatus } from './agentWorkspaceStore';
import { consumeSpendMandate, createSpendMandate, defaultMandateTasks, describeMandateDenial, evaluateSpendMandate, planBlocked, spendDemand, type AgentConfirmRequest, type AgentSpendMandate } from '../../services/agentSpendMandate';
import { ProductionSkillDeck } from './ProductionSkillDeck';
import {
  createProductionSkillAttachment,
  createSkillAttachment,
  getBundledProductionSkill,
  type ProductionSkillAttachment,
} from '../../services/productionSkillCatalog';
import { createLocalSkillRegistry } from '../../services/localSkillRegistry';
import { consumePendingProductionSkill } from '../../stores/useProductionSkillComposerStore';
import { BROWSER_DEFAULT_SYSTEM_PROMPT, BrowserAgentKernel, createBrowserAgentTools, resolveBrowserAgentTextRoute } from '../../services/browserAgentKernel';
import { loadAgentNodeMedia } from '../../services/agentMediaView';
import { formatReceiptContext } from '../../services/agentReceipts';
import { useAgentReceiptStore } from '../../stores/useAgentReceiptStore';
import { displayError as toDisplayError } from '../../services/displayError';
import { agentSetupMessage, classifyAgentSetupError, type AgentSetupBlocker } from '../../services/runtimeHealth';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { translations } from '../../utils/translations';
import type { AssetLibrary, UserApiKey } from '../../types';
import { AgentEmptyState, CreationModeControl, creationModeLabel, type AgentModelSelection, type AgentQuickAction } from './AgentComposerExtras';
import { AgentModelPicker } from './AgentModelPicker';
import { applyAgentTurnPreamble, recipeFromNodes, skillFromRecipe, type AgentCreationMode } from '../../services/canvasSkillRecipe';
import { useAgentGroupInboxStore, type AgentGroupPayload } from '../../stores/useAgentGroupInboxStore';
import { useMineSkillsStore } from './mineSkills';
import { AgentReferenceChip } from './AgentReferenceChip';
import { AgentTodoCard } from './AgentTodoCard';
import { copyToClipboard, transcriptMarkdown } from './agentTranscript';
import { resolveSearchCredential } from '../../services/agentWebSearch';
import { policyForMode } from '../../services/agentToolPolicy';
import { AGENT_TODO_TOOL_NAME, latestTodoFromMessages, todoFromToolResult, type AgentTodoItem } from './agentTodo';
import { AgentHeaderLeadingContext } from './agentHeaderSlot';
import { DrawerChromeCollapse, DrawerChromeTabs } from '../studio/drawerChrome';
import { GenerationPlanCard } from '../GenerationPlanCard';
import { activityAfterConfirmation, agentLayerReducer, blockerAfterCredentialSignal, closedLayers, needsCredential, replacePendingConfirmation, useAgentTurn } from './agentPanelState';

interface FlovartAgentPanelProps {
  project: WorkflowProject;
  onActivityChange: (status: AgentPanelStatus) => void;
  onOpenSettings: () => void;
  assetLibrary?: AssetLibrary;
  onFocusNode?: (nodeId: string) => void;
  /** 浏览器内置 PI 内核的 agent-text 线路来源（OpenAI 兼容 Key 的模型映射） */
  userApiKeys?: UserApiKey[];
  /** 模型选择器里新增 Key / 切换 agent-text 模型，直接写入全局 AI 服务设置 */
  onAddApiKey?: (payload: Omit<UserApiKey, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onUpdateApiKey?: (id: string, patch: Partial<Omit<UserApiKey, 'id' | 'createdAt'>>) => void;
}

interface AgentReference {
  id: string;
  type: 'node' | 'asset';
  label: string;
  mediaType?: string;
}

function isAgentTextConfigurationError(error?: string) {
  const message = String(error || '').toLowerCase();
  return message.includes('no agent-text route')
    || message.includes('no configured agent-text credential');
}

function agentMessageText(error: string, language: 'en' | 'zho') {
  return isAgentTextConfigurationError(error) ? translations[language].agentPanel.textRouteRequired : toDisplayError(error);
}

function localizedAgentSetupMessage(kind: AgentSetupBlocker, cause: unknown, language: 'en' | 'zho') {
  if (kind === 'credential') return translations[language].agentPanel.setupCredential;
  if (kind === 'offline') return translations[language].agentPanel.setupOffline;
  return agentSetupMessage(kind, cause);
}

function formatSessionTime(value: string, language: 'en' | 'zho') {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '';
  const delta = Date.now() - time;
  if (language === 'en') {
    if (delta < 60_000) return 'Just now';
    if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} min ago`;
    if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} hr ago`;
  } else {
    if (delta < 60_000) return '刚刚';
    if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
    if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  }
  return new Date(time).toLocaleDateString(language === 'en' ? 'en-US' : 'zh-CN', { month: 'numeric', day: 'numeric' });
}

function snapshotNeedsConfiguration(snapshot: FlovartAgentSnapshot) {
  const latestAssistant = [...snapshot.messages].reverse().find(message => message.role === 'assistant');
  return isAgentTextConfigurationError(latestAssistant?.error);
}

function displayMessages(snapshot: {
  messages: Array<{ id: string; role: string; text: string; toolName?: string; isError?: boolean; timestamp?: number; error?: string }>;
  boundProductionSkill?: ProductionSkillAttachment | null;
}, language: 'en' | 'zho'): WorkflowAgentDisplayMessage[] {
  return snapshot.messages.map(message => ({
    id: message.id,
    role: (message.error ? 'error' : message.role) as WorkflowAgentDisplayMessage['role'],
    text: message.error ? agentMessageText(message.error, language) : message.text,
    title: message.role === 'tool' ? message.toolName : undefined,
    status: message.role === 'tool' ? message.isError ? 'error' : 'success' : undefined,
    createdAt: message.timestamp ? new Date(message.timestamp).toISOString() : undefined,
  }));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'Flovart Agent 运行失败');
}

function toolResultText(result: unknown, language: 'en' | 'zho') {
  const content = (result as { content?: Array<{ type?: string; text?: string }> })?.content;
  return content?.filter(item => item.type === 'text').map(item => item.text).filter(Boolean).join('\n') || (language === 'en' ? 'Workflow operation completed.' : 'Workflow 操作已完成');
}

export function FlovartAgentPanel({ project, onActivityChange, onOpenSettings, assetLibrary, onFocusNode, userApiKeys = [], onAddApiKey, onUpdateApiKey }: FlovartAgentPanelProps) {
  const client = useRef<ManagedFlovartAgentClient | undefined>(undefined);
  const kernelRef = useRef<BrowserAgentKernel | undefined>(undefined);
  const unsubscribeRef = useRef<(() => void) | undefined>(undefined);
const userApiKeysRef = useRef(userApiKeys);
  userApiKeysRef.current = userApiKeys;
  // 内核只在 route 变化时重建：无 Key 打开面板后再导入 Key/切模型，必须重新解析 route，否则一直停在 credential 阻塞。
  const searchCredential = useMemo(() => resolveSearchCredential(userApiKeys), [userApiKeys]);
  const browserRouteSignature = useMemo(() => {
    const route = resolveBrowserAgentTextRoute(userApiKeys);
    const search = resolveSearchCredential(userApiKeys);
    // 搜索凭证也决定工具集：换 Key 时必须重建内核，否则 flovart_web_search 不会出现。
    const searchSignature = search ? search.baseUrl + '\u0000' + search.key : '';
    return route ? [route.provider, route.baseUrl, route.model, route.apiKey, route.streamUsage ?? '', searchSignature].join('\u0000') : '';
  }, [userApiKeys]);
  const workspaceBridge = useRef<WorkflowAgentBridge | undefined>(undefined);
  const abort = useRef<AbortController | undefined>(undefined);
  type PendingConfirmation = { summary: string; resolve: (approved: boolean) => void; request?: AgentConfirmRequest; offerMandate?: boolean; blocked?: boolean };
  const composer = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  // 跟随到底部：贴近底部（或刚发送）时，新消息和流式增量自动滚到底；用户上翻阅读历史时不打扰。
  const stickToBottom = useRef(true);
  const skillAttachmentDirty = useRef(false);
  const activity = useRef(onActivityChange);
  const modeRef = useRef<'manual' | 'auto'>('auto');
  const confirmationRef = useRef<PendingConfirmation | undefined>(undefined);
  // 自动模式付费授权：第一次生成时确认上限，之后上限内的生成自动批准。
  const mandateRef = useRef<AgentSpendMandate | null>(null);
  // 内核工具（media_view）在会话期间读取最新画布节点。
  const projectRef = useRef(project);
  projectRef.current = project;
  const [messages, setMessages] = useState<WorkflowAgentDisplayMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [skillAttachment, setSkillAttachment] = useState<ProductionSkillAttachment>();
  const [status, setStatus] = useState<'connecting' | 'ready' | 'error'>('connecting');
  const [workspaceStatus, setWorkspaceStatus] = useState<'connecting' | 'ready' | 'error'>('connecting');
  // 一轮对话的显式状态：idle | sending | awaitingConfirmation | stopping；sending 只是派生值。
  const { turn, turnRef, dispatchTurn } = useAgentTurn();
  const sending = turn.phase !== 'idle';
  const [confirmation, setConfirmation] = useState<PendingConfirmation>();
  const [mandate, setMandate] = useState<AgentSpendMandate | null>(null);
  const [mandateTasks, setMandateTasks] = useState(10);
  const [mode, setMode] = useState<'manual' | 'auto'>('auto');
  const hasMessages = messages.length > 0;
  useLayoutEffect(() => {
    const scrollers = messageScrollers(messagesRef.current);
    const onScroll = (event: Event) => {
      const el = event.currentTarget as HTMLElement;
      stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    scrollers.forEach(el => el.addEventListener('scroll', onScroll, { passive: true }));
    return () => scrollers.forEach(el => el.removeEventListener('scroll', onScroll));
  }, [hasMessages]);
  useLayoutEffect(() => {
    if (!stickToBottom.current) return;
    for (const el of messageScrollers(messagesRef.current)) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);
  // 面板内所有浮层共用一个 openLayer：同一时刻只开一个，Escape/外部点击统一关闭。
  const [layers, dispatchLayer] = useReducer(agentLayerReducer, closedLayers);
  const { layer: openLayer, slashQuery } = layers;
  const modeOpen = openLayer === 'mode';
  const sessionsOpen = openLayer === 'sessions';
  const mentionOpen = openLayer === 'mention';
  const attachmentOpen = openLayer === 'attachment';
  const creationModeOpen = openLayer === 'creationMode';
  const modelPickerOpen = openLayer === 'modelPicker';
  const skillOpen = openLayer === 'skill';
  const [references, setReferences] = useState<AgentReference[]>([]);
  // 对话框本地附件（粘贴截图 / 拖入视频）：只在当轮对话里作为图片内容发送，不写画布。
  const [attachments, setAttachments] = useState<AgentComposerAttachment[]>([]);
  // 复制反馈：按钮短暂显示「已复制」。
  const [copiedNotice, setCopiedNotice] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attachmentsRef = useRef<AgentComposerAttachment[]>([]);
  attachmentsRef.current = attachments;
  const [attachDragActive, setAttachDragActive] = useState(false);
  const attachDragDepth = useRef(0);
  const [mentionQuery, setMentionQuery] = useState('');
  const [creationMode, setCreationMode] = useState<AgentCreationMode>('all');
  const [preferredModel, setPreferredModel] = useState<AgentModelSelection | null>(null);
  // ProductionSkillDeck 注册的键盘处理：返回 true 表示该按键已被 Skill 列表消费。
  const skillNav = useRef<((key: string) => boolean) | null>(null);
  const [groupBanner, setGroupBanner] = useState<(AgentGroupPayload & { saved?: boolean }) | null>(null);
  const presentConfirmation = (next: PendingConfirmation) => {
    replacePendingConfirmation(confirmationRef, next); // a newer request supersedes; never leave the agent waiting
    setConfirmation(next);
    dispatchTurn({ type: 'confirmRequested' });
    activity.current('waiting');
  };
  const settleConfirmation = (pending: PendingConfirmation, approved: boolean) => {
    const nextActivity = activityAfterConfirmation(turnRef.current.phase);
    confirmationRef.current = undefined;
    pending.resolve(approved);
    setConfirmation(undefined);
    dispatchTurn({ type: 'confirmResolved' });
    if (nextActivity) activity.current(nextActivity);
  };
  const askConfirmation = useRef((summary: string, request?: AgentConfirmRequest): Promise<boolean> => {
    // 停止中的轮次不再弹确认卡：直接拒绝，让内核尽快收尾。
    if (turnRef.current.phase === 'stopping') return Promise.resolve(false);
    const current = mandateRef.current;
    if (modeRef.current === 'auto' && current && request && evaluateSpendMandate(current, request).allow) {
      const next = consumeSpendMandate(current, request);
      mandateRef.current = next;
      setMandate(next);
      return Promise.resolve(true);
    }
    return new Promise<boolean>(resolve => {
      const offerMandate = modeRef.current === 'auto' && request?.kind === 'generation' && (request.gates?.length ?? 0) > 0 && !planBlocked(request);
      if (offerMandate) setMandateTasks(defaultMandateTasks(request));
      // 有计划时由 GenerationPlanCard 展示，文本摘要只给 CLI/无宿主。
      presentConfirmation({ summary: request?.gates?.length ? '' : summary, resolve, request, offerMandate, blocked: planBlocked(request) });
    });
  }).current;
  useEffect(() => {
    setAgentGateKeysProvider(() => userApiKeysRef.current);
    return () => setAgentGateKeysProvider(null);
  }, []);
  const [replaceTarget, setReplaceTarget] = useState<AgentReference | null>(null);
  const [sessionList, setSessionList] = useState<Array<{ id: string; title: string; updatedAt: string }>>([]);
  const [activeSessionId, setActiveSessionId] = useState('');
  // Lane15 first-run UX: setupBlocker classifies a cold-open/send failure via
  // the executor taxonomy (runtimeHealth) instead of raw strings, so the panel
  // can render a real next step ('Add API key') instead of a jargon dead end.
  const [setupBlocker, setSetupBlocker] = useState<AgentSetupBlocker | null>(null);
  const needsConfiguration = needsCredential(setupBlocker);
  const language = useWorkspaceStore(s => s.language);
  const languageRef = useRef(language);
  languageRef.current = language;
  const t = useCallback((key: string, ...args: number[]): string => {
    const dict = translations[language] || translations.en;
    const value = key.split('.').reduce<unknown>((current, part) => {
      if (!current || typeof current !== 'object' || !(part in current)) return undefined;
      return (current as Record<string, unknown>)[part];
    }, dict as unknown);
    if (typeof value === 'function') return String(value(...args));
    return value === undefined ? key : String(value);
  }, [language]);

  const referenceGroups = useMemo(() => {
    const query = mentionQuery.trim().toLowerCase();
    const matches = (label: string) => !query || label.toLowerCase().includes(query);
    return {
      // 图片/视频节点排在前面，方便 @ 引用画面素材。
      nodes: project.nodes
        .filter(node => node.isVisible !== false && matches(node.title || node.id))
        .map(node => ({ id: node.id, type: 'node' as const, label: node.title || '未命名节点', mediaType: node.type }))
        .sort((a, b) => Number(a.mediaType !== 'image' && a.mediaType !== 'video') - Number(b.mediaType !== 'image' && b.mediaType !== 'video')),
      assets: (assetLibrary?.items || [])
        .filter(item => matches(item.name || '未命名素材'))
        .map(item => ({ id: item.id, type: 'asset' as const, label: item.name || '未命名素材', mediaType: item.mimeType })),
    };
  }, [assetLibrary?.items, mentionQuery, project.nodes]);

  useEffect(() => { activity.current = onActivityChange; }, [onActivityChange]);

  // UX-AGT-02: every popover in the agent panel (生成模式 menu, 历史对话 list,
  // @ picker, Skill picker) must dismiss on Escape and on outside click — the
  // standard transient-layer contract. While open they cover the composer
  // textarea, so leaving them pinned is a real blocker.
  useEffect(() => {
    if (openLayer === null) return;
    const closeAll = () => dispatchLayer({ type: 'closeAll' });
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
        if (el.closest?.('.agent-mode-menu, .agent-session-menu, .agent-mention-menu, .agent-reference-picker, .agent-attachment-menu, [aria-expanded="true"]')) return;
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
  }, [openLayer]);
  useEffect(() => {
    // 与下方主连接 effect 相同的 active 防护：异步 settle 后组件可能已卸载/切换项目
    let active = true;
    skillAttachmentDirty.current = false;
    setSkillAttachment(undefined);
    setReferences([]);
    dispatchLayer({ type: 'close', layer: 'mention' });
    const pending = consumePendingProductionSkill(project.id);
    if (!pending) return () => { active = false; };
    setPrompt(pending.prompt);
    const showError = (message: string) => {
      if (!active) return;
      skillAttachmentDirty.current = false;
      setMessages(items => [...items, { id: crypto.randomUUID(), role: 'error', text: message }]);
    };
    const bundled = getBundledProductionSkill(pending.skillId);
    if (bundled && bundled.version === pending.skillVersion) {
      skillAttachmentDirty.current = true;
      void createProductionSkillAttachment(bundled)
        .then(attachment => {
          if (active) setSkillAttachment(attachment);
        })
        .catch(error => showError(errorMessage(error)));
      return () => { active = false; };
    }
    void (async () => {
      try {
        const registry = await createLocalSkillRegistry();
        if (!active) return;
        if (!registry) throw new Error('本机 Skill 需要桌面端 Managed Agent 连接。');
        const manifest = await registry.getSkillManifest(pending.skillId);
        if (!active) return;
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
    return () => { active = false; };
  }, [project.id]);
  useEffect(() => {
    let active = true;
    client.current = undefined;
    kernelRef.current = undefined;
    setConfirmation(undefined);
    mandateRef.current = null;
    setMandate(null);
    setStatus('connecting');
    setSetupBlocker(null);

    const startBrowserKernel = async () => {
      const route = resolveBrowserAgentTextRoute(userApiKeysRef.current);
      if (!route) {
        if (!active) return;
        setStatus('ready');
        setWorkspaceStatus('ready');
        setSetupBlocker('credential');
        setMessages([{ id: 'agent-text-config', role: 'error', text: translations[language].agentPanel.textRouteRequired }]);
        activity.current('error');
        return;
      }
      const confirm = askConfirmation;
      // Shared project receipts are read-only reference text, never merged memory.
      const receiptContext = formatReceiptContext(useAgentReceiptStore.getState().byProject[project.id] || []);
      const kernel = new BrowserAgentKernel({
        projectId: project.id,
        route,
        tools: createBrowserAgentTools({ projectId: project.id, confirm, activeChangeSetId: '', getNodes: () => projectRef.current.nodes, webSearch: searchCredential ?? undefined, getPolicy: () => policyForMode(modeRef.current) }),
        confirm,
        systemPrompt: BROWSER_DEFAULT_SYSTEM_PROMPT + receiptContext,
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
      setMessages(displayMessages(snapshot, language));
      setTodoItems(latestTodoFromMessages((snapshot as FlovartAgentSnapshot).messages) || []);
      if (snapshot.boundProductionSkill) setSkillAttachment(snapshot.boundProductionSkill);
      setStatus('ready');
      setWorkspaceStatus('ready');
      setSetupBlocker(null);
      activity.current(snapshot.messages.length ? 'done' : 'idle');
      void refreshSessions();
    };

    void getManagedAgentConnection()
      .then(async connection => {
        // 网页端没有桌面 Runtime：托管 Agent 的文本出口（/v1/agent-text/stream）不可用。
        // 有可用的浏览器文本线路时，对话走浏览器内核，Key 直连；桌面端仍走托管 Agent。
        if (!connection || (!isTauri() && resolveBrowserAgentTextRoute(userApiKeysRef.current))) return startBrowserKernel();
        const next = new ManagedFlovartAgentClient(connection);
        const snapshot = await next.session(project.id);
        if (!active) return;
        client.current = next;
        if (typeof EventSource === 'function') {
          const bridge = new WorkflowAgentBridge({
            url: connection.url,
            token: connection.token,
            confirm: askConfirmation,
            confirmWrite: summary => modeRef.current === 'auto' || new Promise<boolean>(resolve => presentConfirmation({ summary, resolve })),
            onStatus: nextStatus => {
              if (!active) return;
              setWorkspaceStatus(nextStatus === 'connected' ? 'ready' : nextStatus === 'error' ? 'error' : 'connecting');
            },
          });
          workspaceBridge.current = bridge;
          bridge.connect();
          await bridge.pushSnapshot(project);
        }
        setMessages(displayMessages(snapshot, language));
        setTodoItems(latestTodoFromMessages(snapshot.messages) || []);
        if (!skillAttachmentDirty.current) setSkillAttachment(snapshot.boundProductionSkill);
        if (snapshot.productionSkillBindingError) {
          setMessages(items => [...items, { id: 'skill-binding-error', role: 'error', text: snapshot.productionSkillBindingError! }]);
        }
        setStatus('ready');
        // 旧会话里残留的「No agent-text route」错误不能在已有可用线路后继续拦截；真缺线路时发送会再报错并重新拦截。
        const configurationNeeded = !browserRouteSignature && snapshotNeedsConfiguration(snapshot);
        setSetupBlocker(configurationNeeded ? 'credential' : null);
        activity.current(configurationNeeded ? 'error' : snapshot.messages.length ? 'done' : 'idle');
      })
      .catch(error => {
        if (!active) return;
        // Cold-open failure: classify via the executor/host taxonomy so the
        // panel can offer a real next step instead of a jargon dead end.
        const blocker = classifyAgentSetupError(error);
        setStatus('error');
        setWorkspaceStatus('error');
        setSetupBlocker(blocker === 'unknown' ? 'offline' : blocker);
        setMessages([{ id: 'connection-error', role: 'error', text: localizedAgentSetupMessage(blocker === 'unknown' ? 'offline' : blocker, error, language) }]);
        activity.current('error');
      });
    return () => {
      active = false;
      abort.current?.abort();
      replacePendingConfirmation(confirmationRef, undefined);
      workspaceBridge.current?.disconnect();
      workspaceBridge.current = undefined;
      unsubscribeRef.current?.();
      unsubscribeRef.current = undefined;
      void kernelRef.current?.close();
      kernelRef.current = undefined;
    };
  }, [project.id, browserRouteSignature]);

  useEffect(() => {
    if (workspaceBridge.current) void workspaceBridge.current.pushSnapshot(project).catch(() => setWorkspaceStatus('error'));
  }, [project]);

  // omp 风格的制作任务清单：取最近一次成功的 flovart_todo 结果，会话恢复时从快照重建。
  const [todoItems, setTodoItems] = useState<AgentTodoItem[]>([]);
  const handleEventRef = useRef<(event: FlovartAgentTurnEvent, assistantId: string) => void>(() => undefined);
  // 一条助手消息对应一个流式气泡：message_start 时换新 id，同一消息的 text_delta 共用。
  const streamIdRef = useRef('stream-' + crypto.randomUUID());
  // 内置 PI 内核事件（pi-agent-core）→ 面板事件流（与 Managed Agent 的 SSE 事件同构）
  const mapKernelEvent = useCallback((event: { type: string; [key: string]: unknown }) => {
    if (event.type === 'message_start') {
      streamIdRef.current = 'stream-' + crypto.randomUUID();
      return;
    }
    if (event.type === 'message_update') {
      const update = (event as { assistantMessageEvent?: { type: string; delta?: string } }).assistantMessageEvent;
      if (update?.type === 'text_delta' && update.delta) {
        handleEventRef.current({ type: 'text-delta', delta: update.delta }, streamIdRef.current);
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
    if (event.type === 'tool_execution_update') {
      handleEventRef.current({
        type: 'tool-update',
        id: String(event.toolCallId || ''),
        name: String(event.toolName || ''),
        partial: event.partialResult,
      }, 'tool-' + String(event.toolCallId || ''));
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
      if (kernel) void kernel.snapshot().then(snapshot => {
        setMessages(displayMessages(snapshot as FlovartAgentSnapshot, languageRef.current));
        setTodoItems(latestTodoFromMessages((snapshot as FlovartAgentSnapshot).messages) || []);
      });
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
      dispatchLayer({ type: 'close', layer: 'sessions' });
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
      dispatchLayer({ type: 'close', layer: 'sessions' });
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

  const flashCopied = (label: string) => {
    setCopiedNotice(label);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopiedNotice(null), 1600);
  };

  const copyConversation = async () => {
    const text = transcriptMarkdown(transcriptMessages, { language, title: activeSessionTitle });
    if (await copyToClipboard(text)) flashCopied(language === 'zho' ? '已复制对话' : 'Transcript copied');
  };

  const copyMessage = async (message: WorkflowAgentDisplayMessage) => {
    const text = transcriptMarkdown([message], { language });
    if (await copyToClipboard(text)) flashCopied(language === 'zho' ? '已复制' : 'Copied');
  };

  /** 从某条助手消息处分出新会话：复制到该消息为止，原会话不变。 */
  const branchFromMessage = async (message: WorkflowAgentDisplayMessage) => {
    const kernel = kernelRef.current;
    if (!kernel || sending) return;
    // 点击的消息可能只存在于 UI（流式临时 id），也可能已被压缩；从它开始向前找第一个仍存在的分支点。
    const index = transcriptMessages.indexOf(message);
    const candidates = transcriptMessages
      .slice(0, index < 0 ? transcriptMessages.length : index + 1)
      .map(item => item.id)
      .filter(id => id && !id.startsWith('stream-') && !id.startsWith('tool-'))
      .reverse();
    try {
      await kernel.branchSession(activeSessionId, candidates.length ? candidates : [message.id]);
      await refreshSessions();
      flashCopied(language === 'zho' ? '已创建分支' : 'Branch created');
    } catch (error) {
      setMessages(items => [...items, { id: crypto.randomUUID(), role: 'error', text: errorMessage(error) }]);
    }
  };

  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);

  useEffect(() => { handleEventRef.current = handleEvent; });

  const handleEvent = (event: FlovartAgentTurnEvent, assistantId: string) => {    if (event.type === 'text-delta') {
      setSetupBlocker(current => blockerAfterCredentialSignal(current, false));
      setMessages(items => items.some(item => item.id === assistantId)
        ? items.map(item => item.id === assistantId ? { ...item, text: item.text + event.delta } : item)
        : [...items, { id: assistantId, role: 'assistant', text: event.delta }]);
    } else if (event.type === 'snapshot') {
      setSetupBlocker(current => blockerAfterCredentialSignal(current, snapshotNeedsConfiguration(event.snapshot)));
      setMessages(displayMessages(event.snapshot, language));
      setTodoItems(latestTodoFromMessages(event.snapshot.messages) || []);
      skillAttachmentDirty.current = false;
      setSkillAttachment(event.snapshot.boundProductionSkill);
    } else if (event.type === 'tool-start') {
      const needsApproval = /production_(?:approve|run)|task_cancel/.test(event.name);
      const productionTool = /production_|workflow_projection|provider_status|task_get/.test(event.name);
      setMessages(items => [...items, {
        id: `tool-${event.id}`,
        role: 'tool',
        title: event.name,
        text: needsApproval ? translations[language].agentPanel.toolWaitingApproval : productionTool ? translations[language].agentPanel.toolPreparingPlan : translations[language].agentPanel.toolUpdatingDraft,
        detail: event.args,
        status: 'pending',
      }]);
    } else if (event.type === 'tool-end') {
      setMessages(items => items.map(item => item.id === `tool-${event.id}` ? {
        ...item,
        text: toolResultText(event.result, language),
        detail: event.result,
        status: event.isError ? 'error' : 'success',
      } : item));
      if (event.name === AGENT_TODO_TOOL_NAME && !event.isError) {
        const todo = todoFromToolResult(event.result);
        if (todo) setTodoItems(todo);
      }
    } else if (event.type === 'tool-update') {
      setMessages(items => items.map(item => item.id === 'tool-' + event.id ? { ...item, detail: event.partial } : item));
    } else if (event.type === 'error') {
      // Mid-turn errors are usually transient; only a credential wall earns the
      // guided-action card — everything else stays a plain message.
      const blocker = classifyAgentSetupError(event.message);
      if (blocker === 'credential' || isAgentTextConfigurationError(event.message)) setSetupBlocker('credential');
      setMessages(items => [...items, { id: crypto.randomUUID(), role: 'error', text: agentMessageText(event.message, language) }]);
    }
  };

  const addAttachmentFiles = (files: FileList | File[] | null | undefined) => {
    if (!files) return;
    const incoming = Array.from(files).map(file => createComposerAttachment(file)).filter((item): item is AgentComposerAttachment => Boolean(item));
    if (!incoming.length) return;
    const { kept, rejected } = mergeComposerAttachments(attachmentsRef.current, incoming, AGENT_ATTACHMENT_MAX);
    rejected.forEach(releaseComposerAttachment);
    attachmentsRef.current = kept;
    setAttachments(kept);
    focusComposer();
  };

  const removeAttachment = (attachment: AgentComposerAttachment) => {
    releaseComposerAttachment(attachment);
    const next = attachmentsRef.current.filter(item => item !== attachment);
    attachmentsRef.current = next;
    setAttachments(next);
  };

  // 卸载时释放剩余附件的 object URL，避免内存泄漏。
  useEffect(() => () => {
    attachmentsRef.current.forEach(releaseComposerAttachment);
    attachmentsRef.current = [];
  }, []);

  const send = async () => {
    const text = prompt.trim();
    if ((!text && references.length === 0 && attachments.length === 0) || turnRef.current.phase !== 'idle') return;
    // 连接中不发送（按钮本就禁用）；不再在发送时强行把连接状态改成 ready。
    if (status === 'connecting') return;
    if (!client.current && !kernelRef.current) {
      // Agents-offline / credential wall: never dump '仅桌面端可用'. When the
      // missing piece is an agent-text route the blocker is credential (a key
      // fixes it); otherwise the managed host is simply not running (offline).
      const blocker: AgentSetupBlocker = needsConfiguration ? 'credential' : 'offline';
      setSetupBlocker(blocker);
      setMessages(items => [...items, { id: crypto.randomUUID(), role: 'error', text: localizedAgentSetupMessage(blocker, undefined, language) }]);
      return;
    }
    const referenceContext = references.length ? `引用上下文：\n${references.map(reference => `- @${reference.label}（${reference.type === 'node' ? `工作流节点 nodeId=${reference.id}` : `我的素材 assetId=${reference.id}`}）`).join('\n')}` : '';
    const turnAttachments = attachmentsRef.current;
    const attachmentContext = turnAttachments.length
      ? `本轮附带的本地媒体（画面已作为图片内容一并发给你）：\n${turnAttachments.map(item => `- ${item.kind === 'image' ? '图片' : '视频'}「${item.name}」`).join('\n')}`
      : '';
    const requestText = applyAgentTurnPreamble([text, referenceContext, attachmentContext].filter(Boolean).join('\n\n'), {
      creationMode,
      preferredModel: preferredModel ? { capability: preferredModel.capability, name: preferredModel.name } : null,
    });
    const displayText = [
      text,
      references.length ? `引用：${references.map(reference => `@${reference.label}`).join('、')}` : '',
      turnAttachments.length ? `附件：${turnAttachments.map(item => item.name).join('、')}` : '',
    ].filter(Boolean).join('\n\n');
    const assistantId = `stream-${crypto.randomUUID()}`;
    stickToBottom.current = true;
    setMessages(items => [...items, { id: crypto.randomUUID(), role: 'user', text: displayText }]);
    setPrompt('');
    setReferences([]);
    turnAttachments.forEach(releaseComposerAttachment);
    attachmentsRef.current = [];
    setAttachments([]);
    dispatchLayer({ type: 'close', layer: 'mention' });
    const { turnId } = dispatchTurn({ type: 'send' });
    setSetupBlocker(null);
    activity.current('running');
    const controller = new AbortController();
    abort.current = controller;
    let failed = false;
    try {
      if (kernelRef.current) {
        // 浏览器内置 PI 内核：事件已通过 subscribe 实时推送，这里只需等待完成并同步 snapshot
        // @引用的图片/视频节点自动附带画面（图片 ≤1024px，视频首/中/尾帧，最多 6 张）。
        const referencedNodes = references.flatMap(reference => {
          if (reference.type !== 'node') return [];
          const node = project.nodes.find(item => item.id === reference.id);
          return node ? [node] : [];
        });
        const nodeMedia = referencedNodes.length > 0 ? await loadAgentNodeMedia(referencedNodes) : { images: [], notes: [] };
        const attachmentMedia = turnAttachments.length ? await composerAttachmentsToImages(turnAttachments) : { images: [], notes: [] };
        // 本地附件优先占位，避免被 6 张上限挤掉；节点画面随后补位。
        const media = {
          images: [...attachmentMedia.images, ...nodeMedia.images].slice(0, 6),
          notes: [...attachmentMedia.notes, ...nodeMedia.notes],
        };
        const kernelText = media.notes.length > 0 ? requestText + '\n\n已附带画面：\n' + media.notes.join('\n') : requestText;
        await kernelRef.current.send(kernelText, media.images, skillAttachment);
        const snapshot = await kernelRef.current.snapshot();
        if (snapshot.messages.some(message => message.error)) failed = true;
        handleEvent({ type: 'snapshot', snapshot: snapshot as FlovartAgentSnapshot }, assistantId);
      } else {
        // 托管 Agent 的 /turn 只收文本，无法随消息带图片；明确告知而不是假装看过画面。
        const managedText = turnAttachments.length
          ? requestText + '\n\n注意：本轮附带的本地媒体（' + turnAttachments.map(item => item.name).join('、') + '）无法通过当前托管通道传给 Agent，请先让用户上传到画布或改用内置 Agent。'
          : requestText;
        await client.current!.turn(project.id, managedText, event => {
          if (event.type === 'error' || (event.type === 'snapshot' && event.snapshot.messages.some(message => message.error))) failed = true;
          handleEvent(event, assistantId);
        }, controller.signal, skillAttachment);
      }
      activity.current(failed ? 'error' : 'done');
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = errorMessage(error);
        const blocker = classifyAgentSetupError(error);
        if (blocker === 'credential' || isAgentTextConfigurationError(message)) setSetupBlocker('credential');
        setMessages(items => [...items, { id: crypto.randomUUID(), role: 'error', text: agentMessageText(message, language) }]);
        activity.current('error');
      }
    } finally {
      dispatchTurn({ type: 'settled', turnId });
    }
  };

  // 停止：本轮进入 stopping；发送 promise 结束或取消请求结束，先到者把输入框收回 idle，停止按钮不会卡住。
  const stop = () => {
    const { phase, turnId } = turnRef.current;
    if (phase !== 'sending' && phase !== 'awaitingConfirmation') return;
    dispatchTurn({ type: 'stop' });
    replacePendingConfirmation(confirmationRef, undefined);
    setConfirmation(undefined);
    abort.current?.abort();
    activity.current('idle');
    const cancelled = kernelRef.current ? kernelRef.current.cancel() : client.current?.cancel(project.id);
    void Promise.resolve(cancelled).catch(() => undefined).finally(() => dispatchTurn({ type: 'settled', turnId }));
  };

  const updatePrompt = (value: string) => {
    setPrompt(value);
    const match = value.match(/@([^@\s]*)$/);
    setMentionQuery(match?.[1] || '');
    const slash = match ? null : value.match(/(?:^|\s)\/([^\s/]*)$/);
    dispatchLayer({ type: 'promptChanged', mention: match ? match[1] : null, slash: slash ? slash[1] : null });
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
    dispatchLayer({ type: 'close', layer: 'mention' });
    setMentionQuery('');
    window.requestAnimationFrame(() => textarea.current?.focus());
  };

  const openReferencePicker = (type?: AgentReference['type']) => {
    setMentionQuery('');
    dispatchLayer({ type: 'open', layer: 'mention' });
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


  // 画布「添加到 Agent」：分组节点变成引用 chip，并可保存为可复用的 Skill。
  const pendingGroup = useAgentGroupInboxStore(state => state.pendingGroup);
  useEffect(() => {
    if (!pendingGroup) return;
    const payload = useAgentGroupInboxStore.getState().consume();
    if (!payload) return;
    const byId = new Map(project.nodes.map(node => [node.id, node]));
    const groupRefs = payload.nodeIds.flatMap(id => {
      const node = byId.get(id);
      return node ? [{ id: node.id, type: 'node' as const, label: node.title || '未命名节点', mediaType: node.type }] : [];
    });
    setReferences(current => [...current, ...groupRefs.filter(ref => !current.some(item => item.type === 'node' && item.id === ref.id))]);
    setGroupBanner({ ...payload, nodeIds: groupRefs.map(ref => ref.id) });
  }, [pendingGroup, project.nodes]);

  const saveGroupAsSkill = async () => {
    if (!groupBanner) return;
    try {
      const recipe = recipeFromNodes(project, groupBanner.nodeIds);
      const skill = skillFromRecipe(recipe, { name: groupBanner.label, slug: groupBanner.label, description: language === 'zho' ? `画布分组「${groupBanner.label}」的操作流程（${recipe.steps.length} 步）` : `Canvas group "${groupBanner.label}" (${recipe.steps.length} steps)` });
      await useMineSkillsStore.getState().save(skill);
      setGroupBanner(current => (current ? { ...current, saved: true } : current));
    } catch (error) {
      setMessages(items => [...items, { id: crypto.randomUUID(), role: 'error', text: errorMessage(error) }]);
    }
  };

  const focusComposer = () => window.requestAnimationFrame(() => textarea.current?.focus());
  const runQuickAction = (action: Exclude<AgentQuickAction, 'adapt'>) => {
    const zho = language === 'zho';
    if (action === 'perceive') {
      setPrompt(zho ? '请读取当前画布（优先看已引用和已选节点），总结现状，并给出接下来的创作步骤建议。' : 'Read the current canvas (referenced and selected nodes first), summarize it, and propose the next creative steps.');
    } else if (action === 'preset') {
      setCreationMode('storyboard');
      setPrompt(zho ? '从爆款预设开始原创剧本：先给我 3 个当下热门的短片题材方向（每个含一句话梗概和看点），我选定后再展开分镜。' : 'Start an original script from a hit preset: give me 3 trending short-film directions (one-line logline and hook each); I will pick one before you break it into shots.');
    } else {
      const mediaRefs = project.nodes
        .filter(node => node.isVisible !== false && (node.type === 'image' || node.type === 'video'))
        .slice(0, 12)
        .map(node => ({ id: node.id, type: 'node' as const, label: node.title || '未命名节点', mediaType: node.type }));
      setReferences(current => (current.length ? current : mediaRefs));
      setPrompt(zho ? '请批量优化引用的图片/视频节点的提示词：保持原意，补全主体、镜头、光影、风格，并直接更新到对应节点。' : 'Optimize the prompts of the referenced image/video nodes: keep the intent, add subject, camera, lighting and style, and update each node directly.');
    }
    focusComposer();
  };
  const activeSessionTitle = sessionList.find(session => session.id === activeSessionId)?.title || t('agentPanel.newChat');
  const headerLeading = useContext(AgentHeaderLeadingContext);
  const conversationEmpty = !messages.some(message => message.role === 'user' || message.role === 'assistant' || message.role === 'tool');
  const setupGate = Boolean(setupBlocker);
  // 复制与渲染用同一份可见消息：设置引导卡里的重复错误不导出。
  const transcriptMessages = setupGate ? messages.filter(message => message.id !== 'agent-text-config') : messages;
  return (
    <div ref={rootRef} className="workflow-agent is-embedded agent-conversation">
      <header className="workflow-agent__utility agent-conversation__header">
        {headerLeading}
        <button
          type="button"
          className="agent-header-title"
          aria-label={t('agentPanel.history')}
          aria-expanded={sessionsOpen}
          title={t('agentPanel.history')}
          onClick={() => { dispatchLayer({ type: 'toggle', layer: 'sessions' }); if (!sessionsOpen) void refreshSessions(); }}
        ><span>{activeSessionTitle}</span><ChevronDown size={13} /></button>
        {sessionsOpen && (
          <div className="agent-session-menu agent-header-menu is-left" role="menu" aria-label={t('agentPanel.history')}>
            <button type="button" role="menuitem" onClick={() => void handleNewConversation()}><Plus size={14} /><span><strong>{t('agentPanel.newChat')}</strong><small>{t('agentPanel.newChatHint')}</small></span></button>
            <div className="agent-session-menu__list">
              {sessionList.length === 0 && <p className="agent-session-menu__empty">{t('agentPanel.noHistory')}</p>}
              {sessionList.map(session => (
                <div key={session.id} className={`agent-session-menu__item${session.id === activeSessionId ? ' is-active' : ''}`}>
                  <button type="button" role="menuitem" onClick={() => void handleOpenSession(session.id)}>
                    <strong>{session.title || t('agentPanel.newChat')}</strong>
                    <small>{formatSessionTime(session.updatedAt, language)}</small>
                  </button>
                  <button type="button" aria-label={`删除对话 ${session.title}`} onClick={() => void handleDeleteSession(session.id)}><Trash2 size={12} /></button>
                </div>
              ))}
            </div>
          </div>
        )}
        <DrawerChromeTabs />
        {copiedNotice && <span className="agent-header-notice" role="status">{copiedNotice}</span>}
        <span className="agent-header-actions">
          <button
            type="button"
            className="agent-new-chat-btn is-icon"
            aria-label={language === 'zho' ? '复制整个对话' : 'Copy conversation'}
            title={language === 'zho' ? '复制整个对话（Markdown）' : 'Copy conversation as Markdown'}
            disabled={transcriptMessages.length === 0}
            onClick={() => void copyConversation()}
          ><Copy size={15} /></button>
          <button type="button" className="agent-new-chat-btn is-icon" aria-label={t('agentPanel.newChat')} title={t('agentPanel.newChat')} onClick={() => void handleNewConversation()}><Plus size={15} /></button>
          <DrawerChromeCollapse />
        </span>
      </header>
      <section className="workflow-agent__body">
        {/* When setup is the blocker, the setup card is the one thing to read: drop the duplicate red config error and the browse/skill decks under it. */}
        <div ref={messagesRef} className="agent-conversation__messages"><WorkflowAgentMessages
          messages={transcriptMessages}
          running={sending}
          language={language}
          onCopyMessage={copyMessage}
          onBranchMessage={kernelRef.current ? branchFromMessage : undefined}
          branchDisabled={sending}
        /></div>
        {todoItems.length > 0 && !setupGate && <div className='mx-3'><AgentTodoCard items={todoItems} language={language} /></div>}
        {setupBlocker && (
          <div role="alert" data-testid="agent-setup-card" className="mx-3 mb-2 rounded-xl border px-3 py-2.5" style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-surface-2)' }}>
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.7, color: 'var(--isl-ink-soft)' }}>{localizedAgentSetupMessage(setupBlocker, undefined, language)}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              <button type="button" onClick={onOpenSettings} className="isl-chip flex items-center gap-1 px-3 py-1.5 text-xs font-semibold" style={{ color: 'var(--isl-mint-deep)' }}><KeyRound size={13} />{t('agentPanel.addApiKey')} →</button>
            </div>
          </div>
        )}
        {!setupGate && conversationEmpty && <AgentEmptyState
          language={language}
          onAction={runQuickAction}
          onStoryText={text => { setPrompt(`${language === 'zho' ? '请把以下故事改编为分镜脚本：' : 'Adapt the following story into a shot-by-shot script:'}\n${text}`); setCreationMode('storyboard'); focusComposer(); }}
        />}
        {groupBanner && <div className="agent-group-banner" role="status">
          <LayoutGrid size={14} />
          <span>{groupBanner.nodeIds.length === 1
            ? (language === 'zho' ? `已加入上下文「${groupBanner.label}」` : `Added "${groupBanner.label}" to context`)
            : (language === 'zho' ? `已添加分组「${groupBanner.label}」（${groupBanner.nodeIds.length} 个节点）` : `Added group "${groupBanner.label}" (${groupBanner.nodeIds.length} nodes)`)}</span>
          {groupBanner.nodeIds.length <= 1 ? null : groupBanner.saved
            ? <small>{language === 'zho' ? '已保存到「我的」Skill' : 'Saved to My Skills'}</small>
            : <button type="button" onClick={() => void saveGroupAsSkill()}>{language === 'zho' ? '保存为 Skill' : 'Save as Skill'}</button>}
          <button type="button" aria-label={language === 'zho' ? '关闭' : 'Dismiss'} onClick={() => setGroupBanner(null)}><X size={12} /></button>
        </div>}
        {confirmation && <div className="workflow-agent__confirm"><strong>{t('agentPanel.confirmTitle')}</strong><p>{confirmation.summary}</p>
          {confirmation.request?.gates?.length ? <GenerationPlanCard plan={{ items: [...confirmation.request.gates], mandate: describeMandateDenial(mandate, confirmation.request) }} /> : null}
          {confirmation.offerMandate && <div className="workflow-agent__mandate">
            <label>批准后，本会话自动模式最多自动生成 <input type="number" min={1} value={mandateTasks} onChange={event => setMandateTasks(Math.max(1, Math.floor(Number(event.target.value) || 1)))} aria-label="自动生成任务上限" /> 个任务（含本批），超出会再次询问；删除、取消始终单独确认。</label>
          </div>}
          <div>
            <button type="button" onClick={() => settleConfirmation(confirmation, false)}>{t('agentPanel.deny')}</button>
            {confirmation.offerMandate && confirmation.request && <button type="button" onClick={() => {
              const request = confirmation.request!;
              const granted = consumeSpendMandate(createSpendMandate({ maxTasks: Math.max(mandateTasks, spendDemand(request.gates).tasks) }), request);
              mandateRef.current = granted;
              setMandate(granted);
              settleConfirmation(confirmation, true);
            }}>批准并自动进行</button>}
            <button type={'button'} disabled={confirmation.blocked} onClick={() => settleConfirmation(confirmation, true)}>{confirmation.offerMandate ? '仅批准本次' : t('agentPanel.allow')}</button>
          </div>
        </div>}
        <div
          ref={composer}
          className="workflow-agent__composer"
          data-testid="agent-composer"
          onDragEnter={event => {
            if (!Array.from(event.dataTransfer.items).some(item => item.kind === 'file' && (item.type.startsWith('image/') || item.type.startsWith('video/')))) return;
            event.preventDefault();
            attachDragDepth.current += 1;
            setAttachDragActive(true);
          }}
          onDragOver={event => {
            if (!Array.from(event.dataTransfer.items).some(item => item.kind === 'file' && (item.type.startsWith('image/') || item.type.startsWith('video/')))) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }}
          onDragLeave={event => {
            if (!Array.from(event.dataTransfer.items).some(item => item.kind === 'file' && (item.type.startsWith('image/') || item.type.startsWith('video/')))) return;
            event.preventDefault();
            attachDragDepth.current = Math.max(0, attachDragDepth.current - 1);
            if (attachDragDepth.current === 0) setAttachDragActive(false);
          }}
          onDrop={event => {
            event.preventDefault();
            attachDragDepth.current = 0;
            setAttachDragActive(false);
            addAttachmentFiles(event.dataTransfer.files);
          }}
        >
          {attachDragActive && <div className="agent-composer__drop" aria-hidden="true"><span>{language === 'zho' ? '松手加入本轮对话' : 'Release to attach'}</span></div>}
          <ProductionSkillDeck
            attachment={skillAttachment}
            onChange={value => {
              skillAttachmentDirty.current = true;
              setSkillAttachment(value);
              if (value && slashQuery !== null) setPrompt(current => current.replace(/(^|\s)\/[^\s/]*$/, '$1'));
              dispatchLayer({ type: 'clearSlash' });
              if (value) focusComposer();
            }}
            dropTargetRef={composer}
            open={skillOpen}
            onOpenChange={next => dispatchLayer(next ? { type: 'open', layer: 'skill' } : { type: 'close', layer: 'skill' })}
            searchQuery={slashQuery ?? undefined}
            keyboardRef={skillNav}
          />
          {mentionOpen && <div className="agent-reference-picker" role="listbox" aria-label="@ 引用节点和资产">
            <div className="agent-reference-picker__search"><AtSign size={14} /><span>{replaceTarget ? `替换“${replaceTarget.label}”为…` : mentionQuery ? `搜索“${mentionQuery}”` : '引用节点或我的素材'}</span></div>
            <div className="agent-reference-picker__list">
              <ReferenceGroup label="节点" items={referenceGroups.nodes} onSelect={addReference} icon={referenceIcon} empty="没有匹配节点" />
              <ReferenceGroup label="资产" items={referenceGroups.assets} onSelect={addReference} icon={referenceIcon} empty={assetLibrary?.items.length ? '没有匹配资产' : '我的素材为空'} />
            </div>
          </div>}
          {(creationMode !== 'all' || preferredModel) && <div className="agent-reference-chips" aria-label={language === 'zho' ? '创作设置' : 'Creation settings'}>
            {creationMode !== 'all' && <span className="agent-setting-chip">{creationModeLabel(creationMode, language)}<button type="button" aria-label={language === 'zho' ? '恢复全能创作' : 'Reset mode'} onClick={() => setCreationMode('all')}><X size={11} /></button></span>}
            {preferredModel && <span className="agent-setting-chip">{preferredModel.capability === 'video' ? <Video size={11} /> : <ImageIcon size={11} />}{preferredModel.name}<button type="button" aria-label={language === 'zho' ? `移除模型 ${preferredModel.name}` : `Remove model ${preferredModel.name}`} onClick={() => setPreferredModel(null)}><X size={11} /></button></span>}
          </div>}
          {references.length > 0 && <div className="agent-reference-chips" aria-label="已引用内容">{references.map(reference => <AgentReferenceChip
            key={reference.type + ':' + reference.id}
            node={reference.type === 'node' ? project.nodes.find(item => item.id === reference.id) : undefined}
            icon={referenceIcon(reference)}
            label={reference.label}
            targetLabel={reference.type === 'node' ? '定位节点 ' + reference.label : '已引用资产 ' + reference.label}
            onTarget={() => { if (reference.type === 'node') onFocusNode?.(reference.id); }}
            onReplace={() => startReplace(reference)}
            onRemove={() => setReferences(current => current.filter(item => item !== reference))}
          />)}</div>}
          {attachments.length > 0 && <div className="workflow-agent__attachments" aria-label={language === 'zho' ? '本轮附件' : 'Attachments'}>
            {attachments.map(item => <div key={item.id} title={`${item.name} · ${item.kind === 'image' ? '图片' : '视频'}`}>
              {item.kind === 'image'
                ? <img src={item.previewUrl} alt={item.name} />
                : <video src={item.previewUrl} muted playsInline preload="metadata" />}
              <button type="button" aria-label={`${language === 'zho' ? '移除附件' : 'Remove attachment'} ${item.name}`} onClick={() => removeAttachment(item)}><X size={10} /></button>
            </div>)}
          </div>}
          <textarea
            ref={textarea}
            value={prompt}
            onChange={event => updatePrompt(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape' && skillOpen) { event.preventDefault(); dispatchLayer({ type: 'close', layer: 'skill' }); return; }
              if (skillOpen && !event.nativeEvent.isComposing && skillNav.current?.(event.key)) { event.preventDefault(); return; }
              if (event.key === 'Escape' && mentionOpen) { event.preventDefault(); dispatchLayer({ type: 'close', layer: 'mention' }); setReplaceTarget(null); return; }
              if (event.key === 'Backspace' && !prompt && references.length) { event.preventDefault(); setReferences(current => current.slice(0, -1)); return; }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder={needsConfiguration ? t('agentPanel.composerNeedConfig') : status === 'ready' ? t('agentPanel.composerPlaceholder') : t('agentPanel.composerOffline')}
            aria-label={t('agentPanel.composerAria')}
            onPaste={event => {
              const files = Array.from(event.clipboardData?.files || []);
              if (!files.length) return;
              // 有文件时阻止默认，避免把图片当成 HTML 文本塞进输入框；纯文本粘贴不受影响。
              event.preventDefault();
              addAttachmentFiles(files);
            }}
            disabled={status === 'connecting'}
          />
          <div className="agent-composer__controls">
            <div className="agent-composer__tools">
              <div className="agent-attachment-control">
                <button type="button" aria-label={t('agentPanel.addAttachment')} aria-expanded={attachmentOpen} onClick={() => dispatchLayer({ type: 'toggle', layer: 'attachment' })}><Plus size={17} /></button>
                {attachmentOpen && <div className="agent-attachment-menu" role="menu" aria-label={t('agentPanel.addAttachment')}>
                  <button type="button" role="menuitem" onClick={() => openReferencePicker('node')}><Box size={15} /><span><strong>{t('agentPanel.referenceNodes')}</strong><small>{t('agentPanel.referenceNodesHint')}</small></span></button>
                  <button type="button" role="menuitem" onClick={() => openReferencePicker('asset')}><ImageIcon size={15} /><span><strong>{t('agentPanel.referenceAssets')}</strong><small>{t('agentPanel.referenceAssetCount', assetLibrary?.items.length || 0)}</small></span></button>
                </div>}
              </div>
              <CreationModeControl value={creationMode} onChange={setCreationMode} open={creationModeOpen} onOpenChange={open => dispatchLayer(open ? { type: 'open', layer: 'creationMode' } : { type: 'close', layer: 'creationMode' })} language={language} />
              <AgentModelPicker userApiKeys={userApiKeys} onAddApiKey={onAddApiKey} onUpdateApiKey={onUpdateApiKey} open={modelPickerOpen} onOpenChange={open => dispatchLayer(open ? { type: 'open', layer: 'modelPicker' } : { type: 'close', layer: 'modelPicker' })} language={language} />
              <div className="agent-mode-control">
                <button type="button" aria-label={t('agentPanel.generationMode')} title={mode === 'manual' ? t('agentPanel.manualModeHint') : t('agentPanel.autoModeHint')} aria-expanded={modeOpen} onClick={() => dispatchLayer({ type: 'toggle', layer: 'mode' })}><Hand size={15} /><span>{mode === 'manual' ? t('agentPanel.manualMode') : t('agentPanel.autoMode')}</span></button>
                {modeOpen && <div className="agent-mode-menu" role="menu" aria-label={t('agentPanel.generationMode')}>
                  <button type="button" role="menuitem" aria-pressed={mode === 'manual'} onClick={() => { modeRef.current = 'manual'; mandateRef.current = null; setMandate(null); setMode('manual'); dispatchLayer({ type: 'close', layer: 'mode' }); }}><Hand size={17} /><span><strong>{t('agentPanel.manualMode')}</strong><small>{t('agentPanel.manualModeHint')}</small></span>{mode === 'manual' && <Check size={15} />}</button>
                  <button type="button" role="menuitem" aria-pressed={mode === 'auto'} onClick={() => { modeRef.current = 'auto'; setMode('auto'); dispatchLayer({ type: 'close', layer: 'mode' }); }}><RotateCw size={17} /><span><strong>{t('agentPanel.autoMode')}</strong><small>{t('agentPanel.autoModeHint')}</small></span>{mode === 'auto' && <Check size={15} />}</button>
                  <p style={{ margin: 0, padding: '6px 12px 8px', fontSize: 10, lineHeight: 1.6, color: 'var(--isl-ink-ghost)' }}>删除、付费生成、Production 批准/运行、任务取消始终单独确认。</p>
                </div>}
              </div>
            </div>
            {sending
              ? <button type="button" className="agent-composer__send" aria-label="停止" onClick={stop}><Square size={13} /></button>
              : <button type="button" className="agent-composer__send" aria-label="发送" onClick={() => void send()} disabled={status !== 'ready' || (!prompt.trim() && references.length === 0 && attachments.length === 0)}><Send size={16} /></button>}
          </div>
        </div>
      </section>
    </div>
  );
}

function ReferenceGroup({ label, items, onSelect, icon, empty }: { label: string; items: AgentReference[]; onSelect: (reference: AgentReference) => void; icon: (reference: AgentReference) => React.ReactNode; empty: string }) {
  return <section className="agent-reference-group"><strong>{label}</strong>{items.length
    ? items.slice(0, 60).map(item => <button type="button" role="option" key={item.type + ':' + item.id} onClick={() => onSelect(item)}>{icon(item)}<span>{item.label}</span><small>{item.type === 'node' ? item.mediaType : item.mediaType?.replace(/^\w+\//, '')}</small></button>)
    : <p>{empty}</p>}</section>;
}


// 消息区真正的滚动层可能是外层容器，也可能是 WorkflowAgentMessages 的根节点（取决于样式），两者都处理。
function messageScrollers(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  const inner = root.firstElementChild;
  return inner instanceof HTMLElement ? [root, inner] : [root];
}
