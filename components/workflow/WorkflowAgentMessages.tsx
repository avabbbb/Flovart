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

export function WorkflowAgentMessages({ messages, running, language = 'zho' }: { messages: WorkflowAgentDisplayMessage[]; running?: boolean; language?: 'en' | 'zho' }) {
  const en = language === 'en';
  if (messages.length === 0 && !running) return <div className="workflow-agent__empty">{en ? 'Describe what you want the Agent to do with this Workflow.' : '描述你希望 Agent 对当前 Workflow 做什么。'}</div>;
  return (
    <div className="workflow-agent__messages">
      {messages.map(message => message.role === 'tool'
        ? <ToolMessage key={message.id} message={message} language={language} />
        : (
          <div key={message.id} className={`workflow-agent__message workflow-agent__message--${message.role}`}>
            <span>{message.role === 'user' ? (en ? 'You' : '你') : message.role === 'assistant' ? 'Agent' : message.role === 'error' ? (en ? 'Error' : '错误') : (en ? 'System' : '系统')}</span>
            <p>{message.text}</p>
            {message.attachments?.length ? <div className="workflow-agent__message-attachments">{message.attachments.map(item => <img key={item.id} src={item.previewUrl} alt={item.name} title={item.name} />)}</div> : null}
          </div>
        ))}
      {running && <div className="workflow-agent__working"><LoaderCircle size={14} className="workflow-spin" />{en ? 'Agent is working…' : 'Agent 正在处理...'}</div>}
    </div>
  );
}

function ToolMessage({ message, language }: { message: WorkflowAgentDisplayMessage; language: 'en' | 'zho' }) {
  const state = message.status || 'pending';
  const Icon = state === 'success' ? CheckCircle2 : state === 'error' || state === 'denied' ? XCircle : state === 'pending' ? CircleAlert : Wrench;
  const en = language === 'en';
  return (
    <details className={`workflow-agent__tool is-${state}`}>
      <summary><Icon size={15} /><div><strong>{message.title || (en ? 'Tool call' : '工具调用')}</strong><span>{state === 'pending' ? (en ? 'Waiting' : '等待执行') : state === 'success' ? (en ? 'Completed' : '执行完成') : state === 'denied' ? (en ? 'Denied' : '已拒绝') : (en ? 'Failed' : '执行失败')}</span></div></summary>
      <p>{message.text}</p>
      {message.detail !== undefined && <pre>{JSON.stringify(message.detail, null, 2)}</pre>}
    </details>
  );
}
