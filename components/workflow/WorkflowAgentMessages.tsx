import { CheckCircle2, CircleAlert, LoaderCircle, Wrench, XCircle } from 'lucide-react';

export interface WorkflowAgentDisplayAttachment {
  id: string;
  name: string;
  previewUrl: string;
}

export interface WorkflowAgentDisplayMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool' | 'error';
  text: string;
  title?: string;
  detail?: unknown;
  status?: 'pending' | 'success' | 'error' | 'denied';
  attachments?: WorkflowAgentDisplayAttachment[];
  createdAt?: string;
}

export function WorkflowAgentMessages({ messages, running }: { messages: WorkflowAgentDisplayMessage[]; running?: boolean }) {
  if (messages.length === 0 && !running) return <div className="workflow-agent__empty">描述你希望 Agent 对当前 Workflow 做什么。</div>;
  return (
    <div className="workflow-agent__messages">
      {messages.map(message => message.role === 'tool'
        ? <ToolMessage key={message.id} message={message} />
        : (
          <div key={message.id} className={`workflow-agent__message workflow-agent__message--${message.role}`}>
            <span>{message.role === 'user' ? '你' : message.role === 'assistant' ? 'Agent' : message.role === 'error' ? '错误' : '系统'}</span>
            <p>{message.text}</p>
            {message.attachments?.length ? <div className="workflow-agent__message-attachments">{message.attachments.map(item => <img key={item.id} src={item.previewUrl} alt={item.name} title={item.name} />)}</div> : null}
          </div>
        ))}
      {running && <div className="workflow-agent__working"><LoaderCircle size={14} className="workflow-spin" />Agent 正在处理...</div>}
    </div>
  );
}

function ToolMessage({ message }: { message: WorkflowAgentDisplayMessage }) {
  const state = message.status || 'pending';
  const Icon = state === 'success' ? CheckCircle2 : state === 'error' || state === 'denied' ? XCircle : state === 'pending' ? CircleAlert : Wrench;
  return (
    <details className={`workflow-agent__tool is-${state}`}>
      <summary><Icon size={15} /><div><strong>{message.title || '工具调用'}</strong><span>{state === 'pending' ? '等待执行' : state === 'success' ? '执行完成' : state === 'denied' ? '已拒绝' : '执行失败'}</span></div></summary>
      <p>{message.text}</p>
      {message.detail !== undefined && <pre>{JSON.stringify(message.detail, null, 2)}</pre>}
    </details>
  );
}
