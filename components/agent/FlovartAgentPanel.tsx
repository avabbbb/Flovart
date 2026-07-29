import { Circle, Send, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getManagedAgentConnection } from '../../services/managedAgentConnection';
import {
  ManagedFlovartAgentClient,
  type FlovartAgentSnapshot,
  type FlovartAgentTurnEvent,
} from '../../services/managedFlovartAgent';
import { WorkflowAgentMessages, type WorkflowAgentDisplayMessage } from '../workflow/WorkflowAgentMessages';

interface FlovartAgentPanelProps {
  projectId: string;
  onActivityChange: (status: 'idle' | 'running' | 'done' | 'error') => void;
}

function displayMessages(snapshot: FlovartAgentSnapshot): WorkflowAgentDisplayMessage[] {
  return snapshot.messages.map(message => ({
    id: message.id,
    role: message.error ? 'error' : message.role,
    text: message.error || message.text,
    createdAt: message.timestamp ? new Date(message.timestamp).toISOString() : undefined,
  }));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'Flovart Agent 运行失败');
}

export function FlovartAgentPanel({ projectId, onActivityChange }: FlovartAgentPanelProps) {
  const client = useRef<ManagedFlovartAgentClient | undefined>(undefined);
  const abort = useRef<AbortController | undefined>(undefined);
  const activity = useRef(onActivityChange);
  const [messages, setMessages] = useState<WorkflowAgentDisplayMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState<'connecting' | 'ready' | 'error'>('connecting');
  const [sending, setSending] = useState(false);

  useEffect(() => { activity.current = onActivityChange; }, [onActivityChange]);
  useEffect(() => {
    let active = true;
    client.current = undefined;
    setStatus('connecting');
    void getManagedAgentConnection()
      .then(async connection => {
        if (!connection) throw new Error('Flovart Agent 仅在桌面端可用。');
        const next = new ManagedFlovartAgentClient(connection);
        const snapshot = await next.session(projectId);
        if (!active) return;
        client.current = next;
        setMessages(displayMessages(snapshot));
        setStatus('ready');
        activity.current(snapshot.messages.length ? 'done' : 'idle');
      })
      .catch(error => {
        if (!active) return;
        setStatus('error');
        setMessages([{ id: 'connection-error', role: 'error', text: errorMessage(error) }]);
        activity.current('error');
      });
    return () => {
      active = false;
      abort.current?.abort();
    };
  }, [projectId]);

  const handleEvent = (event: FlovartAgentTurnEvent, assistantId: string) => {
    if (event.type === 'text-delta') {
      setMessages(items => items.some(item => item.id === assistantId)
        ? items.map(item => item.id === assistantId ? { ...item, text: item.text + event.delta } : item)
        : [...items, { id: assistantId, role: 'assistant', text: event.delta }]);
    } else if (event.type === 'snapshot') {
      setMessages(displayMessages(event.snapshot));
    } else if (event.type === 'error') {
      setMessages(items => [...items, { id: crypto.randomUUID(), role: 'error', text: event.message }]);
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
    activity.current('running');
    const controller = new AbortController();
    abort.current = controller;
    let failed = false;
    try {
      await client.current.turn(projectId, text, event => {
        if (event.type === 'error' || (event.type === 'snapshot' && event.snapshot.messages.some(message => message.error))) failed = true;
        handleEvent(event, assistantId);
      }, controller.signal);
      activity.current(failed ? 'error' : 'done');
    } catch (error) {
      if (!controller.signal.aborted) {
        setMessages(items => [...items, { id: crypto.randomUUID(), role: 'error', text: errorMessage(error) }]);
        activity.current('error');
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="workflow-agent is-embedded">
      <header className="workflow-agent__utility">
        <span className={`workflow-agent__status is-${status === 'ready' ? 'connected' : status}`}>
          <Circle size={8} />{status === 'connecting' ? '连接中' : status === 'ready' ? '已就绪' : '需要配置'}
        </span>
        <span className="ml-auto text-[9px]" style={{ color: 'var(--isl-ink-ghost)' }}>主对话自动恢复</span>
      </header>
      <section className="workflow-agent__body">
        <WorkflowAgentMessages messages={messages} running={sending} />
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
            placeholder={status === 'ready' ? '告诉 Flovart Agent 你想制作什么' : '请先配置 Agent 文本模型映射'}
            disabled={status === 'connecting'}
          />
          {sending
            ? <button type="button" aria-label="停止" onClick={() => { abort.current?.abort(); activity.current('idle'); void client.current?.cancel(projectId); }}><Square size={13} /></button>
            : <button type="button" aria-label="发送" onClick={() => void send()} disabled={status !== 'ready' || !prompt.trim()}><Send size={14} /></button>}
        </div>
      </section>
    </div>
  );
}
