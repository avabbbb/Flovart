import { Circle, Send, Settings2, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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

interface FlovartAgentPanelProps {
  project: WorkflowProject;
  onActivityChange: (status: AgentPanelStatus) => void;
  onOpenSettings: () => void;
}

const AGENT_TEXT_CONFIGURATION_MESSAGE = '请在设置的“模型映射”中为 Agent 文本能力配置可用线路。';

function isAgentTextConfigurationError(error?: string) {
  const message = String(error || '').toLowerCase();
  return message.includes('no agent-text route')
    || message.includes('no configured agent-text credential');
}

function displayError(error: string) {
  return isAgentTextConfigurationError(error) ? AGENT_TEXT_CONFIGURATION_MESSAGE : error;
}

function snapshotNeedsConfiguration(snapshot: FlovartAgentSnapshot) {
  const latestAssistant = [...snapshot.messages].reverse().find(message => message.role === 'assistant');
  return isAgentTextConfigurationError(latestAssistant?.error);
}

function displayMessages(snapshot: FlovartAgentSnapshot): WorkflowAgentDisplayMessage[] {
  return snapshot.messages.map(message => ({
    id: message.id,
    role: message.error ? 'error' : message.role,
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

export function FlovartAgentPanel({ project, onActivityChange, onOpenSettings }: FlovartAgentPanelProps) {
  const client = useRef<ManagedFlovartAgentClient | undefined>(undefined);
  const workspaceBridge = useRef<WorkflowAgentBridge | undefined>(undefined);
  const abort = useRef<AbortController | undefined>(undefined);
  const activity = useRef(onActivityChange);
  const confirmationRef = useRef<{ summary: string; resolve: (approved: boolean) => void } | undefined>(undefined);
  const [messages, setMessages] = useState<WorkflowAgentDisplayMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState<'connecting' | 'ready' | 'error'>('connecting');
  const [workspaceStatus, setWorkspaceStatus] = useState<'connecting' | 'ready' | 'error'>('connecting');
  const [sending, setSending] = useState(false);
  const [needsConfiguration, setNeedsConfiguration] = useState(false);
  const [confirmation, setConfirmation] = useState<{ summary: string; resolve: (approved: boolean) => void }>();

  useEffect(() => { activity.current = onActivityChange; }, [onActivityChange]);
  useEffect(() => {
    let active = true;
    client.current = undefined;
    setStatus('connecting');
    void getManagedAgentConnection()
      .then(async connection => {
        if (!connection) throw new Error('Flovart Agent 仅在桌面端可用。');
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
    };
  }, [project.id]);

  useEffect(() => {
    if (workspaceBridge.current) void workspaceBridge.current.pushSnapshot(project).catch(() => setWorkspaceStatus('error'));
  }, [project]);

  const handleEvent = (event: FlovartAgentTurnEvent, assistantId: string) => {
    if (event.type === 'text-delta') {
      setNeedsConfiguration(false);
      setMessages(items => items.some(item => item.id === assistantId)
        ? items.map(item => item.id === assistantId ? { ...item, text: item.text + event.delta } : item)
        : [...items, { id: assistantId, role: 'assistant', text: event.delta }]);
    } else if (event.type === 'snapshot') {
      setNeedsConfiguration(snapshotNeedsConfiguration(event.snapshot));
      setMessages(displayMessages(event.snapshot));
    } else if (event.type === 'tool-start') {
      setMessages(items => [...items, {
        id: `tool-${event.id}`,
        role: 'tool',
        title: event.name,
        text: '等待 Workflow 确认与执行',
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
    if (!text || !client.current || sending) return;
    const assistantId = `stream-${crypto.randomUUID()}`;
    setMessages(items => [...items, { id: crypto.randomUUID(), role: 'user', text }]);
    setPrompt('');
    setSending(true);
    setStatus('ready');
    setNeedsConfiguration(false);
    activity.current('running');
    const controller = new AbortController();
    abort.current = controller;
    let failed = false;
    try {
      await client.current.turn(project.id, text, event => {
        if (event.type === 'error' || (event.type === 'snapshot' && event.snapshot.messages.some(message => message.error))) failed = true;
        handleEvent(event, assistantId);
      }, controller.signal);
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

  return (
    <div className="workflow-agent is-embedded">
      <header className="workflow-agent__utility">
        <span className={`workflow-agent__status is-${needsConfiguration || workspaceStatus === 'error' ? 'error' : status === 'ready' && workspaceStatus === 'ready' ? 'connected' : status}`}>
          <Circle size={8} />{status === 'connecting' ? '连接中' : status === 'error' ? '连接失败' : needsConfiguration ? '需要配置' : workspaceStatus === 'error' ? '工作区断开' : workspaceStatus !== 'ready' ? '同步工作区' : '已就绪'}
        </span>
        {needsConfiguration && <button type="button" className="ml-2 flex items-center gap-1 text-[9px] font-semibold" onClick={onOpenSettings}><Settings2 size={10} />打开模型映射</button>}
        <span className="ml-auto text-[9px]" style={{ color: 'var(--isl-ink-ghost)' }}>主对话自动恢复</span>
      </header>
      <section className="workflow-agent__body">
        <WorkflowAgentMessages messages={messages} running={sending} />
        {confirmation && <div className="workflow-agent__confirm"><strong>Agent 请求修改 Workflow</strong><p>{confirmation.summary}</p><div><button type="button" onClick={() => { confirmationRef.current = undefined; confirmation.resolve(false); setConfirmation(undefined); activity.current('running'); }}>拒绝</button><button type="button" onClick={() => { confirmationRef.current = undefined; confirmation.resolve(true); setConfirmation(undefined); activity.current('running'); }}>允许</button></div></div>}
        <div className="workflow-agent__composer">
          <textarea
            value={prompt}
            onChange={event => setPrompt(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder={needsConfiguration ? '请先配置 Agent 文本模型映射' : status === 'ready' ? '告诉 Flovart Agent 你想制作什么' : 'Flovart Agent 连接失败'}
            disabled={status === 'connecting'}
          />
          {sending
            ? <button type="button" aria-label="停止" onClick={() => { abort.current?.abort(); activity.current('idle'); void client.current?.cancel(project.id); }}><Square size={13} /></button>
            : <button type="button" aria-label="发送" onClick={() => void send()} disabled={status !== 'ready' || !prompt.trim()}><Send size={14} /></button>}
        </div>
      </section>
    </div>
  );
}
